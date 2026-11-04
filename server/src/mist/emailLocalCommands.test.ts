import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMistLocalRuntime } from './local';
import { createMistServer } from './server';
import type { MailTransport } from './mail/transport';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-local-mail-commands-'));
  vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', 'mail.example.com');
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const local = createMistLocalRuntime({ directory });
  const network = vi.fn(async () => { throw new Error('Local commands must not connect to mail servers'); });
  const transport: MailTransport = { imap: network, smtpVerify: network, smtpSend: network };
  const app = createMistServer(undefined, { local, mailTransport: transport });
  const client = request.agent(app);
  await client.get('/api/mist/session').expect(200);
  await client.post('/api/mist/session').send({ profileId: 'demo-sales' }).expect(200);
  const read = async () => (await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  const ws = await read(), base = `/api/mist/workspaces/${ws.id}`;
  const command = async (type: string, payload: unknown, status = 200) => {
    const current = await read();
    return client.post(base + '/commands').send({ requestId: randomUUID(), expectedRevision: current.revision, command: { type, payload } }).expect(status);
  };
  return { local, client, read, command, base, ws, network };
}

it('rejects assigning follow-ups to a mailbox member without current email handling permission', async () => {
  const f = await fixture(), id = f.ws.state.email.messages[0].id, before = await f.read();
  const result = await f.command('email.followUp', { id, ownerId: 'demo-finance', due: '2026-11-02', note: '确认交期' }, 422);
  expect(result.body.error.code).toBe('PRECONDITION');
  const after = await f.read();
  expect(after.revision).toBe(before.revision);
  for (const key of ['tasks', 'calendar', 'events', 'crm', 'email']) expect(after.state[key]).toEqual(before.state[key]);
  expect(f.network).not.toHaveBeenCalled();
});

it('accepts an authorized follow-up and rejects a non-member without writing a task', async () => {
  const f = await fixture(), id = f.ws.state.email.messages[0].id;
  const result = await f.command('email.followUp', { id, ownerId: 'demo-buyer', due: '2026-11-02', note: '确认交期' });
  expect(result.body.workspace.state.tasks.find((task: any) => task.id === result.body.receipt.result.id).assigneeIds).toEqual(['demo-buyer']);
  const before = await f.read();
  await f.command('email.followUp', { id, ownerId: 'outside-company', due: '2026-11-02', note: '' }, 422);
  expect((await f.read()).revision).toBe(before.revision);
  expect(f.network).not.toHaveBeenCalled();
});

it('saves out-of-allowlist recipients as a local draft but rejects the sending request before registration', async () => {
  vi.stubEnv('MIST_MAIL_ALLOWED_RECIPIENT_DOMAINS', 'example.org');
  const f = await fixture();
  const created = await f.command('email.account.save', { input: { address: 'staff@example.com', displayName: '业务', kind: 'personal', memberIds: [], aliases: [], signature: '', transport: { imapHost: 'mail.example.com', imapPort: 993, imapSecure: true, smtpHost: 'mail.example.com', smtpPort: 465, smtpSecure: true, username: 'staff@example.com' } } });
  const accountId = created.body.receipt.result.id;
  const input = { accountId, from: 'staff@example.com', to: 'buyer@example.com', cc: '', bcc: '', subject: '草稿', body: '{待填写}', template: '', links: [], fileIds: [] };
  const saved = await f.command('email.draft.save', { input });
  const denied = await f.client.post(f.base + '/email/sends').send({ requestKey: 'local-mail-policy', draftId: saved.body.receipt.result.id, input }).expect(422);
  expect(denied.body.error.code).toBe('MAIL_RECIPIENT_NOT_ALLOWED');
  const after = await f.read();
  expect(after.state.email.drafts).toContainEqual(expect.objectContaining({ to: 'buyer@example.com', body: '{待填写}' }));
  expect(after.state.email.sends).toEqual([]);
  expect(f.network).not.toHaveBeenCalled();
});
