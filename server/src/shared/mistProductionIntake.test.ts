import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, getMistReviewTasks, mistCommandPermission, type MistContext } from './mistWorkspace';
import { scopedTargetViolation } from './mistDataScope';
import { projectState } from '../mist/access';

function fixture(domain:'fabric'|'garment'='fabric') {
  let n = 0;
  const context: MistContext = { id: () => `intake-${++n}`, now: '2026-10-29T02:00:00Z', actorId: 'sales', actorName: '业务甲', authority: { supplier: {}, orderReviewerIds: { fabric: ['manager'], garment: ['manager'] } } };
  let state = createMistState(context, 'empty');
  const run = (command: any, actor = context) => { const out = applyMistCommand(state, command, actor); state = out.state; return out.result; };
  state.customers.push({ id: 'customer', name: '测试客户', code: 'C', country: '', city: '', industry: '', owner: '业务甲', ownerId: 'sales', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  state.files.push({ id: 'source', name: 'factory.pdf', mimeType: 'application/pdf', size: 1, storageKey: 'fixture/source', createdAt: context.now });
  const orderId = run({ type: 'order.create', payload: { type: domain, customerId: 'customer', season: 'AW', currency: 'USD', due: '2026-12-01', ownerId: 'sales', governance: { kind: 'external', poNumber: 'TEST', confirmationFileIds: ['source'], paymentMethod: 'TT', depositPercent: 30, paymentNote: '按合同', incoterm: 'FOB', deliveryPlace: '上海' }, lines: [{ name: '测试产品', style: 'TEST', qty: 10, price: 2, unit: domain==='garment'?'件':'米', img: 'fabric',...(domain==='garment'?{fulfillmentMode:'full_package',cmtIncludedItems:[]}:{}) }] } }).orderId!;
  run({ type: 'order.governance.submit', payload: { orderId } });
  run({ type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: '主单核对' } }, { ...context, actorId: 'manager' });
  state.productions.push({ id: 'production', code: 'FUL-TEST', orderId, lineId: state.orderLines[0].id, order: state.orders[0].code, name: '测试面料', factory: '测试工厂', qty: 10, pct: 0, col: 'cut', due: '2026-12-01', img: 'fabric' });
  const input = { productionId: 'production', asOf: '2026-10-28', sourceName: '工厂反馈', evidence: '工厂确认已开产，工序待核', fileIds: ['source'], stage: null, percent: null, quantity: null };
  return { run, context, input, orderId, get state() { return state; } };
}

describe('in-progress production intake facts', () => {
  it('records unknown external progress separately from release, contracts and money', () => {
    const f = fixture(), before = structuredClone(f.state);
    expect(mistCommandPermission({ type: 'fulfillment.production.intake', payload: f.input } as any)).toBe('production:write');
    f.run({ type: 'fulfillment.production.intake', payload: f.input });
    const fact: any = f.state.fulfillment.productionFacts[0];
    expect(fact.intakes[0]).toMatchObject({ status: 'pending', requesterId: 'sales', snapshot: { asOf: '2026-10-28', stage: null, percent: null, quantity: null, recordedAt: f.context.now, recordedBy: '业务甲' } });
    expect(fact.release).toBeUndefined(); expect(fact.completion).toBeUndefined();
    for (const key of ['orders', 'orderLines', 'productions', 'receipts', 'payments', 'payables', 'orderFunding'] as const) expect(f.state[key]).toEqual(before[key]);
    expect(getMistReviewTasks(f.state).find(t => t.kind === 'productionIntake')).toMatchObject({ requesterId: 'sales', reviewerIds: ['manager'], status: 'pending' });
    expect(() => f.run({ type: 'fulfillment.production.intake', payload: f.input })).toThrow('已有');
  });
  it('appends dated observations and corrections without manufacturing authorization or final completion', () => {
    const f = fixture(); f.run({ type: 'fulfillment.production.intake', payload: f.input });
    f.run({ type: 'fulfillment.production.observe', payload: { ...f.input, stage: 'sew', percent: 60, quantity: 6, evidence: '截至当日已完成本工序六米' } });
    f.run({ type: 'fulfillment.production.observe', payload: { ...f.input, stage: 'sew', percent: 50, quantity: 5, evidence: '复核更正原点数，保留前次记录' } });
    const fact: any = f.state.fulfillment.productionFacts[0];
    expect(fact.observations.map((x: any) => x.percent)).toEqual([null, 60, 50]);
    expect(fact.intakes[0].snapshot.percent).toBeNull(); expect(f.state.productions[0].pct).toBe(0);
    expect(() => f.run({ type: 'fulfillment.production.complete', payload: { productionId: 'production', quantity: 10, sizeQuantities: [], date: '2026-10-28', evidence: '点数', fileIds: [] } })).toThrow();
    expect(() => f.run({ type: 'production.update', payload: { id: 'production', pct: 100 } })).toThrow();
  });
  it('enforces current non-self reviewers and preserves rejected rounds on resubmission', () => {
    const f = fixture(); f.run({ type: 'fulfillment.production.intake', payload: f.input });
    const id = (f.state.fulfillment.productionFacts[0] as any).intakes[0].id;
    const command = { type: 'fulfillment.production.intake.decide', payload: { id, decision: 'approved', note: '核实承接' } };
    expect(mistCommandPermission(command as any)).toBe('orders:write');
    expect(() => f.run(command)).toThrow();
    expect(() => f.run(command, { ...f.context, actorId: 'manager', authority: { supplier: {}, orderReviewerIds: { fabric: [], garment: [] } } })).toThrow();
    f.run({ ...command, payload: { ...command.payload, decision: 'rejected' } }, { ...f.context, actorId: 'manager' });
    f.run({ type: 'fulfillment.production.intake', payload: { ...f.input, evidence: '补充工厂依据再次提交' } });
    const fact: any = f.state.fulfillment.productionFacts[0]; expect(fact.intakes.map((x: any) => x.status)).toEqual(['rejected', 'pending']);
    expect(() => f.run(command, { ...f.context, actorId: 'manager' })).toThrow();
    f.run({ ...command, payload: { ...command.payload, id: fact.intakes[1].id } }, { ...f.context, actorId: 'manager', actorName: '经理' });
    expect((f.state.fulfillment.productionFacts[0] as any).intakes[1].decision.actor).toBe('经理');
    expect(f.state.fulfillment.productionFacts[0].release).toBeUndefined();
  });
  it.each([
    { asOf: '2026-10-30' }, { asOf: '2026-02-30' }, { startedOn: '2026-10-29' },
    { percent: 101 }, { percent: -1 }, { quantity: 11 }, { stage: 'done' }, { fileIds: ['foreign'] }, { evidence: '' }, { sourceName: '' },
  ])('rejects unsupported facts atomically: %j', patch => {
    const f = fixture(), before = structuredClone(f.state);
    expect(() => f.run({ type: 'fulfillment.production.intake', payload: { ...f.input, ...patch } })).toThrow(); expect(f.state).toEqual(before);
  });
  it('keeps scope and private evidence restricted to the original production branch', () => {
    const f = fixture(); f.run({ type: 'fulfillment.production.intake', payload: f.input });
    const scope = { userIds: ['outsider'], teamIds: [] };
    expect(scopedTargetViolation(f.state, scope, { type: 'fulfillment.production.observe', payload: f.input })).toEqual({ path: 'productions', id: 'production' });
    const actor: any = { userId: 'outsider', roles: [], permissions: ['production:read'], authorizationLoaded: true };
    const visible = projectState(f.state, actor, () => createMistState(f.context, 'empty'), undefined, scope).state;
    expect(visible.fulfillment.productionFacts).toHaveLength(0); expect(visible.files).toHaveLength(0);
  });
  it.each(['fabric','garment'] as const)('allows the assigned %s QC to report real in-process inspection without deposit or PP, retaining downstream gates', domain => {
    const f = fixture(domain), source = { kind: 'orderLine', orderId: f.orderId, lineId: f.state.orderLines[0].id, productionId: 'production' };
    if(domain==='garment')f.run({type:'fulfillment.production.plan',payload:{productionId:'production',sizes:[{size:'M',quantity:10}]}});
    const taskId = f.run({ type: 'fulfillment.qc.request', payload: { source, domain, kind: 'production', factory: '测试工厂', location: '工厂', contact: '', due: '2026-10-29' } }).id!;
    const qc = { ...f.context, actorId: 'qc', actorName: '检验员' };
    f.run({ type: 'fulfillment.qc.claim', payload: { id: taskId, domain } }, qc);
    const report = { type: 'fulfillment.qc.report', payload: { id: taskId, domain, result: 'pass', report: 'QC-REAL', location: '工厂', opinion: '本次现场检查', reviewedAt: f.context.now, measurements: [], fileIds: ['source'],...(domain==='garment'?{sizeChecks:[{size:'M',inspected:1,result:'pass',evidence:'实测'}]}:{}) } };
    expect(() => f.run(report, qc)).toThrow();
    f.run({ type: 'fulfillment.production.intake', payload: f.input });
    expect(() => f.run(report)).toThrow('认领'); f.run(report, qc);
    expect(f.state.fulfillment.qcReports[0]).toMatchObject({ report: 'QC-REAL', reviewer: '检验员' });
    expect(f.state.fulfillment.productionFacts[0].release).toBeUndefined();
    expect(() => f.run({ type: 'fulfillment.production.release', payload: { productionId: 'production', note: '不能因已检验跳过资金和样品' } })).toThrow();
  });
  it('freezes the reviewed factory scope and requires a new intake after scope corrections',()=>{
    const f=fixture();f.run({type:'fulfillment.production.intake',payload:f.input});
    const round=(f.state.fulfillment.productionFacts[0] as any).intakes[0];f.state.productions[0].qty=9;
    expect(getMistReviewTasks(f.state).find(r=>r.kind==='productionIntake')!.details.find(d=>d.label==='计划数量')!.value).toBe('10 米');
    const decide={type:'fulfillment.production.intake.decide',payload:{id:round.id,decision:'approved',note:'核对'}};
    expect(()=>f.run(decide,{...f.context,actorId:'manager'})).toThrow('范围已变更');
    expect(()=>f.run({type:'fulfillment.production.observe',payload:f.input})).toThrow('范围已变更');
    f.run({...decide,payload:{...decide.payload,decision:'rejected'}},{...f.context,actorId:'manager'});
    f.run({type:'fulfillment.production.intake',payload:f.input});
    expect((f.state.fulfillment.productionFacts[0] as any).intakes[1].scope.quantity).toBe(9);
  });
  it('keeps the original fact date distinct from the real registration timestamp',()=>{
    const f=fixture();f.run({type:'fulfillment.production.intake',payload:{...f.input,asOf:'2026-10-07',startedOn:'2026-10-06'}},{...f.context,now:'2026-10-08T00:18:00Z',auditNow:'2026-10-29T02:00:00Z'});
    expect((f.state.fulfillment.productionFacts[0] as any).intakes[0].snapshot).toMatchObject({asOf:'2026-10-07',startedOn:'2026-10-06',recordedAt:'2026-10-29T02:00:00Z'});
  });
});
