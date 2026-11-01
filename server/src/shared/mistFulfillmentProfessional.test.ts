import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistCommand,type MistContext} from './mistWorkspace';
import {productionSampleRequirements} from './mistProductionSamples';
import {createOrderGovernance} from './mistOrderGovernance';
import {assertProductionTransition,shipmentHandoverBlocker,type FulfillmentSampleRole} from './mistFulfillment';

function fixture(depositPercent=0){
 let n=0;const context:MistContext={id:()=>`professional-${++n}`,now:'2026-10-13T12:00:00.000Z',actorName:'业务员',actorId:'sales',authority:{supplier:{'supplierCommitment.approvers.processing.garment':{version:1,userIds:['reviewer']}},orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}}};
 let state=createMistState(context,'empty');
 const run=(command:MistCommand,actor=context)=>{const result=applyMistCommand(state,command,actor);state=result.state;return result.result;};
 state.customers.push({id:'customer',name:'本地验收客户',code:'C',country:'CN',city:'',industry:'',owner:'sales',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 state.market.suppliers.push({id:'supplier',code:'S',name:'本地验收工厂',type:'工厂',country:'CN',address:'现场',capabilities:'加工',capacity:10,capacityUnit:'件',leadDays:5,status:'active',blockReason:'',contacts:[],fileIds:[],note:'',createdAt:context.now,updatedAt:context.now});
 state.files.push({id:'contract',name:'local-evidence.pdf',mimeType:'application/pdf',size:10,storageKey:'local/contract',createdAt:context.now});
 const orderId=run({type:'order.create',payload:{type:'garment',customerId:'customer',season:'AW',currency:'USD',due:'2026-11-01',ownerId:'sales',governance:{kind:'external',poNumber:'LOCAL-PO',confirmationFileIds:['contract'],internalPurpose:'',receiver:'',quantityBasis:'total',quantityBasisNote:'客户按条目总量核验',paymentMethod:'TT',depositPercent,paymentNote:'本地验收约定',incoterm:'FOB',deliveryPlace:'上海'},lines:[{fulfillmentMode:'cmt',cmtIncludedItems:[],name:'本地验收上衣',style:'LOCAL',qty:10,unit:'件',price:10,img:'coat'}]}}).id!;
 function approveOrder(){run({type:'order.governance.submit',payload:{orderId}});run({type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'本地验收正式主单'}},{...context,actorId:'reviewer'});}
 function purchase(){const id=run({type:'fulfillment.procurement.save',payload:{orderId,lineId:state.orderLines[0].id,kind:'processing',supplierId:'supplier',supplier:'忽略客户端名称',description:'本地验收加工',quantity:10,unit:'件',price:2,currency:'CNY',due:'2026-10-30',terms:'本地验收付款约定',destination:'工厂',note:'',fileIds:[]}}).id!;run({type:'fulfillment.procurement.submit',payload:{id}});run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'已核对'}},{...context,actorId:'reviewer'});return id;}
 function confirmContract(id:string){run({type:'fulfillment.procurement.send',payload:{id,at:context.now,evidence:'本地验收线下发出记录',fileIds:[]}});run({type:'fulfillment.procurement.confirm',payload:{id,at:context.now,confirmedDue:'2026-10-30',evidence:'本地验收工厂反馈记录',fileIds:[]}});}
 function sample(productionId:string,role:FulfillmentSampleRole,size='M',shipmentId?:string,continueBusiness=true){const source={kind:'orderLine' as const,orderId,lineId:state.orderLines[0].id,productionId};const sampleId=run({type:'fulfillment.samples.create',payload:{name:`本地验收${role}-${size}`,category:'成衣',form:'实物',quantity:1,unit:'件',size,color:'蓝',location:'现场',source,role,shipmentId,fileIds:[],note:'本地验收实物'}}).id!;const taskId=run({type:'fulfillment.qc.request',payload:{source,sampleId,domain:'garment',kind:'sample',factory:'本地验收工厂',location:'现场',contact:'',due:'2026-10-13'}}).id!;run({type:'fulfillment.qc.claim',payload:{id:taskId,domain:'garment'}});run({type:'fulfillment.qc.report',payload:{id:taskId,domain:'garment',result:'pass',report:'LOCAL-SAMPLE',opinion:'本地验收检查',measurements:[],fileIds:[],reviewedAt:context.now}});run({type:'fulfillment.qc.confirm',payload:{id:taskId,result:'approved',note:'本地验收需求方确认'}});if(continueBusiness)run({type:'fulfillment.qc.continue',payload:{id:taskId,note:'本地验收业务明确继续'}});return taskId;}
 function released(){approveOrder();const purchaseId=purchase();confirmContract(purchaseId);const productionId=state.productions[0].id;run({type:'fulfillment.production.plan',payload:{productionId,sizes:[{size:'M',quantity:4},{size:'L',quantity:6}]}});sample(productionId,'pp','M');run({type:'fulfillment.production.release',payload:{productionId,note:'本地验收条件齐备'}});return{productionId,purchaseId};}
 function receiveAndComplete(productionId:string,purchaseId:string,quantity=10){run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity,rejected:0,destination:'supplier',location:'现场',date:'2026-10-13',evidence:'本地验收实际回交',fileIds:[]}});run({type:'fulfillment.production.complete',payload:{productionId,quantity,sizeQuantities:[{size:'M',quantity:4},{size:'L',quantity:quantity-4}],date:'2026-10-13',evidence:'本地验收最终点数',fileIds:[]}});}
 function productionTask(productionId:string){const id=run({type:'fulfillment.qc.request',payload:{source:{kind:'orderLine',orderId,lineId:state.orderLines[0].id,productionId},domain:'garment',kind:'production',factory:'本地验收工厂',location:'现场',contact:'',due:'2026-10-13'}}).id!;run({type:'fulfillment.qc.claim',payload:{id,domain:'garment'}});return id;}
 function report(id:string,result:'pass'|'reject',sizes=['M','L']){run({type:'fulfillment.qc.report',payload:{id,domain:'garment',result,report:'LOCAL-PRODUCTION',opinion:'本地验收持续检查',measurements:[],sizeChecks:sizes.map(size=>({size,inspected:1,result,evidence:'本地验收逐码实测'})),fileIds:[],reviewedAt:context.now}});}
 function shipment(productionId:string,quantity=10){state.orders[0].handoffAt=context.now;run({type:'fulfillment.shipments.sourceTerms',payload:{orderId,consignee:'本地验收收货人',partialAllowed:false,mode:'sea',confirmedAt:'2026-10-13',evidence:'本地验收合同'}});return run({type:'fulfillment.shipments.save',payload:{consignee:'本地验收收货人',mode:'sea',portOfLoading:'上海',portOfDischarge:'伦敦',incoterm:'FOB',plannedDate:'',booking:'',lines:[{orderId,lineId:state.orderLines[0].id,productionId,quantity,factoryConfirmedAt:'2026-10-13'}],note:'本地验收',fileIds:[]}}).id!;}
 return{run,context,orderId,approveOrder,purchase,confirmContract,sample,released,receiveAndComplete,productionTask,report,shipment,get state(){return state;}};
}

describe('professional Mist fulfillment gates',()=>{
 it('blocks procurement on an unapproved main order and does not manufacture a production branch',()=>{const f=fixture();expect(()=>f.purchase()).toThrow('主单尚未批准');expect(f.state.productions).toHaveLength(0);});
 it('allows one agreed PP size for an M/L production plan but requires customer confirmation and explicit business continuation',()=>{const f=fixture();f.approveOrder();const purchaseId=f.purchase(),productionId=f.state.productions[0].id;expect(()=>assertProductionTransition(f.state,f.state.productions[0],'sew',10)).toThrow('未由业务明确放行');f.confirmContract(purchaseId);f.run({type:'fulfillment.production.plan',payload:{productionId,sizes:[{size:'M',quantity:4},{size:'L',quantity:6}]}});expect(()=>f.run({type:'fulfillment.production.release',payload:{productionId,note:'不能缺样品'}})).toThrow('产前样');const task=f.sample(productionId,'pp','M',undefined,false);expect(()=>f.run({type:'fulfillment.production.release',payload:{productionId,note:'未继续'}})).toThrow('产前样');f.run({type:'fulfillment.qc.continue',payload:{id:task,note:'业务继续'}});f.run({type:'fulfillment.production.release',payload:{productionId,note:'核对齐备'}});expect(()=>assertProductionTransition(f.state,f.state.productions[0],'sew',10)).not.toThrow();expect(()=>f.run({type:'fulfillment.production.plan',payload:{productionId,sizes:[{size:'S',quantity:10}]}})).toThrow('不得改写');});
 it('checks real deposit coverage even after all technical preconditions are satisfied',()=>{const f=fixture(30);f.approveOrder();const purchaseId=f.purchase();f.confirmContract(purchaseId);const productionId=f.state.productions[0].id;f.run({type:'fulfillment.production.plan',payload:{productionId,sizes:[{size:'M',quantity:10}]}});f.sample(productionId,'pp');expect(()=>f.run({type:'fulfillment.production.release',payload:{productionId,note:'未到账'}})).toThrow('定金');expect(f.state.fulfillment.productionFacts[0].release).toBeUndefined();});
 it('keeps completion separate, immutable and blocks shipping until every actual production size passes',()=>{const f=fixture(),{productionId,purchaseId}=f.released();expect(()=>f.shipment(productionId)).toThrow('最终完工数量');f.receiveAndComplete(productionId,purchaseId);expect(()=>f.run({type:'fulfillment.production.complete',payload:{productionId,quantity:10,sizeQuantities:[{size:'M',quantity:4},{size:'L',quantity:6}],date:'2026-10-13',evidence:'覆盖',fileIds:[]}})).toThrow('不得覆盖');const task=f.productionTask(productionId);f.report(task,'pass',['M']);expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).toThrow('尺码 L');f.report(task,'pass',['L']);expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).not.toThrow();});
 it.each([0.1,1.5])('does not count fractional garment inspections as physical size coverage (%s)',inspected=>{const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);const task=f.productionTask(productionId);expect(()=>f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'garment',result:'pass',report:'INVALID-FRACTION',opinion:'不能以小数件数计入实物覆盖',measurements:[],sizeChecks:[{size:'M',inspected,result:'pass',evidence:'录入错误'}],fileIds:[],reviewedAt:f.context.now}})).toThrow('正整数');expect(f.state.fulfillment.qcTasks.find(t=>t.id===task)?.reportIds).toEqual([]);expect(f.state.fulfillment.qcReports.filter(report=>report.taskId===task)).toEqual([]);expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).toThrow('质量门禁');f.report(task,'pass');expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).not.toThrow();const accepted=f.state.fulfillment.qcReports.find(report=>report.taskId===task)!;expect(accepted.sizeChecks?.map(check=>check.inspected)).toEqual([1,1]);expect(f.state.fulfillment.productionFacts.find(fact=>fact.productionId===productionId)?.completion?.quantity).toBe(10);});
 it('a production NOK pauses only that branch and a positive retest still requires business recovery',()=>{const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);const task=f.productionTask(productionId);f.report(task,'reject');expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).toThrow('质量问题暂停');f.report(task,'pass');expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).toThrow('质量问题暂停');f.run({type:'fulfillment.qc.continue',payload:{id:task,note:'整改复验已核对'}});expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).not.toThrow();expect(f.state.fulfillment.qcReports.filter(report=>report.taskId===task)).toHaveLength(2);});
 it('requires a physical shipping sample for this exact shipment batch, distinct from PP',()=>{const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);const task=f.productionTask(productionId);f.report(task,'pass');const shipmentId=f.shipment(productionId);expect(()=>f.run({type:'fulfillment.shipments.ready',payload:{id:shipmentId}})).toThrow('船样');const shipTask=f.sample(productionId,'shipping','M',shipmentId);expect(f.state.fulfillment.qcTasks.find(t=>t.id===shipTask)?.sampleId).toBeTruthy();expect(()=>f.run({type:'fulfillment.shipments.ready',payload:{id:shipmentId}})).toThrow('装箱数量');});
 it('allows accepted short production as the full final batch without inventing a tolerance',()=>{const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId,9);expect(()=>f.shipment(productionId,9)).toThrow('客户明确接受');f.run({type:'fulfillment.production.acceptCompletion',payload:{productionId,note:'本地验收客户书面接受9件'}});expect(f.shipment(productionId,9)).toBeTruthy();expect(f.state.orderLines[0].qty).toBe(10);});
 it('archives externally issued BL originals without claiming to issue them',()=>{const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);const shipmentId=f.shipment(productionId);f.state.fulfillment.shipments[0].state='departed';const id=f.run({type:'fulfillment.documents.save',payload:{shipmentId,orderId:'',type:'BL',number:'EXTERNAL-BL',title:'本地验收外部提单',dueDate:'',content:'收到承运人原件',fileIds:['contract']}}).id!;expect(()=>f.run({type:'fulfillment.documents.issue',payload:{id}})).toThrow('只能归档');f.run({type:'fulfillment.documents.archiveExternal',payload:{id,issuer:'本地验收承运人',at:f.context.now,evidence:'收到外部签发原件'}});expect(f.state.fulfillment.documents.find(d=>d.id===id)?.externalIssue?.issuer).toBe('本地验收承运人');expect(f.state.invoices).toHaveLength(0);});
});


describe('approved production quantity basis',()=>{
 const receive=(f:ReturnType<typeof fixture>,purchaseId:string)=>f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:10,rejected:0,destination:'supplier',location:'仓库',date:'2026-10-13',evidence:'实际回货10件',fileIds:[]}});
 const complete=(f:ReturnType<typeof fixture>,productionId:string,sizeQuantities:Array<{size:string;quantity:number}>=[])=>f.run({type:'fulfillment.production.complete',payload:{productionId,quantity:10,sizeQuantities,date:'2026-10-13',evidence:'工厂最终点数10件',fileIds:[]}});
 it('records total-only actual quantity without copying planned sizes and retains every planned size in final QC coverage',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();receive(f,purchaseId);complete(f,productionId);
  expect(f.state.fulfillment.productionFacts[0].completion).toMatchObject({quantity:10,sizeQuantities:[],quantityBasis:{scope:'total',note:'客户按条目总量核验'}});
  const task=f.productionTask(productionId);f.report(task,'pass',['M']);expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).toThrow('尺码 L');f.report(task,'pass',['L']);expect(()=>assertProductionTransition(f.state,f.state.productions[0],'done',100)).not.toThrow();
 });
 it('blocks unknown quantity basis instead of guessing from the size plan or submitted matrix',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();receive(f,purchaseId);const g=f.state.orders[0].governance!;for(const c of [g.contract,g.approvedSnapshot!.contract]){delete c.quantityBasis;delete c.quantityBasisNote;}
  expect(()=>complete(f,productionId,[{size:'M',quantity:4},{size:'L',quantity:6}])).toThrow('核对并批准订单数量口径');expect(f.state.fulfillment.productionFacts[0].completion).toBeUndefined();
 });
 it('requires every actual size only for an explicitly approved size basis and freezes that basis',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();receive(f,purchaseId);const g=f.state.orders[0].governance!;for(const c of [g.contract,g.approvedSnapshot!.contract]){c.quantityBasis='size';c.quantityBasisNote='客户PO要求逐码足量';}
  expect(()=>complete(f,productionId)).toThrow('尺码');expect(()=>complete(f,productionId,[{size:'M',quantity:10}])).toThrow('逐码');
  complete(f,productionId,[{size:'M',quantity:4},{size:'L',quantity:6}]);expect(f.state.fulfillment.productionFacts[0].completion?.quantityBasis).toMatchObject({scope:'size',note:'客户PO要求逐码足量'});
 });
});

it('rejects unrecognised quantity scope and missing evidence in the approval input',()=>{
 const c=fixture().context;expect(()=>createOrderGovernance(c,{quantityBasis:'size'})).toThrow('数量依据');expect(()=>createOrderGovernance(c,{quantityBasis:'invalid' as 'total',quantityBasisNote:'来源'})).toThrow('数量口径');
});


describe('one factory and shipment sample submission with actual size/count members',()=>{
 function ready(){const f=fixture(),ids=f.released();f.receiveAndComplete(ids.productionId,ids.purchaseId);f.report(f.productionTask(ids.productionId),'pass');return{f,...ids,shipmentId:f.shipment(ids.productionId)};}
 function create(x:ReturnType<typeof ready>,rows=[{size:'M',quantity:1},{size:'L',quantity:2}],quantity=3,shipmentId=x.shipmentId){return x.f.run({type:'fulfillment.samples.create',payload:{name:'Jacket',category:'成衣',form:'船样',unit:'件',quantity,size:'',sizeQuantities:rows,color:'Blue',location:'Sample room',role:'shipping',shipmentId,source:{kind:'orderLine',orderId:x.f.orderId,lineId:x.f.state.orderLines[0].id,productionId:x.productionId},fileIds:[],note:'Three separately made physical samples'}}).id!;}
 it('records a single three-piece submission, rejects incomplete QC and requires customer approval plus business continuation',()=>{
  const x=ready(),id=create(x),f=x.f;expect(f.state.fulfillment.samples.find(s=>s.id===id)).toMatchObject({quantity:3,available:3,size:'M 1 / L 2',sizeQuantities:[{size:'M',quantity:1},{size:'L',quantity:2}]});
  const task=f.run({type:'fulfillment.qc.request',payload:{sampleId:id,source:{kind:'orderLine',orderId:f.orderId,lineId:f.state.orderLines[0].id,productionId:x.productionId},domain:'garment',kind:'sample',factory:'Factory',location:'Sample room',contact:'',due:'2026-10-13'}}).id!;f.run({type:'fulfillment.qc.claim',payload:{id:task,domain:'garment'}});
  const report=(sizes:Array<{size:string;inspected:number}>)=>f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'garment',result:'pass',report:'SHIP-SET',opinion:'Actual samples inspected',measurements:[],sizeChecks:sizes.map(s=>({...s,result:'pass',evidence:'Reference and measurements checked'})),fileIds:[],reviewedAt:f.context.now}});
  expect(()=>report([{size:'M',inspected:1}])).toThrow('全部尺码与件数');expect(()=>report([{size:'M',inspected:1},{size:'L',inspected:1}])).toThrow('全部尺码与件数');report([{size:'M',inspected:1},{size:'L',inspected:2}]);
  const checks=()=>productionSampleRequirements(f.state,f.state.productions[0],'shipping',x.shipmentId);expect(checks()).toMatchObject([{ok:false,reason:'待客户确认'}]);f.run({type:'fulfillment.qc.confirm',payload:{id:task,result:'approved',note:'Customer accepted this actual set'}});expect(checks()).toMatchObject([{ok:false,reason:'待业务确认'}]);f.run({type:'fulfillment.qc.continue',payload:{id:task,note:'Release this batch'}});expect(checks()).toMatchObject([{ok:true,evidence:{sizeQuantities:[{size:'M',quantity:1},{size:'L',quantity:2}]}}]);
  expect(()=>f.run({type:'fulfillment.samples.move',payload:{id,kind:'send',quantity:1,person:'Customer',location:'London',note:'Partial',sendPurpose:'confirmation'}})).toThrow('整组');
  const replacement=create(x,[{size:'M',quantity:1}],1);expect(checks()).toMatchObject([{sampleId:replacement,ok:false}]);expect(f.state.fulfillment.qcReports.some(r=>r.report==='SHIP-SET')).toBe(true);
 });
 it('rejects wrong totals, duplicate or unrelated sizes, and a different shipment before making inventory',()=>{
  const x=ready(),before=x.f.state.fulfillment.samples.length;expect(()=>create(x,[{size:'M',quantity:1}],3)).toThrow('合计');expect(()=>create(x,[{size:'M',quantity:1},{size:'M',quantity:2}],3)).toThrow('重复');expect(()=>create(x,[{size:'S',quantity:3}],3)).toThrow('本工厂');expect(()=>create(x,undefined,3,'other-shipment')).toThrow('出运');expect(x.f.state.fulfillment.samples).toHaveLength(before);
 });
 it('keeps PP as individual garments instead of applying the shipping-set exception',()=>{
  const x=ready();expect(()=>x.f.run({type:'fulfillment.samples.create',payload:{name:'PP',category:'成衣',form:'样衣',unit:'件',quantity:3,size:'M',sizeQuantities:[{size:'M',quantity:3}],color:'Blue',location:'Sample room',role:'pp',source:{kind:'orderLine',orderId:x.f.orderId,lineId:x.f.state.orderLines[0].id,productionId:x.productionId},fileIds:[],note:''}})).toThrow('仅用于成衣船样');
 });
});


describe('production completion business date', () => {
 it.each([
  ['2026-10-29T16:30:00.000Z', '2026-10-30', '2026-10-31'],
  ['2026-12-31T16:30:00.000Z', '2027-01-01', '2027-01-02'],
 ])('accepts the Shanghai business day and rejects tomorrow at %s', (now, date, tomorrow) => {
  const f=fixture(), {productionId,purchaseId}=f.released();
  f.context.now=now;
  const receive=(receiptDate:string)=>f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:10,rejected:0,destination:'supplier',location:'仓库',date:receiptDate,evidence:'本地验收实际回交',fileIds:[]}});
  expect(()=>receive(tomorrow)).toThrow('收货日期不得在未来');
  expect(f.state.fulfillment.purchases.find(p=>p.id===purchaseId)?.received).toBe(0);
  receive(date);
  const complete=(actualDate:string)=>f.run({type:'fulfillment.production.complete',payload:{productionId,quantity:10,sizeQuantities:[],date:actualDate,evidence:'本地验收最终点数',fileIds:[]}});
  expect(()=>complete(tomorrow)).toThrow('完工日期不得在未来');
  expect(f.state.fulfillment.productionFacts[0].completion).toBeUndefined();
  expect(()=>complete(date)).not.toThrow();
  expect(f.state.fulfillment.productionFacts[0].completion).toMatchObject({date,at:now,quantity:10});
 });
 it('preserves an explicitly backfilled completion date',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released(); f.context.now='2026-10-29T16:30:00.000Z';
  f.receiveAndComplete(productionId,purchaseId);
  expect(f.state.fulfillment.productionFacts[0].completion?.date).toBe('2026-10-13');
 });
});

describe('remaining fulfillment business-day boundaries',()=>{
 it('uses the current business day for confirmed terms and factory shipping readiness',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);f.report(f.productionTask(productionId),'pass');
  f.context.now='2026-10-29T16:30:00.000Z';f.state.orders[0].handoffAt=f.context.now;
  const terms=(date:string)=>f.run({type:'fulfillment.shipments.sourceTerms',payload:{orderId:f.orderId,consignee:'客户',partialAllowed:false,mode:'sea',confirmedAt:date,evidence:'合同已核实'}});
  expect(()=>terms('2026-10-31')).toThrow('条款确认日期不能在未来');expect(()=>terms('2026-10-30')).not.toThrow();
  const ship=(date:string)=>f.run({type:'fulfillment.shipments.save',payload:{consignee:'客户',mode:'sea',portOfLoading:'上海',portOfDischarge:'伦敦',incoterm:'FOB',plannedDate:'',booking:'',lines:[{orderId:f.orderId,lineId:f.state.orderLines[0].id,productionId,quantity:10,factoryConfirmedAt:date}],note:'',fileIds:[]}});
  expect(()=>ship('2026-10-31')).toThrow('工厂');expect(()=>ship('2026-10-30')).not.toThrow();
  const customs=(date:string)=>f.run({type:'fulfillment.customs.save',payload:{shipmentId:f.state.fulfillment.shipments[0].id,status:'draft',declarationNo:'',broker:'报关行',hsCode:'620530',origin:'CN',tradeMode:'FOB',declaredAt:date,clearedAt:'',evidence:'申报记录',fileIds:[],note:''}});
  expect(()=>customs('2026-10-31')).toThrow('未来');expect(()=>customs('2026-10-30')).not.toThrow();
 });
 it('uses the current business day for supplier rejection returns',()=>{
  const f=fixture(),{purchaseId}=f.released();
  const receipt=f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:9,rejected:1,destination:'supplier',location:'仓库',date:'2026-10-13',evidence:'拒收一件',fileIds:[]}}).id!;
  f.context.now='2026-10-29T16:30:00.000Z';
  const returned=(date:string)=>f.run({type:'fulfillment.procurement.return',payload:{receiptId:receipt,quantity:1,date,disposition:'replace',evidence:'已退回待补发',fileIds:[]}});
  expect(()=>returned('2026-10-31')).toThrow('未来');expect(()=>returned('2026-10-30')).not.toThrow();
 });
 it('does not allow yesterday as an expected sample return just after Shanghai midnight',()=>{
  const f=fixture();f.released();f.context.now='2026-10-29T16:30:00.000Z';
  const lend=(date:string)=>f.run({type:'fulfillment.samples.move',payload:{id:f.state.fulfillment.samples[0].id,kind:'lend',quantity:1,person:'业务同事',location:'样品室',note:'对样后归还',expectedReturn:date}});
  expect(()=>lend('2026-10-29')).toThrow('预计归还日不能早于借出日');expect(()=>lend('2026-10-30')).not.toThrow();
 });
});

describe('factory completion and physical handover are separate facts',()=>{
 it('records completion before handover and keeps final QC valid through later partial handovers',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();
  const complete=()=>f.run({type:'fulfillment.production.complete',payload:{productionId,quantity:10,sizeQuantities:[],date:'2026-10-13',evidence:'工厂已完工，待交承运人',fileIds:[]}});
  expect(()=>complete()).not.toThrow();
  const fact=f.state.fulfillment.productionFacts[0],completion=structuredClone(fact.completion),revision=fact.revision;
  expect(f.state.fulfillment.receipts).toEqual([]);expect(f.state.fulfillment.stock).toEqual([]);
  const task=f.productionTask(productionId);f.report(task,'pass');
  const receive=(quantity:number)=>f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity,rejected:0,destination:'supplier',location:'承运人提货',date:'2026-10-13',evidence:'实际交接',fileIds:[]}});
  receive(4);receive(6);
  expect(f.state.fulfillment.productionFacts[0].completion).toEqual(completion);expect(f.state.fulfillment.productionFacts[0].revision).toBe(revision);
  expect(f.state.fulfillment.qcTasks.find(row=>row.id===task)?.state).toBe('reported');
  expect(f.state.productions[0]).toMatchObject({pct:100,col:'qc'});expect(f.state.fulfillment.purchases[0].received).toBe(10);
  expect(()=>receive(1)).toThrow('完工');expect(f.state.fulfillment.receipts).toHaveLength(2);
 });
 it('does not allow departure to use completed goods that have not been handed over',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();
  f.run({type:'fulfillment.production.complete',payload:{productionId,quantity:10,sizeQuantities:[],date:'2026-10-13',evidence:'工厂点数',fileIds:[]}});
  f.report(f.productionTask(productionId),'pass');
  for(const contract of [f.state.orders[0].governance!.contract,f.state.orders[0].governance!.approvedSnapshot!.contract])contract.preShipmentPercent=0;
  const shipmentId=f.shipment(productionId);f.sample(productionId,'shipping','M',shipmentId);
  f.run({type:'fulfillment.shipments.pack',payload:{id:shipmentId,lines:[{lineId:f.state.orderLines[0].id,productionId,carton:'1',quantity:10,netWeight:9,grossWeight:10,volume:1,note:''}]}});
  for(const type of ['CI','PL'] as const){const id=f.run({type:'fulfillment.documents.save',payload:{shipmentId,orderId:type==='CI'?f.orderId:'',type,number:type+'-HANDOVER',title:type,dueDate:'2026-11-01',content:'单证',fileIds:['contract']}}).id!;f.run({type:'fulfillment.documents.issue',payload:{id}});}
  f.run({type:'fulfillment.shipments.ready',payload:{id:shipmentId}});f.run({type:'fulfillment.shipments.sent',payload:{id:shipmentId,at:f.context.now}});
  f.run({type:'fulfillment.customs.save',payload:{shipmentId,status:'cleared',declarationNo:'DECL',broker:'报关行',hsCode:'6201',origin:'CN',tradeMode:'FOB',declaredAt:'2026-10-13',clearedAt:'2026-10-13',evidence:'放行回执',fileIds:[],note:''}},{...f.context,can:()=>true});
  const depart=()=>f.run({type:'fulfillment.shipments.depart',payload:{id:shipmentId,at:f.context.now,evidence:'离港通知',fileIds:[]}});
  expect(()=>depart()).toThrow('交接');
  f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:4,rejected:0,destination:'supplier',location:'承运人',date:'2026-10-13',evidence:'提货4件',fileIds:[]}});
  expect(()=>depart()).toThrow('交接');
  f.run({type:'fulfillment.procurement.receive',payload:{id:purchaseId,quantity:6,rejected:0,destination:'supplier',location:'承运人',date:'2026-10-13',evidence:'提货6件',fileIds:[]}});
  expect(()=>depart()).not.toThrow();expect(f.state.fulfillment.shipments[0].state).toBe('departed');
 });
});


it('counts already departed quantities against the same supplier handover without consuming future plans',()=>{
 const f=fixture(),{productionId,purchaseId}=f.released();const branch=f.state.productions.find(row=>row.id===productionId)!;
 f.state.fulfillment.purchases.find(row=>row.id===purchaseId)!.received=6;
 const source={orderId:f.orderId,lineId:branch.lineId,productionId,factoryConfirmedAt:'2026-10-13'};
 f.state.fulfillment.shipments.push({id:'departed',state:'departed',lines:[{...source,quantity:4}]},{id:'future',state:'preparing',lines:[{...source,quantity:2}]} as any);
 const current={id:'current',state:'ready',lines:[{...source,quantity:4}]} as any;
 expect(shipmentHandoverBlocker(f.state,current)).toContain('累计需 8');
 f.state.fulfillment.purchases.find(row=>row.id===purchaseId)!.received=8;
 expect(shipmentHandoverBlocker(f.state,current)).toBe('');
});

it('keeps an explicit final completion at 100 percent while allowing subsequent follow-up',()=>{
 const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);
 const before=structuredClone(f.state.fulfillment.productionFacts[0].completion);
 expect(()=>f.run({type:'production.update',payload:{id:productionId,pct:90,note:'旧表单'}})).toThrow('完工');
 expect(f.state.productions[0].pct).toBe(100);expect(f.state.fulfillment.productionFacts[0].completion).toEqual(before);
 expect(()=>f.run({type:'production.update',payload:{id:productionId,pct:100,note:'等待提货'}})).not.toThrow();
});
