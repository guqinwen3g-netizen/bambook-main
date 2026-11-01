import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { createMistLocalRuntime } from './local';
import { createMistServer } from './server';
import { AGENT_DELEGATION_HEADER } from './agentDelegation';
import {randomUUID} from 'node:crypto';

let directory: string;
const clients: Client[] = [], servers: Server[] = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'mist-mcp-client-'));
  vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  })));
  vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true });
});

async function fixture(profileId = 'demo-buyer', mode: 'read' | 'operate' = 'operate', autoNegotiate = false) {
  const local = createMistLocalRuntime({ directory });
  const app = createMistServer(undefined, { local });
  const human = request.agent(app);
  await human.get('/api/mist/session').expect(200);
  await human.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await human.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  const issued = (await human.post('/api/mist/agent/delegations').send({ mode,workspaceId:workspace.id,id:randomUUID() }).expect(201)).body.delegation;
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  const endpoint = new URL(`http://127.0.0.1:${address.port}/api/mist/mcp`);
  const headers = { [AGENT_DELEGATION_HEADER]: issued.token };
  const client = new Client({ name: 'bambook-interoperability', version: '1' }, { versionNegotiation: { mode: autoNegotiate ? 'auto' : 'legacy' } }); clients.push(client);
  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } });
  await client.connect(transport);
  const tool = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { app, human, workspace, endpoint, headers, client, tool };
}

describe('Official MCP client over a real loopback HTTP connection', () => {
  it.each(['read', 'operate'] as const)('reads mailbox receiving status in %s mode but cannot grant background access', async mode => {
    const { app, human, workspace, headers, tool } = await fixture('demo-sales', mode);
    const created = await human.post(`/api/mist/workspaces/${workspace.id}/commands`).send({ requestId: randomUUID(), expectedRevision: workspace.revision, command: { type: 'email.account.save', payload: { input: { address: 'qa@example.test', displayName: 'QA', kind: 'personal', memberIds: [], aliases: [], signature: '', transport: { imapHost: 'mail.example.test', imapPort: 993, imapSecure: true, smtpHost: 'mail.example.test', smtpPort: 465, smtpSecure: true, username: 'qa@example.test' } } } } }).expect(200);
    const id = created.body.receipt.result.id;
    const status = await tool('bambook_mail_receiving', { workspaceId: workspace.id });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({ items: [{ accountId: id, enabled: false, canEnable: false, canDisable: false }] });
    expect(JSON.stringify(status)).not.toMatch(/password|authority|sourceHash|credentialVersion/);
    const canonical = await request(app).get(`/api/mist/workspaces/${workspace.id}/email/receiving`).set(headers).expect(200);
    expect(canonical.body.items[0].accountId).toBe(id);
    await request(app).put(`/api/mist/workspaces/${workspace.id}/email/accounts/${id}/receiving`).set(headers).send({ enabled: true, version: 0, sourceGeneration: 1, requestId: randomUUID() }).expect(403);
    const commands = await tool('bambook_commands', { prefix: 'email.account.save' });
    expect(commands.structuredContent).toMatchObject({ commands: [{ type: 'email.account.save', via: 'confirm' }] });
  });
  it('negotiates an implemented protocol and exposes its tools to the external SDK', async () => {
    const { app, headers, client, tool, endpoint } = await fixture();
    expect(client.getServerVersion()?.name).toBe('bambook-mist');
    const tools = (await client.listTools()).tools;
    expect(tools.map(item => item.name).sort()).toEqual(['bambook_audit', 'bambook_commands', 'bambook_execute', 'bambook_get', 'bambook_mail_receiving', 'bambook_preview', 'bambook_query', 'bambook_related', 'bambook_task', 'bambook_workspaces']);
    expect(tools.find(item => item.name === 'bambook_execute')?.inputSchema.required).toContain('requestId');
    const workspaces = await tool('bambook_workspaces');
    expect(workspaces.isError).not.toBe(true);
    const deniedStream = await fetch(endpoint, { headers: { ...headers, Accept: 'text/event-stream' } });
    expect(deniedStream.status).toBe(405);
    expect(deniedStream.headers.get('allow')).toBe('POST');
    await request(app).get('/api/mist/mcp').set(headers).set('Origin', 'https://untrusted.example').expect(403);
    const init = await request(app).post('/api/mist/mcp').set(headers).send({ jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '2099-01-01' } }).expect(200);
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    await request(app).post('/api/mist/mcp').set(headers).set('MCP-Protocol-Version', '2099-01-01').send({ jsonrpc: '2.0', id: 10, method: 'tools/list' }).expect(400);
    await request(app).get('/api/mist/mcp').set(headers).set('MCP-Protocol-Version', '2099-01-01').expect(400);
  });

  it('also connects when the current SDK probes for its newer protocol before falling back', async () => {
    const { client, tool } = await fixture('demo-buyer', 'read', true);
    expect(client.getProtocolEra()).toBe('legacy');
    expect((await tool('bambook_workspaces')).isError).not.toBe(true);
  });

  it('previews, commits and retries one normal command without duplicate business records', async () => {
    const { human, workspace, tool } = await fixture();
    const po = workspace.state.fulfillment.purchases.find((item: any) => item.code === 'PO-2026-00001');
    const receipt = workspace.state.fulfillment.receipts.find((item: any) => item.purchaseId === po.id);
    const command = { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id], note: '实收到货结算' } };
    const args = { workspaceId: workspace.id, command, requestId: 'settlement-http-once' };
    expect((await tool('bambook_preview', args)).isError).not.toBe(true);
    expect((await human.get(`/api/mist/workspaces/${workspace.id}`)).body.workspace.revision).toBe(workspace.revision);
    expect((await tool('bambook_execute', args)).isError).not.toBe(true);
    const replay = await tool('bambook_execute', args);
    expect(replay.structuredContent).toMatchObject({ replayed: true });
    const after = (await human.get(`/api/mist/workspaces/${workspace.id}`).expect(200)).body.workspace;
    expect(after.state.payables.settlements).toHaveLength(1);
    expect(after.revision).toBe(workspace.revision + 1);
  });

  it('keeps read-only delegates read-only when called through the external SDK', async () => {
    const { workspace, tool } = await fixture('demo-buyer', 'read');
    const result = await tool('bambook_execute', { workspaceId: workspace.id, requestId: 'read-only-write', command: { type: 'payable.settlement.submit', payload: {} } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('只读委托');
  });
});
