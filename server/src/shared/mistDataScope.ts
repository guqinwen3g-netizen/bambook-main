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
import type { OrderCostState } from './mistOrderCost';
import { buildTeamScopeGraph, resolveTeamScope, type MistTeamScope, type TeamScopeRef } from './mistTeamScope';
import { mistInvoiceCustomerId } from './mistOpeningBalance';

/** 受限账号的数据范围：账号集合为本人 + 部门领导所辖成员；teamIds 为本人所在的在用小组。 */
export type MistDataScope = { userIds: string[]; teamIds: string[] };

/** 受行级范围裁剪的集合（路径 = 状态内位置）。写入校验也只对这些集合生效。 */
export const SCOPED_COLLECTIONS = [
  'crm.opportunities', 'crm.followUps', 'devs', 'drafts', 'versions', 'rounds', 'market.quotations', 'orders', 'orderLines',
  'productions', 'invoices', 'allocations', 'receipts', 'internalFabricAllocations',
  'fulfillment.purchases', 'fulfillment.receipts', 'fulfillment.stock', 'fulfillment.stockMovements', 'fulfillment.returnReceipts', 'fulfillment.receivedRecords', 'fulfillment.documents', 'fulfillment.qcTasks', 'fulfillment.qcReports', 'fulfillment.samples', 'fulfillment.sampleMovements',
  'fulfillment.packing', 'fulfillment.shipments', 'fulfillment.customs', 'fulfillment.shippingTerms', 'fulfillment.productionFacts',
  'platform.pricing', 'platform.risks', 'platform.claims', 'platform.claimGoods', 'platform.credits', 'platform.creditApplications', 'platform.boms', 'platform.invoiceDrafts', 'platform.assistantDrafts',
  'orderFunding.assignments', 'rfqs', 'letterOfCredits', 'customerStatements',
  'payments', 'financeReversals', 'bankAccounts', 'fxRecords', 'fxRevaluations', 'exportRebate.claims', 'orderCosts.expenses',
  'payables.bills', 'payables.payments', 'payables.allocations', 'payables.plans', 'payables.requests', 'payables.reversals', 'payables.settlements', 'payables.deductions', 'payables.prepaymentMoves',
] as const;
export type ScopedCollection = typeof SCOPED_COLLECTIONS[number];
export type ScopedVisibility = Map<string, Set<string>>;
const HIDDEN_FILES = Symbol('scoped-hidden-files');
export const scopedHiddenFiles = (state: MistState): Set<string> => (state as any)[HIDDEN_FILES] ?? new Set<string>();

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
  for (const draft of state.drafts ?? []) if (users.has(draft.ownerId ?? '') || users.has(draft.values?.requesterId ?? '') || !!draft.values?.sourceDevId && devs.has(draft.values.sourceDevId)) add('drafts', draft.id);
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
  for (const row of f.sampleMovements ?? []) if (has('fulfillment.samples', row.sampleId)) add('fulfillment.sampleMovements', row.id);
  for (const row of f.returnReceipts ?? []) if (has('platform.claims', row.claimId)) add('fulfillment.returnReceipts', row.id);
  for (const row of f.receivedRecords ?? []) if (has('platform.claimGoods', row.goodsId)) add('fulfillment.receivedRecords', row.id);
  for (const row of f.stockMovements ?? []) if (has('fulfillment.stock', row.stockId) && (!row.materialDelivery?.orderId || orders.has(row.materialDelivery.orderId))) add('fulfillment.stockMovements', row.id);
  for (const row of (state as MistState & { orderCosts?: OrderCostState }).orderCosts?.expenses ?? []) if (row.shares?.length && row.shares.every(share => orders.has(share.orderId))) add('orderCosts.expenses', row.id);

  for (const path of ['platform.boms', 'platform.invoiceDrafts', 'platform.assistantDrafts'] as const) for (const row of get(state, path)) if (orders.has(row.orderId)) add(path, row.id);
  // 客户跟进与对账单：本人跟进的客户，或可见业务所属的客户。
  const customers = new Set(ownedCustomers);
  for (const path of ['crm.opportunities', 'devs', 'market.quotations', 'orders'] as const) for (const row of get(state, path)) if (out.get(path)!.has(row.id) && row.customerId) customers.add(row.customerId);
  for (const row of state.crm?.followUps ?? []) if (customers.has(row.customerId) || users.has((row as any).ownerId)) add('crm.followUps', row.id);
  for (const row of get(state, 'customerStatements')) if (customers.has(row.customerId)) add('customerStatements', row.id);
  // Financial source facts must be provably linked to visible business; mixed bills remain hidden until a safe partial view exists.
  const purchases = out.get('fulfillment.purchases')!, payables: any = state.payables ?? {};
  for (const bill of payables.bills ?? []) if (Array.isArray(bill.lines) && bill.lines.length && bill.lines.every((line: any) => purchases.has(line.purchaseId))) add('payables.bills', bill.id);
  for (const row of payables.plans ?? []) if (purchases.has(row.purchaseId)) add('payables.plans', row.id);
  for (const row of payables.settlements ?? []) if (purchases.has(row.purchaseId)) add('payables.settlements', row.id);
  for (const row of payables.requests ?? []) {
    const hasPurchase = !!row.purchaseId, lines = Array.isArray(row.lines) ? row.lines : [];
    if ((hasPurchase || lines.length > 0) && (!hasPurchase || purchases.has(row.purchaseId)) && lines.every((line: any) => has('payables.bills', line.billId))) add('payables.requests', row.id);
  }
  for (const row of payables.payments ?? []) {
    const allocations = (payables.allocations ?? []).filter((item: any) => item.supplierPaymentId === row.id);
    const sourceVisible = row.purchaseId ? purchases.has(row.purchaseId) : row.requestId ? has('payables.requests', row.requestId) : false;
    if (sourceVisible && allocations.every((item: any) => has('payables.bills', item.billId))) { add('payables.payments', row.id); add('payments', row.paymentId); }
  }
  for (const row of payables.allocations ?? []) if (has('payables.payments', row.supplierPaymentId) && has('payables.bills', row.billId)) add('payables.allocations', row.id);
  for (const row of payables.deductions ?? []) if (has('payables.bills', row.billId) && has('platform.claims', row.claimId)) add('payables.deductions', row.id);
  for (const row of payables.prepaymentMoves ?? []) if (purchases.has(row.purchaseId) && (!row.targetPurchaseId || purchases.has(row.targetPurchaseId))) add('payables.prepaymentMoves', row.id);
  for (const row of payables.reversals ?? []) if (row.kind === 'payment' ? has('payables.payments', row.targetId) : has('payables.allocations', row.targetId)) add('payables.reversals', row.id);
  for (const row of state.platform?.creditApplications ?? []) if (has('platform.creditApplications', row.id) && row.paymentId) add('payments', row.paymentId);
  for (const row of state.financeReversals ?? []) if (row.kind === 'allocation' ? has('invoices', row.invoiceId) : has('payments', row.targetId)) add('financeReversals', row.id);
  for (const row of state.exportRebate?.claims ?? []) if (row.orderIds?.length && row.orderIds.every(id => orders.has(id)) && has('fulfillment.customs', row.customsId)) add('exportRebate.claims', row.id);
  // FX lock and period revaluation facts can cover unrelated orders and have no complete per-order provenance yet.

  return out;
}

/** 目标（待办、通知、日历）指向的业务记录；无法对应到受限集合的目标不在此裁剪。 */
const VIEW_COLLECTION: Record<string, ScopedCollection> = {
  'orders/detail': 'orders', 'development/detail': 'devs', 'quotations': 'market.quotations', 'procurement': 'fulfillment.purchases', 'production-board': 'productions',
  'qc-workbench': 'fulfillment.qcTasks', 'shipments': 'fulfillment.shipments', 'claims': 'platform.claims', 'invoices': 'invoices', 'risks': 'platform.risks',
  'orders': 'orders', 'orders/list': 'orders', 'development/list': 'devs', 'production': 'productions', 'customs': 'fulfillment.customs', 'documents': 'fulfillment.documents',
};
const ENTITY_COLLECTION: Record<string, ScopedCollection> = {
  order: 'orders', development: 'devs', dev: 'devs', quotation: 'market.quotations', opportunity: 'crm.opportunities', procurement: 'fulfillment.purchases', purchase: 'fulfillment.purchases',
  production: 'productions', qc: 'fulfillment.qcTasks', shipment: 'fulfillment.shipments', customs: 'fulfillment.customs', claim: 'platform.claims', credit: 'platform.credits', invoice: 'invoices', risk: 'platform.risks', pricing: 'platform.pricing', bom: 'platform.boms',
};

/** Shared/unassigned money must not expose the original receipt balance in a partial scope. */
function partialReceipt(state: MistState, visible: ScopedVisibility, receiptId: string) {
  const allocations = (state.allocations ?? []).filter(row => row.receiptId === receiptId);
  const visibleInvoices = visible.get('invoices')!;
  const hiddenAllocations = allocations.filter(row => !visibleInvoices.has(row.invoiceId));
  const assignments = (state.orderFunding?.assignments ?? []).filter(row => row.receiptId === receiptId && row.state === 'active');
  const hiddenAssignments = assignments.filter(row => !row.orderId || !visible.get('orders')!.has(row.orderId));
  const receipt = (state.receipts ?? []).find(row => row.id === receiptId);
  return { allocations, hiddenCount: hiddenAllocations.length + hiddenAssignments.length, partial: hiddenAllocations.length > 0 || hiddenAssignments.length > 0 || !!receipt && receipt.remaining > 0 };
}

/** A customer-wide original must never be generated from a scope that omits any of its financial facts. */
export function canGenerateScopedStatement(state: MistState, scope: MistDataScope, customerId: string): boolean {
  const customer = (state.customers ?? []).find(row => row.id === customerId);
  if (!customer) return false;
  const visible = scopedVisibility(state, scope, false);
  if ((state.invoices ?? []).some(row => mistInvoiceCustomerId(state, row) === customerId && !visible.get('invoices')!.has(row.id))) return false;
  const payer = customer.name.trim().toLocaleLowerCase();
  return !(state.receipts ?? []).some(row => row.remaining > 0 && row.payer.trim().toLocaleLowerCase() === payer && (!visible.get('receipts')!.has(row.id) || partialReceipt(state, visible, row.id).partial));
}

/** 按受限范围裁剪状态（不改原对象）。动态、待办、通知、日历按其指向的记录同步裁剪；本人被指派的待办始终保留。 */
export function applyDataScope(state: MistState, scope: MistDataScope, actorId: string): MistState {
  const visible = scopedVisibility(state, scope), next: any = { ...state };
  const hiddenFiles = new Set<string>(), knownFiles = new Set((state.files ?? []).map(file => file.id));
  const hideFiles = (value: unknown): void => { if (typeof value === 'string') { if (knownFiles.has(value)) hiddenFiles.add(value); } else if (Array.isArray(value)) value.forEach(hideFiles); else if (value && typeof value === 'object') Object.values(value).forEach(hideFiles); };
  Object.defineProperty(next, HIDDEN_FILES, { value: hiddenFiles });
  for (const path of SCOPED_COLLECTIONS) {
    const [a, b] = path.split('.'), ids = visible.get(path)!, rows = get(state, path);
    if (!rows.length) continue;
    const kept = rows.filter(row => ids.has(rowKey(path, row)));
    if (b) next[a] = { ...next[a], [b]: kept }; else next[a] = kept;
  }
  next.partialPayableBills = [];
  for (const bill of state.payables?.bills ?? []) {
    const lines = Array.isArray(bill.lines) ? bill.lines : [], shown = lines.filter(line => visible.get('fulfillment.purchases')!.has(line.purchaseId)), hiddenCount = lines.length - shown.length;
    if (shown.length && hiddenCount) { hideFiles(bill); next.partialPayableBills.push({ id:bill.id,code:bill.code,supplier:bill.supplier,currency:bill.currency,lines:shown,hiddenCount,voided:bill.state==='void' }); }
  }
  next.partialExpenses = [];
  for (const expense of (state as MistState & {orderCosts?: OrderCostState}).orderCosts?.expenses ?? []) {
    const shares = Array.isArray(expense.shares) ? expense.shares : [], shown = shares.filter(share => visible.get('orders')!.has(share.orderId)), hiddenCount = shares.length - shown.length;
    if (shown.length && hiddenCount) next.partialExpenses.push({id:expense.id,code:expense.code,category:expense.category,date:expense.date,currency:expense.currency,shares:shown,hiddenCount,voided:!!expense.voided});
  }
  // Partial receipts are separate response-only summaries: never counterfeit original totals or balances.
  next.partialReceipts = [];
  next.receipts = (next.receipts ?? []).filter((receipt: any) => {
    const partial = partialReceipt(state, visible, receipt.id);
    if (!partial.partial) return true;
    const visibleAllocations = partial.allocations.filter(row => visible.get('invoices')!.has(row.invoiceId) && row.currency === receipt.currency);
    const cents = visibleAllocations.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    if (Number.isSafeInteger(cents)) next.partialReceipts.push({ id: receipt.id, code: receipt.code, date: receipt.date, payer: receipt.payer, currency: receipt.currency, visibleAllocatedAmount: cents / 100, hiddenCount: partial.hiddenCount });
    return false;
  });
  // 共用单据部分遮罩：出运只列可见订单的条目，信用证只列可见订单。
  const partialShipmentIds = new Set<string>();
  if (Array.isArray(next.fulfillment?.shipments)) {
    const orders = visible.get('orders')!;
    const shipments = next.fulfillment.shipments.map((row: any) => {
      const lines = Array.isArray(row.lines) ? row.lines : [];
      const visibleLines = lines.filter((line: any) => line.orderId && orders.has(line.orderId));
      const hiddenCount = lines.length - visibleLines.length;
      if (!hiddenCount) return { ...row, lines: visibleLines };
      partialShipmentIds.add(row.id);
      hideFiles(row);
      for (const document of state.fulfillment?.documents ?? []) if ((document as any).shipmentId === row.id) hideFiles(document);
      for (const customs of state.fulfillment?.customs ?? []) if ((customs as any).shipmentId === row.id) hideFiles(customs);
      const { departureEvidence: _evidence, cancelReason: _reason, ...safe } = row;
      return { ...safe, lines: visibleLines, hiddenCount, note: '', fileIds: [], documentDispatches: [] };
    });
    next.fulfillment = { ...next.fulfillment, shipments,
      documents: (next.fulfillment.documents ?? []).filter((row: any) => !partialShipmentIds.has(row.shipmentId)),
      customs: (next.fulfillment.customs ?? []).filter((row: any) => !partialShipmentIds.has(row.shipmentId)) };
  }
  // Frozen full PDFs cannot be partially redacted: expose only visible invoice lines as a separate summary.
  next.partialStatements = [];
  const receiptIds = new Set((next.receipts ?? []).map((row: any) => row.id));
  next.customerStatements = (next.customerStatements ?? []).filter((statement: any) => {
    const sections = statement.snapshot?.sections;
    if (!Array.isArray(sections)) { hideFiles(statement); return false; }
    let hidden = 0, shown = 0;
    const partialSections = sections.map((section: any) => {
      const lines = Array.isArray(section.lines) ? section.lines : [];
      const unapplied = Array.isArray(section.unapplied) ? section.unapplied : [];
      const visibleLines = lines.filter((line: any) => visible.get('invoices')!.has(line.invoiceId));
      const hiddenCount = lines.length - visibleLines.length + unapplied.filter((row: any) => !receiptIds.has(row.receiptId)).length;
      hidden += hiddenCount; shown += visibleLines.length;
      return { currency: section.currency, lines: visibleLines, hiddenCount };
    });
    if (!hidden) return true;
    hideFiles(statement);
    if (shown) next.partialStatements.push({ id: statement.id, customerId: statement.customerId, statementNo: statement.statementNo, asOf: statement.asOf, hiddenCount: hidden, sections: partialSections.filter((section: any) => section.lines.length) });
    return false;
  });
  next.partialLettersOfCredit = [];
  if (Array.isArray(next.letterOfCredits)) {
    const orders = visible.get('orders')!;
    next.letterOfCredits = next.letterOfCredits.filter((lc: any) => {
      const ids = Array.isArray(lc.orderIds) ? lc.orderIds : [], visibleIds = ids.filter((id: string) => orders.has(id)), hiddenCount = ids.length - visibleIds.length;
      if (!hiddenCount) return true;
      hideFiles(lc);
      if (visibleIds.length) next.partialLettersOfCredit.push({ id: lc.id, code: lc.code, lcNo: lc.lcNo, customerId: lc.customerId, customer: lc.customer, currency: lc.currency, orderIds: visibleIds, hiddenCount, cancelled: !!lc.cancelled });
      return false;
    });
  }
  const hasAny = (id: string, paths: string[]) => paths.some(path => visible.get(path)?.has(id));
  const safeReceiptIds = new Set((next.receipts ?? []).map((row: any) => row.id));
  const financePaths = ['invoices', 'allocations', 'payments', 'financeReversals', 'payables.bills', 'payables.payments', 'payables.requests', 'payables.settlements', 'payables.plans', 'payables.allocations', 'payables.reversals'];
  const actualDocuments = new Set((next.fulfillment?.documents ?? []).map((row: any) => row.id));
  const actualCustoms = new Set((next.fulfillment?.customs ?? []).map((row: any) => row.id));
  const targetOk = (target?: { view?: string; id?: string }) => {
    if (!target?.id) return !target?.view || !(target.view in VIEW_COLLECTION || ['payment-vouchers', 'finance', 'crm', 'inventory'].includes(target.view));
    if (target.view === 'payment-vouchers' || target.view === 'finance') return safeReceiptIds.has(target.id) || hasAny(target.id, financePaths);
    if (target.view === 'crm') return hasAny(target.id, ['crm.opportunities', 'crm.followUps']);
    if (target.view === 'inventory') return hasAny(target.id, ['fulfillment.stock']);
    if (target.view === 'shipments' && partialShipmentIds.has(target.id)) return false;
    const path = target.view ? VIEW_COLLECTION[target.view] : undefined;
    return !path || visible.get(path)!.has(target.id);
  };
  next.events = (state.events ?? []).filter(event => {
    if (event.entityType === 'shipment' && partialShipmentIds.has(event.entityId)) return false;
    if (event.entityType === 'finance') return safeReceiptIds.has(event.entityId) || hasAny(event.entityId, financePaths);
    if (event.entityType === 'payment') return hasAny(event.entityId, ['payments']);
    if (event.entityType === 'payable') return hasAny(event.entityId, financePaths);
    if (event.entityType === 'document') return actualDocuments.has(event.entityId);
    if (event.entityType === 'customs') return actualCustoms.has(event.entityId);
    if (event.entityType === 'sample') return hasAny(event.entityId, ['fulfillment.samples']);
    if (event.entityType === 'inventory') return hasAny(event.entityId, ['fulfillment.stock']);
    if (event.entityType === 'orderFunding') return hasAny(event.entityId, ['orderFunding.assignments']);
    if (event.entityType === 'rebate') return hasAny(event.entityId, ['exportRebate.claims']) || (state.exportRebate?.rates ?? []).some(row => row.id === event.entityId);
    if (event.entityType === 'attachment') return false;
    const path = ENTITY_COLLECTION[event.entityType]; return !path || visible.get(path)!.has(event.entityId);
  });
  next.tasks = (state.tasks ?? []).filter(task => task.assigneeIds?.includes(actorId) || targetOk(task.target));
  next.notifications = (state.notifications ?? []).filter(item => targetOk(item.target));
  next.calendar = (state.calendar ?? []).filter(item => targetOk(item.target));
  return next;
}

/** Only the server-derived replacement shipment facts may refresh on an unrelated claim. */
function verifiedReplacementSync(before: any, after: any, state: MistState): boolean {
  if (!Array.isArray(before?.dispositions) || !Array.isArray(after?.dispositions) || before.dispositions.length !== after.dispositions.length) return false;
  const left = structuredClone(before), right = structuredClone(after);
  for (let index = 0; index < left.dispositions.length; index++) {
    const previous = left.dispositions[index], current = right.dispositions[index];
    if (!previous || !current || previous.id !== current.id) return false;
    if (JSON.stringify(previous.replacementShipments) !== JSON.stringify(current.replacementShipments)) {
      const order = (state.orders ?? []).find(row => row.id === current.replacementOrderId && row.replacementSource?.claimId === after.id && row.replacementSource?.dispositionId === current.id);
      const lines = (state.orderLines ?? []).filter(row => row.orderId === order?.id);
      if (!order || lines.length !== 1) return false;
      const facts = (state.fulfillment?.shipments ?? []).filter(shipment => shipment.state === 'departed' && shipment.lines.some(line => line.orderId === order.id && line.lineId === lines[0].id)).map(shipment => ({shipmentId:shipment.id,code:shipment.code,quantity:shipment.lines.filter(line => line.orderId === order.id && line.lineId === lines[0].id).reduce((sum,line)=>sum+line.quantity,0),departedAt:shipment.departedAt}));
      if (JSON.stringify(current.replacementShipments) !== JSON.stringify(facts)) return false;
    }
    delete previous.replacementShipments; delete current.replacementShipments;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Reject common direct-target writes before domain validation or document generation. Approval decisions retain their own assignment rules. */
export function scopedTargetViolation(state: MistState, scope: MistDataScope, command?: {type?: string;payload?: any}, claimId?: string): {path: string; id: string} | null {
  const type = command?.type ?? '', payload = command?.payload ?? {};
  let path: ScopedCollection | undefined, id: unknown;
  if (type.startsWith('finance.account.') || type.startsWith('finance.fx.') || type.startsWith('fxrate.')) return {path:'bankAccounts', id:'company-finance'};
  if (claimId) { path='platform.claims'; id=claimId; }
  else if (['order.update','order.checklist','order.handoff'].includes(type) || type.startsWith('order.governance.') && type !== 'order.governance.decide') { path='orders'; id=payload.orderId; }
  else if (type === 'development.saveDraft' || type === 'development.submit') { path='drafts'; id=payload.draftId; }
  else if (type.startsWith('development.') || type === 'finance.developmentInvoice.issue') { path='devs'; id=payload.devId; }
  else if (['production.move','production.update'].includes(type)) { path='productions'; id=payload.id; }
  else if (type.startsWith('market.quotation.') && type !== 'market.quotation.decide') { path='market.quotations'; id=payload.quotationId ?? payload.id; }
  else if (['finance.receivable.confirm','finance.receivable.reject'].includes(type)) { path='invoices'; id=payload.invoiceId; }
  else if (type === 'platform.credit.issue') { path='platform.credits'; id=payload.creditId; }
  else if (type === 'fulfillment.procurement.document') { path='fulfillment.purchases'; id=payload.id; }
  if (!path || typeof id !== 'string' || !id) return null;
  return scopedVisibility(state, scope, false).get(path)?.has(id) ? null : {path,id};
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
      if (old.has(id)) {
        pre ??= scopedVisibility(before, scope, false);
        const shipment = path === 'fulfillment.shipments' ? get(before, path).find(row => row.id === id) : null;
        const partialShipment = shipment?.lines?.some((line: any) => !line.orderId || !pre!.get('orders')!.has(line.orderId));
        const lc = path === 'letterOfCredits' ? get(before, path).find(row => row.id === id) : null;
        const partialLc = lc?.orderIds?.some((orderId: string) => !pre!.get('orders')!.has(orderId));
        const derivedOnly = path === 'platform.claims' && verifiedReplacementSync(left.find(row => rowKey(path, row) === id), right.find(row => rowKey(path, row) === id), after);
        if ((!pre.get(path)!.has(id) && !derivedOnly) || path === 'receipts' && partialReceipt(before, pre, id).partial || partialShipment || partialLc) return { path, id };
      }
      else { post ??= scopedVisibility(after, scope, false); if (!post.get(path)!.has(id)) return { path, id }; }
    }
  }
  return null;
}
