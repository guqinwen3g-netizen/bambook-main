/**
 * Month-end close (fin21). Once a month is closed, no finance fact dated in it may be added, changed or removed: bank receipts,
 * allocations (by receipt date), payments, FX locks / settlements, bank charges and write-offs (by registration date),
 * supplier bills and payments, and period FX rates. The check compares ledgers before and after every command, so commands
 * do not each need their own guard and nothing new slips past. Reopening needs the approval permission and a reason; the
 * close and every reopen stay on record.
 */
import { MistCommandError, type MistContext, type MistState } from './mistWorkspace';
import { mistBusinessDate } from './mistBusinessClock';
import { stableJson } from './stableJson';

export type PeriodClose = { month: string; closedAt: string; closedBy: string; note: string; reopened?: { at: string; actor: string; reason: string } };
export type PeriodCloseCommand =
  | { type: 'finance.period.close'; payload: { month: string; note: string } }
  | { type: 'finance.period.reopen'; payload: { month: string; reason: string } };
export const PERIOD_CLOSE_COMMANDS = ['finance.period.close', 'finance.period.reopen'] as const;
export const periodClosePermission = (command: PeriodCloseCommand) => command.type === 'finance.period.reopen' ? 'invoices:approve:writeoff' : 'vouchers:write';
type Root = MistState & { periodCloses?: PeriodClose[] };
const fail = (message: string, code = 'PRECONDITION'): never => { throw new MistCommandError(code, message, code === 'VALIDATION' ? 422 : 409); };

export const closedMonths = (root: Pick<Root, 'periodCloses'>) => new Set((root.periodCloses || []).filter(c => !c.reopened).map(c => c.month));
export const latestClosedMonth = (root: Pick<Root, 'periodCloses'>) => [...closedMonths(root)].sort().at(-1) || '';
/** A month is locked when it or a later month is closed: closing is sequential, so everything up to the latest close is final. */
export const monthLocked = (root: Pick<Root, 'periodCloses'>, month: string) => !!month && month <= latestClosedMonth(root);

type Dated = { key: string; month: string; fingerprint: string };
const month = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : '';
const instantMonth = (value: unknown) => typeof value === 'string' && value ? mistBusinessDate(value).slice(0, 7) : '';
/** Every finance fact with the month it belongs to. */
function datedFacts(root: Root): Dated[] {
  const out: Dated[] = [], put = (key: string, m: string, row: unknown) => { if (m) out.push({ key, month: m, fingerprint: stableJson(row) }); };
  const receiptDate = new Map((root.receipts || []).map(r => [r.id, r.date]));
  const paymentDate = new Map((root.payments || []).map(p => [p.id, p.date]));
  for (const r of root.receipts || []) put('receipt:' + r.id, month(r.date), { ...r, state: undefined, suggest: undefined, confidence: undefined, remaining: undefined });
  for (const a of root.allocations || []) put('allocation:' + a.id, month(receiptDate.get(a.receiptId)), a);
  for (const p of root.payments || []) {
    put('payment:' + p.id, month(p.date), p);
    // A counter-voucher is dated today, but also reverses the original payment fact.
    // Track that effect in the original month so a new date cannot bypass its close.
    if (p.reversalOf) put('paymentReversal:' + p.id, month(paymentDate.get(p.reversalOf)), p);
  }
  for (const f of root.fxRecords || []) put('fx:' + f.id, month(f.date), f);
  for (const i of root.invoices || []) {
    for (const c of i.bankCharges || []) put('charge:' + c.id, instantMonth(c.reversed?.at || c.at), c);
    for (const w of i.writeoffs || []) put('writeoff:' + w.id, instantMonth(w.reversed?.at || w.at), w);
  }
  const pay = root.payables;
  for (const b of pay?.bills || []) put('bill:' + b.id, month(b.invoiceDate), b);
  for (const p of pay?.payments || []) put('supplierPayment:' + p.id, month(p.date), p);
  const supplierPaymentDate = new Map((pay?.payments || []).map(p => [p.id, p.date]));
  const allocationDate = new Map((pay?.allocations || []).map(a => [a.id, supplierPaymentDate.get(a.supplierPaymentId)]));
  for (const a of pay?.allocations || []) put('supplierAllocation:' + a.id, month(allocationDate.get(a.id)), a);
  // Reversals are separate records, not mutations of the original payment/allocation.
  // Their effect belongs to the original month even when registered after its close.
  for (const r of pay?.reversals || []) put('supplierReversal:' + r.id, month(r.kind === 'payment' ? supplierPaymentDate.get(r.targetId) : allocationDate.get(r.targetId)), r);
  for (const s of pay?.settlements || []) if (s.confirmation) put('supplierSettlement:' + s.id, instantMonth(s.confirmation.at), s);
  for (const d of pay?.deductions || []) put('supplierDeduction:' + d.id, instantMonth(d.at), d);
  for (const r of (root as unknown as { fxPeriodRates?: Array<{ id: string; month: string }> }).fxPeriodRates || []) put('fxRate:' + r.id, r.month, r);
  return out;
}
/** Throws when a command changed a fact of a locked month. Called by applyMistCommand after the command ran. */
export function assertClosedPeriodsUntouched(before: Root, after: Root) {
  if (!latestClosedMonth(before) && !latestClosedMonth(after)) return;
  const locked = (m: string) => monthLocked(before, m) || monthLocked(after, m);
  const old = new Map(datedFacts(before).map(f => [f.key, f])), next = new Map(datedFacts(after).map(f => [f.key, f]));
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(key), b = next.get(key);
    if (a && b && a.fingerprint === b.fingerprint) continue;
    const m = [a?.month, b?.month].filter(Boolean).find(x => locked(x!));
    if (m) fail(`${m} 已结账，不能补登、修改或冲回该月财务记录；如确需更正，请先反结账`);
  }
}

export function applyPeriodClose(root: Root, command: PeriodCloseCommand, ctx: MistContext): { id: string } {
  if (!ctx.actorId) fail('需要真实账号', 'FORBIDDEN');
  const m = command.payload.month;
  if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) fail('月份格式无效', 'VALIDATION');
  const list = root.periodCloses ||= [], today = mistBusinessDate(ctx.now).slice(0, 7), latest = latestClosedMonth(root);
  if (command.type === 'finance.period.close') {
    if (m >= today) fail('只能结已过去的月份');
    if (closedMonths(root).has(m)) fail(`${m} 已结账`);
    if (latest && m < latest) fail(`${latest} 已结账，${m} 随之锁定`);
    // Sequential: once something is closed, the next close is the following month.
    if (latest) { const [y, mo] = latest.split('-').map(Number), expect = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}`; if (m !== expect) fail(`请按月顺序结账，下一期为 ${expect}`); }
    const note = typeof command.payload.note === 'string' && command.payload.note.trim() ? command.payload.note.trim().slice(0, 1000) : fail('请填写结账说明（核对结果）', 'VALIDATION');
    list.push({ month: m, closedAt: ctx.now, closedBy: ctx.actorName, note });
    root.events.unshift({ id: ctx.id(), entityType: 'finance', entityId: 'period:' + m, actor: ctx.actorName, at: ctx.now, text: `${m} 结账：${note}`, fileIds: [] });
    return { id: m };
  }
  if (m !== latest) fail(latest ? `只能从最近结账月 ${latest} 开始反结账` : '没有已结账月份');
  const row = list.filter(c => c.month === m && !c.reopened).at(-1)!;
  const reason = typeof command.payload.reason === 'string' && command.payload.reason.trim() ? command.payload.reason.trim().slice(0, 1000) : fail('请填写反结账原因', 'VALIDATION');
  row.reopened = { at: ctx.now, actor: ctx.actorName, reason };
  root.events.unshift({ id: ctx.id(), entityType: 'finance', entityId: 'period:' + m, actor: ctx.actorName, at: ctx.now, text: `${m} 反结账：${reason}`, fileIds: [] });
  return { id: m };
}
