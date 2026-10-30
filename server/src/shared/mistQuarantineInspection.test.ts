import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { mistCommandPermission } from './mistWorkspace';

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

it('does not release against an unrelated or forged report',()=>{
 const f=fixture(),taskId=f.request().id!;
 const task=f.state.fulfillment.qcTasks.find(t=>t.id===taskId)!;task.state='reported';task.reportIds.push('fabric-report');
 const before=structuredClone(f.state);expect(()=>f.dispose()).toThrow('本批隔离料');expect(f.state).toEqual(before);
});
