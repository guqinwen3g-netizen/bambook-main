/**
 * Monthly voucher export (fin22). Bambook records business facts; the books are kept in the company's accounting software.
 * This turns one month's finance facts into suggested double-entry lines with the common 企业会计准则 account codes, in the
 * column layout accepted by Kingdee / Yonyou voucher import (日期、凭证字、摘要、科目编码、科目名称、币种、原币、汇率、借方、贷方).
 * Accounting staff review and post them; nothing here is a posted ledger. Foreign amounts are converted at the month's
 * registered period rate when there is one, otherwise the CNY columns are left for the bookkeeper.
 */
import { WRITEOFF_LABEL, type MistState } from './mistWorkspace';
import { fxPeriodRateFor } from './mistFxRates';
import { mistBusinessDate } from './mistBusinessClock';

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
  const inMonth = (d: string | undefined) => !!d && d.slice(0, 7) === month;
  for (const i of root.invoices || []) if (!i.voidedAt && i.financeStatus !== 'pending' && i.financeStatus !== 'rejected' && inMonth(i.issuedAt)) pair(i.issuedAt!, `确认应收 ${i.code} ${i.customer}`, i.currency, i.amount, ACCOUNTS.receivable, ACCOUNTS.revenue, i.code);
  const receipts = new Map((root.receipts || []).map(r => [r.id, r]));
  for (const a of root.allocations || []) {
    const r = receipts.get(a.receiptId), i = root.invoices.find(x => x.id === a.invoiceId);
    if (!r || !i || !inMonth(r.date)) continue;
    pair(r.date, `收款核销 ${r.code} → ${i.code}`, a.receiptCurrency || a.currency, a.receiptAmount ?? a.amount, ACCOUNTS.bank, ACCOUNTS.receivable, `${r.code}/${i.code}`);
  }
  for (const r of root.receipts || []) {
    if (!inMonth(r.date)) continue;
    const used = (root.allocations || []).filter(a => a.receiptId === r.id).reduce((n, a) => n + (a.receiptAmount ?? a.amount), 0), left = r2(r.amount - used);
    if (left > 0) pair(r.date, `到账待核销 ${r.code} ${r.payer}`, r.currency, left, ACCOUNTS.bank, ACCOUNTS.advance, r.code);
  }
  for (const i of root.invoices || []) {
    for (const c of i.bankCharges || []) if (!c.reversed && inMonth(mistBusinessDate(c.at))) pair(mistBusinessDate(c.at), `银行扣费 ${i.code}`, c.currency, c.amount, ACCOUNTS.fee, ACCOUNTS.receivable, i.code);
    for (const w of i.writeoffs || []) if (!w.reversed && inMonth(mistBusinessDate(w.at))) pair(mistBusinessDate(w.at), `${WRITEOFF_LABEL[w.kind]} ${i.code}`, w.currency, w.amount, w.kind === 'badDebt' ? ACCOUNTS.badDebt : w.kind === 'correction' ? ACCOUNTS.revenue : ACCOUNTS.fee, ACCOUNTS.receivable, i.code);
  }
  for (const p of root.payments || []) if (inMonth(p.date)) pair(p.date, `付款 ${p.payee}${p.ref ? ' ' + p.ref : ''}`, p.currency, Math.abs(p.amount), p.amount >= 0 ? ACCOUNTS.payable : ACCOUNTS.bank, p.amount >= 0 ? ACCOUNTS.bank : ACCOUNTS.payable, p.code);
  for (const f of root.fxRecords || []) if (f.kind === 'settlement' && !f.reversed && inMonth(f.date)) {
    const no = `记-${String(++seq).padStart(4, '0')}`, booked = rate(f.currency), bookedCny = booked ? r2(f.amount * booked) : null, gain = bookedCny === null ? null : r2(f.localAmount - bookedCny);
    out.push({ date: f.date, no, summary: `结汇 ${f.code}`, account: ACCOUNTS.bank[0], accountName: `${ACCOUNTS.bank[1]}-人民币`, currency: 'CNY', amount: f.localAmount, rate: 1, debit: f.localAmount, credit: null, source: f.code });
    out.push({ date: f.date, no, summary: `结汇 ${f.code}`, account: ACCOUNTS.bank[0], accountName: `${ACCOUNTS.bank[1]}-${f.currency}`, currency: f.currency, amount: f.amount, rate: booked, debit: null, credit: bookedCny, source: f.code });
    if (gain) out.push({ date: f.date, no, summary: `结汇 ${f.code} 汇兑差`, account: ACCOUNTS.fx[0], accountName: ACCOUNTS.fx[1], currency: 'CNY', amount: Math.abs(gain), rate: 1, debit: gain < 0 ? -gain : null, credit: gain > 0 ? gain : null, source: f.code });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
}
export const VOUCHER_HEADERS = ['日期', '凭证字号', '摘要', '科目编码', '科目名称', '币种', '原币金额', '汇率', '借方金额', '贷方金额', '来源单据'];
export const voucherRow = (l: VoucherLine) => [l.date, l.no, l.summary, l.account, l.accountName, l.currency, l.amount, l.rate ?? '', l.debit ?? '', l.credit ?? '', l.source];
