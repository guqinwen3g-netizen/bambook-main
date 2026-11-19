import {describe,expect,it} from 'vitest';
import {fixture} from '../mist/__tests__/professionalFulfillment';
import type {MistCommand} from './mistWorkspace';

function setup(family:'garment'|'fabric'='garment'){
 const f=fixture();f.state.orders[0].type=family;
 Object.assign(f.state.orderLines[0],{fulfillmentMode:'full_package',cmtIncludedItems:[],unit:family==='garment'?'件':'米'});
 f.context.authority!.supplier[`supplierCommitment.approvers.purchase.${family}`]={version:1,userIds:['reviewer']};f.approveOrder();
 const id=f.run({type:'fulfillment.procurement.save',payload:{orderId:f.orderId,lineId:f.state.orderLines[0].id,kind:'finished',supplierId:'supplier',description:'成品',quantity:10,unit:family==='garment'?'件':'米',price:2,currency:'CNY',due:'2026-10-30',terms:'验收后付款',destination:'公司仓库',note:'',fileIds:[]}}).id!;
 f.run({type:'fulfillment.procurement.submit',payload:{id}});f.run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'核对通过'}},{...f.context,actorId:'reviewer'});f.confirmContract(id);
 if(family==='garment'){
  const productionId=f.state.productions[0].id;f.run({type:'fulfillment.production.plan',payload:{productionId,sizes:[{size:'M',quantity:4},{size:'L',quantity:6}]}});f.sample(productionId,'pp','M');f.run({type:'fulfillment.production.release',payload:{productionId,note:'条件齐备'}});
 }
 const receive=(quantity:number,rejected:number)=>f.run({type:'fulfillment.procurement.receive',payload:{id,quantity,rejected,destination:'warehouse',location:'公司仓库',date:'2026-10-13',evidence:'点数交接',fileIds:[]}}).id!;
 return{f,id,receive};
}
function rejectsUnchanged(f:ReturnType<typeof fixture>,command:MistCommand){const before=JSON.stringify(f.state);expect(()=>f.run(command)).toThrow(/成衣.*数量须为整数/);expect(JSON.stringify(f.state)).toBe(before);}

describe('physical garment receipt quantities',()=>{
 it.each([[.5,0],[0,.5],[8.5,1],[8,1.5]])('rejects fractional received/rejected quantities %s/%s atomically',(quantity,rejected)=>{
  const {f,id}=setup();rejectsUnchanged(f,{type:'fulfillment.procurement.receive',payload:{id,quantity,rejected,destination:'warehouse',location:'公司仓库',date:'2026-10-13',evidence:'点数',fileIds:[]}});
 });
 it('rejects a fractional garment processing handover',()=>{
  const f=fixture(),{purchaseId}=f.released();rejectsUnchanged(f,{type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:.5,rejected:0,destination:'supplier',location:'加工厂',date:'2026-10-13',evidence:'交接',fileIds:[]}});
 });
 it('rejects a fractional post-receipt rejection without removing stock',()=>{
  const{f,receive}=setup(),receiptId=receive(8,2);rejectsUnchanged(f,{type:'fulfillment.procurement.rejectReceived',payload:{receiptId,quantity:.5,location:'拒收区',evidence:'转拒收'}});
 });
 it('rejects a fractional rejected-goods return without consuming rejected quantities',()=>{
  const{f,receive}=setup(),receiptId=receive(8,2);rejectsUnchanged(f,{type:'fulfillment.procurement.return',payload:{receiptId,quantity:.5,disposition:'replace',date:'2026-10-13',evidence:'供方确认'}});
 });
 it('keeps whole-piece receipt, rejection and replacement-return histories consistent',()=>{
  const{f,id,receive}=setup(),receiptId=receive(8,2);f.run({type:'fulfillment.procurement.rejectReceived',payload:{receiptId,quantity:1,location:'拒收区',evidence:'复核发现缺陷'}});
  f.run({type:'fulfillment.procurement.return',payload:{receiptId,quantity:3,disposition:'replace',date:'2026-10-13',evidence:'供方同意补发'}});
  expect(f.state.fulfillment.purchases.find(x=>x.id===id)?.received).toBe(7);expect(f.state.fulfillment.receipts.find(x=>x.id===receiptId)).toMatchObject({quantity:7,rejected:3,returns:[{quantity:3,disposition:'replace'}]});expect(f.state.fulfillment.stock.find(x=>x.receiptId===receiptId)?.available).toBe(7);
 });
 it('keeps fractional fabric receipt, rejection and return valid in metres',()=>{
  const{f,id,receive}=setup('fabric'),receiptId=receive(8.5,1.5);f.run({type:'fulfillment.procurement.rejectReceived',payload:{receiptId,quantity:.5,location:'拒收区',evidence:'验布'}});f.run({type:'fulfillment.procurement.return',payload:{receiptId,quantity:1.5,disposition:'replace',date:'2026-10-13',evidence:'供方确认'}});
  expect(f.state.fulfillment.purchases.find(x=>x.id===id)?.received).toBe(8);expect(f.state.fulfillment.stock.find(x=>x.receiptId===receiptId)?.available).toBe(8);
 });
});
