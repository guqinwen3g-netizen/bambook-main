/** Offline execution facts are evidence, never a production release or a financial posting. */
import { MistCommandError, assertMistOrderApproved, assertMistOrderOpen, type MistContext, type MistState, type MistCommandResult } from './mistWorkspace';
import { platformBusinessDate } from './mistPlatform';
import type { MistReviewTask } from './mistReview';
import type { FulfillmentProductionFact } from './mistFulfillment';

export const OBSERVED_PRODUCTION_STAGES = { cut: '裁剪', sew: '车缝', finish: '整烫包装', qc: '待检验' } as const;
export function observedProductionStages(domain: 'fabric'|'garment'|undefined): Record<keyof typeof OBSERVED_PRODUCTION_STAGES,string> {
  return domain==='fabric'?{cut:'备货',sew:'加工',finish:'整理',qc:'待检验'}:OBSERVED_PRODUCTION_STAGES;
}
export type ProductionObservationInput = {
  productionId: string; asOf: string; startedOn?: string; sourceName: string; evidence: string; fileIds: string[];
  stage: keyof typeof OBSERVED_PRODUCTION_STAGES | null; percent: number | null; quantity: number | null;
};
export type ProductionObservation = Omit<ProductionObservationInput, 'productionId'> & {
  id: string; recordedAt: string; recordedBy: string; recordedById: string;
};
export type ProductionIntakeRound = {
  id: string; status: 'pending' | 'approved' | 'rejected'; requesterId: string; reviewerIds: string[];
  submittedAt: string; snapshot: ProductionObservation;
  scope: { orderId: string; lineId: string; factory: string; quantity: number; unit: string };
  decision?: { actorId: string; actor: string; at: string; note: string };
};
export type ProductionIntakeCommand =
  | { type: 'fulfillment.production.intake' | 'fulfillment.production.observe'; payload: ProductionObservationInput }
  | { type: 'fulfillment.production.intake.decide'; payload: { id: string; decision: 'approved' | 'rejected'; note: string } };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'FORBIDDEN' ? 403 : 422); };
const text = (value: unknown, label: string, max = 4000) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail(`${label}未填写或格式无效`);
function day(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) return fail(`${label}格式无效`);
  return value;
}
export function productionIntake(root: Pick<MistState, 'fulfillment'>, productionId: string) {
  return root.fulfillment?.productionFacts?.find(f => f.productionId === productionId)?.intakes?.at(-1);
}
export function productionObservation(root: Pick<MistState, 'fulfillment'>, productionId: string) {
  return root.fulfillment?.productionFacts?.find(f => f.productionId === productionId)?.observations?.at(-1);
}
export function productionProgressText(root: Pick<MistState, 'fulfillment'>, branch: { id: string; pct: number }) {
  const observed = productionObservation(root, branch.id);
  return observed ? observed.percent === null ? '进度待核' : `${observed.percent}%` : `${branch.pct}%`;
}
function reviewers(root: MistState, productionId: string, context: MistContext) {
  const branch = root.productions.find(p => p.id === productionId)!;
  const domain = root.orders.find(o => o.id === branch.orderId)!.type;
  // The repository rebuilds this authority from the requester's current company route.
  // Assigned reviewers can use the review inbox without general workspace membership.
  return [...new Set(context.authority?.orderReviewerIds?.[domain] || [])].filter(id => typeof id === 'string' && !!id.trim());
}
export function applyProductionIntake(root: MistState, command: ProductionIntakeCommand, context: MistContext): MistCommandResult {
  if (!context.actorId) fail('请使用当前在职账号登记', 'FORBIDDEN');
  if (command.type === 'fulfillment.production.intake.decide') {
    const fact = root.fulfillment.productionFacts.find(f => f.intakes?.some(r => r.id === command.payload.id));
    const round = fact?.intakes?.find(r => r.id === command.payload.id);
    if (!fact || !round) return fail('承接申请不存在', 'NOT_FOUND');
    const branch = root.productions.find(p => p.id === fact.productionId);
    if (!branch || branch.closed) fail('生产分支已关闭', 'PRECONDITION');
    assertMistOrderOpen(root, branch!.orderId);
    if (round !== fact.intakes!.at(-1) || round.status !== 'pending') fail('该承接申请已处理或已有新版', 'PRECONDITION');
    if (context.actorId === round.requesterId || !round.reviewerIds.includes(context.actorId!) || !reviewers(root, fact.productionId, context).includes(context.actorId!)) fail('当前账号不在本次及当前有效审批名单', 'FORBIDDEN');
    if (!['approved', 'rejected'].includes(command.payload.decision)) fail('请选择承接结论');
    if (command.payload.decision === 'approved' && (round.scope.orderId !== branch!.orderId || round.scope.lineId !== branch!.lineId || round.scope.factory !== branch!.factory || round.scope.quantity !== branch!.qty)) fail('生产范围已变更，请退回并重新核对承接', 'PRECONDITION');
    round.status = command.payload.decision;
    round.decision = { actorId: context.actorId!, actor: context.actorName, at: context.auditNow ?? context.now, note: text(command.payload.note, '承接意见') };
    root.events.unshift({ id: context.id(), entityType: 'production', entityId: fact.productionId, actor: context.actorName, at: context.now, text: `在制承接${round.status === 'approved' ? '已确认' : '已退回'}：${round.decision.note}`, fileIds: [] });
    return { id: fact.productionId, orderId: branch!.orderId };
  }
  const p = command.payload;
  const branch = root.productions.find(b => b.id === p.productionId);
  if (!branch) return fail('生产分支不存在', 'NOT_FOUND');
  if (branch.closed) fail('生产分支已关闭', 'PRECONDITION');
  assertMistOrderOpen(root, branch.orderId);
  assertMistOrderApproved(root, branch.orderId);
  const prior = root.fulfillment.productionFacts.find(f => f.productionId === branch.id);
  if (prior?.completion) fail('已登记最终完工，不能补录在制进度', 'PRECONDITION');
  const latest = prior?.intakes?.at(-1);
  const scopeChanged=!!latest&&(latest.scope.orderId!==branch.orderId||latest.scope.lineId!==branch.lineId||latest.scope.factory!==branch.factory||latest.scope.quantity!==branch.qty);
  const initial = command.type === 'fulfillment.production.intake';
  if (initial && (prior?.release || latest && latest.status !== 'rejected' && !(latest.status==='approved'&&scopeChanged))) fail('已有承接申请或正常放行，请在原记录继续', 'PRECONDITION');
  if (!initial && !latest) fail('请先登记线下在制承接', 'PRECONDITION');
  if (!initial && scopeChanged) fail('生产范围已变更，请重新核对在制承接', 'PRECONDITION');
  const asOf = day(p.asOf, '进度截至日');
  if (asOf > platformBusinessDate(context.now)) fail('进度截至日不能晚于今天');
  if (prior?.observations?.length && asOf < prior.observations.at(-1)!.asOf) fail('请按截至日期顺序追加；更正时保留原记录');
  const startedOn = p.startedOn ? day(p.startedOn, '实际开产日') : undefined;
  if (startedOn && startedOn > asOf) fail('实际开产日不能晚于进度截至日');
  if (p.stage !== null && !Object.prototype.hasOwnProperty.call(OBSERVED_PRODUCTION_STAGES, p.stage)) fail('工序无效');
  if (p.percent !== null && (typeof p.percent !== 'number' || !Number.isFinite(p.percent) || p.percent < 0 || p.percent > 100)) fail('进度须为0至100，未知请留空');
  if (p.quantity !== null && (typeof p.quantity !== 'number' || !Number.isFinite(p.quantity) || p.quantity < 0 || p.quantity > branch.qty || Math.abs(p.quantity * 10000 - Math.round(p.quantity * 10000)) > 0.00001)) fail('本工序数量须在分支计划范围内');
  if (p.quantity !== null && root.orders.find(o => o.id === branch.orderId)!.type === 'garment' && !Number.isSafeInteger(p.quantity)) fail('成衣本工序数量须为整数');
  if (!Array.isArray(p.fileIds) || p.fileIds.length > 100 || p.fileIds.some(id => typeof id !== 'string' || !root.files.some(f => f.id === id))) fail('附件不存在或不属于当前公司');
  const observation: ProductionObservation = { id: context.id(), asOf, ...(startedOn ? { startedOn } : {}), sourceName: text(p.sourceName, '资料来源', 200), evidence: text(p.evidence, '事实依据'), fileIds: [...new Set(p.fileIds)], stage: p.stage, percent: p.percent, quantity: p.quantity, recordedAt: context.auditNow ?? context.now, recordedBy: context.actorName, recordedById: context.actorId! };
  const eligible = initial ? reviewers(root, branch.id, context).filter(id => id !== context.actorId) : [];
  if (initial && !eligible.length) fail('尚无除申请人外的有效订单审批负责人', 'PRECONDITION');
  const fact: FulfillmentProductionFact = prior || { productionId: branch.id, sizes: [], revision: 1 };
  if (!prior) root.fulfillment.productionFacts.push(fact);
  (fact.observations ||= []).push(observation);
  if (initial) (fact.intakes ||= []).push({ id: context.id(), status: 'pending', requesterId: context.actorId!, reviewerIds: eligible, submittedAt: context.now, snapshot: structuredClone(observation), scope:{orderId:branch.orderId,lineId:branch.lineId,factory:branch.factory,quantity:branch.qty,unit:root.orderLines.find(l=>l.id===branch.lineId&&l.orderId===branch.orderId)?.unit||''} });
  root.events.unshift({ id: context.id(), entityType: 'production', entityId: branch.id, actor: context.actorName, at: context.now, text: `${initial ? '登记线下在制承接' : '登记实际生产进度'}（截至${asOf}）：${observation.evidence}`, fileIds: [...observation.fileIds] });
  return { id: branch.id, orderId: branch.orderId };
}

export function getProductionIntakeReviews(root: MistState): MistReviewTask[] {
  return (root.fulfillment?.productionFacts || []).flatMap(fact => (fact.intakes || []).map(round => {
    const branch = root.productions.find(p => p.id === fact.productionId), p = round.snapshot;
    const labels=observedProductionStages(root.orders.find(o=>o.id===round.scope.orderId)?.type);
    return { id: `production-intake:${round.id}`, kind: 'productionIntake' as const, entityId: round.id, title: `${branch?.code || ''} 在制承接`, requesterId: round.requesterId, reviewerIds: round.reviewerIds, status: round.status, submittedAt: round.submittedAt, requiredPermission: 'orders:write', fileIds: [...p.fileIds], target: { view: 'production-board', id: fact.productionId }, details: [{ label: '工厂', value: round.scope.factory }, { label: '计划数量', value: `${round.scope.quantity} ${round.scope.unit}` }, { label: '进度截至日', value: p.asOf }, { label: '实际开产日', value: p.startedOn || '待核' }, { label: '实际工序', value: p.stage ? labels[p.stage] : '待核' }, { label: '工厂进度', value: p.percent === null ? '待核' : `${p.percent}%` }, { label: '本工序已完成数量', value: p.quantity === null ? '待核' : String(p.quantity) }, { label: '资料来源', value: p.sourceName }, { label: '事实依据', value: p.evidence }] };
  }));
}
