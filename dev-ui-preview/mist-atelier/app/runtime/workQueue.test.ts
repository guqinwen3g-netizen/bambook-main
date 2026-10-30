import {materialDeliveryFixture} from '../../../../server/src/mist/__tests__/materialDelivery';
import { describe, expect, it } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { mistEmailFollowUpTaskIds, mistMyTasks, mistMyWork, mistWorkQueue, type MistWorkOptions } from './workQueue';

let n = 0;
const ctx = () => ({ id: () => `id-${++n}`, now: '2026-10-15T08:00:00.000Z', actorName: '当前员工' });
const all = () => true;
const base = () => { const state = createMistState(ctx(), 'empty'); state.fulfillment.qcTasks = []; state.fulfillment.shipments = []; return state; };
describe('returned quotation handoff',()=>{
 const options={canRead:all,can:(permission:string)=>permission==='quotations:write',me:'sales',today:'2026-10-29'};
 const fixture=()=>{const state=base();state.customers.push({id:'quote-customer',name:'客户'} as any);state.market.quotations.push({id:'quote-return',code:'QT-1',status:'Draft',customerId:'quote-customer',requiresApproval:true,approval:{id:'review',requesterId:'sales',reviewerId:'supervisor',status:'rejected',submittedAt:'2026-10-28T18:13:00Z',decidedAt:'2026-10-28T18:16:00Z',note:'补齐交期',details:[],fileIds:[]}} as any);return state;};
 it('returns the exact rejected quote to its requester without adding stored tasks',()=>{
  const state=fixture(),before=structuredClone(state);const items=mistWorkQueue(state,options);expect(items).toEqual([expect.objectContaining({id:'quote-return:quote-return',module:'quotations',source:'task',sourceLabel:'工作事项',title:'QT-1 报价',when:'退回修改',meta:'客户 · 补齐交期',at:'2026-10-28T18:16:00Z',target:{view:'quotations',id:'quote-return',detail:'full'}})]);expect(state).toEqual(before);
 });
 it('keeps the handoff after draft edits and costing until the quote is resubmitted',()=>{
  const state=fixture(),quote=state.market.quotations[0],returned=quote.approval!;quote.approval=null;quote.approvalHistory=[returned];expect(mistWorkQueue(state,options)).toEqual([expect.objectContaining({id:'quote-return:quote-return',when:'待重新提交'})]);
  quote.approval={...returned,id:'resubmission',status:'pending'};expect(mistWorkQueue(state,options)).toEqual([]);quote.approval.status='approved';expect(mistWorkQueue(state,options)).toEqual([expect.objectContaining({id:'quote-issue:quote-return',when:'待发送'})]);
 });
 it('does not assign the return to another user, a reader, or a completed customer-facing quote',()=>{
  const state=fixture();expect(mistWorkQueue(state,{...options,me:'supervisor'})).toEqual([]);expect(mistWorkQueue(state,{...options,can:()=>false})).toEqual([]);expect(mistWorkQueue(state,{...options,canRead:()=>false})).toEqual([]);
  state.market.quotations[0].status='Sent';expect(mistWorkQueue(state,options)).toEqual([]);state.market.quotations[0].status='Rejected';expect(mistWorkQueue(state,options)).toEqual([]);
 });
});
describe('approved quotation business continuation',()=>{
 const options={canRead:all,can:(permission:string)=>['quotations:write','orders:write'].includes(permission),me:'sales',today:'2026-10-29'};
 const fixture=()=>{const state=base();state.customers.push({id:'quote-customer',name:'客户'} as any);state.market.quotations.push({id:'quote-ready',code:'QT-READY',customerId:'quote-customer',status:'Draft',convertedOrderId:null,lines:[{id:'a'},{id:'b'}],updatedAt:'2026-10-28T18:55:00Z',approval:{id:'approved-review',requesterId:'sales',reviewerId:'supervisor',status:'approved',submittedAt:'2026-10-28T18:51:00Z',decidedAt:'2026-10-28T18:55:00Z',note:'同意报价',details:[],fileIds:[]}} as any);return state;};
 it('hands an approved draft back to its requester for issue and removes it once sent',()=>{
  const state=fixture(),before=structuredClone(state);expect(mistWorkQueue(state,options)).toEqual([expect.objectContaining({id:'quote-issue:quote-ready',module:'quotations',source:'task',sourceLabel:'工作事项',when:'待发送',meta:'客户 · 同意报价',target:{view:'quotations',id:'quote-ready',detail:'full'}})]);expect(state).toEqual(before);state.market.quotations[0].status='Sent';expect(mistWorkQueue(state,options)).toEqual([]);
 });
 it('waits for customer acceptance, then retains only genuinely pending conversion lines',()=>{
  const state=fixture(),quote=state.market.quotations[0];quote.status='Accepted';expect(mistWorkQueue(state,options)).toEqual([expect.objectContaining({id:'quote-convert:quote-ready',when:'待转订单',meta:'客户 · 2 个待转条目'})]);
  quote.lines[0].conversion={orderId:'order',orderCode:'SO-1',at:'2026-10-29T00:00:00Z',by:'业务员',byId:'sales'};quote.convertedOrderId='order';expect(mistWorkQueue(state,options)[0].meta).toBe('客户 · 1 个待转条目');
  quote.lines[1].skipped={reason:'客户取消',at:'2026-10-29T00:00:00Z',by:'业务员',byId:'sales'};expect(mistWorkQueue(state,options)).toEqual([]);
 });
 it('does not create a conversion action for an already converted legacy quote',()=>{
  const state=fixture();state.market.quotations[0].status='Accepted';state.market.quotations[0].convertedOrderId='legacy-order';expect(mistWorkQueue(state,options)).toEqual([]);
 });
 it('requires the requester identity and the permission for each actual action',()=>{
  const state=fixture();expect(mistWorkQueue(state,{...options,me:'supervisor'})).toEqual([]);expect(mistWorkQueue(state,{...options,can:()=>false})).toEqual([]);expect(mistWorkQueue(state,{...options,canRead:()=>false})).toEqual([]);
  state.market.quotations[0].status='Accepted';expect(mistWorkQueue(state,{...options,can:scope=>scope==='quotations:write'})).toEqual([]);expect(mistWorkQueue(state,{...options,canRead:view=>view!=='orders'})).toEqual([]);expect(mistWorkQueue(state,{...options,can:scope=>scope==='orders:write'})).toHaveLength(1);
 });
});
describe('supplier invoice payment request handoff',()=>{
 const options={me:'buyer',today:'2026-10-08',canRead:all,can:(scope:string)=>scope==='finance:payment_request:create'};
 const fixture=()=>{const state=base();state.fulfillment.purchases.push({id:'purchase',code:'PO-1',state:'approved',requesterId:'buyer',supplierId:'supplier',supplier:'工厂',currency:'CNY',quantity:10,price:100,unit:'米',kind:'finished'} as any);state.payables.bills.push({id:'bill',code:'AP-1',supplierId:'supplier',supplier:'工厂',invoiceNo:'INV-1',invoiceType:'commercial',invoiceDate:'2026-10-01',currency:'CNY',amount:1000,taxAmount:0,taxRate:'',lines:[{purchaseId:'purchase',purchaseCode:'PO-1',kind:'finished',amount:1000,settlementId:'settlement',linkedAt:'2026-10-08T00:18:00Z'}],due:'2026-11-08',dueBasis:'验收后付',state:'open',registeredAt:'2026-10-01T00:18:00Z',registeredBy:'财务',fileIds:[],note:''} as any);state.payables.settlements.push({id:'settlement',purchaseId:'purchase',state:'confirmed',amount:1000,currency:'CNY',quantity:10,confirmation:{prepaymentApplied:200,at:'2026-10-08T00:18:00Z'}} as any);return state;};
 it('returns the exact ready bill and its net amount to the original purchaser without changing facts',()=>{const state=fixture(),before=structuredClone(state),items=mistWorkQueue(state,options);expect(items).toEqual([expect.objectContaining({id:'bill-request:bill',title:'AP-1 · 待申请付款',meta:'工厂 · CNY 800.00',at:'2026-10-08T00:18:00Z',due:'2026-11-08',target:{view:'payment-vouchers',id:'bill',section:'payables'}})]);expect(state).toEqual(before);});
 it('does not assign another buyer’s invoice to finance, a reader, or a user without source visibility',()=>{const state=fixture();expect(mistWorkQueue(state,{...options,me:'finance'})).toEqual([]);expect(mistWorkQueue(state,{...options,can:()=>false})).toEqual([]);expect(mistWorkQueue(state,{...options,canRead:view=>view!=='procurement'})).toEqual([]);});
 it('deducts live requests, removes fully requested bills and restores a cancelled request balance',()=>{const state=fixture();state.payables.requests.push({id:'request',code:'PR-1',purpose:'bill',state:'pending',requesterId:'buyer',lines:[{billId:'bill',amount:300}]} as any);expect(mistWorkQueue(state,options)[0].meta).toContain('500.00');state.payables.requests[0].lines[0].amount=800;expect(mistWorkQueue(state,options)).toEqual([]);state.payables.requests[0].state='approved';expect(mistWorkQueue(state,options)).toEqual([]);state.payables.requests[0].state='cancelled';expect(mistWorkQueue(state,options)[0].meta).toContain('800.00');});
 it.each(['held','void','paid'] as const)('does not ask for payment of a %s invoice',status=>{const state=fixture();if(status==='held'){delete state.payables.bills[0].lines[0].settlementId;state.payables.bills[0].lines[0].awaitingSettlement=true;}if(status==='void')state.payables.bills[0].state='void';if(status==='paid'){state.payables.payments.push({id:'payment',amount:800,currency:'CNY',purpose:'bill'} as any);state.payables.allocations.push({id:'allocation',supplierPaymentId:'payment',billId:'bill',amount:800} as any);}expect(mistWorkQueue(state,options)).toEqual([]);});
 it('does not guess a single purchaser for mixed or missing contract ownership',()=>{const state=fixture();state.fulfillment.purchases.push({...state.fulfillment.purchases[0],id:'other-purchase',requesterId:'other'});state.payables.bills[0].lines.push({purchaseId:'other-purchase',purchaseCode:'PO-2',kind:'finished',amount:100} as any);expect(mistWorkQueue(state,options)).toEqual([]);state.payables.bills[0].lines.pop();delete state.fulfillment.purchases[0].requesterId;expect(mistWorkQueue(state,options)).toEqual([]);});
 it('uses the existing recent return item instead of duplicating a rejected payment request',()=>{const state=fixture();state.payables.requests.push({id:'rejected',code:'PR-RETURN',purpose:'bill',state:'rejected',requesterId:'buyer',supplier:'工厂',amount:800,lines:[{billId:'bill',amount:800}],submittedAt:'2026-10-08T00:18:00Z',decision:{at:'2026-10-08T00:18:00Z',actor:'主管',note:'补充付款依据'}} as any);const items=mistWorkQueue(state,options);expect(items.some(item=>item.id==='bill-request:bill')).toBe(false);expect(items).toHaveLength(1);expect(items[0].title).toContain('PR-RETURN');});
});
describe('received-goods settlement handoff', () => {
  const fixture = () => {
    const state = base();
    state.fulfillment.purchases.push({id:'po-settle',code:'PO-SETTLE',state:'approved',requesterId:'me',supplier:'工厂',currency:'CNY',unit:'米',price:135,quantity:10} as any);
    state.fulfillment.receipts.push({id:'r-settle-1',purchaseId:'po-settle',quantity:4,rejected:1,date:'2026-10-10'} as any,{id:'r-settle-2',purchaseId:'po-settle',quantity:6,rejected:0,date:'2026-10-11'} as any);
    state.payables.payments.push({id:'advance',purchaseId:'po-settle',purpose:'prepayment',amount:100,currency:'CNY'} as any);
    return state;
  };
  const options: MistWorkOptions = {canRead:all,can:(p:string)=>p==='procurement:write',me:'me',today:'2026-10-15'};
  const items = (state:ReturnType<typeof base>,opts: MistWorkOptions=options) => mistWorkQueue(state,opts).filter(x=>x.id.startsWith('settlement-submit:'));
  it('assigns one actionable item to the original purchaser without writing a task or using the future contract due date', () => {
    const state=fixture();state.fulfillment.purchases[0].due='2099-12-01';const before=structuredClone(state);
    expect(items(state)).toHaveLength(1);expect(items(state)[0]).toMatchObject({id:'settlement-submit:po-settle',title:'PO-SETTLE · 待结算',module:'payment-vouchers',when:'待结算',target:{view:'payment-vouchers',id:'po-settle',section:'payables'}});
    expect(items(state)[0].meta).toContain('10 米');expect(state).toEqual(before);
  });
  it('requires source and finance read access, submit permission and the actual purchaser identity', () => {
    const state=fixture();expect(items(state,{...options,me:'another'})).toEqual([]);expect(items(state,{...options,me:''})).toEqual([]);expect(items(state,{...options,can:()=>false})).toEqual([]);
    for(const denied of ['procurement','payment-vouchers'])expect(items(state,{...options,canRead:view=>view!==denied})).toEqual([]);
    delete state.fulfillment.purchases[0].requesterId;expect(items(state)).toEqual([]);
  });
  it('waits for pending finance review, returns after rejection, and stops at final settlement or no accepted goods', () => {
    const state=fixture();state.payables.settlements.push({id:'st-pending',purchaseId:'po-settle',state:'pending',receiptIds:['r-settle-1'],final:false} as any);
    expect(items(state)).toEqual([]);state.payables.settlements[0].state='returned';expect(items(state)).toHaveLength(1);
    state.payables.settlements[0].state='confirmed';expect(items(state)[0].meta).toContain('6 米');state.payables.settlements[0].final=true;expect(items(state)).toEqual([]);
    state.payables.settlements=[];state.fulfillment.receipts.forEach(r=>r.quantity=0);expect(items(state)).toEqual([]);state.fulfillment.receipts[0].quantity=4;state.fulfillment.purchases[0].state='cancelled';expect(items(state)).toEqual([]);
  });
  it('does not turn ordinary invoice-based contracts into mandatory settlement work',()=>{const state=fixture();state.payables.payments=[];state.payables.bills.push({id:'bill',state:'open',lines:[{purchaseId:'po-settle',amount:1350}]} as any);const before=structuredClone(state);expect(items(state)).toEqual([]);expect(state).toEqual(before);});
  it('includes an invoice explicitly held for settlement but not a voided invoice',()=>{const state=fixture();state.payables.payments=[];state.payables.bills.push({id:'held',state:'open',lines:[{purchaseId:'po-settle',awaitingSettlement:true}]} as any);expect(items(state)).toHaveLength(1);state.payables.bills[0].state='void';expect(items(state)).toEqual([]);});
  it('returns rejected and reversed formal settlements to their original purchaser',()=>{for(const status of ['returned','reversed']){const state=fixture();state.payables.payments=[];state.payables.settlements.push({id:'old',purchaseId:'po-settle',state:status,receiptIds:['r-settle-1'],final:false} as any);expect(items(state)).toHaveLength(1);}});
  it('does not infer unsettled goods from a projection missing settlement facts', () => {
    const state=fixture();delete (state as any).payables;expect(items(state)).toEqual([]);
  });
});
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
  it('shows the Shanghai submission day while preserving the UTC review instant',()=>{
    const at='2026-10-28T18:13:22.000Z';const items=mistWorkQueue(base(),{canRead:all,me:'me',today:'2026-10-29',reviews:[{id:'quote-review',workspaceId:'w',workspaceName:'公司',title:'报价审批',status:'pending',canDecide:true,submittedAt:at} as any]});
    expect(items[0].meta).toBe('公司 · 2026-10-29');expect(items[0].at).toBe(at);
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
 it('offers only the uncounted remainder and removes receiving work after a partial rejection is fully counted',()=>{
  const f=materialDeliveryFixture(3,false),id=f.run({type:'fulfillment.materials.deliver',payload:{id:f.purchaseId,quantity:3,rejected:0,location:'Factory',date:'2026-10-24',evidence:'Direct delivery',fileIds:[],targetProductionId:f.productionId}}).id!;
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'direct',id,acceptedQuantity:1,rejectedQuantity:1,expectedReceivingRevision:0,evidence:'First count'}},'garment');
  expect(mistWorkQueue(f.state,options)).toMatchObject([{id:'material:direct:'+id,meta:expect.stringContaining('1 米')}]);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'direct',id,acceptedQuantity:1,rejectedQuantity:0,expectedReceivingRevision:1,evidence:'Remaining count'}},'garment');
  expect(mistWorkQueue(f.state,options).filter(row=>row.source==='material')).toEqual([]);
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

it('uses short claim work labels while preserving exact targets and source task facts',()=>{
 const state=base();state.platform.claims=[{id:'claim',code:'CLM-1'} as any];state.tasks=['claim-verify:claim','claim-factory:claim'].map((kind,i)=>({id:String(i),kind,title:'Old long label',due:'',done:false,permission:'qc:inspect',target:{view:'claims',id:'claim'}}));const before=structuredClone(state.tasks);
 expect(mistMyTasks(state,{me:'me',can:all,canRead:all}).map(t=>t.title)).toEqual(['客诉核实 · CLM-1','工厂回复 · CLM-1']);expect(state.tasks).toEqual(before);
});

it('presents an existing customer handover concisely while preserving its source, assignee and deadline',()=>{
 const state=base(),customer={id:'handover-customer',name:'Alder & Vale Apparel'};state.customers.push(customer as any);state.market.relations.push({id:'handover-relation',customerId:customer.id} as any);
 const task={id:'handover-task',kind:'customer-handover',title:'接手客户 Alder & Vale Apparel：核对在手订单、报价、未收款与联系人',due:'2026-10-18',done:false,assigneeIds:['me'],target:{view:'relations',id:'handover-relation'}} as any;state.tasks.push(task);const before=JSON.stringify(task);
 const shown=mistMyTasks(state,{me:'me',canRead:all,can:all}).find(row=>row.id===task.id)!;
 expect(shown.title).toBe('接手客户 · Alder & Vale Apparel');expect(shown.target).toEqual(task.target);expect(shown.assigneeIds).toEqual(['me']);expect(shown.due).toBe('2026-10-18');expect(JSON.stringify(task)).toBe(before);
 expect(mistMyTasks(state,{me:'other',canRead:all,can:()=>false}).some(row=>row.id===task.id)).toBe(false);
});
it('shows a pending Agent proposal only to its owner, as an urgent item to confirm',()=>{
 const state=createMistState({id:()=>'id',now:'2026-10-30T08:00:00.000Z',actorName:'系统'} as any,'empty');
 state.agentProposals=[{id:'p1',ownerId:'finance',owner:'林舒',command:{type:'payable.settlement.confirm',payload:{id:'st'}},summary:['确认 ST-2026-0001 结算','华盛毛纺 · 110,670.00 CNY'],createdAt:'2026-10-30T08:00:00.000Z',state:'pending'},
  {id:'p2',ownerId:'finance',owner:'林舒',command:{type:'payable.bill.register',payload:{}},summary:['登记票据'],createdAt:'2026-10-30T08:00:00.000Z',state:'rejected'}];
 const options={canRead:()=>true,can:()=>false,today:'2026-10-30'};
 expect(mistWorkQueue(state,{...options,me:'finance'}).filter(item=>item.source==='agent')).toMatchObject([{id:'agent-proposal:p1',title:'确认 ST-2026-0001 结算',meta:'华盛毛纺 · 110,670.00 CNY',urgent:true}]);
 expect(mistWorkQueue(state,{...options,me:'sales'}).filter(item=>item.source==='agent')).toHaveLength(0);
});
it('reminds only the contract handler to request an active prepayment plan, overdue after the planned date, and stops once a request is pending',()=>{
 const state=createMistState({id:()=>'id',now:'2026-10-30T08:00:00.000Z',actorName:'系统'} as any,'demo');
 const po=state.fulfillment.purchases.find(p=>p.code==='PO-2026-00001')!;
 state.payables!.plans=[{id:'plan',code:'PP-2026-0001',stage:'prepayment',purchaseId:po.id,purchaseCode:po.code,supplierId:po.supplierId,supplier:po.supplier,currency:'CNY',amount:33480,trigger:'合同签订后',basis:'30% 预付',due:'2026-10-20',note:'',state:'active',registeredAt:'2026-10-18T02:00:00.000Z',registeredBy:'林舒'}] as any;
 const options={canRead:()=>true,can:(scope:string)=>scope==='finance:payment_request:create',today:'2026-10-30'};
 expect(mistWorkQueue(state,{...options,me:po.requesterId}).filter(i=>i.id==='plan-request:plan')).toMatchObject([{title:'PP-2026-0001 · 待申请预付款',when:'已逾期',urgent:true}]);
 expect(mistWorkQueue(state,{...options,me:'someone-else'}).filter(i=>i.id==='plan-request:plan')).toHaveLength(0);
 state.payables!.requests=[{id:'r',purpose:'prepayment',planId:'plan',purchaseId:po.id,state:'pending',amount:33480,currency:'CNY',lines:[]} as any];
 expect(mistWorkQueue(state,{...options,me:po.requesterId}).filter(i=>i.id==='plan-request:plan')).toHaveLength(0);
});
it('short-closes a contract: reminds the purchaser to submit the final settlement once the supplier will not resupply, then reminds finance about the residual prepayment',()=>{
 let k=0;const state=createMistState({id:()=>'sc-'+(++k),now:'2026-10-30T08:00:00.000Z',actorName:'系统'} as any,'demo');
 const po=state.fulfillment.purchases.find(p=>p.code==='PO-2026-00001')!, receipt=state.fulfillment.receipts.find(r=>r.purchaseId===po.id&&r.quantity>0)!;
 state.payables!.payments.push({id:'adv',code:'PAY-1',supplierId:po.supplierId,supplier:po.supplier,purchaseId:po.id,purpose:'prepayment',amount:33480,currency:'CNY',date:'2026-10-20',reference:'B'} as any);
 const confirmed=(id:string,receiptIds:string[],final:boolean,applied:number,quantity:number,amount:number)=>({id,code:id,purchaseId:po.id,purchaseCode:po.code,supplierId:po.supplierId,supplier:po.supplier,currency:'CNY',unit:po.unit,price:po.price,receiptIds,quantity,rejected:0,amount,final,disputes:[],note:'',fileIds:[],submitterId:'x',submittedBy:'x',submittedAt:'2026-10-28T00:00:00Z',state:'confirmed',confirmation:{actorId:'f',actor:'林舒',at:'2026-10-29T00:00:00Z',suggestedPrepayment:applied,prepaymentApplied:applied,adjustReason:'',note:''}});
 state.payables!.settlements=[confirmed('ST-1',[receipt.id],false,33201,2380,110670)] as any;
 const buyer={canRead:()=>true,can:(scope:string)=>scope==='procurement:write',me:po.requesterId,today:'2026-10-30'};
 const finance={canRead:()=>true,can:(scope:string)=>scope==='invoices:reconcile',me:'finance',today:'2026-10-30'};
 const close=()=>mistWorkQueue(state,buyer).filter(i=>i.id==='settlement-close:'+po.id), residual=()=>mistWorkQueue(state,finance).filter(i=>i.id==='prepayment-residual:'+po.id);
 expect(close()).toHaveLength(0);
 receipt.returns=[{id:'ret',quantity:receipt.rejected,disposition:'noReplace',date:'2026-10-29',evidence:'供应商邮件',actor:'沈禾',at:'2026-10-29T00:00:00Z'}];
 expect(close()).toMatchObject([{title:'PO-2026-00001 · 待最终结算',target:{view:'payment-vouchers',id:po.id,section:'payables'}}]);
 expect(mistWorkQueue(state,buyer).filter(i=>i.id==='settlement-submit:'+po.id)).toHaveLength(0);
 expect(residual()).toHaveLength(0);
 state.payables!.settlements.push(confirmed('ST-2',[],true,0,0,0) as any);
 expect(close()).toHaveLength(0);
 expect(residual()).toMatchObject([{title:'PO-2026-00001 · 剩余预付待处理',meta:expect.stringContaining('CNY 279.00'),target:{id:'ST-2'}}]);
});
