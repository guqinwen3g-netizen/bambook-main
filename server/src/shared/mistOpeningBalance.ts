/**
 * 期初未结应收：系统启用前已开票、截至启用日仍未收回的客户欠款，逐笔登记为应收票据。
 * 期初应收没有系统内订单，直接归属客户；与普通应收一样参与收款核销、催收、对账单、账龄、逾期风险与期末调汇。
 * 只登记未收余额（票面金额仅作参考）；未核销、未抵扣时可作废重登。
 */
import { MistCommandError, mistMoneyMinor, type MistContext, type MistInvoice, type MistState } from './mistWorkspace';
import { platformBusinessDate } from './mistPlatform';
import { mistImportDate, mistImportEach, text, type MistImportRow } from './mistImport';
import { createPayablesState, nextPayableCode, type SupplierBill } from './mistPayables';

export type MistOpeningInfo = { originalAmount: number; note: string; registeredAt: string; registeredBy: string; registeredById?: string };
export type OpeningCommand =
  | { type: 'opening.receivable.import'; payload: { rows: MistImportRow[] } }
  | { type: 'opening.receivable.void'; payload: { invoiceId: string; reason: string } }
  | { type: 'opening.payable.import'; payload: { rows: MistImportRow[] } };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message); };

export function openingCommandPermission(command: OpeningCommand): string {
  if (command.type === 'opening.receivable.import' || command.type === 'opening.receivable.void' || command.type === 'opening.payable.import') return 'invoices:write';
  return fail('未知期初操作');
}

/** 票据归属客户：期初应收直接记客户，开发费用按开发案，其余按订单。 */
export function mistInvoiceCustomerId(root: Pick<MistState, 'orders' | 'devs'>, invoice: Pick<MistInvoice, 'orderId'> & { devId?: string; customerId?: string }): string | undefined {
  if (invoice.customerId) return invoice.customerId;
  if (invoice.devId) return root.devs.find(d => d.id === invoice.devId)?.customerId || undefined;
  return root.orders.find(o => o.id === invoice.orderId)?.customerId;
}
/** 应收所属客户的当前档案名；已开出的票据保留开票时客户名（单据不随改名改写），台账与提醒按当前档案显示。 */
export function mistInvoiceCustomerName(root: Pick<MistState, 'orders' | 'devs' | 'customers'>, invoice: Pick<MistInvoice, 'orderId' | 'customer'> & { devId?: string; customerId?: string }): string {
  const id = mistInvoiceCustomerId(root, invoice);
  return (id && root.customers.find(c => c.id === id)?.name) || invoice.customer;
}
/** 付款方是否与应收客户同名：开票时客户名或当前档案名任一相同即视为同名。 */
export function mistPayerMatchesInvoice(root: Pick<MistState, 'orders' | 'devs' | 'customers'>, invoice: Pick<MistInvoice, 'orderId' | 'customer'> & { devId?: string; customerId?: string }, payer: string): boolean {
  const norm = (v: string) => v.trim().toLocaleLowerCase();
  return [invoice.customer, mistInvoiceCustomerName(root, invoice)].some(name => !!name && norm(name) === norm(payer));
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
  if (command.type === 'opening.payable.import') {
    const root = state as MistState & { payables?: ReturnType<typeof createPayablesState>; market?: { suppliers: Array<{ id: string; code: string; name: string }> } };
    root.payables = root.payables || createPayablesState();
    const bills = root.payables.bills, suppliers = root.market?.suppliers || [], created: string[] = [];
    const result = mistImportEach('openingPayable', command.payload?.rows, (row: MistImportRow) => {
      const key = text(row, 'supplier'), lower = key.toLowerCase();
      const byName = suppliers.filter(s => s.name === key), supplier = suppliers.find(s => s.code.toLowerCase() === lower) || (byName.length === 1 ? byName[0] : undefined);
      if (!supplier) throw new Error(byName.length > 1 ? `供应商“${key}”有重名，请改填供应商编码` : `供应商“${key}”未建档，请先导入供应商`);
      const invoiceNo = text(row, 'invoiceNo');
      if (invoiceNo.length > 80) throw new Error('供应商发票号过长');
      if (bills.some(b => b.state === 'open' && b.supplierId === supplier.id && b.invoiceNo.trim().toLowerCase() === invoiceNo.toLowerCase())) throw new Error(`该供应商的发票号 ${invoiceNo} 已登记过`);
      const invoiceDate = mistImportDate(text(row, 'invoiceDate'), '发票日期'), due = mistImportDate(text(row, 'due'), '到期日');
      if (invoiceDate > today) throw new Error('发票日期不能晚于今天（期初只登记已收到的发票）');
      if (due < invoiceDate) throw new Error('到期日不能早于发票日期');
      const currency = text(row, 'currency').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('币种须为三位字母');
      const amount = amountOf(text(row, 'amount'), '未付余额');
      if (amount <= 0) throw new Error('未付余额须大于 0；已付清的发票不必登记');
      const originalAmount = text(row, 'originalAmount') ? amountOf(text(row, 'originalAmount'), '价税合计') : amount;
      if (mistMoneyMinor(originalAmount) < mistMoneyMinor(amount)) throw new Error('未付余额不能大于价税合计');
      const taxAmount = text(row, 'taxAmount') ? amountOf(text(row, 'taxAmount'), '税额') : 0;
      if (mistMoneyMinor(taxAmount) > mistMoneyMinor(originalAmount)) throw new Error('税额不能大于价税合计');
      const id = context.id(), note = text(row, 'note').slice(0, 500);
      const bill: SupplierBill = { id, code: nextPayableCode('AP', bills, context.now), supplierId: supplier.id, supplier: supplier.name, invoiceNo, invoiceDate, currency, amount, taxAmount, taxRate: '', lines: [], terms: [], due, dueBasis: '期初登记（启用前已收票）', fileIds: [], note: `期初未结应付${note ? '：' + note : ''}`, state: 'open', registeredAt: context.now, registeredBy: context.actorName, opening: { originalAmount } };
      bills.push(bill); created.push(id);
      state.events.unshift({ id: context.id(), entityType: 'payable', entityId: id, actor: context.actorName, at: context.now, text: `登记期初应付 ${invoiceNo}（${supplier.name}）· 未付 ${amount} ${currency}`, fileIds: [] });
    }, message => fail(message));
    return { ...result, ids: created };
  }
  return fail('未知期初操作');
}
