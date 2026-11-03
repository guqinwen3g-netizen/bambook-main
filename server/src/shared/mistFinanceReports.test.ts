import { describe, expect, it } from 'vitest';
import { monthlyFinanceSummary } from './mistFinanceReports';

describe('monthly finance summary', () => {
  it('nets receipts and payments per month and currency, with rebate, FX and expenses beside them', () => {
    const s = {
      receipts: [{ date: '2026-10-03', currency: 'USD', amount: 1000 }, { date: '2026-11-02', currency: 'USD', amount: 50 }, { date: '2026-10-08', currency: 'CNY', amount: 26000 }],
      payments: [{ date: '2026-10-05', currency: 'USD', amount: 300 }, { date: '2026-10-06', currency: 'USD', amount: -100 }],
      exportRebate: { rates: [], claims: [{ receipts: [{ date: '2026-10-08', amount: 26000 }, { date: '2026-10-09', amount: 1, reversed: {} }] }] },
      fxRevaluations: [{ monthEnd: '2026-10-31', total: -120.5 }, { monthEnd: '2026-10-31', total: 999, voided: {} }],
      orderCosts: { expenses: [{ date: '2026-10-10', currency: 'CNY', amount: 800 }, { date: '2026-10-11', currency: 'CNY', amount: 5, voided: {} }] },
    } as never;
    expect(monthlyFinanceSummary(s, '2026-10-01', '2026-10-31')).toEqual([
      { month: '2026-10', currency: 'CNY', cashIn: 26000, cashOut: 0, net: 26000, rebate: 26000, fx: -120.5, expense: 800 },
      { month: '2026-10', currency: 'USD', cashIn: 1000, cashOut: 200, net: 800, rebate: 0, fx: 0, expense: 0 },
    ]);
  });
});
