import { describe, expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { materialDeliveryRows, materialDeliveryTargets } from './mistInternalFabric';
import { scopedMaterialIssueTargets } from './mistDataScope';

function boughtFabric(iqcRequired = false) {
  const f = materialDeliveryFixture(20, false);
  const purchaseId = f.run({ type: 'fulfillment.procurement.save', payload: {
    ...f.source, kind: 'material', materialKind: 'fabric', iqcRequired, supplierId: 'mill', supplier: '',
    description: '成品斜纹面料', quantity: 20, unit: '米', price: 68, currency: 'CNY', due: '2026-11-20',
    terms: '验收后结算', destination: '面料仓', note: '', fileIds: [],
  } }).id!;
  f.run({ type: 'fulfillment.procurement.submit', payload: { id: purchaseId } });
  f.run({ type: 'fulfillment.procurement.decide', payload: { id: purchaseId, decision: 'approved', note: '核准' } }, 'reviewer');
  f.run({ type: 'fulfillment.procurement.send', payload: { id: purchaseId, at: f.context.now, evidence: '线下发出', fileIds: [] } });
  f.run({ type: 'fulfillment.procurement.confirm', payload: { id: purchaseId, at: f.context.now, confirmedDue: '2026-11-20', evidence: '供应商确认', fileIds: [] } });
  const receive = () => f.run({ type: 'fulfillment.procurement.receive', payload: { id: purchaseId, quantity: 20, rejected: 0, destination: 'warehouse', location: '面料仓', date: '2026-10-24', evidence: '收货合格', fileIds: [] } });
  receive();
  const stockId = f.state.fulfillment.stock[0].id;
  const targets = () => materialDeliveryTargets(f.state, purchaseId, stockId);
  const incomingId = () => f.state.fulfillment.qcTasks.find(task => task.incoming?.stockId === stockId)!.id;
  const report = (result: 'pass' | 'reject' = 'pass') => {
    const id = incomingId();
    f.run({ type: 'fulfillment.qc.claim', payload: { id, domain: 'fabric' } }, 'warehouse');
    f.run({ type: 'fulfillment.qc.report', payload: { id, domain: 'fabric', result, report: 'IQC-FABRIC', opinion: '验布结论', measurements: [], fileIds: [], reviewedAt: f.context.now } }, 'warehouse');
  };
  const close = () => f.run({ type: 'fulfillment.qc.incoming.close', payload: { id: incomingId(), evidence: '按来料检验结论处置' } });
  return { f, purchaseId, stockId, targets, receive, report, close };
}

describe('internal bought fabric quality evidence', () => {
  it('issues accepted finished fabric materials without inventing a source production branch or QC report', () => {
    const { f, purchaseId, targets } = boughtFabric();
    expect(f.state.productions.some(branch => branch.sourcePurchaseId === purchaseId)).toBe(false);
    expect(f.state.fulfillment.qcTasks.some(task => task.kind === 'incoming')).toBe(false);
    expect(targets()).toEqual([expect.objectContaining({ value: f.productionId, remaining: '20', label: expect.stringContaining('可发 20 米') })]);
    expect(targets()[0].blocker).toBeUndefined();
    const id = f.issue(20);
    expect(f.state.fulfillment.stock[0].available).toBe(0);
    expect(materialDeliveryRows(f.state).find(row => row.id === id)?.delivery).toMatchObject({ productionId: f.productionId, allocationRevision: 1 });
    expect(materialDeliveryRows(f.state)[0].delivery.sourceQcReportIds).toBeUndefined();
  });

  it('blocks uninspected IQC stock in the choices and still rejects a forged issue without changing facts', () => {
    const { f, targets, stockId } = boughtFabric(true);
    expect(targets()[0]).toMatchObject({ value: f.productionId, blocker: '来源批次来料检验尚未放行' });
    expect(targets()[0].label).not.toContain('可发');
    expect(scopedMaterialIssueTargets(f.state, { userIds: ['owner'], teamIds: [] })[stockId][0].blocker).toBe('来源批次来料检验尚未放行');
    const before = structuredClone(f.state);
    expect(() => f.issue(1)).toThrow('可用量不足');
    expect(f.state).toEqual(before);
  });

  it('requires IQC disposition, not just a passing report, and issues after release with no production QC', () => {
    const { f, targets, report, close } = boughtFabric(true);
    report();
    expect(targets()[0].blocker).toBe('来源批次来料检验尚未放行');
    expect(() => f.issue(1)).toThrow('可用量不足');
    close();
    expect(targets()[0].blocker).toBeUndefined();
    expect(targets()[0].label).toContain('可发 20 米');
    expect(f.issue(20)).toBeTruthy();
    expect(materialDeliveryRows(f.state)[0].delivery.sourceQcReportIds).toBeUndefined();
  });

  it('does not let another released lot hide the selected lot IQC blocker', () => {
    const { f, purchaseId, stockId, receive, report, close } = boughtFabric(true);
    report(); close(); receive();
    const pendingStock = f.state.fulfillment.stock.find(stock => stock.id !== stockId)!;
    const projection = scopedMaterialIssueTargets(f.state, { userIds: ['owner'], teamIds: [] });
    expect(projection[stockId][0].blocker).toBeUndefined();
    expect(projection[pendingStock.id][0].blocker).toBe('来源批次来料检验尚未放行');
    expect(projection[pendingStock.id][0].label).not.toContain('可发');
    expect(materialDeliveryTargets(f.state, purchaseId)[0].blocker).toBeUndefined();
    expect(() => f.run({ type: 'fulfillment.materials.issue', payload: { id: pendingStock.id, targetProductionId: f.productionId, quantity: 1, location: '工厂', person: 'factory', note: '未放行批次' } })).toThrow('可用量不足');
  });

  it('reports rejection instead of advertising rejected IQC stock as issuable', () => {
    const { f, targets, report, close } = boughtFabric(true);
    report('reject'); close();
    expect(targets()[0].blocker).toBe('来源批次来料检验已拒收');
    expect(targets()[0].label).not.toContain('可发');
    expect(() => f.issue(1)).toThrow('可用量不足');
  });
});

describe('internal processing output keeps production QC gates', () => {
  it.each(['missing branch', 'missing QC', 'stale QC', 'passed QC'] as const)('%s uses the same gate in targets and submission', scenario => {
    const f = materialDeliveryFixture(20);
    // This fixture isolates delivery guards: change the received source to processing output,
    // retaining its exact source branch and QC facts unless this scenario removes them.
    f.state.fulfillment.purchases.find(p => p.id === f.purchaseId)!.kind = 'processing';
    if (scenario === 'missing branch') f.state.productions = f.state.productions.filter(branch => branch.id !== f.sourceProductionId);
    if (scenario === 'missing QC') f.state.fulfillment.qcTasks = f.state.fulfillment.qcTasks.filter(task => task.id !== 'fabric-qc');
    if (scenario === 'stale QC') f.state.fulfillment.qcReports[0].scopeRevision = 0;
    const target = materialDeliveryTargets(f.state, f.purchaseId, f.state.fulfillment.stock[0].id)[0];
    if (scenario === 'passed QC') {
      expect(target.blocker).toBeUndefined();
      const id = f.issue(1);
      expect(materialDeliveryRows(f.state).find(row => row.id === id)?.delivery.sourceQcReportIds).toEqual(['fabric-report']);
    } else {
      const reason = scenario === 'missing branch' ? '来源面料缺少准确生产分支' : scenario === 'missing QC' ? '当前生产分支尚无专业生产QC报告' : '当前生产分支仍有未解除的质量门禁';
      expect(target.blocker).toBe(reason);
      expect(target.label).not.toContain('可发');
      const before = structuredClone(f.state);
      expect(() => f.issue(1)).toThrow(reason);
      expect(f.state).toEqual(before);
    }
  });
});
