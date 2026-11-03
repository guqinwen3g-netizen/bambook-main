/**
 * ord19 客户索样申请 / ord18 独立样品费（2026-11-04）。
 * 业务员按客户提单（要什么样、多少、寄到哪里、何时要、是否收费）→ 样品间据单从库存寄出（复用样品寄出流水，
 * 寄出用途为客户确认以外时须写明用途）→ 收费的申请在寄出后由业务员开具样品费发票，进入应收待财务确认。
 * 样品费发票没有订单，回链客户与申请单（invoice.sampleRequestId），核销走开发费同一条“无订单应收”通道。
 */
import { MistCommandError, type MistContext, type MistInvoice, type MistState } from './mistWorkspace';
import { applyFulfillmentCommand } from './mistFulfillment';
import { platformBusinessDate } from './mistPlatform';
import { sampleUnitAllowsDecimal } from './mistDevelopmentDomain';

export type MistSampleRequestFee = { amount: number; currency: string; invoiceId?: string; invoiceCode?: string };
export type MistSampleRequestShipment = { sampleId: string; sampleCode: string; movementId: string; quantity: number; unit: string; carrier: string; trackingNo: string; at: string; actor: string };
export type MistSampleRequest = {
  id: string; code: string; customerId: string; customer: string; orderId?: string; description: string; quantity: number; unit: string;
  recipient: string; address: string; neededBy: string; note: string; fee?: MistSampleRequestFee;
  state: 'open' | 'sent' | 'cancelled'; requesterId: string; requester: string; createdAt: string;
  shipments: MistSampleRequestShipment[]; cancelled?: { reason: string; at: string; actor: string };
};
export type SampleRequestCommand =
  | { type: 'sample.request.save'; payload: { id?: string; customerId: string; orderId?: string; description: string; quantity: number; unit: string; recipient: string; address: string; neededBy: string; note?: string; feeAmount?: number; feeCurrency?: string } }
  | { type: 'sample.request.fulfill'; payload: { id: string; sampleId: string; quantity: number; carrier?: string; trackingNo?: string; sourceLocation?: string; complete: boolean } }
  | { type: 'sample.request.cancel'; payload: { id: string; reason: string } }
  | { type: 'sample.request.invoice'; payload: { id: string; number: string; due: string; fileIds: string[] } };
type Root = MistState & { sampleRequests?: MistSampleRequest[] };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message); };
const text = (v: unknown, label: string, required = true, max = 2000) => { const s = typeof v === 'string' ? v.trim() : ''; if (required && !s) fail(`请填写${label}`); if (s.length > max) fail(`${label}过长`); return s; };
const day = (v: unknown, label: string) => { const s = text(v, label, true, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail(`${label}格式无效`); return s; };
const positive = (v: unknown, label: string) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e9 && Math.abs(v * 10000 - Math.round(v * 10000)) < 1e-6 ? v : fail(`${label}须为大于零的数字`);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** mar18：客户停用即其关系档案归档。 */
const customerArchived = (root: MistState, customerId: string) => (root.market?.relations || []).some(r => r.status === 'archived' && r.customerId === customerId);

export const readSampleRequests = (root: Pick<Root, 'sampleRequests'>) => root.sampleRequests || [];
export const SAMPLE_REQUEST_STATE_LABEL: Record<MistSampleRequest['state'], string> = { open: '待寄出', sent: '已寄出', cancelled: '已取消' };
/** 提单、取消、开票归业务（products:write）；据单寄出归样品间（products:write + sample:room:write 由路由层与岗位共同保证）。 */
export function sampleRequestPermission(command: SampleRequestCommand): string { return command.type === 'sample.request.invoice' ? 'invoices:write' : 'products:write'; }
export const sampleRequestSent = (r: Pick<MistSampleRequest, 'shipments'>) => r.shipments.reduce((n, s) => n + s.quantity, 0);

export function applySampleRequestCommand(root: Root, command: SampleRequestCommand, c: MistContext): { id: string; invoiceId?: string } {
  const list = root.sampleRequests ||= [], p = command.payload as Record<string, unknown>;
  const find = (id: unknown) => list.find(r => r.id === id) || fail('索样申请不存在', 'NOT_FOUND');
  switch (command.type) {
    case 'sample.request.save': {
      const existing = p.id ? find(p.id) : undefined;
      if (existing && existing.state !== 'open') fail('已寄出或已取消的申请不能修改', 'PRECONDITION');
      if (existing?.shipments.length) fail('已部分寄出的申请不能修改', 'PRECONDITION');
      const customer = root.customers.find(x => x.id === p.customerId) || fail('客户不存在', 'NOT_FOUND');
      if (!existing && customerArchived(root, customer.id)) fail('客户已停用，不能新建索样申请', 'PRECONDITION');
      const orderId = typeof p.orderId === 'string' && p.orderId ? p.orderId : undefined;
      if (orderId) { const order = root.orders.find(o => o.id === orderId) || fail('订单不存在', 'NOT_FOUND'); if (order.customerId !== customer.id) fail('订单不属于该客户'); }
      const unit = text(p.unit, '单位', true, 20), quantity = positive(p.quantity, '数量');
      if (!sampleUnitAllowsDecimal(unit) && !Number.isInteger(quantity)) fail(`按${unit}计的样品须为整数`);
      let fee: MistSampleRequestFee | undefined;
      if (p.feeAmount !== undefined && p.feeAmount !== null && p.feeAmount !== 0) {
        const currency = text(p.feeCurrency, '样品费币种', true, 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) fail('样品费币种须为三位英文字母');
        fee = { amount: round2(positive(p.feeAmount, '样品费')), currency };
      }
      const row: MistSampleRequest = {
        id: existing?.id || c.id(), code: existing?.code || `SR-${c.now.slice(0, 4)}-${String(list.length + 1).padStart(4, '0')}`, customerId: customer.id, customer: customer.name, ...(orderId ? { orderId } : {}),
        description: text(p.description, '样品要求'), quantity, unit, recipient: text(p.recipient, '收件人', true, 200), address: text(p.address, '寄送地址', true, 500), neededBy: day(p.neededBy, '需要日期'), note: text(p.note, '备注', false),
        ...(fee ? { fee } : {}), state: 'open', requesterId: existing?.requesterId || c.actorId || '', requester: existing?.requester || c.actorName, createdAt: existing?.createdAt || c.now, shipments: [],
      };
      if (existing) Object.assign(existing, row); else list.unshift(row);
      if (existing && !fee) delete existing.fee;
      if (existing && !orderId) delete existing.orderId;
      root.events.unshift({ id: c.id(), entityType: 'sampleRequest', entityId: row.id, actor: c.actorName, at: c.now, text: `${existing ? '修改' : '提交'}索样申请 ${row.code}：${customer.name} · ${row.description} ${quantity} ${unit}`, fileIds: [] });
      if (!existing) root.tasks.unshift({ id: c.id(), title: `索样 ${row.code} · ${customer.name}：${row.description} ${quantity} ${unit}，${row.neededBy} 前寄出`, due: row.neededBy, done: false, kind: `sample-request:${row.id}`, target: { view: 'samples', section: 'requests', id: row.id }, assigneeIds: [], permission: 'sample:room:write' });
      return { id: row.id };
    }
    case 'sample.request.fulfill': {
      const r = find(p.id);
      if (r.state !== 'open') fail('该申请已寄出或已取消', 'PRECONDITION');
      const sample = root.fulfillment.samples.find(s => s.id === p.sampleId) || fail('样品不存在', 'NOT_FOUND');
      if (sample.unit !== r.unit) fail(`所选样品按${sample.unit}计，申请按${r.unit}计，请选择同单位的样品`);
      const quantity = positive(p.quantity, '寄出数量');
      const before = root.fulfillment.sampleMovements.length;
      applyFulfillmentCommand(root, { type: 'fulfillment.samples.move', payload: { id: sample.id, kind: 'send', sendPurpose: 'other', quantity, person: r.recipient, location: '', destination: r.address, carrier: text(p.carrier, '快递公司', false, 120), trackingNo: text(p.trackingNo, '运单号', false, 120), note: `索样 ${r.code} · ${r.customer}`, ...(typeof p.sourceLocation === 'string' && p.sourceLocation ? { sourceLocation: p.sourceLocation } : {}) } }, c);
      const movement = root.fulfillment.sampleMovements.slice(before).find(m => m.sampleId === sample.id && m.kind === 'send') || fail('寄出未登记');
      r.shipments.push({ sampleId: sample.id, sampleCode: sample.code, movementId: movement.id, quantity, unit: sample.unit, carrier: movement.carrier || '', trackingNo: movement.trackingNo || '', at: c.now, actor: c.actorName });
      if (p.complete === true || sampleRequestSent(r) >= r.quantity) r.state = 'sent';
      if (r.state === 'sent') for (const t of root.tasks) if (t.kind === `sample-request:${r.id}` && !t.done) { t.done = true; t.doneAt = c.now; t.doneBy = c.actorName; }
      root.events.unshift({ id: c.id(), entityType: 'sampleRequest', entityId: r.id, actor: c.actorName, at: c.now, text: `索样 ${r.code} 寄出 ${sample.code} ${quantity} ${sample.unit}${movement.trackingNo ? ' · 运单 ' + movement.trackingNo : ''}${r.state === 'sent' ? '，申请完成' : ''}`, fileIds: [] });
      if (r.state === 'sent' && r.fee && !r.fee.invoiceId && r.requesterId) root.tasks.unshift({ id: c.id(), title: `索样 ${r.code} 已寄出，开具样品费 ${r.fee.amount} ${r.fee.currency}`, due: platformBusinessDate(c.now), done: false, kind: `sample-request-fee:${r.id}`, target: { view: 'samples', section: 'requests', id: r.id }, assigneeIds: [r.requesterId] });
      return { id: r.id };
    }
    case 'sample.request.cancel': {
      const r = find(p.id);
      if (r.state !== 'open') fail('该申请已寄出或已取消', 'PRECONDITION');
      if (r.shipments.length) fail('已部分寄出，请按已寄出数量完成申请', 'PRECONDITION');
      r.state = 'cancelled'; r.cancelled = { reason: text(p.reason, '取消原因', true, 500), at: c.now, actor: c.actorName };
      for (const t of root.tasks) if (t.kind === `sample-request:${r.id}` && !t.done) { t.done = true; t.doneAt = c.now; t.doneBy = c.actorName; }
      root.events.unshift({ id: c.id(), entityType: 'sampleRequest', entityId: r.id, actor: c.actorName, at: c.now, text: `取消索样申请 ${r.code}：${r.cancelled.reason}`, fileIds: [] });
      return { id: r.id };
    }
    case 'sample.request.invoice': {
      const r = find(p.id);
      if (r.state !== 'sent') fail('样品寄出后才能开具样品费', 'PRECONDITION');
      if (!r.fee) fail('该申请不收样品费', 'PRECONDITION');
      if (r.fee!.invoiceId && root.invoices.some(i => i.id === r.fee!.invoiceId && !i.voidedAt)) fail('样品费已开票', 'CONFLICT');
      const number = text(p.number, '发票编号', true, 60), due = day(p.due, '到期日');
      if (root.invoices.some(i => i.code === number)) fail('发票编号已使用', 'CONFLICT');
      const fileIds = Array.isArray(p.fileIds) ? [...new Set(p.fileIds.map(id => { const f = root.files.find(x => x.id === id) || fail('附件不存在', 'NOT_FOUND'); return f.id; }))] : [];
      if (!fileIds.length) fail('请上传核对后的发票原件', 'PRECONDITION');
      const id = c.id();
      const invoice: MistInvoice = { id, code: number, orderId: '', order: r.code, customer: r.customer, customerId: r.customerId, due, amount: r.fee!.amount, open: 0, currency: r.fee!.currency, fileIds, issuedAt: platformBusinessDate(c.now), financeStatus: 'pending', sampleRequestId: r.id };
      root.invoices.push(invoice);
      r.fee = { ...r.fee!, invoiceId: id, invoiceCode: number };
      for (const t of root.tasks) if (t.kind === `sample-request-fee:${r.id}` && !t.done) { t.done = true; t.doneAt = c.now; t.doneBy = c.actorName; }
      root.events.unshift({ id: c.id(), entityType: 'invoice', entityId: id, actor: c.actorName, at: c.now, text: `开具样品费发票 ${number}（索样 ${r.code}），待财务确认`, fileIds: [] });
      root.events.unshift({ id: c.id(), entityType: 'sampleRequest', entityId: r.id, actor: c.actorName, at: c.now, text: `开具样品费发票 ${number}`, fileIds: [] });
      return { id: r.id, invoiceId: id };
    }
  }
  return fail('未知索样操作');
}
