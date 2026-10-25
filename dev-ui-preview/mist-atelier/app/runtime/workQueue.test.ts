import {materialDeliveryFixture} from '../../../../server/src/mist/__tests__/materialDelivery';
import { describe, expect, it } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { mistEmailFollowUpTaskIds, mistMyTasks, mistMyWork, mistWorkQueue } from './workQueue';

let n = 0;
const ctx = () => ({ id: () => `id-${++n}`, now: '2026-10-15T08:00:00.000Z', actorName: '当前员工' });
const all = () => true;
const base = () => { const state = createMistState(ctx(), 'empty'); state.fulfillment.qcTasks = []; state.fulfillment.shipments = []; return state; };
const qc = (patch: any) => ({ id: 'qc-1', code: 'QC-1', source: { kind: 'orderLine', orderId: 'o', lineId: 'l' }, domain: 'garment', kind: 'sample', factory: '实际工厂', location: '', contact: '', due: '2026-10-20', requestedBy: '业务员甲', assignee: '', state: 'reported', reportIds: ['r'], createdAt: '2026-10-01', ...patch });
const request = (patch: any) => ({ id: 'pr-1', code: 'PR-1', purpose: 'prepayment', supplierId: 's1', supplier: '实际供应商', currency: 'CNY', amount: 100, planId: 'plan-1', lines: [], reason: '', fileIds: [], requesterId: 'me', requester: '我', submittedAt: '2026-10-10T00:00:00Z', reviewerIds: ['boss'], snapshot: [], state: 'rejected', decision: { actorId: 'boss', actor: '财务主管', at: '2026-10-12T00:00:00Z', decision: 'rejected', note: '缺少合同' }, paymentHistory: [], ...patch });

describe('my work queue sources', () => {
  it('lists only reviews I can decide, pointing at the exact approval', () => {
    const items = mistWorkQueue(base(), { canRead: all, me: 'me', today: '2026-10-15', reviews: [
      { id: 'payment:1', workspaceId: 'w1', workspaceName: '空间一', title: '付款 1', status: 'pending', canDecide: true, submittedAt: '2026-10-14T00:00:00Z' } as any,
      { id: 'payment:2', workspaceId: 'w1', workspaceName: '空间一', title: '付款 2', status: 'pending', canDecide: false, submittedAt: '2026-10-14T00:00:00Z' } as any,
      { id: 'payment:3', workspaceId: 'w1', workspaceName: '空间一', title: '付款 3', status: 'approved', canDecide: true, submittedAt: '2026-10-14T00:00:00Z' } as any] });
    expect(items.map(item => item.title)).toEqual(['付款 1']);
    expect(items[0].target).toEqual({ view: 'approvals', id: 'w1|payment:1', section: 'mine' });
    expect(items[0].module).toBe('approvals');
  });
  it('files reviews of the current workspace under their business module and other workspaces under approvals', () => {
    const row = (id: string, workspaceId: string) => ({ id, workspaceId, workspaceName: workspaceId, title: id, status: 'pending', canDecide: true, submittedAt: '2026-10-14T00:00:00Z', target: { view: 'procurement', id: 'p1' } }) as any;
    const items = mistWorkQueue(base(), { canRead: all, me: 'me', today: '2026-10-15', workspaceId: 'w1', reviews: [row('a', 'w1'), row('b', 'w2')] });
    expect(items.map(item => item.module)).toEqual(['procurement', 'approvals']);
    expect(mistWorkQueue(base(), { canRead: view => view !== 'procurement', me: 'me', today: '2026-10-15', workspaceId: 'w1', reviews: [row('a', 'w1')] })[0].module).toBe('approvals');
  });
  it('surfaces QC results waiting for the business and hides them once confirmed or without QC access', () => {
    const state = base();
    state.fulfillment.qcTasks = [qc({}), qc({ id: 'qc-2', code: 'QC-2', kind: 'production', state: 'awaiting_business' }), qc({ id: 'qc-3', code: 'QC-3', kind: 'production', state: 'blocked' }),
      qc({ id: 'qc-4', code: 'QC-4', businessConfirmation: { result: 'approved', note: '', actor: 'a', at: 'x' } }), qc({ id: 'qc-5', code: 'QC-5', state: 'pending' })] as any;
    const business = (p: string) => p === 'orders:write';
    const items = mistWorkQueue(state, { canRead: all, can: business, me: 'me', today: '2026-10-15' });
    expect(items.map(item => item.id)).toEqual(['qc:qc-1', 'qc:qc-2', 'qc:qc-3','qc:qc-4']);
    expect(items[2]).toMatchObject({ when: '已阻断', urgent: true, module: 'qc-workbench', target: { view: 'qc-workbench', id: 'qc-3' } });
    expect(mistWorkQueue(state, { canRead: view => view !== 'qc-workbench', can: business, me: 'me', today: '2026-10-15' })).toEqual([]);
    expect(mistWorkQueue(state, { canRead: all, me: 'me', today: '2026-10-15' })).toEqual([]);
  });
  it('gives QC staff unclaimed tasks of their domain and the tasks they are working on', () => {
    const state = base();
    state.fulfillment.qcTasks = [qc({ id: 'a', code: 'A', state: 'pending' }), qc({ id: 'b', code: 'B', state: 'pending', domain: 'fabric' }), qc({ id: 'c', code: 'C', state: 'working', assigneeId: 'me' }), qc({ id: 'd', code: 'D', state: 'working', assigneeId: 'other' }), qc({ id: 'e', code: 'E' })] as any;
    const items = mistWorkQueue(state, { canRead: all, can: p => p === 'qc:garment_chain:write' || p === 'qc:inspect', me: 'me', today: '2026-10-15' });
    expect(items.map(item => [item.id, item.when])).toEqual([['qc:a', '待认领'], ['qc:c', '处理中']]);
    expect(mistWorkQueue(state, { canRead: all, can: p => p === 'qc:garment_chain:write', me: 'me', today: '2026-10-15' })).toEqual([]);
  });
  it('flags departed shipments whose documents have not been sent', () => {
    const state = base();
    state.fulfillment.shipments = [{ id: 'sh-1', code: 'SH-1', customer: '客户', state: 'departed', departedAt: '2026-10-14T00:00:00Z' }, { id: 'sh-2', code: 'SH-2', customer: '客户', state: 'departed', documentsSentAt: '2026-10-14' }, { id: 'sh-3', code: 'SH-3', customer: '客户', state: 'ready' }] as any;
    state.fulfillment.shipments.push({ id: 'sh-4', code: 'SH-4', customer: '客户', state: 'preparing', plannedDate: '2026-10-20', lines: [] } as any);
    const business = (p: string) => p === 'orders:write', logistics = (p: string) => p === 'logistics:handle';
    expect(mistWorkQueue(state, { canRead: all, can: business, me: 'me', today: '2026-10-15' }).map(item => item.target)).toEqual([{ view: 'shipments', id: 'sh-1',detail:'full' }, { view: 'shipments', id: 'sh-3',detail:'full' }]);
    expect(mistWorkQueue(state, { canRead: all, can: logistics, me: 'me', today: '2026-10-15' }).map(item => [item.target.id, item.when])).toEqual([['sh-4', '待接手']]);
    // 业务员也有 shipments:write，但没有后勤岗位标识，不接收待物流接手。
    expect(mistWorkQueue(state, { canRead: all, can: p => p === 'shipments:write', me: 'me', today: '2026-10-15' })).toEqual([]);
    expect(mistWorkQueue(state, { canRead: all, me: 'me', today: '2026-10-15' })).toEqual([]);
  });
  it('returns my recently rejected payment requests until a new request replaces them', () => {
    const state = base();
    state.payables = { bills: [], payments: [], allocations: [], requests: [request({}), request({ id: 'pr-2', code: 'PR-2', requesterId: 'other' }), request({ id: 'pr-3', code: 'PR-3', decision: { actorId: 'b', actor: 'b', at: '2026-08-01T00:00:00Z', decision: 'rejected', note: '' } })] } as any;
    const items = mistWorkQueue(state, { canRead: all, me: 'me', today: '2026-10-15' });
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ id: 'finance:pr-1', target: { view: 'payment-vouchers', id: 'pr-1' } }); expect(items[0].meta).toContain('缺少合同');
    state.payables!.requests!.push(request({ id: 'pr-4', code: 'PR-4', state: 'pending', submittedAt: '2026-10-13T00:00:00Z', decision: undefined }) as any);
    expect(mistWorkQueue(state, { canRead: all, me: 'me', today: '2026-10-15' })).toEqual([]);
    expect(mistWorkQueue({ ...state, payables: { ...state.payables!, requests: [request({})] } } as any, { canRead: view => view !== 'payment-vouchers', me: 'me', today: '2026-10-15' })).toEqual([]);
  });
  it('gives finance unclaimed or suggested receipts and invoices waiting for confirmation', () => {
    const state = base();
    state.receipts = [{ id: 'r1', code: 'R1', date: '2026-10-10', payer: '甲', amount: 10, remaining: 10, currency: 'USD', ref: '', state: 'unmatched' }, { id: 'r2', code: 'R2', date: '2026-10-11', payer: '乙', amount: 10, remaining: 10, currency: 'USD', ref: '', state: 'suggested' },
      { id: 'r3', code: 'R3', date: '2026-10-11', payer: '丙', amount: 10, remaining: 0, currency: 'USD', ref: '', state: 'matched' }, { id: 'r4', code: 'R4', date: '2026-10-11', payer: '丁', amount: 10, remaining: 5, currency: 'USD', ref: '', state: 'unmatched' }] as any;
    state.allocations = [{ id: 'al', receiptId: 'r4', invoiceId: 'i0', amount: 5, currency: 'USD', createdAt: '', actor: '' }] as any;
    state.invoices = [{ id: 'i1', code: 'INV-1', customer: '客户', order: 'SO-1', due: '2026-11-01', financeStatus: 'pending' }, { id: 'i2', code: 'INV-2', financeStatus: 'confirmed' }] as any;
    const items = mistWorkQueue(state, { canRead: all, can: p => p === 'invoices:reconcile' || p === 'invoices:write', me: 'me', today: '2026-10-15' });
    expect(items.map(item => [item.id, item.module])).toEqual([['receipt:r1', 'payment-vouchers'], ['receipt:r2', 'payment-vouchers'], ['invoice:i1', 'payment-vouchers']]);
    expect(items[2].target).toEqual({ view: 'invoices', section: 'pending', id: 'i1' });
    expect(mistWorkQueue(state, { canRead: all, me: 'me', today: '2026-10-15' })).toEqual([]);
  });
  it('counts work items only for their assignees or holders of the named permission', () => {
    const state = base();
    state.tasks = [{ id: 't1', title: '我的', due: '', done: false, kind: 'x', target: { view: 'crm', id: 'c' }, assigneeIds: ['me'] }, { id: 't2', title: '岗位', due: '', done: false, kind: 'x', target: { view: 'shipments', id: 's' }, assigneeIds: [], permission: 'shipments:write' },
      { id: 't3', title: '无主', due: '', done: false, kind: 'x', target: { view: 'orders/detail', id: 'o' }, assigneeIds: [] }, { id: 't4', title: '已完成', due: '', done: true, kind: 'x', target: { view: 'crm', id: 'c' }, assigneeIds: ['me'] }];
    expect(mistMyTasks(state, { canRead: all, me: 'me' }).map(task => task.id)).toEqual(['t1']);
    expect(mistMyWork(state, { canRead: all, can: p => p === 'shipments:write', me: 'me', today: '2026-10-15' }).map(item => [item.id, item.module])).toEqual([['task:t1', 'crm'], ['task:t2', 'shipments']]);
  });
  it('identifies follow-up tasks created from email', () => {
    const state = base(); state.email.messages = [{ followUpTaskIds: ['t1', 't2'] }, { followUpTaskIds: [] }] as any;
    expect([...mistEmailFollowUpTaskIds(state)]).toEqual(['t1', 't2']);
  });
});

describe('weekly team report reminder', () => {
  it('appears from Monday for supervisors until they archive last week', () => {
    const state = base();
    const opts = { canRead: all, can: (p: string) => p === 'relations:admin', me: 'boss', today: '2026-10-19' };
    const item = mistWorkQueue(state, opts).find(i => i.source === 'report')!;
    expect(item).toMatchObject({ id: 'report:2026-10-12', sourceLabel: '周报', title: '生成上周团队周报（10-12 至 10-18）', target: { view: 'dashboard', section: 'team-weekly' }, module: 'dashboard' });
    expect(mistWorkQueue(state, { ...opts, can: () => false }).some(i => i.source === 'report')).toBe(false);
    expect(mistWorkQueue(state, { ...opts, canRead: (v: string) => v !== 'dashboard' }).some(i => i.source === 'report')).toBe(false);
    (state as any).teamReports = [{ id: 'r', weekStart: '2026-10-12', generatedById: 'boss' }];
    expect(mistWorkQueue(state, opts).some(i => i.source === 'report')).toBe(false);
    expect(mistWorkQueue(state, { ...opts, me: 'other' }).some(i => i.source === 'report')).toBe(true);
  });
});


describe('development QC return follows the exact version decision', () => {
  const options = { canRead: all, can: (permission: string) => permission === 'orders:write', me: 'sales', today: '2026-10-15' };
  function scenario() {
    const state = base();
    state.versions = [{ id: 'v', devId: 'd', confirmations: [] }, { id: 'other-v', devId: 'd', confirmations: [] }] as any;
    state.fulfillment.samples = [{ id: 'sample-a', source: { kind: 'version', devId: 'd', versionId: 'v' } }] as any;
    state.fulfillment.qcTasks = [qc({ source: { kind: 'version', devId: 'd', versionId: 'v' }, sampleId: 'sample-a' })] as any;
    return state;
  }
  it.each(['approved', 'needs_adjustment', 'rejected'])('removes a reviewed sample after the requester records %s', result => {
    const state = scenario();
    expect(mistWorkQueue(state, options)).toHaveLength(1);
    state.versions[0].confirmations = [{ result }] as any;
    expect(mistWorkQueue(state, options)).toEqual([]);
  });
  it('routes the business handoff to the exact development version, retaining QC access for inspectors', () => {
    const state = scenario();
    expect(mistWorkQueue(state, options)[0].target).toEqual({ view: 'development/detail', id: 'd', versionId: 'v' });
    expect(mistWorkQueue(state, { ...options, canRead: view => view !== 'development' })).toEqual([]);
    state.fulfillment.qcTasks[0].state = 'pending';
    const inspector = { ...options, can: (permission: string) => permission === 'qc:inspect' || permission === 'qc:garment_chain:write' };
    expect(mistWorkQueue(state, inspector)[0].target).toEqual({ view: 'qc-workbench', id: 'qc-1' });
  });
  it('does not consume a decision on another version or inherit the parent decision for a minor version', () => {
    const state = scenario();
    state.versions[1].confirmations = [{ result: 'approved' }] as any;
    expect(mistWorkQueue(state, options)).toHaveLength(1);
    state.versions[0].minor = { parentVersionId: 'other-v' } as any;
    expect(mistWorkQueue(state, options)).toHaveLength(1);
  });
  it('keeps other sample forms and a whole-version task open until their own scopes have decisions', () => {
    const state = scenario();
    state.fulfillment.samples.push({ id: 'sample-b', source: { kind: 'version', devId: 'd', versionId: 'v' } } as any);
    state.fulfillment.qcTasks.push(qc({ id: 'sample-b-task', sampleId: 'sample-b', source: { kind: 'version', devId: 'd', versionId: 'v' } }), qc({ id: 'version-task', source: { kind: 'version', devId: 'd', versionId: 'v' } }));
    state.versions[0].confirmations = [{ result: 'approved', samples: [{ sampleId: 'sample-a' }] }] as any;
    expect(mistWorkQueue(state, options).map(item => item.id)).toEqual(['qc:sample-b-task', 'qc:version-task']);
    state.versions[0].confirmations.push({ result: 'needs_adjustment', samples: [{ sampleId: 'sample-b' }] } as any);
    expect(mistWorkQueue(state, options)).toEqual([]);
  });
  it('does not treat an unscoped old decision as approval for newly added sample forms', () => {
    const state = scenario();
    state.versions[0].confirmations = [{ result: 'approved' }] as any;
    state.fulfillment.samples.push({ id: 'sample-b', source: { kind: 'version', devId: 'd', versionId: 'v' } } as any);
    expect(mistWorkQueue(state, options)).toHaveLength(1);
  });
});

it('routes an existing return task to warehouse writers without exposing it to finance or QC or mutating stored assignments',()=>{
 const state=base();state.fulfillment.returnReceipts=[{id:'rt',code:'RT-EXAMPLE',claimId:'claim',warehouseId:'warehouse',goodsIds:['goods'],createdAt:'',actorId:'business',actor:'业务'}];state.tasks=[{id:'task',kind:'claim-inventory:goods',title:'较长的原任务标题',due:'',done:false,target:{view:'inventory',id:'rt'},assigneeIds:['business']}];const before=JSON.stringify(state.tasks);
 expect(mistMyTasks(state,{me:'warehouse',canRead:v=>v==='inventory',can:p=>p==='inventory:write'})).toMatchObject([{id:'task',title:'退货处理 · RT-EXAMPLE',permission:'inventory:write'}]);expect(mistMyTasks(state,{me:'finance',canRead:all,can:p=>p==='invoices:reconcile'})).toEqual([]);expect(mistMyTasks(state,{me:'qc',canRead:all,can:p=>p==='qc:inspect'})).toEqual([]);expect(JSON.stringify(state.tasks)).toBe(before);
});
it('hands an agreed compensation to finance while leaving negotiation with its business owner',()=>{
 const state=base();state.platform!.claims=[{id:'claim',code:'CLM-EXAMPLE',state:'Processing',orderId:'order',invoiceId:'invoice',problem:'',fileIds:[],createdAt:'',dispositions:[],coordination:{notices:[],verifications:[],recoveries:[{id:'recovery',supplierId:'s',supplierName:'工厂',currency:'CNY',requested:100,agreed:100,state:'Negotiating',method:'payment',basis:'',createdAt:'',createdBy:'业务',createdById:'business',events:[]}]}}];state.tasks=[{id:'task',kind:'claim-recovery:recovery',title:'跟进补偿',due:'',done:false,target:{view:'claims',id:'claim'},assigneeIds:['business']}];const options={me:'finance',canRead:all,can:(p:string)=>p==='invoices:reconcile'};expect(mistMyTasks(state,options)).toHaveLength(0);state.platform!.claims[0].coordination!.recoveries[0].state='Agreed';expect(mistMyTasks(state,options)).toMatchObject([{id:'task',permission:'invoices:reconcile'}]);
});
it('routes a repair inspection to its own QC business line without inventory access',()=>{
 const state=base();state.platform.claims=[{id:'claim',code:'CLM-REPAIR'}] as any;state.platform.claimGoods=[{claimId:'claim',repairs:[{id:'repair',domain:'garment'}]}] as any;state.tasks=[{id:'task',kind:'claim-repair-qc:repair',title:'返修复检',due:'',done:false,assigneeIds:[],target:{view:'claims',id:'claim'},permission:'qc:garment_chain:write'}];
 expect(mistMyTasks(state,{me:'garment-qc',canRead:view=>view==='claims',can:scope=>scope==='qc:garment_chain:write'})).toMatchObject([{id:'task',title:'返修复检 · CLM-REPAIR'}]);expect(mistMyTasks(state,{me:'fabric-qc',canRead:all,can:scope=>scope==='qc:fabric_chain:write'})).toEqual([]);expect(mistMyTasks(state,{me:'warehouse',canRead:all,can:scope=>scope==='inventory:write'})).toEqual([]);
});

describe('exact material receiving work',()=>{
 const options={canRead:all,can:(p:string)=>p==='orders:write',me:'garment',today:'2026-10-24'};
 it('routes the receiver to the exact processing detail and disappears after real confirmation',()=>{
  const f=materialDeliveryFixture(3),id=f.issue();const before=structuredClone(f.state),items=mistWorkQueue(f.state,options);expect(items).toHaveLength(1);expect(items[0]).toMatchObject({id:'material:issue:'+id,source:'material',module:'procurement',when:'待接收',target:{view:'procurement',id:f.processingId,detail:'full',orderLineId:f.target.lineId}});expect(items[0].meta).toContain('3 米');expect(f.state).toEqual(before);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'实际点收三米'}},'garment');expect(mistWorkQueue(f.state,options)).toEqual([]);
 });
 it('never assigns receipt to another employee, a read-only receiver, or an account without procurement access',()=>{
  const f=materialDeliveryFixture(3);f.issue();expect(mistWorkQueue(f.state,{...options,me:'owner'})).toEqual([]);expect(mistWorkQueue(f.state,{...options,can:()=>false})).toEqual([]);expect(mistWorkQueue(f.state,{...options,canRead:view=>view!=='procurement'})).toEqual([]);
 });
 it('does not leave a receipt task after the whole delivery is returned',()=>{
  const f=materialDeliveryFixture(3),id=f.issue();f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:3,location:'A-01',person:'factory',note:'整批退回'}});expect(mistWorkQueue(f.state,options)).toEqual([]);
 });
 it('includes direct supplier deliveries and uses their original receipt identity',()=>{
  const f=materialDeliveryFixture(3,false),id=f.run({type:'fulfillment.materials.deliver',payload:{id:f.purchaseId,quantity:3,rejected:0,location:'Factory',date:'2026-10-24',evidence:'Direct delivery',fileIds:[],targetProductionId:f.productionId}}).id!;
  expect(mistWorkQueue(f.state,options)).toEqual([expect.objectContaining({id:'material:direct:'+id,target:expect.objectContaining({id:f.processingId,detail:'full'})})]);
 });
});

describe('shipment role continuity',()=>{
 const logistics={canRead:all,can:(p:string)=>p==='logistics:handle',me:'logistics',today:'2026-10-24'},business={...logistics,can:(p:string)=>p==='orders:write',me:'sales'};
 function pending(){const state=base();state.fulfillment.shipments=[{id:'shipment',code:'SHP-1',state:'preparing',mode:'air',booking:'BK-1',plannedDate:'2026-11-20',customer:'客户',lines:[{orderId:'order',lineId:'line',quantity:1}]}] as any;state.tasks=[{id:'handoff',kind:'shipping',title:'核对订单出运交接',due:'2026-11-20',done:false,assigneeIds:[],permission:'logistics:handle',target:{view:'orders/detail',id:'order'}}];return state;}
 it('keeps logistics preparation and actual departure on logistics, returning the document step to business',()=>{
  const state=pending(),shipment=state.fulfillment.shipments[0],before=structuredClone(state);
  expect(mistWorkQueue(state,logistics)).toEqual([expect.objectContaining({id:'shipping:shipment',when:'处理中',title:'SHP-1 · 单证准备',target:{view:'shipments',id:'shipment',detail:'full'}})]);expect(mistWorkQueue(state,business)).toEqual([]);expect(state).toEqual(before);
  shipment.state='ready';expect(mistWorkQueue(state,logistics)).toEqual([]);expect(mistWorkQueue(state,business)).toEqual([expect.objectContaining({title:'SHP-1 · 待对客交单'})]);
  shipment.documentsSentAt='2026-10-24T08:00:00Z';expect(mistWorkQueue(state,business)).toEqual([]);expect(mistWorkQueue(state,logistics)).toEqual([expect.objectContaining({title:'SHP-1 · 待起飞',when:'待起飞'})]);
  shipment.state='departed';expect(mistWorkQueue(state,logistics)).toEqual([]);expect(mistWorkQueue(state,business)).toEqual([]);
 });
 it('replaces the raw order handoff with the exact active shipment without marking it complete',()=>{
  const state=pending();expect(mistMyTasks(state,logistics)).toEqual([]);expect(mistMyWork(state,logistics).map(row=>row.id)).toEqual(['shipping:shipment']);expect(state.tasks[0].done).toBe(false);
  state.fulfillment.shipments[0].state='cancelled';expect(mistWorkQueue(state,logistics)).toEqual([]);expect(mistMyTasks(state,logistics).map(row=>row.id)).toEqual(['handoff']);
 });
 it('does not hide the readable order handoff when the employee cannot enter the shipping module',()=>{
  const state=pending(),options={...logistics,canRead:(view:string)=>view!=='shipments'};expect(mistWorkQueue(state,options)).toEqual([]);expect(mistMyTasks(state,options).map(row=>row.id)).toEqual(['handoff']);expect(mistWorkQueue(state,{...logistics,can:(p:string)=>p==='shipments:write'})).toEqual([]);
 });
 it('keeps one item for a combined shipment rather than one task per source order',()=>{
  const state=pending();state.tasks.push({...state.tasks[0],id:'other-handoff',target:{view:'orders/detail',id:'other-order'}});state.fulfillment.shipments[0].lines.push({orderId:'other-order',lineId:'other-line',quantity:1} as any);expect(mistMyWork(state,logistics).map(row=>row.id)).toEqual(['shipping:shipment']);expect(state.tasks.every(row=>!row.done)).toBe(true);
 });
});

it('keeps adopted order samples pending for business until continuation references the current report',()=>{
 const state=base(),task=qc({businessConfirmation:{result:'approved',actor:'业务员',at:'2026-10-24',note:'采用'}});state.fulfillment.qcTasks=[task] as any;const options={canRead:all,can:(p:string)=>p==='orders:write',me:'sales',today:'2026-10-24'};
 expect(mistWorkQueue(state,options)).toEqual([expect.objectContaining({id:'qc:qc-1',title:'QC-1 · 待业务确认'})]);(task as any).businessContinued={reportId:'previous'};expect(mistWorkQueue(state,options)).toHaveLength(1);(task as any).businessContinued={reportId:'r'};expect(mistWorkQueue(state,options)).toEqual([]);
});
it('finishes a rejected order-sample decision without requiring an approval-only continuation',()=>{
 const state=base();state.fulfillment.qcTasks=[qc({businessConfirmation:{result:'rejected',actor:'业务员',at:'2026-10-24',note:'不采用'}})] as any;expect(mistWorkQueue(state,{canRead:all,can:(p:string)=>p==='orders:write',me:'sales',today:'2026-10-24'})).toEqual([]);
});

describe('supplier settlement finance handoff',()=>{
 function pending(){const state=base();state.payables!.settlements=[{id:'settlement',code:'ST-READY',purchaseId:'purchase',purchaseCode:'PO-READY',supplierId:'supplier',supplier:'供货工厂',currency:'CNY',unit:'件',price:434,receiptIds:['receipt'],quantity:1,rejected:0,amount:434,final:true,disputes:[],note:'原始结算说明',fileIds:[],state:'pending',submitterId:'sales',submittedBy:'业务员',submittedAt:'2099-01-01T00:00:00Z'}];return state;}
 const finance={canRead:all,can:(permission:string)=>permission==='invoices:reconcile',me:'finance',today:'2026-10-08'};
 it('surfaces the exact pending settlement only to the finance confirmation role without changing source facts',()=>{const state=pending(),before=structuredClone(state);expect(mistWorkQueue(state,finance)).toEqual([expect.objectContaining({id:'settlement:settlement',source:'finance',title:'ST-READY · 待财务复核',when:'待复核',target:{view:'payment-vouchers',id:'settlement',section:'payables'}})]);expect(state).toEqual(before);expect(mistWorkQueue(state,{...finance,canRead:()=>false})).toEqual([]);expect(mistWorkQueue(state,{...finance,can:permission=>permission==='procurement:write'||permission==='invoices:write'})).toEqual([]);});
 it.each(['confirmed','returned','cancelled','reversed'] as const)('removes the finance confirmation item once the settlement is %s',status=>{const state=pending();state.payables!.settlements[0].state=status;expect(mistWorkQueue(state,finance)).toEqual([]);});
});

describe('approved supplier payments return to finance',()=>{
 const finance={canRead:all,can:(permission:string)=>permission==='vouchers:write',me:'finance',today:'2026-10-08'};
 function approved(patch:any={}){const state=base();state.payables!.requests=[request({state:'approved',purpose:'settlement',amount:434,settlementId:'settlement',decision:{actorId:'manager',actor:'主管',at:'2099-01-01T00:00:00Z',decision:'approved',note:'同意'},...patch})];return state;}
 it('shows the exact approved request only to an employee able to register its payment',()=>{const state=approved(),before=structuredClone(state);expect(mistWorkQueue(state,finance)).toEqual([expect.objectContaining({id:'payment-request:pr-1',source:'finance',title:'PR-1 · 待付款',when:'待付款',target:{view:'payment-vouchers',id:'pr-1',section:'payables'}})]);expect(state).toEqual(before);expect(mistWorkQueue(state,{...finance,canRead:()=>false})).toEqual([]);expect(mistWorkQueue(state,{...finance,can:permission=>permission==='invoices:reconcile'||permission==='procurement:write'})).toEqual([]);});
 it('requires reconciliation for invoice payments while retaining the existing advance and prepayment permissions',()=>{expect(mistWorkQueue(approved({purpose:'bill'}),finance)).toEqual([]);expect(mistWorkQueue(approved({purpose:'bill'}),{...finance,can:permission=>['vouchers:write','invoices:reconcile'].includes(permission)})).toHaveLength(1);expect(mistWorkQueue(approved({purpose:'prepayment'}),finance)).toHaveLength(1);});
 it.each(['pending','rejected','paid','cancelled'] as const)('has no payment action for a %s request',state=>{expect(mistWorkQueue(approved({state}),finance)).toEqual([]);});
 it('returns the full approved amount after reversal without deducting preserved payment history',()=>{const state=approved({paymentHistory:['old-reversed-payment']});expect(mistWorkQueue(state,finance)[0].meta).toContain('CNY 434.00');});
});

it('keeps an outstanding external repair return on the permitted inventory work path',()=>{
 const state=base();state.tasks=[{id:'external-return',kind:'claim-repair-return:trip',title:'外修返库 · CLM-1',due:'',done:false,permission:'inventory:write',assigneeIds:[],target:{view:'inventory',id:'stock'}}];
 const tasks=mistMyTasks(state,{me:'warehouse',can:all,canRead:all});expect(tasks[0].target).toEqual({view:'inventory',id:'stock',detail:'full'});
 expect(mistMyTasks(state,{me:'qc',can:()=>false,canRead:all})).toEqual([]);state.tasks[0].done=true;expect(mistMyTasks(state,{me:'warehouse',can:all,canRead:all})).toEqual([]);
});

it('suppresses only a redundant parent while all remaining repair lots have their own return work',()=>{
 const state=base();state.fulfillment.returnReceipts=[{id:'rt',code:'RT-1',claimId:'case'} as any];state.fulfillment.receivedRecords=[{id:'received',goodsId:'goods'} as any];state.platform.claimGoods=[{id:'goods',destination:'Repair',quantity:1,receivedQuantity:1,repairDispatches:[{id:'trip',receivedEventId:'received'}]} as any];
 state.tasks=[{id:'parent',kind:'claim-inventory:goods',title:'Original handling',due:'',done:false,permission:'inventory:write',assigneeIds:[],target:{view:'inventory',id:'rt'}},{id:'child',kind:'claim-repair-return:trip',title:'Repair return',due:'',done:false,permission:'inventory:write',assigneeIds:[],target:{view:'inventory',id:'stock'}}];
 const options={me:'warehouse',can:all,canRead:all};expect(mistMyTasks(state,options).map(t=>t.id)).toEqual(['child']);expect(state.tasks[0].done).toBe(false);
 state.fulfillment.receivedRecords.push({id:'other',goodsId:'goods'} as any);expect(mistMyTasks(state,options).map(t=>t.id)).toEqual(['parent','child']);state.fulfillment.receivedRecords.pop();
 state.platform.claimGoods[0].repairDispatches![0].returned={} as any;state.tasks[1].done=true;expect(mistMyTasks(state,options).map(t=>t.id)).toEqual(['parent']);expect(state.tasks[0].done).toBe(false);
});
