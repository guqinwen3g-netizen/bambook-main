import {applyMistCommand,createMistState,type MistCommand,type MistContext} from '../../shared/mistWorkspace';

/** Staged fabric outsourcing: greige bought from a weaving mill is delivered to the dyeing mill, which returns finished fabric. */
export function fabricStagedFixture(options:{greigeUnit?:string;greigeQty?:number;kgPerMetre?:number;lossPercent?:number;intermediateDyeing?:boolean}={}){
 let n=0;
 const members=[{id:'sales',name:'面料业务',active:true,groups:['fabric' as const]},{id:'reviewer',name:'面料主管',active:true,groups:['fabric' as const]},{id:'other',name:'另一业务员',active:true,groups:['fabric' as const]}];
 const context:MistContext={id:()=>`staged-${++n}`,now:'2026-10-13T12:00:00Z',actorName:'面料业务',actorId:'sales',members,authority:{supplier:{'supplierCommitment.approvers.purchase.fabric':{version:1,userIds:['reviewer']},'supplierCommitment.approvers.processing.fabric':{version:1,userIds:['reviewer']}},orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}}};
 let state=createMistState(context,'empty');
 const as=(id:string)=>({...context,actorId:id,actorName:members.find(m=>m.id===id)!.name});
 const run=(command:MistCommand,actor='sales')=>{const result=applyMistCommand(state,command,as(actor));state=result.state;return result.result;};
 state.customers.push({id:'customer',name:'Northvale',code:'C',country:'GB',city:'',industry:'',owner:'面料业务',ownerId:'sales',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 const supplier=(id:string,type:string)=>state.market.suppliers.push({id,code:id,name:id==='weaver'?'吴江织造':id==='finisher'?'嘉兴后整理':'盛泽染整',type,country:'中国',address:'苏州',capabilities:type,capacity:10000,capacityUnit:'米',leadDays:10,status:'active',blockReason:'',contacts:[],fileIds:[],note:'',createdAt:context.now,updatedAt:context.now});
 supplier('weaver','织造');supplier('dyer','染整');supplier('finisher','后整理');
 state.files.push({id:'po-file',name:'customer-po.pdf',mimeType:'application/pdf',size:1,storageKey:'test/po',createdAt:context.now});
 const orderId=run({type:'order.create',payload:{type:'fabric',customerId:'customer',season:'AW27',currency:'USD',due:'2026-12-01',ownerId:'sales',governance:{kind:'external',poNumber:'NV-PO-118',confirmationFileIds:['po-file'],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:0,paymentNote:'见提单副本付款',incoterm:'FOB',deliveryPlace:'上海'},lines:[{name:'棉弹斜纹 藏青',style:'CT-2103',qty:3600,unit:'米',price:3.2,img:'clay'}]}}).id!;
 run({type:'order.governance.submit',payload:{orderId}});run({type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'客户PO与价格一致'}},'reviewer');
 const lineId=state.orderLines.find(l=>l.orderId===orderId)!.id;
 const contract=(kind:'material'|'processing',quantity:number,unit='米',stageTerms?:{kgPerMetre?:number;lossPercent?:number;intermediate?:boolean},supplierId?:string)=>{
  const id=run({type:'fulfillment.procurement.save',payload:{orderId,lineId,kind,...(kind==='material'?{materialKind:'greige' as const}:{}),supplierId:supplierId??(kind==='material'?'weaver':'dyer'),supplier:'',description:kind==='material'?'CT-2103 坯布 32S×16S 158cm':'CT-2103 染色定型 藏青',quantity,unit,...(stageTerms?{stageTerms}:{}),price:kind==='material'?8.6:4.2,currency:'CNY',due:'2026-11-10',terms:'月结30天',destination:kind==='material'?'盛泽染整':'上海仓',note:'',fileIds:[]}}).id!;
  run({type:'fulfillment.procurement.submit',payload:{id}});run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'单价与核算一致'}},'reviewer');
  run({type:'fulfillment.procurement.send',payload:{id,at:context.now,evidence:'邮件发出合同',fileIds:[]}});run({type:'fulfillment.procurement.confirm',payload:{id,at:context.now,confirmedDue:'2026-11-10',evidence:'工厂回签',fileIds:[]}});
  return id;
 };
 const greige=contract('material',options.greigeQty??3800,options.greigeUnit??'米',options.kgPerMetre!==undefined?{kgPerMetre:options.kgPerMetre}:undefined),dyeing=contract('processing',3600,'米',{...(options.lossPercent!==undefined?{lossPercent:options.lossPercent}:{}),...(options.intermediateDyeing?{intermediate:true}:{})}),branch=state.productions.find(p=>p.sourcePurchaseId===dyeing)!;
 const deliver=(quantity=options.greigeQty??3800)=>run({type:'fulfillment.materials.deliver',payload:{id:greige,targetProductionId:branch.id,quantity,rejected:0,location:'盛泽染整坯布仓',date:'2026-10-13',evidence:'织厂送货单 WJ-1013',fileIds:[]}}).id!;
 const release=()=>{
  const source={kind:'orderLine' as const,orderId,lineId,productionId:branch.id};
  const sampleId=run({type:'fulfillment.samples.create',payload:{name:'藏青先锋样',category:'面料',form:'米样',quantity:1,unit:'米',size:'',color:'藏青',location:'样品室',source,role:'pioneer',fileIds:[],note:'染厂首缸'}}).id!;
  const task=run({type:'fulfillment.qc.request',payload:{source,sampleId,domain:'fabric',kind:'sample',factory:'盛泽染整',location:'染厂',contact:'',due:'2026-10-13'}}).id!;
  const qc=(command:MistCommand)=>{const r=applyMistCommand(state,command,{...context,actorId:'qc',actorName:'面料QC'});state=r.state;};
  qc({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}});
  qc({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result:'pass',report:'PIONEER-1',opinion:'色光在容差内',measurements:[],fileIds:[],reviewedAt:context.now}});
  run({type:'fulfillment.qc.confirm',payload:{id:task,result:'approved',note:'客户邮件确认色光'}});
  run({type:'fulfillment.qc.continue',payload:{id:task,note:'按确认色光大货'}});
  run({type:'fulfillment.production.release',payload:{productionId:branch.id,note:'坯布已到染厂，先锋样已确认'}});
 };
 return{run,orderId,lineId,greige,dyeing,branch,deliver,release,contract,get state(){return state;}};
}
