/**
 * P1-4 production NOK handling (backlog sup33 / sup34). After a production QC fails, the order owner records one of:
 * - rework: the factory reworks by a deadline; the task goes back to QC for re-inspection (existing re-report path).
 * - concession: the customer accepts the defect in writing; the order reviewer must approve before the gate opens.
 * - chargeback: a supplier deduction for the defect; the next settlement of that purchase carries it as a dispute line for finance.
 * Each disposition is append-only on the task; earlier reports and decisions are never rewritten.
 */
import { MistCommandError, assertMistOrderOpen, type MistContext, type MistState, type MistCommandResult } from './mistWorkspace';
import { reviewDecision, type MistReviewTask } from './mistReview';
import type { FulfillmentQcTask } from './mistFulfillment';
import { platformBusinessDate } from './mistPlatform';

export type QcDispositionKind = 'rework' | 'concession' | 'chargeback';
export const QC_DISPOSITION_LABEL: Record<QcDispositionKind, string> = { rework: '返工', concession: '让步接收', chargeback: '工厂扣款' };
export type QcDisposition = {
  id: string; kind: QcDispositionKind; reportId: string; note: string; fileIds: string[];
  requesterId: string; requester: string; at: string;
  /** rework */ factory?: string; due?: string;
  /** concession: what is accepted and the customer's written acceptance */ scope?: string; customerEvidence?: string;
  /** chargeback */ purchaseId?: string; purchaseCode?: string; amount?: number; currency?: string;
  status: 'open' | 'pending' | 'approved' | 'rejected';
  reviewerIds?: string[];
  decision?: { actorId: string; actor: string; at: string; decision: 'approved' | 'rejected'; note: string };
};
export type QcDispositionCommand =
  | { type: 'fulfillment.qc.dispose'; payload: { id: string; kind: QcDispositionKind; note: string; fileIds?: string[]; factory?: string; due?: string; scope?: string; customerEvidence?: string; purchaseId?: string; amount?: number } }
  | { type: 'fulfillment.qc.concession.decide'; payload: { id: string; decision: 'approved' | 'rejected'; note: string } };
export const QC_DISPOSITION_COMMANDS = ['fulfillment.qc.dispose', 'fulfillment.qc.concession.decide'] as const;

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const text = (value: unknown, label: string, max = 2000) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail(`${label}未填写或格式无效`);
const day = (value: unknown, label: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) ? value : fail(`${label}格式无效`);
const money = (value: unknown, label: string) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6 ? Math.round(value * 100) / 100 : fail(`${label}须为大于零的金额，最多两位小数`);
const reviewersFor = (root: MistState, task: FulfillmentQcTask, context: MistContext) => {
  const domain = task.source.kind === 'orderLine' ? root.orders.find(o => o.id === (task.source as { orderId: string }).orderId)?.type : undefined;
  return [...new Set(domain ? context.authority?.orderReviewerIds?.[domain] || [] : [])].filter(id => typeof id === 'string' && id && id !== context.actorId);
};
export const qcDispositions = (task: Pick<FulfillmentQcTask, 'dispositions'>) => task.dispositions || [];
/** The disposition for the task's current failed report, if any. */
export function currentQcDisposition(task: FulfillmentQcTask): QcDisposition | undefined {
  const report = task.reportIds.at(-1);
  return qcDispositions(task).filter(d => d.reportId === report).at(-1);
}
/** Approved concessions release the production gate for the exact failed report they were granted on. */
export const qcConcessionReleases = (task: FulfillmentQcTask): boolean => {
  const d = currentQcDisposition(task);
  return d?.kind === 'concession' && d.status === 'approved';
};
/** Supplier deductions for a purchase not yet carried by a pending or confirmed settlement (cancelled or returned ones release them again). */
export function openQcChargebacks(root: MistState, purchaseId: string): QcDisposition[] {
  const carried = new Set((root.payables?.settlements || []).filter(s => s.purchaseId === purchaseId && (s.state === 'pending' || s.state === 'confirmed')).flatMap(s => s.disputes.map(d => d.qcDispositionId).filter(Boolean)));
  return (root.fulfillment?.qcTasks || []).flatMap(qcDispositions).filter(d => d.kind === 'chargeback' && d.purchaseId === purchaseId && !carried.has(d.id));
}

export function applyQcDispositionCommand(root: MistState, command: QcDispositionCommand, context: MistContext): MistCommandResult {
  if (!context.actorId) fail('请使用当前在职账号办理', 'FORBIDDEN');
  const f = root.fulfillment;
  if (command.type === 'fulfillment.qc.concession.decide') {
    const task = f.qcTasks.find(t => qcDispositions(t).some(d => d.id === command.payload.id));
    const row = task && qcDispositions(task).find(d => d.id === command.payload.id);
    if (!task || !row || row.kind !== 'concession') return fail('让步接收申请不存在', 'NOT_FOUND');
    if (row.status !== 'pending' || row !== currentQcDisposition(task)) fail('该申请已处理或已有新的QC报告', 'CONFLICT');
    if (context.actorId === row.requesterId || !row.reviewerIds?.includes(context.actorId!) || !reviewersFor(root, task, { ...context, actorId: row.requesterId }).includes(context.actorId!)) fail('当前账号不在本次及当前有效审批名单', 'FORBIDDEN');
    if (!['approved', 'rejected'].includes(command.payload.decision)) fail('请选择审批结论');
    row.status = command.payload.decision;
    row.decision = { actorId: context.actorId!, actor: context.actorName, at: context.now, decision: command.payload.decision, note: text(command.payload.note, '审批意见') };
    // An approved concession lets production continue with the accepted defect; a rejection keeps the gate shut.
    if (row.status === 'approved') { task.state = 'reported'; task.businessContinued = { reportId: row.reportId, actor: context.actorName, at: context.now, note: `让步接收：${row.scope}` }; }
    root.events.unshift({ id: context.id(), entityType: 'qc', entityId: task.id, actor: context.actorName, at: context.now, text: `让步接收${row.status === 'approved' ? '已批准' : '已退回'}：${row.decision.note}`, fileIds: [] });
    return { id: task.id };
  }
  const p = command.payload, task = f.qcTasks.find(t => t.id === p.id);
  if (!task) return fail('QC任务不存在', 'NOT_FOUND');
  if ((task.kind !== 'production' && task.kind !== 'patrol') || task.source.kind !== 'orderLine') return fail('只有生产检验或巡检不通过后才能选择处置方式');
  const source = task.source;
  assertMistOrderOpen(root, source.orderId);
  const report = f.qcReports.find(r => r.id === task.reportIds.at(-1));
  if (task.state !== 'blocked' || report?.result !== 'reject') fail('当前QC任务没有待处置的不通过报告', 'PRECONDITION');
  const order = root.orders.find(o => o.id === source.orderId);
  if (order?.ownerId && order.ownerId !== context.actorId) fail('由订单负责人选择不合格处置', 'FORBIDDEN');
  const existing = currentQcDisposition(task);
  if (existing && (existing.kind !== 'chargeback' || p.kind !== 'chargeback') && existing.status !== 'rejected') fail(`本次不通过已选择${QC_DISPOSITION_LABEL[existing.kind]}`, 'CONFLICT');
  if (!['rework', 'concession', 'chargeback'].includes(p.kind)) fail('处置方式无效');
  const fileIds = Array.isArray(p.fileIds) ? [...new Set(p.fileIds)] : [];
  if (fileIds.length > 50 || fileIds.some(id => typeof id !== 'string' || !root.files.some(file => file.id === id))) fail('附件不存在或不属于当前公司');
  const row: QcDisposition = { id: context.id(), kind: p.kind, reportId: report!.id, note: text(p.note, '处置说明'), fileIds, requesterId: context.actorId!, requester: context.actorName, at: context.now, status: 'open' };
  const branch = root.productions.find(job => job.id === source.productionId);
  if (p.kind === 'rework') {
    row.factory = text(p.factory || task.factory, '返工工厂', 200);
    row.due = day(p.due, '返工完成日');
    if (row.due < platformBusinessDate(context.now)) fail('返工完成日不能早于今天');
    // The task stays blocked until QC files a passing re-inspection; the factory and deadline are scheduled on it.
    task.due = row.due;
  } else if (p.kind === 'concession') {
    row.scope = text(p.scope, '让步范围', 1000);
    row.customerEvidence = text(p.customerEvidence, '客户书面同意依据', 1000);
    if (!fileIds.length) fail('请附上客户书面同意的邮件或文件');
    const reviewers = reviewersFor(root, task, context);
    if (!reviewers.length) fail('尚无除申请人外的有效订单审批人', 'PRECONDITION');
    row.status = 'pending'; row.reviewerIds = reviewers;
  } else {
    const purchase = f.purchases.find(x => x.id === (p.purchaseId || branch?.sourcePurchaseId));
    if (!purchase || purchase.state !== 'approved' || purchase.orderId !== source.orderId || purchase.lineId !== source.lineId) fail('请选择本条目已批准的工厂合同');
    if ((root.payables?.settlements || []).some(s => s.purchaseId === purchase!.id && s.state === 'confirmed' && s.final)) fail(`${purchase!.code} 已最终结算，扣款请走售后索赔`);
    row.purchaseId = purchase!.id; row.purchaseCode = purchase!.code; row.amount = money(p.amount, '扣款金额'); row.currency = purchase!.currency;
  }
  (task.dispositions ||= []).push(row);
  const label = QC_DISPOSITION_LABEL[p.kind];
  root.events.unshift({ id: context.id(), entityType: 'qc', entityId: task.id, actor: context.actorName, at: context.now,
    text: `不合格处置：${label}${row.kind === 'rework' ? `（${row.factory}，${row.due} 前完成）` : row.kind === 'chargeback' ? `（${row.purchaseCode} ${row.amount} ${row.currency}）` : '，待审批'} · ${row.note}`, fileIds: [...fileIds] });
  return { id: task.id, dispositionId: row.id };
}

export function getQcConcessionReviews(root: MistState): MistReviewTask[] {
  return (root.fulfillment?.qcTasks || []).flatMap(task => qcDispositions(task).filter(d => d.kind === 'concession' && d.status !== 'open').map(d => ({
    id: `qc-concession:${d.id}`, kind: 'qcConcession' as const, entityId: d.id, title: `${task.code} 让步接收`, requesterId: d.requesterId, reviewerIds: d.reviewerIds || [],
    status: d.status === 'pending' ? 'pending' as const : d.status === 'approved' ? 'approved' as const : 'rejected' as const, submittedAt: d.at, decision: reviewDecision(d.decision?.actor, d.decision?.at, d.decision?.note), requiredPermission: 'orders:write',
    fileIds: [...d.fileIds], target: { view: 'qc-workbench', id: task.id },
    details: [{ label: '工厂', value: task.factory }, { label: '让步范围', value: d.scope || '' }, { label: '客户书面同意', value: d.customerEvidence || '' }, { label: '处置说明', value: d.note }],
  })));
}
