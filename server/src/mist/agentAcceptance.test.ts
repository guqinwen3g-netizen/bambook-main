/** Agent 全链路验收：真实 HTTP MCP 客户端 + 真实仓储 + 脚本化模型，覆盖全部工具、对象类型、命令。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createMistLocalRuntime } from './local';
import { createMistServer } from './server';
import { AGENT_DELEGATION_HEADER } from './agentDelegation';
import { AGENT_OBJECT_TYPES } from './agentRead';
import type { MistPlatformTaskWorker } from './platformTaskWorker';
import type { LlmCompletionInput } from '../ai/llmProviders';

let directory: string; const clients: Client[] = [], servers: Server[] = [];
beforeEach(async () => { directory = await fs.mkdtemp(path.join(tmpdir(), 'agent-acceptance-')); vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); });
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); await Promise.all(servers.splice(0).map(s => new Promise<void>(r => { s.close(() => r()); s.closeAllConnections(); }))); vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

async function connect(profileId: string | null, mode: 'read' | 'operate' = 'operate') {
  const local = createMistLocalRuntime({ directory }), app = createMistServer(undefined, { local }), human = request.agent(app);
  await human.get('/api/mist/session').expect(200);
  if (profileId) await human.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await human.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  const issued = (await human.post('/api/mist/agent/delegations').send({ mode, workspaceId: workspace.id, id: randomUUID() }).expect(201)).body.delegation;
  const server = app.listen(0, '127.0.0.1'); servers.push(server); await new Promise<void>(r => server.once('listening', r));
  const address = server.address() as { port: number };
  const client = new Client({ name: 'acceptance', version: '1' }, { versionNegotiation: { mode: 'legacy' } }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/api/mist/mcp`), { requestInit: { headers: { [AGENT_DELEGATION_HEADER]: issued.token } } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => { const r: any = await client.callTool({ name, arguments: args }); const text = r.content?.[0]?.text ?? ''; let data: any = text; try { data = JSON.parse(text); } catch { /* plain message */ } return { error: !!r.isError, data, text }; };
  return { app, human, workspace, client, call };
}
const OUT = process.env.AGENT_ACCEPTANCE_OUT;
const report = async (name: string, value: unknown) => { if (OUT) await fs.appendFile(OUT, `## ${name}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 1)}\n`); };

it('sweeps every tool and object type as the company owner', async () => {
  const f = await connect(null), id = f.workspace.id, tools = (await f.client.listTools()).tools.map(t => t.name);
  await report('tools', tools);
  const rows: string[] = [];
  for (const t of AGENT_OBJECT_TYPES) {
    const q = await f.call('bambook_query', { workspaceId: id, type: t.type, limit: 5 });
    const items = q.data?.results ?? [];
    if (q.error) { rows.push(`${t.type}\tQUERY-ERROR\t${q.text.slice(0, 120)}`); continue; }
    if (!items.length) { rows.push(`${t.type}\tempty`); continue; }
    const first = items[0], g = await f.call('bambook_get', { workspaceId: id, type: t.type, id: first.id }), r = await f.call('bambook_related', { workspaceId: id, type: t.type, id: first.id });
    rows.push(`${t.type}\t${items.length}\tget:${g.error ? 'ERR ' + g.text.slice(0, 100) : 'ok'}\trelated:${r.error ? 'ERR ' + r.text.slice(0, 100) : 'ok'}`);
  }
  await report('object types', rows.join('\n'));
  expect(rows.filter(r => /ERR|ERROR/.test(r))).toEqual([]);
  expect(tools).toHaveLength(11);
  for (const [n, a] of [['bambook_workspaces', {}], ['bambook_commands', {}], ['bambook_audit', { workspaceId: id }], ['bambook_mail_receiving', { workspaceId: id }]] as const) { const r = await f.call(n, a); await report(n, { error: r.error, sample: r.text.slice(0, 200) }); }
}, 120000);

it('sends every catalogued command through preview and sees a clean answer', async () => {
  const f = await connect(null), id = f.workspace.id, commands = (await f.call('bambook_commands')).data.commands as Array<{ type: string; via: string }>;
  const tally: Record<string, number> = {}, bad: string[] = [], accepted: string[] = [], generic: string[] = [], normal: string[] = [], hist: Record<string, number> = {};
  for (const c of commands) {
    tally['via:' + c.via] = (tally['via:' + c.via] ?? 0) + 1;
    const r = await f.call('bambook_preview', { workspaceId: id, command: { type: c.type, payload: {} } }).catch(e => ({ error: true, text: 'THROW ' + e.message, data: null }));
    const t = r.text;
    if (t.startsWith('THROW') || /internal|INTERNAL|TypeError|Cannot read|undefined is not|服务器错误|内部错误/i.test(t)) bad.push(`${c.type}\t${t.slice(0, 140)}`);
    tally[r.error ? 'rejected' : 'accepted'] = (tally[r.error ? 'rejected' : 'accepted'] ?? 0) + 1;
    if (t.startsWith('操作未完成')) generic.push(c.type);
    if (!r.error) accepted.push(c.type + ' ' + t.slice(0, 80)); const key = t.replace(/[0-9a-f-]{8,}/g, '#').slice(0, 26); hist[key] = (hist[key] ?? 0) + 1; if (c.via === 'normal') normal.push(c.type);
  }
  expect(bad).toEqual([]); expect(generic).toEqual([]); await report('commands', { count: commands.length, tally }); await report('commands unclean', bad.join('\n') || 'none'); await report('generic', generic); await report('accepted', accepted); await report('normal', normal); await report('hist', Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => v + ' ' + k).join('\n'));
}, 300000);

it('scopes each demo profile', async () => {
  const profiles = ['demo-buyer', 'demo-sales', 'demo-finance', 'demo-reviewer'], rows: string[] = [];
  for (const p of profiles) {
    try { const f = await connect(p, 'read'), id = f.workspace.id; const seen: string[] = [], denied: string[] = []; for (const t of AGENT_OBJECT_TYPES) { const q = await f.call('bambook_query', { workspaceId: id, type: t.type, limit: 20 }); if (!q.error) seen.push(t.type + ':' + (q.data?.results ?? []).length); else denied.push(t.type); } rows.push(p + ' denied ' + denied.join(',') + ' | ' + seen.filter(x => /^(order|customer|invoice|email|purchase|receipt_record):/.test(x)).join(' ')); const w = await f.call('bambook_preview', { workspaceId: id, command: { type: 'x', payload: {} } }); rows.push(`${p}\treadable ${seen.length}\tread-mode preview: ${w.text.slice(0, 60)}`); }
    catch (e: any) { rows.push(`${p}\tERR ${e.message.slice(0, 120)}`); }
  }
  await report('profiles', rows.join('\n')); expect(rows.filter(r => r.includes('ERR'))).toEqual([]);
  const sales = rows.find(r => r.startsWith('demo-sales denied'))!; expect(sales).toContain('bank_account');
}, 120000);

const workers: MistPlatformTaskWorker[] = [];
afterEach(async () => { await Promise.all(workers.splice(0).map(w => w.stop())); });
const tool = (name: string, args: Record<string, unknown>) => JSON.stringify({ name, arguments: args });
const finish = (result: string) => tool('bambook_task', { action: 'finish', outcome: 'succeeded', result });
/** 小竹 cowork 的同一条链路：personal-agent/tasks → 平台任务执行器 → MCP 工具 → 回到任务记录。 */
async function cowork(script: (input: LlmCompletionInput, turn: number) => string | Promise<string>) {
  let turn = 0; const prompts: string[] = [];
  const complete = async (input: LlmCompletionInput) => { prompts.push(JSON.stringify(input)); return script(input, ++turn); };
  const local = createMistLocalRuntime({ directory }), app = createMistServer(undefined, { local, agentTasks: { complete, tickMs: 3_600_000, pulseMs: 20 } }), human = request.agent(app);
  await human.get('/api/mist/session').expect(200);
  const workspace = (await human.get('/api/mist/workspaces/default').expect(200)).body.workspace, base = '/api/mist/workspaces/' + workspace.id;
  const worker = app.locals.platformTaskWorker as MistPlatformTaskWorker; workers.push(worker); worker.start(3_600_000);
  const drain = async () => { for (let i = 0; i < 8; i++) { await worker.tick(); await worker.settled(); } };
  const ask = async (instructions: string) => (await human.post(base + '/personal-agent/tasks').send({ requestId: randomUUID(), name: instructions.slice(0, 60), instructions, locale: 'zh-CN' }).expect(201)).body.item;
  const read = async (id: string) => (await human.get(base + '/agent-tasks/' + id).expect(200)).body.item;
  const state = async () => (await human.get(base).expect(200)).body.workspace;
  const command = async (type: string, payload: unknown) => { const w = await state(); return human.post(base + '/commands').send({ requestId: randomUUID(), expectedRevision: w.revision, command: { type, payload } }); };
  return { human, workspace, base, drain, ask, read, state, command, prompts };
}

it('answers a question from business data in the conversation', async () => {
  let order = ''; const c = await cowork((_i, n) => n === 1 ? tool('bambook_query', { type: 'order', limit: 3 }) : n === 2 ? tool('bambook_get', { type: 'order', id: order }) : finish('有 1 张订单需要跟进'));
  order = c.workspace.state.orders[0].id;
  const t = await c.ask('哪些订单要跟进？'); expect(t.executor).toBe('platform'); await c.drain();
  const done = await c.read(t.id); expect(done).toMatchObject({ state: 'succeeded', result: '有 1 张订单需要跟进' });
  const mine = (await c.human.get(c.base + '/agent-identities?scope=mine').expect(200)).body.items.find((i: any) => i.kind === 'personal');
  const listed = (await c.human.get(c.base + '/agent-tasks').expect(200)).body.items; expect(listed.find((x: any) => x.id === t.id)).toMatchObject({ executor: 'platform', identityId: mine.id });
  expect((await c.human.get(c.base + '/agent-task-capabilities').expect(200)).body.platformAvailable).toBe(true);
});

it('asks the person when facts are missing and continues with the answer', async () => {
  let customer = ''; const c = await cowork((input, n) => n === 1 ? tool('bambook_task', { action: 'question', question: '核对哪个客户？' }) : n === 2 ? tool('bambook_get', { type: 'customer', id: customer }) : JSON.stringify(input).includes('客户A') ? finish('已按客户A核对') : finish('没有收到答复'));
  customer = c.workspace.state.customers[0].id; const t = await c.ask('核对客户对账'); await c.drain();
  const waiting = await c.read(t.id); expect(waiting.state).toBe('waiting_human'); expect(waiting.questions[0].question).toBe('核对哪个客户？');
  await c.human.post(c.base + '/agent-tasks/' + t.id + '/answer').send({ requestId: randomUUID(), version: waiting.version, questionId: waiting.questions[0].id, answer: '客户A' }).expect(200);
  await c.drain(); expect(await c.read(t.id)).toMatchObject({ state: 'succeeded', result: '已按客户A核对' });
});

it('writes a low-risk record directly and leaves an audit trail', async () => {
  let customer = ''; const c = await cowork((_i, n) => n === 1 ? tool('bambook_get', { type: 'customer', id: customer }) : n === 2 ? tool('bambook_execute', { command: { type: 'crm.followUp.save', payload: { customerId: customer, method: 'call', content: '验收跟进', at: new Date(Date.now() - 60000).toISOString(), nextDate: '', link: null } } }) : finish('已记录跟进'));
  customer = c.workspace.state.customers[0].id;
  const t = await c.ask('给客户记一条跟进'); await c.drain();
  expect(await c.read(t.id)).toMatchObject({ state: 'succeeded' });
  expect(JSON.stringify((await c.state()).state.crm)).toContain('验收跟进');
});

it('stops a change for confirmation, runs it only after the person confirms, then finishes', async () => {
  const clone = (w: any, name: string) => { const { id: _id, code: _code, owner: _owner, ...rest } = w.state.customers[0]; return { ...rest, name, ownerId: 'local-operator' }; };
  let customer = '', input: any; const c = await cowork((p, n) => n === 1 ? tool('bambook_get', { type: 'customer', id: customer }) : n === 2 ? tool('bambook_execute', { command: { type: 'market.customer.create', payload: { input } } }) : n === 3 ? tool('bambook_get', { type: 'customer', id: customer }) : finish('客户已建好'));
  customer = c.workspace.state.customers[0].id; input = clone(c.workspace, '验收新客户');
  const t = await c.ask('新建一个客户'); await c.drain();
  const waiting = await c.read(t.id); await report('confirm task', { state: waiting.state, proposals: waiting.waitingProposalIds, checkpoint: waiting.checkpoint, issue: waiting.executionIssue, result: waiting.result });
  expect(waiting.state).toBe('waiting_human'); expect(waiting.waitingProposalIds).toHaveLength(1);
  expect(JSON.stringify((await c.state()).state.customers)).not.toContain('验收新客户');
  const confirmed = await c.command('agent.proposal.confirm', { id: waiting.waitingProposalIds[0] }); await report('confirm response', { status: confirmed.status, body: JSON.stringify(confirmed.body).slice(0, 300) }); expect(confirmed.status).toBe(200);
  expect(JSON.stringify((await c.state()).state.customers)).toContain('验收新客户');
  await c.drain(); expect(await c.read(t.id)).toMatchObject({ state: 'succeeded', result: '客户已建好' });
});

it('continues after the person rejects a change, without applying it', async () => {
  let customer = '', input: any; const c = await cowork((p, n) => n === 1 ? tool('bambook_get', { type: 'customer', id: customer }) : n === 2 ? tool('bambook_execute', { command: { type: 'market.customer.create', payload: { input } } }) : n === 3 ? tool('bambook_get', { type: 'customer', id: customer }) : finish('已放弃'));
  customer = c.workspace.state.customers[0].id; { const { id: _i, code: _c, owner: _o, ...rest } = c.workspace.state.customers[0]; input = { ...rest, name: '不要建', ownerId: 'local-operator' }; }
  const t = await c.ask('新建客户'); await c.drain(); const w = await c.read(t.id); expect(w.waitingProposalIds).toHaveLength(1);
  expect((await c.command('agent.proposal.reject', { id: w.waitingProposalIds[0], note: '不需要' })).status).toBe(200);
  await c.drain(); expect((await c.read(t.id)).state).toBe('succeeded'); expect(JSON.stringify((await c.state()).state.customers)).not.toContain('不要建');
});

it('stops when the person stops it, and reports an unusable model instead of hanging', async () => {
  const c = await cowork(() => 'not json at all');
  const t = await c.ask('随便做点事'); await c.drain(); const r = await c.read(t.id); await report('bad model', { state: r.state, issue: r.executionIssue });
  expect(r.executionIssue?.code).toBe('model_response_invalid');
  await c.human.post(c.base + '/agent-tasks/' + t.id + '/cancel').send({ requestId: randomUUID(), version: r.version }).expect(200);
  expect((await c.read(t.id)).state).toBe('cancelled');
});

it('tells the model a partial list does not count as a re-read after the person answers', async () => {
  let seen = ''; const c = await cowork((input, n) => { if (n === 3) seen = JSON.stringify(input); return n === 1 ? tool('bambook_task', { action: 'question', question: '看哪个？' }) : n === 2 ? tool('bambook_query', { type: 'order', limit: 1 }) : tool('bambook_task', { action: 'finish', outcome: 'failed', result: '结束' }); });
  const t = await c.ask('核对'); await c.drain(); const w = await c.read(t.id);
  await c.human.post(c.base + '/agent-tasks/' + t.id + '/answer').send({ requestId: randomUUID(), version: w.version, questionId: w.questions[0].id, answer: '都看' }).expect(200);
  await c.drain(); expect(seen).toContain('不算回源读取');
});

it('connects the way the account page does and keeps companies apart', async () => {
  const f = await connect('demo-sales', 'read'), base = '/api/mist/workspaces/' + f.workspace.id;
  const created = await f.human.post(base + '/agent-connections').send({ id: randomUUID(), name: 'Claude Code', mode: 'operate' }).expect(201);
  const token = created.body.delegation?.token ?? created.body.token; expect(typeof token).toBe('string');
  const server = f.app.listen(0, '127.0.0.1'); servers.push(server); await new Promise<void>(r => server.once('listening', r));
  const client = new Client({ name: 'claude-code-like', version: '1' }, { versionNegotiation: { mode: 'legacy' } }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as any).port}/api/mist/mcp`), { requestInit: { headers: { [AGENT_DELEGATION_HEADER]: token } } }));
  const call = async (name: string, args: Record<string, unknown>) => { const r: any = await client.callTool({ name, arguments: args }); return { error: !!r.isError, data: r.structuredContent, text: r.content?.[0]?.text ?? '' }; };
  const id = f.workspace.id, mine = await call('bambook_query', { workspaceId: id, type: 'order', limit: 20 }); expect(mine.error).toBe(false);
  const owner = await connect('demo-admin', 'read'), all = await owner.call('bambook_query', { workspaceId: id, type: 'order', limit: 20 });
  await report('row scope', { sales: mine.data.total, admin: all.data?.total, stateOrders: owner.workspace.state.orders.length });
  // 本机演示公司没有行级范围（只有公司账号的工作区才有），这里只核对与本人页面一致；行级裁剪见 dataScopeMatrix.test.ts。
  expect(mine.data.total).toBe(((await f.human.get(base).expect(200)).body.workspace.state.orders).length);
  const customer = (await call('bambook_query', { workspaceId: id, type: 'customer', limit: 1 })).data.results[0].id;
  const payload = { customerId: customer, method: 'call', content: '外部客户端跟进', at: new Date(Date.now() - 60000).toISOString(), nextDate: '', link: null };
  expect((await call('bambook_preview', { workspaceId: id, command: { type: 'crm.followUp.save', payload } })).error).toBe(false);
  const done = await call('bambook_execute', { workspaceId: id, requestId: randomUUID(), command: { type: 'crm.followUp.save', payload } }); await report('execute', done.text.slice(0, 160)); expect(done.error).toBe(false);
  const other = await connect(null, 'read'); expect(other.workspace.id).not.toBe(id);
  const crossing = await call('bambook_query', { workspaceId: other.workspace.id, type: 'order', limit: 1 }).catch(e => ({ error: true, text: String(e.message), data: null })); await report('cross company', crossing.text.slice(0, 120)); expect(crossing.error).toBe(true);
}, 60000);
