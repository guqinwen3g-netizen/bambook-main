import {describe,expect,it} from 'vitest';
import {applyMistCommand,type MistCommand} from './mistWorkspace';
import {materialDeliveryRows,materialDeliveryTargets,materialReceiverIds} from './mistInternalFabric';
import {fabricStagedFixture as fixture} from '../mist/__tests__/fabricStaged';

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
  const f=fixture();
  const sampleSource={kind:'orderLine' as const,orderId:f.orderId,lineId:f.lineId,productionId:f.branch.id};
  const sampleId=f.run({type:'fulfillment.samples.create',payload:{name:'藏青先锋样',category:'面料',form:'米样',quantity:1,unit:'米',size:'',color:'藏青',location:'样品室',source:sampleSource,role:'pioneer',fileIds:[],note:'染厂首缸'}}).id!;
  const qc={actorId:'qc',actorName:'面料QC'};
  const task=f.run({type:'fulfillment.qc.request',payload:{source:sampleSource,sampleId,domain:'fabric',kind:'sample',factory:'盛泽染整',location:'染厂',contact:'',due:'2026-10-13'}}).id!;
  const asQc=(command:MistCommand)=>{const r=applyMistCommand(f.state,command,{id:()=>crypto.randomUUID(),now:'2026-10-13T12:00:00Z',...qc});Object.assign(f.state,r.state);};
  asQc({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}});
  asQc({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result:'pass',report:'PIONEER-1',opinion:'色光在容差内',measurements:[],fileIds:[],reviewedAt:'2026-10-13T12:00:00Z'}});
  f.run({type:'fulfillment.qc.confirm',payload:{id:task,result:'approved',note:'客户邮件确认色光'}});
  f.run({type:'fulfillment.qc.continue',payload:{id:task,note:'按确认色光大货'}});
  f.run({type:'fulfillment.production.release',payload:{productionId:f.branch.id,note:'坯布已到染厂，先锋样已确认'}});
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.dyeing,quantity:3600,rejected:0,destination:'warehouse',location:'上海仓 F-02',date:'2026-10-13',evidence:'染厂码单 SZ-88',fileIds:[]}});
  expect(f.state.fulfillment.stock).toHaveLength(1);
  expect(f.state.fulfillment.stock[0]).toMatchObject({purchaseId:f.dyeing,unit:'米',quantity:3600,name:'棉弹斜纹 藏青'});
 });
});
