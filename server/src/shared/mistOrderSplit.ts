/**
 * ord30 / ord23 订单拆分与合并（2026-11-04）。
 * 只在订单尚无后续业务时办理：没有采购、生产、样品、QC、出运、单证、发票、资金归属、信用证、费用、索赔等记录。
 * 拆分：把选中的条目（整条或其中一部分数量）移到新的草稿订单，可另定交期；带分色分码的条目只能整条移出。
 * 合并：同一客户、同一类型、同一币种的两张订单，把来源订单的条目并入目标订单，来源订单作废并注明去向。
 * 已批准的订单拆分或合并后回到草稿，按新内容重新提交主单审批。审批中、已作废、已取消、补发、内部用途订单不办理。
 */
import { MistCommandError, MIST_ORDER_CHECKLIST, type MistContext, type MistOrder, type MistOrderLine, type MistState } from './mistWorkspace';
import { isCalendarDay, nextBusinessCode } from './mistBusinessClock';
import type { OrderGovernanceFields } from './mistOrderGovernance';

export type OrderSplitCommand =
  | { type: 'order.split'; payload: { orderId: string; lines: Array<{ lineId: string; qty?: number }>; due?: string; reason: string } }
  | { type: 'order.merge'; payload: { orderId: string; sourceOrderId: string; reason: string } };
type Governed = MistOrder & { governance?: OrderGovernanceFields };
type Root = MistState & Record<string, any>;

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message); };
const text = (v: unknown, label: string, max = 1000) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) fail(`请填写${label}`); if (s.length > max) fail(`${label}过长`); return s; };
const day = (v: unknown) => { const s = text(v, '交期', 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !isCalendarDay(s)) fail('交期格式无效'); return s; };
const q4 = (n: number) => Math.round(n * 10000) / 10000;

/** 订单已有的后续业务（有任何一项就不能拆分或合并）。 */
export function orderDownstreamFacts(root: Root, orderId: string): string[] {
  const f = root.fulfillment || {}, lineIds = new Set(root.orderLines.filter(l => l.orderId === orderId).map(l => l.id)), out: string[] = [];
  const has = (label: string, rows: unknown[] | undefined, test: (row: any) => boolean) => { if ((rows || []).some(test)) out.push(label); };
  has('采购', f.purchases, r => r.orderId === orderId);
  has('询价', root.rfqs, r => r.orderId === orderId);
  has('生产', root.productions, r => r.orderId === orderId);
  has('样品', f.samples, r => r.source?.kind === 'orderLine' && r.source.orderId === orderId);
  has('QC', f.qcTasks, r => r.source?.kind === 'orderLine' && r.source.orderId === orderId);
  has('出运', f.shipments, r => (r.lines || []).some((l: any) => l.orderId === orderId));
  has('出运条款', f.shippingTerms, r => r.orderId === orderId);
  has('单证', f.documents, r => r.orderId === orderId);
  has('发票', root.invoices, r => r.orderId === orderId);
  has('资金归属', root.orderFunding?.assignments, r => r.orderId === orderId);
  has('信用证', root.letterOfCredits, r => (r.orderIds || []).includes(orderId));
  has('订单费用', root.orderCosts?.expenses, r => (r.shares || []).some((s: any) => s.orderId === orderId));
  has('内部面料分配', root.internalFabricAllocations, r => r.orderId === orderId || r.fabricOrderId === orderId);
  has('内部交付', root.internalDeliveries, r => r.orderId === orderId);
  has('索赔', root.platform?.claims, r => r.orderId === orderId);
  has('BOM', root.platform?.boms, r => r.orderId === orderId);
  has('结案或超装申请', root.orderLines, r => lineIds.has(r.id) && (r.closure || r.overShips?.length));
  return out;
}

function eligible(root: Root, order: Governed, label: string) {
  const g = order.governance || fail('订单合同与审批资料尚未初始化', 'PRECONDITION');
  if (order.replacementSource) fail(`${label}是换货补发订单，不能拆分或合并`, 'PRECONDITION');
  if (g!.contract.kind === 'internal') fail(`${label}是内部用途订单，不能拆分或合并`, 'PRECONDITION');
  if (g!.status === 'void' || g!.status === 'cancelled') fail(`${label}已${g!.status === 'void' ? '作废' : '取消'}`, 'PRECONDITION');
  if (g!.status === 'pending' || g!.changeDraft?.status === 'pending' || g!.cancellation?.status === 'pending') fail(`${label}有待处理的审批，请先处理`, 'PRECONDITION');
  const facts = orderDownstreamFacts(root, order.id);
  if (facts.length) fail(`${label}已有${facts.join('、')}记录，不能拆分或合并`, 'PRECONDITION');
  return g!;
}
/** 已批准订单回到草稿，待重新提交主单审批。 */
function backToDraft(g: OrderGovernanceFields) { if (g.status === 'approved') { g.status = 'draft'; delete g.approvedSnapshot; } delete g.changeDraft; }
const event = (root: Root, c: MistContext, id: string, message: string) => root.events.unshift({ id: c.id(), entityType: 'order', entityId: id, actor: c.actorName, at: c.now, text: message, fileIds: [] });

export function applyOrderSplitCommand(root: Root, command: OrderSplitCommand, c: MistContext): { id: string; orderId: string } {
  if (command.type === 'order.split') {
    const p = command.payload, order = (root.orders.find(o => o.id === p.orderId) || fail('订单不存在', 'NOT_FOUND')) as Governed;
    const g = eligible(root, order, '订单'), reason = text(p.reason, '拆分原因');
    if (!Array.isArray(p.lines) || !p.lines.length) fail('请选择要移出的条目');
    const own = root.orderLines.filter(l => l.orderId === order.id);
    const picks = p.lines.map(x => { const line = own.find(l => l.id === x.lineId) || fail('条目不属于该订单', 'NOT_FOUND'); const qty = x.qty === undefined ? line.qty : x.qty;
      if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || q4(qty) !== qty) fail(`条目「${line.style}」移出数量无效`);
      if (qty > line.qty) fail(`条目「${line.style}」移出数量超过订单数量 ${line.qty}`);
      if (qty < line.qty && (line as any).breakdown) fail(`条目「${line.style}」按分色分码登记，只能整条移出`);
      if (qty < line.qty && !['米', '码', '公斤'].includes(line.unit) && !Number.isInteger(qty)) fail(`条目「${line.style}」按${line.unit}计，移出数量须为整数`);
      return { line, qty }; });
    if (new Set(picks.map(x => x.line.id)).size !== picks.length) fail('同一条目只能列一次');
    if (picks.every(x => x.qty === x.line.qty) && picks.length === own.length) fail('至少保留一个条目在原订单');
    const id = c.id(), code = nextBusinessCode(`SO-${order.type === 'fabric' ? 'F' : 'G'}`, root.orders.map(o => o.code), c.now);
    const due = p.due ? day(p.due) : order.due;
    const next: Governed = { ...structuredClone(order), id, code, due, governance: { contract: structuredClone(g.contract), status: 'draft', rounds: [], effectiveVersion: 0 }, progress: 0, state: '订单草稿', tone: 'neutral',
      checklist: MIST_ORDER_CHECKLIST.map((label, index) => ({ id: id + '-check-' + index, label, done: false, note: '' })), handoffAt: null, createdAt: c.now, updatedAt: c.now };
    root.orders.unshift(next);
    for (const { line, qty } of picks) {
      if (qty === line.qty) { line.orderId = id; continue; }
      const copy = { ...structuredClone(line), id: c.id(), orderId: id, qty, made: 0, qc: 0 } as MistOrderLine & Record<string, unknown>;
      line.qty = q4(line.qty - qty);
      for (const row of [copy, line as MistOrderLine & Record<string, unknown>]) { delete row.quantityExact; delete row.amountExact; }
      root.orderLines.push(copy);
    }
    backToDraft(g); order.updatedAt = c.now;
    const moved = picks.map(x => `${x.line.style} ${x.qty} ${x.line.unit}`).join('、');
    event(root, c, order.id, `拆分订单：${moved} 移至 ${code}${due !== order.due ? `（交期 ${due}）` : ''}；${reason}${g.rounds.length ? '。原订单需重新提交主单审批' : ''}`);
    event(root, c, id, `由 ${order.code} 拆出：${moved}；${reason}`);
    return { id, orderId: id };
  }
  const p = command.payload;
  const target = (root.orders.find(o => o.id === p.orderId) || fail('目标订单不存在', 'NOT_FOUND')) as Governed;
  const source = (root.orders.find(o => o.id === p.sourceOrderId) || fail('来源订单不存在', 'NOT_FOUND')) as Governed;
  if (target.id === source.id) fail('不能与自身合并');
  if (target.customerId !== source.customerId) fail('只能合并同一客户的订单');
  if (target.type !== source.type) fail('只能合并同一业务类型的订单');
  if (target.currency !== source.currency) fail('只能合并同一币种的订单');
  const tg = eligible(root, target, '目标订单'), sg = eligible(root, source, '来源订单'), reason = text(p.reason, '合并原因');
  const lines = root.orderLines.filter(l => l.orderId === source.id);
  if (root.orderLines.filter(l => l.orderId === target.id).length + lines.length > 200) fail('合并后条目超过 200 条');
  for (const line of lines) line.orderId = target.id;
  for (const q of root.market?.quotations || []) {
    if (q.convertedOrderId === source.id) q.convertedOrderId = target.id;
    for (const l of q.lines || []) if (l.conversion?.orderId === source.id) l.conversion = { ...l.conversion, orderId: target.id, orderCode: target.code };
  }
  sg.status = 'void'; sg.termination = { kind: 'void', reason: `并入 ${target.code}：${reason}`, at: c.now, byId: c.actorId || '', byName: c.actorName }; delete sg.changeDraft;
  source.state = '已作废'; source.tone = 'neutral'; source.updatedAt = c.now;
  for (const t of root.tasks) if (t.target?.id === source.id && !t.done && t.kind === 'order-approval') t.done = true;
  backToDraft(tg); target.updatedAt = c.now;
  const terms = ['incoterm', 'deliveryPlace', 'paymentMethod', 'paymentNote', 'depositPercent'].filter(k => JSON.stringify((sg.contract as any)[k] ?? null) !== JSON.stringify((tg.contract as any)[k] ?? null));
  event(root, c, target.id, `并入 ${source.code} 的 ${lines.length} 个条目；${reason}${terms.length ? '。来源订单的贸易或付款条款与本单不同，已按本单合同执行' : ''}${tg.rounds.length ? '。需重新提交主单审批' : ''}`);
  event(root, c, source.id, `并入 ${target.code} 后作废：${reason}`);
  return { id: target.id, orderId: target.id };
}
