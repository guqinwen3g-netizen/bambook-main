/**
 * fin62 monthly finance summary (read-only). Rows per month and currency, never adding currencies together:
 * - cash in: bank receipts by receipt date; cash out: payment vouchers by date (reversal vouchers are negative and net out);
 * - rebate received: CNY tax refunds linked to rebate claims, by receipt date, reversed links excluded;
 * - FX: posted month-end revaluations (CNY, voided excluded);
 * - expenses: order expense ledger by expense date, voided excluded.
 */
import type { MistState } from './mistWorkspace';
import { readRebate } from './mistExportRebate';
import { readFxRevaluations } from './mistFxRates';
import { orderExpenses } from './mistOrderCost';

export type FinanceMonthRow = { month: string; currency: string; cashIn: number; cashOut: number; net: number; rebate: number; fx: number; expense: number };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function monthlyFinanceSummary(root: MistState, from: string, to: string): FinanceMonthRow[] {
  const map = new Map<string, FinanceMonthRow>();
  const add = (date: string | undefined, currency: string, key: 'cashIn' | 'cashOut' | 'rebate' | 'fx' | 'expense', amount: number) => {
    if (!date) return; const day = date.slice(0, 10); if ((from && day < from) || (to && day > to)) return;
    const month = day.slice(0, 7), id = month + '|' + currency;
    const row = map.get(id) || { month, currency, cashIn: 0, cashOut: 0, net: 0, rebate: 0, fx: 0, expense: 0 };
    row[key] = r2(row[key] + amount); map.set(id, row);
  };
  for (const r of root.receipts || []) add(r.date, r.currency, 'cashIn', r.amount);
  for (const p of root.payments || []) add(p.date, p.currency, 'cashOut', p.amount);
  for (const c of readRebate(root).claims) for (const x of c.receipts || []) if (!x.reversed) add(x.date, 'CNY', 'rebate', x.amount);
  for (const v of readFxRevaluations(root)) if (!v.voided) add(v.monthEnd, 'CNY', 'fx', v.total);
  for (const e of orderExpenses(root)) if (!e.voided) add(e.date, e.currency, 'expense', e.amount);
  return [...map.values()].map(r => ({ ...r, net: r2(r.cashIn - r.cashOut) })).sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency));
}
