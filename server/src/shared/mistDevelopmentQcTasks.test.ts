import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type DevelopmentValues,type MistCommand,type MistContext} from './mistWorkspace';
import {emptyFabricRequirements} from './mistDevelopmentDomain';
import {versionTimelineStatus} from './mistDevelopmentCompare';

/** P1-4: a returned development sample creates its own pending QC task; the dev page and workbench share it. */
function fixture(domain:'fabric'|'garment'='fabric'){
 let n=0;const ctx:MistContext={id:()=>`dq-${++n}`,now:'2026-10-16T09:00:00Z',actorName:'面料业务',actorId:'sales'};let state=createMistState(ctx,'empty');
 state.customers.push({id:'c',name:'Harbour',code:'C',country:'',city:'',industry:'',owner:'',grade:'',currency:'EUR',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 state.market.suppliers.push({id:'f',code:'F',name:'华盛毛纺',type:domain==='fabric'?'织造':'成衣加工',capabilities:domain==='fabric'?'织造染整':'缝制',status:'active',country:'',address:'',capacity:0,capacityUnit:'米',leadDays:0,blockReason:'',contacts:[],fileIds:[],note:'',createdAt:ctx.now,updatedAt:ctx.now});
 const values:DevelopmentValues=domain==='fabric'?{domain:'fabric',name:'斜纹',customer:'c',style:'',season:'AW',category:'梭织',kind:'new',fabric:'',color:'蓝灰',target:'',sizeBase:'',goal:'手感',factories:['f'],due:'2026-11-01',collaborators:[],sampleQuantity:2,sampleForm:'米样',sampleUnit:'米',fabricRequirements:emptyFabricRequirements()}
  :{name:'大衣',customer:'c',style:'ST-1',season:'AW',category:'大衣',kind:'new',fabric:'羊毛',color:'灰',target:'',sizeBase:'M',goal:'廓形',factories:['f'],due:'2026-11-01',collaborators:[],sampleQuantity:1};
 const as=(actorId:string,actorName:string)=>({...ctx,actorId,actorName});
 const run=(command:MistCommand,actor:MistContext=ctx)=>{const r=applyMistCommand(state,command,actor);state=r.state;return r.result;};
 const ids=run({type:'development.submit',payload:{values,fileIds:[]}}),devId=ids.devId!,versionId=ids.versionId!;
 const returned=()=>run({type:'development.recordSample',payload:domain==='fabric'?{devId,versionId,sample:'HS-1',quantity:2,form:'米样',unit:'米',location:'面料架 B-2',color:'蓝灰',returnedAt:ctx.now}:{devId,versionId,sample:'S-1',quantity:1,returnedAt:ctx.now}});
 const qc=(result:'pass'|'conditional'|'reject')=>({result,reviewer:'许言',reviewedAt:ctx.now,report:'QC-D-1',opinion:'克重门幅在公差内',...(domain==='fabric'?{fabricMeasurements:[]}:{measurements:[]})});
 const devQc=(result:'pass'|'conditional'|'reject',actor:MistContext=as('qc','许言'))=>run({type:'development.recordQc',payload:{devId,versionId,...(domain==='fabric'?{domain:'fabric' as const}:{}),qc:qc(result)}},actor);
 const tasks=()=>state.fulfillment.qcTasks.filter(t=>t.source.kind==='version'&&t.source.versionId===versionId);
 return{ctx,as,run,devId,versionId,returned,devQc,tasks,get state(){return state;}};
}

describe('development sample QC tasks',()=>{
 it('keeps fabric workbench measurements and their original units on the report and exact development version',()=>{
  const f=fixture();f.returned();const task=f.tasks()[0],qc=f.as('qc','许言');f.run({type:'fulfillment.qc.claim',payload:{id:task.id,domain:'fabric'}},qc);
  const facts=[{property:'克重',actual:98,unit:'g/m²'},{property:'有效幅宽',actual:144,unit:'cm'}],targets=structuredClone(f.state.versions[0].fabricRequirements);
  f.run({type:'fulfillment.qc.report',payload:{id:task.id,domain:'fabric',result:'reject',report:'F-01',opinion:'克重和有效幅宽不符合本次要求',measurements:[],fabricMeasurements:facts,fileIds:[],reviewedAt:f.ctx.now}} as any,qc);
  expect(f.state.fulfillment.qcReports[0].fabricMeasurements).toEqual(facts);expect(f.state.versions[0].qc?.fabricMeasurements).toEqual(facts);expect(f.state.versions[0].fabricRequirements).toEqual(targets);expect(f.tasks()[0].state).toBe('blocked');
 });
 it('keeps fabric development-page measurements on the same workbench report',()=>{
  const f=fixture();f.returned();const facts=[{property:'克重',actual:124.5,unit:'g/m²'}];f.run({type:'development.recordQc',payload:{devId:f.devId,versionId:f.versionId,domain:'fabric',qc:{result:'pass',reviewer:'许言',reviewedAt:f.ctx.now,report:'F-02',opinion:'专业评审通过',fabricMeasurements:facts}}},f.as('qc','许言'));
  expect(f.state.fulfillment.qcReports[0].fabricMeasurements).toEqual(facts);expect(f.state.versions[0].qc?.fabricMeasurements).toEqual(facts);
 });
 it('rejects garment-style tolerance measurements on a fabric development task without writing a report',()=>{
  const f=fixture();f.returned();const id=f.tasks()[0].id,qc=f.as('qc','许言');f.run({type:'fulfillment.qc.claim',payload:{id,domain:'fabric'}},qc);const before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.qc.report',payload:{id,domain:'fabric',result:'pass',report:'WRONG',opinion:'Wrong model',measurements:[{point:'克重',standard:125,actual:124.5,tolerance:1}],fileIds:[],reviewedAt:f.ctx.now}},qc)).toThrow('面料开发不套成衣尺寸公差');expect(JSON.stringify(f.state)).toBe(before);
 });
 it('rejects fabric-development measurements on another QC domain',()=>{
  const f=fixture('garment');f.returned();const id=f.tasks()[0].id,qc=f.as('qc','许言');f.run({type:'fulfillment.qc.claim',payload:{id,domain:'garment'}},qc);const before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.qc.report',payload:{id,domain:'garment',result:'pass',report:'WRONG',opinion:'Wrong domain',measurements:[],fabricMeasurements:[{property:'克重',actual:125,unit:'g/m²'}],fileIds:[],reviewedAt:f.ctx.now}} as any,qc)).toThrow();expect(JSON.stringify(f.state)).toBe(before);
 });
 it.each([[{property:'克重',actual:-1,unit:'g/m²'}],[{property:'克重',actual:Infinity,unit:'g/m²'}],[{property:'',actual:125,unit:'g/m²'}],[{property:'克重',actual:125,unit:''}],Array.from({length:201},()=>({property:'克重',actual:125,unit:'g/m²'}))])('rejects invalid or unbounded fabric facts atomically: %j',(...rows)=>{
  const f=fixture();f.returned();const id=f.tasks()[0].id,qc=f.as('qc','许言');f.run({type:'fulfillment.qc.claim',payload:{id,domain:'fabric'}},qc);const before=JSON.stringify(f.state);
  expect(()=>f.run({type:'fulfillment.qc.report',payload:{id,domain:'fabric',result:'pass',report:'INVALID',opinion:'Invalid facts',measurements:[],fabricMeasurements:rows,fileIds:[],reviewedAt:f.ctx.now}} as any,qc)).toThrow();expect(JSON.stringify(f.state)).toBe(before);
 });
 it('creates one pending workbench task when the sample is returned and shows it on the case',()=>{
  const f=fixture();expect(f.tasks()).toHaveLength(0);
  f.returned();
  expect(f.tasks()).toEqual([expect.objectContaining({kind:'sample',domain:'fabric',state:'pending',assignee:'',factory:'华盛毛纺',location:'面料架 B-2',due:'2026-10-16'})]);
  expect(f.tasks()[0].sampleId).toBe(f.state.fulfillment.samples[0].id);
  expect(f.state.devs[0].state).toBe('待 QC 认领');
  f.run({type:'fulfillment.qc.claim',payload:{id:f.tasks()[0].id,domain:'fabric'}},f.as('qc','许言'));
  expect(f.state.devs[0].state).toBe('QC 待评审');
 });
 it('labels the version card 待 QC 认领 until a QC claims the task',()=>{
  const f=fixture();f.returned();
  expect(versionTimelineStatus(f.state.versions[0],f.state).label).toBe('待 QC 认领');
  f.run({type:'fulfillment.qc.claim',payload:{id:f.tasks()[0].id,domain:'fabric'}},f.as('qc','许言'));
  expect(versionTimelineStatus(f.state.versions[0],f.state).label).toBe('QC 中');
 });
 it('records the development page QC on the same task, so the workbench shows the result',()=>{
  const f=fixture();f.returned();f.devQc('pass');
  const [task]=f.tasks();
  expect(task).toMatchObject({state:'reported',assigneeId:'qc',assignee:'许言'});
  expect(f.state.fulfillment.qcReports.find(r=>r.id===task.reportIds[0])).toMatchObject({result:'pass',report:'QC-D-1',reviewer:'许言'});
  expect(f.state.versions[0].qc).toMatchObject({result:'pass'});
 });
 it('blocks the task on a failed result and refuses a page entry while another QC holds the task',()=>{
  const f=fixture('garment');f.returned();
  f.run({type:'fulfillment.qc.claim',payload:{id:f.tasks()[0].id,domain:'garment'}},f.as('qc2','周砚'));
  const before=JSON.stringify(f.state);
  expect(()=>f.devQc('pass')).toThrow('已由 周砚 认领');
  expect(JSON.stringify(f.state)).toBe(before);
  f.devQc('reject',f.as('qc2','周砚'));
  expect(f.tasks()[0].state).toBe('blocked');
 });
 it('creates a task for each extra physical form and never duplicates one',()=>{
  const f=fixture();f.returned();
  f.run({type:'development.version.addSampleForm',payload:{devId:f.devId,versionId:f.versionId,form:'色样',quantity:3,unit:'份',location:'架C'}});
  expect(f.tasks().map(t=>t.location)).toEqual(['面料架 B-2','架C']);
  f.run({type:'fulfillment.samples.sync',payload:{}});
  expect(f.tasks()).toHaveLength(2);
 });
 it('does not create tasks for minor versions, which reuse the parent sample and QC',()=>{
  const f=fixture('garment');f.returned();f.devQc('pass');
  const minor=f.run({type:'development.version.recordMinor',payload:{devId:f.devId,versionId:f.versionId,change:'袖口收 0.5cm'}});
  expect(f.state.fulfillment.qcTasks.filter(t=>t.source.kind==='version'&&t.source.versionId===minor.versionId)).toHaveLength(0);
 });
});
