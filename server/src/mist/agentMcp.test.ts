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
import { agentCommandRisk } from '../shared/mistAgentProposals';
import { MistApiError } from './errors';
import { MIST_COMMAND_CATALOG } from './agentCommandCatalog';
import { AGENT_AUDIT_FIELD, agentAuditReceiptId } from './agentAudit';
import {randomUUID} from 'node:crypto';
import { TEST_SIGNATURE } from './__tests__/signature';

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
    // 只有低风险命令可直接执行；用日程验证请求编号校验与同号异参冲突。
    const command = { type: 'calendar.save', payload: { title: '收货复核', date: '2026-11-02', time: '09:00', note: '' } };
    const calendarCount = workspace.state.calendar.length;
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
    expect((await client.get('/api/mist/workspaces/' + workspace.id)).body.workspace.state.calendar).toHaveLength(calendarCount + 1);
    // 低风险且产生业务事件的命令直接执行：经办人标注“经 Agent”。
    const customer = workspace.state.customers[0];
    const followUp = await tool('bambook_execute', { workspaceId: workspace.id, requestId: 'follow-up-direct', command: { type: 'crm.followUp.save', payload: { customerId: customer.id, method: 'call', content: '电话确认交期', at: new Date(Date.now() - 3600000).toISOString(), nextDate: '', link: null } } });
    expect(followUp.isError).not.toBe(true); expect(followUp.structuredContent.status).toBeUndefined();
    const after = (await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace;
    const id = followUp.structuredContent.receipt.result.id;
    expect(after.state.crm.followUps.find((f: any) => f.id === id)).toMatchObject({ actor: '沈禾（经 Agent）' });
    expect(after.state.events.find((e: any) => e.entityId === customer.id && e.businessRef?.id === id).actor).toBe('沈禾（经 Agent）');
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

  it('buyer agent previews a medium-risk settlement submission; it becomes a proposal the buyer confirms in the app, audited as via Agent and replayed idempotently', async () => {
    const local = createMistLocalRuntime({ directory });
    const app = createMistServer(undefined, { local });
    const { client, workspace, tool, sessionId } = await as(app, 'demo-buyer');
    const po = purchase(workspace, 'PO-2026-00001'), receipt = workspace.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
    const found = (await tool('bambook_query', { workspaceId: workspace.id, type: 'purchase', q: 'PO-2026-00001' })).structuredContent;
    expect(JSON.stringify(found.results)).toContain('PO-2026-00001');
    const commands = (await tool('bambook_commands', { prefix: 'payable.settlement.' })).structuredContent.commands;
    // 提交结算属中风险：委托只能建提议，本人确认后执行。
    expect(commands.find((c: any) => c.type === 'payable.settlement.submit')).toMatchObject({ via: 'confirm' });
    expect(commands.find((c: any) => c.type === 'payable.settlement.confirm')).toMatchObject({ via: 'confirm' });
    const governance = (await tool('bambook_commands', { prefix: 'order.governance.saveDraft' })).structuredContent.commands[0];
    expect(governance.types?.OrderGovernanceInput).toContain('quantityBasisNote');
    expect((await tool('bambook_commands', {})).structuredContent.commands.some((c: any) => c.types)).toBe(false);
    const command = { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id], note: '首批实收结算' } };
    const preview = (await tool('bambook_preview', { workspaceId: workspace.id, command })).structuredContent;
    expect(preview.via).toBe('confirm');
    expect(preview.events.join('')).toContain('实收 2380 米 · 110,670.00 CNY');
    const untouched = (await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace;
    expect(untouched.revision).toBe(workspace.revision);
    expect(untouched.state.payables.settlements).toHaveLength(0);
    const first = await tool('bambook_execute', { workspaceId: workspace.id, command, requestId: 'settle-po1' });
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent).toMatchObject({ status: 'awaiting_confirmation' });
    const again = await tool('bambook_execute', { workspaceId: workspace.id, command, requestId: 'settle-po1' });
    expect(again.structuredContent).toMatchObject({ replayed: true, status: 'awaiting_confirmation' });
    let state = (await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace;
    expect(state.state.payables.settlements).toHaveLength(0);
    const proposals = state.state.agentProposals.filter((p: any) => p.state === 'pending');
    expect(proposals).toHaveLength(1); expect(proposals[0]).toMatchObject({ ownerId: 'demo-buyer', command });
    const proposalReceipt = await local.database.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: workspace.id, requestId: agentAuditReceiptId('mcp-settle-po1') } } });
    expect(proposalReceipt.result[AGENT_AUDIT_FIELD]).toMatchObject({ actor: { id: 'demo-buyer' }, source: 'agent', phase: 'proposed', agentSessionId: sessionId });
    const confirmed = await client.post('/api/mist/workspaces/' + workspace.id + '/commands').send({ requestId: randomUUID(), expectedRevision: state.revision, command: { type: 'agent.proposal.confirm', payload: { id: proposals[0].id } } });
    expect(confirmed.status).toBe(200);
    const after = (await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace;
    expect(after.state.payables.settlements).toHaveLength(1);
    expect(after.state.payables.settlements[0]).toMatchObject({ state: 'pending', quantity: 2380, amount: 110670 });
    expect((await tool('bambook_execute', { workspaceId: workspace.id, command, requestId: 'settle-po1' })).structuredContent).toMatchObject({ status: 'confirmed', replayed: true });
    expect((await client.get('/api/mist/workspaces/' + workspace.id).expect(200)).body.workspace.state.payables.settlements).toHaveLength(1);
  });

  it('finance agent turns a confirmation into a proposal that only the owner can confirm or reject in the app; confirming runs the real command', async () => {
    const local = createMistLocalRuntime({ directory });
    // 2026-11 财务岗默认持有 ai:write:high；本用例先撤去该码验证缺高风险档被拒，再恢复并复验密码。
    let grantHigh = false; const authorize = local.authorize;
    local.authorize = async (db, prior, permission) => { if (permission === 'ai:write:high' && !grantHigh) throw new MistApiError('FORBIDDEN', '当前账号没有执行此操作的权限', 403); return authorize(db, prior, permission); };
    vi.stubEnv('MIST_LOCAL_REAUTH_PASSWORD', 'local-reauth-secret');
    const app = createMistServer(undefined, { local });
    const buyer = await as(app, 'demo-buyer');
    const po = purchase(buyer.workspace, 'PO-2026-00001'), receipt = buyer.workspace.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
    // 结算由采购本人在页面提交（Agent 提交结算属中风险，须本人确认，另见上一用例）。
    await buyer.client.post('/api/mist/workspaces/' + buyer.workspace.id + '/commands').send({ requestId: randomUUID(), expectedRevision: buyer.workspace.revision, command: { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id] } } }).expect(200);
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
    const noTier = await run(finance.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } });
    expect(noTier.status).toBe(403); expect(noTier.body.error.message).toContain('ai:write:high');
    grantHigh = true;
    const noPassword = await run(finance.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } });
    expect(noPassword.status).toBe(403); expect(noPassword.body.error.code).toBe('REAUTH_REQUIRED');
    const runWith = async (client: any, command: any, password: string) => { const ws = await read(client); return client.post('/api/mist/workspaces/' + ws.id + '/commands').send({ requestId: 'r-' + Math.random().toString(36).slice(2), expectedRevision: ws.revision, command, reauth: { password }, signature: TEST_SIGNATURE }); };
    const wrong = await runWith(finance.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } }, 'not-the-password');
    expect(wrong.status).toBe(403); expect(wrong.body.error.code).toBe('REAUTH_FAILED');
    expect((await read(finance.client)).state.payables.settlements[0].state).toBe('pending');
    const confirmed = await runWith(finance.client, { type: 'agent.proposal.confirm', payload: { id: proposal.id } }, 'local-reauth-secret');
    expect(confirmed.status).toBe(200);
    expect(JSON.stringify(await local.database.mistCommandReceipt.findMany({ where: { workspaceId: finance.workspace.id } }))).not.toContain('local-reauth-secret');
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
    // 中风险与未登记（按高）命令只能建提议；只有低风险可直接执行。
    for (const type of ['payable.settlement.submit', 'development.saveDraft', 'market.quotation.save', 'fulfillment.procurement.save', 'customer.update', 'order.create', 'market.quotation.convert']) expect([type, via(type)]).toEqual([type, 'confirm']);
    for (const type of ['calendar.save', 'crm.followUp.save', 'email.flag', 'task.complete', 'market.quotation.feedback.add']) expect([type, via(type)]).toEqual([type, 'normal']);
    for (const entry of MIST_COMMAND_CATALOG) if (via(entry.type) === 'normal') expect([entry.type, agentCommandRisk(entry.type)]).toEqual([entry.type, 'low']);
    expect(via('files.add')).toBe('blocked');
    expect(via('email.server.sync')).toBe('blocked');
    expect(via('agent.proposal.confirm')).toBe('blocked');
  });
});

describe('M1 计税依据：退税预演与提议说明', () => {
  it('without sensitive:tax_base: filing / approving / receiving are refused, and previews, proposal summaries and audit input of other rebate commands hide amounts', async () => {
    const local = createMistLocalRuntime({ directory });
    // 本用例以财务身份办理，再撤去 sensitive:tax_base 复现“有退税办理权、无计税依据”的账号。
    let strip = false; const authorize = local.authorize;
    local.authorize = async (db, prior, permission) => {
      if (strip && permission === 'sensitive:tax_base') throw new MistApiError('FORBIDDEN', '当前账号没有执行此操作的权限', 403);
      const current = await authorize(db, prior, permission);
      return strip ? { ...current, permissions: (current.permissions || []).filter(scope => scope !== 'sensitive:tax_base') } : current;
    };
    const app = createMistServer(undefined, { local });
    const finance = await as(app, 'demo-finance');
    const read = async () => (await finance.client.get('/api/mist/workspaces/' + finance.workspace.id).expect(200)).body.workspace;
    // 退税核准须当场手写签字（mistSignatures）；其余命令不附签字。
    const run = async (command: any) => { const ws = await read(); return finance.client.post('/api/mist/workspaces/' + ws.id + '/commands').send({ requestId: 'r-' + randomUUID(), expectedRevision: ws.revision, command, ...(command.type === 'rebate.claim.approve' ? { signature: TEST_SIGNATURE } : {}) }); };
    const ws = await read();
    const customs = ws.state.fulfillment.customs.find((c: any) => ws.state.fulfillment.shipments.find((s: any) => s.id === c.shipmentId)?.state === 'departed');
    const { rebateCandidateBills } = await import('../shared/mistExportRebate'), { platformBusinessDate } = await import('../shared/mistPlatform'), today = platformBusinessDate(new Date().toISOString());
    const file = { type: 'rebate.claim.file', payload: { customsId: customs.id, billIds: rebateCandidateBills(ws.state, customs).map((b: any) => b.id), filedAt: today, batchRef: 'SB-PREVIEW' } };
    const leaked = (value: unknown) => /\d[\d,]*\.\d{2} CNY/.test(JSON.stringify(value));
    const first = await finance.tool('bambook_preview', { workspaceId: ws.id, command: file }); if (!first.structuredContent) throw new Error(first.content?.[0]?.text);
    // 持码人的预演含金额（对照）
    expect(leaked((await finance.tool('bambook_preview', { workspaceId: ws.id, command: file })).structuredContent.events)).toBe(true);
    strip = true;
    // 1. 申报 / 核准 / 勾稽另须 sensitive:tax_base：预演与页面命令都拒绝
    const filePreview = await finance.tool('bambook_preview', { workspaceId: ws.id, command: file });
    expect(filePreview.isError).toBe(true); expect(filePreview.content[0].text).toContain('计税依据'); expect(leaked(filePreview)).toBe(false);
    expect((await run(file)).status).toBe(403);
    strip = false;
    expect((await run(file)).status).toBe(200);
    const claim = (await read()).state.exportRebate.claims.find((c: any) => c.batchRef === 'SB-PREVIEW');
    expect((await run({ type: 'finance.importReceipts', payload: { receipts: [{ date: today, payer: '国家金库', amount: 26000, currency: 'CNY', ref: '退税' }] } })).status).toBe(200);
    const receipt = (await read()).state.receipts.find((r: any) => r.payer === '国家金库');
    expect((await run({ type: 'rebate.claim.approve', payload: { id: claim.id, date: today, amount: claim.expected, ref: '核准' } })).status).toBe(200);
    expect((await run({ type: 'rebate.claim.receive', payload: { id: claim.id, receiptId: receipt.id, amount: 1000 } })).status).toBe(200);
    const entry = (await read()).state.exportRebate.claims.find((c: any) => c.id === claim.id).receipts[0];
    strip = true;
    for (const command of [{ type: 'rebate.claim.approve', payload: { id: claim.id, date: today, amount: 1, ref: 'x' } }, { type: 'rebate.claim.receive', payload: { id: claim.id, receiptId: receipt.id, amount: 1 } }]) {
      const res = await run(command); expect(res.status).toBe(403); expect(leaked(res.body)).toBe(false);
    }
    // 2. 未加门槛的退税命令（冲回勾稽）：预演事件、提议说明、Agent 审计原始填写都脱敏
    const reverse = { type: 'rebate.claim.reverseReceipt', payload: { id: claim.id, entryId: entry.id, reason: '勾错流水' } };
    const preview = (await finance.tool('bambook_preview', { workspaceId: ws.id, command: reverse })).structuredContent;
    expect(preview.events.join('')).toContain('已隐藏'); expect(leaked(preview)).toBe(false);
    const proposed = (await finance.tool('bambook_execute', { workspaceId: ws.id, command: reverse, requestId: 'reverse-once' })).structuredContent;
    expect(proposed.status).toBe('awaiting_confirmation'); expect(leaked(proposed.summary)).toBe(false);
    const proposal = (await read()).state.agentProposals.find((p: any) => p.command.type === 'rebate.claim.reverseReceipt');
    expect(proposal.summary.join('')).toContain('已隐藏'); expect(leaked(proposal)).toBe(false);
    const auditCall = await finance.tool('bambook_audit', { workspaceId: ws.id, requestId: 'mcp-reverse-once', includeCommand: true }); if (!auditCall.structuredContent) throw new Error(auditCall.content?.[0]?.text); const audit = auditCall.structuredContent;
    expect(leaked(audit)).toBe(false);
    // 说明在不持码人预演时生成，入库的就是脱敏文字，持码人也看不到原金额（不会再从库里带出）。
    strip = false;
    expect((await read()).state.agentProposals.find((p: any) => p.id === proposal.id).summary.join('')).toContain('已隐藏');
  });
});

describe('External Agent confirmation uses the proposed source version',()=>{
  async function proposalFixture(){
    const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})});
    const {client,workspace,tool}=await as(app,'demo-sales');
    const customer=workspace.state.customers.find((c:any)=>c.ownerId==='demo-sales')!;
    expect(customer).toBeDefined();
    const command={type:'customer.update',payload:{id:customer.id,patch:{terms:'T/T 30% 预付'}}};
    const result=await tool('bambook_execute',{workspaceId:workspace.id,command});
    expect(result.isError).not.toBe(true);expect(result.structuredContent.status).toBe('awaiting_confirmation');
    const base='/api/mist/workspaces/'+workspace.id;
    const current=async()=>(await client.get(base).expect(200)).body.workspace;
    const run=async(command:any)=>client.post(base+'/commands').send({requestId:randomUUID(),expectedRevision:(await current()).revision,command});
    const id=result.structuredContent.receipt.result.id;
    return{client,base,current,run,id,customer};
  }
  it('refuses confirmation after another writer changes the same proposed customer field',async()=>{
    const f=await proposalFixture();
    expect((await f.run({type:'customer.update',payload:{id:f.customer.id,patch:{terms:'T/T 50% 预付'}}})).status).toBe(200);
    const before=await f.current();expect(before.state.customers.find((c:any)=>c.id===f.customer.id).terms).toBe('T/T 50% 预付');
    const response=await f.run({type:'agent.proposal.confirm',payload:{id:f.id}});
    expect(response.status).toBe(409);expect(response.body.error.code).toBe('REVISION_CONFLICT');
    const after=await f.current();expect(after.revision).toBe(before.revision);
    expect(after.state.customers.find((c:any)=>c.id===f.customer.id).terms).toBe('T/T 50% 预付');
    expect(after.state.agentProposals.find((p:any)=>p.id===f.id).state).toBe('pending');
  });
  it('allows an unrelated update, but a second confirmation cannot execute the proposal again',async()=>{
    const f=await proposalFixture();
    expect((await f.run({type:'calendar.save',payload:{title:'独立日程',date:'2026-11-05',time:'10:00',note:''}})).status).toBe(200);
    expect((await f.run({type:'agent.proposal.confirm',payload:{id:f.id}})).status).toBe(200);
    const before=await f.current();
    expect((await f.run({type:'agent.proposal.confirm',payload:{id:f.id}})).status).toBe(404);
    const after=await f.current();expect(after.revision).toBe(before.revision);expect(after.state.events).toEqual(before.state.events);
    expect(after.state.customers.find((c:any)=>c.id===f.customer.id).terms).toBe('T/T 30% 预付');
  });
  it('never executes a rejected proposal',async()=>{
    const f=await proposalFixture();
    expect((await f.run({type:'agent.proposal.reject',payload:{id:f.id}})).status).toBe(200);
    const before=await f.current();expect((await f.run({type:'agent.proposal.confirm',payload:{id:f.id}})).status).toBe(404);
    const after=await f.current();expect(after.revision).toBe(before.revision);
    expect(after.state.customers).toEqual(before.state.customers);expect(after.state.agentProposals.find((p:any)=>p.id===f.id).state).toBe('rejected');
  });
});
