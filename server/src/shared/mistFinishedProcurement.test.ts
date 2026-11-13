import {describe,it,expect} from 'vitest';
import {fixture} from '../mist/__tests__/professionalFulfillment';
import type {MistCommand} from './mistWorkspace';

function setup(family:'garment'|'fabric'='garment',garmentUnit='件'){
 const f=fixture();f.state.orders[0].type=family;
 Object.assign(f.state.orderLines[0],{fulfillmentMode:'full_package',cmtIncludedItems:[],unit:family==='garment'?garmentUnit:'米'});
 f.context.authority!.supplier[`supplierCommitment.approvers.purchase.${family}`]={version:1,userIds:['reviewer']};f.approveOrder();
 const input={orderId:f.orderId,lineId:f.state.orderLines[0].id,kind:'finished' as const,supplierId:'supplier',description:'成品',quantity:10,unit:family==='garment'?garmentUnit:'米',price:2,currency:'CNY',due:'2026-10-30',terms:'收货验收后付款',destination:'公司仓库',note:'',fileIds:[]};
 return{f,input};
}
function approve(f:ReturnType<typeof fixture>,id:string){f.run({type:'fulfillment.procurement.submit',payload:{id}});f.run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'核对通过'}},{...f.context,actorId:'reviewer'});}

describe('finished garment procurement quantity and unit',()=>{
 it.each(['米','套'])('rejects %s for a garment line sold in pieces before persisting a draft',unit=>{
  const {f,input}=setup(),before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.procurement.save',payload:{...input,unit}})).toThrow(/成衣成品.*单位.*一致/);
  expect(JSON.stringify(f.state)).toBe(before);
 });
 it.each([.5,10.5])('rejects a fractional finished garment quantity %s',quantity=>{
  const {f,input}=setup(),before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.procurement.save',payload:{...input,quantity}})).toThrow(/成衣成品数量须为整数/);
  expect(JSON.stringify(f.state)).toBe(before);
 });
 it('keeps a matching whole-piece purchase approvable and creates exactly one production branch',()=>{
  const {f,input}=setup(),id=f.run({type:'fulfillment.procurement.save',payload:input}).id!;approve(f,id);
  expect(f.state.fulfillment.purchases.find(p=>p.id===id)).toMatchObject({state:'approved',unit:'件',quantity:10});
  expect(f.state.productions.filter(p=>p.sourcePurchaseId===id)).toHaveLength(1);
 });
 it('keeps fractional fabric quantities available in their own units',()=>{
  const {f,input}=setup('fabric'),id=f.run({type:'fulfillment.procurement.save',payload:{...input,quantity:.5}}).id!;
  expect(f.state.fulfillment.purchases.find(p=>p.id===id)).toMatchObject({unit:'米',quantity:.5});
 });
 it('keeps whole-set garment purchases valid when the order also uses sets',()=>{
  const {f,input}=setup('garment','套'),id=f.run({type:'fulfillment.procurement.save',payload:input}).id!;approve(f,id);
  expect(f.state.fulfillment.purchases.find(p=>p.id===id)).toMatchObject({state:'approved',unit:'套',quantity:10});
 });
 it.each(['submit','decide','send','confirm','receive'] as const)('rechecks a self-consistent legacy wrong unit at %s',stage=>{
  const {f,input}=setup(),id=f.run({type:'fulfillment.procurement.save',payload:input}).id!;
  if(stage!=='submit')f.run({type:'fulfillment.procurement.submit',payload:{id}});
  if(!['submit','decide'].includes(stage))f.run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'核对通过'}},{...f.context,actorId:'reviewer'});
  if(['confirm','receive'].includes(stage))f.run({type:'fulfillment.procurement.send',payload:{id,at:f.context.now,evidence:'已线下交付',fileIds:[]}});
  if(stage==='receive')f.run({type:'fulfillment.procurement.confirm',payload:{id,at:f.context.now,confirmedDue:input.due,evidence:'供应商已确认',fileIds:[]}});
  const purchase=f.state.fulfillment.purchases.find(p=>p.id===id)!;purchase.unit='米';
  // Emulate a historical record and its original submitted unit, not a post-submit client edit.
  purchase.revisionHistory?.forEach(revision=>revision.snapshot.unit='米');
  const before=JSON.stringify(f.state),commands:Record<typeof stage,MistCommand>={
   submit:{type:'fulfillment.procurement.submit',payload:{id}},
   decide:{type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'核对'}},
   send:{type:'fulfillment.procurement.send',payload:{id,at:f.context.now,evidence:'交付',fileIds:[]}},
   confirm:{type:'fulfillment.procurement.confirm',payload:{id,at:f.context.now,confirmedDue:input.due,evidence:'确认',fileIds:[]}},
   receive:{type:'fulfillment.procurement.receive',payload:{id,quantity:10,rejected:0,destination:'supplier',location:'工厂',date:'2026-10-13',evidence:'点数',fileIds:[]}},
  };
  expect(()=>f.run(commands[stage],stage==='decide'?{...f.context,actorId:'reviewer'}:f.context)).toThrow(/成衣成品.*单位.*一致/);
  expect(JSON.stringify(f.state)).toBe(before);
 });
 it('rejects a fractional quantity in a new contract amendment',()=>{
  const {f,input}=setup(),id=f.run({type:'fulfillment.procurement.save',payload:input}).id!;approve(f,id);const before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.procurement.amend',payload:{id,quantity:9.5,price:2,due:input.due,reason:'客户调整',evidence:'书面确认',fileIds:[]}})).toThrow(/成衣成品数量须为整数/);
  expect(JSON.stringify(f.state)).toBe(before);
 });
 it('rechecks the target of a historical pending amendment when approving it',()=>{
  const {f,input}=setup(),id=f.run({type:'fulfillment.procurement.save',payload:input}).id!;approve(f,id);
  const amendmentId=f.run({type:'fulfillment.procurement.amend',payload:{id,quantity:9,price:2,due:input.due,reason:'客户调整',evidence:'书面确认',fileIds:[]}}).id!;
  f.state.fulfillment.purchases.find(p=>p.id===id)!.amendments![0].to.quantity=9.5;const before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.procurement.amend.decide',payload:{id:amendmentId,decision:'approved',note:'核对'}},{...f.context,actorId:'reviewer'})).toThrow(/成衣成品数量须为整数/);
  expect(JSON.stringify(f.state)).toBe(before);
 });
});
