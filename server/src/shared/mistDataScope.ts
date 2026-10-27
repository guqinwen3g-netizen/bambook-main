/**
 * 行级数据范围（公司-部门-小组与数据范围 §2，P3）。
 *
 * 可见业务记录 = 本人（及作为部门领导：本部门与下级部门在职成员）负责或经手的业务 ∪ 所在小组协作范围；
 * 岗位为全公司范围者（老板/管理员/财务/QC/后勤等）不经过本模块。两类来源都按同一条业务链推导（mistTeamScope）：
 * 向下全覆盖、向上只读、订单下游随订单。
 *
 * 档案是公司共享资料（R6）：客户、联系人、供应商、产品、季节、趋势、展会、活动、看册、面料寻样等不裁剪。
 * 未在 SCOPED_COLLECTIONS 列出的业务集合保持模块级权限（应付、出口退税、汇率等财务专业模块，默认只给全公司岗位）。
 */
import type { MistState } from './mistWorkspace';
import { buildTeamScopeGraph, resolveTeamScope, type MistTeamScope, type TeamScopeRef } from './mistTeamScope';

/** 受限账号的数据范围：账号集合为本人 + 部门领导所辖成员；teamIds 为本人所在的在用小组。 */
export type MistDataScope = { userIds: string[]; teamIds: string[] };

/** 受行级范围裁剪的集合（路径 = 状态内位置）。写入校验也只对这些集合生效。 */
export const SCOPED_COLLECTIONS = [
  'crm.opportunities', 'crm.followUps', 'devs', 'versions', 'rounds', 'market.quotations', 'orders', 'orderLines',
  'productions', 'invoices', 'allocations', 'receipts', 'internalFabricAllocations',
  'fulfillment.purchases', 'fulfillment.receipts', 'fulfillment.stock', 'fulfillment.documents', 'fulfillment.qcTasks', 'fulfillment.qcReports', 'fulfillment.samples',
  'fulfillment.packing', 'fulfillment.shipments', 'fulfillment.customs', 'fulfillment.shippingTerms', 'fulfillment.productionFacts',
  'platform.pricing', 'platform.risks', 'platform.claims', 'platform.claimGoods', 'platform.credits', 'platform.creditApplications', 'platform.boms', 'platform.invoiceDrafts', 'platform.assistantDrafts',
  'orderFunding.assignments', 'rfqs', 'letterOfCredits', 'customerStatements',
] as const;
export type ScopedCollection = typeof SCOPED_COLLECTIONS[number];
export type ScopedVisibility = Map<string, Set<string>>;

const get = (state: any, path: string): any[] => { const [a, b] = path.split('.'); const value = b ? state?.[a]?.[b] : state?.[a]; return Array.isArray(value) ? value : []; };
/** 行的主键：多数集合用 id；少数没有 id 的按其来源键识别。 */
export const rowKey = (path: string, row: any): string => path === 'fulfillment.shippingTerms' ? row?.orderId : path === 'fulfillment.productionFacts' ? row?.productionId : row?.id;

/** 计算受限账号在当前状态下可见的记录编号（按集合）。 */
export function scopedVisibility(state: MistState, scope: MistDataScope, includeReadonly = true): ScopedVisibility {
  const users = new Set(scope.userIds), graph = buildTeamScopeGraph(state);
  const ownedCustomers = new Set((state.customers ?? []).filter(c => users.has(c.ownerId)).map(c => c.id));
  // 本人锚点：负责人是本人（或所辖成员）的商机、开发案、订单，及跟进人是本人的客户名下的商机、开发案、报价、订单。
  const picks: TeamScopeRef[] = [];
  for (const o of state.crm?.opportunities ?? []) if (users.has(o.ownerId) || ownedCustomers.has(o.customerId)) picks.push({ kind: 'opportunity', id: o.id });
  for (const d of state.devs ?? []) if (users.has(d.ownerId) || ownedCustomers.has(d.customerId)) picks.push({ kind: 'development', id: d.id });
  for (const q of state.market?.quotations ?? []) if (ownedCustomers.has(q.customerId)) picks.push({ kind: 'quotation', id: q.id });
  for (const o of state.orders ?? []) if (users.has(o.ownerId) || ownedCustomers.has(o.customerId)) picks.push({ kind: 'order', id: o.id });
  const teams = new Set(scope.teamIds), resolutions = [resolveTeamScope(state, { conditions: [], picks, exclusions: [] }, graph)];
  for (const team of (state.teamScopes ?? []) as MistTeamScope[]) if (teams.has(team.teamId)) resolutions.push(resolveTeamScope(state, team, graph));
  const out: ScopedVisibility = new Map(SCOPED_COLLECTIONS.map(path => [path, new Set<string>()]));
  const add = (path: string, id: unknown) => { if (typeof id === 'string' && id) out.get(path)!.add(id); };
  const nodePath = { opportunity: 'crm.opportunities', development: 'devs', quotation: 'market.quotations', order: 'orders' } as const;
  for (const r of resolutions) {
    for (const key of [...r.collaborate, ...(includeReadonly ? r.readonly : [])]) { const node = graph.nodes.get(key); if (node) add(nodePath[node.kind], node.id); }
    for (const [path, ids] of Object.entries(r.records)) if (out.has(path)) for (const id of ids) add(path, id);
  }
  const f: any = state.fulfillment ?? {}, p: any = state.platform ?? {};
  const orders = out.get('orders')!, devs = out.get('devs')!, has = (path: string, id: unknown) => typeof id === 'string' && out.get(path)!.has(id);
  for (const row of state.orderLines ?? []) if (orders.has(row.orderId)) add('orderLines', row.id);
  for (const row of state.versions ?? []) if (devs.has(row.devId)) add('versions', row.id);
  for (const row of state.rounds ?? []) if (devs.has(row.devId)) add('rounds', row.id);
  for (const row of state.allocations ?? []) if (has('invoices', row.invoiceId)) add('allocations', row.id);
  for (const row of f.qcTasks ?? []) if (row.source?.kind === 'version' && devs.has(row.source.devId)) add('fulfillment.qcTasks', row.id);
  for (const row of f.qcReports ?? []) if (has('fulfillment.qcTasks', row.taskId)) add('fulfillment.qcReports', row.id);
  for (const row of f.samples ?? []) { const s = row.source; if (s?.kind === 'version' && devs.has(s.devId) || s?.kind === 'orderLine' && orders.has(s.orderId)) add('fulfillment.samples', row.id); }
  for (const row of f.shipments ?? []) if (row.lines?.some((line: any) => orders.has(line.orderId))) add('fulfillment.shipments', row.id);
  for (const row of f.shippingTerms ?? []) if (orders.has(row.orderId)) add('fulfillment.shippingTerms', row.orderId);
  for (const row of f.productionFacts ?? []) if (has('productions', row.productionId)) add('fulfillment.productionFacts', row.productionId);
  for (const row of p.creditApplications ?? []) if (has('platform.credits', row.creditId)) add('platform.creditApplications', row.id);
  for (const path of ['platform.boms', 'platform.invoiceDrafts', 'platform.assistantDrafts'] as const) for (const row of get(state, path)) if (orders.has(row.orderId)) add(path, row.id);
  // 客户跟进与对账单：本人跟进的客户，或可见业务所属的客户。
  const customers = new Set(ownedCustomers);
  for (const path of ['crm.opportunities', 'devs', 'market.quotations', 'orders'] as const) for (const row of get(state, path)) if (out.get(path)!.has(row.id) && row.customerId) customers.add(row.customerId);
  for (const row of state.crm?.followUps ?? []) if (customers.has(row.customerId) || users.has((row as any).ownerId)) add('crm.followUps', row.id);
  for (const row of get(state, 'customerStatements')) if (customers.has(row.customerId)) add('customerStatements', row.id);
  return out;
}

/** 目标（待办、通知、日历）指向的业务记录；无法对应到受限集合的目标不在此裁剪。 */
const VIEW_COLLECTION: Record<string, ScopedCollection> = {
  'orders/detail': 'orders', 'development/detail': 'devs', 'quotations': 'market.quotations', 'procurement': 'fulfillment.purchases', 'production-board': 'productions',
  'qc-workbench': 'fulfillment.qcTasks', 'shipments': 'fulfillment.shipments', 'claims': 'platform.claims', 'invoices': 'invoices', 'risks': 'platform.risks',
};
const ENTITY_COLLECTION: Record<string, ScopedCollection> = {
  order: 'orders', development: 'devs', dev: 'devs', quotation: 'market.quotations', opportunity: 'crm.opportunities', procurement: 'fulfillment.purchases', purchase: 'fulfillment.purchases',
  production: 'productions', qc: 'fulfillment.qcTasks', shipment: 'fulfillment.shipments', customs: 'fulfillment.customs', claim: 'platform.claims', credit: 'platform.credits', invoice: 'invoices', risk: 'platform.risks', pricing: 'platform.pricing', bom: 'platform.boms',
};

/** 按受限范围裁剪状态（不改原对象）。动态、待办、通知、日历按其指向的记录同步裁剪；本人被指派的待办始终保留。 */
export function applyDataScope(state: MistState, scope: MistDataScope, actorId: string): MistState {
  const visible = scopedVisibility(state, scope), next: any = { ...state };
  for (const path of SCOPED_COLLECTIONS) {
    const [a, b] = path.split('.'), ids = visible.get(path)!, rows = get(state, path);
    if (!rows.length) continue;
    const kept = rows.filter(row => ids.has(rowKey(path, row)));
    if (b) next[a] = { ...next[a], [b]: kept }; else next[a] = kept;
  }
  // 共用单据部分遮罩：出运只列可见订单的条目，信用证只列可见订单。
  if (Array.isArray(next.fulfillment?.shipments)) { const orders = visible.get('orders')!; next.fulfillment = { ...next.fulfillment, shipments: next.fulfillment.shipments.map((row: any) => Array.isArray(row.lines) ? { ...row, lines: row.lines.filter((line: any) => !line.orderId || orders.has(line.orderId)) } : row) }; }
  if (Array.isArray(next.letterOfCredits)) { const orders = visible.get('orders')!; next.letterOfCredits = next.letterOfCredits.map((lc: any) => ({ ...lc, orderIds: (lc.orderIds ?? []).filter((id: string) => orders.has(id)) })); }
  const targetOk = (target?: { view?: string; id?: string }) => { const path = target?.view ? VIEW_COLLECTION[target.view] : undefined; return !path || !target?.id || visible.get(path)!.has(target.id); };
  next.events = (state.events ?? []).filter(event => { const path = ENTITY_COLLECTION[event.entityType]; return !path || visible.get(path)!.has(event.entityId); });
  next.tasks = (state.tasks ?? []).filter(task => task.assigneeIds?.includes(actorId) || targetOk(task.target));
  next.notifications = (state.notifications ?? []).filter(item => targetOk(item.target));
  next.calendar = (state.calendar ?? []).filter(item => targetOk(item.target));
  return next;
}

/** 写入校验：每条改动的受限记录，原有的须本来可见，新建的须建成后可见（不能改看不到的业务，也不能在看不到的业务下新建）。返回第一条越权记录。 */
export function scopedWriteViolation(before: MistState, after: MistState, scope: MistDataScope): { path: string; id: string } | null {
  let pre: ScopedVisibility | undefined, post: ScopedVisibility | undefined;
  for (const path of SCOPED_COLLECTIONS) {
    const left = get(before, path), right = get(after, path);
    if (left === right || !left.length && !right.length) continue;
    const old = new Map(left.map(row => [rowKey(path, row), JSON.stringify(row)]));
    const fresh = new Map(right.map(row => [rowKey(path, row), JSON.stringify(row)]));
    for (const id of new Set([...old.keys(), ...fresh.keys()])) {
      if (old.get(id) === fresh.get(id)) continue;
      if (old.has(id)) { pre ??= scopedVisibility(before, scope, false); if (!pre.get(path)!.has(id)) return { path, id }; }
      else { post ??= scopedVisibility(after, scope, false); if (!post.get(path)!.has(id)) return { path, id }; }
    }
  }
  return null;
}
