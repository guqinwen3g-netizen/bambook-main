/**
 * 客户在手业务交接（2026-10-18）。业务员离职、调岗或客户重新分配时，由主管（relations:admin）把一个客户整体交给新负责人：
 * - 客户负责人改为新负责人；勾选的进行中订单与未结束商机一并改负责人（审批中的订单内容锁定，审批完成后再交接）；
 * - 这些对象上原负责人名下未完成的待办改派给新负责人；
 * - 给新负责人生成一条“接手客户”待办（3 天内核对在手订单、报价、未收款与联系人）；
 * - 交接记录（原负责人、新负责人、原因、清单）留在客户档案，关系智库与客户页均可追溯。
 * 报价没有单独的负责人字段，跟随客户负责人；未勾选的订单保留原负责人。
 */
import { MistCommandError, type MistContext, type MistCustomer, type MistState } from './mistWorkspace';
import { MIST_BUSINESS_GROUPS, MIST_BUSINESS_GROUP_LABEL, accountOwnedObjects, resolveMember, type MistOwnedObject } from './mistAccounts';

export type MistCustomerHandover = { id: string; at: string; actor: string; fromId: string; from: string; toId: string; to: string; reason: string; orders: string[]; opportunities: string[]; tasks: number };
/** 成员离职 / 调岗：按账号把名下全部负责对象一次交给新负责人（所有者在成员管理办理）。 */
export type MistAccountHandover = { id: string; at: string; actor: string; fromId: string; from: string; toId: string; to: string; reason: string; counts: Partial<Record<MistOwnedObject['kind'], number>>; objects: string[]; tasks: number };
export type HandoverCommand =
  | { type: 'handover.customer'; payload: { customerId: string; toUserId: string; reason: string; orderIds?: string[]; opportunityIds?: string[] } }
  | { type: 'handover.account'; payload: { fromUserId: string; toUserId: string; reason: string } };
/** 客户交接由主管办理；按账号整体交接涉及全部业务对象，权限 null 由仓储层限定为公司所有者（与成员授权一致）。 */
export const handoverCommandPermission = (c: HandoverCommand) => c.type === 'handover.account' ? null : 'relations:admin';
export const MIST_OWNED_KIND_LABEL: Record<MistOwnedObject['kind'], string> = { customer: '客户', order: '订单', development: '开发案', fabric: '面料寻样', opportunity: '商机', supplier: '供应商经手' };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : 422); };
const ids = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String))];
export const customerHandovers = (c: MistCustomer) => (c as MistCustomer & { handovers?: MistCustomerHandover[] }).handovers || [];

/** 可交接的在手对象：未履约完成且未作废/取消的订单（含待收尾款），未结束商机。 */
export function customerHandoverScope(root: MistState, customerId: string) {
  const orders = root.orders.filter(o => o.customerId === customerId && o.state !== '履约完成' && !['void', 'cancelled'].includes(o.governance?.status || ''));
  const opportunities = (root.crm?.opportunities || []).filter(o => o.customerId === customerId && o.stage !== 'won' && o.stage !== 'lost');
  const locked = (o: MistState['orders'][number]) => o.governance?.status === 'pending' || o.governance?.changeDraft?.status === 'pending' || o.governance?.cancellation?.status === 'pending' ? '审批中，审批完成后再交接' : '';
  return { orders, opportunities, locked };
}

/** 账号名下的负责人显示名（取已有记录快照）。 */
function snapshotName(root: MistState, id: string) {
  return [...root.customers, ...root.orders, ...(root.devs || []), ...(root.fabrics || []), ...(root.crm?.opportunities || [])].find(r => r.ownerId === id)?.owner
    || (root.market?.suppliers || []).flatMap(s => MIST_BUSINESS_GROUPS.map(g => s.handlers?.[g])).find(h => h?.id === id)?.name || id;
}
/** 业务记录中出现过的全部负责人账号（含已撤销授权的前成员），用于选择“原负责人”。 */
export function accountOwners(root: MistState): Array<{ id: string; name: string; count: number }> {
  const ids = new Set<string>();
  for (const r of [...root.customers, ...root.orders, ...(root.devs || []), ...(root.fabrics || []), ...(root.crm?.opportunities || [])]) if (r.ownerId) ids.add(r.ownerId);
  for (const s of root.market?.suppliers || []) for (const g of MIST_BUSINESS_GROUPS) if (s.handlers?.[g]?.id) ids.add(s.handlers[g]!.id);
  return [...ids].map(id => ({ id, name: snapshotName(root, id), count: accountOwnedObjects(root, id).length }));
}
/** 整体交接的阻断项：审批中的订单内容锁定（业务员通用，不再按业务组阻断）。 */
export function accountHandoverBlockers(root: MistState, fromId: string, to?: { id: string; name: string; groups: string[] }) {
  const out: string[] = [];
  for (const o of root.orders) if (o.ownerId === fromId && (o.governance?.status === 'pending' || o.governance?.changeDraft?.status === 'pending' || o.governance?.cancellation?.status === 'pending')) out.push(`订单 ${o.code} 审批中，审批完成后再交接`);
  return out;
}
export const accountHandovers = (root: MistState) => (root as MistState & { memberHandovers?: MistAccountHandover[] }).memberHandovers || [];

function applyAccountHandover(root: MistState, p: Extract<HandoverCommand, { type: 'handover.account' }>['payload'], c: MistContext): { id: string } {
  const fromId = typeof p?.fromUserId === 'string' ? p.fromUserId.trim() : '';
  if (!fromId) fail('请选择原负责人');
  const to = resolveMember(c, p.toUserId, '新负责人');
  if (to.id === fromId) fail('新负责人不能与原负责人相同');
  const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
  if (!reason) fail('请填写交接原因');
  if (reason.length > 1000) fail('交接原因过长');
  const owned = accountOwnedObjects(root, fromId);
  const pendingTasks = root.tasks.filter(t => !t.done && t.assigneeIds.includes(fromId));
  if (!owned.length && !pendingTasks.length) fail('该账号名下没有负责对象或未完成待办，无需交接');
  const entry = c.members?.find(m => m.id === to.id);
  const blockers = accountHandoverBlockers(root, fromId, { id: to.id, name: to.name, groups: entry?.groups || [] });
  if (blockers.length) fail(blockers.join('；'), 'PRECONDITION');
  const from = snapshotName(root, fromId);
  const note = `成员交接 · 负责人：${from}→${to.name}：${reason}`;
  const event = (entityType: string, entityId: string) => root.events.unshift({ id: c.id(), entityType, entityId, actor: c.actorName, at: c.now, text: note, fileIds: [] });
  for (const r of root.customers) if (r.ownerId === fromId) { r.ownerId = to.id; r.owner = to.name; event('customer', r.id); }
  for (const r of root.orders) if (r.ownerId === fromId) { r.ownerId = to.id; r.owner = to.name; event('order', r.id); }
  for (const r of root.devs || []) if (r.ownerId === fromId) { r.ownerId = to.id; r.owner = to.name; event('development', r.id); }
  for (const r of root.fabrics || []) if (r.ownerId === fromId) { r.ownerId = to.id; r.owner = to.name; event('fabric', r.id); }
  for (const r of root.crm?.opportunities || []) if (r.ownerId === fromId) { r.ownerId = to.id; r.owner = to.name; }
  for (const s of root.market?.suppliers || []) { let changed = false; for (const g of MIST_BUSINESS_GROUPS) if (s.handlers?.[g]?.id === fromId) { s.handlers[g] = { id: to.id, name: to.name }; changed = true; } if (changed) event('supplier', s.id); }
  for (const t of pendingTasks) t.assigneeIds = [...new Set(t.assigneeIds.map(id => id === fromId ? to.id : id))];
  const counts: MistAccountHandover['counts'] = {};
  for (const o of owned) counts[o.kind] = (counts[o.kind] || 0) + 1;
  const record: MistAccountHandover = { id: c.id(), at: c.now, actor: c.actorName, fromId, from, toId: to.id, to: to.name, reason, counts, objects: owned.map(o => `${o.role} ${o.label}`), tasks: pendingTasks.length };
  ((root as MistState & { memberHandovers?: MistAccountHandover[] }).memberHandovers ||= []).push(record);
  const summary = Object.entries(counts).map(([k, n]) => `${MIST_OWNED_KIND_LABEL[k as MistOwnedObject['kind']]} ${n}`).join('、') || '无负责对象';
  root.events.unshift({ id: c.id(), entityType: 'workspace', entityId: fromId, actor: c.actorName, at: c.now, text: `成员交接：${from}→${to.name}；${summary}；改派待办 ${pendingTasks.length} 条。原因：${reason}`, fileIds: [] });
  const due = new Date(Date.parse(c.now) + 3 * 86400000).toISOString().slice(0, 10);
  root.tasks.unshift({ id: c.id(), title: `接手 ${from} 的业务（${summary}）：核对在手订单、报价、未收款与供应商`, due, done: false, kind: 'account-handover', target: { view: 'relations' }, assigneeIds: [to.id] });
  return { id: record.id };
}

export function applyHandoverCommand(root: MistState, command: HandoverCommand, c: MistContext): { id: string } {
  if (command.type === 'handover.account') return applyAccountHandover(root, command.payload, c);
  if (command.type !== 'handover.customer') return fail('未知交接操作');
  const p = command.payload || ({} as Extract<HandoverCommand, { type: 'handover.customer' }>['payload']);
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
  const heading=fromId===to.id?`在手业务交接给 ${to.name}`:`客户交接：${from || '未指定'}→${to.name}`;
  const summary = `${heading}；订单 ${record.orders.length} 张${record.orders.length ? `（${record.orders.join('、')}）` : ''}、商机 ${record.opportunities.length} 个、改派待办 ${tasks} 条。原因：${reason}`;
  for (const entityId of new Set([customer.id, relation?.id].filter(Boolean) as string[])) root.events.unshift({ id: c.id(), entityType: entityId === customer.id ? 'customer' : 'market.relation', entityId, actor: c.actorName, at: c.now, text: summary, fileIds: [] });
  const due = new Date(Date.parse(c.now) + 3 * 86400000).toISOString().slice(0, 10);
  root.tasks.unshift({ id: c.id(), title: `接手客户 · ${customer.name}`, due, done: false, kind: 'customer-handover', target: { view: 'relations', id: relation?.id || customer.id }, assigneeIds: [to.id] });
  return { id: record.id };
}
