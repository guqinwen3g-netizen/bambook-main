import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistCommand,type MistContext} from './mistWorkspace';
import {materialDeliveryRows,materialDeliveryTargets,materialReceiverIds,hasMaterialAtFactory} from './mistInternalFabric';
import {fabricStageBalance} from './mistFabricStage';
import {orderActualCost} from './mistOrderCost';

/** Greige (weaver) → dyeing (dyer, intermediate) → finishing (finisher, last and shippable). */
function chain(){
 let n=0;
 const members=[{id:'sales',name:'面料业务',active:true,groups:['fabric' as const]},{id:'reviewer',name:'面料主管',active:true,groups:['fabric' as const]}];
 const context:MistContext={id:()=>`pc-${++n}`,now:'2026-10-13T04:00:00Z',actorName:'面料业务',actorId:'sales',members,authority:{supplier:{'supplierCommitment.approvers.purchase.fabric':{version:1,userIds:['reviewer']},'supplierCommitment.approvers.processing.fabric':{version:1,userIds:['reviewer']}},orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}}};
 let state=createMistState(context,'empty');
 const as=(id:string)=>({...context,actorId:id,actorName:members.find(m=>m.id===id)!.name});
 const run=(command:MistCommand,actor='sales')=>{const r=applyMistCommand(state,command,as(actor));state=r.state;return r.result;};
 state.customers.push({id:'customer',name:'Northvale',code:'C',country:'GB',city:'',industry:'',owner:'面料业务',ownerId:'sales',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 for(const [id,name,type] of [['weaver','吴江织造','织造'],['dyer','盛泽染整','染整'],['finisher','嘉兴后整理','后整理']])state.market.suppliers.push({id,code:id,name,type,country:'中国',address:'苏州',capabilities:type,capacity:10000,capacityUnit:'米',leadDays:10,status:'active',blockReason:'',contacts:[],fileIds:[],note:'',createdAt:context.now,updatedAt:context.now});
 state.files.push({id:'po',name:'po.pdf',mimeType:'application/pdf',size:1,storageKey:'t/po',createdAt:context.now});
 const orderId=run({type:'order.create',payload:{type:'fabric',customerId:'customer',season:'AW27',currency:'USD',due:'2026-12-01',ownerId:'sales',governance:{kind:'external',poNumber:'NV-9',confirmationFileIds:['po'],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:0,preShipmentPercent:0,paymentNote:'见提单副本付款',incoterm:'FOB',deliveryPlace:'上海'},lines:[{name:'棉弹斜纹 拉毛 燕麦',style:'CT-3001',qty:3400,unit:'米',price:3.6,img:'clay'}]}}).id!;
 run({type:'order.governance.submit',payload:{orderId}});run({type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'PO一致'}},'reviewer');
 const lineId=state.orderLines.find(l=>l.orderId===orderId)!.id;
 const contract=(input:{kind:'material'|'processing';supplierId:string;quantity:number;stageTerms?:object;description:string;price:number})=>{
  const id=run({type:'fulfillment.procurement.save',payload:{orderId,lineId,kind:input.kind,...(input.kind==='material'?{materialKind:'greige' as const}:{}),supplierId:input.supplierId,supplier:'',description:input.description,quantity:input.quantity,unit:'米',...(input.stageTerms?{stageTerms:input.stageTerms as any}:{}),price:input.price,currency:'CNY',due:'2026-11-10',terms:'月结30天',destination:'下一道工厂',note:'',fileIds:[]}}).id!;
  run({type:'fulfillment.procurement.submit',payload:{id}});run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'单价一致'}},'reviewer');
  run({type:'fulfillment.procurement.send',payload:{id,at:context.now,evidence:'邮件发出',fileIds:[]}});run({type:'fulfillment.procurement.confirm',payload:{id,at:context.now,confirmedDue:'2026-11-10',evidence:'回签',fileIds:[]}});
  return id;
 };
 const greige=contract({kind:'material',supplierId:'weaver',quantity:3800,description:'CT-3001 坯布',price:8.6});
 const dyeing=contract({kind:'processing',supplierId:'dyer',quantity:3600,stageTerms:{intermediate:true,lossPercent:5},description:'CT-3001 匹染燕麦',price:4.2});
 const finishing=contract({kind:'processing',supplierId:'finisher',quantity:3400,stageTerms:{lossPercent:5},description:'CT-3001 拉毛定型',price:2.1});
 const count=(id:string,accepted:number,rejected=0)=>run({type:'fulfillment.materials.confirm',payload:{kind:'direct',id,acceptedQuantity:accepted,rejectedQuantity:rejected,expectedReceivingRevision:0,evidence:'点收'}});
 return{run,orderId,lineId,greige,dyeing,finishing,count,get state(){return state;}};
}

describe('fabric process chain across processing contracts',()=>{
 it('creates the shippable branch only for the last process',()=>{
  const f=chain();
  expect(f.state.productions.map(p=>p.sourcePurchaseId)).toEqual([f.finishing]);
 });
 it('offers the intermediate dyeing contract and the finishing branch as greige targets',()=>{
  const f=chain(),branch=f.state.productions[0].id;
  expect(materialDeliveryTargets(f.state,f.greige).map(t=>t.value)).toEqual(['contract:'+f.dyeing,branch]);
  expect(materialDeliveryTargets(f.state,f.dyeing).map(t=>t.value)).toEqual([branch]);
 });
 it('moves greige to the dyer, dyed fabric to the finisher, and checks loss at each step',()=>{
  const f=chain(),branch=f.state.productions[0].id;
  const g=f.run({type:'fulfillment.materials.deliver',payload:{id:f.greige,targetPurchaseId:f.dyeing,quantity:3800,rejected:0,location:'盛泽染整',date:'2026-10-13',evidence:'织厂送货单',fileIds:[]}}).id!;
  expect(materialDeliveryRows(f.state).find(r=>r.id===g)!.delivery).toMatchObject({contractId:f.dyeing,supplier:'盛泽染整',receiverId:'sales'});
  expect(materialDeliveryRows(f.state).find(r=>r.id===g)!.delivery.productionId).toBeUndefined();
  expect(materialReceiverIds(f.state,materialDeliveryRows(f.state).find(r=>r.id===g)!)).toEqual(['sales']);
  expect(hasMaterialAtFactory(f.state,f.dyeing)).toBe(true);
  expect(()=>f.run({type:'payable.purchase.cancel',payload:{purchaseId:f.dyeing,reason:'改厂'}})).toThrow('物料');
  f.count(g,3800);
  expect(fabricStageBalance(f.state,f.dyeing)).toMatchObject({input:3800,output:0});
  // The intermediate step is not a production branch, so it needs no release before handing over.
  const d=f.run({type:'fulfillment.materials.deliver',payload:{id:f.dyeing,targetProductionId:branch,quantity:3600,rejected:0,location:'嘉兴后整理',date:'2026-10-13',evidence:'染厂码单',fileIds:[]}}).id!;
  expect(f.state.fulfillment.purchases.find(p=>p.id===f.dyeing)!.received).toBe(3600);
  expect(fabricStageBalance(f.state,f.dyeing)).toMatchObject({input:3800,output:3600,lossPercent:5.26,overAllowance:true});
  f.count(d,3590,10);
  expect(fabricStageBalance(f.state,f.finishing)).toMatchObject({input:3590,inputs:[expect.objectContaining({code:f.state.fulfillment.purchases.find(p=>p.id===f.dyeing)!.code})]});
  expect(f.state.fulfillment.stock).toHaveLength(0);
 });
 it('refuses an untracked semi-finished drop and a loop back to the previous step',()=>{
  const f=chain();
  expect(()=>f.run({type:'fulfillment.procurement.receive',payload:{id:f.dyeing,quantity:100,rejected:0,destination:'supplier',location:'某处',date:'2026-10-13',evidence:'无去向',fileIds:[]}})).toThrow('接收加工单');
  const g=f.run({type:'fulfillment.materials.deliver',payload:{id:f.greige,targetPurchaseId:f.dyeing,quantity:10,rejected:0,location:'盛泽',date:'2026-10-13',evidence:'送货单',fileIds:[]}}).id!;f.count(g,10);
  expect(()=>f.run({type:'fulfillment.materials.deliver',payload:{id:f.dyeing,targetPurchaseId:f.dyeing,quantity:1,rejected:0,location:'x',date:'2026-10-13',evidence:'x',fileIds:[]}})).toThrow('前道加工单');
 });
 it('lets the dyed fabric go into our warehouse as semi-finished stock named after the contract',()=>{
  const f=chain();
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.dyeing,quantity:500,rejected:0,destination:'warehouse',location:'上海仓 B-2',date:'2026-10-13',evidence:'染厂码单',fileIds:[]}});
  expect(f.state.fulfillment.stock[0]).toMatchObject({purchaseId:f.dyeing,name:'CT-3001 匹染燕麦',quantity:500});
 });
 it('rejects the intermediate flag on non-processing or non-fabric contracts',()=>{
  const f=chain();
  expect(()=>f.run({type:'fulfillment.procurement.save',payload:{orderId:f.orderId,lineId:f.lineId,kind:'material',materialKind:'greige',supplierId:'weaver',supplier:'',description:'x',quantity:1,unit:'米',stageTerms:{intermediate:true},price:1,currency:'CNY',due:'2026-11-10',terms:'x',destination:'x',note:'',fileIds:[]}})).toThrow('仅面料加工单');
 });
 it('names the intermediate step on the order cost lines',()=>{
  const f=chain(),labels=orderActualCost(f.state,f.orderId,'period','2026-10','2026-10-13').purchases.map(r=>r.label);
  expect(labels.filter(l=>l.startsWith('坯布 '))).toHaveLength(1);
  expect(labels.filter(l=>l.startsWith('前道加工 '))).toHaveLength(1);
  expect(labels.filter(l=>l.startsWith('染整加工 '))).toHaveLength(1);
 });
});
