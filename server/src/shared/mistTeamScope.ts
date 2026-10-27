/**
 * 小组协作范围（docs/design/03-业务规则/公司-部门-小组与数据范围-2026-10-28.md §3.2–§3.5，P2）。
 *
 * - 小组身份来自人事小组（Team，经部门归属本公司）；本模块只存“范围条件”，不存组员、不存组长。
 * - 范围 = 若干条件（客户 × 业务线 × 季节 × 供应商/工厂）∪ 手选业务，减去排除；条件是动态的，每次读取按当前业务实时匹配。
 * - 业务链（§3.4）按现有来源关系实时推导，单据上不另存“所属小组”：
 *   向下全覆盖（逐层）、向上只读（不扩散到兄弟分支）、订单整单为单位、条件看节点自身字段、排除切断只经由它进入的下游。
 * - 本期只负责存储、匹配、推导与预览；按范围裁剪读写（含共用单据的部分遮罩、内部供料只见分配记录）在 P3。
 */
import { MistCommandError, type MistContext, type MistState } from './mistWorkspace';
import { developmentDomain } from './mistDevelopmentDomain';

export type TeamScopeLine = 'fabric' | 'garment';
export type TeamScopeNodeKind = 'opportunity' | 'development' | 'quotation' | 'order';
export type TeamScopeRef = { kind: TeamScopeNodeKind; id: string };
/** 一条范围条件；未填的维度表示“不限”。至少要限定一个维度，不允许“全公司”条件。 */
export type TeamScopeCondition = { id: string; customerId?: string; line?: TeamScopeLine; season?: string; supplierId?: string };
export type TeamScopeHistory = { at: string; actorId: string; actorName: string; summary: string; note?: string };
export type MistTeamScope = {
  teamId: string; teamName: string;
  conditions: TeamScopeCondition[]; picks: TeamScopeRef[]; exclusions: TeamScopeRef[];
  updatedAt: string; updatedById: string; updatedBy: string; history: TeamScopeHistory[];
};
export type TeamScopeInput = { teamId: string; conditions: Array<Omit<TeamScopeCondition, 'id'>>; picks: TeamScopeRef[]; exclusions: TeamScopeRef[]; note?: string };
export type TeamScopeCommand = { type: 'teamScope.save'; payload: TeamScopeInput };
/** 本公司在用的人事小组（由服务端按当前公司加载，命令 payload 不能扩大）。 */
export type TeamScopeTeam = { id: string; name: string };
/** 建组、调整范围属人事小组管理；按客户负责人及其上级细分授权见规格 §3.3，随 P3/P4 的部门与业务线主管关系落地。 */
export const teamScopeCommandPermission = (_c: TeamScopeCommand) => 'hr:write';
export const TEAM_SCOPE_LIMITS = { conditions: 50, picks: 500, exclusions: 500, history: 200 } as const;

const KINDS: TeamScopeNodeKind[] = ['opportunity', 'development', 'quotation', 'order'];
const KIND_LABEL: Record<TeamScopeNodeKind, string> = { opportunity: '商机', development: '开发案', quotation: '报价', order: '订单' };
const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'PRECONDITION' ? 409 : 422); };
const key = (kind: string, id: string) => `${kind}:${id}`;
const season = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** 业务链节点（商机、开发案、报价、订单）及其可匹配字段。 */
type ChainNode = { key: string; kind: TeamScopeNodeKind; id: string; code: string; name: string; customerId: string; lines: TeamScopeLine[]; season: string };
export type TeamScopeGraph = { nodes: Map<string, ChainNode>; down: Map<string, Set<string>>; up: Map<string, Set<string>> };

function quotationLines(q: any): TeamScopeLine[] {
  const families = new Set<TeamScopeLine>();
  for (const line of Array.isArray(q?.lines) ? q.lines : []) if (line?.family === 'fabric' || line?.family === 'garment') families.add(line.family);
  return [...families];
}
/** 按现有来源字段建立业务链：上游 → 下游。 */
export function buildTeamScopeGraph(state: MistState): TeamScopeGraph {
  const nodes = new Map<string, ChainNode>(), down = new Map<string, Set<string>>(), up = new Map<string, Set<string>>();
  const add = (node: ChainNode) => nodes.set(node.key, node);
  const link = (from: string, to: string) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    (down.get(from) ?? down.set(from, new Set()).get(from)!).add(to);
    (up.get(to) ?? up.set(to, new Set()).get(to)!).add(from);
  };
  const opportunities: any[] = state.crm?.opportunities ?? [], quotations: any[] = state.market?.quotations ?? [];
  for (const o of opportunities) add({ key: key('opportunity', o.id), kind: 'opportunity', id: o.id, code: '', name: o.title || '', customerId: o.customerId || '', lines: o.domain === 'fabric' || o.domain === 'garment' ? [o.domain] : [], season: '' });
  for (const d of state.devs ?? []) add({ key: key('development', d.id), kind: 'development', id: d.id, code: d.code || '', name: d.name || '', customerId: d.customerId || '', lines: [developmentDomain((d.values ?? {}) as any)], season: season(d.values?.season) });
  for (const q of quotations) add({ key: key('quotation', q.id), kind: 'quotation', id: q.id, code: q.code || '', name: q.code || '', customerId: q.customerId || '', lines: quotationLines(q), season: season(q.season) });
  for (const o of state.orders ?? []) add({ key: key('order', o.id), kind: 'order', id: o.id, code: o.code || '', name: o.customer || '', customerId: o.customerId || '', lines: o.type === 'fabric' || o.type === 'garment' ? [o.type] : [], season: season(o.season) });
  // 商机 → 开发案 / 报价 / 订单（商机上记录的关联）。
  for (const o of opportunities) {
    for (const id of o.devIds ?? []) link(key('opportunity', o.id), key('development', id));
    for (const id of o.quotationIds ?? []) link(key('opportunity', o.id), key('quotation', id));
    for (const id of o.orderIds ?? []) link(key('opportunity', o.id), key('order', id));
  }
  // 开发案 → 报价（条目来源）；报价版本链：旧版本 → 新版本；报价 → 已转订单。
  for (const q of quotations) {
    for (const line of q.lines ?? []) if (line?.sourceDevId) link(key('development', line.sourceDevId), key('quotation', q.id));
    if (q.previousId) link(key('quotation', q.previousId), key('quotation', q.id));
    if (q.convertedOrderId) link(key('quotation', q.id), key('order', q.convertedOrderId));
  }
  // 开发案 / 报价 → 订单（订单条目来源，订单整单为单位）。产品档案是公司共享资料，不作为链路桥梁，避免跨客户扩散。
  for (const line of (state.orderLines ?? []) as any[]) {
    if (line.sourceDevId) link(key('development', line.sourceDevId), key('order', line.orderId));
    if (line.sourceQuotationId) link(key('quotation', line.sourceQuotationId), key('order', line.orderId));
  }
  // 订单 → 索赔补货单。
  for (const o of state.orders ?? []) if (o.replacementSource?.sourceOrderId) link(key('order', o.replacementSource.sourceOrderId), key('order', o.id));
  return { nodes, down, up };
}

/** 订单的下游单据（按 orderId 等来源字段），用于预览统计与 P3 裁剪。共用单据（出运、收款核销、信用证）在 P3 做部分遮罩。 */
export type TeamScopeRecords = Record<string, Set<string>>;
function orderRecords(state: MistState, orderIds: Set<string>): TeamScopeRecords {
  const out: TeamScopeRecords = {}, put = (path: string, id: unknown) => { if (typeof id === 'string' && id) (out[path] ??= new Set()).add(id); };
  const f: any = state.fulfillment ?? {}, p: any = state.platform ?? {}, has = (id: unknown) => typeof id === 'string' && orderIds.has(id);
  const lineOrder = new Map(((state.orderLines ?? []) as any[]).map(line => [line.id, line.orderId]));
  for (const [path, rows] of [['productions', state.productions], ['invoices', state.invoices], ['internalFabricAllocations', state.internalFabricAllocations], ['fulfillment.purchases', f.purchases], ['fulfillment.stock', f.stock], ['fulfillment.documents', f.documents], ['platform.pricing', p.pricing], ['platform.risks', p.risks], ['platform.claims', p.claims], ['platform.claimGoods', p.claimGoods], ['orderFunding.assignments', state.orderFunding?.assignments], ['rfqs', state.rfqs]] as Array<[string, any[] | undefined]>)
    for (const row of rows ?? []) if (has(row?.orderId)) put(path, row.id);
  for (const row of f.qcTasks ?? []) if (row?.source?.kind === 'orderLine' && has(row.source.orderId)) put('fulfillment.qcTasks', row.id);
  for (const row of f.packing ?? []) if (has(lineOrder.get(row?.lineId))) { put('fulfillment.packing', row.id); put('fulfillment.shipments', row.shipmentId); }
  for (const row of state.letterOfCredits ?? [] as any[]) if ((row as any).orderIds?.some(has)) put('letterOfCredits', (row as any).id);
  const purchases = out['fulfillment.purchases'] ?? new Set(), shipments = out['fulfillment.shipments'] ?? new Set(), claims = out['platform.claims'] ?? new Set(), invoices = out['invoices'] ?? new Set();
  for (const row of f.receipts ?? []) if (purchases.has(row?.purchaseId)) put('fulfillment.receipts', row.id);
  for (const row of f.customs ?? []) if (shipments.has(row?.shipmentId)) put('fulfillment.customs', row.id);
  for (const row of f.documents ?? []) if (shipments.has(row?.shipmentId)) put('fulfillment.documents', row.id);
  for (const row of p.credits ?? []) if (claims.has(row?.claimId)) put('platform.credits', row.id);
  for (const row of state.allocations ?? []) if (invoices.has((row as any).invoiceId)) put('receipts', (row as any).receiptId);
  return out;
}

/** 供应商 / 工厂条件命中的合作方单据：采购/加工合同（含其收货）、生产、质检、询价。工厂在生产、质检上记的是名称。 */
function partnerRecords(state: MistState, supplierId: string, orderOk: (orderId: string) => boolean): { records: TeamScopeRecords; orders: Set<string> } {
  const records: TeamScopeRecords = {}, orders = new Set<string>(), f: any = state.fulfillment ?? {};
  const put = (path: string, id: string, orderId?: string) => { (records[path] ??= new Set()).add(id); if (orderId) orders.add(orderId); };
  const name = str((state.market?.suppliers ?? []).find((s: any) => s.id === supplierId)?.name);
  const purchases = new Set<string>();
  for (const row of f.purchases ?? []) if (row.supplierId === supplierId && orderOk(row.orderId)) { put('fulfillment.purchases', row.id, row.orderId); purchases.add(row.id); }
  for (const row of f.receipts ?? []) if (purchases.has(row.purchaseId)) put('fulfillment.receipts', row.id);
  for (const row of state.productions ?? []) if ((row.sourcePurchaseId && purchases.has(row.sourcePurchaseId) || name && str(row.factory) === name) && orderOk(row.orderId)) put('productions', row.id, row.orderId);
  for (const row of f.qcTasks ?? []) if (name && str(row.factory) === name && row.source?.kind === 'orderLine' && orderOk(row.source.orderId)) put('fulfillment.qcTasks', row.id, row.source.orderId);
  for (const row of state.rfqs ?? [] as any[]) if ((row as any).supplierIds?.includes(supplierId) && (!(row as any).orderId || orderOk((row as any).orderId))) put('rfqs', (row as any).id, (row as any).orderId);
  return { records, orders };
}

function nodeMatches(node: ChainNode, c: TeamScopeCondition) {
  if (c.customerId && node.customerId !== c.customerId) return false;
  if (c.line && !node.lines.includes(c.line)) return false;
  if (c.season && node.season !== season(c.season)) return false; // 缺季节不猜：空季节不匹配季节条件
  return true;
}

export type TeamScopeResolution = {
  /** 可协作的业务链节点（kind:id）。 */ collaborate: Set<string>;
  /** 只读可见的上游来源与合作方单据所属订单（kind:id），不含已在 collaborate 中的。 */ readonly: Set<string>;
  /** 协作节点（订单）下游及合作方条件命中的单据，按集合路径。 */ records: TeamScopeRecords;
};
/** 推导一个小组当前的范围（每次读取实时计算）。 */
export function resolveTeamScope(state: MistState, scope: Pick<MistTeamScope, 'conditions' | 'picks' | 'exclusions'>, graph = buildTeamScopeGraph(state)): TeamScopeResolution {
  const excluded = new Set(scope.exclusions.map(ref => key(ref.kind, ref.id)));
  const seeds = new Set<string>(), partner: TeamScopeRecords = {}, partnerOrders = new Set<string>();
  for (const c of scope.conditions) {
    if (c.supplierId) {
      const orderOk = (orderId: string) => { const node = graph.nodes.get(key('order', orderId)); return !!node && nodeMatches(node, { ...c, supplierId: undefined }) && !excluded.has(node.key); };
      const hit = partnerRecords(state, c.supplierId, orderOk);
      for (const [path, ids] of Object.entries(hit.records)) for (const id of ids) (partner[path] ??= new Set()).add(id);
      for (const id of hit.orders) partnerOrders.add(key('order', id));
      continue;
    }
    for (const node of graph.nodes.values()) if (nodeMatches(node, c)) seeds.add(node.key);
  }
  for (const ref of scope.picks) { const k = key(ref.kind, ref.id); if (graph.nodes.has(k)) seeds.add(k); }
  // 向下全覆盖：不经过被排除的节点。
  const collaborate = new Set<string>(), queue = [...seeds].filter(k => !excluded.has(k));
  while (queue.length) { const k = queue.shift()!; if (collaborate.has(k)) continue; collaborate.add(k); for (const next of graph.down.get(k) ?? []) if (!excluded.has(next) && !collaborate.has(next)) queue.push(next); }
  // 向上只读：协作节点的全部上游来源（逐层向上，不向下扩散到兄弟分支）；合作方单据所属订单只读。
  const readonly = new Set<string>(), upQueue = [...collaborate, ...partnerOrders];
  for (const k of partnerOrders) if (!collaborate.has(k)) readonly.add(k);
  while (upQueue.length) { const k = upQueue.shift()!; for (const prev of graph.up.get(k) ?? []) if (!collaborate.has(prev) && !readonly.has(prev)) { readonly.add(prev); upQueue.push(prev); } }
  const orderIds = new Set([...collaborate].filter(k => k.startsWith('order:')).map(k => k.slice(6)));
  const records = orderRecords(state, orderIds);
  for (const [path, ids] of Object.entries(partner)) for (const id of ids) (records[path] ??= new Set()).add(id);
  return { collaborate, readonly, records };
}

export type TeamScopePreview = {
  counts: Record<TeamScopeNodeKind, number>; readonlyCounts: Record<TeamScopeNodeKind, number>;
  /** 按业务线分开的协作节点数（过宽提醒用）。 */ byLine: Record<TeamScopeLine | 'none', number>;
  records: Record<string, number>;
  items: Array<{ kind: TeamScopeNodeKind; id: string; code: string; name: string; access: 'collaborate' | 'readonly' }>;
  warnings: string[];
};
/** 设置时的即时预览：当前匹配结果与明细（明细最多 200 条）；客户整户条件同时含面料与成衣时给出过宽提醒，是否收窄由设置人决定。 */
export function previewTeamScope(state: MistState, scope: Pick<MistTeamScope, 'conditions' | 'picks' | 'exclusions'>): TeamScopePreview {
  const graph = buildTeamScopeGraph(state), resolved = resolveTeamScope(state, scope, graph);
  const zero = () => ({ opportunity: 0, development: 0, quotation: 0, order: 0 }), counts = zero(), readonlyCounts = zero(), byLine = { fabric: 0, garment: 0, none: 0 };
  const items: TeamScopePreview['items'] = [];
  for (const [set, access] of [[resolved.collaborate, 'collaborate'], [resolved.readonly, 'readonly']] as const) for (const k of set) {
    const node = graph.nodes.get(k)!; (access === 'collaborate' ? counts : readonlyCounts)[node.kind]++;
    if (access === 'collaborate') { if (!node.lines.length) byLine.none++; for (const line of node.lines) byLine[line]++; }
    if (items.length < 200) items.push({ kind: node.kind, id: node.id, code: node.code, name: node.name, access });
  }
  const warnings: string[] = [];
  const customers = new Map((state.customers ?? []).map(c => [c.id, c.name]));
  for (const c of scope.conditions) if (c.customerId && !c.line && !c.supplierId) {
    const lines = new Set<TeamScopeLine>();
    for (const node of graph.nodes.values()) if (nodeMatches(node, c)) for (const line of node.lines) lines.add(line);
    if (lines.size > 1) warnings.push(`「${customers.get(c.customerId) || c.customerId}${c.season ? ' · ' + c.season : ''} · 全部」同时包含面料和成衣业务；如只需一条业务线，可改为限定面料或成衣。`);
  }
  return { counts, readonlyCounts, byLine, records: Object.fromEntries(Object.entries(resolved.records).map(([path, ids]) => [path, ids.size])), items, warnings };
}

/** 校验并规范化范围输入（保存与预览共用）。 */
export function normalizeTeamScopeInput(state: MistState, input: unknown, teams: TeamScopeTeam[] | undefined): { team: TeamScopeTeam; scope: Pick<MistTeamScope, 'conditions' | 'picks' | 'exclusions'>; note: string } {
  if (!teams) fail('无法核对小组是否属于本公司，请刷新后重试', 'PRECONDITION');
  const value = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Partial<TeamScopeInput>;
  const team = teams!.find(t => t.id === value.teamId);
  if (!team) fail('请选择本公司在用的小组');
  const list = <T,>(raw: unknown, label: string, max: number): T[] => { if (raw === undefined) return []; if (!Array.isArray(raw)) fail(`${label}格式无效`); if ((raw as unknown[]).length > max) fail(`${label}最多 ${max} 条`); return raw as T[]; };
  const customers = new Set((state.customers ?? []).map(c => c.id)), suppliers = new Set((state.market?.suppliers ?? []).map((s: any) => s.id));
  const seen = new Set<string>();
  const conditions = list<any>(value.conditions, '范围条件', TEAM_SCOPE_LIMITS.conditions).map((raw, index): TeamScopeCondition => {
    const label = `第 ${index + 1} 条范围条件`, c: TeamScopeCondition = { id: '' };
    const customerId = str(raw?.customerId), supplierId = str(raw?.supplierId), s = season(raw?.season), line = raw?.line;
    if (customerId) { if (!customers.has(customerId)) fail(`${label}：客户不存在`); c.customerId = customerId; }
    if (line !== undefined && line !== null && line !== '') { if (line !== 'fabric' && line !== 'garment') fail(`${label}：业务线只能是面料或成衣`); c.line = line; }
    if (s) { if (s.length > 40) fail(`${label}：季节过长`); c.season = s; }
    if (supplierId) { if (!suppliers.has(supplierId)) fail(`${label}：供应商或工厂不存在`); c.supplierId = supplierId; }
    if (!c.customerId && !c.line && !c.supplierId) fail(`${label}：至少要限定客户、业务线或供应商/工厂之一`);
    const sig = JSON.stringify([c.customerId, c.line, c.season, c.supplierId]); if (seen.has(sig)) fail(`${label}与前面的条件重复`); seen.add(sig);
    return c;
  });
  const graph = buildTeamScopeGraph(state);
  const refs = (raw: unknown, label: string) => { const out: TeamScopeRef[] = [], dup = new Set<string>(); for (const ref of list<any>(raw, label, TEAM_SCOPE_LIMITS.picks)) {
    if (!KINDS.includes(ref?.kind)) fail(`${label}：只能选择商机、开发案、报价或订单`);
    const id = str(ref?.id); if (!graph.nodes.has(key(ref.kind, id))) fail(`${label}：${KIND_LABEL[ref.kind as TeamScopeNodeKind]}不存在`);
    if (!dup.has(key(ref.kind, id))) { dup.add(key(ref.kind, id)); out.push({ kind: ref.kind, id }); } } return out; };
  const picks = refs(value.picks, '手选业务'), exclusions = refs(value.exclusions, '排除');
  const excluded = new Set(exclusions.map(r => key(r.kind, r.id)));
  if (picks.some(r => excluded.has(key(r.kind, r.id)))) fail('同一笔业务不能既手选又排除');
  const note = str(value.note); if (note.length > 500) fail('说明最多 500 字');
  return { team: team!, scope: { conditions, picks, exclusions }, note };
}

export function teamScopeSummary(scope: Pick<MistTeamScope, 'conditions' | 'picks' | 'exclusions'>) { return `条件 ${scope.conditions.length} 条、手选 ${scope.picks.length} 笔、排除 ${scope.exclusions.length} 笔`; }

export function applyTeamScopeCommand(state: MistState, command: TeamScopeCommand, context: MistContext & { teams?: TeamScopeTeam[] }) {
  if (command.type !== 'teamScope.save') fail('未知的小组范围命令', 'INVALID_COMMAND');
  const { team, scope, note } = normalizeTeamScopeInput(state, command.payload, context.teams);
  for (const c of scope.conditions) c.id = context.id();
  const scopes = (state.teamScopes ??= []), existing = scopes.find(s => s.teamId === team.id), summary = teamScopeSummary(scope);
  const entry: TeamScopeHistory = { at: context.now, actorId: context.actorId || '', actorName: context.actorName, summary, ...(note ? { note } : {}) };
  const next: MistTeamScope = { teamId: team.id, teamName: team.name, ...scope, updatedAt: context.now, updatedById: context.actorId || '', updatedBy: context.actorName, history: [entry, ...(existing?.history ?? [])].slice(0, TEAM_SCOPE_LIMITS.history) };
  if (existing) Object.assign(existing, next); else scopes.push(next);
  state.events?.unshift({ id: context.id(), entityType: 'teamScope', entityId: team.id, actor: context.actorName, at: context.now, text: `调整小组「${team.name}」协作范围：${summary}${note ? '。' + note : ''}`, fileIds: [] });
  return { teamId: team.id, ...previewTeamScope(state, next).counts };
}
