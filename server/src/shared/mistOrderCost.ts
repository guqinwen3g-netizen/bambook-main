/**
 * 订单实际成本与费用分摊（2026-10-18）。外贸公司事后核算（订单决算）的通行做法：
 * - 费用台账（cost.expense.register / cost.expense.void）：海运/空运费、拖车、报关、商检、快递、保险、佣金、银行手续费、
 *   客户索赔赔付、样品等，按“这笔钱发生在哪里”登记——
 *   · 按出运（一票货多个订单）：在该出运的订单之间分摊，口径可选体积（CBM，海运拼箱/整箱通行）、毛重（空运/快递）、
 *     货值（出运数量 × 订单单价，报关/保险通行）、件数或平均；
 *   · 按订单：直接指定一个或多个订单，按货值、件数、平均或手工金额分摊。
 *   登记时把分摊结果冻结成每单金额（最大余数法到分），之后装箱、出运变化不改历史；作废保留原记录并注明原因。
 *   费用台账只用于成本核算，不产生应付或付款。
 * - 订单实际核算（orderActualCost）：收入 = 已确认的销售发票（未开票部分按合同金额暂估并标注）；
 *   采购 = 已批准采购合同已到票金额，扣除供应商索赔扣款（按票内行金额比例），未到票部分按合同金额暂估并标注；
 *   费用 = 分摊到本单的费用；退税 = 本单分摊的出口退税（已核准按核准额，否则按应退额）。
 *   全部按所选汇率口径折人民币；缺任何币种汇率不出结果，不猜。
 */
import { MistCommandError, isRecognizedMistInvoice, mistMoneyMinor, type MistContext, type MistState } from './mistWorkspace';
import { MIST_FINANCE_SCOPES } from './mistFinancePermissions';
import { platformBusinessDate } from './mistPlatform';
import { fxRateFor, type FxBasis, type FxResolved } from './mistFxRates';
import { orderRebate } from './mistExportRebate';

export const EXPENSE_CATEGORIES = { freight: '海运/空运费', trucking: '拖车/内陆运输', customs: '报关/港杂', inspection: '商检/验货', courier: '快递/寄样', insurance: '保险', commission: '佣金', bank: '银行手续费', claim: '客户索赔赔付', sample: '样品/打样', other: '其他' } as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export const ALLOCATION_BASES = { volume: '按体积', weight: '按毛重', value: '按货值', quantity: '按件数', equal: '平均', manual: '手工指定' } as const;
export type AllocationBasis = keyof typeof ALLOCATION_BASES;
export type ExpenseShare = { orderId: string; orderCode: string; basisValue: number; amount: number };
export type OrderExpense = {
  id: string; code: string; category: ExpenseCategory; vendor: string; ref: string; date: string; currency: string; amount: number; note: string;
  scope: 'shipment' | 'orders'; shipmentId?: string; shipmentCode?: string; basis: AllocationBasis; shares: ExpenseShare[];
  createdAt: string; createdBy: string; createdById: string; voided?: { at: string; actor: string; reason: string };
};
export type OrderCostState = { expenses: OrderExpense[] };
export type OrderCostCommand =
  | { type: 'cost.expense.register'; payload: { category: string; vendor?: string; ref?: string; date: string; currency: string; amount: number | string; note?: string; scope: 'shipment' | 'orders'; shipmentId?: string; orderIds?: string[]; basis: string; manual?: Array<{ orderId: string; amount: number | string }> } }
  | { type: 'cost.expense.void'; payload: { id: string; reason: string } };
export const ORDER_COST_COMMANDS = ['cost.expense.register', 'cost.expense.void'] as const;
export const orderCostCommandPermission = (_c: OrderCostCommand) => MIST_FINANCE_SCOPES.invoice;

type Root = MistState & { orderCosts?: OrderCostState };
const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const major = (m: number) => Math.round(m) / 100;
export const orderExpenses = (root: MistState) => ((root as Root).orderCosts?.expenses) || [];
export const activeExpenses = (root: MistState) => orderExpenses(root).filter(e => !e.voided);

/** 最大余数法把 total（分）按权重分到各项，合计严格等于 total。 */
export function splitMinor(total: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (!(sum > 0)) return fail('分摊依据合计为 0，请换一种分摊口径');
  const raw = weights.map(w => total * w / sum), base = raw.map(Math.floor);
  let rest = total - base.reduce((n, v) => n + v, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) { if (rest <= 0) break; base[i]++; rest--; }
  return base;
}

/** 某票出运里每个订单的分摊依据：体积、毛重来自装箱单；货值 = 出运数量 × 订单行单价（订单币种）；件数 = 出运数量。 */
export function shipmentOrderBases(root: MistState, shipmentId: string) {
  const shipment = (root.fulfillment?.shipments || []).find(s => s.id === shipmentId);
  if (!shipment) return fail('出运不存在或不可见', 'NOT_FOUND');
  const packings = (root.fulfillment?.packing || []).filter(p => p.shipmentId === shipmentId);
  const rows = new Map<string, { orderId: string; volume: number; weight: number; value: number; quantity: number; currency: string }>();
  for (const line of shipment.lines) {
    const order = root.orders.find(o => o.id === line.orderId); if (!order) continue;
    const ol = root.orderLines.find(l => l.id === line.lineId);
    const row = rows.get(order.id) ?? { orderId: order.id, volume: 0, weight: 0, value: 0, quantity: 0, currency: order.currency };
    row.quantity += line.quantity; row.value += Math.round(line.quantity * (ol?.price ?? 0) * 100);
    for (const p of packings.filter(p => p.lineId === line.lineId)) { row.volume += p.volume; row.weight += p.grossWeight; }
    rows.set(order.id, row);
  }
  return { shipment, rows: [...rows.values()] };
}

function orderBases(root: MistState, orderIds: string[]) {
  return orderIds.map(id => {
    const order = root.orders.find(o => o.id === id); if (!order) return fail('订单不存在或不可见', 'NOT_FOUND');
    return { orderId: order!.id, volume: 0, weight: 0, value: mistMoneyMinor(order!.amount), quantity: order!.qty, currency: order!.currency };
  });
}

function allocate(root: MistState, p: OrderCostCommand & { type: 'cost.expense.register' } extends { payload: infer P } ? P : never, totalMinor: number, basis: AllocationBasis) {
  const bases = p.scope === 'shipment' ? shipmentOrderBases(root, String(p.shipmentId || '')).rows : orderBases(root, [...new Set((p.orderIds || []).map(String))]);
  if (!bases.length) fail(p.scope === 'shipment' ? '这票出运没有订单明细' : '请至少选择一个订单');
  if (p.scope === 'orders' && (basis === 'volume' || basis === 'weight')) fail('按订单登记时不能按体积或毛重分摊，请改按出运登记');
  if (basis === 'value' && new Set(bases.map(b => b.currency)).size > 1) fail('所涉订单币种不同，不能按货值分摊，请改按体积、件数或手工指定');
  const code = (id: string) => root.orders.find(o => o.id === id)!.code;
  if (basis === 'manual') {
    const manual = new Map((p.manual || []).map(m => [String(m.orderId), m.amount]));
    const shares = bases.map(b => { const v = manual.get(b.orderId); const minor = v === undefined || v === '' ? 0 : mistMoneyMinor(v as number); if (minor < 0) fail('分摊金额不能为负'); return { orderId: b.orderId, orderCode: code(b.orderId), basisValue: major(minor), amount: major(minor) }; });
    for (const id of manual.keys()) if (!bases.some(b => b.orderId === id)) fail('手工分摊含不属于本次范围的订单');
    const sum = shares.reduce((n, s) => n + mistMoneyMinor(s.amount), 0);
    if (sum !== totalMinor) fail(`手工分摊合计 ${major(sum).toFixed(2)} 与费用金额 ${major(totalMinor).toFixed(2)} 不一致`);
    return shares.filter(s => s.amount > 0);
  }
  const key = basis === 'equal' ? null : basis, weights = bases.map(b => key ? b[key] : 1);
  if (key && weights.every(w => !(w > 0))) fail(basis === 'volume' || basis === 'weight' ? `这票出运还没有装箱${basis === 'volume' ? '体积' : '毛重'}，请先录装箱单或换一种口径` : '分摊依据合计为 0，请换一种分摊口径');
  const parts = splitMinor(totalMinor, weights);
  return bases.map((b, i) => ({ orderId: b.orderId, orderCode: code(b.orderId), basisValue: key === 'value' ? major(weights[i]) : Math.round(weights[i] * 10000) / 10000, amount: major(parts[i]) })).filter(s => s.amount > 0);
}

const text = (v: unknown, label: string, max = 200, required = false) => { const s = typeof v === 'string' ? v.trim() : ''; if (required && !s) fail(`请填写${label}`); if (s.length > max) fail(`${label}最多 ${max} 字`); return s; };

export function applyOrderCostCommand(root: MistState, command: OrderCostCommand, c: MistContext): { id: string } {
  const r = root as Root; r.orderCosts = r.orderCosts || { expenses: [] };
  if (command.type === 'cost.expense.void') {
    const e = r.orderCosts.expenses.find(x => x.id === command.payload?.id); if (!e) return fail('费用记录不存在', 'NOT_FOUND');
    if (e!.voided) fail('这笔费用已作废', 'CONFLICT');
    e!.voided = { at: c.now, actor: c.actorName, reason: text(command.payload.reason, '作废原因', 500, true) };
    return { id: e!.id };
  }
  if (command.type !== 'cost.expense.register') return fail('未知操作');
  const p = command.payload || ({} as never);
  const category = String(p.category) as ExpenseCategory; if (!(category in EXPENSE_CATEGORIES)) fail('请选择费用类别');
  const basis = String(p.basis) as AllocationBasis; if (!(basis in ALLOCATION_BASES)) fail('请选择分摊口径');
  if (p.scope !== 'shipment' && p.scope !== 'orders') fail('请选择按出运或按订单登记');
  const date = String(p.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('请填写费用日期');
  if (date > platformBusinessDate(c.now)) fail('费用日期不能晚于今天');
  const currency = String(p.currency || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) fail('请选择币种');
  const totalMinor = mistMoneyMinor(p.amount as number); if (!(totalMinor > 0)) fail('费用金额须大于 0');
  const shares = allocate(root, p, totalMinor, basis);
  let shipmentCode: string | undefined;
  if (p.scope === 'shipment') { const s = root.fulfillment.shipments.find(x => x.id === p.shipmentId)!; if (s.state === 'cancelled') fail('已取消的出运不能登记费用'); shipmentCode = s.code; }
  const year = date.slice(0, 4), seq = r.orderCosts.expenses.filter(e => e.code.startsWith(`FY-${year}-`)).length + 1;
  const row: OrderExpense = { id: c.id(), code: `FY-${year}-${String(seq).padStart(4, '0')}`, category, vendor: text(p.vendor, '收款方'), ref: text(p.ref, '发票/单据号', 80), date, currency, amount: major(totalMinor), note: text(p.note, '备注', 500),
    scope: p.scope, ...(p.scope === 'shipment' ? { shipmentId: p.shipmentId, shipmentCode } : {}), basis, shares, createdAt: c.now, createdBy: c.actorName, createdById: c.actorId || '' };
  r.orderCosts.expenses.unshift(row);
  return { id: row.id };
}

/* ---------------- 订单实际核算 ---------------- */
export type OrderCostLine = { key: string; label: string; currency: string; amount: number; cny: number | null; estimated?: boolean; note?: string };
export type OrderActualCost = {
  orderId: string; code: string; customer: string; currency: string;
  revenue: OrderCostLine[]; purchases: OrderCostLine[]; expenses: OrderCostLine[]; rebate: { expected: number; approved: number; received: number; used: number };
  revenueCny: number | null; purchaseCny: number | null; expenseCny: number | null; marginEx: number | null; marginIn: number | null; rateIn: number | null;
  estimated: boolean; missing: string[]; status: 'ok' | 'norate';
};
/** 单个订单的实际核算；金额单位为元，人民币按 basis 口径折算。 */
export function orderActualCost(root: MistState, orderId: string, basis: FxBasis, month: string, asOf: string): OrderActualCost {
  const order = root.orders.find(o => o.id === orderId); if (!order) return fail('订单不存在或不可见', 'NOT_FOUND');
  const o = order!, rates = new Map<string, FxResolved | undefined>();
  const rateOf = (cur: string) => { if (cur === 'CNY') return { rate: 1, label: '人民币', estimated: false } as FxResolved; if (!rates.has(cur)) rates.set(cur, fxRateFor(root, cur, basis, { month, asOf, orderId })); return rates.get(cur); };
  const line = (key: string, label: string, currency: string, minor: number, extra: Partial<OrderCostLine> = {}): OrderCostLine => { const r = rateOf(currency); return { key, label, currency, amount: major(minor), cny: r ? major(Math.round(minor * r.rate)) : null, ...extra }; };
  // 收入：已确认销售发票；未开票部分按合同暂估
  const invoices = root.invoices.filter(i => i.orderId === orderId && isRecognizedMistInvoice(i));
  const revenue: OrderCostLine[] = invoices.map(i => line('inv:' + i.id, `发票 ${i.code}`, i.currency, mistMoneyMinor(i.amount)));
  const invoicedSame = invoices.filter(i => i.currency === o.currency).reduce((n, i) => n + mistMoneyMinor(i.amount), 0), rest = mistMoneyMinor(o.amount) - invoicedSame;
  if (rest > 0) revenue.push(line('rev:rest', invoices.length ? '未开票部分（按合同暂估）' : '合同金额（尚未开票，暂估）', o.currency, rest, { estimated: true }));
  // 采购：已到票金额 − 索赔扣款；未到票按合同暂估
  const bills = (root.payables?.bills || []).filter(b => b.state !== 'void'), deductions = (root.payables?.deductions || []).filter(d => !d.reversed);
  const purchases: OrderCostLine[] = [];
  for (const p of (root.fulfillment?.purchases || []).filter(p => p.orderId === orderId && !p.cancellation && p.state === 'approved')) {
    let billed = 0, deducted = 0;
    for (const b of bills) {
      const mine = b.lines.filter(l => l.purchaseId === p.id).reduce((n, l) => n + mistMoneyMinor(l.amount), 0); if (!mine) continue;
      billed += mine; const total = mistMoneyMinor(b.amount);
      if (total) deducted += Math.round(deductions.filter(d => d.billId === b.id).reduce((n, d) => n + mistMoneyMinor(d.amount), 0) * mine / total);
    }
    const contract = Math.max(0, Math.round(p.quantity * p.price * 100)), unbilled = Math.max(0, contract - billed);
    if (billed) purchases.push(line('pur:' + p.id, `${p.code} ${p.supplier} 已到票`, p.currency, billed));
    if (deducted) purchases.push(line('ded:' + p.id, `${p.code} 供应商索赔扣款`, p.currency, -deducted));
    if (unbilled) purchases.push(line('est:' + p.id, `${p.code} ${p.supplier} 未到票（按合同暂估）`, p.currency, unbilled, { estimated: true }));
  }
  const expenses: OrderCostLine[] = [];
  for (const e of activeExpenses(root)) for (const s of e.shares.filter(s => s.orderId === orderId))
    expenses.push(line('exp:' + e.id, `${e.code} ${EXPENSE_CATEGORIES[e.category]}${e.shipmentCode ? ` · ${e.shipmentCode}` : ''}（${ALLOCATION_BASES[e.basis]}）`, e.currency, mistMoneyMinor(s.amount), { note: e.vendor }));
  const rebateRaw = orderRebate(root as never, orderId), used = rebateRaw.approved || rebateRaw.expected;
  const sum = (rows: OrderCostLine[]) => rows.some(r => r.cny === null) ? null : Math.round(rows.reduce((n, r) => n + mistMoneyMinor(r.cny!), 0));
  const rv = sum(revenue), pc = sum(purchases), ex = sum(expenses);
  const missing = [...rates.entries()].filter(([, r]) => !r).map(([cur]) => cur), status: OrderActualCost['status'] = missing.length ? 'norate' : 'ok';
  const marginEx = status === 'ok' && rv !== null && pc !== null && ex !== null ? rv - pc - ex : null, marginIn = marginEx === null ? null : marginEx + mistMoneyMinor(used);
  return { orderId, code: o.code, customer: o.customer, currency: o.currency, revenue, purchases, expenses, rebate: { ...rebateRaw, used },
    revenueCny: rv === null ? null : major(rv), purchaseCny: pc === null ? null : major(pc), expenseCny: ex === null ? null : major(ex),
    marginEx: marginEx === null ? null : major(marginEx), marginIn: marginIn === null ? null : major(marginIn), rateIn: marginIn === null || !rv ? null : marginIn / rv,
    estimated: [...revenue, ...purchases].some(r => r.estimated) || [...rates.values()].some(r => r?.estimated), missing, status };
}
