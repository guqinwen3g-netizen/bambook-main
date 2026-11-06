/**
 * Read-only payables views (fin26 / fin27 / fin62). Built from the same bill, payment and plan records the payables module
 * keeps; nothing is stored. Currencies are never added together.
 * - Supplier statement: for one supplier and period, bills, payments and deductions with a running balance per currency.
 * - Payment outlook: open bills by due date and active plan instalments, grouped by week for the next N weeks.
 * - Payables aging: open bill balances by days past due.
 */
import type { MistState } from './mistWorkspace';
import { billOpenMinor, prepaymentPlans, type PayablesState } from './mistPayables';

type Root = MistState & { payables?: PayablesState };
const pay = (root: Root): PayablesState => root.payables || ({ bills: [], payments: [], allocations: [], plans: [], requests: [], reversals: [], settlements: [], deductions: [] } as unknown as PayablesState);
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const r2 = (n: number) => Math.round(n * 100) / 100;

export type SupplierStatementLine = { date: string; kind: 'bill' | 'payment' | 'deduction'; ref: string; currency: string; debit: number; credit: number; balance: number };
export function supplierStatement(root: Root, supplierId: string, from: string, to: string) {
  const p = pay(root), reversed = new Set((p.reversals || []).filter(r => r.kind === 'payment').map(r => r.targetId));
  const raw: Array<Omit<SupplierStatementLine, 'balance'>> = [
    ...p.bills.filter(b => b.supplierId === supplierId && b.state !== 'void').map(b => ({ date: b.invoiceDate, kind: 'bill' as const, ref: `${b.code} · 发票 ${b.invoiceNo}`, currency: b.currency, debit: 0, credit: b.amount })),
    ...p.payments.filter(x => x.supplierId === supplierId && !reversed.has(x.id)).map(x => ({ date: x.date, kind: 'payment' as const, ref: `${x.code}${x.reference ? ' · ' + x.reference : ''}`, currency: x.currency, debit: x.amount, credit: 0 })),
    ...(p.deductions || []).filter(d => d.supplierId === supplierId && !d.reversed).map(d => ({ date: d.at.slice(0, 10), kind: 'deduction' as const, ref: `${d.code}${d.reference ? ' · ' + d.reference : ''}`, currency: d.currency, debit: d.amount, credit: 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const currencies = [...new Set(raw.map(l => l.currency))].sort();
  return currencies.map(currency => {
    const rows = raw.filter(l => l.currency === currency);
    const opening = r2(rows.filter(l => l.date < from).reduce((n, l) => n + l.credit - l.debit, 0));
    let balance = opening;
    const lines = rows.filter(l => l.date >= from && l.date <= to).map(l => { balance = r2(balance + l.credit - l.debit); return { ...l, balance }; });
    return { currency, opening, lines, closing: balance };
  });
}

export type OutlookWeek = { start: string; items: Array<{ kind: 'bill' | 'plan'; ref: string; supplier: string; currency: string; amount: number; due: string; overdue: boolean }> };
export function paymentOutlook(root: Root, today: string, weeks = 8): OutlookWeek[] {
  const p = pay(root), weekStart = (d: string) => { const t = new Date(d + 'T00:00:00Z'), w = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - w); return t.toISOString().slice(0, 10); };
  const first = weekStart(today), last = new Date(Date.parse(first + 'T00:00:00Z') + weeks * 7 * 86400000).toISOString().slice(0, 10);
  const items = [
    ...p.bills.filter(b => b.state === 'open' && billOpenMinor(root, b) > 0 && b.due && b.due < last).map(b => ({ kind: 'bill' as const, ref: `${b.code} · ${b.invoiceNo}`, supplier: b.supplier, currency: b.currency, amount: billOpenMinor(root, b) / 100, due: b.due, overdue: b.due < today })),
    ...prepaymentPlans(root).filter(v => v.state === 'active' && v.due && v.due < last && r2(v.amount - v.paid) > 0).map(v => ({ kind: 'plan' as const, ref: `${v.code} · ${v.purchaseCode}`, supplier: v.supplier, currency: v.currency, amount: r2(v.amount - v.paid), due: v.due, overdue: v.due < today })),
  ];
  const out: OutlookWeek[] = Array.from({ length: weeks }, (_, i) => ({ start: new Date(Date.parse(first + 'T00:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10), items: [] }));
  for (const item of items) { const w = item.due < first ? out[0] : out.find((x, i) => item.due >= x.start && (i === out.length - 1 || item.due < out[i + 1].start)); w?.items.push(item); }
  return out;
}

export const AGING_BUCKETS = [['current', '未到期'], ['1-30', '逾期 1–30 天'], ['31-60', '逾期 31–60 天'], ['61-90', '逾期 61–90 天'], ['90+', '逾期 90 天以上']] as const;
export function payablesAging(root: Root, today: string) {
  const map = new Map<string, { supplier: string; currency: string; buckets: Record<string, number>; total: number }>();
  for (const b of pay(root).bills) {
    const open = billOpenMinor(root, b) / 100; if (b.state !== 'open' || open <= 0) continue;
    const late = b.due ? days(b.due, today) : 0, bucket = late <= 0 ? 'current' : late <= 30 ? '1-30' : late <= 60 ? '31-60' : late <= 90 ? '61-90' : '90+';
    const key = b.supplierId + '|' + b.currency, row = map.get(key) || { supplier: b.supplier, currency: b.currency, buckets: Object.fromEntries(AGING_BUCKETS.map(([k]) => [k, 0])), total: 0 };
    row.buckets[bucket] = r2(row.buckets[bucket] + open); row.total = r2(row.total + open); map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total);
}
