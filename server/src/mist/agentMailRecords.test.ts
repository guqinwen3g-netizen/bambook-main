import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';import {MistRepository} from './repository';import {MistPrivateFiles} from './files';
import {agentCatalog,agentGet,agentQuery,agentRelated} from './agentRead';
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string;
const company='11111111-1111-4111-8111-111111111111',now='2026-11-01T00:06:00Z';
const actor:any={userId:'sales',displayName:'Sales',roleIds:[SYSTEM_ROLE_IDS.SALES+'@'+company],roles:[],companyId:company,authorizationLoaded:true};
const draft=(id:string,accountId:string)=>({id,accountId,from:'staff@example.test',to:'buyer@example.test',cc:'',bcc:'',subject:'Production reply '+id,body:'Current draft body '+id,template:'',links:[],fileIds:[],createdAt:now,updatedAt:now,updatedBy:'Sales'});
const send=(id:string,accountId:string)=>({...draft(id,accountId),cc:'other@example.test',requestKey:'private-request-sentinel',fingerprint:'private-fingerprint-sentinel',aliasKeys:['private-alias-sentinel'],messageId:'<mail@example.test>',status:'partial',recipients:[{address:'buyer@example.test',role:'to',status:'accepted',reply:'250 accepted',at:now},{address:'other@example.test',role:'cc',status:'rejected',reply:'550 rejected',at:now}],attempts:[{at:now,actor:'Sales',outcome:'partial',code:'SMTP_PARTIAL',message:'One recipient rejected'}],response:'private-transport-sentinel',createdBy:'Sales',createdById:'sales'});
beforeEach(async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse(now));directory=await mkdtemp(path.join(tmpdir(),'mist-agent-mail-'));db=new MemoryMistDatabase();auth=testAuthority();auth.users.set('sales',{active:true,permissions:['ai:chat','emails:read','emails:write']});db.companyMembers.push({companyId:company,userId:'sales',status:'active'});
 const state=createMistState({id:randomUUID,now,actorId:'sales',actorName:'Sales'},'empty');state.email.accounts=[{id:'own',ownerId:'sales',memberIds:[]},{id:'shared',ownerId:'other',memberIds:['sales']},{id:'private',ownerId:'other',memberIds:[]}] as any;
 state.email.drafts=[draft('draft-own','own'),draft('draft-shared','shared'),draft('draft-private','private')] as any;state.email.sends=[send('send-own','own'),send('send-shared','shared'),send('send-private','private')] as any;
 workspaceId=randomUUID();db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'other',companyId:company,slug:'company@'+company,name:'Company',revision:4,state,createdAt:new Date(),updatedAt:new Date()});repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize);
});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});
async function view(){const{workspace,actor:current}=await repo.getForAgent(actor,workspaceId);return{state:workspace.state,actor:current};}
it('publishes separate draft and send-attempt types, preserving readable draft content and identity',async()=>{
 const f=await view();expect(agentCatalog(f.actor).map(t=>t.type)).toEqual(expect.arrayContaining(['email_draft','email_send']));const record=agentGet(f.state,f.actor,'email_draft','draft-own');expect(record.data).toMatchObject({id:'draft-own',accountId:'own',body:'Current draft body draft-own'});expect(record.truncated).toBe(false);expect(record.link).toContain('view=emails');expect(record.link).toContain('id=draft-own');
});
it('exposes recipient-level sending facts but never returns or searches transport control fields',async()=>{
 const f=await view(),before=JSON.stringify(db.workspaces.get(workspaceId).state.email.sends);const record=agentGet(f.state,f.actor,'email_send','send-own');expect(record.data).toMatchObject({status:'partial',effectiveStatus:'partial',recipientCounts:{accepted:1,rejected:1,pending:0,failed:0,unknown:0}});expect(record.data.recipients).toEqual(expect.arrayContaining([expect.objectContaining({status:'accepted'}),expect.objectContaining({status:'rejected'})]));expect(JSON.stringify(record)).not.toContain('sentinel');expect(agentQuery(f.state,f.actor,{type:'email_send',q:'private-request-sentinel'}).total).toBe(0);expect(JSON.stringify(db.workspaces.get(workspaceId).state.email.sends)).toBe(before);
});
it('uses current personal and shared mailbox visibility, and removes both record types after sharing is withdrawn',async()=>{
 let f=await view();expect(()=>agentGet(f.state,f.actor,'email_draft','draft-private')).toThrow();expect(()=>agentGet(f.state,f.actor,'email_send','send-private')).toThrow();expect(agentGet(f.state,f.actor,'email_draft','draft-shared').data.id).toBe('draft-shared');expect(agentGet(f.state,f.actor,'email_send','send-shared').data.id).toBe('send-shared');db.workspaces.get(workspaceId).state.email.accounts.find((a:any)=>a.id==='shared').memberIds=[];f=await view();expect(()=>agentGet(f.state,f.actor,'email_draft','draft-shared')).toThrow();expect(()=>agentGet(f.state,f.actor,'email_send','send-shared')).toThrow();expect(agentQuery(f.state,f.actor,{type:'email_send',q:'send-private'}).total).toBe(0);
});
it('rechecks mail read access rather than accepting a previously authorized actor snapshot',async()=>{
 auth.users.get('sales')!.permissions=['ai:chat'];const f=await view();expect(()=>agentQuery(f.state,f.actor,{type:'email_draft'})).toThrow();expect(()=>agentGet(f.state,f.actor,'email_send','send-own')).toThrow();
});
it('returns stale sending as effectively unknown and does not modify the persisted sending result',async()=>{
 const original=db.workspaces.get(workspaceId).state.email.sends[0];original.status='sending';original.updatedAt='2026-11-01T00:00:00Z';original.recipients=[];const f=await view(),record=agentGet(f.state,f.actor,'email_send','send-own');expect(record.data).toMatchObject({status:'sending',effectiveStatus:'unknown'});expect(db.workspaces.get(workspaceId).state.email.sends[0].status).toBe('sending');
});
it('links a successful attempt to its sent message and only exposes currently visible related objects',async()=>{
 const raw=db.workspaces.get(workspaceId).state;raw.email.messages=[{id:'sent-message',accountId:'own',folder:'sent',subject:'Current sent mail',body:'Body',sendId:'send-own'}];Object.assign(raw.email.sends[0],{status:'sent',sentMessageId:'sent-message',replyToId:'private-message'});raw.email.messages.push({id:'private-message',accountId:'private',folder:'inbox',subject:'Hidden original',body:'Private'});
 const f=await view();expect(agentGet(f.state,f.actor,'email_send','send-own').link).toContain('id=sent-message');const related=agentRelated(f.state,f.actor,'email','sent-message');expect(related.related).toContainEqual(expect.objectContaining({type:'email_send',id:'send-own'}));expect(JSON.stringify(agentRelated(f.state,f.actor,'email_send','send-own'))).not.toContain('private-message');
});
it('reports bounded details and exact visible recipient counts without hiding truncation or reviving superseded links',async()=>{
 const raw=db.workspaces.get(workspaceId).state.email.sends[0];raw.body='x'.repeat(20000);raw.recipients=Array.from({length:22},(_,i)=>({address:'person'+i+'@example.test',role:'to',status:i===21?'unknown':'accepted',reply:'',at:now}));raw.to=raw.recipients.map((r:any)=>r.address).join(', ');raw.cc='';raw.status='unknown';raw.supersededById='replacement';const f=await view(),record=agentGet(f.state,f.actor,'email_send','send-own');expect(record.truncated).toBe(true);expect(record.data.recipientCounts).toMatchObject({accepted:21,unknown:1});expect(record.link).toBeNull();expect(String(record.data.body).length).toBeLessThanOrEqual(10000);
});
it('preserves sending facts and recipient totals when large reply details exceed the object budget',async()=>{
 const raw=db.workspaces.get(workspaceId).state.email.sends[0];raw.body='x'.repeat(12000);raw.status='sent';raw.recipients=Array.from({length:40},(_,i)=>({address:'recipient'+i+'@example.test',role:'to',status:'accepted',reply:'250 '+('r'.repeat(1000)),at:now}));raw.to=raw.recipients.map((r:any)=>r.address).join(', ');raw.cc='';
 const f=await view(),record=agentGet(f.state,f.actor,'email_send','send-own');expect(record.truncated).toBe(true);expect(record.data).toMatchObject({status:'sent',effectiveStatus:'sent',recipientCounts:{accepted:40,rejected:0}});expect(JSON.stringify(record).length).toBeLessThan(17000);expect(JSON.stringify(record)).not.toContain('sentinel');
});
it('keeps the latest sending observation available after older history is bounded',async()=>{
 const raw=db.workspaces.get(workspaceId).state.email.sends[0];raw.body='b'.repeat(12000);raw.status='unknown';raw.attempts=Array.from({length:32},(_,i)=>({at:now,actor:'Sales',outcome:i===31?'unknown':'claimed',code:i===31?'LATEST_TIMEOUT':'OLD_ATTEMPT',message:'m'.repeat(300),recipients:['buyer@example.test']}));
 const f=await view(),record=agentGet(f.state,f.actor,'email_send','send-own');expect(record.truncated).toBe(true);expect(record.data).toMatchObject({attemptCount:32,latestAttempt:{code:'LATEST_TIMEOUT',outcome:'unknown'}});expect(JSON.stringify(record).length).toBeLessThan(17000);
});
