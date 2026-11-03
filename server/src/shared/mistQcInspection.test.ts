import {describe,expect,it} from 'vitest';
import {applyMistCommand,type MistCommand} from './mistWorkspace';
import {aqlOutcome,aqlPlan,fabricOutcome,normalizeAql,normalizeFabricInspection,pointsPer100} from './mistQcInspection';
import {fixture} from '../mist/__tests__/professionalFulfillment';
import {fabricStagedFixture} from '../mist/__tests__/fabricStaged';

describe('AQL sampling plan (ISO 2859-1 normal, level II)',()=>{
 it.each([[1200,'2.5','J',80,5],[1200,'4.0','J',80,7],[1200,'1.0','J',80,2],[3000,'2.5','K',125,7],[500,'2.5','H',50,3],[150,'2.5','F',20,1],[80,'2.5','D',8,0],[6,'2.5','D',6,0],[200000,'2.5','N',500,21]] as const)('lot %i at AQL %s → %s n=%i Ac=%i',(lot,aql,letter,n,ac)=>{
  expect(aqlPlan(lot,aql as any)).toMatchObject({letter,sampleSize:n,accept:ac,reject:ac+1});
 });
 it('rejects on any critical defect, or major/minor at their reject numbers',()=>{
  const base={lotSize:1200,majorAql:'2.5' as const,minorAql:'4.0' as const,inspected:80,defects:'门襟跳针'};
  expect(aqlOutcome({...base,critical:0,major:5,minor:7}).result).toBe('pass');
  expect(aqlOutcome({...base,critical:1,major:0,minor:0}).reasons[0]).toContain('致命');
  expect(aqlOutcome({...base,critical:0,major:6,minor:0}).result).toBe('reject');
  expect(aqlOutcome({...base,critical:0,major:0,minor:8}).result).toBe('reject');
  expect(()=>normalizeAql({...base,inspected:50,critical:0,major:0,minor:0})).toThrow('至少抽检 80');
  expect(()=>normalizeAql({...base,defects:'',critical:0,major:1,minor:0})).toThrow('缺陷内容');
 });
});
describe('four-point fabric inspection',()=>{
 it('scores points per 100 square yards per roll and for the lot',()=>{
  expect(pointsPer100(30,100,58)).toBe(18.62);
  const o=fabricOutcome({widthInches:58,limit:40,rolls:[{roll:'R1',yards:100,points:30},{roll:'R2',yards:100,points:80}],lab:{}});
  expect(o).toMatchObject({totalYards:200,totalPoints:110,pointsPer100:34.14,rejectedRolls:['R2'],result:'reject'});
  expect(()=>normalizeFabricInspection({widthInches:58,limit:40,rolls:[{roll:'R1',yards:10,points:50}]})).toThrow('每码最多 4 分');
  expect(()=>normalizeFabricInspection({widthInches:58,limit:40,rolls:[{roll:'R1',yards:10,points:1},{roll:'R1',yards:10,points:1}]})).toThrow('卷号不能重复');
 });
});
describe('QC report sampling records',()=>{
 it('stores AQL on a garment production report and refuses a pass that contradicts it',()=>{
  const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);const id=f.productionTask(productionId);
  const report=(result:'pass'|'reject',major:number)=>f.run({type:'fulfillment.qc.report',payload:{id,domain:'garment',result,report:'PQC-AQL',opinion:'AQL 抽检',measurements:[],fileIds:[],reviewedAt:f.context.now,sizeChecks:['M','L'].map(size=>({size,inspected:1,result,evidence:'抽检'})),aql:{lotSize:10,majorAql:'2.5',minorAql:'4.0',inspected:10,critical:0,major,minor:0,defects:major?'门襟跳针':''}}});
  expect(()=>report('pass',1)).toThrow('结论须为不通过');
  report('reject',1);
  expect(f.state.fulfillment.qcReports.at(-1)!.aql).toMatchObject({inspected:10,major:1,outcome:{result:'reject'}});
 });
});
describe('incoming inspection (IQC)',()=>{
 function iqc(){
  const f=fabricStagedFixture();
  const greige=f.state.fulfillment.purchases.find(p=>p.id===f.greige)!;greige.iqcRequired=true;
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.greige,quantity:3800,rejected:0,destination:'warehouse',location:'吴江中转仓',date:'2026-10-13',evidence:'送货单',fileIds:[]}});
  const task=f.state.fulfillment.qcTasks.find(t=>t.kind==='incoming')!;
  const qc=(command:MistCommand)=>{const r=applyMistCommand(f.state,command,{id:()=>crypto.randomUUID(),now:'2026-10-13T12:00:00Z',actorId:'qc',actorName:'面料QC'});Object.assign(f.state,r.state);return r.result;};
  return{f,task,qc};
 }
 it('holds received material as locked stock with a pending IQC task',()=>{
  const {f,task}=iqc();
  expect(task).toMatchObject({kind:'incoming',domain:'fabric',state:'pending',incoming:{quantity:3800,unit:'米'}});
  expect(f.state.fulfillment.stock[0]).toMatchObject({available:0,locked:3800});
  expect(()=>f.run({type:'fulfillment.materials.issue',payload:{id:f.state.fulfillment.stock[0].id,targetProductionId:f.branch.id,quantity:1,location:'染厂',person:'x',note:'x'}})).toThrow('可用量不足');
 });
 it('releases the lot after a passing four-point report',()=>{
  const {f,task,qc}=iqc();
  qc({type:'fulfillment.qc.claim',payload:{id:task.id,domain:'fabric'}});
  qc({type:'fulfillment.qc.report',payload:{id:task.id,domain:'fabric',result:'pass',report:'IQC-1',opinion:'验布合格',measurements:[],fileIds:[],reviewedAt:'2026-10-13T12:00:00Z',fabricInspection:{widthInches:62,limit:40,rolls:[{roll:'R1',yards:100,points:20}],lab:{shrinkageWarp:-3}}}});
  expect(()=>f.run({type:'fulfillment.materials.issue',payload:{id:f.state.fulfillment.stock[0].id,targetProductionId:f.branch.id,quantity:1,location:'染厂',person:'x',note:'x'}})).toThrow('可用量不足');
  f.run({type:'fulfillment.qc.incoming.close',payload:{id:task.id,evidence:'IQC-1 合格，放行'}});
  expect(f.state.fulfillment.stock[0]).toMatchObject({available:3800,locked:0});
  expect(()=>f.run({type:'fulfillment.qc.incoming.close',payload:{id:task.id,evidence:'again'}})).toThrow('待放行');
 });
 it('turns a failed lot into rejected receipt quantity for return or replacement',()=>{
  const {f,task,qc}=iqc();
  qc({type:'fulfillment.qc.claim',payload:{id:task.id,domain:'fabric'}});
  expect(()=>qc({type:'fulfillment.qc.report',payload:{id:task.id,domain:'fabric',result:'pass',report:'IQC-2',opinion:'x',measurements:[],fileIds:[],reviewedAt:'2026-10-13T12:00:00Z',fabricInspection:{widthInches:62,limit:20,rolls:[{roll:'R1',yards:100,points:80}],lab:{}}}})).toThrow('结论须为不通过');
  qc({type:'fulfillment.qc.report',payload:{id:task.id,domain:'fabric',result:'reject',report:'IQC-2',opinion:'疵点超标',measurements:[],fileIds:[],reviewedAt:'2026-10-13T12:00:00Z',fabricInspection:{widthInches:62,limit:20,rolls:[{roll:'R1',yards:100,points:80}],lab:{}}}});
  f.run({type:'fulfillment.qc.incoming.close',payload:{id:task.id,evidence:'IQC-2 疵点超标拒收'}});
  const receipt=f.state.fulfillment.receipts.find(r=>r.purchaseId===f.greige)!;
  expect(receipt).toMatchObject({quantity:0,rejected:3800});expect(f.state.fulfillment.purchases.find(p=>p.id===f.greige)!.received).toBe(0);
  expect(f.state.fulfillment.stock[0]).toMatchObject({available:0,locked:0});
  f.run({type:'fulfillment.procurement.return',payload:{receiptId:receipt.id,quantity:3800,disposition:'replace',date:'2026-10-13',evidence:'退回织厂重织'}});
 });
 it('leaves stock usable when the purchase does not require IQC',()=>{
  const f=fabricStagedFixture();
  f.run({type:'fulfillment.procurement.receive',payload:{id:f.greige,quantity:100,rejected:0,destination:'warehouse',location:'仓',date:'2026-10-13',evidence:'送货单',fileIds:[]}});
  expect(f.state.fulfillment.stock[0].available).toBe(100);expect(f.state.fulfillment.qcTasks.some(t=>t.kind==='incoming')).toBe(false);
 });
});
describe('QC patrol inspection',()=>{
 it('lets a QC open a patrol on a released branch, and a failed patrol pauses the branch',()=>{
  const f=fixture(),{productionId}=f.released();
  const qc={...f.context,actorId:'qc-user',actorName:'质检员'};
  const id=f.run({type:'fulfillment.qc.patrol',payload:{productionId,purpose:'中期巡检',location:'车间',contact:'',due:'2026-10-13'}},qc).id!;
  expect(f.state.fulfillment.qcTasks.find(t=>t.id===id)).toMatchObject({kind:'patrol',state:'working',assigneeId:'qc-user'});
  f.run({type:'fulfillment.qc.report',payload:{id,domain:'garment',result:'reject',report:'PATROL-1',opinion:'车缝线迹不齐',measurements:[],fileIds:[],reviewedAt:f.context.now}},qc);
  expect(()=>f.run({type:'fulfillment.production.complete',payload:{productionId,quantity:10,sizeQuantities:[{size:'M',quantity:4},{size:'L',quantity:6}],date:'2026-10-13',evidence:'点数',fileIds:[]}})).toThrow('质量问题暂停');
  const unreleased=fixture();unreleased.approveOrder();const pid=unreleased.purchase();unreleased.confirmContract(pid);
  expect(()=>unreleased.run({type:'fulfillment.qc.patrol',payload:{productionId:unreleased.state.productions[0].id,purpose:'中期巡检',location:'车间',contact:'',due:'2026-10-13'}})).toThrow('尚未放行');
 });
});
