import { expect, it } from 'vitest';
import { applyDataScope, scopedWriteViolation } from './mistDataScope';
import { assertOrderDepositCovered, orderDepositCoverage, orderFundingCoveredAmount } from './mistOrderFunding';
import { projectState } from '../mist/access';

it('keeps an upstream development read-only when a team only collaborates on its order', () => {
  const state: any = {
    customers: [{ id: 'customer', ownerId: 'another' }],
    crm: { opportunities: [], followUps: [] },
    devs: [{ id: 'upstream', customerId: 'customer', ownerId: 'another', values: {} }],
    market: { quotations: [], suppliers: [] },
    orders: [{ id: 'order', customerId: 'customer', ownerId: 'another', type: 'garment' }],
    orderLines: [{ id: 'line', orderId: 'order', sourceDevId: 'upstream' }],
    teamScopes: [{ teamId: 'team', conditions: [], picks: [{ kind: 'order', id: 'order' }], exclusions: [] }],
    fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [],
  };
  const scope = { userIds: ['member'], teamIds: ['team'] };
  expect(applyDataScope(state, scope, 'member').devs).toHaveLength(1);
  const after = structuredClone(state); after.devs[0].name = 'changed';
  expect(scopedWriteViolation(state, after, scope)).toMatchObject({ path: 'devs', id: 'upstream' });
});

it('does not expose totals for receipts allocated to out-of-scope invoices', () => {
  const state: any = {
    customers: [{ id: 'mine', ownerId: 'member' }, { id: 'other', ownerId: 'another' }],
    crm: { opportunities: [], followUps: [] }, devs: [], market: { quotations: [], suppliers: [] },
    orders: [{ id: 'order-mine', customerId: 'mine', ownerId: 'member', type: 'garment' }, { id: 'order-other', customerId: 'other', ownerId: 'another', type: 'garment' }],
    orderLines: [], invoices: [{ id: 'invoice-mine', orderId: 'order-mine' }, { id: 'invoice-other', orderId: 'order-other' }],
    receipts: [{ id: 'receipt', code: 'RC-1', date: '2026-10-01', payer: 'Customer', amount: 1000, remaining: 0, currency: 'USD', ref: '', state: 'matched' }], allocations: [{ id: 'a', invoiceId: 'invoice-mine', receiptId: 'receipt', amount: 400, currency: 'USD' }, { id: 'b', invoiceId: 'invoice-other', receiptId: 'receipt', amount: 600, currency: 'USD' }],
    fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [],
  };
  const projected: any = applyDataScope(state, { userIds: ['member'], teamIds: [] }, 'member');
  expect(projected.receipts.find((r: any) => r.id === 'receipt')).toBeUndefined();
  expect(projected.partialReceipts).toEqual([{ id: 'receipt', code: 'RC-1', date: '2026-10-01', payer: 'Customer', currency: 'USD', visibleAllocatedAmount: 400, hiddenCount: 1 }]);
  expect(orderFundingCoveredAmount(projected, 'order-mine')).toBe(400);
  const after = structuredClone(state); after.receipts[0].amount = 900;
  expect(scopedWriteViolation(state, after, { userIds: ['member'], teamIds: [] })).toMatchObject({ path: 'receipts', id: 'receipt' });
});

it.each(['owner', 'team', 'supervisor'] as const)('reads an uninvoiced order deposit through the %s scope without exposing shared receipt totals', mode => {
  const state: any = {
    customers: [{ id: 'customer', ownerId: 'another' }], crm: { opportunities: [], followUps: [] }, devs: [], market: { quotations: [], suppliers: [] },
    orders: [
      { id: 'mine', customerId: 'customer', ownerId: mode === 'owner' ? 'member' : 'another', type: 'fabric', amount: 1000, currency: 'USD', governance: { contract: { paymentMethod: 'TT', depositPercent: 30 } } },
      { id: 'other', customerId: 'customer', ownerId: 'another', type: 'garment', amount: 2000, currency: 'USD' },
    ],
    orderLines: [], invoices: [], allocations: [],
    receipts: [
      { id: 'shared', code: 'RC-1', date: '2026-10-29', payer: 'Customer', amount: 900, remaining: 900, currency: 'USD', ref: 'whole-bank-reference', state: 'unclaimed' },
      { id: 'unassigned', amount: 100, remaining: 100, currency: 'USD' },
      { id: 'released', amount: 80, remaining: 80, currency: 'USD' },
    ],
    orderFunding: { assignments: [
      { id: 'mine-deposit', receiptId: 'shared', orderId: 'mine', customerId: 'customer', amount: 300, currency: 'USD', state: 'active' },
      { id: 'other-deposit', receiptId: 'shared', orderId: 'other', customerId: 'customer', amount: 600, currency: 'USD', state: 'active' },
      { id: 'released-deposit', receiptId: 'released', orderId: 'mine', customerId: 'customer', amount: 80, currency: 'USD', state: 'released' },
    ] },
    teamScopes: [{ teamId: 'team', conditions: [], picks: [{ kind: 'order', id: 'mine' }], exclusions: [] }],
    fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [], files: [], settings: {},
  };
  const scope = { userIds: ['member'], teamIds: mode === 'team' ? ['team'] : [], ...(mode === 'supervisor' ? { lines: ['fabric'] as Array<'fabric'> } : {}) };
  const original = structuredClone(state);
  const actor: any = { userId: 'member', roles: [], permissions: ['orders:read', 'finance:read', 'invoices:read', 'vouchers:read'], authorizationLoaded: true };
  const projected = projectState(state, actor, () => ({}) as any, undefined, scope).state;
  expect(projected.receipts).toEqual([]);
  expect(projected.partialReceipts).toEqual([{ id: 'shared', code: 'RC-1', date: '2026-10-29', payer: 'Customer', currency: 'USD', visibleAllocatedAmount: 0, hiddenCount: 1 }]);
  expect(projected.orderFunding.assignments.map(row => row.id)).toEqual(['mine-deposit', 'released-deposit']);
  expect(orderDepositCoverage(projected, 'mine')).toMatchObject({ status: 'covered', required: 300, received: 300 });
  expect(() => assertOrderDepositCovered(state, 'mine')).not.toThrow();
  expect(() => assertOrderDepositCovered(projected, 'mine')).toThrow('归属的到账来源不存在');
  expect(JSON.stringify(projected)).not.toContain('whole-bank-reference');
  expect(state).toEqual(original);
  const withoutFinancialRead = projectState(state, { ...actor, permissions: ['orders:read'] }, () => ({}) as any, undefined, scope).state;
  expect(withoutFinancialRead.partialReceipts).toEqual([]);
  expect(withoutFinancialRead.orderFunding).toEqual([]);
});

it('redacts full documents and hidden lines from a shared shipment', () => {
  const state: any = {
    customers: [{ id: 'mine', ownerId: 'member' }, { id: 'other', ownerId: 'another' }], crm: { opportunities: [], followUps: [] }, devs: [], market: { quotations: [], suppliers: [] },
    orders: [{ id: 'order-mine', customerId: 'mine', ownerId: 'member', type: 'garment' }, { id: 'order-other', customerId: 'other', ownerId: 'another', type: 'garment' }],
    orderLines: [{ id: 'line-mine', orderId: 'order-mine' }, { id: 'line-other', orderId: 'order-other' }],
    fulfillment: { shipments: [{ id: 'shipment', lines: [{ orderId: 'order-mine', lineId: 'line-mine', quantity: 5 }, { orderId: 'order-other', lineId: 'line-other', quantity: 10 }], note: 'hidden details', fileIds: ['whole-file'], documentDispatches: [{ documentIds: ['document'] }] }], packing: [{ id: 'packing', lineId: 'line-mine', shipmentId: 'shipment' }], documents: [{ id: 'document', shipmentId: 'shipment', fileIds: ['whole-file'] }], customs: [{ id: 'customs', shipmentId: 'shipment', amount: 1000 }] },
    platform: {}, events: [], tasks: [], notifications: [], calendar: [],
  };
  const projected: any = applyDataScope(state, { userIds: ['member'], teamIds: [] }, 'member');
  expect(projected.fulfillment.shipments[0].lines.map((row: any) => row.orderId)).toEqual(['order-mine']);
  expect(projected.fulfillment.shipments[0]).toMatchObject({ hiddenCount: 1, note: '', fileIds: [], documentDispatches: [] });
  expect(projected.fulfillment.documents).toEqual([]);
  expect(projected.fulfillment.customs).toEqual([]);
  const after = structuredClone(state); after.fulfillment.shipments[0].note = 'changed';
  expect(scopedWriteViolation(state, after, {userIds:['member'],teamIds:[]})).toMatchObject({path:'fulfillment.shipments',id:'shipment'});
});

it('projects a shared frozen statement without exposing its totals or original file', () => {
  const state: any = {
    customers: [{ id: 'customer', ownerId: 'another' }], crm: { opportunities: [], followUps: [] }, devs: [], market: { quotations: [], suppliers: [] },
    orders: [{ id: 'mine', customerId: 'customer', ownerId: 'member', type: 'garment' }, { id: 'other', customerId: 'customer', ownerId: 'another', type: 'garment' }], orderLines: [],
    invoices: [{ id: 'i-mine', orderId: 'mine' }, { id: 'i-other', orderId: 'other' }], allocations: [], receipts: [],
    customerStatements: [{ id: 'statement', customerId: 'customer', statementNo: 'SOA-1', asOf: '2026-10-28', fileId: 'whole-statement', totals: [{ currency: 'USD', net: '1000.00' }], snapshot: { sections: [{ currency: 'USD', lines: [{ invoiceId: 'i-mine', open: '400.00' }, { invoiceId: 'i-other', open: '600.00' }], unapplied: [], net: '1000.00' }] } }],
    files: [{ id: 'whole-statement', uploadedBy: 'member' }], settings: { logoFileId: 'whole-statement' }, fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [],
  };
  const projected: any = applyDataScope(state, { userIds: ['member'], teamIds: [] }, 'member');
  const actor: any = { userId: 'member', roles: [], permissions: ['invoices:read'], authorizationLoaded: true };
  expect(projectState(state, actor, () => ({}) as any, undefined, { userIds: ['member'], teamIds: [] }).state.files).toEqual([]);
  expect(projected.customerStatements).toEqual([]);
  expect(projected.partialStatements).toEqual([{ id: 'statement', customerId: 'customer', statementNo: 'SOA-1', asOf: '2026-10-28', hiddenCount: 1, sections: [{ currency: 'USD', lines: [{ invoiceId: 'i-mine', open: '400.00' }], hiddenCount: 1 }] }]);
  expect(JSON.stringify(projected.partialStatements)).not.toContain('1000.00');
  expect(JSON.stringify(projected.partialStatements)).not.toContain('whole-statement');
});

it('prevents generating a full customer statement when its customer has a hidden invoice', async () => {
  const { canGenerateScopedStatement } = await import('./mistDataScope');
  const state: any = { customers: [{ id: 'customer', name: 'Customer', ownerId: 'another' }], crm: { opportunities: [], followUps: [] }, devs: [], market: { quotations: [], suppliers: [] },
    orders: [{ id: 'mine', customerId: 'customer', ownerId: 'member', type: 'garment' }, { id: 'other', customerId: 'customer', ownerId: 'another', type: 'garment' }], orderLines: [],
    invoices: [{ id: 'i-mine', orderId: 'mine' }, { id: 'i-other', orderId: 'other' }], allocations: [], receipts: [], fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [] };
  expect(canGenerateScopedStatement(state, { userIds: ['member'], teamIds: [] }, 'customer')).toBe(false);
  expect(canGenerateScopedStatement(state, { userIds: ['member', 'another'], teamIds: [] }, 'customer')).toBe(true);
});

it('does not expose financial facts belonging only to another order', () => {
  const state: any = { customers: [{id:'other',ownerId:'other'}], crm: {opportunities:[],followUps:[]}, devs:[], market:{quotations:[],suppliers:[]}, orders:[{id:'other-order',customerId:'other',ownerId:'other',type:'garment'}], orderLines:[], invoices:[],allocations:[],receipts:[],
    payments:[{id:'payment',amount:900}], financeReversals:[{id:'reversal',kind:'payment',targetId:'payment',amount:900}],
    payables:{bills:[{id:'bill',amount:900,lines:[{purchaseId:'purchase',amount:900}]}],payments:[{id:'supplier-payment',paymentId:'payment',purchaseId:'purchase',amount:900}],allocations:[],plans:[],requests:[],settlements:[],deductions:[],prepaymentMoves:[],reversals:[]},
    exportRebate:{rates:[],claims:[{id:'rebate',orderIds:['other-order'],expected:900}]}, fxRecords:[{id:'fx',amount:900}],
    fulfillment:{purchases:[{id:'purchase',orderId:'other-order'}]},platform:{},events:[],tasks:[],notifications:[],calendar:[] };
  const projected:any=applyDataScope(state,{userIds:['member'],teamIds:[]},'member');
  expect(projected.payments).toEqual([]);expect(projected.financeReversals).toEqual([]);expect(projected.payables.bills).toEqual([]);expect(projected.payables.payments).toEqual([]);expect(projected.exportRebate.claims).toEqual([]);expect(projected.fxRecords).toEqual([]);
});

it('retains provably linked payables for the visible purchase without exposing mixed bills', () => {
  const state: any = { customers: [{id:'mine',ownerId:'member'},{id:'other',ownerId:'other'}], crm: {opportunities:[],followUps:[]}, devs:[], market:{quotations:[],suppliers:[]}, orders:[{id:'mine-order',customerId:'mine',ownerId:'member',type:'garment'},{id:'other-order',customerId:'other',ownerId:'other',type:'garment'}], orderLines:[], invoices:[],allocations:[],receipts:[],payments:[{id:'payment-mine',amount:40},{id:'payment-other',amount:90}],
    payables:{bills:[{id:'bill-mine',amount:40,lines:[{purchaseId:'purchase-mine',amount:40}]},{id:'bill-mixed',amount:100,lines:[{purchaseId:'purchase-mine',amount:40},{purchaseId:'purchase-other',amount:60}]}],payments:[{id:'pay-mine',paymentId:'payment-mine',purchaseId:'purchase-mine',amount:40},{id:'pay-other',paymentId:'payment-other',purchaseId:'purchase-other',amount:90}],allocations:[],plans:[{id:'plan-mine',purchaseId:'purchase-mine'},{id:'plan-other',purchaseId:'purchase-other'}],requests:[],settlements:[],deductions:[],prepaymentMoves:[],reversals:[]},
    exportRebate:{rates:[],claims:[]},fulfillment:{purchases:[{id:'purchase-mine',orderId:'mine-order'},{id:'purchase-other',orderId:'other-order'}]},platform:{},events:[],tasks:[],notifications:[],calendar:[] };
  const projected:any=applyDataScope(state,{userIds:['member'],teamIds:[]},'member');
  expect(projected.payables.bills.map((x:any)=>x.id)).toEqual(['bill-mine']);expect(projected.partialPayableBills).toHaveLength(1);expect(projected.partialPayableBills[0].lines).toEqual([{purchaseId:'purchase-mine',amount:40}]);expect(projected.partialPayableBills[0].hiddenCount).toBe(1);expect(JSON.stringify(projected.partialPayableBills)).not.toContain('100');expect(projected.payables.payments.map((x:any)=>x.id)).toEqual(['pay-mine']);expect(projected.payables.plans.map((x:any)=>x.id)).toEqual(['plan-mine']);expect(projected.payments.map((x:any)=>x.id)).toEqual(['payment-mine']);
});

it('hides finance activity and notifications for an unrelated receipt', () => {
  const state: any = { customers: [],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[]},orders:[],orderLines:[],invoices:[],allocations:[],receipts:[{id:'hidden-receipt',amount:900,remaining:0}],fulfillment:{},platform:{},
    events:[{id:'event',entityType:'finance',entityId:'hidden-receipt',text:'900 USD'}],tasks:[],calendar:[],notifications:[{id:'notice',title:'900 USD',target:{view:'payment-vouchers',id:'hidden-receipt'}}] };
  const projected:any=applyDataScope(state,{userIds:['member'],teamIds:[]},'member');
  expect(projected.events).toEqual([]);expect(projected.notifications).toEqual([]);
});

it('hides the original amount and attachments of a letter of credit shared across scopes', () => {
  const state:any={customers:[{id:'mine',ownerId:'member'},{id:'other',ownerId:'another'}],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[]},orders:[{id:'mine-order',customerId:'mine',ownerId:'member',type:'garment'},{id:'other-order',customerId:'other',ownerId:'another',type:'garment'}],orderLines:[],invoices:[],allocations:[],receipts:[],
    letterOfCredits:[{id:'lc',code:'LC-1',lcNo:'LC-NO',customerId:'mine',customer:'Mine',currency:'USD',amount:1000,orderIds:['mine-order','other-order'],fileIds:['lc-file'],note:'whole bank amount'}],files:[{id:'lc-file',uploadedBy:'member'}],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
  const projected:any=applyDataScope(state,{userIds:['member'],teamIds:[]},'member');
  expect(projected.letterOfCredits).toEqual([]);
  expect(projected.partialLettersOfCredit).toEqual([{id:'lc',code:'LC-1',lcNo:'LC-NO',customerId:'mine',customer:'Mine',currency:'USD',orderIds:['mine-order'],hiddenCount:1,cancelled:false}]);
  expect(JSON.stringify(projected.partialLettersOfCredit)).not.toContain('1000');
  const after=structuredClone(state);after.letterOfCredits[0].amount=900;
  expect(scopedWriteViolation(state, after, {userIds:['member'],teamIds:[]})).toMatchObject({path:'letterOfCredits',id:'lc'});
});

it('allows only verifiable replacement shipment synchronization on an unrelated claim', () => {
  const state:any={customers:[],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[]},orders:[{id:'replacement',ownerId:'another',type:'garment',replacementSource:{claimId:'claim',dispositionId:'disposition'}}],orderLines:[{id:'replacement-line',orderId:'replacement'}],invoices:[],allocations:[],receipts:[],fulfillment:{shipments:[]},platform:{claims:[{id:'claim',orderId:'hidden',problem:'private',dispositions:[{id:'disposition',replacementOrderId:'replacement'}]}]},events:[],tasks:[],notifications:[],calendar:[]};
  const scope={userIds:['member'],teamIds:[]}, after=structuredClone(state);after.platform.claims[0].dispositions[0].replacementShipments=[];
  expect(scopedWriteViolation(state,after,scope)).toBeNull();
  after.platform.claims[0].problem='tampered';expect(scopedWriteViolation(state,after,scope)).toMatchObject({path:'platform.claims',id:'claim'});
  after.platform.claims[0].problem='private';after.platform.claims[0].dispositions[0].replacementShipments=[{shipmentId:'forged',code:'x',quantity:2,departedAt:'today'}];expect(scopedWriteViolation(state,after,scope)).toMatchObject({path:'platform.claims',id:'claim'});
});

it('keeps a shared product attachment visible when an unrelated hidden order also references it',()=>{const state:any={customers:[{id:'mine',ownerId:'member'},{id:'other',ownerId:'other'}],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[],products:[{id:'product',fileIds:['shared-file']}]},orders:[{id:'mine-order',customerId:'mine',ownerId:'member',type:'garment'},{id:'hidden-order',customerId:'other',ownerId:'other',type:'garment',fileIds:['shared-file']}],orderLines:[],invoices:[],allocations:[],receipts:[],files:[{id:'shared-file'}],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};const actor:any={userId:'member',roles:[],permissions:['products:read','orders:read'],authorizationLoaded:true};const projected=projectState(state,actor,()=>({}) as any,undefined,{userIds:['member'],teamIds:[]});expect(projected.state.files.map(file=>file.id)).toContain('shared-file');});

it('scopes stock movements, sample movements and order expenses with their own source records',()=>{
 const state:any={customers:[{id:'mine',ownerId:'member'},{id:'other',ownerId:'other'}],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[]},orders:[{id:'mine-order',customerId:'mine',ownerId:'member',type:'garment'},{id:'other-order',customerId:'other',ownerId:'other',type:'garment'}],orderLines:[],invoices:[],allocations:[],receipts:[],
 fulfillment:{stock:[{id:'stock-mine',orderId:'mine-order'},{id:'stock-other',orderId:'other-order'}],stockMovements:[{id:'movement-mine',stockId:'stock-mine'},{id:'movement-other',stockId:'stock-other'}],samples:[{id:'sample-mine',source:{kind:'orderLine',orderId:'mine-order'}},{id:'sample-other',source:{kind:'orderLine',orderId:'other-order'}}],sampleMovements:[{id:'sample-movement-mine',sampleId:'sample-mine'},{id:'sample-movement-other',sampleId:'sample-other'}]},
 orderCosts:{expenses:[{id:'expense-mine',amount:100,shares:[{orderId:'mine-order',amount:100}]},{id:'expense-other',amount:500,shares:[{orderId:'other-order',amount:500}]},{id:'expense-shared',amount:600,shares:[{orderId:'mine-order',amount:100},{orderId:'other-order',amount:500}]}]},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
 const view:any=applyDataScope(state,{userIds:['member'],teamIds:[]},'member');
 expect(view.fulfillment.stock.map((x:any)=>x.id)).toEqual(['stock-mine']);expect(view.fulfillment.stockMovements.map((x:any)=>x.id)).toEqual(['movement-mine']);expect(view.fulfillment.sampleMovements.map((x:any)=>x.id)).toEqual(['sample-movement-mine']);expect(view.orderCosts.expenses.map((x:any)=>x.id)).toEqual(['expense-mine']);expect(view.partialExpenses).toEqual([{id:'expense-shared',code:undefined,category:undefined,date:undefined,currency:undefined,shares:[{orderId:'mine-order',amount:100}],hiddenCount:1,voided:false}]);
});

it('does not leak a sensitive unscoped notification without a record target',()=>{
 const state:any={customers:[],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[]},orders:[],orderLines:[],invoices:[],allocations:[],receipts:[],fulfillment:{},platform:{},events:[],tasks:[],calendar:[],notifications:[{id:'n',title:'Other business amount',target:{view:'payment-vouchers'}}]};
 expect(applyDataScope(state,{userIds:['member'],teamIds:[]},'member').notifications).toEqual([]);
});

it('shows and permits only the actor’s attributed development drafts',()=>{
 const state:any={customers:[],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[]},orders:[],orderLines:[],invoices:[],allocations:[],receipts:[],drafts:[{id:'mine',ownerId:'member',values:{},fileIds:[]},{id:'other',ownerId:'other',values:{},fileIds:[]}],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
 const scope={userIds:['member'],teamIds:[]};expect(applyDataScope(state,scope,'member').drafts.map(row=>row.id)).toEqual(['mine']);
 const other=structuredClone(state);other.drafts[1].values.name='changed';expect(scopedWriteViolation(state,other,scope)).toMatchObject({path:'drafts',id:'other'});
 const mine=structuredClone(state);mine.drafts[0].values.name='changed';expect(scopedWriteViolation(state,mine,scope)).toBeNull();
});

it('checks direct business targets before validation while leaving assigned decisions to the approval gate',async()=>{
 const {scopedTargetViolation}=await import('./mistDataScope');
 const state:any={customers:[],crm:{opportunities:[],followUps:[]},devs:[{id:'private-dev',ownerId:'other',values:{}}],drafts:[],market:{quotations:[],suppliers:[]},orders:[{id:'private-order',ownerId:'other',type:'garment'}],orderLines:[],invoices:[],allocations:[],receipts:[],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
 const scope={userIds:['member'],teamIds:[]};
 expect(scopedTargetViolation(state,scope,{type:'order.governance.submit',payload:{orderId:'private-order'}})).toMatchObject({path:'orders'});
 expect(scopedTargetViolation(state,scope,{type:'development.notice.generate',payload:{devId:'private-dev'}})).toMatchObject({path:'devs'});
 expect(scopedTargetViolation(state,scope,{type:'order.governance.decide',payload:{id:'private-order'}})).toBeNull();
 expect(scopedTargetViolation(state,scope,{type:'development.saveDraft',payload:{}})).toBeNull();
 expect(scopedTargetViolation(state,scope,{type:'finance.account.save',payload:{name:'new'}})).toMatchObject({path:'bankAccounts'});
});

it('does not expand a supplier-scoped read-only order into unrelated downstream records',()=>{
 const state:any={customers:[{id:'c',ownerId:'other'}],crm:{opportunities:[],followUps:[]},devs:[],market:{quotations:[],suppliers:[{id:'supplier',name:'Selected'}]},orders:[{id:'o',customerId:'c',ownerId:'other',type:'garment'}],orderLines:[{id:'l',orderId:'o'}],invoices:[],allocations:[],receipts:[],
 fulfillment:{purchases:[{id:'p1',orderId:'o',supplierId:'supplier'},{id:'p2',orderId:'o',supplierId:'other-supplier'}],shipments:[{id:'s',lines:[{orderId:'o',lineId:'l'}],fileIds:[]}],packing:[]},orderCosts:{expenses:[{id:'expense',shares:[{orderId:'o',amount:100}]}]},platform:{},teamScopes:[{teamId:'team',conditions:[{supplierId:'supplier'}],picks:[],exclusions:[]}],events:[],tasks:[],notifications:[],calendar:[]};
 const view:any=applyDataScope(state,{userIds:['member'],teamIds:['team']},'member');
 expect(view.orders.map((r:any)=>r.id)).toEqual(['o']);expect(view.fulfillment.purchases.map((r:any)=>r.id)).toEqual(['p1']);
 expect(view.fulfillment.shipments).toEqual([]);expect(view.orderCosts.expenses).toEqual([]);
});

it('does not reveal another order follow-up merely because one order of the customer is visible',()=>{
 const state:any={customers:[{id:'c',ownerId:'other'}],crm:{opportunities:[],followUps:[{id:'own-note',customerId:'c',link:{kind:'order',id:'own'}},{id:'hidden-note',customerId:'c',link:{kind:'order',id:'hidden'}},{id:'customer-note',customerId:'c',link:null}]},devs:[],market:{quotations:[],suppliers:[]},orders:[{id:'own',customerId:'c',ownerId:'member',type:'garment'},{id:'hidden',customerId:'c',ownerId:'other',type:'garment'}],orderLines:[],invoices:[],allocations:[],receipts:[],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
 const view:any=applyDataScope(state,{userIds:['member'],teamIds:[]},'member');
 expect(view.crm.followUps.map((r:any)=>r.id)).toEqual(['own-note']);
});

it('rejects references that would bring hidden source records into a new visible business chain',async()=>{
 const {scopedReferenceViolation}=await import('./mistDataScope');
 const state:any={customers:[],crm:{opportunities:[],followUps:[]},devs:[{id:'private-source',ownerId:'other',values:{}}],market:{quotations:[],suppliers:[]},orders:[],orderLines:[],invoices:[],allocations:[],receipts:[],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
 expect(scopedReferenceViolation(state,{userIds:['member'],teamIds:[]},{input:{sourceDevId:'private-source'}})).toMatchObject({path:'devs',id:'private-source'});
});

it('permits only the exact lineage of a shared product in product-backed inputs',async()=>{
 const {scopedReferenceViolation}=await import('./mistDataScope');
 const state:any={customers:[],crm:{opportunities:[],followUps:[]},devs:[{id:'source',ownerId:'other',values:{}},{id:'other-source',ownerId:'other',values:{}}],versions:[{id:'version',devId:'source'}],market:{quotations:[],suppliers:[],products:[{id:'product',sourceDevId:'source',sourceVersionId:'version'}]},orders:[],orderLines:[],invoices:[],allocations:[],receipts:[],fulfillment:{},platform:{},events:[],tasks:[],notifications:[],calendar:[]};
 const payload={input:{lines:[{productId:'product',sourceDevId:'source',sourceVersionId:'version'}]}};
 expect(scopedReferenceViolation(state,{userIds:['member'],teamIds:[]},payload,true)).toBeNull();
 expect(scopedReferenceViolation(state,{userIds:['member'],teamIds:[]},payload)).toMatchObject({id:'source'});
 payload.input.lines[0].sourceDevId='other-source';expect(scopedReferenceViolation(state,{userIds:['member'],teamIds:[]},payload,true)).toMatchObject({id:'other-source'});
});
