import {expect,it} from 'vitest';
import {projectState} from './access';
import {createMistState} from '../shared/mistWorkspace';
import {orderActualCost} from '../shared/mistOrderCost';
import {frozenCreditDocumentFixture,CREDIT_DOCUMENT_IDS as ids} from './__tests__/creditDocumentsFixture';
const scopes=['orders:read','procurement:read','invoices:read','vouchers:read','reports:admin'];
function fixture(){const state=frozenCreditDocumentFixture({id:'proof',name:'private-approval.txt',mimeType:'text/plain',size:1} as any);state.orders[0].ownerId='finance';state.customers[0].ownerId='finance';state.fxPeriodRates=[{id:'period',currency:'USD',month:'2026-10',rate:'1'}] as any;state.fulfillment.purchases=[{id:'po',code:'PO',orderId:ids.order,lineId:'line-fixture',kind:'finished',state:'approved',quantity:1,price:30,currency:'CNY'} as any];state.payables!.bills=[];return state;}
const actor=(permissions=scopes)=>({userId:'finance',roles:[],permissions,authorizationLoaded:true,departmentIds:[]} as any);
const empty=()=>createMistState({id:()=>'',now:'2026-10-14T00:00:00Z',actorName:'Finance'},'empty');
it('preserves net credit income for a financial reader without exposing hidden case or approval details',()=>{
  const state=fixture(),before=structuredClone(state),view=projectState(state,actor(),empty);
  expect(view.state.platform.claims).toEqual([]);expect(view.state.platform.credits).toEqual([]);
  expect(view.costClaimBasis).toEqual([{orderId:ids.order,credits:[{currency:'USD',amount:15}],recoveries:[]}]);
  expect(orderActualCost(view.state,ids.order,'period','2026-10','2026-10-14',view.costMaterialBasis,view.costClaimBasis)).toMatchObject({revenueCny:45,marginEx:15});
  expect(JSON.stringify(view.costClaimBasis)).not.toMatch(/claimId|supplier|receiptId|proof|approval|note|file/);expect((view.state as any).costClaimBasis).toBeUndefined();expect(state).toEqual(before);
});
it('requires all financial read grants and returns no unrelated row-scoped totals',()=>{
  const state=fixture();for(const scope of scopes)expect(projectState(state,actor(scopes.filter(item=>item!==scope)),empty).costClaimBasis).toBeUndefined();
  expect(projectState(state,actor(),empty,undefined,{userIds:['outsider'],teamIds:[]}).costClaimBasis).toEqual([]);
});
it('ignores restored metadata lookalikes and refuses a missing response basis',()=>{
  const state=fixture();(state as any).costClaimBasis=[{orderId:ids.order,credits:[],recoveries:[]}];const view=projectState(state,actor(),empty);
  expect(view.costClaimBasis![0].credits).toEqual([{currency:'USD',amount:15}]);expect((view.state as any).costClaimBasis).toBeUndefined();
  expect(()=>orderActualCost(view.state,ids.order,'period','2026-10','2026-10-14',undefined,null)).toThrow('依据未读取');
  expect(()=>orderActualCost(view.state,ids.order,'period','2026-10','2026-10-14',undefined,[])).toThrow('不完整');
});
it('keeps ordinary workspace data readable while a malformed credit blocks only its financial calculation',()=>{
  const state=fixture();state.platform.credits[0].currentAmount=999;const before=structuredClone(state),view=projectState(state,actor(),empty);
  expect(view.costClaimBasis).toBeNull();expect(view.state.orders[0].id).toBe(ids.order);expect(state).toEqual(before);
});
