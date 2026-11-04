import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { mistCommandPermission } from './mistWorkspace';
import { internalFabricCostShare, materialDeliveryRows } from './mistInternalFabric';
import { orderActualCost } from './mistOrderCost';
import { financialDisposalViews } from './mistPayables';

function fixture() {
  const f=materialDeliveryFixture(20); f.context.members!.push({id:'qc',name:'Fabric QC',active:true,groups:[]});
  const issue=f.issue(20);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id:issue,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted at factory'}},'garment');
  const stock=f.state.fulfillment.stock[0];
  const returned=f.run({type:'fulfillment.inventory.move',payload:{id:stock.id,kind:'return',issueId:issue,quantity:4,location:'Hold A',person:'warehouse',note:'Defect return'}}).id!;
  const request=()=>f.run({type:'fulfillment.inventory.quarantine.request',payload:{returnId:returned,due:'2026-10-24'}} as never);
  const dispose=()=>f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:returned,decision:'release',evidence:'Approved for use'}} as never);
  return {...f,get state(){return f.state;},issue,returned,request,dispose};
}

it('routes a specific returned quantity to QC and releases it only after its own passing report',()=>{
  const f=fixture(),originalQc=structuredClone(f.state.fulfillment.qcTasks.find(t=>t.id==='fabric-qc'));expect(()=>f.dispose()).toThrow();
  const taskId=f.request().id!;
  expect(()=>f.request()).toThrow();
  expect(f.state.fulfillment.qcTasks.find(t=>t.id===taskId)).toMatchObject({kind:'quarantine',domain:'fabric',quarantine:{returnId:f.returned,quantity:4,unit:'米'}});
  expect(mistCommandPermission({type:'fulfillment.inventory.quarantine.request',payload:{returnId:f.returned,due:'2026-10-24'}} as never)).toBe('inventory:write');
  f.run({type:'fulfillment.qc.claim',payload:{id:taskId,domain:'fabric'}},'qc');
  expect(()=>f.run({type:'fulfillment.qc.report',payload:{id:taskId,domain:'fabric',result:'pass',report:'BAD',opinion:'Not my task',location:'Hold A',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'owner')).toThrow('认领');
  f.run({type:'fulfillment.qc.report',payload:{id:taskId,domain:'fabric',result:'reject',report:'RET-001',opinion:'Defect',location:'Hold A',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
  expect(()=>f.dispose()).toThrow();expect(f.state.fulfillment.stock[0]).toMatchObject({available:0,locked:4});
  f.run({type:'fulfillment.qc.report',payload:{id:taskId,domain:'fabric',result:'pass',report:'RET-002',opinion:'Rechecked after treatment',location:'Hold A',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
  f.dispose();expect(f.state.fulfillment.stock[0]).toMatchObject({available:4,locked:0});
  expect(f.state.fulfillment.qcTasks.find(t=>t.id==='fabric-qc')).toEqual(originalQc);
  expect(f.state.fulfillment.stockMovements.find(m=>m.id===f.returned)?.quarantineDisposition).toMatchObject({decision:'release',taskId});
  expect(()=>f.dispose()).toThrow();
});

for (const decision of ['supplierReturn','scrap'] as const) it(`records ${decision} only against the latest failed report without rewriting financial or receipt facts`,()=>{
  const f=fixture(),taskId=f.request().id!;
  const dispose=()=>f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:f.returned,decision,evidence:'已核实实际处置依据'}} as never);
  expect(()=>dispose()).toThrow('复检');
  f.run({type:'fulfillment.qc.claim',payload:{id:taskId,domain:'fabric'}},'qc');
  f.run({type:'fulfillment.qc.report',payload:{id:taskId,domain:'fabric',result:'reject',report:'FAIL-1',opinion:'Defect',location:'Hold A',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
  const before=structuredClone({receipts:f.state.fulfillment.receipts,purchases:f.state.fulfillment.purchases,payables:f.state.payables});
  dispose();const row=f.state.fulfillment.stockMovements.find(m=>m.id===f.returned)!;
  expect(row.quarantineDisposition).toMatchObject({decision,taskId,evidence:'已核实实际处置依据'});
  const record=f.state.fulfillment.stockMovements.find(m=>m.id===row.quarantineDisposition!.movementId)!;
  expect(record).toMatchObject({kind:decision==='scrap'?'scrap':'reject',quantity:4,quarantineReturnId:f.returned});
  expect(f.state.fulfillment.stock[0]).toMatchObject({locked:0,available:0});
  expect(f.state.fulfillment.qcTasks.find(t=>t.id===taskId)).toMatchObject({state:'reported',quarantine:{disposedAt:f.context.now}});
  expect(f.state.fulfillment.qcReports.find(r=>r.taskId===taskId)?.result).toBe('reject');
  expect({receipts:f.state.fulfillment.receipts,purchases:f.state.fulfillment.purchases,payables:f.state.payables}).toEqual(before);
  expect(()=>dispose()).toThrow('已处置');
});

it('does not dispose under an obsolete failed report after the same batch has passed reinspection',()=>{
  const f=fixture(),taskId=f.request().id!;
  f.run({type:'fulfillment.qc.claim',payload:{id:taskId,domain:'fabric'}},'qc');
  for(const result of ['reject','pass'] as const)f.run({type:'fulfillment.qc.report',payload:{id:taskId,domain:'fabric',result,report:'R-'+result,opinion:'Recheck',location:'Hold A',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
  expect(()=>f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:f.returned,decision:'scrap',evidence:'旧结论'}} as never)).toThrow('最新的不合格');
});

it('does not release against an unrelated or forged report',()=>{
 const f=fixture(),taskId=f.request().id!;
 const task=f.state.fulfillment.qcTasks.find(t=>t.id===taskId)!;task.state='reported';task.reportIds.push('fabric-report');
 const before=structuredClone(f.state);expect(()=>f.dispose()).toThrow('本批隔离料');expect(f.state).toEqual(before);
});

it('releases one rejected return, scraps the other and reviews no recovery without duplicating inventory or purchase cost',()=>{
 const f=materialDeliveryFixture(20);f.context.members!.push({id:'qc',name:'QC',active:true,groups:[]});
 const issue=f.issue(20),stockId=f.state.fulfillment.stock[0].id;
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id:issue,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Factory count'}},'garment');
 const returned=(quantity:number,location:string)=>f.run({type:'fulfillment.inventory.move',payload:{id:stockId,kind:'return',issueId:issue,quantity,location,person:'factory',note:'Actual rejection return'}}).id!;
 const release=returned(1.5,'Hold A'),scrap=returned(2.5,'Hold B');
 expect(f.state.fulfillment.stock[0]).toMatchObject({available:0,locked:4,quantity:20});
 const receipt=f.state.fulfillment.receipts.find(r=>r.id===f.state.fulfillment.stock[0].receiptId)!;
 const settlement=f.run({type:'payable.settlement.submit',payload:{purchaseId:f.purchaseId,receiptIds:[receipt.id],final:true}}).id!;
 f.run({type:'payable.settlement.confirm',payload:{id:settlement,prepaymentApplied:0}},'reviewer');
 const financeBefore=structuredClone({payables:f.state.payables,payments:f.state.payments,receipts:f.state.fulfillment.receipts});
 const cost=()=>[f.source.orderId,f.target.orderId].map(id=>orderActualCost(f.state,id,'period','2026-10','2026-10-24'));
 const costBefore=cost();
 for(const [returnId,decision,result] of [[release,'release','pass'],[scrap,'scrap','reject']] as const){
  const task=f.run({type:'fulfillment.inventory.quarantine.request',payload:{returnId,due:'2026-10-24'}}).id!;
  f.run({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}},'qc');
  f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result,report:'QC-'+returnId,opinion:'Actual reinspection',location:decision==='release'?'Hold A':'Hold B',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
  f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId,decision,evidence:'Actual disposition'}});
 }
 expect(f.state.fulfillment.stock[0]).toMatchObject({quantity:20,available:1.5,locked:0});
 expect(f.state.fulfillment.stock[0].positions).toContainEqual({location:'Hold A',available:1.5});
 expect(materialDeliveryRows(f.state)[0]).toMatchObject({accepted:'16',returned:'4',outstanding:'16'});
 expect(internalFabricCostShare(f.state,f.purchaseId,f.source.orderId,136000)).toBe(27200);
 expect(internalFabricCostShare(f.state,f.purchaseId,f.target.orderId,136000)).toBe(108800);
 f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:scrap,evidence:'Leader approved unrecoverable loss'}},'reviewer');
 f.run({type:'payable.disposal.review',payload:{returnId:scrap,evidence:'No compensation; retain original supplier settlement'}});
 expect(financialDisposalViews(f.state,new Set([f.purchaseId]))).toMatchObject([{returnId:scrap,quantity:2.5,referenceAmount:170,decision:'scrap',review:{actor:'Fabric'}}]);
 expect(cost()).toEqual(costBefore);
 expect({payables:f.state.payables,payments:f.state.payments,receipts:f.state.fulfillment.receipts}).toEqual(financeBefore);
 const before=structuredClone(f.state);
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId:release,evidence:'Passed goods'}},'reviewer')).toThrow('已退供或报废');
 expect(()=>f.run({type:'payable.disposal.review',payload:{returnId:scrap,evidence:'Duplicate'}})).toThrow('已核对');
 expect(()=>f.run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:scrap,decision:'scrap',evidence:'Duplicate'}})).toThrow('已处置');
 expect(f.state).toEqual(before);
 expect(f.state.fulfillment.stockMovements.filter(m=>m.kind==='scrap'&&m.quarantineReturnId===scrap)).toHaveLength(1);
});
