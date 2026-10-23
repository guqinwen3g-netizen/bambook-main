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
export function assertGarmentMaterial(root: MistState, orderId: string, lineId: string, context: InternalFabricContext): void {
  const { order, line } = lineFor(root, orderId, lineId); if (order.type !== 'garment') return;
  const mode = normalizeGarmentFulfillment(line);
  if (mode.fulfillmentMode !== 'full_package') return;
  resolveMember(context, order.ownerId, '成衣负责人', 'garment');
  const rows = (root.internalFabricAllocations || []).filter(row => row.lineId === lineId && row.status === 'active');
  if (rows.length !== 1 || rows[0].orderId !== orderId) fail('全包条目须先分配内部面料');
  const row = rows[0]; supplyFor(root, row.fabricOrderId, row.fabricLineId, context); metresMinor(row.metres);
}
/** A PP sample records the approved material plan it was made against; later changes cannot reuse that proof. */
export function garmentMaterialFingerprint(root: MistState, orderId: string, lineId: string): string {
  const {order,line}=lineFor(root,orderId,lineId);
  if(order.type!=='garment'||line.fulfillmentMode!=='full_package')return '';
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
export function assertGarmentProcurement(order: Pick<MistOrder, 'type'>, line: GarmentFulfillmentFields, kind: string, materialKind: unknown): MistMaterialKind | undefined {
  if (order.type === 'garment' && kind === 'finished') fail('成衣请选择加工服务');
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
  resolveMember(context, target.order.ownerId, '成衣负责人', 'garment');
  if (target.order.governance?.status === 'pending' || target.order.governance?.changeDraft?.status === 'pending') fail('审批中不能调整面料分配');
  const supply = supplyFor(root, identity(input.fabricOrderId, '面料订单'), identity(input.fabricLineId, '面料条目'), context);
  const found = rows.filter(row => row.lineId === target.line.id); if (found.length > 1) fail('分配记录冲突');
  if (typeof input.metres !== 'string') fail('米数须按十进制填写', 'VALIDATION');
  const row = found[0], expected = revision(input.expectedRevision), metres = normalizeInternalMetres(input.metres);
  if ((row?.revision || 0) !== expected) fail('分配已变化，请刷新', 'CONFLICT');
  if (allocatedMinor(root, supply.line.id, target.line.id) + metresMinor(metres) > metresMinor(supply.line.qty)) fail('分配米数超过可用余量');
  const fact: AllocationFact = { fabricOrderId: supply.order.id, fabricLineId: supply.line.id, metres, status: 'active', revision: expected + 1, updatedAt: context.now, updatedBy: context.actorId!, updatedByName: context.actorName };
  if (row) { const { id: _id, orderId: _order, lineId: _line, history: _history, ...previous } = row; row.history.push(previous); Object.assign(row, fact); }
  else rows.push({ id: context.id(), orderId: target.order.id, lineId: target.line.id, history: [], ...fact });
  const saved = row || rows[rows.length - 1];
  root.events.unshift({ id: context.id(), entityType: 'order', entityId: target.order.id, actor: context.actorName, at: context.now, text: `分配内部面料 ${supply.order.code} · ${supply.line.style} ${metres} 米`, fileIds: [] });
  return { id: saved.id, orderId: target.order.id, lineId: target.line.id, revision: saved.revision };
}
