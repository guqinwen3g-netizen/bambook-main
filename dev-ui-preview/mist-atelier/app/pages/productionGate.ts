/** 生产分支开产门禁：与服务端放行规则逐项对应，只读核对，最终以服务端为准。 */
import { assertMistOrderApproved, type MistProduction, type MistState } from '../../../../server/src/shared/mistWorkspace';
import { orderDepositBlocker } from '../../../../server/src/shared/mistOrderFunding';
import { productionSampleRequirements } from '../../../../server/src/shared/mistProductionSamples';
import { uiText } from '../../../../services/interfaceLanguage';
import { garmentMaterialBlocker, type InternalFabricContext } from '../../../../server/src/shared/mistInternalFabric';

export type GateItem = { key: string; label: string; ok: boolean; detail: string; target?: { view: string; id?: string } };
const message = (check: () => void) => { try { check(); return ''; } catch (problem) { return problem instanceof Error ? problem.message : '未通过'; } };

export function productionReleaseGate(state: MistState, branch: MistProduction, context: InternalFabricContext = { actorName: '' }, scopedMaterialBlocker?: string): GateItem[] {
  const f = state.fulfillment, order = state.orders.find(row => row.id === branch.orderId), fabric = order?.type === 'fabric';
  const fact = f?.productionFacts?.find(row => row.productionId === branch.id);
  const approval = message(() => assertMistOrderApproved(state, branch.orderId));
  const deposit = approval ? '主单批准后核对' : orderDepositBlocker(state, branch.orderId);
  const items: GateItem[] = [
    { key: 'approval', label: '主单', ok: !approval, detail: approval || '已批准', target: { view: 'orders/detail', id: branch.orderId } },
    { key: 'deposit', label: '定金', ok: !approval && !deposit, detail: deposit || (order?.governance?.contract.depositPercent === 0 || order?.governance?.contract.kind === 'internal' ? '无需定金' : '已覆盖'), target: { view: 'payment-vouchers' } },
  ];
  if (!fabric) {
    // Recipient-scoped source details are intentionally hidden; the server computes this exact line's blocker.
    const material = scopedMaterialBlocker ?? garmentMaterialBlocker(state, branch.orderId, branch.lineId, context);
    items.push({ key: 'material', label: '用料计划', ok: !material, detail: material || '已确认', target: { view: 'orders/detail', id: branch.orderId } });
  }
  if (!fabric) items.push({ key: 'sizes', label: '生产尺码', ok: !!fact?.sizes.length, detail: fact?.sizes.length ? fact.sizes.map(size => `${size.size}:${size.quantity}`).join(' · ') : '未登记' });
  if (branch.sourcePurchaseId) {
    const purchase = f?.purchases.find(row => row.id === branch.sourcePurchaseId), ok = !!purchase && purchase.state === 'approved' && !!purchase.offlineSend && !!purchase.supplierConfirmation;
    const detail = !purchase ? '不可核对' : purchase.state !== 'approved' ? '待批准' : !purchase.offlineSend ? '待发出' : !purchase.supplierConfirmation ? '待供应商确认' : '已确认';
    items.push({ key: 'contract', label: '供应合同', ok, detail, target: purchase ? { view: 'procurement', id: purchase.id } : undefined });
  }
  const role = fabric ? 'pioneer' : 'pp', roleLabel = fabric ? '先锋样' : '产前样';
  for (const row of productionSampleRequirements(state, branch, role)) {
    items.push({ key: row.key, label: uiText(roleLabel) + (row.label ? ` · ${row.label}` : ''), ok: row.ok,
      detail: uiText(row.ok && row.evidence?.result === 'conditional' ? '有保留通过' : row.reason),
      target: row.taskId ? { view: 'qc-workbench', id: row.taskId } : { view: 'samples' } });
  }
  return items;
}

/** 本分支最新的生产 QC 是否为 NOK（且尚未由业务继续）。 */
export function productionNok(state: MistState, branch: MistProduction) {
  const f = state.fulfillment;
  return (f?.qcTasks || []).find(task => task.kind === 'production' && task.source.kind === 'orderLine' && task.source.productionId === branch.id && f.qcReports.find(report => report.id === task.reportIds.at(-1))?.result === 'reject' && !task.businessContinued);
}

/** Business continuation resolves the pause, not the report's recorded qualifications. */
export function productionConditionalQc(state: MistState, branch: MistProduction) {
  const f=state.fulfillment;
  return (f?.qcTasks||[]).find(task=>task.kind==='production'&&task.source.kind==='orderLine'&&task.source.productionId===branch.id&&f.qcReports.find(report=>report.id===task.reportIds.at(-1))?.result==='conditional');
}

/** Older generated workflow reminders are progress facts, not business risks. */
export function productionRiskText(branch: Pick<MistProduction, 'risk'>): string {
  const risk = branch.risk || '';
  if (risk === '待合同确认、先锋样与业务开产放行' || risk === '待合同确认、产前样与业务开产放行'
    || /^(?:成品采购|加工采购) · 已交付 .+，待对应生产QC$/.test(risk)
    || /^合格实收 .+，待对应生产QC$/.test(risk)) return '';
  return risk;
}
