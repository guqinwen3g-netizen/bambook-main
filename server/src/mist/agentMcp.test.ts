import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createMistLocalRuntime } from './local';
import { createMistServer } from './server';
import { AGENT_DELEGATION_HEADER as HEADER } from './agentDelegation';
import { agentCommandSensitivity } from './agentMcp';
import { MIST_COMMAND_CATALOG } from './agentCommandCatalog';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mist-mcp-')); vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

async function as(app: any, profileId: string, mode: 'read' | 'operate' = 'operate') {
  const client = request.agent(app);
  await client.get('/api/mist/session').expect(200);
  await client.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  const token = (await client.post('/api/mist/agent/delegations').send({ mode }).expect(201)).body.delegation.token as string;
  let id = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => (await request(app).post('/api/mist/mcp').set(HEADER, token).send({ jsonrpc: '2.0', id: ++id, method, params }).expect(200)).body;
  const tool = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  return { client, workspace, token, rpc, tool };
}
const purchase = (ws: any, code: string) => ws.state.fulfillment.purchases.find((p: any) => p.code === code);

describe('MCP 接口：与页面同一套命令、权限与业务规则', () => {
  it('speaks MCP: initialize, tools/list, notifications and unknown methods', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const { rpc, token } = await as(app, 'demo-buyer', 'read');
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'bambook-mist' }, capabilities: { tools: {} } });
    expect((await rpc('tools/list')).result.tools.map((t: any) => t.name)).toEqual(['bambook_workspaces', 'bambook_query', 'bambook_get', 'bambook_related', 'bambook_commands', 'bambook_preview', 'bambook_execute']);
    await request(app).post('/api/mist/mcp').set(HEADER, token).send({ jsonrpc: '2.0', method: 'notifications/initialized' }).expect(202);
    expect((await rpc('resources/list')).error.code).toBe(-32601);
    await request(app).post('/api/mist/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' }).expect(401);
    await request(app).get('/api/mist/mcp').set(HEADER, token).expect(403);
  });

  it('buyer agent previews then submits a settlement on actual receipts; the write is audited as via Agent and replays idempotently', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const { client, workspace, tool } = await as(app, 'demo-buyer');
    const po = purchase(workspace, 'PO-2026-00001'), receipt = workspace.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
    const found = (await tool('bambook_query', { workspaceId: workspace.id, type: 'purchase', q: 'PO-2026-00001' })).structuredContent;
    expect(JSON.stringify(found.results)).toContain('PO-2026-00001');
    const commands = (await tool('bambook_commands', { prefix: 'payable.settlement.' })).structuredContent.commands;
    expect(commands.find((c: any) => c.type === 'payable.settlement.submit')).toMatchObject({ via: 'normal' });
    expect(commands.find((c: any) => c.type === 'payable.settlement.confirm')).toMatchObject({ via: 'confirm' });
    const command = { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id], note: '首批实收结算' } };
    const preview = (await tool('bambook_preview', { workspaceId: workspace.id, command })).structuredContent;
    expect(preview.events.join('')).toContain('实收 2380 米 · 110,670.00 CNY');
    const untouched = (await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace;
    expect(untouched.revision).toBe(workspace.revision);
    expect(untouched.state.payables.settlements).toHaveLength(0);
    const first = await tool('bambook_execute', { workspaceId: workspace.id, command, requestId: 'settle-po1' });
    expect(first.isError).toBeUndefined();
    const again = await tool('bambook_execute', { workspaceId: workspace.id, command, requestId: 'settle-po1' });
    expect(again.structuredContent).toMatchObject({ replayed: true });
    const after = (await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace;
    expect(after.state.payables.settlements).toHaveLength(1);
    expect(after.state.payables.settlements[0]).toMatchObject({ state: 'pending', quantity: 2380, amount: 110670 });
    expect(after.state.events.find((e: any) => e.entityId === after.state.payables.settlements[0].id).actor).toBe('沈禾（经 Agent）');
  });

  it('finance agent may preview a confirmation but cannot execute confirm / money commands; business errors come back as tool errors', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const buyer = await as(app, 'demo-buyer');
    const po = purchase(buyer.workspace, 'PO-2026-00001'), receipt = buyer.workspace.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
    await buyer.tool('bambook_execute', { workspaceId: buyer.workspace.id, command: { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id] } } });
    const finance = await as(app, 'demo-finance');
    const settlement = (await finance.client.get('/api/mist/workspaces/' + finance.workspace.id).expect(200)).body.workspace.state.payables.settlements[0];
    const confirm = { type: 'payable.settlement.confirm', payload: { id: settlement.id, prepaymentApplied: 0, note: '核对一致' } };
    const preview = (await finance.tool('bambook_preview', { workspaceId: finance.workspace.id, command: confirm })).structuredContent;
    expect(preview.via).toBe('confirm');
    const refused = await finance.tool('bambook_execute', { workspaceId: finance.workspace.id, command: confirm });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('须本人在系统中确认');
    expect((await finance.client.get('/api/mist/workspaces/' + finance.workspace.id).expect(200)).body.workspace.state.payables.settlements[0].state).toBe('pending');
    const overInvoice = { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: 'VAT-1', invoiceDate: '2026-10-10', currency: 'CNY', amount: 111600, taxAmount: 0, lines: [{ purchaseId: po.id, amount: 111600 }], due: '2026-11-30', dueBasis: '合同' } };
    const blocked = await finance.tool('bambook_preview', { workspaceId: finance.workspace.id, command: overInvoice });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain('待关联结算');
  });

  it('read-only delegation and non-finance roles stay within their limits', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const reader = await as(app, 'demo-buyer', 'read');
    const po = purchase(reader.workspace, 'PO-2026-00001');
    const denied = await reader.tool('bambook_preview', { workspaceId: reader.workspace.id, command: { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: ['x'] } } });
    expect(denied.content[0].text).toContain('只读委托');
    const qc = await as(app, 'demo-qc');
    const noScope = await qc.tool('bambook_preview', { workspaceId: qc.workspace.id, command: { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: ['x'] } } });
    expect(noScope.isError).toBe(true);
    const unknown = await qc.tool('bambook_execute', { workspaceId: qc.workspace.id, command: { type: 'payable.anything', payload: {} } });
    expect(unknown.content[0].text).toContain('未知命令');
    expect((await qc.tool('bambook_execute', { workspaceId: qc.workspace.id, command: { type: 'files.add', payload: {} } })).content[0].text).toContain('不能经接口执行');
  });
});

describe('命令目录与敏感分级', () => {
  it('is generated from the current source and classifies money, approval, deletion and outbound commands as confirm', () => {
    expect(() => execFileSync('node', [path.resolve(__dirname, '../../../scripts/gen-mist-command-catalog.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
    const via = (type: string) => agentCommandSensitivity(type);
    for (const type of ['payable.payment.register', 'payable.request.decide', 'payable.bill.register', 'payable.settlement.confirm', 'finance.receivable.confirm', 'funding.release', 'platform.credit.issue', 'order.governance.decide', 'member.groups.set', 'teamScope.save', 'market.quotation.delete'].filter(t => MIST_COMMAND_CATALOG.some(c => c.type === t) || t === 'market.quotation.delete')) expect([type, via(type)]).toEqual([type, 'confirm']);
    for (const type of ['payable.settlement.submit', 'development.saveDraft', 'market.quotation.save', 'fulfillment.procurement.save']) expect([type, via(type)]).toEqual([type, 'normal']);
    expect(via('files.add')).toBe('blocked');
    expect(via('email.server.sync')).toBe('blocked');
  });
});
