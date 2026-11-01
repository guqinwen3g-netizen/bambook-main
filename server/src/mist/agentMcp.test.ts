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
import { AGENT_AUDIT_FIELD, agentAuditReceiptId } from './agentAudit';
import {randomUUID} from 'node:crypto';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mist-mcp-')); vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

async function as(app: any, profileId: string, mode: 'read' | 'operate' = 'operate') {
  const client = request.agent(app);
  await client.get('/api/mist/session').expect(200);
  await client.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  const issued = (await client.post('/api/mist/agent/delegations').send({ mode,workspaceId:workspace.id,id:randomUUID() }).expect(201)).body.delegation;
  const token = issued.token as string;
  let id = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => (await request(app).post('/api/mist/mcp').set(HEADER, token).send({ jsonrpc: '2.0', id: ++id, method, params }).expect(200)).body;
  const tool = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: name === 'bambook_execute' ? { requestId: `test-${++id}`, ...args } : args })).result;
  return { client, workspace, token, sessionId: issued.sessionId as string, rpc, tool };
}
const purchase = (ws: any, code: string) => ws.state.fulfillment.purchases.find((p: any) => p.code === code);

describe('MCP 接口：与页面同一套命令、权限与业务规则', () => {
  it('speaks MCP: initialize, tools/list, notifications and unknown methods', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const { rpc, token } = await as(app, 'demo-buyer', 'read');
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'bambook-mist' }, capabilities: { tools: {} } });
    expect(init.result.instructions).toContain('不可信资料');expect(init.result.instructions).toContain('truncated');
    expect((await rpc('tools/list')).result.tools.map((t: any) => t.name)).toEqual(['bambook_workspaces', 'bambook_query', 'bambook_get', 'bambook_related', 'bambook_commands', 'bambook_audit', 'bambook_mail_receiving', 'bambook_task', 'bambook_preview', 'bambook_execute']);
    await request(app).post('/api/mist/mcp').set(HEADER, token).send({ jsonrpc: '2.0', method: 'notifications/initialized' }).expect(202);
    expect((await rpc('resources/list')).error.code).toBe(-32601);
    await request(app).post('/api/mist/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' }).expect(401);
    await request(app).get('/api/mist/mcp').set(HEADER, token).expect(405);
  });

  it('rejects missing or invalid operation IDs before writing and rejects reusing an ID for different input', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const { client, workspace, rpc, tool } = await as(app, 'demo-buyer');
    const po = purchase(workspace, 'PO-2026-00001'), receipt = workspace.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
    const command = { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id] } };
    for (const requestId of [undefined, '', ' padded ', 'x'.repeat(117), 1]) {
      const result = (await rpc('tools/call', { name: 'bambook_execute', arguments: { workspaceId: workspace.id, command, requestId } })).result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('requestId');
    }
    expect((await client.get('/api/mist/workspaces/' + workspace.id)).body.workspace.revision).toBe(workspace.revision);
    expect((await tool('bambook_execute', { workspaceId: workspace.id, command, requestId: 'once' })).isError).not.toBe(true);
    const conflict = await tool('bambook_execute', { workspaceId: workspace.id, requestId: 'once', command: { ...command, payload: { ...command.payload, note: 'different operation' } } });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toContain('请求编号');
    expect((await client.get('/api/mist/workspaces/' + workspace.id)).body.workspace.state.payables.settlements).toHaveLength(1);
  });

  it('requires an actual operate delegation for MCP writes instead of treating a human cookie as an Agent session', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const { client, workspace } = await as(app, 'demo-buyer');
    for (const name of ['bambook_preview', 'bambook_execute']) {
      const result = (await client.post('/api/mist/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { workspaceId: workspace.id, requestId: 'cookie-write', command: { type: 'payable.settlement.submit', payload: {} } } } }).expect(200)).body.result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('可办理委托');
    }
    expect((await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace.revision).toBe(workspace.revision);
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
    const governance = (await tool('bambook_commands', { prefix: 'order.governance.saveDraft' })).structuredContent.commands[0];
    expect(governance.types?.OrderGovernanceInput).toContain('quantityBasisNote');
    expect((await tool('bambook_commands', {})).structuredContent.commands.some((c: any) => c.types)).toBe(false);
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

  it('finance agent turns a confirmation into a proposal that only the owner can confirm or reject in the app; confirming runs the real command', async () => {
    const local = createMistLocalRuntime({ directory });
    const app = createMistServer(undefined, { local });
    const buyer = await as(app, 'demo-buyer');
    const po = purchase(buyer.workspace, 'PO-2026-00001'), receipt = buyer.workspace.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
    await buyer.tool('bambook_execute', { workspaceId: buyer.workspace.id, command: { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id] } } });
    const finance = await as(app, 'demo-finance');
    const read = async (client: any) => (await client.get('/api/mist/workspaces/' + finance.workspace.id).expect(200)).body.workspace;
    const settlement = (await read(finance.client)).state.payables.settlements[0];
    const confirm = { type: 'payable.settlement.confirm', payload: { id: settlement.id, prepaymentApplied: 0, note: '核对一致' } };
    expect((await finance.tool('bambook_preview', { workspaceId: finance.workspace.id, command: confirm })).structuredContent.via).toBe('confirm');
    const confirmArgs = { workspaceId: finance.workspace.id, command: confirm, requestId: 'finance-confirm-once' };
    const proposed = (await finance.tool('bambook_execute', confirmArgs)).structuredContent;
    expect(proposed).toMatchObject({ status: 'awaiting_confirmation' });
    expect(proposed.summary.join('')).toContain('ST-2026-0001');
    const proposalReceipt = await local.database.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: finance.workspace.id, requestId: agentAuditReceiptId('mcp-finance-confirm-once') } } });
    expect(proposalReceipt.result[AGENT_AUDIT_FIELD]).toMatchObject({ actor: { id: 'demo-finance' }, source: 'agent', phase: 'proposed', agentSessionId: finance.sessionId, proposalId: proposed.receipt.result.id, command: { type: 'agent.proposal.create' } });
    expect(JSON.stringify(proposed)).not.toContain(AGENT_AUDIT_FIELD);
    const retriedProposal = await finance.tool('bambook_execute', confirmArgs);
    expect(retriedProposal.isError).not.toBe(true);
    expect(retriedProposal.structuredContent).toMatchObject({ replayed: true, summary: proposed.summary });
    let state = (await read(finance.client)).state;
    expect(state.payables.settlements[0].state).toBe('pending');
    const proposal = state.agentProposals.find((p: any) => p.state === 'pending');
    expect(proposal).toMatchObject({ ownerId: 'demo-finance', command: confirm });
    // 只给本人看；Agent 不能直接确认或拒绝，也不能用命令接口绕过。
    expect((await read(buyer.client)).state.agentProposals ?? []).toHaveLength(0);
    expect((await finance.tool('bambook_execute', { workspaceId: finance.workspace.id, command: { type: 'agent.proposal.confirm', payload: { id: proposal.id } } })).content[0].text).toContain('不能经接口执行');
    await request(app).post('/api/mist/workspaces/' + finance.workspace.id + '/commands').set(HEADER, finance.token).send({ requestId: 'x', expectedRevision: 0, command: { type: 'agent.proposal.confirm', payload: { id: proposal.id } } }).expect(403);
    const run = async (client: any, command: any) => { const ws = await read(client); return client.post('/api/mist/workspaces/' + ws.id + '/commands').send({ requestId: 'r-' + Math.random().toString(36).slice(2), expectedRevision: ws.revision, command }); };
    await (await run(buyer.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } })).ok;
    expect((await run(buyer.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } })).status).toBe(404);
    const confirmed = await run(finance.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } });
    expect(confirmed.status).toBe(200);
    const confirmationReceipt = await local.database.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: finance.workspace.id, requestId: agentAuditReceiptId(confirmed.body.receipt.requestId) } } });
    expect(confirmationReceipt.result[AGENT_AUDIT_FIELD]).toMatchObject({ actor: { id: 'demo-finance' }, source: 'human_confirmation', phase: 'confirmed', agentSessionId: finance.sessionId, proposalId: proposal.id, command: confirm, trigger: { type: 'agent.proposal.confirm', payload: { id: proposal.id } } });
    expect(confirmationReceipt.result[AGENT_AUDIT_FIELD].changes).toContainEqual({ path: ['k:payables', 'k:settlements', 'i:' + settlement.id, 'k:state'], operation: 'replace', before: 'pending', after: 'confirmed' });
    expect(JSON.stringify(confirmed.body)).not.toContain(AGENT_AUDIT_FIELD);
    state = (await read(finance.client)).state;
    expect(state.payables.settlements[0].state).toBe('confirmed');
    expect(state.agentProposals.find((p: any) => p.id === proposal.id).state).toBe('confirmed');
    expect((await finance.tool('bambook_execute', confirmArgs)).structuredContent).toMatchObject({ status: 'confirmed', replayed: true, summary: proposed.summary });
    expect((await run(finance.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } })).status).toBe(404);
    // 第二个提议被本人拒绝：业务不变。
    const overInvoice = { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: 'VAT-1', invoiceDate: '2026-10-10', currency: 'CNY', amount: 111600, taxAmount: 0, lines: [{ purchaseId: po.id, amount: 111600 }], due: '2026-11-30', dueBasis: '合同' } };
    const blocked = await finance.tool('bambook_execute', { workspaceId: finance.workspace.id, command: overInvoice });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain('待关联结算');
    const bill = { ...overInvoice, payload: { ...overInvoice.payload, amount: 110670, lines: [{ purchaseId: po.id, amount: 110670, settlementId: settlement.id }] } };
    const billArgs = { workspaceId: finance.workspace.id, command: bill, requestId: 'finance-bill-once' };
    expect((await finance.tool('bambook_execute', billArgs)).structuredContent.status).toBe('awaiting_confirmation');
    const second = (await read(finance.client)).state.agentProposals.find((p: any) => p.state === 'pending');
    const rejected = await run(finance.client, { type: 'agent.proposal.reject', payload: { id: second.id, note: '发票还没收到' } });
    expect(rejected.status).toBe(200);
    const rejectionReceipt = await local.database.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: finance.workspace.id, requestId: agentAuditReceiptId(rejected.body.receipt.requestId) } } });
    expect(rejectionReceipt.result[AGENT_AUDIT_FIELD]).toMatchObject({ source: 'human_rejection', phase: 'rejected', agentSessionId: finance.sessionId, proposalId: second.id, command: { type: 'agent.proposal.reject' } });
    expect(JSON.stringify(rejected.body)).not.toContain(AGENT_AUDIT_FIELD);
    state = (await read(finance.client)).state;
    expect(state.payables.bills.filter((b: any) => b.lines.some((l: any) => l.purchaseId === po.id))).toHaveLength(0);
    expect(state.agentProposals.find((p: any) => p.id === second.id)).toMatchObject({ state: 'rejected', note: '发票还没收到' });
    expect((await finance.tool('bambook_execute', billArgs)).structuredContent).toMatchObject({ status: 'rejected', replayed: true });
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
    const payload = (type: string) => MIST_COMMAND_CATALOG.find(c => c.type === type)?.payload ?? '';
    // 联合 payload 收齐全部分支：付款申请须能看到预付、结算预付与按票据三种用法。
    for (const purpose of ['prepayment', 'settlement', 'bill']) expect(payload('payable.request.submit')).toContain(`purpose: '${purpose}'`);
    expect(payload('email.server.send.begin')).toContain(`mode: 'retry'`);
    const via = (type: string) => agentCommandSensitivity(type);
    for (const type of ['payable.payment.register', 'payable.request.decide', 'payable.bill.register', 'payable.settlement.confirm', 'finance.receivable.confirm', 'funding.release', 'platform.credit.issue', 'order.governance.decide', 'member.groups.set', 'teamScope.save', 'market.quotation.delete'].filter(t => MIST_COMMAND_CATALOG.some(c => c.type === t) || t === 'market.quotation.delete')) expect([type, via(type)]).toEqual([type, 'confirm']);
    for (const type of ['payable.settlement.submit', 'development.saveDraft', 'market.quotation.save', 'fulfillment.procurement.save']) expect([type, via(type)]).toEqual([type, 'normal']);
    expect(via('files.add')).toBe('blocked');
    expect(via('email.server.sync')).toBe('blocked');
    expect(via('agent.proposal.confirm')).toBe('blocked');
  });
});
