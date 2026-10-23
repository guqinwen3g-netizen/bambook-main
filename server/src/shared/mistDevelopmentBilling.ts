/**
 * 开发费用与财务交接、最终结案（BB-DEV-9）。
 * - 制作费：每条实物登记行（样品仓库来源为本案版本）记一笔总额，不拆单价；寄样费：每次寄样一笔（BB-DEV-8 寄样记录）。
 * - 费用汇总 = 全部制作费 + 全部寄样费，按原币种分别合计，不折算；归属需求方（客户或内部需求方）。
 * - 公司支出与客户收费分别记录；业务员选择收费项开票，财务只确认应收与核销。
 * - 发票冻结收费明细，待确认和已确认发票均占用收费项，作废后才允许重开。
 */
import type { MistDev, MistInvoice, MistState } from './mistWorkspace';
import { developmentCharged, developmentInitiator } from './mistDevelopmentDomain';

export type MistMakingFee = { sampleId: string; versionId: string; sampleCode: string; form: string; amount: number; currency: string; recordedAt: string; recordedBy: string };
export type MistBillingLine = { kind: 'making' | 'dispatch' | 'expense'; refId: string; versionId: string; versionLabel: string; label: string; amount: number; currency: string };
export type MistBillingTotal = { currency: string; amount: number };
export type MistBillingRequest = {
  id: string; requestedAt: string; requestedBy: string; billTo: string; lines: MistBillingLine[]; totals: MistBillingTotal[];
  state: 'pending' | 'invoiced'; invoiceIds: string[]; invoicedAt?: string; invoicedBy?: string; taskId?: string;
};
export type MistDevelopmentExpense = { id: string; versionId?: string; amount: number; currency: string; description: string; date: string; at: string; actor: string };
export type MistDevelopmentCharge = { id: string; versionIds: string[]; description: string; amount: number; currency: string; evidence: string; at: string; actor: string; voided?: { at: string; actor: string; reason: string } };
export type MistDevelopmentInvoiceRecord = { invoiceId: string; chargeIds: string[]; lines: MistDevelopmentCharge[]; fileIds: string[]; at: string; actor: string };
export type MistDevBilling = {
  makingFees: MistMakingFee[]; expenses?: MistDevelopmentExpense[]; charges?: MistDevelopmentCharge[]; invoices?: MistDevelopmentInvoiceRecord[];
  /** Prior cost-based requests remain readable but cannot produce new invoices. */
  request?: MistBillingRequest; requestHistory?: Array<MistBillingRequest & { withdrawnAt: string; withdrawnBy: string; reason: string }>; settledAt?: string;
};

export const DEVELOPMENT_BILLING_LOCK = '已发起开票，费用已锁定，不能追加实物或寄样';
const cents = (amount: number) => Math.round(amount * 100);
/** 本案全部入库实物（各版本来源），按登记顺序。 */
export function developmentSamplesOf(state: MistState, dev: MistDev) {
  return (state.fulfillment?.samples || []).filter(sample => sample.source.kind === 'version' && sample.source.devId === dev.id && dev.versionIds.includes(sample.source.versionId));
}
export function developmentBillTo(dev: MistDev): string {
  return developmentInitiator(dev.values) === 'internal' ? (dev.values.requester || '').trim() : (dev.customer || '').trim();
}
export function billingTotals(lines: ReadonlyArray<{ amount: number; currency: string }>): MistBillingTotal[] {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.currency, (totals.get(line.currency) || 0) + cents(line.amount));
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, amount: value / 100 }));
}
/** 当前费用明细、按币种合计与未补齐项。 */
export function developmentFeeSummary(state: MistState, dev: MistDev) {
  const lines: MistBillingLine[] = [], missing: string[] = [];
  const label = (versionId: string) => state.versions.find(version => version.id === versionId)?.label || '版本';
  for (const sample of developmentSamplesOf(state, dev)) {
    const versionId = sample.source.kind === 'version' ? sample.source.versionId : '';
    const fee = dev.billing?.makingFees.find(row => row.sampleId === sample.id);
    if (fee) lines.push({ kind: 'making', refId: sample.id, versionId, versionLabel: label(versionId), label: `制作费 · ${sample.form} ${sample.code}`, amount: fee.amount, currency: fee.currency });
    else missing.push(`${label(versionId)} ${sample.form} ${sample.code} 未登记制作费`);
  }
  for (const versionId of dev.versionIds) {
    const version = state.versions.find(row => row.id === versionId);
    for (const dispatch of version?.dispatches || []) {
      if (dispatch.fee) lines.push({ kind: 'dispatch', refId: dispatch.id, versionId, versionLabel: version!.label, label: `寄样费 · ${dispatch.form} ${dispatch.sampleCode} → ${dispatch.recipient}`, amount: dispatch.fee.amount, currency: dispatch.fee.currency });
      else missing.push(`${version!.label} 寄样 ${dispatch.sampleCode} → ${dispatch.recipient} 未登记寄样费`);
    }
  }
  for (const expense of dev.billing?.expenses || []) lines.push({ kind: 'expense', refId: expense.id, versionId: expense.versionId || '', versionLabel: expense.versionId ? label(expense.versionId) : '整案', label: expense.description, amount: expense.amount, currency: expense.currency });
  return { lines, totals: billingTotals(lines), missing };
}
export function developmentBillingInvoices(state: MistState, dev: MistDev): MistInvoice[] {
  return (state.invoices || []).filter(invoice => invoice.devId === dev.id);
}
export function unbilledDevelopmentCharges(state: MistState, dev: MistDev): MistDevelopmentCharge[] {
  const used = new Set((dev.billing?.invoices || []).filter(record => {
    const invoice = state.invoices.find(row => row.id === record.invoiceId);
    return !invoice || !invoice.voidedAt;
  }).flatMap(record => record.chargeIds));
  return (dev.billing?.charges || []).filter(charge => !charge.voided && !used.has(charge.id));
}
/** 财务结清只描述收费状态，不决定开发业务是否完成。 */
export function developmentBillingSettled(state: MistState, dev: MistDev): boolean {
  const invoices = developmentBillingInvoices(state, dev);
  const active = invoices.filter(invoice => !invoice.voidedAt);
  return !unbilledDevelopmentCharges(state, dev).length && active.length > 0 && active.every(invoice => invoice.financeStatus !== 'pending' && invoice.financeStatus !== 'rejected' && invoice.open <= 0);
}
export function makingFeeBlocker(state: MistState, dev: MistDev, sampleId: string): string | null {
  if (dev.closure?.kind === 'cancelled') return '开发案已取消';
  if (!developmentSamplesOf(state, dev).some(sample => sample.id === sampleId)) return '请选择本案的准确实物';
  if (dev.billing?.makingFees.some(row => row.sampleId === sampleId)) return '本实物制作费已登记，不能覆盖';
  return null;
}
export function billingRequestBlocker(state: MistState, dev: MistDev): string | null {
  if (!developmentCharged(dev.values)) return '不收费开发认可即结案，不开票';
  if (dev.closure?.kind === 'cancelled') return '开发案已取消';
  if (dev.billing?.request) return '已发起开票';
  if (!developmentBillTo(dev)) return '缺少费用归属的需求方';
  const summary = developmentFeeSummary(state, dev);
  if (summary.missing.length) return `费用尚未补齐：${summary.missing.join('；')}`;
  if (!summary.lines.length) return '尚无可开票费用';
  return null;
}
/** 开发案费用与开票阶段（展示用）。 */
export function developmentBillingStage(state: MistState, dev: MistDev): { label: string; tone: 'neutral' | 'warn' | 'accent' | 'ok' } | null {
  if (!developmentCharged(dev.values)) return null;
  if (dev.billing?.request?.state === 'pending') return { label: '待核对收费', tone: 'warn' };
  if (unbilledDevelopmentCharges(state, dev).length) return { label: '待开票', tone: 'warn' };
  const invoices = developmentBillingInvoices(state, dev).filter(row => !row.voidedAt);
  if (invoices.some(row => row.financeStatus === 'pending')) return { label: '待财务确认', tone: 'accent' };
  if (!invoices.length) return { label: '未登记收费', tone: 'neutral' };
  return developmentBillingSettled(state, dev) ? { label: '已结清', tone: 'ok' } : { label: '待收款', tone: 'accent' };
}
