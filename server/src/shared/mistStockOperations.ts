/**
 * P1-5 stock operations (backlog sup20 count, sup21 transfer, sup23 reservation, sup24 departure issue, sup25 other receipts).
 * All quantities stay on the existing lot fields: `available` (by position), `locked` (held), `onHand` when tracked.
 * Every change writes one stock movement; nothing is edited in place without a record.
 */
import { MistCommandError, type MistContext, type MistState, type MistCommandResult } from './mistWorkspace';
import { reviewDecision, type MistReviewTask } from './mistReview';
import { addAtPosition, consumeReservations, freeQuantity, removeAtPosition, reservationOpen, stockIssueRemaining, OTHER_RECEIPT_REASONS, type FulfillmentShipment, type FulfillmentStock, type OtherReceiptReason, type StockRoll } from './mistFulfillment';
import { mistBusinessDate, nextBusinessCode } from './mistBusinessClock';

export type StockCountLine = { stockId: string; location: string; counted: number };
export type StockCount = { id: string; code: string; warehouseId?: string; lines: Array<StockCountLine & { book: number; difference: number }>; note: string; state: 'pending' | 'approved' | 'rejected'; requesterId: string; requester: string; at: string; reviewerIds: string[]; decision?: { actorId: string; actor: string; at: string; decision: 'approved' | 'rejected'; note: string } };
export type StockTransfer = { id: string; code: string; stockId: string; fromWarehouseId?: string; fromLocation: string; toWarehouseId: string; toLocation: string; quantity: number; carrier: string; note: string; state: 'inTransit' | 'received'; sentAt: string; sentBy: string; receivedAt?: string; receivedBy?: string };
export type StockOperationCommand =
  | { type: 'fulfillment.stock.receiveOther'; payload: { orderId: string; lineId: string; reason: OtherReceiptReason; source: string; name: string; unit: string; quantity: number; warehouseId?: string; location: string; evidence: string; unitCost?: number; currency?: string; dyeLot?: string; shade?: string; rolls?: StockRoll[] } }
  | { type: 'fulfillment.stock.reserve'; payload: { stockId: string; orderId: string; lineId: string; quantity: number; purpose: string } }
  | { type: 'fulfillment.stock.release'; payload: { stockId: string; reservationId: string; reason: string } }
  | { type: 'fulfillment.stock.transfer'; payload: { stockId: string; quantity: number; sourceLocation?: string; toWarehouseId: string; toLocation: string; carrier: string; note: string } }
  | { type: 'fulfillment.stock.transfer.receive'; payload: { id: string; note: string } }
  | { type: 'fulfillment.stock.count'; payload: { warehouseId?: string; lines: StockCountLine[]; note: string } }
  | { type: 'fulfillment.stock.count.decide'; payload: { id: string; decision: 'approved' | 'rejected'; note: string } };
export const STOCK_OPERATION_COMMANDS = ['fulfillment.stock.receiveOther', 'fulfillment.stock.reserve', 'fulfillment.stock.release', 'fulfillment.stock.transfer', 'fulfillment.stock.transfer.receive', 'fulfillment.stock.count', 'fulfillment.stock.count.decide'] as const;
/** Reservations are a business decision on an order line; count approval goes to the order reviewers like other business approvals. */
export const stockOperationPermission = (command: StockOperationCommand) => command.type === 'fulfillment.stock.count.decide' || command.type === 'fulfillment.stock.reserve' || command.type === 'fulfillment.stock.release' ? 'orders:write' : 'inventory:write';

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const text = (v: unknown, label: string, max = 2000) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail(`${label}未填写或格式无效`);
const qty = (v: unknown, label: string, zero = false) => typeof v === 'number' && Number.isFinite(v) && (zero ? v >= 0 : v > 0) && v <= 1e9 && Math.abs(v * 10000 - Math.round(v * 10000)) < 1e-6 ? v : fail(`${label}须为${zero ? '非负' : '正'}数，最多四位小数`);
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + Math.round(b * 10000), 0)) / 10000;
const code = (prefix: string, rows: { code: string }[], ctx: MistContext) => nextBusinessCode(prefix, rows.map(r => r.code), ctx.now, 5);
type Ops = { stockCounts: StockCount[]; stockTransfers: StockTransfer[] };
const stockOps = (root: MistState): Ops => { const f = root.fulfillment; f.stockCounts ||= []; f.stockTransfers ||= []; return f as Ops; };
const stockOf = (root: MistState, id: unknown) => root.fulfillment.stock.find(s => s.id === id) || fail('库存批次不存在', 'NOT_FOUND');
const warehouseOf = (root: MistState, id: unknown) => { const w = root.fulfillment.warehouses.find(row => row.id === id); if (!w || !w.active) fail('请选择启用中的仓库'); return w!; };
const event = (root: MistState, ctx: MistContext, id: string, message: string) => root.events.unshift({ id: ctx.id(), entityType: 'inventory', entityId: id, actor: ctx.actorName, at: ctx.now, text: message, fileIds: [] });
const ordinary = (stock: FulfillmentStock) => { if (stock.sourceKind === 'claimReturn') fail('退回隔离库存仅可按案件实际处置'); };
/** Count reviewers: the company's order reviewers for the lot's business line, excluding the counter. */
const countReviewers = (root: MistState, ctx: Pick<MistContext, 'authority' | 'actorId'>, stockIds: string[]) => {
  const domains = new Set(stockIds.map(id => root.orders.find(o => o.id === root.fulfillment.stock.find(s => s.id === id)?.orderId)?.type).filter(Boolean) as Array<'fabric' | 'garment'>);
  return [...new Set([...domains].flatMap(d => ctx.authority?.orderReviewerIds?.[d] || []))].filter(id => id && id !== ctx.actorId);
};

export function applyStockOperation(root: MistState, command: StockOperationCommand, ctx: MistContext): MistCommandResult {
  if (!ctx.actorId) fail('需要真实账号', 'FORBIDDEN');
  const f = root.fulfillment, p = command.payload as any;
  switch (command.type) {
    case 'fulfillment.stock.receiveOther': {
      const order = root.orders.find(o => o.id === p.orderId), line = root.orderLines.find(l => l.id === p.lineId && l.orderId === p.orderId);
      if (!order || !line) return fail('请选择准确的订单条目');
      if (typeof p.reason !== 'string' || !Object.prototype.hasOwnProperty.call(OTHER_RECEIPT_REASONS, p.reason)) fail('请选择入库来源类型');
      const quantity = qty(p.quantity, '入库数量'), unit = text(p.unit, '单位', 20), location = text(p.location, '库位', 200);
      const warehouseId = p.warehouseId === undefined ? undefined : warehouseOf(root, p.warehouseId).id;
      let unitCost: number | undefined, currency: string | undefined;
      if (p.unitCost !== undefined) { unitCost = qty(p.unitCost, '单位成本', true); currency = text(p.currency, '成本币种', 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) fail('成本币种须为三位字母'); }
      const rolls = p.rolls === undefined ? undefined : (Array.isArray(p.rolls) && p.rolls.length && p.rolls.length <= 1000 ? (p.rolls as any[]).map((r, i) => ({ roll: text(r?.roll, `第 ${i + 1} 卷卷号`, 60), quantity: qty(r?.quantity, `第 ${i + 1} 卷数量`) })) : fail('码单格式无效'));
      if (rolls && new Set(rolls.map(r => r.roll)).size !== rolls.length) fail('码单卷号不能重复');
      if (rolls && sum(rolls.map(r => r.quantity)) !== quantity) fail('码单合计与入库数量不一致');
      const id = ctx.id();
      f.stock.push({ id, sourceKind: 'other', otherReceipt: { reason: p.reason, source: text(p.source, '来源单位 / 单号', 200), evidence: text(p.evidence, '入库依据'), ...(unitCost !== undefined ? { unitCost, currency } : {}) },
        orderId: order.id, lineId: line.id, name: text(p.name, '物料名称', 200), unit, quantity, available: quantity, ...(warehouseId ? { warehouseId } : {}), ...(p.dyeLot ? { dyeLot: text(p.dyeLot, '缸号', 60) } : {}), ...(p.shade ? { shade: text(p.shade, '色号', 60) } : {}), ...(rolls ? { rolls } : {}),
        location, positions: [{ location, available: quantity }], owner: p.reason === 'customer' ? '客户' : '公司', ...(p.reason === 'customer' ? { ownership: 'Transferred' as const, ownerCustomerId: order.customerId } : {}), createdAt: ctx.now });
      f.stockMovements.push({ id: ctx.id(), stockId: id, kind: 'receive', quantity, location, person: text(p.source, '来源单位 / 单号', 200), note: text(p.evidence, '入库依据'), at: ctx.now, actor: ctx.actorName, ...(warehouseId ? { warehouseId } : {}) });
      event(root, ctx, id, `${OTHER_RECEIPT_REASONS[p.reason as OtherReceiptReason]}入库 ${quantity} ${unit}`);
      return { id };
    }
    case 'fulfillment.stock.reserve': {
      const stock = stockOf(root, p.stockId); ordinary(stock);
      const line = root.orderLines.find(l => l.id === p.lineId && l.orderId === p.orderId); if (!line) return fail('请选择准确的订单条目');
      const quantity = qty(p.quantity, '预留数量');
      if (quantity > freeQuantity(stock)) fail(`可预留数量不足（可用 ${freeQuantity(stock)} ${stock.unit}）`);
      const id = ctx.id();
      (stock.reservations ||= []).push({ id, orderId: line.orderId, lineId: line.id, purpose: text(p.purpose, '预留用途', 500), quantity, at: ctx.now, actor: ctx.actorName });
      f.stockMovements.push({ id: ctx.id(), stockId: stock.id, kind: 'reserve', quantity, location: stock.location, person: ctx.actorName, note: text(p.purpose, '预留用途', 500), at: ctx.now, actor: ctx.actorName });
      event(root, ctx, stock.id, `预留 ${quantity} ${stock.unit}：${p.purpose}`);
      return { id };
    }
    case 'fulfillment.stock.release': {
      const stock = stockOf(root, p.stockId), r = stock.reservations?.find(x => x.id === p.reservationId && reservationOpen(x) > 0);
      if (!r) return fail('没有有效预留', 'NOT_FOUND');
      r.releasedAt = ctx.now; r.releasedBy = ctx.actorName; r.releaseReason = text(p.reason, '释放原因', 500);
      f.stockMovements.push({ id: ctx.id(), stockId: stock.id, kind: 'release', quantity: reservationOpen({ ...r, releasedAt: undefined }), location: stock.location, person: ctx.actorName, note: text(p.reason, '释放原因', 500), at: ctx.now, actor: ctx.actorName });
      event(root, ctx, stock.id, `释放预留：${r.releaseReason}`);
      return { id: r.id };
    }
    case 'fulfillment.stock.transfer': {
      const stock = stockOf(root, p.stockId); ordinary(stock);
      const quantity = qty(p.quantity, '调拨数量'), to = warehouseOf(root, p.toWarehouseId);
      if (to.id === stock.warehouseId) fail('调入仓库与原仓库相同，请用移位');
      if (quantity > freeQuantity(stock)) fail(`可调拨数量不足（可用 ${freeQuantity(stock)} ${stock.unit}）`);
      const from = removeAtPosition(stock, quantity, p.sourceLocation);
      // In transit the goods leave the lot's positions; the open transfer carries them until received (see stockInTransit).
      const ops = stockOps(root), id = ctx.id();
      ops.stockTransfers.push({ id, code: code('TR', ops.stockTransfers, ctx), stockId: stock.id, ...(stock.warehouseId ? { fromWarehouseId: stock.warehouseId } : {}), fromLocation: from, toWarehouseId: to.id, toLocation: text(p.toLocation, '调入库位', 200), quantity, carrier: text(p.carrier, '承运 / 经手', 200), note: text(p.note, '调拨依据'), state: 'inTransit', sentAt: ctx.now, sentBy: ctx.actorName });
      f.stockMovements.push({ id: ctx.id(), stockId: stock.id, kind: 'transferOut', quantity, location: to.name, sourceLocation: from, person: text(p.carrier, '承运 / 经手', 200), note: text(p.note, '调拨依据'), at: ctx.now, actor: ctx.actorName, transferId: id });
      event(root, ctx, stock.id, `调拨出库 ${quantity} ${stock.unit} → ${to.name}（在途）`);
      return { id };
    }
    case 'fulfillment.stock.transfer.receive': {
      const ops = stockOps(root), t = ops.stockTransfers.find(x => x.id === p.id);
      if (!t || t.state !== 'inTransit') return fail('没有在途调拨', 'NOT_FOUND');
      const stock = stockOf(root, t.stockId);
      // The lot keeps one identity; when all of it sits at the destination the lot's warehouse moves too.
      // Positions name the warehouse while the lot is split across warehouses; a whole lot moves its warehouse.
      const prefix = `${f.warehouses.find(w => w.id === t.toWarehouseId)?.name || t.toWarehouseId} · `;
      addAtPosition(stock, t.quantity, prefix + t.toLocation);
      const positions = (stock.positions || []).filter(pos => pos.available > 0), stillAway = ops.stockTransfers.some(x => x.stockId === stock.id && x.state === 'inTransit' && x.id !== t.id);
      if (!stillAway && !(stock.locked || 0) && positions.every(pos => pos.location.startsWith(prefix))) {
        stock.warehouseId = t.toWarehouseId;
        stock.positions = positions.map(pos => ({ location: pos.location.startsWith(prefix) ? pos.location.slice(prefix.length) : pos.location, available: pos.available }));
        stock.location = stock.positions.length === 1 ? stock.positions[0].location : '多个位置';
      }
      t.state = 'received'; t.receivedAt = ctx.now; t.receivedBy = ctx.actorName;
      f.stockMovements.push({ id: ctx.id(), stockId: stock.id, kind: 'transferIn', quantity: t.quantity, location: t.toLocation, person: ctx.actorName, note: text(p.note, '到仓点收依据'), at: ctx.now, actor: ctx.actorName, transferId: t.id, warehouseId: t.toWarehouseId });
      event(root, ctx, stock.id, `调拨到仓 ${t.quantity} ${stock.unit}（${t.code}）`);
      return { id: t.id };
    }
    case 'fulfillment.stock.count': {
      if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 500) fail('请逐批登记盘点数量，最多 500 行');
      const seen = new Set<string>();
      const lines = (p.lines as any[]).map(row => {
        const stock = stockOf(root, row?.stockId); ordinary(stock);
        const location = text(row?.location, '盘点库位', 200), key = stock.id + '\u0000' + location;
        if (seen.has(key)) fail('同一批次同一库位只能登记一次'); seen.add(key);
        const book = (stock.positions ?? [{ location: stock.location, available: stock.available }]).find(pos => pos.location === location)?.available ?? 0;
        const counted = qty(row?.counted, '实盘数量', true);
        return { stockId: stock.id, location, counted, book, difference: sum([counted, -book]) };
      });
      if (p.warehouseId !== undefined) warehouseOf(root, p.warehouseId);
      const ops = stockOps(root), id = ctx.id(), differs = lines.some(l => l.difference !== 0);
      const reviewers = differs ? countReviewers(root, ctx, lines.map(l => l.stockId)) : [];
      if (differs && !reviewers.length) fail('盘点有差异，尚无除盘点人外的审批人', 'PRECONDITION');
      ops.stockCounts.push({ id, code: code('ST', ops.stockCounts, ctx), ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}), lines, note: text(p.note, '盘点说明'), state: differs ? 'pending' : 'approved', requesterId: ctx.actorId!, requester: ctx.actorName, at: ctx.now, reviewerIds: reviewers });
      event(root, ctx, lines[0].stockId, differs ? `盘点有差异，待审批调整` : '盘点无差异');
      return { id };
    }
    case 'fulfillment.stock.count.decide': {
      const ops = stockOps(root), count = ops.stockCounts.find(x => x.id === p.id);
      if (!count || count.state !== 'pending') return fail('盘点单已处理或不存在', 'CONFLICT');
      if (ctx.actorId === count.requesterId || !count.reviewerIds.includes(ctx.actorId!) || !countReviewers(root, { authority: ctx.authority, actorId: count.requesterId }, count.lines.map(l => l.stockId)).includes(ctx.actorId!)) fail('当前账号不在本次及当前有效审批名单', 'FORBIDDEN');
      if (!['approved', 'rejected'].includes(p.decision)) fail('请选择审批结论');
      if (p.decision === 'approved') for (const line of count.lines.filter(l => l.difference !== 0)) {
        const stock = stockOf(root, line.stockId);
        const now = (stock.positions ?? [{ location: stock.location, available: stock.available }]).find(pos => pos.location === line.location)?.available ?? 0;
        if (now !== line.book) fail(`${stock.name} 在 ${line.location} 的账面已变化，请重新盘点`, 'CONFLICT');
        if (line.difference > 0) addAtPosition(stock, line.difference, line.location); else removeAtPosition(stock, -line.difference, line.location);
        if (stock.onHand !== undefined) stock.onHand = sum([stock.onHand, line.difference]);
        f.stockMovements.push({ id: ctx.id(), stockId: stock.id, kind: 'adjust', quantity: line.difference, location: line.location, person: count.requester, note: `${count.code} 盘${line.difference > 0 ? '盈' : '亏'}：${count.note}`, at: ctx.now, actor: ctx.actorName, countId: count.id });
      }
      count.state = p.decision;
      count.decision = { actorId: ctx.actorId!, actor: ctx.actorName, at: ctx.now, decision: p.decision, note: text(p.note, '审批意见') };
      event(root, ctx, count.lines[0].stockId, `${count.code} 盘点调整${p.decision === 'approved' ? '已批准' : '已退回'}`);
      return { id: count.id };
    }
  }
  return fail('未知库存操作');
}

/**
 * On departure, finished goods of the shipped branches still in our warehouse leave stock with the shipment (oldest lot first).
 * Quantities already issued and linked to this shipment by hand are not issued again; reservations for other lines are respected.
 */
export function autoIssueForDeparture(root: MistState, shipment: FulfillmentShipment, ctx: MistContext): void {
  const f = root.fulfillment;
  for (const line of shipment.lines) {
    const branch = root.productions.find(job => job.id === line.productionId);
    const purchase = branch?.sourcePurchaseId ? f.purchases.find(row => row.id === branch.sourcePurchaseId) : undefined;
    if (!branch || !purchase || purchase.kind === 'material' || root.orders.find(o => o.id === line.orderId)?.governance?.contract.kind === 'internal') continue;
    if (shipment.lines.filter(row => row.productionId === branch.id).length !== 1) continue;
    const unit = root.orderLines.find(row => row.id === line.lineId)?.unit;
    const linked = sum(f.stockMovements.filter(m => m.kind === 'issue' && m.shipmentLink?.shipmentId === shipment.id && m.shipmentLink.productionId === branch.id).map(m => stockIssueRemaining(root, m.id)));
    let need = sum([line.quantity, -linked]);
    const lots = f.stock.filter(s => s.purchaseId === purchase.id && s.orderId === line.orderId && s.lineId === line.lineId && s.unit === unit && s.sourceKind !== 'claimReturn' && s.available > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const lot of lots) {
      let allowance = sum([freeQuantity(lot), ...(lot.reservations || []).filter(r => r.orderId === line.orderId && r.lineId === line.lineId).map(reservationOpen)]);
      for (const position of (lot.positions ?? [{ location: lot.location, available: lot.available }]).filter(pos => pos.available > 0).map(pos => ({ ...pos }))) {
        if (need <= 0 || allowance <= 0) break;
        const take = Math.min(need, position.available, allowance);
        consumeReservations(lot, take, line);
        const from = removeAtPosition(lot, take, position.location);
        f.stockMovements.push({ id: ctx.id(), stockId: lot.id, kind: 'issue', quantity: take, location: shipment.code, sourceLocation: from, person: shipment.consignee, note: `${shipment.code} 离港出库`, at: ctx.now, actor: ctx.actorName, shipmentLink: { shipmentId: shipment.id, productionId: branch.id, evidence: `${shipment.code} 离港自动出库`, actor: ctx.actorName, at: ctx.now } });
        need = sum([need, -take]); allowance = sum([allowance, -take]);
      }
    }
  }
}
/** Days since receipt, for stock age; uses the Beijing business day. */
export const stockAgeDays = (stock: Pick<FulfillmentStock, 'createdAt'>, now: string) => !Number.isFinite(Date.parse(stock.createdAt)) ? 0 : Math.max(0, Math.floor((Date.parse(mistBusinessDate(now) + 'T00:00:00Z') - Date.parse(mistBusinessDate(stock.createdAt) + 'T00:00:00Z')) / 86400000));

/** Count adjustments with differences wait for an order reviewer (not the counter). */
export function getStockCountReviews(root: MistState): MistReviewTask[] {
  return (root.fulfillment?.stockCounts || []).filter(c => c.reviewerIds.length).map(c => ({
    id: `stock-count:${c.id}`, kind: 'stockCount' as const, entityId: c.id, title: `${c.code} 盘点调整`, requesterId: c.requesterId, reviewerIds: [...c.reviewerIds],
    status: c.state, submittedAt: c.at, decision: reviewDecision(c.decision?.actor, c.decision?.at, c.decision?.note), requiredPermission: 'orders:write', target: { view: 'inventory', id: c.lines[0]?.stockId || '' },
    details: [...c.lines.filter(l => l.difference !== 0).map(l => { const s = root.fulfillment.stock.find(row => row.id === l.stockId); return { label: `${s?.name || '库存'} · ${l.location}`, value: `账面 ${l.book} → 实盘 ${l.counted}（${l.difference > 0 ? '+' : ''}${l.difference} ${s?.unit || ''}）` }; }), { label: '盘点说明', value: c.note }],
  }));
}
/** Quantity of this lot on the road between warehouses. */
export const stockInTransit = (root: MistState, stockId: string) => sum((root.fulfillment?.stockTransfers || []).filter(t => t.stockId === stockId && t.state === 'inTransit').map(t => t.quantity));
/**
 * Book unit cost of a lot: the purchase contract price for bought materials or finished goods, or the cost entered on an other receipt.
 * Processing contracts only price the service, so their lots have no full unit cost here.
 */
export function stockUnitCost(root: MistState, stock: FulfillmentStock): { unitCost: number; currency: string } | undefined {
  if (stock.sourceKind === 'other') return stock.otherReceipt?.unitCost !== undefined && stock.otherReceipt.currency ? { unitCost: stock.otherReceipt.unitCost, currency: stock.otherReceipt.currency } : undefined;
  if (stock.sourceKind === 'claimReturn') return undefined;
  const purchase = root.fulfillment.purchases.find(p => p.id === stock.purchaseId);
  return purchase && purchase.kind !== 'processing' && purchase.unit === stock.unit && purchase.price > 0 ? { unitCost: purchase.price, currency: purchase.currency } : undefined;
}
