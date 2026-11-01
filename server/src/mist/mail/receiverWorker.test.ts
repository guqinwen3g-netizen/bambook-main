import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMistLocalRuntime } from '../local';
import { createMistServer } from '../server';
import { MistApiError } from '../errors';
import { isTokenRevoked } from '../../auth/sessionRevocation';
import type { MailTransport } from './transport';
/** Test mail hosts are fakes behind a stub transport; resolve them to a documentation-range public address. */
const publicMailHost = async () => ['203.0.113.10'];

const password = 'synthetic-mail-password';
let directory: string;
const workers: Array<{ stop(): Promise<void> }> = [];
class Mailbox {
  messages: Array<{ uid: number; raw: Buffer; seen: boolean }> = [];
  opens: string[] = []; connections = 0; fail = false;
  pending?: Promise<void>;
  put() { this.messages.push({ uid: this.messages.length + 1, seen: false, raw: Buffer.from(`From: Buyer <buyer@example.test>\r\nTo: staff@example.test\r\nSubject: Incoming ${this.messages.length + 1}\r\nMessage-ID: <${randomUUID()}@example.test>\r\nDate: Sat, 31 Oct 2026 10:00:00 +0000\r\n\r\nPlease check the attached order.`) }); }
  transport: MailTransport = {
    imap: async (_config, secret) => {
      this.connections++; if (secret.password !== password) throw Object.assign(new Error('AUTHENTICATIONFAILED'), { code: 'EAUTH' });
      if (this.fail) throw Object.assign(new Error('Connection unavailable'), { code: 'ECONNRESET' });
      return {
        folders: async () => [{ path: 'INBOX', attribs: [] }, { path: 'Sent', attribs: ['\\Sent'] }],
        open: async folder => { this.opens.push(folder); return { uidValidity: 7, uidNext: this.messages.length + 1 }; },
        uidsAfter: async after => this.messages.filter(m => m.uid > after).map(m => m.uid),
        fetch: async ids => { if (this.pending) await this.pending; return this.messages.filter(m => ids.includes(m.uid)); },
        hasMessageId: async () => false, append: async () => undefined, close: async () => undefined,
      };
    },
    smtpVerify: async (_config, secret) => { if (secret.password !== password) throw Error('Invalid credentials'); },
    smtpSend: async () => { throw Error('No outbound mail in receive tests'); },
  };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-mail-receiver-'));
  vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-31T10:00:00Z');
});
afterEach(async () => { await Promise.all(workers.splice(0).map(w => w.stop())); vi.useRealTimers(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
function runtime(box: Mailbox, folder = directory) {
  const local = createMistLocalRuntime({ directory: folder });
  const app = createMistServer(undefined, { local, mailResolve:publicMailHost, mailTransport: box.transport, mailReceive: { tickMs: 3_600_000, intervalMs: 1000, leaseMs: 20_000, timeoutMs: 5000 } });
  workers.push(app.locals.mailReceiver); app.locals.mailReceiver.start(3_600_000);
  return { app, local, worker: app.locals.mailReceiver };
}
async function person(app: ReturnType<typeof createMistServer>, profileId = 'demo-sales') {
  const client = request.agent(app); await client.get('/api/mist/session').expect(200); await client.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  return { client, workspace, base: `/api/mist/workspaces/${workspace.id}/email` };
}
async function account(app: ReturnType<typeof createMistServer>, shared = false) {
  const owner = await person(app, shared ? 'local-operator' : 'demo-sales');
  if(shared)owner.workspace=(await owner.client.post(`/api/mist/workspaces/${owner.workspace.id}/members`).send({requestId:randomUUID(),expectedRevision:owner.workspace.revision,action:'add',account:'demo-buyer'}).expect(200)).body.workspace;
  const input = { address: 'staff@example.test', displayName: '业务邮箱', kind: shared ? 'shared' : 'personal', memberIds: shared ? ['demo-buyer'] : [], aliases: [], signature: '', transport: { imapHost: 'mail.test', imapPort: 993, imapSecure: true, smtpHost: 'mail.test', smtpPort: 465, smtpSecure: true, username: 'staff@example.test' } };
  const result = (await owner.client.post(`/api/mist/workspaces/${owner.workspace.id}/commands`).send({ requestId: randomUUID(), expectedRevision: owner.workspace.revision, command: { type: 'email.account.save', payload: { input } } }).expect(200)).body;
  const id = result.receipt.result.id;
  await owner.client.put(owner.base + `/accounts/${id}/credential`).send({ password }).expect(200);
  return { ...owner, id, path: owner.base + `/accounts/${id}/receiving` };
}
async function status(owner: Awaited<ReturnType<typeof account>>) { return (await owner.client.get(owner.base + '/receiving').expect(200)).body.items.find((r: any) => r.accountId === owner.id); }
async function enable(owner: Awaited<ReturnType<typeof account>>, enabled = true, requestId = randomUUID()) {
  const previous = await status(owner);
  return (await owner.client.put(owner.path).send({ enabled, version: previous.version, sourceGeneration:1, requestId }).expect(200)).body.item;
}

describe('Durable opt-in background inbox receiver', () => {
  it('keeps receiving without any page, deduplicates new UIDs and avoids business writes for empty polls', async () => {
    const box = new Mailbox(), r = runtime(box), owner = await account(r.app); box.put();
    await r.worker.tick(); expect(box.opens).toEqual([]);
    await enable(owner); await r.worker.tick(); expect(box.opens).toEqual(['INBOX']);
    let workspace = (await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(workspace.state.email.messages.filter((m: any) => m.accountId === owner.id)).toHaveLength(1);
    const revision = workspace.revision; vi.setSystemTime(Date.now() + 1100); await r.worker.tick();
    workspace = (await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(workspace.revision).toBe(revision); expect((await status(owner)).lastSuccessAt).toBeTruthy();
    box.put(); vi.setSystemTime(Date.now() + 1100); await r.worker.tick();
    workspace = (await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(workspace.state.email.messages.filter((m: any) => m.accountId === owner.id)).toHaveLength(2);
  });
  it('resumes a persisted registration in a fresh service process without a browser login', async () => {
    const box = new Mailbox(), first = runtime(box), owner = await account(first.app); await enable(owner); await first.worker.stop();
    const second = runtime(box); box.put(); await second.worker.tick();
    const current = (await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(current.state.email.messages.filter((m: any) => m.accountId === owner.id)).toHaveLength(1);
    expect((await status(owner)).state).toBe('waiting');
  });
  it('permits only the actual mailbox owner to grant background access and keeps grants secret', async () => {
    const box = new Mailbox(), r = runtime(box), owner = await account(r.app, true), member = await person(r.app, 'demo-buyer');
    await member.client.put(owner.path).send({ enabled: true, version: 0, sourceGeneration:1, requestId: randomUUID() }).expect(403);
    const plan = { enabled: true, version: 0, sourceGeneration:1, requestId: randomUUID() };
    await owner.client.put(owner.path).send(plan).expect(200); await owner.client.put(owner.path).send(plan).expect(200);
    const page = (await member.client.get(owner.base + '/receiving').expect(200)).body;
    expect(page.items[0].canEnable).toBe(false); expect(JSON.stringify(page)).not.toMatch(/credentialVersion|ceiling|issuedAt|synthetic-mail-password/);
    const visible=(await member.client.get(`/api/mist/workspaces/${owner.workspace.id}`).expect(200)).body.workspace;
    const shared=visible.state.email.accounts.find((a:any)=>a.id===owner.id);
    await member.client.post(`/api/mist/workspaces/${visible.id}/commands`).send({requestId:randomUUID(),expectedRevision:visible.revision,command:{type:'email.account.save',payload:{id:owner.id,input:{...shared,kind:'personal',memberIds:[]}}}}).expect(403);
    expect(await readFile(path.join(directory, 'store.json'), 'utf8')).not.toContain(password);
  });
  it('makes two processes share one lease and fences a stopped run before it imports mail', async () => {
    const box = new Mailbox(), a = runtime(box), owner = await account(a.app); await enable(owner); box.put();
    let release!: () => void; box.pending = new Promise<void>(resolve => { release = resolve; });
    const running = a.worker.tick();
    for (let i = 0; i < 100 && !box.opens.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(box.opens).toEqual(['INBOX']); const b = runtime(box); await b.worker.tick(); expect(box.opens).toEqual(['INBOX']);
    const otherOwner = await person(b.app); await enable({ ...owner, client: otherOwner.client }, false); release(); await running;
    const w = (await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(w.state.email.messages.filter((m: any) => m.accountId === owner.id)).toHaveLength(0);
    expect((await status(owner)).enabled).toBe(false);
  });
  it('backs off temporary connection failures and resumes after recovery', async () => {
    const box = new Mailbox(), r = runtime(box), owner = await account(r.app); await enable(owner); box.fail = true;
    await r.worker.tick(); const first = await status(owner); expect(first.state).toBe('retrying');
    const count = box.connections; await r.worker.tick(); expect(box.connections).toBe(count);
    box.fail = false; box.put(); vi.setSystemTime(Date.parse(first.nextRunAt)); await r.worker.tick();
    expect((await status(owner)).error).toBeNull(); expect((await status(owner)).state).toBe('waiting');
  });
  it('blocks a removed permission instead of retaining the original account authority', async () => {
    const box = new Mailbox(); let allowed = true;
    const local = createMistLocalRuntime({ directory });
    const check = local.authorize; local.authorize = async (db, actor, permission) => {
      if (!allowed && (actor as any).mailReceivingWorker) throw new MistApiError('ACCOUNT_DISABLED', '账号已停用', 401);
      return check(db, actor, permission);
    };
    const app = createMistServer(undefined, { local, mailResolve:publicMailHost, mailTransport: box.transport, mailReceive: { tickMs: 3_600_000, intervalMs: 1000 } });
    workers.push(app.locals.mailReceiver); app.locals.mailReceiver.start(3_600_000);
    const owner = await account(app); await enable(owner); allowed = false; box.put(); await app.locals.mailReceiver.tick();
    const state = await status(owner); expect(state.enabled).toBe(false); expect(state.state).toBe('blocked'); expect(box.opens).toEqual([]);
  });
  it('recovers an expired crash lease and refuses the old process result',async()=>{
    const box=new Mailbox(),first=runtime(box),owner=await account(first.app);await enable(owner);box.put();
    let release!:()=>void;box.pending=new Promise<void>(resolve=>{release=resolve;});const oldRun=first.worker.tick();
    for(let i=0;i<100&&!box.opens.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
    box.pending=undefined;vi.setSystemTime(Date.now()+20_001);const second=runtime(box);await second.worker.tick();
    const imported=(await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(imported.state.email.messages.filter((m:any)=>m.accountId===owner.id)).toHaveLength(1);
    release();await oldRun;const after=(await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(after.revision).toBe(imported.revision);expect(after.state).toEqual(imported.state);
  });
  it('accepts a stop despite intervening worker progress and aborts a pending connection operation',async()=>{
    const box=new Mailbox(),r=runtime(box),owner=await account(r.app);const initial=await enable(owner);box.put();
    let release!:()=>void;box.pending=new Promise<void>(resolve=>{release=resolve;});const running=r.worker.tick();
    for(let i=0;i<100&&!box.opens.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
    await owner.client.put(owner.path).send({enabled:false,version:initial.version,sourceGeneration:1,requestId:randomUUID()}).expect(200);
    await running;release();expect((await status(owner)).enabled).toBe(false);
    const state=(await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace.state;
    expect(state.email.messages.filter((m:any)=>m.accountId===owner.id)).toHaveLength(0);
  });
  it('disconnects credentials and prevents a stale UI grant for a changed receive source',async()=>{
    const box=new Mailbox(),r=runtime(box),owner=await account(r.app);await enable(owner);
    await owner.client.delete(owner.base+`/accounts/${owner.id}/credential`).expect(200);await r.worker.tick();
    expect(box.opens).toEqual([]);expect((await status(owner)).enabled).toBe(false);
    let w=(await owner.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    const previous=w.state.email.accounts.find((a:any)=>a.id===owner.id),input={...previous,address:'new@example.test',transport:{...previous.transport,username:'new@example.test'}};
    const {id:_id,ownerId:_ownerId,ownerName:_ownerName,connection:_connection,credentialSet:_credentialSet,...extra}=input;
    await owner.client.post(`/api/mist/workspaces/${w.id}/commands`).send({requestId:randomUUID(),expectedRevision:w.revision,command:{type:'email.account.save',payload:{id:owner.id,input:extra}}}).expect(200);
    const current=await status(owner);await owner.client.put(owner.path).send({enabled:true,version:current.version,sourceGeneration:1,requestId:randomUUID()}).expect(409);
    await r.worker.tick();expect(box.opens).toEqual([]);
  });
  it('runs after a browser lifetime but stops on the original security generation change',async()=>{
    const box=new Mailbox(),local=createMistLocalRuntime({directory});let version='v1';const original=local.authorize;
    local.authorize=async(db,actor,permission)=>{
      if((actor as any).mailReceivingWorker&&isTokenRevoked({credentialVersion:version},(actor as any).iat,actor.credentialVersion))throw new MistApiError('SESSION_REVOKED','授权已撤销',401);
      return {...await original(db,actor,permission),credentialVersion:version};
    };
    const app=createMistServer(undefined,{local,mailResolve:publicMailHost,mailTransport:box.transport,mailReceive:{tickMs:3_600_000,intervalMs:1000}});workers.push(app.locals.mailReceiver);app.locals.mailReceiver.start(3_600_000);
    const owner=await account(app);await enable(owner);vi.setSystemTime(Date.now()+8*24*60*60_000);box.put();await app.locals.mailReceiver.tick();
    const stored=await local.database.mistWorkspace.findUnique({where:{id:owner.workspace.id}});expect(stored.state.email.messages.filter((m:any)=>m.accountId===owner.id)).toHaveLength(1);
    version='v2';vi.setSystemTime(Date.now()+1001);const count=box.connections;await app.locals.mailReceiver.tick();expect(box.connections).toBe(count);
    const fresh=await person(app),state=await status({...owner,client:fresh.client});expect(state.state).toBe('blocked');expect(state.enabled).toBe(false);
  });
});
