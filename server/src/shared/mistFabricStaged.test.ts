import {describe,expect,it} from 'vitest';
import {applyMistCommand,type MistCommand} from './mistWorkspace';
import {materialDeliveryRows,materialDeliveryTargets,materialReceiverIds} from './mistInternalFabric';
import {fabricStagedFixture as fixture} from '../mist/__tests__/fabricStaged';
import {fabricLength,fabricStageBalance,normalizeFabricStageTerms} from './mistFabricStage';
import {orderActualCost} from './mistOrderCost';
import {getFulfillmentReviews} from './mistFulfillment';
import {renderPurchaseDocumentHtml} from '../templates/purchaseDocument';

describe('staged fabric outsourcing',()=>{
 it('offers only the same item\'s dyeing contract and keeps the greige out of company stock',()=>{
  const f=fixture();
  expect(materialDeliveryTargets(f.state,f.greige).map(t=>t.value)).toEqual([f.branch.id]);
  const id=f.deliver();
  expect(f.state.fulfillment.stock).toHaveLength(0);
  const row=materialDeliveryRows(f.state).find(r=>r.id===id)!;
  expect(row).toMatchObject({kind:'direct',quantity:'3800',pending:'3800',unit:'米'});
  expect(row.delivery).toMatchObject({productionId:f.branch.id,orderId:f.orderId,supplier:'盛泽染整',receiverId:'sales'});
  expect(row.delivery.allocationId).toBeUndefined();
  expect(materialReceiverIds(f.state,row)).toEqual(['sales']);
 });
 it('lets only the fabric owner count the greige at the dyeing mill, with partial rejection',()=>{
  const f=fixture(),id=f.deliver();
  expect(()=>f.run({type:'fulfillment.materials.confirm',payload:{kind:'direct',id,acceptedQuantity:3800,rejectedQuantity:0,expectedReceivingRevision:0,evidence:'染厂点收'}},'other')).toThrow('指定接收负责人');
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'direct',id,acceptedQuantity:3760,rejectedQuantity:40,expectedReceivingRevision:0,evidence:'染厂验坯：40米织疵'}});
  expect(materialDeliveryRows(f.state).find(r=>r.id===id)).toMatchObject({accepted:'3760',rejected:'40',pending:'0'});
  expect(f.state.fulfillment.purchases.find(p=>p.id===f.greige)!.received).toBe(3760);
 });
 it('issues greige received into our warehouse to the dyeing contract from stock',()=>{
  const f=fixture();
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.greige,quantity:3800,rejected:0,destination:'warehouse',location:'吴江中转仓',date:'2026-10-13',evidence:'织厂送货单 WJ-1013',fileIds:[]}});
  const lot=f.state.fulfillment.stock[0];
  const id=f.run({type:'fulfillment.materials.issue',payload:{id:lot.id,targetProductionId:f.branch.id,quantity:3800,location:'盛泽染整坯布仓',person:'染厂仓管',note:'中转仓发坯 FL-07'}}).id!;
  expect(f.state.fulfillment.stock[0].available).toBe(0);
  expect(materialDeliveryRows(f.state).find(r=>r.id===id)).toMatchObject({kind:'issue',pending:'3800'});
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'染厂验坯无误'}});
  expect(materialDeliveryRows(f.state).find(r=>r.id===id)).toMatchObject({accepted:'3800',pending:'0'});
 });
 it('blocks a delivery addressed to another order\'s processing branch',()=>{
  const f=fixture(),before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.materials.deliver',payload:{id:f.greige,targetProductionId:'missing',quantity:1,rejected:0,location:'染厂',date:'2026-10-13',evidence:'错误目标',fileIds:[]}})).toThrow('面料加工单');
  expect(JSON.stringify(f.state)).toBe(before);
 });
 it('keeps the dyeing contract from being cancelled while greige sits at the mill',()=>{
  const f=fixture();f.deliver();
  expect(()=>f.run({type:'payable.purchase.cancel',payload:{purchaseId:f.dyeing,reason:'改厂'}})).toThrow('物料');
 });
 it('takes the dyed fabric into our warehouse as stock named after the order item',()=>{
  const f=fixture();f.release();
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.dyeing,quantity:3600,rejected:0,destination:'warehouse',location:'上海仓 F-02',date:'2026-10-13',evidence:'染厂码单 SZ-88',fileIds:[]}});
  expect(f.state.fulfillment.stock).toHaveLength(1);
  expect(f.state.fulfillment.stock[0]).toMatchObject({purchaseId:f.dyeing,unit:'米',quantity:3600,name:'棉弹斜纹 藏青'});
 });
});

describe('staged fabric input, output and loss',()=>{
 const count=(f:ReturnType<typeof fixture>,id:string,accepted:number,rejected=0)=>f.run({type:'fulfillment.materials.confirm',payload:{kind:'direct',id,acceptedQuantity:accepted,rejectedQuantity:rejected,expectedReceivingRevision:0,evidence:'染厂验坯'}});
 it('compares counted greige with returned fabric and flags loss over the agreed rate',()=>{
  const f=fixture({lossPercent:5});
  expect(fabricStageBalance(f.state,f.dyeing)).toMatchObject({input:0,output:0,lossPercent:null,agreedLossPercent:5,plannedInput:3789.47});
  count(f,f.deliver(),3800);f.release();
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.dyeing,quantity:3610,rejected:0,destination:'warehouse',location:'上海仓',date:'2026-10-13',evidence:'码单',fileIds:[]}});
  expect(fabricStageBalance(f.state,f.dyeing)).toMatchObject({input:3800,output:3610,lossPercent:5,overAllowance:false,outputExceedsInput:false});
  const g=fixture({lossPercent:5});count(g,g.deliver(),3800);g.release();
  g.run({type:'fulfillment.procurement.receive',payload:{id:g.dyeing,quantity:3550,rejected:0,destination:'warehouse',location:'上海仓',date:'2026-10-13',evidence:'码单',fileIds:[]}});
  expect(fabricStageBalance(g.state,g.dyeing)).toMatchObject({lossPercent:6.58,overAllowance:true});
 });
 it('does not report a negative loss when more fabric is returned than greige was counted',()=>{
  const f=fixture();count(f,f.deliver(),3000);f.release();
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.dyeing,quantity:3100,rejected:0,destination:'warehouse',location:'上海仓',date:'2026-10-13',evidence:'码单',fileIds:[]}});
  expect(fabricStageBalance(f.state,f.dyeing)).toMatchObject({input:3000,output:3100,lossPercent:null,outputExceedsInput:true,overAllowance:false});
 });
 it('counts only accepted greige as input, not rejected or still pending metres',()=>{
  const f=fixture();count(f,f.deliver(),3700,100);
  expect(fabricStageBalance(f.state,f.dyeing)!.inputs).toEqual([expect.objectContaining({accepted:3700,converted:3700})]);
  expect(fabricStageBalance(f.state,f.dyeing)!.input).toBe(3700);
 });
 it('converts greige bought by weight with the stated kilograms per metre',()=>{
  const f=fixture({greigeUnit:'公斤',greigeQty:2736,kgPerMetre:0.72});
  count(f,f.deliver(),2736);
  expect(fabricStageBalance(f.state,f.dyeing)!.inputs[0]).toMatchObject({accepted:2736,unit:'公斤',converted:3800});
  expect(fabricLength(100,{domain:'fabric',kind:'material',materialKind:'greige',unit:'码'},'米')).toBe(91.44);
 });
 it('requires the weight per metre before a greige contract bought by weight is submitted',()=>{
  const f=fixture();
  const id=f.run({type:'fulfillment.procurement.save',payload:{orderId:f.orderId,lineId:f.lineId,kind:'material',materialKind:'greige',supplierId:'weaver',supplier:'',description:'坯布按公斤',quantity:2736,unit:'公斤',price:12,currency:'CNY',due:'2026-11-10',terms:'月结30天',destination:'盛泽染整',note:'',fileIds:[]}}).id!;
  expect(()=>f.run({type:'fulfillment.procurement.submit',payload:{id}})).toThrow('每米重量');
 });
 it('rejects stage terms that do not belong to the contract kind',()=>{
  expect(()=>normalizeFabricStageTerms({domain:'fabric',kind:'material',materialKind:'greige',unit:'米'},{kgPerMetre:0.7})).toThrow('仅按公斤');
  expect(()=>normalizeFabricStageTerms({domain:'garment',kind:'processing',unit:'件'},{lossPercent:3})).toThrow('仅面料加工单');
  expect(()=>normalizeFabricStageTerms({domain:'fabric',kind:'processing',unit:'米'},{lossPercent:60})).toThrow('0–50');
  expect(()=>normalizeFabricStageTerms({domain:'fabric',kind:'processing',unit:'米'},{other:1})).toThrow('格式无效');
 });
 it('shows the agreed loss to the reviewer and on the processing contract document',()=>{
  const f=fixture({lossPercent:5});
  const review=getFulfillmentReviews(f.state).find(r=>r.entityId===f.dyeing)!;
  expect(review.details).toContainEqual({label:'工序约定',value:'约定加工损耗 5%（按出缸米数计费）'});
  const snapshot=f.state.fulfillment.purchases.find(p=>p.id===f.dyeing)!.revisionHistory!.at(-1)!.snapshot;
  expect(renderPurchaseDocumentHtml({purchaseId:'x',code:'PO-1',revision:1,templateVersion:1,date:'2026-10-13',issuer:{legalName:'雾织',englishName:'',address:'',englishAddress:'',phone:'',email:'',taxId:''},supplier:{name:'盛泽染整',address:''},orderCode:'SO-1',style:'CT-2103',contract:snapshot,total:'15120.00',generatedAt:'',generatedBy:'',generatedById:''})).toContain('约定加工损耗 5%');
 });
 it('names greige and dyeing stages on the order cost lines',()=>{
  const f=fixture();
  const labels=orderActualCost(f.state,f.orderId,'period','2026-10','2026-10-13').purchases.map(r=>r.label);
  expect(labels.some(l=>l.startsWith('坯布 '))).toBe(true);expect(labels.some(l=>l.startsWith('染整加工 '))).toBe(true);
 });
});
