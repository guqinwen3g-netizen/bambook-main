/** 订单条目阶段轨迹：只由已登记事实推导，不写入任何状态。
 * 成衣：产前样 → 面辅料 → 开裁 → 生产检验 → 完工登记 → 出运（6 步）。
 * 面料：坯布 / 染整 → 色样确认 → 生产检验 → 完工 → 出运（5 步，没有开裁；生产须有实际放行记录）。 */
import type { MistOrder, MistOrderLine, MistState } from '../../../../server/src/shared/mistWorkspace';
import { productionSampleRequirements } from '../../../../server/src/shared/mistProductionSamples';
import { materialDeliveryRows } from '../../../../server/src/shared/mistInternalFabric';
import type { StepState } from '../../../../components/mist';

export type LineStageKey = 'pp' | 'material' | 'cut' | 'inspection' | 'completion' | 'shipment';
export type LineStage = { key: LineStageKey; label: string; state: StepState; caption?: string; reason?: string; target?: { view: string; id?: string } };
export const LINE_TRACK_LABEL = { garment: '成衣：产前样 → 面辅料 → 开裁 → 生产检验 → 完工登记 → 出运', fabric: '面料：坯布 / 染整 → 色样确认 → 生产检验 → 完工 → 出运' } as const;
export const lineTrackLabel = (order: Pick<MistOrder, 'type'>) => order.type === 'fabric' ? LINE_TRACK_LABEL.fabric : LINE_TRACK_LABEL.garment;
export type LineShipping = { ordered: number; planned: number; departed: number; variance: number; variancePercent: number | null; shipments: Array<{ id: string; code: string; quantity: number; state: string; plannedDate: string }> };

const num = (value: number) => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));

export function lineShipping(state: MistState, line: MistOrderLine): LineShipping {
  const shipments = (state.fulfillment?.shipments || []).filter(shipment => shipment.state !== 'cancelled').map(shipment => ({ id: shipment.id, code: shipment.code, state: shipment.state, plannedDate: shipment.plannedDate, quantity: shipment.lines.filter(row => row.lineId === line.id).reduce((sum, row) => sum + row.quantity, 0) })).filter(row => row.quantity > 0);
  const planned = shipments.reduce((sum, row) => sum + row.quantity, 0), departed = shipments.filter(row => row.state === 'departed').reduce((sum, row) => sum + row.quantity, 0);
  return { ordered: line.qty, planned, departed, variance: departed - line.qty, variancePercent: line.qty > 0 && departed > 0 ? Math.round((departed - line.qty) / line.qty * 1000) / 10 : null, shipments };
}

export function lineStages(state: MistState, order: MistOrder, line: MistOrderLine): LineStage[] {
  const f = state.fulfillment, unit = line.unit;
  const reportOf = (task: { reportIds: string[] }) => f?.qcReports.find(report => report.id === task.reportIds.at(-1));
  const fabric = order.type === 'fabric';
  const jobs = state.productions.filter(job => job.lineId === line.id && !job.closed);
  const sampleName = fabric ? '色样' : '产前样';
  const pp: LineStage = (() => {
    const base = { key: 'pp' as const, label: fabric ? '色样确认' : '产前样' };
    const requirements = jobs.flatMap(job => productionSampleRequirements(state, job, fabric ? 'pioneer' : 'pp'));
    if (requirements.length && requirements.every(row => row.ok)) return { ...base, state: 'done', caption: '已认可' };
    const pending = requirements.find(row => !row.ok);
    if (!pending || pending.reason === '未登记') return { ...base, state: 'todo', caption: `未登记${sampleName}`, target: { view: 'samples' } };
    const blocked = ['QC未通过', '未采用'].includes(pending.reason);
    return { ...base, state: blocked ? 'blocked' : 'now', caption: pending.reason === 'QC未通过' ? `${sampleName}未通过` : pending.reason,
      target: pending.taskId ? { view: 'qc-workbench', id: pending.taskId } : { view: 'samples', id: pending.sampleId } };
  })();
  // 面辅料 / 坯布·染整：来源为本条目的采购
  const purchases = (f?.purchases || []).filter(purchase => purchase.lineId === line.id && purchase.state !== 'cancelled' && (fabric || purchase.kind === 'material'));
  const material: LineStage = (() => {
    const base = { key: 'material' as const, label: fabric ? '坯布 / 染整' : '面辅料' };
    if (!fabric && line.fulfillmentMode === 'full_package') {
      const allocation = state.internalFabricAllocations?.find(row => row.lineId === line.id && row.status === 'active');
      if (!allocation) return { ...base, state: 'todo', caption: '待分配主料', target: { view: 'orders/detail', id: order.id } };
      const confirmed = materialDeliveryRows(state).filter(row => row.delivery.allocationId === allocation.id && row.delivery.allocationRevision === allocation.revision && row.delivery.confirmation).reduce((total, row) => total + Number(row.outstanding), 0);
      if (Number(confirmed.toFixed(4)) < Number(allocation.metres)) return { ...base, state: 'now', caption: '内供待交接', target: { view: 'orders/detail', id: allocation.fabricOrderId } };
      if (!purchases.length && line.cmtIncludedItems?.includes('trims') && line.cmtIncludedItems.includes('packaging')) return { ...base, state: 'done', caption: '内供已交接' };
    }
    if (!purchases.length) return { ...base, state: 'todo', caption: '未建采购' };
    const rejected = purchases.find(purchase => purchase.state === 'rejected');
    if (rejected) return { ...base, state: 'blocked', caption: '采购被退回', reason: `${rejected.code} 审批被退回，需要修改后重新提交。`, target: { view: 'procurement', id: rejected.id } };
    const approved = purchases.filter(purchase => purchase.state === 'approved'), arrived = approved.filter(purchase => purchase.received >= purchase.quantity);
    if (approved.length === purchases.length && arrived.length === purchases.length) return { ...base, state: 'done', caption: `${purchases.length} 张已到齐` };
    return { ...base, state: 'now', caption: `${approved.length} / ${purchases.length} 已批 · ${arrived.length} 到齐`, target: { view: 'procurement', id: (purchases.find(purchase => purchase.state !== 'approved' || purchase.received < purchase.quantity) || purchases[0]).id } };
  })();
  const cut: LineStage = (() => {
    const base = { key: 'cut' as const, label: '开裁' };
    if (!jobs.length) return { ...base, state: 'todo', caption: '未开立生产' };
    const held = jobs.find(job => f?.productionFacts?.some(fact => fact.productionId === job.id && fact.hold));
    if (held) return { ...base, state: 'blocked', caption: '已暂停', target: { view: 'production-board', id: held.id } };
    const waiting = jobs.find(job => !f?.productionFacts?.some(fact => fact.productionId === job.id && fact.release));
    if (waiting) return { ...base, state: 'now', caption: '待放行', target: { view: 'production-board', id: waiting.id } };
    if (jobs.some(job => job.col === 'cut')) return { ...base, state: 'now', caption: `${jobs.filter(job => job.col === 'cut').length} 个分支开裁中`, target: { view: 'production-board', id: jobs.find(job => job.col === 'cut')!.id } };
    return { ...base, state: 'done', caption: `${jobs.length} 个分支已开裁` };
  })();
  const qcTasks = (f?.qcTasks || []).filter(task => task.kind === 'production' && task.source.kind === 'orderLine' && task.source.lineId === line.id);
  const inspection: LineStage = (() => {
    const base = { key: 'inspection' as const, label: '生产检验' };
    if (!qcTasks.length) {
      if (!fabric) return { ...base, state: 'todo', caption: '未发起检验' };
      // 开立分支不等于量产；只读取实际放行与完工事实。
      const running = jobs.filter(job => job.col !== 'done');
      if (!jobs.length) return { ...base, state: 'todo', caption: '未开立生产' };
      const held = jobs.find(job => f?.productionFacts?.some(fact => fact.productionId === job.id && fact.hold));
      if (held) return { ...base, state: 'blocked', caption: '已暂停', target: { view: 'production-board', id: held.id } };
      const waiting = jobs.find(job => !f?.productionFacts?.some(fact => fact.productionId === job.id && fact.release));
      if (waiting) return { ...base, state: 'now', caption: '待放行', target: { view: 'production-board', id: waiting.id } };
      if (running.length) return { ...base, state: 'now', caption: `生产中 · ${running.length} 个分支 · 未发起检验`, target: { view: 'production-board', id: running[0].id } };
      return { ...base, state: 'now', caption: '生产已完成 · 未发起检验', target: { view: 'production-board', id: jobs[0].id } };
    }
    const nok = qcTasks.find(task => reportOf(task)?.result === 'reject' && !task.businessContinued);
    if (nok) return { ...base, state: 'blocked', caption: 'QC NOK', reason: `${nok.code} 结论 NOK，需要暂停、由 QC 复验后经业务确认恢复。`, target: { view: 'qc-workbench', id: nok.id } };
    const waiting = qcTasks.find(task => task.state === 'awaiting_business');
    if (waiting) return { ...base, state: 'blocked', caption: '待业务恢复', reason: `${waiting.code} 复检已出结论，须由业务核对后明确继续。`, target: { view: 'qc-workbench', id: waiting.id } };
    const passed = qcTasks.filter(task => { const result = reportOf(task)?.result; return result === 'pass' || result === 'conditional' || !!task.businessContinued; });
    const covered = jobs.length > 0 && jobs.every(job => qcTasks.some(task => task.source.kind === 'orderLine' && task.source.productionId === job.id && passed.includes(task)));
    if (covered) return { ...base, state: 'done', caption: '全部分支 OK' };
    return { ...base, state: 'now', caption: `${passed.length} / ${qcTasks.length} 已出结论`, target: { view: 'qc-workbench', id: (qcTasks.find(task => !passed.includes(task)) || qcTasks[0]).id } };
  })();
  const facts = jobs.map(job => (f?.productionFacts || []).find(fact => fact.productionId === job.id)?.completion).filter(Boolean) as Array<{ quantity: number }>;
  const done = facts.reduce((sum, fact) => sum + fact.quantity, 0);
  const completion: LineStage = !jobs.length || !facts.length ? { key: 'completion', label: fabric ? '完工' : '完工登记', state: 'todo', caption: '未登记完工' }
    : { key: 'completion', label: fabric ? '完工' : '完工登记', state: facts.length === jobs.length ? 'done' : 'now', caption: `${num(done)} ${unit} 已完工` };
  const ship = lineShipping(state, line);
  const shipment: LineStage = !ship.planned ? { key: 'shipment', label: '出运', state: 'todo', caption: '未排出运' }
    : { key: 'shipment', label: '出运', state: ship.departed >= line.qty ? 'done' : 'now', caption: `已离港 ${num(ship.departed)} / ${num(line.qty)} ${unit}`, target: { view: 'shipments', id: ship.shipments[0].id } };
  return fabric ? [material, pp, inspection, completion, shipment] : [pp, material, cut, inspection, completion, shipment];
}

/** 先显示当前受阻；已足量离港显示出运完成，未登记的上游事实保持原状。 */
export function currentLineStage(stages: LineStage[]): LineStage | null {
  const blocked = stages.find(stage => stage.state === 'blocked');
  if (blocked) return blocked;
  if (stages.some(stage => stage.key === 'shipment' && stage.state === 'done')) return null;
  return stages.find(stage => stage.state !== 'done') || null;
}

/** 列表上的订单提醒：待业务动作、QC NOK、待出运条目数。 */
export function orderLineFlags(state: MistState, order: MistOrder) {
  const lines = state.orderLines.filter(line => line.orderId === order.id), tracks = lines.map(line => ({ line, stages: lineStages(state, order, line) }));
  const business = (state.fulfillment?.qcTasks || []).filter(task => task.state === 'awaiting_business' && task.source.kind === 'orderLine' && task.source.orderId === order.id).length;
  const nok = tracks.filter(track => track.stages.find(stage => stage.key === 'inspection')?.caption === 'QC NOK').length;
  const toShip = tracks.filter(track => { const completion = track.stages.find(stage => stage.key === 'completion'), shipment = track.stages.find(stage => stage.key === 'shipment'); return completion?.state !== 'todo' && shipment?.state !== 'done'; }).length;
  return { tracks, business, nok, toShip };
}
