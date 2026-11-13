import { expect, it } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { applyDataScope } from '../../../../server/src/shared/mistDataScope';
import { orderFundingCoveredAmount } from '../../../../server/src/shared/mistOrderFunding';
import { ALL_TEAMS, teamOrigins, teamViewState, teamViewFabricDestinations,teamViewMaterialDeliveryTargets } from './teamView';

it('keeps direct handoff options only for source purchases retained in the selected group view',()=>{
 const targets={visible:[{value:'processing',label:'Factory',remaining:'20'}],hidden:[{value:'other',label:'Other'}]},state:any={fulfillment:{purchases:[{id:'visible'}]}};
 expect(teamViewMaterialDeliveryTargets(targets,state)).toEqual({visible:targets.visible});expect(teamViewMaterialDeliveryTargets(targets,null)).toEqual({});expect(teamViewMaterialDeliveryTargets(undefined,state)).toBeUndefined();expect(Object.keys(targets)).toHaveLength(2);
});

it('keeps destination identifiers only for retained source lines and active allocations in the selected group view',()=>{
 const hints={source:[{allocationId:'active',orderCode:'VISIBLE',lineStyle:'V',lineName:'Coat'},{allocationId:'cancelled',orderCode:'CANCELLED',lineStyle:'C',lineName:'Old'},{allocationId:'outside',orderCode:'OUTSIDE',lineStyle:'O',lineName:'Other'}],hidden:[{allocationId:'hidden',orderCode:'HIDDEN',lineStyle:'H',lineName:'Hidden'}]};
 const state:any={orderLines:[{id:'source'}],internalFabricAllocations:[{id:'active',status:'active'},{id:'cancelled',status:'cancelled'}]};
 expect(teamViewFabricDestinations(hints,state)).toEqual({source:[hints.source[0]]});
 expect(teamViewFabricDestinations(hints,null)).toEqual({});expect(teamViewFabricDestinations(undefined,state)).toBeUndefined();
 expect(hints.source).toHaveLength(3);
});

// 示例数据：customer-2 名下只有订单 SO-G-2026-012。
const demo = () => { let n = 0; const state: any = createMistState({ id: () => `id-${++n}`, now: '2026-10-13T00:00:00Z', actorName: 'boss' } as any, 'demo');
  state.teamScopes = [{ teamId: 't1', teamName: 'Lune', conditions: [{ id: 'c1', customerId: 'customer-2' }], picks: [], exclusions: [], updatedAt: '', updatedById: 'boss', updatedBy: 'boss', history: [] }];
  return state; };

it('narrows the received data to the chosen group and leaves the "all" view untouched', () => {
  const state = demo();
  expect(teamViewState(state, ALL_TEAMS, 'demo-sales')).toBe(state);
  const view = teamViewState(state, 't1', 'demo-sales');
  expect(view.orders.map(o => o.id)).toEqual(['SO-G-2026-012']);
  expect(view.orderLines.every(line => line.orderId === 'SO-G-2026-012')).toBe(true);
  expect(view.customers).toHaveLength(state.customers.length); // 档案共享，不按视角收窄
  expect(view.tasks.filter(task => task.assigneeIds?.includes('demo-sales'))).toEqual(state.tasks.filter((task: any) => task.assigneeIds?.includes('demo-sales'))); // 本人待办保留
  expect(teamViewState(state, 't1', 'demo-sales')).toBe(view); // 同一份数据只计算一次
});

it('names the own groups a record is shared through', () => {
  const state = demo();
  expect(teamOrigins(state, [{ id: 't1', name: 'Maison Lune 组' }], 'order', 'SO-G-2026-012')).toEqual(['Maison Lune 组']);
  expect(teamOrigins(state, [{ id: 't1', name: 'Maison Lune 组' }], 'order', 'SO-G-2026-018')).toEqual([]);
  expect(teamOrigins(state, [{ id: 'other', name: '别组' }], 'order', 'SO-G-2026-012')).toEqual([]);
});

it('uses server-resolved group references when HR configuration is hidden', () => {
  const state = demo(); delete state.teamScopes;
  const views = { t1: [{kind: 'order' as const, id: 'SO-G-2026-012'}] };
  expect(teamViewState(state, 't1', 'demo-sales', views).orders.map(row => row.id)).toEqual(['SO-G-2026-012']);
  expect(teamViewState(state, 't2', 'demo-sales', views).orders).toEqual([]);
  expect(teamOrigins(state, [{id:'t1',name:'一组'}], 'order', 'SO-G-2026-012', views)).toEqual(['一组']);
});

it('preserves server partial financial redactions on a second group projection', () => {
  const state = demo();
  state.partialLettersOfCredit = [{id:'lc',code:'LC',lcNo:'LC',customerId:'customer-2',customer:'test',currency:'USD',orderIds:['SO-G-2026-012','SO-G-2026-018'],hiddenCount:3,cancelled:false}];
  state.partialExpenses = [{id:'expense', code:'E',category:'other',date:'2026-10-01',currency:'USD',shares:[{orderId:'SO-G-2026-012',amount:10},{orderId:'SO-G-2026-018',amount:20}],hiddenCount:2,voided:false}];
  const view = teamViewState(state, 't1', 'demo-sales');
  expect(view.partialLettersOfCredit?.[0]).toMatchObject({orderIds:['SO-G-2026-012'],hiddenCount:4});
  expect(view.partialExpenses?.[0]).toMatchObject({shares:[{orderId:'SO-G-2026-012',amount:10}],hiddenCount:3});
  expect(state.partialLettersOfCredit[0].hiddenCount).toBe(3);
});


it('preserves authorized order deposits when selecting a group before any invoice exists',()=>{
 const state=demo(),orderId='SO-G-2026-012',customerId=state.orders.find((row:any)=>row.id===orderId).customerId;
 state.receipts=[{id:'deposit',code:'BR-1',date:'2026-10-30',payer:'Customer',currency:'USD',amount:100,remaining:100,ref:'BANK-PRIVATE',state:'unmatched'}];
 state.allocations=[];state.invoices=[];state.orderFunding={assignments:[{id:'funding',receiptId:'deposit',customerId,orderId,amount:60,currency:'USD',state:'active',note:'Deposit',createdAt:'2026-10-30',updatedAt:'2026-10-30',actor:'Finance',history:[]}]};
 const received=applyDataScope(state,{userIds:[],teamIds:['t1']},'demo-sales');
 expect(received.receipts).toHaveLength(0);expect(received.partialReceipts).toHaveLength(1);expect(orderFundingCoveredAmount(received,orderId)).toBe(60);
 const group=teamViewState(received,'t1','demo-sales');
 expect(orderFundingCoveredAmount(group,orderId)).toBe(60);
 expect(group.partialReceipts).toEqual(received.partialReceipts);expect(group.receipts).toEqual([]);
 expect(JSON.stringify(group.partialReceipts)).not.toContain('BANK-PRIVATE');expect(group.partialReceipts?.[0]).not.toHaveProperty('amount');expect(group.partialReceipts?.[0]).not.toHaveProperty('remaining');
 const outside=teamViewState(received,'t2','demo-sales',{t2:[]});
 expect(outside.partialReceipts).toEqual([]);expect(outside.orderFunding?.assignments).toEqual([]);
});
