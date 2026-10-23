import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { productionSampleRequirements } from './mistProductionSamples';

function fixture() {
  const f = materialDeliveryFixture(); let serial = 0;
  f.run({ type: 'fulfillment.production.plan', payload: { productionId: f.productionId, sizes: [{ size: 'S', quantity: 2 }, { size: 'M', quantity: 5 }, { size: 'L', quantity: 3 }] } }, 'garment');
  const add = (size: string, stage: 'qc' | 'acceptance' | 'business' | 'ready' | 'reject' = 'ready', color = '藏青') => {
    const id = f.run({ type: 'fulfillment.samples.create', payload: { name: 'Jacket', category: '成衣', form: '样衣', unit: '件', quantity: 1, location: 'Sample room', size, color, source: { kind: 'orderLine', ...f.target, productionId: f.productionId }, role: 'pp', fileIds: [], note: '' } }, 'garment').id!;
    const taskId = 'pp-task-' + ++serial, reportId = 'pp-report-' + serial;
    f.state.fulfillment.qcTasks.push({ id: taskId, code: 'QC-' + serial, source: { kind: 'orderLine', ...f.target, productionId: f.productionId }, sampleId: id, domain: 'garment', kind: 'sample', factory: 'factory', location: 'Sample room', contact: '', due: '2026-10-24', requestedBy: 'Garment', assignee: 'QC', assigneeId: 'qc', state: stage === 'qc' ? 'pending' : stage === 'reject' ? 'blocked' : 'reported', reportIds: stage === 'qc' ? [] : [reportId], createdAt: f.context.now,
      ...(stage === 'business' || stage === 'ready' ? { businessConfirmation: { result: 'approved', note: 'Customer accepted', actor: 'Garment', at: f.context.now } } : {}),
      ...(stage === 'ready' ? { businessContinued: { reportId, actor: 'Garment', at: f.context.now, note: 'Cleared' } } : {}) });
    if (stage !== 'qc') f.state.fulfillment.qcReports.push({ id: reportId, taskId, result: stage === 'reject' ? 'reject' : 'pass', report: 'PP-' + size + '-' + serial, opinion: 'Checked', measurements: [], fileIds: [], reviewer: 'QC', reviewedAt: f.context.now, scopeRevision: 1 });
    return { id, taskId, reportId };
  };
  const requirements = () => productionSampleRequirements(f.state, f.state.productions.find(p => p.id === f.productionId)!, 'pp');
  const release = () => f.run({ type: 'fulfillment.production.release', payload: { productionId: f.productionId, note: 'Approved actual submissions' } }, 'garment');
  return { f, add, requirements, release };
}

it('requires every actual submitted standard while retaining a single-standard-size PP policy', () => {
  const x = fixture(); x.add('S'); x.add('M', 'acceptance'); x.add('L', 'business');
  expect(x.requirements()).toHaveLength(3);
  expect(() => x.release()).toThrow(/M/);
  expect(x.f.state.fulfillment.productionFacts.find(f => f.productionId === x.f.productionId)?.release).toBeUndefined();
  const standard = fixture(); standard.add('M'); expect(standard.requirements()).toHaveLength(1); expect(() => standard.release()).not.toThrow();
});

it('does not let an older approved specimen bypass a newly registered specimen of the same standard', () => {
  const x = fixture(), old = x.add('M'), previous = structuredClone(x.f.state.fulfillment.qcReports.find(r => r.id === old.reportId));
  const current = x.add('M', 'qc');
  expect(x.requirements()).toHaveLength(1); expect(x.requirements()[0]).toMatchObject({ sampleId: current.id, ok: false });
  expect(() => x.release()).toThrow(); expect(x.f.state.fulfillment.qcReports.find(r => r.id === old.reportId)).toEqual(previous); expect(old.id).not.toBe(current.id);
});

it('freezes all current approved physical evidence without inventing PP for unsent production sizes', () => {
  const x = fixture(), ids = ['S', 'M', 'L'].map(size => x.add(size).id); x.release();
  const checks = x.f.state.fulfillment.productionFacts.find(f => f.productionId === x.f.productionId)!.release!.sampleChecks!;
  expect(checks.map(c => c.sampleId).sort()).toEqual(ids.sort());
  expect(checks.map(c => c.size).sort()).toEqual(['L','M','S']); expect(checks.every(c => c.quantity === 1 && c.unit === '件')).toBe(true);
});

it.each([{stage:'qc',reason:'待QC'},{stage:'reject',reason:'QC未通过'},{stage:'acceptance',reason:'待需求方确认'},{stage:'business',reason:'待业务确认'},{stage:'ready',reason:'已确认'}] as const)('names the actual missing step: $stage',({stage,reason})=>{
  const x=fixture();x.add('M',stage);expect(x.requirements()[0].reason).toBe(reason);
});

it('requires fresh inspection after the physical quality revision changes',()=>{
  const x=fixture(),sample=x.add('M');x.f.state.fulfillment.samples.find(s=>s.id===sample.id)!.qualityRevision=2;
  expect(x.requirements()[0]).toMatchObject({ok:false,reason:'待复验'});expect(()=>x.release()).toThrow('待复验');
});
it('keeps a declined specimen distinct from a pending customer decision',()=>{
  const x=fixture(),sample=x.add('M');x.f.state.fulfillment.qcTasks.find(t=>t.id===sample.taskId)!.businessConfirmation!.result='rejected';
  expect(x.requirements()[0]).toMatchObject({ok:false,reason:'未采用'});expect(()=>x.release()).toThrow('未采用');
});

it('keeps shipping evidence scoped to its actual factory and shipment without inferring every production size',()=>{
  const x=fixture(),a=x.add('M'),b=x.add('L','qc');
  Object.assign(x.f.state.fulfillment.samples.find(s=>s.id===a.id)!,{role:'shipping',shipmentId:'shipment-a'});
  Object.assign(x.f.state.fulfillment.samples.find(s=>s.id===b.id)!,{role:'shipping',shipmentId:'shipment-b'});
  const branch=x.f.state.productions.find(p=>p.id===x.f.productionId)!;
  expect(productionSampleRequirements(x.f.state,branch,'shipping','shipment-a')).toMatchObject([{sampleId:a.id,ok:true}]);
  expect(productionSampleRequirements(x.f.state,branch,'shipping','shipment-b')).toMatchObject([{sampleId:b.id,ok:false}]);
});
