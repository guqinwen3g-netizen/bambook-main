/**
 * Monthly voucher export (fin22). Bambook records business facts; the books are kept in the company's accounting software.
 * This turns one month's finance facts into suggested double-entry lines with the common 企业会计准则 account codes, in the
 * column layout accepted by Kingdee / Yonyou voucher import (日期、凭证字、摘要、科目编码、科目名称、币种、原币、汇率、借方、贷方).
 * Accounting staff review and post them; nothing here is a posted ledger. Foreign amounts are converted at the month's
 * registered period rate when there is one, otherwise the CNY columns are left for the bookkeeper.
 */
import { WRITEOFF_LABEL, mistMoneyMinor, type MistState } from './mistWorkspace';
import { fxCnyMinor, fxPeriodRateFor } from './mistFxRates';
import { mistBusinessDate } from './mistBusinessClock';
import { allocationFacts, allocationDate } from './mistAllocationFacts';

export const ACCOUNTS = {
  bank: ['1002', '银行存款'], receivable: ['1122', '应收账款'], advance: ['2203', '预收账款'], payable: ['2202', '应付账款'],
  revenue: ['6001', '主营业务收入'], fee: ['6603', '财务费用'], fx: ['6603.02', '财务费用-汇兑损益'], badDebt: ['1231', '坏账准备'], other: ['1221', '其他应收款'],
} as const;
export type VoucherLine = { date: string; no: string; summary: string; account: string; accountName: string; currency: string; amount: number; rate: number | null; debit: number | null; credit: number | null; source: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function monthlyVouchers(root: MistState, month: string): VoucherLine[] {
  const out: VoucherLine[] = []; let seq = 0;
  const rate = (currency: string) => currency === 'CNY' ? 1 : Number(fxPeriodRateFor(root as never, currency, month)?.rate) || null;
  const pair = (date: string, summary: string, currency: string, amount: number, dr: readonly [string, string], cr: readonly [string, string], source: string) => {
    const no = `记-${String(++seq).padStart(4, '0')}`, fx = rate(currency), cny = fx ? r2(amount * fx) : null;
    out.push({ date, no, summary, account: dr[0], accountName: dr[1], currency, amount, rate: fx, debit: cny, credit: null, source });
    out.push({ date, no, summary, account: cr[0], accountName: cr[1], currency, amount, rate: fx, debit: null, credit: cny, source });
  };
  // Each side keeps its own original currency. Only converted CNY minor units may
  // be subtracted for the exchange gain/loss; a missing rate leaves that side unpriced.
  const exchange = (date: string, summary: string, source: string,
    dr: { account: readonly [string, string]; currency: string; amount: number },
    cr: { account: readonly [string, string]; currency: string; amount: number }) => {
    const no = `记-${String(++seq).padStart(4, '0')}`;
    const convert = (side: typeof dr) => {
      const text = side.currency === 'CNY' ? '1' : fxPeriodRateFor(root, side.currency, month)?.rate;
      return { rate: text ? Number(text) : null, minor: text ? fxCnyMinor(mistMoneyMinor(side.amount), text) : null };
    };
    const debit = convert(dr), credit = convert(cr);
    out.push({ date, no, summary, account: dr.account[0], accountName: dr.account[1], currency: dr.currency, amount: dr.amount,
      rate: debit.rate, debit: debit.minor === null ? null : debit.minor / 100, credit: null, source });
    out.push({ date, no, summary, account: cr.account[0], accountName: cr.account[1], currency: cr.currency, amount: cr.amount,
      rate: credit.rate, debit: null, credit: credit.minor === null ? null : credit.minor / 100, source });
    if (debit.minor !== null && credit.minor !== null) {
      const gain = debit.minor - credit.minor;
      if (gain) out.push({ date, no, summary: summary + ' 汇兑差', account: ACCOUNTS.fx[0], accountName: ACCOUNTS.fx[1],
        currency: 'CNY', amount: Math.abs(gain) / 100, rate: 1, debit: gain < 0 ? -gain / 100 : null, credit: gain > 0 ? gain / 100 : null, source });
    }
  };
  const inMonth = (d: string | undefined) => !!d && d.slice(0, 7) === month;
  for (const i of root.invoices || []) if (!i.voidedAt && i.financeStatus !== 'pending' && i.financeStatus !== 'rejected' && inMonth(i.issuedAt)) pair(i.issuedAt!, `确认应收 ${i.code} ${i.customer}`, i.currency, i.amount, ACCOUNTS.receivable, ACCOUNTS.revenue, i.code);
  const receipts = new Map((root.receipts || []).map(r => [r.id, r]));
  // Reversed allocations remain immutable facts through the reversal snapshot.
  const allocations = allocationFacts(root);
  for (const a of allocations) {
    const r = receipts.get(a.receiptId), i = root.invoices.find(x => x.id === a.invoiceId);
    if (!r || !i) continue;
    const date = allocationDate(a, r.date);
    if (!inMonth(date)) continue;
    const summary = `收款核销 ${r.code} → ${i.code}`, source = `${r.code}/${i.code}`;
    const debit = ACCOUNTS.advance;
    if ((a.receiptCurrency || a.currency) !== a.currency) exchange(date, summary, source,
      { account: debit, currency: a.receiptCurrency!, amount: a.receiptAmount! },
      { account: ACCOUNTS.receivable, currency: a.currency, amount: a.amount });
    else pair(date, summary, a.currency, a.amount, debit, ACCOUNTS.receivable, source);
  }
  for (const reversal of root.financeReversals || []) {
    const a = reversal.allocation;
    if (reversal.kind !== 'allocation' || !a) continue;
    const r = receipts.get(a.receiptId), i = root.invoices.find(x => x.id === a.invoiceId);
    const date = mistBusinessDate(reversal.at);
    if (!r || !i || !inMonth(date)) continue;
    const summary = `冲回核销 ${a.id} ${r.code} → ${i.code}`, source = reversal.id;
    // Restore the receipt-side advance, never reverse the bank's actual receipt.
    if ((a.receiptCurrency || a.currency) !== a.currency) exchange(date, summary, source,
      { account: ACCOUNTS.receivable, currency: a.currency, amount: a.amount },
      { account: ACCOUNTS.advance, currency: a.receiptCurrency!, amount: a.receiptAmount! });
    else pair(date, summary, a.currency, a.amount, ACCOUNTS.receivable, ACCOUNTS.advance, source);
  }
  for (const r of root.receipts || []) {
    if (!inMonth(r.date)) continue;
    // Recognize the full bank receipt once. Applications only move the advance.
    pair(r.date, `到账待核销 ${r.code} ${r.payer}`, r.currency, mistMoneyMinor(r.amount) / 100, ACCOUNTS.bank, ACCOUNTS.advance, r.code);
  }
  for (const i of root.invoices || []) {
    for (const c of i.bankCharges || []) if (!c.reversed && inMonth(mistBusinessDate(c.at))) pair(mistBusinessDate(c.at), `银行扣费 ${i.code}`, c.currency, c.amount, ACCOUNTS.fee, ACCOUNTS.receivable, i.code);
    for (const w of i.writeoffs || []) if (!w.reversed && inMonth(mistBusinessDate(w.at))) pair(mistBusinessDate(w.at), `${WRITEOFF_LABEL[w.kind]} ${i.code}`, w.currency, w.amount, w.kind === 'badDebt' ? ACCOUNTS.badDebt : w.kind === 'correction' ? ACCOUNTS.revenue : ACCOUNTS.fee, ACCOUNTS.receivable, i.code);
  }
  for (const p of root.payments || []) if (inMonth(p.date)) pair(p.date, `付款 ${p.payee}${p.ref ? ' ' + p.ref : ''}`, p.currency, Math.abs(p.amount), p.amount >= 0 ? ACCOUNTS.payable : ACCOUNTS.bank, p.amount >= 0 ? ACCOUNTS.bank : ACCOUNTS.payable, p.code);
  for (const f of root.fxRecords || []) if (f.kind === 'settlement' && !f.reversed && inMonth(f.date)) {
    exchange(f.date, `结汇 ${f.code}`, f.code,
      { account: [ACCOUNTS.bank[0], `${ACCOUNTS.bank[1]}-${f.localCurrency === 'CNY' ? '人民币' : f.localCurrency}`], currency: f.localCurrency, amount: f.localAmount },
      { account: [ACCOUNTS.bank[0], `${ACCOUNTS.bank[1]}-${f.currency}`], currency: f.currency, amount: f.amount });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
}
export const VOUCHER_HEADERS = ['日期', '凭证字号', '摘要', '科目编码', '科目名称', '币种', '原币金额', '汇率', '借方金额', '贷方金额', '来源单据'];
export const voucherRow = (l: VoucherLine) => [l.date, l.no, l.summary, l.account, l.accountName, l.currency, l.amount, l.rate ?? '', l.debit ?? '', l.credit ?? '', l.source];
