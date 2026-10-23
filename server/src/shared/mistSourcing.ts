import { hasMaterialAtFactory } from './mistInternalFabric';
import {assertGarmentProcurement,type MistMaterialKind} from './mistInternalFabric';
/**
 * 供应商询价比价（RFQ，2026-10-18）。采购按订单条目发起询价，邀请至少两家可合作供应商；逐家登记报价（单价、币种、MOQ、承诺交期、付款条件、报价有效期）或谢绝。
 * 重新报价保留原报价为历史。比价按单价折人民币（月末汇率；缺汇率时只在询价币种内比较），同时列出交期是否满足、MOQ 是否超出、供应商最新评级。
 * 定标：选择有效报价；若不是最低价、有效报价不足两家（单一来源）、承诺交期晚于需求交期或 MOQ 超出需求数量，必须写明定标理由。
 * 定标后按中标报价生成采购草稿（数量、单价、币种、交期、付款条件、报价附件），仍需按采购审批流程提交批准后才能对外发出。
 *
 * 在手合同转给其他供应商（sourcing.purchase.transfer）：仅限已批准、尚未收货的合同整单转移（已有收货须按实收结算后对剩余数量另行建单）。
 * 原合同按“未执行即取消”办理（有票据、结算或在途付款申请须先处理；已付预付由原供应商退回），其生产分支随之关闭；
 * 同时按新供应商的单价、币种、交期生成采购草稿，重新走审批、线下发出与供应商确认。两张单互相留痕。
 */
import { MistCommandError, assertMistOrderOpen, type MistContext, type MistState } from './mistWorkspace';
import { applyFulfillmentCommand, type FulfillmentPurchase } from './mistFulfillment';
import { applyPayablesCommand, purchasePrepaymentAvailableMinor } from './mistPayables';
import { supplierBusinessDay, supplierUnavailableReason } from './mistSupplierStatus';
import { relationHoldReason } from './mistRelationHold';
import { fxRateFor } from './mistFxRates';

export type MistRfqQuote = {
  id: string; supplierId: string; supplier: string; declined: boolean; declineReason: string; price: number; currency: string; moq: number; promisedDue: string; terms: string; validUntil: string;
  note: string; fileIds: string[]; at: string; actor: string; supersededAt?: string;
};
export type MistRfq = {
  id: string; code: string; orderId: string; lineId: string; kind: FulfillmentPurchase['kind']; materialKind?: MistMaterialKind; domain: 'garment' | 'fabric'; description: string; quantity: number; unit: string; currency: string;
  due: string; destination: string; deadline: string; supplierIds: string[]; quotes: MistRfqQuote[]; note: string; state: 'open' | 'awarded' | 'cancelled'; createdAt: string; actor: string;
  award?: { quoteId: string; supplierId: string; supplier: string; reason: string; flags: string[]; purchaseId: string; purchaseCode: string; at: string; actor: string };
  cancelled?: { reason: string; at: string; actor: string };
};
export type RfqInput = { orderId: string; lineId: string; kind: FulfillmentPurchase['kind']; materialKind?: MistMaterialKind; description: string; quantity: string | number; unit: string; currency: string; due: string; destination: string; deadline: string; supplierIds: string[]; note?: string };
export type RfqCommand =
  | { type: 'rfq.save'; payload: { input: RfqInput } }
  | { type: 'rfq.invite'; payload: { id: string; supplierIds: string[] } }
  | { type: 'rfq.quote'; payload: { id: string; supplierId: string; declined?: boolean; declineReason?: string; price?: string | number; currency?: string; moq?: string | number; promisedDue?: string; terms?: string; validUntil?: string; note?: string; fileIds?: string[] } }
  | { type: 'rfq.award'; payload: { id: string; quoteId: string; reason?: string } }
  | { type: 'rfq.cancel'; payload: { id: string; reason: string } }
  | { type: 'sourcing.purchase.transfer'; payload: { purchaseId: string; supplierId: string; price: string | number; currency: string; due: string; terms?: string; reason: string } };
type Root = MistState & { rfqs?: MistRfq[] };
export const RFQ_STATE_LABEL: Record<MistRfq['state'], string> = { open: '询价中', awarded: '已定标', cancelled: '已取消' };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const text = (v: unknown, label: string, required = true, max = 500) => { const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); if (required && !s) fail(`请填写${label}`); if (s.length > max) fail(`${label}过长`); return s; };
const day = (v: unknown, label: string) => { const s = text(v, label, true, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail(`${label}格式无效`); return s; };
const positive = (v: unknown, label: string, decimals = 4) => { const s = text(v, label, true, 20); if (!new RegExp(`^\\d{1,12}(\\.\\d{1,${decimals}})?$`).test(s) || !(Number(s) > 0)) fail(`${label}须为大于零的数字（最多 ${decimals} 位小数）`); return Number(s); };
const currencyOf = (v: unknown) => { const c = text(v, '币种', true, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) fail('币种须为三位英文字母'); return c; };

export const readRfqs = (root: Pick<Root, 'rfqs'>) => root.rfqs || [];
export const rfqCommandPermission = (_c: RfqCommand) => 'procurement:write';
/** 整单转移的前置条件；返回空字符串表示可以转移。 */
export function purchaseTransferBlocker(root: MistState, po: FulfillmentPurchase): string {
  if (hasMaterialAtFactory(root, po.id)) return '已有物料交给该加工分支，请先按原交接退回';
  if (po.state !== 'approved') return po.state === 'cancelled' ? `${po.code} 已取消` : `${po.code} 尚未批准；草稿或退回的单据直接改供应商后重新提交即可`;
  if ((root.fulfillment?.receipts || []).some(r => r.purchaseId === po.id)) return `${po.code} 已有收货，不能整单转移；请按实收结算，剩余数量另行询价建单`;
  return '';
}
const find = (root: Root, id: unknown) => readRfqs(root).find(r => r.id === id) || fail('询价单不存在', 'NOT_FOUND');
const open = (r: MistRfq) => { if (r.state !== 'open') fail(`询价单${RFQ_STATE_LABEL[r.state]}，不能再操作`, 'PRECONDITION'); };
function supplierOk(root: Root, id: string, today: string) {
  const s = root.market.suppliers.find(x => x.id === id) || fail('供应商不存在', 'NOT_FOUND');
  const blocked = supplierUnavailableReason(s, today) || relationHoldReason(root, { supplierId: s.id });
  if (blocked) fail(`${s.name}：${blocked}`);
  return s;
}
export const rfqCurrentQuotes = (r: Pick<MistRfq, 'quotes'>) => r.quotes.filter(q => !q.supersededAt);

export type RfqComparisonRow = { quote: MistRfqQuote; grade: string; valid: boolean; late: boolean; moqOver: boolean; cnyUnit: number | null; rateLabel: string; comparable: boolean; lowest: boolean; rank: number | null };
/** 比价：有效报价（未谢绝、未过有效期）按单价折人民币排名；缺汇率时只在询价币种内比较。 */
export function rfqComparison(root: MistState, r: MistRfq, today: string): { rows: RfqComparisonRow[]; basis: 'cny' | 'currency'; comparableCount: number } {
  const month = today.slice(0, 7);
  const base = rfqCurrentQuotes(r).map(q => {
    const s = root.market.suppliers.find(x => x.id === q.supplierId), grade = [...(s?.ratings || [])].sort((a, b) => b.period.localeCompare(a.period))[0]?.grade || '未评级';
    const fx = q.declined ? undefined : fxRateFor(root, q.currency, 'period', { month, asOf: today });
    return { quote: q, grade, valid: !q.declined && q.validUntil >= today, late: !q.declined && q.promisedDue > r.due, moqOver: !q.declined && q.moq > r.quantity, cnyUnit: fx ? q.price * fx.rate : null, rateLabel: fx?.label || '' };
  });
  const valid = base.filter(x => x.valid), basis: 'cny' | 'currency' = valid.every(x => x.cnyUnit !== null) ? 'cny' : 'currency';
  const comparable = valid.filter(x => basis === 'cny' || x.quote.currency === r.currency), key = (x: typeof base[number]) => basis === 'cny' ? x.cnyUnit! : x.quote.price;
  const ranked = [...comparable].sort((a, b) => key(a) - key(b)), min = ranked.length ? key(ranked[0]) : null;
  const rows = base.map(x => { const i = ranked.indexOf(x); return { ...x, comparable: i >= 0, lowest: i >= 0 && min !== null && Math.abs(key(x) - min) < 1e-9, rank: i >= 0 ? i + 1 : null }; })
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || Number(a.quote.declined) - Number(b.quote.declined));
  return { rows, basis, comparableCount: comparable.length };
}
/** 定标需说明理由的情形。 */
export function rfqAwardFlags(root: MistState, r: MistRfq, quoteId: string, today: string): string[] {
  const cmp = rfqComparison(root, r, today), row = cmp.rows.find(x => x.quote.id === quoteId);
  if (!row) return [];
  const out: string[] = [];
  if (cmp.comparableCount < 2) out.push('有效可比报价不足两家（单一来源）');
  else if (!row.comparable) out.push('该报价缺少月末汇率，未参与比价');
  else if (!row.lowest) out.push(`非最低价（排名第 ${row.rank}）`);
  if (row.late) out.push(`承诺交期 ${row.quote.promisedDue} 晚于需求交期 ${r.due}`);
  if (row.moqOver) out.push(`MOQ ${row.quote.moq} ${r.unit} 超出需求数量 ${r.quantity} ${r.unit}`);
  return out;
}
function event(root: Root, c: MistContext, r: MistRfq, value: string) { root.events.unshift({ id: c.id(), entityType: 'procurement', entityId: r.id, actor: c.actorName, at: c.now, text: value, fileIds: [] }); }

export function applyRfqCommand(root: Root, command: RfqCommand, c: MistContext): { id: string; purchaseId?: string; quoteId?: string } {
  const list = root.rfqs ||= [], today = supplierBusinessDay(c.now), p = command.payload as Record<string, unknown>;
  switch (command.type) {
    case 'rfq.save': {
      const i = (p.input || {}) as RfqInput;
      const order = root.orders.find(o => o.id === i.orderId) || fail('订单不存在', 'NOT_FOUND');
      assertMistOrderOpen(root, order.id);
      const line = root.orderLines.find(l => l.id === i.lineId && l.orderId === order.id) || fail('订单条目不存在', 'NOT_FOUND');
      if (!['material', 'finished', 'processing'].includes(i.kind)) fail('采购类型无效');
      const due = day(i.due, '需求交期'), deadline = day(i.deadline, '报价截止日');
      if (deadline < today) fail('报价截止日不能早于今天');
      if (deadline > due) fail('报价截止日不能晚于需求交期');
      const ids = [...new Set((Array.isArray(i.supplierIds) ? i.supplierIds : []).map(String))];
      if (ids.length < 2) fail('请至少邀请两家供应商报价');
      ids.forEach(id => supplierOk(root, id, today));
      const head = 'RFQ-' + today.slice(0, 4) + '-'; let n = list.filter(r => r.code.startsWith(head)).length + 1; while (list.some(r => r.code === head + String(n).padStart(4, '0'))) n++;
      const r: MistRfq = { id: c.id(), code: head + String(n).padStart(4, '0'), orderId: order.id, lineId: line.id, kind: i.kind, ...(assertGarmentProcurement(order,line,i.kind,i.materialKind)?{materialKind:i.materialKind}:{}), domain: order.type, description: text(i.description, '询价内容', true, 500), quantity: positive(i.quantity, '需求数量'), unit: text(i.unit, '单位', true, 20), currency: currencyOf(i.currency),
        due, destination: text(i.destination, '交付地点', true, 200), deadline, supplierIds: ids, quotes: [], note: text(i.note, '备注', false, 2000), state: 'open', createdAt: c.now, actor: c.actorName };
      list.unshift(r);
      event(root, c, r, `发起询价 ${r.code}：${r.description} ${r.quantity} ${r.unit}，邀请 ${ids.map(id => root.market.suppliers.find(s => s.id === id)!.name).join('、')}，${deadline} 截止报价`);
      return { id: r.id };
    }
    case 'rfq.invite': {
      const r = find(root, p.id); open(r);
      const ids = [...new Set((Array.isArray(p.supplierIds) ? p.supplierIds as unknown[] : []).map(String))].filter(id => !r.supplierIds.includes(id));
      if (!ids.length) fail('请选择尚未邀请的供应商');
      const names = ids.map(id => supplierOk(root, id, today).name);
      r.supplierIds.push(...ids); event(root, c, r, `追加邀请 ${names.join('、')}`);
      return { id: r.id };
    }
    case 'rfq.quote': {
      const r = find(root, p.id); open(r);
      const supplierId = String(p.supplierId || ''); if (!r.supplierIds.includes(supplierId)) fail('该供应商不在本次询价邀请名单中');
      const s = root.market.suppliers.find(x => x.id === supplierId) || fail('供应商不存在', 'NOT_FOUND');
      const declined = p.declined === true;
      const q: MistRfqQuote = declined
        ? { id: c.id(), supplierId, supplier: s.name, declined: true, declineReason: text(p.declineReason, '谢绝原因', true, 1000), price: 0, currency: r.currency, moq: 0, promisedDue: '', terms: '', validUntil: '', note: '', fileIds: [], at: c.now, actor: c.actorName }
        : { id: c.id(), supplierId, supplier: s.name, declined: false, declineReason: '', price: positive(p.price, '报价单价'), currency: currencyOf(p.currency), moq: p.moq === undefined || p.moq === '' ? 0 : positive(p.moq, 'MOQ', 4), promisedDue: day(p.promisedDue, '承诺交期'),
            terms: text(p.terms, '付款条件', true, 200), validUntil: day(p.validUntil, '报价有效期'), note: text(p.note, '备注', false, 2000), fileIds: [], at: c.now, actor: c.actorName };
      if (!declined) {
        if (q.validUntil < today) fail('报价有效期不能早于今天');
        if (q.promisedDue < today) fail('承诺交期不能早于今天');
        const ids = [...new Set((Array.isArray(p.fileIds) ? p.fileIds as unknown[] : []).map(String))];
        for (const id of ids) if (!root.files.some(f => f.id === id)) fail('附件不存在', 'NOT_FOUND');
        q.fileIds = ids;
      }
      const prev = rfqCurrentQuotes(r).find(x => x.supplierId === supplierId); if (prev) prev.supersededAt = c.now;
      r.quotes.push(q);
      event(root, c, r, declined ? `${s.name} 谢绝报价：${q.declineReason}` : `${prev ? '更新' : '登记'} ${s.name} 报价：${q.price} ${q.currency}/${r.unit}，MOQ ${q.moq || '无'}，承诺交期 ${q.promisedDue}，有效至 ${q.validUntil}`);
      return { id: r.id, quoteId: q.id };
    }
    case 'rfq.award': {
      const r = find(root, p.id); open(r);
      const q = rfqCurrentQuotes(r).find(x => x.id === p.quoteId) || fail('报价不存在或已被更新', 'NOT_FOUND');
      if (q.declined) fail('供应商已谢绝，不能定标');
      if (q.validUntil < today) fail('报价已过有效期，请供应商重新报价');
      supplierOk(root, q.supplierId, today);
      const flags = rfqAwardFlags(root, r, q.id, today), reason = text(p.reason, '定标理由', false, 2000);
      if (flags.length && !reason) fail(`请写明定标理由：${flags.join('；')}`);
      const saved = applyFulfillmentCommand(root, { type: 'fulfillment.procurement.save', payload: { orderId: r.orderId, lineId: r.lineId, kind: r.kind, ...(r.materialKind?{materialKind:r.materialKind}:{}), supplierId: q.supplierId, supplier: q.supplier, description: r.description, quantity: r.quantity, unit: r.unit, price: q.price, currency: q.currency, due: q.promisedDue, terms: q.terms, destination: r.destination,
        note: `询价 ${r.code} 定标（${rfqCurrentQuotes(r).filter(x => !x.declined).length} 家报价）${reason ? '：' + reason : ''}`, fileIds: q.fileIds } }, c) as { id: string };
      const purchase = root.fulfillment.purchases.find(x => x.id === saved.id)!;
      r.state = 'awarded'; r.award = { quoteId: q.id, supplierId: q.supplierId, supplier: q.supplier, reason, flags, purchaseId: purchase.id, purchaseCode: purchase.code, at: c.now, actor: c.actorName };
      event(root, c, r, `定标 ${q.supplier}（${q.price} ${q.currency}/${r.unit}），生成采购草稿 ${purchase.code}${flags.length ? `；${flags.join('；')}；理由：${reason}` : ''}`);
      return { id: r.id, purchaseId: purchase.id };
    }
    case 'rfq.cancel': {
      const r = find(root, p.id); open(r);
      r.state = 'cancelled'; r.cancelled = { reason: text(p.reason, '取消原因', true, 2000), at: c.now, actor: c.actorName };
      event(root, c, r, `取消询价：${r.cancelled.reason}`);
      return { id: r.id };
    }
    case 'sourcing.purchase.transfer': {
      const po = (root.fulfillment?.purchases || []).find(x => x.id === p.purchaseId) || fail('采购合同不存在', 'NOT_FOUND');
      const blocker = purchaseTransferBlocker(root, po);
      if (blocker) fail(blocker, 'PRECONDITION');
      const target = supplierOk(root, text(p.supplierId, '新供应商'), today);
      if (target.id === po.supplierId) fail('新供应商须与原供应商不同');
      const reason = text(p.reason, '转移原因', true, 1000), due = day(p.due, '新供应商交期');
      const prepaid = purchasePrepaymentAvailableMinor(root, po.id);
      applyPayablesCommand(root, { type: 'payable.purchase.cancel', payload: { purchaseId: po.id, reason: `转给 ${target.name}：${reason}`, ...(prepaid > 0 ? { prepayment: 'refund' as const } : {}) } }, c);
      const saved = applyFulfillmentCommand(root, { type: 'fulfillment.procurement.save', payload: { orderId: po.orderId, lineId: po.lineId, kind: po.kind, ...(po.materialKind?{materialKind:po.materialKind}:{}), supplierId: target.id, supplier: target.name, description: po.description, quantity: po.quantity, unit: po.unit, price: positive(p.price, '新单价'), currency: currencyOf(p.currency), due, terms: text(p.terms, '付款条件', false, 200) || po.terms, destination: po.destination,
        note: `由 ${po.code}（${po.supplier}）转入：${reason}`, fileIds: [] } }, c) as { id: string };
      const next = root.fulfillment.purchases.find(x => x.id === saved.id)!;
      next.transferredFrom = { purchaseId: po.id, purchaseCode: po.code, supplierId: po.supplierId, supplier: po.supplier, reason };
      po.transferredTo = { purchaseId: next.id, purchaseCode: next.code, supplierId: target.id, supplier: target.name, reason, at: c.now, actor: c.actorName };
      root.events.unshift({ id: c.id(), entityType: 'procurement', entityId: next.id, at: c.now, actor: c.actorName, text: `由 ${po.code}（${po.supplier}）转入 ${target.name}，待提交审批：${reason}`, fileIds: [] });
      return { id: next.id, purchaseId: next.id };
    }
  }
  return fail('未知询价操作');
}
