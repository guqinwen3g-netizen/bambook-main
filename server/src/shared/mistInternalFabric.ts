/** Internal garment supply plans. All facts live in the current Mist workspace. */
import { MistCommandError, type MistContext, type MistState, type MistOrder, type MistOrderLine, type MistCommandResult } from './mistWorkspace';
import { resolveMember } from './mistAccounts';
import { assertOrderApproved, assertOrderWritable, type OrderGovernanceInput, type OrderGovernanceLine } from './mistOrderGovernance';
import { assertOrderLineOpen } from './mistOrderClosure';

export type GarmentFulfillmentMode = 'cmt' | 'trims_cmt' | 'full_package';
export type CmtIncludedItem = 'trims' | 'packaging';
export type MistMaterialKind = 'fabric' | 'trims' | 'packaging' | 'other';
export type GarmentFulfillmentFields = { fulfillmentMode?: GarmentFulfillmentMode; cmtIncludedItems?: CmtIncludedItem[] };
export type InternalSupply = { group: 'garment'; receiverId: string };
export type InternalFabricContext = Pick<MistContext, 'members' | 'actorId' | 'actorName'>;
type AllocationFact = { fabricOrderId: string; fabricLineId: string; metres: string; status: 'active' | 'cancelled'; revision: number; updatedAt: string; updatedBy: string; updatedByName: string };
export type MistInternalFabricAllocation = AllocationFact & { id: string; orderId: string; lineId: string; history: AllocationFact[] };
export type InternalFabricCommand =
  | { type: 'order.fabric.allocate'; payload: { orderId: string; lineId: string; fabricOrderId: string; fabricLineId: string; metres: string; expectedRevision: number } }
  | { type: 'order.fabric.cancel'; payload: { id: string; expectedRevision: number } };
export type InternalFabricCandidate = { fabricOrderId: string; fabricLineId: string; orderCode: string; lineName: string; quantity: string; allocated: string; remaining: string };
/** A physical delivery keeps its destination and allocation revision even when master data changes later. */
export type MaterialDeliveryLink = {
  productionId: string; orderId: string; lineId: string; supplierId: string; supplier: string;
  receiverId: string; receiver: string; allocationId?: string; allocationRevision?: number;
  sourceQcReportIds?: string[];
  confirmation?: { at: string; actorId: string; actor: string; evidence: string };
};
export type MaterialDeliveryRow = { id: string; kind: 'issue' | 'direct'; purchaseId: string; quantity: string; outstanding: string; unit: string; at: string; location: string; evidence: string; delivery: MaterialDeliveryLink };
export const GARMENT_FULFILLMENT_LABELS: Record<GarmentFulfillmentMode, string> = { cmt: '纯 CMT', trims_cmt: '辅料 + CMT', full_package: '全包' };
export const CMT_INCLUDED_ITEM_LABELS: Record<CmtIncludedItem, string> = { trims: '辅料', packaging: '包装' };
export const MATERIAL_KIND_LABELS: Record<MistMaterialKind, string> = { fabric: '面料', trims: '辅料', packaging: '包装', other: '其他原料' };
const fail = (message: string, code = 'PRECONDITION'): never => { throw new MistCommandError(code, message, code === 'FORBIDDEN' ? 403 : 422); };
const identity = (value: unknown, label: string): string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 ? value : fail(`请选择${label}`, 'VALIDATION');
function revision(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('分配版本无效', 'VALIDATION'); return value as number; }
function metresMinor(value: unknown): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d{1,14}(?:\.\d{1,4})?$/.test(String(value))) fail('米数须为正数，最多四位小数', 'VALIDATION');
  const [whole, decimal = ''] = String(value).split('.');
  const result = BigInt(whole) * BigInt(10000) + BigInt(decimal.padEnd(4, '0'));
  if (result <= BigInt(0)) fail('米数须大于零', 'VALIDATION');
  return result;
}
function metresText(value: bigint): string { const fraction = String(value % BigInt(10000)).padStart(4, '0').replace(/0+$/, ''); return String(value / BigInt(10000)) + (fraction ? '.' + fraction : ''); }
export function normalizeInternalMetres(value: unknown): string { return metresText(metresMinor(value)); }
function lineFor(root: MistState, orderId: string, lineId: string) {
  const order = root.orders.find(row => row.id === orderId), line = root.orderLines.find(row => row.id === lineId && row.orderId === orderId);
  if (!order || !line) fail('订单条目不存在', 'NOT_FOUND');
  return { order: order!, line: line! };
}
function actorGroup(context: InternalFabricContext, group: 'fabric' | 'garment') { return resolveMember(context, context.actorId, '经办人', group); }
export function normalizeGarmentFulfillment(input: GarmentFulfillmentFields, required = true): GarmentFulfillmentFields {
  if (input.fulfillmentMode === undefined && input.cmtIncludedItems === undefined && !required) return {};
  if (!['cmt', 'trims_cmt', 'full_package'].includes(String(input.fulfillmentMode))) fail('请选择成衣履约模式', 'VALIDATION');
  if (!Array.isArray(input.cmtIncludedItems) || input.cmtIncludedItems.some(item => item !== 'trims' && item !== 'packaging') || new Set(input.cmtIncludedItems).size !== input.cmtIncludedItems.length) fail('请明确 CMT 包含项目', 'VALIDATION');
  return { fulfillmentMode: input.fulfillmentMode, cmtIncludedItems: [...input.cmtIncludedItems!].sort() };
}
export function normalizeInternalSupply(contract: OrderGovernanceInput, order: Pick<MistOrder, 'type' | 'ownerId'>, context: InternalFabricContext, checkActor = true): OrderGovernanceInput {
  if (!contract.internalSupply) return contract;
  if (contract.kind !== 'internal' || order.type !== 'fabric' || contract.internalSupply.group !== 'garment') fail('内部面料供给须由面料订单建立', 'VALIDATION');
  if (checkActor) actorGroup(context, 'fabric');
  resolveMember(context, order.ownerId, '面料负责人', 'fabric');
  const receiver = resolveMember(context, identity(contract.internalSupply.receiverId, '接收负责人'), '接收负责人', 'garment');
  return { ...contract, internalSupply: { group: 'garment', receiverId: receiver.id }, receiver: `成衣 / ${receiver.name}` };
}
function allocatedMinor(root: MistState, fabricLineId: string, excludeTargetLineId?: string) {
  return (root.internalFabricAllocations || []).filter(row => row.status === 'active' && row.fabricLineId === fabricLineId && row.lineId !== excludeTargetLineId).reduce((sum, row) => sum + metresMinor(row.metres), BigInt(0));
}
export function internalFabricRemaining(root: MistState, fabricLineId: string, excludeTargetLineId?: string): string {
  const line = root.orderLines.find(row => row.id === fabricLineId); if (!line) fail('面料条目不存在', 'NOT_FOUND');
  const remaining = metresMinor(line!.qty) - allocatedMinor(root, fabricLineId, excludeTargetLineId);
  if (remaining < BigInt(0)) fail('累计分配超过面料数量');
  return metresText(remaining);
}
function supplyFor(root: MistState, orderId: string, lineId: string, context: InternalFabricContext) {
  const value = lineFor(root, orderId, lineId), { order, line } = value;
  if (order.type !== 'fabric' || order.governance?.contract.kind !== 'internal' || !order.governance.contract.internalSupply) fail('请选择内部面料供给行');
  assertOrderApproved(root, order.id); assertOrderLineOpen(line);
  normalizeInternalSupply(order.governance!.contract, order, context, false);
  if (!['米', 'm', 'metre', 'metres', 'meter', 'meters'].includes(line.unit.trim().toLowerCase())) fail('内部面料行须使用米数单位');
  internalFabricRemaining(root, line.id);
  return value;
}
/** Candidate availability excludes this target's own current allocation, permitting safe edits. */
export function internalFabricCandidates(root: MistState, orderId: string, lineId: string, context: InternalFabricContext): InternalFabricCandidate[] {
  const target = lineFor(root, orderId, lineId); if (target.order.type !== 'garment') return [];
  actorGroup(context, 'garment'); resolveMember(context, target.order.ownerId, '成衣负责人', 'garment');
  return root.orderLines.flatMap(line => {
    try { const { order } = supplyFor(root, line.orderId, line.id, context), quantity = metresMinor(line.qty), allocated = allocatedMinor(root, line.id, lineId); return [{ fabricOrderId: order.id, fabricLineId: line.id, orderCode: order.code, lineName: `${line.style} · ${line.name}`, quantity: metresText(quantity), allocated: metresText(allocated), remaining: metresText(quantity - allocated) }]; }
    catch (error) { if (error instanceof MistCommandError) return []; throw error; }
  });
}
/** Finished garment contracts mean the supplier supplies materials and manufacturing. */
export function garmentFinishedPurchases(root: MistState, orderId: string, lineId: string) {
  return (root.fulfillment?.purchases || []).filter(p => p.orderId === orderId && p.lineId === lineId && p.kind === 'finished' && p.state !== 'cancelled');
}
export function assertGarmentMaterial(root: MistState, orderId: string, lineId: string, context: InternalFabricContext): void {
  const { order, line } = lineFor(root, orderId, lineId); if (order.type !== 'garment') return;
  const mode = normalizeGarmentFulfillment(line);
  if (mode.fulfillmentMode !== 'full_package') return;
  const finished=garmentFinishedPurchases(root,orderId,lineId);
  if(finished.length){if(!finished.some(p=>p.state==='approved'))fail('全包成品采购尚未批准');return;}
  resolveMember(context, order.ownerId, '成衣负责人', 'garment');
  const rows = (root.internalFabricAllocations || []).filter(row => row.lineId === lineId && row.status === 'active');
  if (rows.length !== 1 || rows[0].orderId !== orderId) fail('全包条目须先分配内部面料');
  const row = rows[0]; supplyFor(root, row.fabricOrderId, row.fabricLineId, context); metresMinor(row.metres);
}
/** A PP sample records the approved material plan it was made against; later changes cannot reuse that proof. */
export function garmentMaterialFingerprint(root: MistState, orderId: string, lineId: string): string {
  const {order,line}=lineFor(root,orderId,lineId);
  if(order.type!=='garment'||line.fulfillmentMode!=='full_package')return '';
  const finished=garmentFinishedPurchases(root,orderId,lineId).filter(p=>p.state==='approved');
  if(finished.length)return JSON.stringify({mode:'supplier_full_package',contracts:finished.map(p=>({id:p.id,supplierId:p.supplierId,description:p.description,note:p.note,fileIds:[...p.fileIds].sort()})).sort((a,b)=>a.id.localeCompare(b.id))});
  const allocation=(root.internalFabricAllocations||[]).find(row=>row.orderId===orderId&&row.lineId===lineId&&row.status==='active');
  if(!allocation)fail('全包条目须先分配内部面料');
  const source=lineFor(root,allocation!.fabricOrderId,allocation!.fabricLineId);
  const fabric = source.line as MistOrderLine & Partial<OrderGovernanceLine>;
  // Price, payment and source capacity changes do not alter the physical sample.
  // Fresh approval, membership and remaining capacity are checked separately at every gate.
  return JSON.stringify({mode:line.fulfillmentMode,included:line.cmtIncludedItems,allocationId:allocation!.id,revision:allocation!.revision,metres:allocation!.metres,sourceOrderId:source.order.id,sourceLineId:source.line.id,fabric:{name:fabric.name,style:fabric.style,unit:fabric.unit,sourceProductId:fabric.sourceProductId,sourceDevId:fabric.sourceDevId,sourceVersionId:fabric.sourceVersionId,breakdown:fabric.breakdown}});
}
export function garmentMaterialBlocker(root: MistState, orderId: string, lineId: string, context: InternalFabricContext): string {
  try { assertGarmentMaterial(root, orderId, lineId, context); return ''; } catch (error) { if (error instanceof MistCommandError) return error.message; throw error; }
}
/** Material classification is a stored business field, never inferred from a description. */
export function assertGarmentProcurement(order: Pick<MistOrder, 'type'> & {id?:string}, line: GarmentFulfillmentFields & {id?:string}, kind: string, materialKind: unknown, root?:MistState, purchaseId?:string): MistMaterialKind | undefined {
  if (order.type === 'garment' && kind === 'finished' && normalizeGarmentFulfillment(line).fulfillmentMode !== 'full_package') fail('仅全包条目可采购成衣成品');
  if(order.type==='garment'&&root&&order.id&&line.id){
    const others=(root.fulfillment?.purchases||[]).filter(p=>p.orderId===order.id&&p.lineId===line.id&&p.id!==purchaseId&&p.state!=='cancelled');
    if(kind==='finished'){
      if((root.internalFabricAllocations||[]).some(a=>a.orderId===order.id&&a.lineId===line.id&&a.status==='active'))fail('已有内部供料，不能重复采购全包成品');
      if(others.some(p=>p.kind!=='finished'))fail('已有物料或加工采购，不能混用全包成品采购');
    }else if(others.some(p=>p.kind==='finished'))fail('已有全包成品采购，不能重复采购物料或加工服务');
  }
  if (kind !== 'material') {
    if (materialKind !== undefined) fail('仅物料采购填写物料类别', 'VALIDATION');
    if (order.type === 'garment') normalizeGarmentFulfillment(line);
    return undefined;
  }
  if (!['fabric', 'trims', 'packaging', 'other'].includes(String(materialKind))) fail('请选择物料类别', 'VALIDATION');
  if (order.type === 'garment') {
    const mode = normalizeGarmentFulfillment(line);
    if (materialKind !== 'trims' && materialKind !== 'packaging') fail('成衣面料须由面料组供给');
    if (mode.fulfillmentMode === 'cmt') fail('纯 CMT 不另行采购物料');
    if (mode.cmtIncludedItems!.includes(materialKind as CmtIncludedItem)) fail('CMT 已包含此项，不能重复采购');
  }
  return materialKind as MistMaterialKind;
}
/** Drafts cannot remove/relax an already committed allocation or duplicate existing material costs. */
export function assertInternalFabricOrderChange(root: MistState, order: MistOrder, lines: OrderGovernanceLine[], contract: OrderGovernanceInput): void {
  const active = (root.internalFabricAllocations || []).filter(row => row.status === 'active');
  for (const row of active.filter(row => row.fabricOrderId === order.id)) {
    const line = lines.find(value => value.id === row.fabricLineId);
    if (!line || !contract.internalSupply || contract.kind !== 'internal' || !['米', 'm', 'metre', 'metres', 'meter', 'meters'].includes(line.unit.trim().toLowerCase())) fail('请先取消受影响的面料分配');
    if (metresMinor(line!.qty) < allocatedMinor(root, row.fabricLineId)) fail('面料数量不得低于已分配米数');
    if (materialDeliveryRows(root).some(item => item.delivery.allocationId === row.id && item.outstanding !== '0')) {
      const current = root.orderLines.find(l => l.id === row.fabricLineId);
      if (!current) fail('面料来源不存在');
      const physical = (value: unknown) => { const l = value as OrderGovernanceLine; return JSON.stringify([l.unit, l.sourceProductId || '', l.sourceDevId || '', l.sourceVersionId || '', l.breakdown || null]); };
      if (physical(current) !== physical(line)) fail('已有实际交接，不能改写面料来源或规格');
    }
  }
  for (const row of active.filter(row => row.orderId === order.id)) if (lines.find(line => line.id === row.lineId)?.fulfillmentMode !== 'full_package') fail('请先取消该条目的面料分配');
  for (const purchase of (root.fulfillment?.purchases || []).filter(purchase => purchase.orderId === order.id && purchase.state !== 'cancelled')) {
    const line = lines.find(value => value.id === purchase.lineId); if (!line) continue;
    // Unknown legacy classifications are not silently upgraded; a material/mode change must resolve them.
    const previous = root.orderLines.find(value => value.id === line.id);
    if (previous?.fulfillmentMode !== line.fulfillmentMode || JSON.stringify(previous?.cmtIncludedItems) !== JSON.stringify(line.cmtIncludedItems)) assertGarmentProcurement(order, line, purchase.kind, purchase.materialKind);
  }
}
export function internalFabricCommandPermission(command: InternalFabricCommand) {
  if (command.type !== 'order.fabric.allocate' && command.type !== 'order.fabric.cancel') fail('未知面料分配操作', 'VALIDATION');
  return 'orders:write';
}
export function applyInternalFabricCommand(root: MistState, command: InternalFabricCommand, context: MistContext): MistCommandResult {
  internalFabricCommandPermission(command); actorGroup(context, 'garment');
  const rows = root.internalFabricAllocations || (root.internalFabricAllocations = []);
  if (command.type === 'order.fabric.cancel') {
    const input = command.payload, row = rows.find(value => value.id === identity(input.id, '面料分配'));
    if (!row || row.status !== 'active') fail('有效分配不存在', 'NOT_FOUND');
    if (materialDeliveryRows(root).some(item => item.delivery.allocationId === row!.id && item.outstanding !== '0')) fail('面料已实际交接，请先按原交接退回');
    const target = lineFor(root, row!.orderId, row!.lineId); assertOrderWritable(target.order); assertOrderLineOpen(target.line);
    if (target.order.governance?.status === 'pending' || target.order.governance?.changeDraft?.status === 'pending') fail('审批中不能调整面料分配');
    if (row!.revision !== revision(input.expectedRevision)) fail('分配已变化，请刷新', 'CONFLICT');
    const { id: _id, orderId: _order, lineId: _line, history: _history, ...previous } = row!;
    row!.history.push(previous); row!.revision++; row!.status = 'cancelled'; row!.updatedAt = context.now; row!.updatedBy = context.actorId!; row!.updatedByName = context.actorName;
    root.events.unshift({ id: context.id(), entityType: 'order', entityId: row!.orderId, actor: context.actorName, at: context.now, text: '取消内部面料分配', fileIds: [] });
    return { id: row!.id, orderId: row!.orderId, lineId: row!.lineId, revision: row!.revision };
  }
  const input = command.payload, target = lineFor(root, identity(input.orderId, '成衣订单'), identity(input.lineId, '成衣条目'));
  assertOrderWritable(target.order); assertOrderLineOpen(target.line);
  if (target.order.type !== 'garment' || normalizeGarmentFulfillment(target.line).fulfillmentMode !== 'full_package') fail('只有全包条目分配内部面料');
  if(garmentFinishedPurchases(root,target.order.id,target.line.id).length)fail('已有全包成品采购，不能重复分配内部面料');
  resolveMember(context, target.order.ownerId, '成衣负责人', 'garment');
  if (target.order.governance?.status === 'pending' || target.order.governance?.changeDraft?.status === 'pending') fail('审批中不能调整面料分配');
  const supply = supplyFor(root, identity(input.fabricOrderId, '面料订单'), identity(input.fabricLineId, '面料条目'), context);
  const found = rows.filter(row => row.lineId === target.line.id); if (found.length > 1) fail('分配记录冲突');
  if (typeof input.metres !== 'string') fail('米数须按十进制填写', 'VALIDATION');
  const row = found[0], expected = revision(input.expectedRevision), metres = normalizeInternalMetres(input.metres);
  if (row && materialDeliveryRows(root).some(item => item.delivery.allocationId === row.id && item.outstanding !== '0')) fail('面料已实际交接，不能改配');
  if ((row?.revision || 0) !== expected) fail('分配已变化，请刷新', 'CONFLICT');
  if (allocatedMinor(root, supply.line.id, target.line.id) + metresMinor(metres) > metresMinor(supply.line.qty)) fail('分配米数超过可用余量');
  const fact: AllocationFact = { fabricOrderId: supply.order.id, fabricLineId: supply.line.id, metres, status: 'active', revision: expected + 1, updatedAt: context.now, updatedBy: context.actorId!, updatedByName: context.actorName };
  if (row) { const { id: _id, orderId: _order, lineId: _line, history: _history, ...previous } = row; row.history.push(previous); Object.assign(row, fact); }
  else rows.push({ id: context.id(), orderId: target.order.id, lineId: target.line.id, history: [], ...fact });
  const saved = row || rows[rows.length - 1];
  root.events.unshift({ id: context.id(), entityType: 'order', entityId: target.order.id, actor: context.actorName, at: context.now, text: `分配内部面料 ${supply.order.code} · ${supply.line.style} ${metres} 米`, fileIds: [] });
  return { id: saved.id, orderId: target.order.id, lineId: target.line.id, revision: saved.revision };
}

/** Actual issues/receipts, never planned allocations, are the physical and cost-transfer evidence. */
export function materialDeliveryRows(root: MistState): MaterialDeliveryRow[] {
  const f = root.fulfillment, result: MaterialDeliveryRow[] = [];
  for (const m of f.stockMovements.filter(m => m.kind === 'issue' && m.materialDelivery)) {
    const stock = f.stock.find(stock => stock.id === m.stockId); if (!stock?.purchaseId) continue;
    const returned = f.stockMovements.filter(r => r.kind === 'return' && r.issueId === m.id).reduce((sum, r) => sum + metresMinor(r.quantity), BigInt(0));
    const left = metresMinor(m.quantity) - returned;
    result.push({ id: m.id, kind: 'issue', purchaseId: stock.purchaseId, quantity: normalizeInternalMetres(m.quantity), outstanding: metresText(left > BigInt(0) ? left : BigInt(0)), unit: stock.unit, at: m.at, location: m.location, evidence: m.note, delivery: m.materialDelivery! });
  }
  for (const r of f.receipts.filter(r => r.materialDelivery && r.quantity > 0)) {
    const p = f.purchases.find(p => p.id === r.purchaseId); if (!p) continue;
    result.push({ id: r.id, kind: 'direct', purchaseId: p.id, quantity: normalizeInternalMetres(r.quantity), outstanding: normalizeInternalMetres(r.quantity), unit: p.unit, at: r.date, location: r.location, evidence: r.evidence, delivery: r.materialDelivery! });
  }
  return result;
}
export function internalFabricDeliveryState(root: MistState, orderId: string): '已交接' | '部分交接' | '待接收' | undefined {
  const rows = materialDeliveryRows(root).filter(row => row.delivery.allocationId && root.fulfillment.purchases.find(p => p.id === row.purchaseId)?.orderId === orderId && row.outstanding !== '0');
  if (!rows.length) return;
  const lines = root.orderLines.filter(l => l.orderId === orderId);
  if (lines.length && lines.every(line => rows.filter(row => row.delivery.confirmation && root.fulfillment.purchases.find(p => p.id === row.purchaseId)?.lineId === line.id).reduce((sum, row) => sum + metresMinor(row.outstanding), BigInt(0)) >= metresMinor(line.qty))) return '已交接';
  return rows.some(row => row.delivery.confirmation) ? '部分交接' : '待接收';
}
export const hasMaterialAtFactory = (root: MistState, purchaseId: string): boolean => {
  const branch = root.productions.find(p => p.sourcePurchaseId === purchaseId);
  return !!branch && materialDeliveryRows(root).some(row => row.delivery.productionId === branch.id && row.outstanding !== '0');
};
export function materialDeliveryRequired(root: MistState, purchaseId: string): boolean {
  const p = root.fulfillment.purchases.find(p => p.id === purchaseId), o = root.orders.find(o => o.id === p?.orderId);
  return !!o?.governance?.contract.internalSupply || p?.domain === 'garment' && p.kind === 'material';
}
export function materialDeliveryTargets(root: MistState, purchaseId: string): Array<{ value: string; label: string; remaining?: string }> {
  const p = root.fulfillment.purchases.find(p => p.id === purchaseId); if (!p) return [];
  const internal = !!root.orders.find(o => o.id === p.orderId)?.governance?.contract.internalSupply;
  return root.productions.flatMap(branch => {
    const order = root.orders.find(o => o.id === branch.orderId), contract = root.fulfillment.purchases.find(p => p.id === branch.sourcePurchaseId);
    if (branch.closed || order?.type !== 'garment' || order.governance?.status !== 'approved' || contract?.kind !== 'processing' || contract.state !== 'approved' || !contract.offlineSend || !contract.supplierConfirmation) return [];
    let remaining: string | undefined;
    if (internal) {
      const allocation = root.internalFabricAllocations?.find(a => a.status === 'active' && a.orderId === branch.orderId && a.lineId === branch.lineId && a.fabricOrderId === p.orderId && a.fabricLineId === p.lineId);
      if (!allocation) return [];
      const used = materialDeliveryRows(root).filter(r => r.delivery.allocationId === allocation.id && r.outstanding !== '0').reduce((sum, r) => sum + metresMinor(r.outstanding), BigInt(0));
      const available = metresMinor(allocation.metres) - used; if (available <= BigInt(0)) return [];
      remaining = metresText(available);
    } else if (p.domain !== 'garment' || p.kind !== 'material' || branch.orderId !== p.orderId || branch.lineId !== p.lineId) return [];
    return [{ value: branch.id, label: `${contract.code} · ${contract.supplier}${remaining ? ` · 可发 ${remaining} 米` : ''}`, ...(remaining ? { remaining } : {}) }];
  });
}
/** Central warehouse staff have no business-group assignment; group-assigned staff may write only their own line. */
export function assertMaterialSender(root: MistState, purchaseId: string, ctx: MistContext) {
  if (!ctx.members) return fail('无法核对发料经办人，请刷新');
  const p = root.fulfillment.purchases.find(p => p.id === purchaseId); if (!p) return fail('来源采购不存在');
  resolveMember(ctx, ctx.actorId, '交付经办人');
  const actor = ctx.members!.find(m => m.id === ctx.actorId)!;
  if (actor.groups.length && !actor.groups.includes(p.domain)) fail('当前账号不能办理该业务组的发料', 'FORBIDDEN');
}
export function prepareMaterialDelivery(root: MistState, purchaseId: string, productionId: unknown, quantity: number, ctx: MistContext): MaterialDeliveryLink {
  assertMaterialSender(root, purchaseId, ctx);
  const p = root.fulfillment.purchases.find(p => p.id === purchaseId)!, source = lineFor(root, p.orderId, p.lineId);
  assertOrderApproved(root, source.order.id); assertOrderLineOpen(source.line);
  const production = root.productions.find(row => row.id === identity(productionId, '接收加工单'));
  const target = production && lineFor(root, production.orderId, production.lineId);
  const contract = production && root.fulfillment.purchases.find(p => p.id === production.sourcePurchaseId);
  if (!production || production.closed || !target || target.order.type !== 'garment' || contract?.kind !== 'processing' || contract.state !== 'approved' || !contract.offlineSend || !contract.supplierConfirmation) return fail('请选择已接单的成衣加工分支');
  assertOrderApproved(root, target.order.id); assertOrderLineOpen(target.line);
  let allocation: MistInternalFabricAllocation | undefined;
  if (source.order.governance?.contract.internalSupply) {
    supplyFor(root, source.order.id, source.line.id, ctx);
    allocation = root.internalFabricAllocations?.find(a => a.status === 'active' && a.orderId === target.order.id && a.lineId === target.line.id && a.fabricOrderId === source.order.id && a.fabricLineId === source.line.id);
    if (!allocation || normalizeGarmentFulfillment(target.line).fulfillmentMode !== 'full_package') return fail('加工分支与内部面料分配不一致');
    if (!['米', 'm', 'metre', 'metres', 'meter', 'meters'].includes(p.unit.trim().toLowerCase())) return fail('供料须按米数登记');
    const delivered = materialDeliveryRows(root).filter(row => row.delivery.allocationId === allocation!.id).reduce((sum, row) => sum + (row.outstanding === '0' ? BigInt(0) : metresMinor(row.outstanding)), BigInt(0));
    if (delivered + metresMinor(quantity) > metresMinor(allocation.metres)) return fail('本次发料超过分配剩余米数');
  } else if (p.domain !== 'garment' || p.kind !== 'material' || p.orderId !== target.order.id || p.lineId !== target.line.id) return fail('物料与接收加工条目不一致');
  const receiverId = source.order.governance?.contract.internalSupply?.receiverId || target.order.ownerId;
  const receiver = resolveMember(ctx, receiverId, '接收负责人', 'garment');
  return { productionId: production.id, orderId: target.order.id, lineId: target.line.id, supplierId: contract.supplierId, supplier: contract.supplier, receiverId: receiver.id, receiver: receiver.name, ...(allocation ? { allocationId: allocation.id, allocationRevision: allocation.revision } : {}) };
}
export function confirmMaterialDelivery(root: MistState, payload: { kind: unknown; id: unknown; evidence: unknown }, ctx: MistContext): MistCommandResult {
  const row = materialDeliveryRows(root).find(row => row.id === payload.id && row.kind === payload.kind);
  if (!row || row.outstanding === '0') return fail('没有待接收的物料交接');
  if (!materialReceiverIds(root, row).includes(ctx.actorId || '')) return fail('仅指定接收负责人可确认', 'FORBIDDEN');
  const receiver = resolveMember(ctx, ctx.actorId, '接收负责人', 'garment');
  if (row.delivery.confirmation) return fail('接收已确认，请勿重复登记');
  if (typeof payload.evidence !== 'string' || !payload.evidence.trim() || payload.evidence.length > 1000) return fail('请填写工厂点收依据');
  row.delivery.confirmation = { at: ctx.now, actorId: receiver.id, actor: receiver.name, evidence: payload.evidence.trim() };
  root.events.unshift({ id: ctx.id(), entityType: 'order', entityId: row.delivery.orderId, actor: ctx.actorName, at: ctx.now, text: `确认物料接收 ${row.outstanding} ${row.unit} · ${row.delivery.supplier}`, fileIds: [] });
  return { id: row.id, orderId: row.delivery.orderId };
}
/** Current accountable owners may receive after a recorded staff handover; the original delivery identity stays frozen. */
export function materialReceiverIds(root: MistState, row: MaterialDeliveryRow): string[] {
  const target = root.orders.find(o => o.id === row.delivery.orderId), purchase = root.fulfillment.purchases.find(p => p.id === row.purchaseId);
  const source = root.orders.find(o => o.id === purchase?.orderId);
  return [...new Set([target?.ownerId, source?.governance?.contract.internalSupply?.receiverId].filter((id): id is string => !!id))];
}

/** Preserve every cent across the source's remaining material and all confirmed destination orders. */
export type InternalFabricCostBasis={purchaseId:string;weights:Array<{orderId:string;weight:string}>};
function internalFabricCostWeights(root:MistState,purchaseId:string):Map<string,bigint>|null{
 const p=root.fulfillment.purchases.find(p=>p.id===purchaseId);if(!p||!root.orders.find(o=>o.id===p.orderId)?.governance?.contract.internalSupply)return null;
  const rows = materialDeliveryRows(root).filter(row => row.purchaseId === p.id && row.delivery.allocationId && row.delivery.confirmation && row.outstanding !== '0');
  if (!rows.length) return new Map([[p.orderId,BigInt(1)]]);
  const weights = new Map<string, bigint>();
  for (const row of rows) weights.set(row.delivery.orderId, (weights.get(row.delivery.orderId) || BigInt(0)) + metresMinor(row.outstanding));
  const settled = root.payables?.settlements?.filter(s => s.purchaseId === p.id && s.state === 'confirmed') || [];
  const final = settled.some(s => s.final), settledQuantity = settled.reduce((sum, s) => sum + (s.quantity > 0 ? metresMinor(s.quantity) : BigInt(0)), BigInt(0));
  const allocated = [...weights.values()].reduce((sum, n) => sum + n, BigInt(0));
  const base = final && settledQuantity > BigInt(0) ? settledQuantity : metresMinor(p.quantity);
  const received = p.received > 0 ? metresMinor(p.received) : BigInt(0);
  const denominator = [base, received, allocated].reduce((max, n) => n > max ? n : max, BigInt(0));
  weights.set(p.orderId, denominator - allocated);
  return weights;
}
/** Read-only financial proportions, without warehouse sites, people, QC evidence or attachment references. */
export function financialMaterialCostBasis(root:MistState):InternalFabricCostBasis[]{
 const gcd=(a:bigint,b:bigint):bigint=>b===BigInt(0)?a:gcd(b,a%b);
 return (root.fulfillment?.purchases||[]).filter(p=>p.state==='approved'&&!p.cancellation).flatMap(p=>{
  const weights=internalFabricCostWeights(root,p.id);if(!weights)return[];
  const divisor=[...weights.values()].reduce((a,n)=>gcd(a,n),BigInt(0))||BigInt(1);
  return [{purchaseId:p.id,weights:[...weights].sort(([a],[b])=>a.localeCompare(b)).map(([orderId,weight])=>({orderId,weight:(weight/divisor).toString()}))}];
 });
}
/** Authoritative callers omit financialBasis; only explicit read-projection consumers supply it. */
export function internalFabricCostShare(root: MistState, purchaseId: string, orderId: string, minor: number,financialBasis?:ReadonlyArray<InternalFabricCostBasis>|null): number {
 const p=root.fulfillment.purchases.find(p=>p.id===purchaseId);if(!p)return 0;
 if(!root.orders.find(o=>o.id===p.orderId)?.governance?.contract.internalSupply)return p.orderId===orderId?minor:0;
 if(financialBasis===null)fail('内部供料成本依据未读取');
 const basis=financialBasis?.find(row=>row.purchaseId===purchaseId);
 if(financialBasis!==undefined&&(!basis||!basis.weights.length))fail('内部供料成本依据不完整');
 if(basis&&(new Set(basis.weights.map(w=>w.orderId)).size!==basis.weights.length||basis.weights.some(w=>!w.orderId||!/^\d+$/.test(w.weight))))fail('内部供料成本分摊比例无效');
 const weights=basis?new Map(basis.weights.map(w=>[w.orderId,BigInt(w.weight)])):internalFabricCostWeights(root,purchaseId)!;
 const denominator=[...weights.values()].reduce((n,w)=>n+w,BigInt(0));if(denominator<=BigInt(0))fail('内部供料成本分摊比例无效');
  const total = BigInt(Math.abs(minor)), shares = [...weights.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, weight]) => ({ id, amount: total * weight / denominator, remainder: total * weight % denominator }));
  let rest = total - shares.reduce((sum, s) => sum + s.amount, BigInt(0));
  for (const s of [...shares].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1)) { if (rest === BigInt(0)) break; s.amount++; rest--; }
  return Number(shares.find(s => s.id === orderId)?.amount || BigInt(0)) * (minor < 0 ? -1 : 1);
}
