/**
 * 信用证台账（2026-10-18，按 UCP 600 通行做法）。单证员按开证行/通知行来证登记：信用证号、开证行、通知行、是否保兑、
 * 即期/远期、币种与金额（含溢短装 ±%）、开证日、最晚装运日、有效期与到期地点、交单期（缺省 21 天，UCP 600 第 14 条 c 款）、
 * 是否允许分批与转运、单据要求。修改只按受益人已接受的修改书逐条登记，原条款保留在修改记录中。
 * 交单：按出运登记运输单据日（装运日）、交单日、交单金额与单据；系统自动列出“迟装 / 迟交单 / 过有效期 / 不允许分批”不符点，
 * 交单金额不得超过可用余额（金额 ×（1 + 溢装%）− 未被拒付的交单）。银行审单结果：相符、不符（列明不符点，等待申请人接受/拒绝）、
 * 承付（登记承付日与金额，到账另由财务按银行流水核销）、拒付。不代替银行审单，不做 SWIFT 报文。
 */
import { MistCommandError, mistMoneyMinor, type MistContext, type MistState } from './mistWorkspace';
import { platformBusinessDate } from './mistPlatform';

export type LcAvailableBy = 'sight' | 'usance';
export type LcPresentationResult = 'pending' | 'complying' | 'discrepant' | 'honoured' | 'refused';
export const LC_RESULT_LABEL: Record<LcPresentationResult, string> = { pending: '待银行审单', complying: '单证相符', discrepant: '存在不符点', honoured: '已承付', refused: '已拒付' };
export type LcAmendChange = { field: LcAmendField; label: string; from: string; to: string };
export type LcAmendField = 'amount' | 'tolerancePct' | 'latestShipmentDate' | 'expiryDate' | 'presentationDays' | 'partialShipment' | 'transhipment' | 'documentsRequired';
export const LC_AMEND_LABEL: Record<LcAmendField, string> = { amount: '金额', tolerancePct: '金额容差 %', latestShipmentDate: '最晚装运日', expiryDate: '有效期', presentationDays: '交单期（天）', partialShipment: '分批装运', transhipment: '转运', documentsRequired: '单据要求' };
export type MistLcAmendment = { no: number; date: string; changes: LcAmendChange[]; note: string; at: string; actor: string };
export type MistLcPresentation = {
  id: string; no: number; shipmentId: string; shipmentCode: string; shipmentDate: string; presentedAt: string; deadline: string; amount: number; documents: string;
  autoDiscrepancies: string[]; discrepancies: string; result: LcPresentationResult; resultAt?: string; resultNote?: string; honouredAmount?: number; history: Array<{ at: string; actor: string; result: LcPresentationResult; date: string; note: string }>;
  createdAt: string; actor: string;
};
export type MistLetterOfCredit = {
  id: string; code: string; lcNo: string; customerId: string; customer: string; orderIds: string[]; issuingBank: string; advisingBank: string; confirmed: boolean;
  availableBy: LcAvailableBy; usanceDays: number; currency: string; amount: number; tolerancePct: number; issueDate: string; latestShipmentDate: string; expiryDate: string; expiryPlace: string;
  presentationDays: number; partialShipment: boolean; transhipment: boolean; documentsRequired: string; note: string; fileIds: string[];
  amendments: MistLcAmendment[]; presentations: MistLcPresentation[]; createdAt: string; actor: string; cancelled?: { date: string; reason: string; at: string; actor: string };
};
export type LcInput = { lcNo: string; orderIds: string[]; issuingBank: string; advisingBank?: string; confirmed?: boolean; availableBy: LcAvailableBy; usanceDays?: number; currency: string; amount: string | number; tolerancePct?: string | number; issueDate: string; latestShipmentDate: string; expiryDate: string; expiryPlace?: string; presentationDays?: string | number; partialShipment?: boolean; transhipment?: boolean; documentsRequired?: string; note?: string; fileIds?: string[] };
export type LcCommand =
  | { type: 'lc.save'; payload: { input: LcInput } }
  | { type: 'lc.amend'; payload: { id: string; date: string; changes: Partial<Record<LcAmendField, unknown>>; note?: string } }
  | { type: 'lc.present'; payload: { id: string; shipmentId: string; shipmentDate: string; presentedAt: string; amount: string | number; documents: string; discrepancies?: string } }
  | { type: 'lc.presentation.result'; payload: { id: string; presentationId: string; result: Exclude<LcPresentationResult, 'pending'>; date: string; note?: string; discrepancies?: string; honouredAmount?: string | number } }
  | { type: 'lc.cancel'; payload: { id: string; date: string; reason: string } }
  | { type: 'lc.files'; payload: { id: string; fileIds: string[] } };
type Root = MistState & { letterOfCredits?: MistLetterOfCredit[] };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const text = (v: unknown, label: string, required = false, max = 200) => { const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); if (required && !s) fail(`请填写${label}`); if (s.length > max) fail(`${label}过长`); return s; };
const day = (v: unknown, label: string, required = true) => { const s = text(v, label, required, 10); if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s)) fail(`${label}格式无效`); return s; };
const money = (v: unknown, label: string) => { const s = text(v, label, true, 20); if (!/^\d{1,12}(\.\d{1,2})?$/.test(s) || !(Number(s) > 0)) fail(`${label}须为大于零、最多两位小数的金额`); return Number(s); };
const int = (v: unknown, label: string, min: number, max: number, fallback: number) => { if (v === undefined || v === null || v === '') return fallback; const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(`${label}须为 ${min}–${max} 的整数`); return n; };
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const fmt = (n: number) => n.toFixed(2);

export const readLetterOfCredits = (root: Pick<Root, 'letterOfCredits'>) => root.letterOfCredits || [];
const find = (root: Root, id: unknown) => readLetterOfCredits(root).find(l => l.id === id) || fail('信用证不存在', 'NOT_FOUND');
/** 可支取上限 = 金额 ×（1 + 溢装%）。 */
export const lcCeilingMinor = (lc: Pick<MistLetterOfCredit, 'amount' | 'tolerancePct'>) => Math.round(mistMoneyMinor(lc.amount) * (100 + lc.tolerancePct) / 100);
/** 已占用 = 未被拒付的交单金额（承付按承付金额）。 */
export const lcDrawnMinor = (lc: Pick<MistLetterOfCredit, 'presentations'>, exceptId = '') => lc.presentations.filter(p => p.id !== exceptId && p.result !== 'refused').reduce((n, p) => n + mistMoneyMinor(p.result === 'honoured' && p.honouredAmount !== undefined ? p.honouredAmount : p.amount), 0);
export const lcAvailableMinor = (lc: MistLetterOfCredit, exceptId = '') => Math.max(0, lcCeilingMinor(lc) - lcDrawnMinor(lc, exceptId));
export type LcStatus = 'active' | 'expired' | 'drawn' | 'cancelled';
export const LC_STATUS_LABEL: Record<LcStatus, string> = { active: '有效', expired: '已过有效期', drawn: '已用完', cancelled: '已注销' };
export function lcStatus(lc: MistLetterOfCredit, today: string): LcStatus {
  if (lc.cancelled) return 'cancelled';
  if (lcAvailableMinor(lc) <= 0) return 'drawn';
  return lc.expiryDate < today ? 'expired' : 'active';
}
/** 有效信用证的提醒：最晚装运日 / 有效期临近（≤ 7 天）或已过，交单期截止临近。 */
export function lcAlerts(lc: MistLetterOfCredit, today: string): string[] {
  if (lcStatus(lc, today) !== 'active') return [];
  const out: string[] = [], diff = (d: string) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  const ship = diff(lc.latestShipmentDate), exp = diff(lc.expiryDate);
  if (ship < 0) out.push(`已过最晚装运日 ${lc.latestShipmentDate}`); else if (ship <= 7) out.push(`距最晚装运日 ${ship} 天`);
  if (exp <= 7) out.push(`距有效期 ${exp} 天`);
  for (const p of lc.presentations) if (p.result === 'discrepant') out.push(`第 ${p.no} 次交单存在不符点，待申请人答复`);
  return out;
}
/** The credit may modify the UCP 600 default of 21 days (articles 1/14c); expiry still caps presentation.
 * 1–365 is this input's engineering bound, not an ICC maximum. */
export const lcPresentationDeadline = (lc: Pick<MistLetterOfCredit, 'presentationDays' | 'expiryDate'>, shipmentDate: string) => { const d = addDays(shipmentDate, lc.presentationDays); return d < lc.expiryDate ? d : lc.expiryDate; };
/** 按信用证条款自动识别的不符点（不代替银行审单）。 */
export function lcAutoDiscrepancies(lc: MistLetterOfCredit, shipmentDate: string, presentedAt: string): string[] {
  const out: string[] = [], deadline = lcPresentationDeadline(lc, shipmentDate);
  if (shipmentDate > lc.latestShipmentDate) out.push(`迟装：装运日 ${shipmentDate} 晚于最晚装运日 ${lc.latestShipmentDate}`);
  if (presentedAt > lc.expiryDate) out.push(`信用证过期：交单日 ${presentedAt} 晚于有效期 ${lc.expiryDate}`);
  else if (presentedAt > deadline) out.push(`迟交单：交单日 ${presentedAt} 晚于交单期截止 ${deadline}（装运后 ${lc.presentationDays} 天）`);
  if (!lc.partialShipment && lc.presentations.some(p => p.result !== 'refused')) out.push('不允许分批装运，但已有交单');
  return out;
}

export function lcCommandPermission(_command: LcCommand) { return 'customs:write'; }

function orderSet(root: Root, raw: unknown, currency: string) {
  if (!Array.isArray(raw) || !raw.length) fail('请选择信用证对应的订单');
  const ids = [...new Set((raw as unknown[]).map(String))], orders = ids.map(id => root.orders.find(o => o.id === id) || fail('订单不存在', 'NOT_FOUND'));
  if (new Set(orders.map(o => o.customerId)).size > 1) fail('一张信用证只能对应同一客户的订单');
  for (const o of orders) {
    if ((o as { governance?: { contract?: { paymentMethod?: string } } }).governance?.contract?.paymentMethod !== 'LC') fail(`订单 ${o.code} 合同付款方式不是信用证`);
    if ((o.currency || '').toUpperCase() !== currency) fail(`订单 ${o.code} 币种 ${o.currency} 与信用证币种 ${currency} 不同`);
  }
  return orders;
}
function event(root: Root, c: MistContext, lc: MistLetterOfCredit, value: string) { root.events.unshift({ id: c.id(), entityType: 'customs', entityId: lc.id, actor: c.actorName, at: c.now, text: value, fileIds: [] }); }

export function applyLcCommand(root: Root, command: LcCommand, c: MistContext): { id: string; presentationId?: string } {
  const list = root.letterOfCredits ||= [], today = platformBusinessDate(c.now), p = command.payload as Record<string, unknown>;
  switch (command.type) {
    case 'lc.save': {
      const i = (p.input || {}) as LcInput;
      const lcNo = text(i.lcNo, '信用证号', true, 40).toUpperCase(), issuingBank = text(i.issuingBank, '开证行', true, 200), currency = text(i.currency, '币种', true, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) fail('币种无效');
      if (list.some(l => l.lcNo === lcNo && l.issuingBank.toLowerCase() === issuingBank.toLowerCase())) fail(`信用证 ${lcNo} 已登记`, 'CONFLICT');
      const orders = orderSet(root, i.orderIds, currency);
      if (i.availableBy !== 'sight' && i.availableBy !== 'usance') fail('请选择即期或远期');
      const usanceDays = i.availableBy === 'usance' ? int(i.usanceDays, '远期天数', 1, 360, 0) || fail('远期信用证须填写远期天数') : 0;
      const issueDate = day(i.issueDate, '开证日'), latestShipmentDate = day(i.latestShipmentDate, '最晚装运日'), expiryDate = day(i.expiryDate, '有效期');
      if (issueDate > today) fail('开证日不能晚于今天');
      if (latestShipmentDate < issueDate || expiryDate < latestShipmentDate) fail('日期须满足：开证日 ≤ 最晚装运日 ≤ 有效期');
      const code = (() => { const head = 'LC-' + today.slice(0, 4) + '-'; let n = list.filter(l => l.code.startsWith(head)).length + 1; while (list.some(l => l.code === head + String(n).padStart(4, '0'))) n++; return head + String(n).padStart(4, '0'); })();
      const lc: MistLetterOfCredit = {
        id: c.id(), code, lcNo, customerId: orders[0].customerId, customer: orders[0].customer, orderIds: orders.map(o => o.id), issuingBank, advisingBank: text(i.advisingBank, '通知行', false, 200), confirmed: i.confirmed === true,
        availableBy: i.availableBy, usanceDays, currency, amount: money(i.amount, '信用证金额'), tolerancePct: int(i.tolerancePct, '金额容差比例', 0, 10, 0), issueDate, latestShipmentDate, expiryDate, expiryPlace: text(i.expiryPlace, '到期地点', false, 120),
        presentationDays: int(i.presentationDays, '交单期', 1, 365, 21), partialShipment: i.partialShipment === true, transhipment: i.transhipment === true, documentsRequired: text(i.documentsRequired, '单据要求', false, 4000), note: text(i.note, '备注', false, 2000),
        fileIds: [...new Set((i.fileIds || []).map(String))].filter(id => root.files.some(f => f.id === id) || fail('附件不存在', 'NOT_FOUND')), amendments: [], presentations: [], createdAt: c.now, actor: c.actorName,
      };
      list.unshift(lc); event(root, c, lc, `登记信用证 ${lc.lcNo}（${lc.issuingBank}，${fmt(lc.amount)} ${lc.currency}，最晚装运 ${lc.latestShipmentDate}，有效期 ${lc.expiryDate}）`);
      return { id: lc.id };
    }
    case 'lc.amend': {
      const lc = find(root, p.id); if (lc.cancelled) fail('已注销的信用证不能修改', 'PRECONDITION');
      const date = day(p.date, '修改书日期'); if (date > today || date < lc.issueDate) fail('修改书日期须在开证日与今天之间');
      const raw = (p.changes || {}) as Record<string, unknown>, keys = Object.keys(raw).filter(k => raw[k] !== undefined) as LcAmendField[];
      if (!keys.length) fail('请至少填写一项修改');
      const next = { ...lc }, changes: LcAmendChange[] = [];
      const show = (f: LcAmendField, v: unknown) => typeof v === 'boolean' ? (v ? '允许' : '不允许') : f === 'amount' ? fmt(Number(v)) : String(v);
      for (const f of keys) {
        if (!(f in LC_AMEND_LABEL)) fail('修改项目无效');
        const v = raw[f];
        const value = f === 'amount' ? money(v, '修改后金额') : f === 'tolerancePct' ? int(v, '金额容差比例', 0, 10, 0) : f === 'presentationDays' ? int(v, '交单期', 1, 365, 21) : f === 'partialShipment' || f === 'transhipment' ? (typeof v === 'boolean' ? v : fail('请明确是否允许')) : f === 'documentsRequired' ? text(v, '单据要求', true, 4000) : day(v, LC_AMEND_LABEL[f]);
        if ((lc as Record<string, unknown>)[f] === value) continue;
        changes.push({ field: f, label: LC_AMEND_LABEL[f], from: show(f, (lc as Record<string, unknown>)[f]), to: show(f, value) }); (next as Record<string, unknown>)[f] = value;
      }
      if (!changes.length) fail('修改内容与现行条款相同');
      if (next.latestShipmentDate < lc.issueDate || next.expiryDate < next.latestShipmentDate) fail('日期须满足：开证日 ≤ 最晚装运日 ≤ 有效期');
      if (lcCeilingMinor(next) < lcDrawnMinor(lc)) fail('修改后的可支取上限低于已交单金额');
      Object.assign(lc, next);
      lc.amendments.push({ no: lc.amendments.length + 1, date, changes, note: text(p.note, '说明', false, 2000), at: c.now, actor: c.actorName });
      event(root, c, lc, `登记信用证 ${lc.lcNo} 第 ${lc.amendments.length} 次修改：${changes.map(x => `${x.label} ${x.from} → ${x.to}`).join('；')}`);
      return { id: lc.id };
    }
    case 'lc.present': {
      const lc = find(root, p.id); if (lc.cancelled) fail('已注销的信用证不能交单', 'PRECONDITION');
      const s = (root.fulfillment?.shipments || []).find(x => x.id === p.shipmentId) || fail('出运不存在', 'NOT_FOUND');
      if (s.state === 'cancelled') fail('已取消的出运不能交单', 'PRECONDITION');
      if (!s.lines.some(l => lc.orderIds.includes(l.orderId))) fail('该出运不含本信用证对应订单的货物');
      if (lc.presentations.some(x => x.shipmentId === s.id && x.result !== 'refused')) fail('该出运已在本信用证下交单', 'CONFLICT');
      const shipmentDate = day(p.shipmentDate, '装运日（运输单据日）'), presentedAt = day(p.presentedAt, '交单日');
      if (shipmentDate > today || presentedAt > today) fail('装运日与交单日须为已发生日期');
      if (presentedAt < shipmentDate) fail('交单日不能早于装运日');
      const amount = money(p.amount, '交单金额'), available = lcAvailableMinor(lc);
      if (mistMoneyMinor(amount) > available) fail(`交单金额超过信用证可用余额 ${fmt(available / 100)} ${lc.currency}`);
      const auto = lcAutoDiscrepancies(lc, shipmentDate, presentedAt), no = lc.presentations.length + 1;
      const row: MistLcPresentation = { id: c.id(), no, shipmentId: s.id, shipmentCode: s.code, shipmentDate, presentedAt, deadline: lcPresentationDeadline(lc, shipmentDate), amount, documents: text(p.documents, '提交单据', true, 4000), autoDiscrepancies: auto, discrepancies: text(p.discrepancies, '已知不符点', false, 4000), result: 'pending', history: [], createdAt: c.now, actor: c.actorName };
      lc.presentations.push(row);
      event(root, c, lc, `信用证 ${lc.lcNo} 第 ${no} 次交单：${s.code}，${fmt(amount)} ${lc.currency}${auto.length ? `；系统识别不符点：${auto.join('；')}` : ''}`);
      return { id: lc.id, presentationId: row.id };
    }
    case 'lc.presentation.result': {
      const lc = find(root, p.id), row = lc.presentations.find(x => x.id === p.presentationId) || fail('交单记录不存在', 'NOT_FOUND');
      const result = p.result as LcPresentationResult, date = day(p.date, '银行通知日');
      if (!['complying', 'discrepant', 'honoured', 'refused'].includes(result)) fail('审单结果无效');
      if (row.result === 'honoured' || row.result === 'refused') fail('该交单已承付或拒付，不能再改结果', 'PRECONDITION');
      if (date > today || date < row.presentedAt) fail('银行通知日须在交单日与今天之间');
      const note = text(p.note, '说明', false, 2000);
      if (result === 'discrepant') { const d = text(p.discrepancies, '不符点', true, 4000); row.discrepancies = d; }
      if (result === 'refused' && !note) fail('拒付须写明银行拒付理由');
      if (result === 'honoured') {
        const amount = p.honouredAmount === undefined || p.honouredAmount === '' ? row.amount : money(p.honouredAmount, '承付金额');
        if (mistMoneyMinor(amount) > mistMoneyMinor(row.amount)) fail('承付金额不能超过交单金额');
        row.honouredAmount = amount;
      }
      row.result = result; row.resultAt = date; row.resultNote = note; row.history.push({ at: c.now, actor: c.actorName, result, date, note });
      event(root, c, lc, `信用证 ${lc.lcNo} 第 ${row.no} 次交单：${LC_RESULT_LABEL[result]}${result === 'honoured' ? ` ${fmt(row.honouredAmount!)} ${lc.currency}` : ''}${note ? `（${note}）` : ''}`);
      return { id: lc.id, presentationId: row.id };
    }
    case 'lc.files': {
      const lc = find(root, p.id), ids = Array.isArray(p.fileIds) ? [...new Set((p.fileIds as unknown[]).map(String))] : fail('附件列表无效');
      if (lc.fileIds.some(id => !ids.includes(id))) fail('信用证原件与修改书附件只能追加，不能移除', 'PRECONDITION');
      const added = ids.filter(id => !lc.fileIds.includes(id));
      if (!added.length) fail('没有新增附件');
      for (const id of added) if (!root.files.some(f => f.id === id)) fail('附件不存在', 'NOT_FOUND');
      lc.fileIds = ids; event(root, c, lc, `信用证 ${lc.lcNo} 追加附件 ${added.length} 个`);
      return { id: lc.id };
    }
    case 'lc.cancel': {
      const lc = find(root, p.id); if (lc.cancelled) fail('信用证已注销', 'PRECONDITION');
      if (lc.presentations.some(x => x.result === 'pending' || x.result === 'complying' || x.result === 'discrepant')) fail('还有未承付或未拒付的交单，不能注销', 'PRECONDITION');
      const date = day(p.date, '注销日'); if (date > today) fail('注销日不能晚于今天');
      lc.cancelled = { date, reason: text(p.reason, '注销原因', true, 2000), at: c.now, actor: c.actorName };
      event(root, c, lc, `注销信用证 ${lc.lcNo}：${lc.cancelled.reason}`);
      return { id: lc.id };
    }
  }
  return fail('未知信用证操作');
}
