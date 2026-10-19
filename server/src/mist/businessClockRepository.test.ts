import {expect,it} from 'vitest';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testAuthority,testActor,testContract} from './__tests__/support';
it('uses company business time for commands while keeping the real audit timestamp',async()=>{
 const db=new MemoryMistDatabase(),authority=testAuthority(),actual='2026-10-19T14:00:00.000Z',fixed='2026-10-08T00:18:00.000Z';
 let effective='';
 const repo=new MistRepository(db,{...testContract,applyMistCommand:(state:any,command:any,ctx)=>{
  effective=ctx.now;state.events=[{id:'new-event',at:ctx.now,entityId:'x',entityType:'test',text:'saved',actor:'owner',fileIds:[]}];return {state,result:{}};
 }},new MistPrivateFiles('/unused'),authority.authorize,()=>new Date(actual));
 const created=await repo.create(testActor(),{name:'Clock company',seed:'empty'});
 db.workspaces.get(created.id).state.settings.businessClock={mode:'fixed',at:fixed,timezone:'Asia/Shanghai'};
 const result=await repo.execute(testActor(),created.id,{requestId:'fixed-test',expectedRevision:0,command:{type:'money.add',payload:{cents:1}}});
 expect(effective).toBe(fixed);expect(result.workspace.state.events[0].at).toBe(actual);
 delete db.workspaces.get(created.id).state.settings.businessClock;
 await repo.execute(testActor(),created.id,{requestId:'actual-test',expectedRevision:1,command:{type:'money.add',payload:{cents:1}}});
 expect(effective).toBe(actual);
});
