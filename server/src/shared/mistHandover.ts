/**
 * 客户在手业务交接（2026-10-18）。业务员离职、调岗或客户重新分配时，由主管（relations:admin）把一个客户整体交给新负责人：
 * - 客户负责人改为新负责人；勾选的进行中订单与未结束商机一并改负责人（审批中的订单内容锁定，审批完成后再交接）；
 * - 这些对象上原负责人名下未完成的待办改派给新负责人；
 * - 给新负责人生成一条“接手客户”待办（3 天内核对在手订单、报价、未收款与联系人）；
 * - 交接记录（原负责人、新负责人、原因、清单）留在客户档案，关系智库与客户页均可追溯。
 * 报价没有单独的负责人字段，跟随客户负责人；未勾选的订单保留原负责人。
 */
import { MistCommandError, type MistContext, type MistCustomer, type MistState } from './mistWorkspace';
import { resolveMember } from './mistAccounts';

export type MistCustomerHandover = { id: string; at: string; actor: string; fromId: string; from: string; toId: string; to: string; reason: string; orders: string[]; opportunities: string[]; tasks: number };
export type HandoverCommand = { type: 'handover.customer'; payload: { customerId: string; toUserId: string; reason: string; orderIds?: string[]; opportunityIds?: string[] } };
export const handoverCommandPermission = (_c: HandoverCommand) => 'relations:admin';

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : 422); };
const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String))];
export const customerHandovers = (c: MistCustomer) => (c as MistCustomer & { handovers?: MistCustomerHandover[] }).handovers || [];

/** 可交接的在手对象：未履约完成且未作废/取消的订单（含待收尾款），未结束商机。 */
export function customerHandoverScope(root: MistState, customerId: string) {
  const orders = root.orders.filter(o => o.customerId === customerId && o.state !== '履约完成' && !['void', 'cancelled'].includes(o.governance?.status || ''));
  const opportunities = (root.crm?.opportunities || []).filter(o => o.customerId === customerId && o.stage !== 'won' && o.stage !== 'lost');
  const locked = (o: MistState['orders'][number]) => o.governance?.status === 'pending' || o.governance?.changeDraft?.status === 'pending' ? '审批中，审批完成后再交接' : '';
  return { orders, opportunities, locked };
}

export function applyHandoverCommand(root: MistState, command: HandoverCommand, c: MistContext): { id: string } {
  if (command.type !== 'handover.customer') return fail('未知交接操作');
  const p = command.payload || ({} as HandoverCommand['payload']);
  const customer = root.customers.find(x => x.id === p.customerId) || fail('客户不存在', 'NOT_FOUND');
  const to = resolveMember(c, p.toUserId, '新负责人');
  const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
  if (!reason) fail('请填写交接原因');
  if (reason.length > 1000) fail('交接原因过长');
  const scope = customerHandoverScope(root, customer.id);
  const orders = ids(p.orderIds).map(id => scope.orders.find(o => o.id === id) || fail('订单不属于该客户或已完成，不能交接'));
  const opportunities = ids(p.opportunityIds).map(id => scope.opportunities.find(o => o.id === id) || fail('商机不属于该客户或已结束，不能交接'));
  for (const o of orders) { const why = scope.locked(o); if (why) fail(`订单 ${o.code} ${why}`, 'PRECONDITION'); }
  const changedOrders = orders.filter(o => o.ownerId !== to.id), changedOpps = opportunities.filter(o => o.ownerId !== to.id);
  if (customer.ownerId === to.id && !changedOrders.length && !changedOpps.length) fail(`${to.name} 已是该客户及所选业务的负责人`);
  const fromId = customer.ownerId, from = customer.owner;
  // 改派指向这些对象、且由原负责人（客户或所交接订单/商机的负责人）处理的未完成待办。
  const objects = new Set([customer.id, ...changedOrders.map(o => o.id), ...changedOpps.map(o => o.id)]);
  const previous = new Set([fromId, ...changedOrders.map(o => o.ownerId), ...changedOpps.map(o => o.ownerId)].filter(id => id && id !== to.id));
  let tasks = 0;
  for (const t of root.tasks) {
    if (t.done || !(objects.has(t.target?.id || '') || objects.has(t.target?.customerId || ''))) continue;
    if (!t.assigneeIds.some(id => previous.has(id))) continue;
    t.assigneeIds = [...new Set(t.assigneeIds.map(id => previous.has(id) ? to.id : id))]; tasks++;
  }
  customer.ownerId = to.id; customer.owner = to.name;
  for (const o of changedOrders) { root.events.unshift({ id: c.id(), entityType: 'order', entityId: o.id, actor: c.actorName, at: c.now, text: `客户交接 · 负责人：${o.owner || '未指定'}→${to.name}：${reason}`, fileIds: [] }); o.owner = to.name; o.ownerId = to.id; }
  for (const o of changedOpps) { o.owner = to.name; o.ownerId = to.id; }
  const record: MistCustomerHandover = { id: c.id(), at: c.now, actor: c.actorName, fromId, from, toId: to.id, to: to.name, reason, orders: changedOrders.map(o => o.code), opportunities: changedOpps.map(o => o.title), tasks };
  ((customer as MistCustomer & { handovers?: MistCustomerHandover[] }).handovers ||= []).push(record);
  const relation = root.market?.relations?.find(r => r.customerId === customer.id);
  const summary = `客户交接：${from || '未指定'}→${to.name}；订单 ${record.orders.length} 张${record.orders.length ? `（${record.orders.join('、')}）` : ''}、商机 ${record.opportunities.length} 个、改派待办 ${tasks} 条。原因：${reason}`;
  for (const entityId of new Set([customer.id, relation?.id].filter(Boolean) as string[])) root.events.unshift({ id: c.id(), entityType: entityId === customer.id ? 'customer' : 'market.relation', entityId, actor: c.actorName, at: c.now, text: summary, fileIds: [] });
  const due = new Date(Date.parse(c.now) + 3 * 86400000).toISOString().slice(0, 10);
  root.tasks.unshift({ id: c.id(), title: `接手客户 ${customer.name}：核对在手订单、报价、未收款与联系人`, due, done: false, kind: 'customer-handover', target: { view: 'relations', id: relation?.id || customer.id }, assigneeIds: [to.id] });
  return { id: record.id };
}
