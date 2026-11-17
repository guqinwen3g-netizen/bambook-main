import {retainFixtureFactoryTasks} from '../shared/__tests__/utils/devClose';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MistRepository} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';
import {applyMistCommand,createMistState,mistCommandPermission} from '../shared/mistWorkspace';
const company='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string,devId:string;
const actor=(userId='demo-sales',companyId=company):any=>({userId,displayName:'同名业务员',roles:[],departmentIds:[],companyId,authorizationLoaded:true,permissions:['products:read','products:write']});
const row=()=>db.workspaces.get(workspaceId)!;
const current=()=>row().state.devs.find((d:any)=>d.id===devId);
const execute=(command:any,who=actor(),requestId=randomUUID(),expectedRevision=row().revision)=>repo.execute(who,workspaceId,{requestId,expectedRevision,command});
const close=()=>execute({type:'development.close',payload:{devId,kind:'archived',reason:'暂告结束',...retainFixtureFactoryTasks(row().state,devId)}});
const reopenCommand=()=>({type:'development.reopen',payload:{devId,closureId:current().closure.id,expectedVersionId:current().currentVersionId,reason:'继续核对版型'}});
beforeEach(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'development-reopen-'));db=new MemoryMistDatabase();auth=testAuthority();workspaceId=randomUUID();
 for(const userId of['demo-sales','other','reader']){auth.users.set(userId,{active:true,permissions:userId==='reader'?['products:read']:['products:read','products:write']});db.companyMembers.push({companyId:company,userId,status:'active'});}
 db.companyMembers.push({companyId:foreign,userId:'demo-sales',status:'active'});
 const state=createMistState({id:randomUUID,now:'2026-11-18T04:00:00Z',actorName:'管理员'},'demo');const dev=state.devs[0];devId=dev.id;dev.ownerId='demo-sales';dev.owner='同名业务员';delete dev.closure;
 db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'boss',companyId:company,slug:'company@'+company,name:'模拟公司',revision:0,state,createdAt:new Date(),updatedAt:new Date()});
 repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize,()=>new Date('2026-11-18T04:00:00Z'));
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it('persists one restoration with the original exact close snapshot, keeps money/quality/sample data and replays without reopening a later same-clock close',async()=>{
 await close();const before=structuredClone(row().state),original=structuredClone(current().closure),command=reopenCommand(),requestId=randomUUID(),expected=row().revision;
 expect(before.invoices.length).toBeGreaterThan(0);const first=await execute(command,actor(),requestId,expected);expect(first.replayed).toBe(false);expect(current().closure).toBeUndefined();
 for(const key of Object.keys(before))if(!['devs','events','notifications'].includes(key))expect(row().state[key]).toEqual(before[key]);
 expect(row().state.versions).toEqual(before.versions);expect(row().state.events[0].developmentLifecycle).toMatchObject({action:'reopened',closure:original,reason:'继续核对版型'});
 const after=structuredClone(row()),receiptCount=db.receipts.size,replay=await execute(command,actor(),requestId,expected);expect(replay.replayed).toBe(true);expect(row()).toEqual(after);expect(db.receipts.size).toBe(receiptCount);
 await close();expect(current().closure.id).not.toBe(original.id);const later=structuredClone(row()),count=db.receipts.size;
 const lateReplay=await execute(command,actor(),requestId,expected);expect(lateReplay.replayed).toBe(true);expect(row()).toEqual(later);expect(db.receipts.size).toBe(count);
 await expect(execute(command,actor(),randomUUID(),expected)).rejects.toMatchObject({status:409});expect(row()).toEqual(later);expect(db.receipts.size).toBe(count);
});
it('refuses read-only, unrelated same-name and different-company sessions before any restoration or receipt',async()=>{
 await close();const before=structuredClone(row()),count=db.receipts.size,command=reopenCommand();expect(mistCommandPermission(command as any)).toBe('products:write');
 for(const[who,status]of [[actor('reader'),403],[actor('other'),404],[actor('demo-sales',foreign),404]]as const){await expect(execute(command,who)).rejects.toMatchObject({status});expect(row()).toEqual(before);expect(db.receipts.size).toBe(count);}
});
it('rechecks a previously allowed owner session after write permission is withdrawn or the account is deactivated',async()=>{
 await close();const command=reopenCommand(),staleSession=actor(),before=structuredClone(row()),count=db.receipts.size;auth.users.get('demo-sales')!.permissions=['products:read'];await expect(execute(command,staleSession)).rejects.toMatchObject({status:403});expect(row()).toEqual(before);expect(db.receipts.size).toBe(count);
 auth.users.get('demo-sales')!.permissions=['products:read','products:write'];auth.users.get('demo-sales')!.active=false;await expect(execute(command,staleSession)).rejects.toMatchObject({status:401});expect(row()).toEqual(before);expect(db.receipts.size).toBe(count);
});
