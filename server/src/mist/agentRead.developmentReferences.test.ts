import {collectTaskSources,taskReadHash,taskScopeHash,taskSourcesVisible,knownCommandSourcesVisible} from './agentTaskVisibility';
import {handleMcpMessage,agentCommandSensitivity} from './agentMcp';
import {agentCommandRisk} from '../shared/mistAgentProposals';
import {expect,it} from 'vitest';
import {agentCatalog,agentGet,agentQuery,agentRelated} from './agentRead';
import {projectState} from './access';
import {projectDevelopmentReferenceAccess,developmentReferenceWithdrawalException} from './developmentReferenceAccess';
import {developmentReferenceFixture} from '../shared/__tests__/utils/developmentReferences';
import {developmentTaskClosePlan} from '../shared/mistDevelopmentTaskLifecycle';
import {createMistState} from '../shared/mistWorkspace';
import {retainFixtureFactoryTasks} from '../shared/__tests__/utils/devClose';
const actor:any={userId:'sales',displayName:'业务员',roles:[],departmentIds:[],authorizationLoaded:true,permissions:['products:read','products:write','suppliers:read','relations:read']};
const scope={userIds:['sales'],teamIds:[]};
const empty=()=>createMistState({id:()=>'',now:'2026-11-18T04:00:00.000Z',actorName:'业务员'},'empty');
function read(f:ReturnType<typeof developmentReferenceFixture>,who=actor){const state=projectState(f.state,who,empty,'admin',scope).state,access=projectDevelopmentReferenceAccess(f.state,state,who,scope);return{state,context:{developmentReferenceAccess:access,developmentTaskClosePlans:Object.fromEntries(state.devs.map(d=>[d.id,developmentTaskClosePlan(f.state,f.state.devs.find(x=>x.id===d.id)!)]))}};}
it('returns an exact independently identifiable reference via existing query/get and keeps current case refs complete without embedding all history',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,{state,context}=read(f);
 const q=agentQuery(state,actor,{type:'development_reference',q:f.devId+' '+f.sampleId});expect(q.results.map(x=>x.id)).toEqual([ref]);
 const obj=agentGet(state,actor,'development_reference',ref,context as any);expect(obj.truncated).toBe(false);expect(obj.data).toMatchObject({id:ref,referenceId:ref,devId:f.devId,sampleId:f.sampleId,currentSnapshot:{facts:{unit:'米',quantity:1.25}}});
 expect((obj as any).referenceSource).toMatchObject({devId:f.devId,referenceId:ref,sampleId:f.sampleId,snapshotId:(f.dev() as any).sampleReferences[0].snapshots.at(-1).id,canDispatch:true});
 const dev=agentGet(state,actor,'development',f.devId,context as any);expect((dev as any).referenceRecords).toMatchObject({readableCount:1,restrictedCount:0,references:[{referenceId:ref,sampleId:f.sampleId}]});expect((dev.data.sampleReferences as any[])[0]).not.toHaveProperty('snapshots');
});
it('relates only the exact case/sample and reference loans, never another case loan for the same physical item',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,out=f.dispatch(ref);
 const created=f.run({type:'development.submit',payload:{values:{...f.dev().values,name:'第二件短外套',style:'ST-REF-B'},fileIds:[]}}),otherDev=f.state.devs.find(d=>d.id===created.devId)!,otherRef=f.run({type:'development.reference.add',payload:{devId:otherDev.id,sampleId:f.sampleId,purpose:'结构对照',fileIds:[]}}).referenceId;
 const otherOut=f.run({type:'development.reference.dispatch',payload:{devId:otherDev.id,taskVersionId:otherDev.versionIds[0],items:[{referenceId:otherRef,quantity:.25,sourceLocation:'样品架 C03'}],sentAt:'2026-11-18',delivery:{kind:'handover',recipient:'工厂收件人',address:'样品室',carrier:'',trackingNo:'',evidence:'供方自提完整参考段'},postage:{amount:0,currency:'CNY',zeroReason:'供方自提'},note:'原段归还'}});
 const {state}=read(f),related=agentRelated(state,actor,'development_reference',ref);expect(related.related).toEqual(expect.arrayContaining([expect.objectContaining({type:'development',id:f.devId}),expect.objectContaining({type:'sample',id:f.sampleId}),expect.objectContaining({type:'sample_movement',id:out.movementIds[0]})]));expect(related.related.some(x=>x.id===otherOut.movementIds[0]||x.id===otherDev.id)).toBe(false);
});
it('keeps original-loan return metadata available after case closure and source recheck, without treating references or files as already read',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,out=f.dispatch(ref);f.sample().unit='码';f.link();f.run({type:'development.close',payload:{devId:f.devId,kind:'archived',reason:'阶段收口保留原段归还',...retainFixtureFactoryTasks(f.state,f.devId)}});
 const {state,context}=read(f),loan=agentGet(state,actor,'sample_movement',out.movementIds[0],context as any);
 expect((loan as any).referenceReturnSource).toMatchObject({devId:f.devId,referenceId:ref,dispatchId:out.dispatchId,loanId:out.movementIds[0],sampleId:f.sampleId,unit:'米',remaining:.5});expect(loan.data).not.toHaveProperty('fileContents');
});
it('preserves module and signed delegation ceilings and does not expose a hidden reference source through catalog, query or single get',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,limited={...actor,permissionCeiling:['relations:read']};let r=read(f,limited);
 expect(agentCatalog(limited).some(x=>x.type==='development_reference')).toBe(false);try{agentGet(r.state,limited,'development_reference',ref,r.context as any);expect.unreachable();}catch(e){expect(e).toMatchObject({status:403});}
 const readonly={...actor,permissionCeiling:['products:read']};r=read(f,readonly);expect((agentGet(r.state,readonly,'development_reference',ref,r.context as any) as any).referenceSource).toBeNull();
 f.sample().registeredById='outside';r=read(f);expect(agentQuery(r.state,actor,{type:'development_reference'}).results).toEqual([]);expect(()=>agentGet(r.state,actor,'development_reference',ref,r.context as any)).toThrow(/不存在|不可见/);
});
it('bounds history independently and preserves complete current identity and actionable sources inside16K',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId;for(let i=0;i<35;i++){f.sample().color='灰'+i;f.link();}
 const {state,context}=read(f),obj=agentGet(state,actor,'development_reference',ref,context as any);expect(obj.truncated).toBe(false);expect(JSON.stringify({data:obj.data,referenceSource:(obj as any).referenceSource}).length).toBeLessThanOrEqual(16000);expect((obj.data.snapshotHistory as any).total).toBe(35);expect((obj.data.snapshotHistory as any).records.length).toBeLessThanOrEqual(3);expect((obj as any).referenceSource.referenceId).toBe(ref);
});
it('returns a complete source list or null for a large case and reads the selected relation independently instead of truncating IDs',()=>{
 const f=developmentReferenceFixture();let lastRef='',lastSample='';
 for(let i=0;i<60;i++){const made=f.run({type:'fulfillment.samples.create',payload:{name:'棉样'+i,category:'面料',form:'米样',quantity:1,unit:'米',location:'A01',size:'',color:'灰',note:'',fileIds:[],source:{kind:'manual',description:'公司留样'}}});lastSample=made.id;lastRef=f.run({type:'development.reference.add',payload:{devId:f.devId,sampleId:lastSample,purpose:'手感对照',fileIds:[]}}).referenceId;}
 const {state,context}=read(f),dev=agentGet(state,actor,'development',f.devId,context as any);expect((dev as any).referenceRecords).toBeNull();expect((dev as any).referenceCounts).toEqual({readable:60,restricted:0});expect(dev.taskClosePlan).not.toBeNull();
 const one=agentGet(state,actor,'development_reference',lastRef,context as any);expect(one.truncated).toBe(false);expect((one as any).referenceSource).toMatchObject({referenceId:lastRef,sampleId:lastSample});expect(JSON.stringify({data:one.data,referenceSource:(one as any).referenceSource}).length).toBeLessThanOrEqual(16000);
});
it('keeps legacy development data and existing command-source fields free of new relation metadata when no reference exists',()=>{
 const f=developmentReferenceFixture(),{state,context}=read(f),obj=agentGet(state,actor,'development',f.devId,context as any);const {img:_img,...expected}=state.devs.find(d=>d.id===f.devId)!;
 expect(obj.data).toEqual(JSON.parse(JSON.stringify(expected)));expect(obj).not.toHaveProperty('referenceRecords');expect(obj).not.toHaveProperty('referenceCounts');expect(obj.taskClosePlan).not.toBeNull();expect(obj.reopenSource).toBeNull();
});
it('provides only an opaque withdrawable relation for a lost source and never exposes its sample, specifications or original ids',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId;f.sample().registeredById='outside';const {state,context}=read(f),obj=agentGet(state,actor,'development',f.devId,context as any),sources=(obj as any).referenceRecords;
 expect(sources).toMatchObject({readableCount:0,restrictedCount:1,references:[{referenceId:ref,readable:false,canRemove:true,canDispatch:false,canReturn:false}]});expect(sources.references[0]).not.toHaveProperty('sampleId');expect(JSON.stringify(obj)).not.toContain(JSON.stringify(f.sampleId));expect(obj.attachments||[]).toEqual([]);
 const readonly={...actor,permissionCeiling:['products:read']},limited=agentGet(state,readonly,'development',f.devId,context as any);expect((limited as any).referenceRecords.references[0].canRemove).toBe(false);
});
it('passes the fresh response-only reference capability through the real MCP dispatcher and ignores tool-supplied authority',async()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,full=read(f);let current=actor;
 const repository:any={getForAgent:async()=>({workspace:{id:'workspace',revision:7,state:full.state,...full.context},actor:current})};
 const call=()=>handleMcpMessage(repository,actor,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'bambook_get',arguments:{workspaceId:'workspace',type:'development_reference',id:ref,developmentReferenceAccess:{writableDevIds:['fake-dev'],writableSampleIds:['fake-sample']}}}},String) as Promise<any>;
 let reply=await call();expect(reply.result.structuredContent.object.referenceSource).toMatchObject({devId:f.devId,referenceId:ref,sampleId:f.sampleId});current={...actor,permissionCeiling:['products:read']};reply=await call();expect(reply.result.structuredContent.object.referenceSource).toBeNull();
});
it.each(['development.reference.add','development.reference.remove','development.reference.dispatch','development.reference.return'])('keeps %s at medium risk and requires the existing human-confirmation path',type=>{
 expect(agentCommandRisk(type)).toBe('medium');expect(agentCommandSensitivity(type)).toBe('confirm');
});
it('records the real typed get as a full-read proof and revokes that exact virtual source when its original sample becomes unreadable',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,first=read(f),obj=agentGet(first.state,actor,'development_reference',ref,first.context as any);
 const proof=collectTaskSources({workspace:{revision:5},object:obj},first.state,[]);expect(proof.find(r=>r.path==='devs.sampleReferences'&&r.id===ref)).toMatchObject({observedRevision:5,fullReadHash:taskReadHash(obj.data)});
 const baseline=taskScopeHash(scope,f.state);f.sample().registeredById='outside';const lost=read(f);expect(taskSourcesVisible(proof,baseline,lost.state,f.state,scope)).toBe(false);
});
it('does not let a proposal referencing a newly hidden relationship inherit its raw source visibility',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId;f.sample().registeredById='outside';const {state}=read(f);
 expect(knownCommandSourcesVisible(f.state,state)({type:'development.reference.dispatch',payload:{devId:f.devId,taskVersionId:f.taskId,items:[{referenceId:ref,quantity:.25,sourceLocation:'样品架 C03'}]}})).toBe(false);
});
it('allows only the fresh qualified opaque withdrawal and never lets other hidden IDs or extra payload fields ride the exception',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId;f.sample().registeredById='outside';const {state}=read(f),command={type:'development.reference.remove',payload:{devId:f.devId,referenceId:ref,reason:'停止引用不可读实物'}},exception=developmentReferenceWithdrawalException(f.state,state,actor,scope,command);
 expect(exception).toEqual({devId:f.devId,referenceId:ref});expect(knownCommandSourcesVisible(f.state,state)(command)).toBe(false);const check=knownCommandSourcesVisible(f.state,state,exception);expect(check(command)).toBe(true);
 expect(check({...command,payload:{...command.payload,otherSourceId:f.sampleId}})).toBe(false);expect(check({...command,payload:{...command.payload,reason:f.sampleId}})).toBe(false);expect(check({...command,type:'development.reference.dispatch'})).toBe(false);expect(check({...command,hidden:f.sampleId})).toBe(false);
 expect(developmentReferenceWithdrawalException(f.state,state,{...actor,permissionCeiling:['products:read']},scope,command)).toBeUndefined();
});
it('keeps an opaque virtual relationship partial and never creates or retains full-read or field baselines from its missing source',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,first=read(f),obj=agentGet(first.state,actor,'development_reference',ref,first.context as any),full=collectTaskSources({workspace:{revision:5},object:obj},first.state,[]);
 f.sample().registeredById='outside';const lost=read(f);
 const prior=full.map(r=>r.path==='devs.sampleReferences'?{...r,fieldRevisions:{'k:sampleId':5}}:r),opaque=agentGet(lost.state,actor,'development',f.devId,lost.context as any);
 const partial=collectTaskSources({workspace:{revision:6},object:opaque},lost.state,prior),proof=partial.find(r=>r.path==='devs.sampleReferences'&&r.id===ref)!;expect(proof.partial).toBe(true);expect(proof.fullReadHash).toBeUndefined();expect(proof.fieldRevisions).toBeUndefined();
});
