import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMistLocalRuntime } from '../local';
import { createMistServer } from '../server';
import { MistApiError } from '../errors';
import type { MailTransport } from './transport';

type Row={uid:number;raw:Buffer;seen:boolean;starred:boolean};
class Mailbox {
  boxes:Record<string,Row[]>={INBOX:[],Archive:[],Trash:[],Sent:[]};
  next:Record<string,number>={INBOX:1,Archive:1,Trash:1,Sent:1};
  validity=7;moves=0;flags=0;moveSupported=true;dropReply=false;failFlag=false;
  gate?:Promise<void>;
  put(){const row={uid:this.next.INBOX++,raw:Buffer.from(`From: Buyer <buyer@example.test>\r\nTo: staff@example.test\r\nSubject: Incoming\r\nMessage-ID: <${randomUUID()}@example.test>\r\nDate: Sun, 1 Nov 2026 01:00:00 +0000\r\n\r\nOrder update`),seen:false,starred:false};this.boxes.INBOX.push(row);return row;}
  relocate(from:string,uid:number,to:string){const row=this.boxes[from].find(r=>r.uid===uid)!;this.boxes[from]=this.boxes[from].filter(r=>r!==row);const copy={...row,uid:this.next[to]++};this.boxes[to].push(copy);return copy.uid;}
  transport:MailTransport={
    imap:async()=>{let folder='INBOX';return{
      folders:async()=>Object.keys(this.boxes).map(p=>({path:p,attribs:p==='INBOX'?[]:['\\'+p]})),
      open:async p=>{folder=p;return{uidValidity:this.validity,uidNext:this.next[p]};},
      uidsAfter:async after=>this.boxes[folder].filter(r=>r.uid>after).map(r=>r.uid),
      fetch:async ids=>this.boxes[folder].filter(r=>ids.includes(r.uid)),
      metadata:async ids=>this.boxes[folder].filter(r=>ids.includes(r.uid)).map(r=>({uid:r.uid,seen:r.seen,starred:r.starred})),
      updateFlag:async(uid,flag,value)=>{this.flags++;if(this.gate)await this.gate;if(this.failFlag)throw Object.assign(Error('offline'),{code:'ECONNRESET'});const row=this.boxes[folder].find(r=>r.uid===uid)!;row[flag==='read'?'seen':'starred']=value;},
      canMove:()=>this.moveSupported,
      move:async(uid,to)=>{this.moves++;if(this.gate)await this.gate;const id=this.relocate(folder,uid,to);if(this.dropReply){this.dropReply=false;throw Object.assign(Error('reply lost'),{code:'ECONNRESET'});}return id;},
      searchMessageId:async id=>this.boxes[folder].filter(r=>r.raw.includes(id)).map(r=>r.uid),
      hasMessageId:async id=>this.boxes[folder].some(r=>r.raw.includes(id)),append:async()=>{},close:async()=>{},
    };},smtpVerify:async()=>{},smtpSend:async()=>{throw Error('No outbound mail');},
  };
}
let directory:string;
const workers:Array<{stop():Promise<void>}>=[];
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),'mist-mail-state-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-11-01T01:00:00Z');});
afterEach(async()=>{await Promise.all(workers.splice(0).map(w=>w.stop()));vi.useRealTimers();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
async function fixture(box=new Mailbox(),customize?:(local:ReturnType<typeof createMistLocalRuntime>)=>void){
  const local=createMistLocalRuntime({directory});customize?.(local);
  const app=createMistServer(undefined,{local,mailTransport:box.transport,mailReceive:{tickMs:3_600_000}}),client=request.agent(app);
  const worker=app.locals.mailStateWorker;workers.push(worker);vi.spyOn(worker,'wake').mockImplementation(()=>{});worker.start();
  await client.get('/api/mist/session');await client.post('/api/mist/session').send({profileId:'demo-sales'}).expect(200);
  const read=async()=>(await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  const command=async(type:string,payload:any,status=200)=>{const w=await read();return client.post(`/api/mist/workspaces/${w.id}/commands`).send({requestId:randomUUID(),expectedRevision:w.revision,command:{type,payload}}).expect(status);};
  const created=await command('email.account.save',{input:{address:'staff@example.test',displayName:'业务',kind:'personal',memberIds:[],aliases:[],signature:'',transport:{imapHost:'mail.test',imapPort:993,imapSecure:true,smtpHost:'mail.test',smtpPort:465,smtpSecure:true,username:'staff@example.test'}}});
  const accountId=created.body.receipt.result.id,workspaceId=created.body.workspace.id,base=`/api/mist/workspaces/${workspaceId}/email`;
  await client.put(`${base}/accounts/${accountId}/credential`).send({password:'synthetic'}).expect(200);
  box.put();await client.post(`${base}/accounts/${accountId}/sync`).send({}).expect(200);
  const message=async()=>(await read()).state.email.messages.find((m:any)=>m.accountId===accountId);
  const states=async()=>(await client.get(base+'/states').expect(200)).body.items;
  return{app,client,local,worker,box,read,command,accountId,workspaceId,base,message,states};
}
describe('Durable bidirectional mailbox state',()=>{
  it('lets the next UI action use the visible revision after background acknowledgement of another field',async()=>{
    const f=await fixture(),m=await f.message();const marked=await f.command('email.flag',{id:m.id,flag:'read',value:true});
    const visibleRevision=marked.body.workspace.revision;await f.worker.tick();
    await f.client.post(`/api/mist/workspaces/${f.workspaceId}/commands`).send({requestId:randomUUID(),expectedRevision:visibleRevision,command:{type:'email.move',payload:{id:m.id,folder:'archive'}}}).expect(200);
    await f.worker.tick();expect((await f.message()).remote.folder).toBe('Archive');
  });
  it('still rejects a stale overwrite of the same user-controlled mail field',async()=>{
    const f=await fixture(),m=await f.message(),before=await f.read();await f.command('email.flag',{id:m.id,flag:'starred',value:true});
    await f.client.post(`/api/mist/workspaces/${f.workspaceId}/commands`).send({requestId:randomUUID(),expectedRevision:before.revision,command:{type:'email.flag',payload:{id:m.id,flag:'starred',value:false}}}).expect(409);
  });
  it('queues a local mark atomically, updates the original UID and clears status only after readback',async()=>{
    const f=await fixture(),m=await f.message();await f.command('email.flag',{id:m.id,flag:'read',value:true});
    expect((await f.states())[0]).toMatchObject({state:'pending',fields:['read']});expect(f.box.boxes.INBOX[0].seen).toBe(false);
    await f.worker.tick();expect(f.box.boxes.INBOX[0].seen).toBe(true);expect(await f.states()).toEqual([]);expect((await f.message()).remoteState.read).toBe(true);
  });
  it('coalesces superseded flags and resumes queued work in a fresh process without an open page',async()=>{
    const f=await fixture(),m=await f.message();await f.command('email.flag',{id:m.id,flag:'starred',value:true});await f.command('email.flag',{id:m.id,flag:'starred',value:false});await f.worker.stop();
    const local=createMistLocalRuntime({directory}),app=createMistServer(undefined,{local,mailTransport:f.box.transport,mailReceive:{tickMs:3_600_000}}),worker=app.locals.mailStateWorker;workers.push(worker);vi.spyOn(worker,'wake').mockImplementation(()=>{});worker.start();await worker.tick();
    expect(f.box.flags).toBe(1);expect(f.box.boxes.INBOX[0].starred).toBe(false);expect(await f.states()).toEqual([]);
  });
  it('lets a newer mark supersede an in-flight flag without publishing a stale acknowledgement',async()=>{
    const f=await fixture(),m=await f.message();let release!:()=>void;f.box.gate=new Promise(resolve=>release=resolve);
    await f.command('email.flag',{id:m.id,flag:'read',value:true});const running=f.worker.tick();
    for(let n=0;n<100&&!f.box.flags;n++)await new Promise(resolve=>setTimeout(resolve,5));expect(f.box.flags).toBe(1);
    await f.command('email.flag',{id:m.id,flag:'read',value:false});f.box.gate=undefined;release();await running;
    expect((await f.message()).read).toBe(false);expect((await f.states())[0].state).toBe('pending');
    await f.worker.tick();expect(await f.states()).toEqual([]);expect(f.box.boxes.INBOX[0].seen).toBe(false);
  });
  it('moves through archive, trash and restore with exact UID replacement while retaining local links and files',async()=>{
    const f=await fixture(),m=await f.message();
    for(const target of ['archive','trash','restore']){await f.command('email.move',{id:m.id,folder:target});await f.worker.tick();}
    const after=await f.message();expect(after.id).toBe(m.id);expect(after.folder).toBe('archive');expect(after.remote.folder).toBe('Archive');expect(after.links).toEqual(m.links);expect(after.attachments).toEqual(m.attachments);expect(f.box.moves).toBe(3);expect(await f.states()).toEqual([]);
  });
  it('recovers a successful MOVE whose reply was lost without issuing MOVE a second time',async()=>{
    const f=await fixture(),m=await f.message();f.box.dropReply=true;await f.command('email.move',{id:m.id,folder:'archive'});await f.worker.tick();
    expect((await f.states())[0].state).toBe('unknown');expect(f.box.moves).toBe(1);
    await f.command('email.move',{id:m.id,folder:'trash'},409);
    await f.command('email.state.retry',{id:m.id});await f.worker.tick();expect(f.box.moves).toBe(1);expect(await f.states()).toEqual([]);expect((await f.message()).remote.folder).toBe('Archive');
  });
  it('never enters unsafe COPY/EXPUNGE fallback and lets the employee retain original mailbox state',async()=>{
    const f=await fixture(),m=await f.message();f.box.moveSupported=false;await f.command('email.move',{id:m.id,folder:'archive'});await f.worker.tick();
    expect((await f.states())[0].state).toBe('failed');expect(f.box.moves).toBe(0);expect((await f.message()).folder).toBe('archive');
    await f.command('email.state.retry',{id:m.id,acceptRemote:true});await f.worker.tick();expect((await f.message()).folder).toBe('inbox');expect(await f.states()).toEqual([]);
  });
  it('resolves the displayed unknown move before older failed flags and accepts the latest actual UID',async()=>{
    const f=await fixture(),m=await f.message();f.box.failFlag=true;
    await f.command('email.flag',{id:m.id,flag:'read',value:true});await f.worker.tick();
    await f.command('email.flag',{id:m.id,flag:'starred',value:true});await f.worker.tick();
    f.box.dropReply=true;await f.command('email.move',{id:m.id,folder:'archive'});await f.worker.tick();
    expect((await f.states())[0].state).toBe('unknown');const writes=f.box.flags;
    await f.command('email.state.retry',{id:m.id,acceptRemote:true});await f.worker.tick();expect((await f.message()).remote.folder).toBe('Archive');
    for(let n=0;n<2;n++){await f.command('email.state.retry',{id:m.id,acceptRemote:true});await f.worker.tick();}
    expect(await f.states()).toEqual([]);expect(f.box.flags).toBe(writes);expect(f.box.moves).toBe(1);
    expect(await f.message()).toMatchObject({folder:'archive',read:false,starred:false});
  });
  it('pulls original read/star state and recognises an externally moved byte-identical message without duplicates',async()=>{
    const f=await fixture(),m=await f.message();f.box.boxes.INBOX[0].seen=true;f.box.boxes.INBOX[0].starred=true;
    await f.client.post(`${f.base}/accounts/${f.accountId}/sync`).send({}).expect(200);expect(await f.message()).toMatchObject({read:true,starred:true});
    f.box.relocate('INBOX',m.remote.uid,'Archive');await f.client.post(`${f.base}/accounts/${f.accountId}/sync`).send({}).expect(200);
    const w=await f.read(),rows=w.state.email.messages.filter((r:any)=>r.accountId===f.accountId);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:m.id,folder:'archive',remote:{folder:'Archive'}});
  });
  it('preserves a newer unsent intent during inbound refresh and backs off temporary failures',async()=>{
    const f=await fixture(),m=await f.message();f.box.failFlag=true;await f.command('email.flag',{id:m.id,flag:'read',value:true});await f.worker.tick();
    const calls=f.box.flags;await f.worker.tick();expect(f.box.flags).toBe(calls);expect((await f.states())[0].state).toBe('failed');
    await f.client.post(`${f.base}/accounts/${f.accountId}/sync`).send({}).expect(200);expect((await f.message()).read).toBe(true);
    f.box.failFlag=false;vi.setSystemTime(Date.now()+5*60_000);await f.worker.tick();expect(await f.states()).toEqual([]);expect(f.box.boxes.INBOX[0].seen).toBe(true);
  });
  it('blocks lost authority before remote writes without exposing saved authorization to a reader',async()=>{
    let allowed=true;const f=await fixture(new Mailbox(),local=>{const original=local.authorize;local.authorize=async(db,actor,p)=>{if(!allowed&&(actor as any).mailStateWorker)throw new MistApiError('FORBIDDEN','Withdrawn',403);return original(db,actor,p);};});
    const m=await f.message();await f.command('email.flag',{id:m.id,flag:'starred',value:true});allowed=false;await f.worker.tick();expect(f.box.flags).toBe(0);
    const states=await f.states();expect(states[0].state).toBe('blocked');expect(JSON.stringify(states)).not.toMatch(/authority|credentialVersion|permissionCeiling|synthetic/);
  });
  it('keeps missing original mail as a local copy instead of deleting it',async()=>{
    const f=await fixture(),m=await f.message();f.box.boxes.INBOX=[];await f.client.post(`${f.base}/accounts/${f.accountId}/sync`).send({}).expect(200);expect(await f.message()).toMatchObject({id:m.id,remoteMissing:true,body:m.body});
  });
  it('does not let a changed receive source execute an older queued operation',async()=>{
    const f=await fixture(),m=await f.message();await f.command('email.flag',{id:m.id,flag:'starred',value:true});
    const account=(await f.read()).state.email.accounts.find((a:any)=>a.id===f.accountId);
    await f.command('email.account.save',{id:f.accountId,input:{...account,transport:{...account.transport,username:'different@example.test'}}});
    await f.worker.tick();expect(f.box.flags).toBe(0);expect((await f.states())[0]).toMatchObject({state:'blocked',canRetry:false});
  });
  it('never recognises a moved message solely from a duplicate Message-ID with different content',async()=>{
    const f=await fixture(),m=await f.message(),row=f.box.boxes.INBOX[0];
    f.box.boxes.INBOX=[];f.box.boxes.Archive.push({...row,uid:f.box.next.Archive++,raw:Buffer.concat([row.raw,Buffer.from('different contents')])});
    await f.client.post(`${f.base}/accounts/${f.accountId}/sync`).send({}).expect(200);
    expect(await f.message()).toMatchObject({id:m.id,remoteMissing:true,folder:'inbox'});
    expect((await f.read()).state.email.messages.filter((r:any)=>r.accountId===f.accountId)).toHaveLength(2);
  });
  it('does not rebind a reset UID generation to different content with the same Message-ID',async()=>{
    const f=await fixture(),m=await f.message();f.box.validity=8;f.box.boxes.INBOX[0].raw=Buffer.concat([f.box.boxes.INBOX[0].raw,Buffer.from('changed after reset')]);
    await f.client.post(`${f.base}/accounts/${f.accountId}/sync`).send({}).expect(200);
    const rows=(await f.read()).state.email.messages.filter((r:any)=>r.accountId===f.accountId);expect(rows).toHaveLength(2);
    expect(rows.find((r:any)=>r.id===m.id)).toMatchObject({body:m.body,remote:{uidValidity:7},remoteMissing:true});
    expect(rows.find((r:any)=>r.id!==m.id)).toMatchObject({remote:{uidValidity:8}});
  });
  it('rechecks an Agent connection when processing its intent and allows a current human to recover it',async()=>{
    const f=await fixture(),m=await f.message();
    const delegated=(await f.client.post('/api/mist/agent/delegations').send({mode:'operate',workspaceId:f.workspaceId,id:randomUUID()}).expect(201)).body.delegation;
    const rpc=async(name:string,args:any)=>(await request(f.app).post('/api/mist/mcp').set('x-bambook-delegation',delegated.token).send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}).expect(200)).body.result;
    const found=await rpc('bambook_query',{workspaceId:f.workspaceId,type:'email',q:'Incoming'});expect(found.isError).not.toBe(true);expect(found.structuredContent.results[0]).toMatchObject({id:m.id,label:'Incoming'});
    const detail=await rpc('bambook_get',{workspaceId:f.workspaceId,type:'email',id:m.id});expect(detail.structuredContent.object.data.body).toContain('Order update');
    const other=request.agent(f.app);await other.get('/api/mist/session');await other.post('/api/mist/session').send({profileId:'demo-buyer'}).expect(200);
    const readToken=(await other.post('/api/mist/agent/delegations').send({mode:'read',workspaceId:f.workspaceId,id:randomUUID()}).expect(201)).body.delegation.token;
    const hidden=(await request(f.app).post('/api/mist/mcp').set('x-bambook-delegation',readToken).send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'bambook_query',arguments:{workspaceId:f.workspaceId,type:'email',q:'Incoming'}}}).expect(200)).body.result;
    expect(hidden.structuredContent.results).toEqual([]);
    const preview=await rpc('bambook_preview',{workspaceId:f.workspaceId,command:{type:'email.flag',payload:{id:m.id,flag:'starred',value:true}}});expect(preview.isError).not.toBe(true);expect(await f.states()).toEqual([]);
    const result=await rpc('bambook_execute',{workspaceId:f.workspaceId,requestId:randomUUID(),command:{type:'email.flag',payload:{id:m.id,flag:'starred',value:true}}});expect(result.isError).not.toBe(true);
    vi.setSystemTime(Date.parse(delegated.expiresAt)+1);await f.worker.tick();expect(f.box.flags).toBe(0);expect((await f.states())[0].state).toBe('blocked');
    await f.command('email.state.retry',{id:m.id});await f.worker.tick();expect(f.box.boxes.INBOX[0].starred).toBe(true);expect(await f.states()).toEqual([]);
  });
});
