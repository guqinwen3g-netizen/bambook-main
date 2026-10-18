/**
 * 期初未结应收：系统启用前已开票、截至启用日仍未收回的客户欠款，逐笔登记为应收票据。
 * 期初应收没有系统内订单，直接归属客户；与普通应收一样参与收款核销、催收、对账单、账龄、逾期风险与期末调汇。
 * 只登记未收余额（票面金额仅作参考）；未核销、未抵扣时可作废重登。
 */
import { MistCommandError, mistMoneyMinor, type MistContext, type MistInvoice, type MistState } from './mistWorkspace';
import { platformBusinessDate } from './mistPlatform';
import { mistImportDate, mistImportEach, text, type MistImportRow } from './mistImport';

export type MistOpeningInfo = { originalAmount: number; note: string; registeredAt: string; registeredBy: string; registeredById?: string };
export type OpeningCommand =
  | { type: 'opening.receivable.import'; payload: { rows: MistImportRow[] } }
  | { type: 'opening.receivable.void'; payload: { invoiceId: string; reason: string } };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message); };

export function openingCommandPermission(command: OpeningCommand): string {
  if (command.type === 'opening.receivable.import' || command.type === 'opening.receivable.void') return 'invoices:write';
  return fail('未知期初操作');
}

/** 票据归属客户：期初应收直接记客户，开发费用按开发案，其余按订单。 */
export function mistInvoiceCustomerId(root: Pick<MistState, 'orders' | 'devs'>, invoice: Pick<MistInvoice, 'orderId'> & { devId?: string; customerId?: string }): string | undefined {
  if (invoice.customerId) return invoice.customerId;
  if (invoice.devId) return root.devs.find(d => d.id === invoice.devId)?.customerId || undefined;
  return root.orders.find(o => o.id === invoice.orderId)?.customerId;
}
export const isOpeningInvoice = (invoice: { opening?: unknown }) => !!invoice.opening;

function amountOf(value: string, label: string): number {
  const v = value.replace(/,/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) fail(`${label}须为最多两位小数的金额`);
  const n = Number(v); mistMoneyMinor(n); return n;
}

export function applyOpeningCommand(state: MistState, command: OpeningCommand, context: MistContext) {
  const today = platformBusinessDate(context.now);
  if (command.type === 'opening.receivable.import') {
    const created: string[] = [];
    const result = mistImportEach('openingReceivable', command.payload?.rows, (row: MistImportRow) => {
      const key = text(row, 'customer'), lower = key.toLowerCase();
      const byCode = state.customers.find(c => c.code.toLowerCase() === lower), byName = state.customers.filter(c => c.name === key);
      const customer = byCode || (byName.length === 1 ? byName[0] : undefined);
      if (!customer) throw new Error(byName.length > 1 ? `客户“${key}”有重名，请改填客户编码` : `客户“${key}”未建档，请先导入客户`);
      const reference = text(row, 'reference');
      if (reference.length > 60) throw new Error('原发票号过长');
      const same = state.invoices.find(i => i.code.toLowerCase() === reference.toLowerCase());
      if (same) throw new Error(same.voidedAt ? `发票号 ${reference} 已存在（作废的登记保留原号留痕，重登请加后缀，如 ${reference}-R）` : `发票号 ${reference} 已存在`);
      const issuedAt = mistImportDate(text(row, 'issuedAt'), '开票日期'), due = mistImportDate(text(row, 'due'), '到期日');
      if (issuedAt > today) throw new Error('开票日期不能晚于今天（期初只登记已开出的发票）');
      if (due < issuedAt) throw new Error('到期日不能早于开票日期');
      const currency = text(row, 'currency').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('币种须为三位字母');
      const amount = amountOf(text(row, 'amount'), '未收余额');
      if (amount <= 0) throw new Error('未收余额须大于 0；已收清的发票不必登记');
      const originalAmount = text(row, 'originalAmount') ? amountOf(text(row, 'originalAmount'), '票面金额') : amount;
      if (mistMoneyMinor(originalAmount) < mistMoneyMinor(amount)) throw new Error('未收余额不能大于票面金额');
      const note = text(row, 'note').slice(0, 500), id = context.id();
      const invoice: MistInvoice & { customerId: string; opening: MistOpeningInfo } = {
        id, code: reference, orderId: '', order: '期初', customer: customer.name, customerId: customer.id, due, amount, open: amount, currency, issuedAt, financeStatus: 'confirmed',
        financeConfirmedAt: context.now, financeConfirmedBy: context.actorName, ...(context.actorId ? { financeConfirmedById: context.actorId } : {}),
        opening: { originalAmount, note, registeredAt: context.now, registeredBy: context.actorName, ...(context.actorId ? { registeredById: context.actorId } : {}) },
      };
      state.invoices.push(invoice);
      created.push(id);
      state.events.unshift({ id: context.id(), entityType: 'invoice', entityId: id, actor: context.actorName, at: context.now, text: `登记期初应收 ${reference} · ${customer.name} · 未收 ${amount} ${currency}`, fileIds: [] });
    }, message => fail(message));
    return { ...result, ids: created };
  }
  if (command.type === 'opening.receivable.void') {
    const invoice = state.invoices.find(i => i.id === command.payload?.invoiceId) as (MistInvoice & { opening?: MistOpeningInfo }) | undefined;
    if (!invoice) return fail('期初应收不存在');
    if (!invoice.opening) return fail('只能作废期初登记的应收；业务应收请按原单据处理', 'PRECONDITION');
    if (invoice.voidedAt) return fail('该期初应收已作废', 'PRECONDITION');
    const reason = typeof command.payload.reason === 'string' ? command.payload.reason.trim() : '';
    if (!reason || reason.length > 500) return fail('请填写作废原因');
    if (state.allocations.some(a => a.invoiceId === invoice.id)) return fail('已有收款核销，须先冲回核销再作废', 'PRECONDITION');
    if ((state.platform?.creditApplications || []).some(a => a.invoiceId === invoice.id)) return fail('已有贷项抵扣，不能作废', 'PRECONDITION');
    Object.assign(invoice, { voidedAt: context.now, voidReason: reason, voidedBy: context.actorName, ...(context.actorId ? { voidedById: context.actorId } : {}), open: 0 });
    state.events.unshift({ id: context.id(), entityType: 'invoice', entityId: invoice.id, actor: context.actorName, at: context.now, text: `作废期初应收 ${invoice.code}：${reason}`, fileIds: [] });
    return { id: invoice.id };
  }
  return fail('未知期初操作');
}
