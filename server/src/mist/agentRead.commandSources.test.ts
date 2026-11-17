import {describe,it,expect} from 'vitest';
import {createMistState,type MistContext,type MistWorkspaceEnvelope} from '../shared/mistWorkspace';
import type {TokenPayload} from '../auth/service';
import {agentGet,agentQuery} from './agentRead';
import {applyDevelopmentTaskReopen,type DevelopmentTaskClosePlan} from '../shared/mistDevelopmentTaskLifecycle';
import {shippingSampleSourceSnapshot,confirmShippingSampleBasis} from '../shared/mistShipmentSampleCustody';
import {collectTaskSources,taskReadHash} from './agentTaskVisibility';
import {handleMcpMessage} from './agentMcp';

const actor={userId:'buyer',permissions:['products:read','products:write','orders:read','production:read','shipments:read'],roles:[],departmentIds:[],authorizationLoaded:true} as TokenPayload;
function fixture(){let seq=0;const context:MistContext={id:()=>`source-${++seq}`,now:'2026-11-18T04:00:00Z',actorId:'buyer',actorName:'业务员'};const state=createMistState(context,'empty');const dev={id:'dev',code:'DEV-ONE',ownerId:'buyer',values:{name:'客户面料'},versionIds:['open','ended'],currentVersionId:'open'} as any;const open={id:'open',devId:dev.id,label:'F1',factory:'工厂甲',factoryId:'factory-a',returnedAt:context.now} as any,ended={id:'ended',devId:dev.id,label:'F2',factory:'工厂乙',factoryId:'factory-b',taskEnd:{id:'exact-task-ending',kind:'terminated',reason:'暂停该厂任务',by:'业务员',byId:'buyer',at:context.now}} as any;state.devs.push(dev);state.versions.push(open,ended);const plan:DevelopmentTaskClosePlan={tasks:[{versionId:open.id,label:open.label,factory:open.factory,canComplete:true,qcCount:2,originalLoanCount:1}],followups:{qcCount:2,originalLoanCount:1,financialPending:true}};const view:Pick<MistWorkspaceEnvelope,'developmentTaskClosePlans'>={developmentTaskClosePlans:{[dev.id]:plan}};return{state,dev,open,ended,plan,view,context};}
function sampleFixture(){const f=fixture(),s=f.state;const sample={id:'shipping-sample',code:'SMP-ONE',name:'船样',role:'shipping',source:{kind:'orderLine',orderId:'order',lineId:'line',productionId:'production'},shipmentId:'shipment',quantity:1,available:1,unit:'件',color:'浅蓝',sizeQuantities:[{size:'M',quantity:1}],location:'留样柜',positions:[{location:'留样柜',available:1}],fileIds:[]} as any;s.fulfillment.samples.push(sample);s.orders.push({id:'order',code:'SO-ONE',ownerId:'buyer'} as any);s.orderLines.push({id:'line',orderId:'order',unit:'件',price:981} as any);s.productions.push({id:'production',orderId:'order',lineId:'line'} as any);s.fulfillment.shipments.push({id:'shipment',state:'ready',domain:'garment',customer:'客户',lines:[{orderId:'order',lineId:'line',productionId:'production',quantity:12}]} as any);s.fulfillment.packing.push({id:'packing',shipmentId:'shipment',lineId:'line',productionId:'production',carton:'01',quantity:12,assortment:[{color:'浅蓝',size:'M',quantity:12}]} as any);return{...f,sample};}

describe('current command source metadata on existing agent get kinds',()=>{
 it('threads only the current repository envelope and actor through MCP get, never caller-supplied source plans',async()=>{
  const f=fixture();let current=actor;const repository={getForAgent:async()=>({workspace:{id:'workspace',name:'公司',revision:7,state:f.state,...f.view},actor:current})} as any;
  const call=async()=>handleMcpMessage(repository,actor,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bambook_get',arguments:{workspaceId:'workspace',type:'development',id:'dev',developmentTaskClosePlans:{dev:{tasks:[],followups:{qcCount:0,originalLoanCount:0,financialPending:false}}}}}},String) as Promise<any>;
  let reply=await call();expect(reply.result.structuredContent.object.taskClosePlan).toEqual(f.plan);current={...actor,permissionCeiling:['products:read']};reply=await call();expect(reply.result.structuredContent.object.taskClosePlan).toBeNull();
 });
 it('uses the authorized envelope plan, including hidden-followup counts, without recomputing projected zeros or changing data/hash',()=>{
  const f=fixture(),raw=structuredClone(f.state),r=agentGet(f.state,actor,'development',f.dev.id,f.view);
  expect(r.taskClosePlan).toEqual(f.plan);expect(r.data).toEqual(f.dev);expect(r.data).not.toHaveProperty('taskClosePlan');expect(f.state).toEqual(raw);
  expect(collectTaskSources({workspace:{revision:5},object:r},f.state,[]).find(x=>x.path==='devs')?.fullReadHash).toBe(taskReadHash(f.dev));expect(agentQuery(f.state,actor,{type:'development'}).results[0].summary).not.toHaveProperty('taskClosePlan');
 });
 it('fails closed for an old service, unavailable/partial plan or a read-only delegation of a writable owner',()=>{
  const f=fixture();expect(agentGet(f.state,actor,'development',f.dev.id).taskClosePlan).toBeNull();
  expect(agentGet(f.state,actor,'development',f.dev.id,{developmentTaskClosePlans:{dev:{...f.plan,unavailable:true}}}).taskClosePlan).toBeNull();
  f.plan.tasks[0].versionId='not-visible';expect(agentGet(f.state,actor,'development',f.dev.id,f.view).taskClosePlan).toBeNull();f.plan.tasks[0].versionId='open';
  expect(agentGet(f.state,{...actor,permissionCeiling:['products:read']},'development',f.dev.id,f.view).taskClosePlan).toBeNull();expect(agentGet(f.state,{...actor,permissionCeiling:['products:read']},'dev_version','ended',f.view).taskReopenSource).toBeNull();
 });
 it('provides the exact current ending token only for an actionable visible major and the domain accepts it',()=>{
  const f=fixture(),before=structuredClone(f.state),r=agentGet(f.state,actor,'dev_version',f.ended.id,f.view);expect(r.taskReopenSource).toEqual({devId:'dev',versionId:'ended',expectedTaskEndId:'exact-task-ending'});expect(f.state).toEqual(before);
  const result=applyDevelopmentTaskReopen(f.state,{type:'development.task.reopen',payload:{...r.taskReopenSource!,reason:'恢复该工厂任务'}},f.context);expect(result.restoredTaskEndId).toBe('exact-task-ending');expect(f.ended.taskEnd).toBeUndefined();
 });
 it.each(['closed-case','minor','archived','abandon','resample','missing-parent','oversized-id'] as const)('does not advertise task reopen from %s',kind=>{
  const f=fixture();if(kind==='closed-case')f.dev.closure={id:'case-ending',kind:'closed'};if(kind==='minor')f.ended.minor=true;if(kind==='archived')f.ended.archivedAt=f.context.now;if(kind==='abandon'||kind==='resample')f.ended.qcDecision={kind};if(kind==='missing-parent')f.state.devs=[];if(kind==='oversized-id')f.ended.taskEnd.id='x'.repeat(201);expect(agentGet(f.state,actor,'dev_version','ended',f.view).taskReopenSource).toBeNull();
 });
 it('returns a complete plan beside compacted data and suppresses an over-budget plan as a whole',()=>{
  const f=fixture();f.dev.values.note='x'.repeat(24000);let r=agentGet(f.state,actor,'development','dev',f.view);expect(r.truncated).toBe(true);expect(r.taskClosePlan).toEqual(f.plan);expect(JSON.stringify({data:r.data,reopenSource:r.reopenSource,taskClosePlan:r.taskClosePlan}).length).toBeLessThanOrEqual(16000);
  for(let n=0;n<80;n++){const v={...f.open,id:'many-'+n,label:'L'.repeat(150),factory:'F'.repeat(150)};f.dev.versionIds.push(v.id);f.state.versions.push(v);f.plan.tasks.push({versionId:v.id,label:v.label,factory:v.factory,canComplete:true,qcCount:0,originalLoanCount:0});}
  r=agentGet(f.state,actor,'development','dev',f.view);expect(r.taskClosePlan).toBeNull();expect(r.truncated).toBe(true);expect(r.readHint).toContain('不完整');expect(JSON.stringify({data:r.data,reopenSource:r.reopenSource,taskClosePlan:r.taskClosePlan}).length).toBeLessThanOrEqual(16000);
 });
 it('provides the current shipping tuple snapshot, rather than a stale recorded basis or any monetary record',()=>{
  const f=sampleFixture();f.sample.shippingQuantityBasis={kind:'independent',sourceSnapshot:{sampleId:'obsolete-source'}};f.state.payables.bills.push({id:'HIDDEN-BILL',amount:999999} as any);const raw=structuredClone(f.state),r=agentGet(f.state,actor,'sample',f.sample.id);
  expect(r.shippingBasisSource).toEqual({sourceSnapshot:shippingSampleSourceSnapshot(f.state,f.sample),reconcileDeparted:false});expect(r.data).toEqual(f.sample);expect(f.state).toEqual(raw);const packet=JSON.stringify(r.shippingBasisSource);expect(packet).not.toContain('price');expect(packet).not.toContain('amount');expect(packet).not.toContain('HIDDEN-BILL');
  const confirmed=confirmShippingSampleBasis(f.state,{id:f.sample.id,kind:'independent',...r.shippingBasisSource!,evidence:'本件是独立留样',independentSource:'厂方另交并独立保管',fileIds:[]},f.context);expect(confirmed.quantityBasisId).toBeTruthy();
 });
 it.each(['orders:read','production:read','shipments:read'])('does not borrow %s from raw rows outside the delegated read grant',scope=>{
  const f=sampleFixture(),restricted={...actor,permissionCeiling:actor.permissions.filter(x=>x!==scope)};expect(agentGet(f.state,restricted,'sample',f.sample.id).shippingBasisSource).toBeNull();
 });
 it.each(['missing-order','missing-production','partial-shipment','cancelled-shipment','consumed','not-shipping'] as const)('withholds a source packet for %s',kind=>{
  const f=sampleFixture();if(kind==='missing-order')f.state.orders=[];if(kind==='missing-production')f.state.productions=[];if(kind==='partial-shipment')(f.state.fulfillment.shipments[0] as any).hiddenCount=1;if(kind==='cancelled-shipment')f.state.fulfillment.shipments[0].state='cancelled';if(kind==='consumed')f.sample.shippingQuantityBasis={consumption:{movementId:'already-consumed'}};if(kind==='not-shipping')f.sample.role='pp';expect(agentGet(f.state,actor,'sample',f.sample.id).shippingBasisSource).toBeNull();
 });
 it('keeps a full current snapshot within the old budget or returns no snapshot, never sliced packing or IDs',()=>{
  const f=sampleFixture();for(let n=0;n<80;n++)f.state.fulfillment.packing.push({...f.state.fulfillment.packing[0],id:'more-'+n,carton:'C'.repeat(200)});const r=agentGet(f.state,actor,'sample',f.sample.id);expect(r.shippingBasisSource).toBeNull();expect(r.truncated).toBe(true);expect(JSON.stringify({data:r.data,shippingBasisSource:r.shippingBasisSource}).length).toBeLessThanOrEqual(16000);
 });
 it('signals explicit late included confirmation and then stops advertising an already consumed sample',()=>{
  const f=sampleFixture(),shipment=f.state.fulfillment.shipments[0];shipment.state='departed';shipment.departedAt=f.context.now;shipment.departureEvidence='实际离港依据';const r=agentGet(f.state,actor,'sample',f.sample.id);expect(r.shippingBasisSource!.reconcileDeparted).toBe(true);confirmShippingSampleBasis(f.state,{id:f.sample.id,kind:'included',...r.shippingBasisSource!,evidence:'按原离港实物补记',fileIds:[]},f.context);expect(f.sample.available).toBe(0);expect(agentGet(f.state,actor,'sample',f.sample.id).shippingBasisSource).toBeNull();
 });
 it.each(['arrived','delivered','ready-with-atd'] as const)('keeps the actual departure anchor for %s instead of relying on its display state',kind=>{
  const f=sampleFixture(),shipment=f.state.fulfillment.shipments[0] as any;shipment.state=kind==='ready-with-atd'?'ready':kind;shipment.departedAt=f.context.now;shipment.departureEvidence='原ATD依据';expect(agentGet(f.state,actor,'sample',f.sample.id).shippingBasisSource!.reconcileDeparted).toBe(true);
 });
 it('does not trim an unknown snapshot field into a different command source',()=>{
  const f=sampleFixture();f.sample.sizeQuantities[0].unrecognized='not-a-source-field';expect(agentGet(f.state,actor,'sample',f.sample.id).shippingBasisSource).toBeNull();
 });
});
