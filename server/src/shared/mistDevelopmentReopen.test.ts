import {expect,it} from 'vitest';
import {applyMistCommand,createMistState,type DevelopmentValues,type MistCommand,type MistContext} from './mistWorkspace';
import {withTestFactories} from './__tests__/utils/devFactories';
function fixture(){
 let n=0;const ctx:MistContext={id:()=>`reopen-${++n}`,now:'2026-11-18T04:00:00Z',actorName:'业务员',actorId:'sales'};let state=withTestFactories(createMistState(ctx,'empty'));
 state.customers.push({id:'c',name:'客户',code:'C',country:'',city:'',industry:'',owner:'',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 const values:DevelopmentValues={name:'羊毛外套',customer:'c',style:'ST-1',season:'AW',category:'外套',kind:'new',fabric:'羊毛',color:'灰',target:'',sizeBase:'M',goal:'版型',factories:['A厂'],due:'2026-11-21',collaborators:[],sampleQuantity:1};
 const run=(command:unknown)=>{const r=applyMistCommand(state,command as MistCommand,ctx);state=r.state;return r.result;};const {devId,versionId}=run({type:'development.submit',payload:{values,fileIds:[]}})as any;
 run({type:'development.recordSample',payload:{devId,versionId,sample:'GW-1',quantity:1,returnedAt:ctx.now}});
 const dev=()=>state.devs.find(d=>d.id===devId)!,version=()=>state.versions.find(v=>v.id===versionId)!;
 version().qc={result:'conditional',reviewer:'QC',reviewedAt:ctx.now,report:'QC-1',opinion:'已留原评审'};version().confirmations=[{id:'decision',result:'approved',confirmer:'客户',organization:'客户',confirmedAt:ctx.now,basis:'原客户确认件',originalText:'认可',recordedAt:ctx.now,recordedBy:'业务员'}];version().archivedAt=ctx.now;
 const close=(kind:'archived'|'cancelled'='archived',reason='开发暂告结束')=>run({type:'development.close',payload:{devId,kind,reason}});
 const reopen=(closureId=(dev().closure as any)?.id,reason='继续下一轮开发',expectedVersionId=dev().currentVersionId)=>run({type:'development.reopen',payload:{devId,closureId,expectedVersionId,reason}});
 return{ctx,devId,versionId,run,dev,version,close,reopen,get state(){return state;}};
}
it.each(['archived','cancelled']as const)('reopens only the whole-case gate and retains %s history, exact versions, QC, adoption, files and quantity facts',kind=>{
 const f=fixture();f.close(kind);const before=structuredClone(f.state),closed=structuredClone(f.dev().closure)as any;expect(closed.id).toBeTruthy();f.reopen();
 expect(f.dev().closure).toBeUndefined();expect(f.dev().currentVersionId).toBe(f.versionId);expect(f.dev().state).toBe('成果已留档');expect(f.state.versions).toEqual(before.versions);
 for(const key of Object.keys(before))if(!['devs','events','notifications'].includes(key))expect((f.state as any)[key]).toEqual((before as any)[key]);
 for(const event of before.events)expect(f.state.events.find(e=>e.id===event.id)).toEqual(event);
 const history=f.state.events[0]as any;expect(history.developmentLifecycle).toMatchObject({action:'reopened',closure:closed,reason:'继续下一轮开发',actorId:'sales',expectedVersionId:f.versionId});
 expect(f.state.events.find((e:any)=>e.developmentLifecycle?.action==='closed')).toMatchObject({developmentLifecycle:{closure:{id:closed.id,kind,by:'业务员',byId:'sales',at:f.ctx.now,reason:'开发暂告结束'}}});
 f.run({type:'development.round.create',payload:{devId:f.devId,factories:['A厂'],requirements:'核对新一轮版型',targetDate:'2026-11-22'}});expect(f.state.rounds).toHaveLength(2);expect(f.state.versions.find(v=>v.id===f.versionId)).toEqual(before.versions[0]);
});
it('uses a new trusted identity for each close cycle even with the same fixed clock, person and reason',()=>{
 const f=fixture();f.close();const first=(f.dev().closure as any).id;expect(first).toBeTruthy();f.reopen();f.close();const second=(f.dev().closure as any).id;expect(second).not.toBe(first);const before=structuredClone(f.state);
 expect(()=>f.reopen(first)).toThrow(/关闭记录已变化/);expect(f.state).toEqual(before);
});
it('does not accept a caller-supplied closing identity',()=>{
 const f=fixture();f.run({type:'development.close',payload:{devId:f.devId,kind:'archived',reason:'结束',id:'forged',closureId:'forged'}});expect((f.dev().closure as any).id).toBeTruthy();expect((f.dev().closure as any).id).not.toBe('forged');expect((f.state.events[0]as any).developmentLifecycle.closure.id).toBe((f.dev().closure as any).id);
});
it('rejects empty reasons, absent close authority, a changed current version and a different close token atomically',()=>{
 const f=fixture();expect(()=>f.reopen('forged')).toThrow(/未结束|未关闭/);f.close();let before=structuredClone(f.state);expect(()=>f.reopen(undefined,' ')).toThrow(/原因/);expect(f.state).toEqual(before);expect(()=>f.reopen('forged')).toThrow(/关闭记录已变化/);expect(f.state).toEqual(before);expect(()=>f.reopen(undefined,'继续','another-version')).toThrow(/当前版本已变化/);expect(f.state).toEqual(before);
});
it('keeps an existing exact close event unchanged and records its complete source when reopening a pre-ID close',()=>{
 const f=fixture();f.close();delete(f.dev().closure as any).id;delete(f.dev().closure as any).byId;const original=f.state.events[0]as any;delete original.developmentLifecycle;const old=structuredClone(original),token=original.id;
 f.reopen(token);expect(f.state.events.find(e=>e.id===old.id)).toEqual(old);expect((f.state.events[0]as any).developmentLifecycle).toMatchObject({action:'reopened',closure:{id:token,kind:'archived',by:'业务员',at:f.ctx.now,reason:'开发暂告结束'}});
});
it('fails closed rather than guessing when the existing close event is missing or ambiguous',()=>{
 const f=fixture();f.close();delete(f.dev().closure as any).id;const original=f.state.events[0]as any;delete original.developmentLifecycle;f.state.events.unshift({...structuredClone(original),id:'different-event'});const before=structuredClone(f.state);expect(()=>f.reopen(original.id)).toThrow(/关闭记录无法核对/);expect(f.state).toEqual(before);
});
