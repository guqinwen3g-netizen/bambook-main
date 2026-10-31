import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMistLocalRuntime } from './local';
import { createMistServer } from './server';
import { MistApiError } from './errors';

let directory: string;
const network = vi.fn(async () => new Response(JSON.stringify({
  choices: [{ message: { content: '已按当前可见资料回答。' } }],
}), { status: 200 }));

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-member-assistant-'));
  vi.stubEnv('MIST_LOCAL_WORKSPACE', '1');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('BAMBOOK_CODEX_SUBSCRIPTION', '0');
  vi.stubEnv('ARK_API_KEY', 'synthetic-provider-key');
  vi.stubEnv('BAMBOOK_MODEL_BASE_URL', 'https://model.invalid/v1');
  vi.stubGlobal('fetch', network);
  network.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function person(app: ReturnType<typeof createMistServer>, profileId: string) {
  const client = request.agent(app);
  await client.get('/api/mist/session').expect(200);
  await client.post('/api/mist/session').send({ profileId }).expect(200);
  const workspace = (await client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
  return { client, workspace, base: `/api/mist/workspaces/${workspace.id}/assistant` };
}

describe('Company-member platform assistant requests', () => {
  it('lets a currently authorized non-owner ask without changing company data', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const member = await person(app, 'demo-finance');
    expect(member.workspace.ownerId).not.toBe('demo-finance');
    expect(member.workspace.access.role).toBe('member');
    await member.client.get(member.base + '/status').expect(200);
    const answer = (await member.client.post(member.base).send({
      message: '概述我当前可见的业务数量。', sourceIds: [], history: [],
    }).expect(200)).body;
    expect(answer).toMatchObject({ mode: 'read_only', text: '已按当前可见资料回答。', sources: [] });
    expect(network).toHaveBeenCalled();
    const after = (await member.client.get('/api/mist/workspaces/default').expect(200)).body.workspace;
    expect(after.revision).toBe(member.workspace.revision);
    expect(after.state).toEqual(member.workspace.state);
  });

  it('still refuses another company and request-body authority overrides', async () => {
    const app = createMistServer(undefined, { local: createMistLocalRuntime({ directory }) });
    const member = await person(app, 'demo-finance');
    const other = await person(app, 'local-sales');
    expect(other.workspace.id).not.toBe(member.workspace.id);
    await member.client.post(`/api/mist/workspaces/${other.workspace.id}/assistant`)
      .send({ message: 'Read another company.' }).expect(404);
    await member.client.post(member.base).send({
      message: 'Override access.', access: { role: 'owner' }, actorId: 'demo-reviewer',
    }).expect(400);
    expect(network).not.toHaveBeenCalled();
  });

  it('rechecks AI permission after the same member has already opened the page', async () => {
    const local = createMistLocalRuntime({ directory });
    const original = local.authorize;
    let allowed = true;
    local.authorize = async (db, actor, permission) => {
      const current = await original(db, actor, permission);
      if (!allowed && permission === 'ai:chat') throw new MistApiError('FORBIDDEN', '当前账号没有助手权限', 403);
      return current;
    };
    const app = createMistServer(undefined, { local });
    const member = await person(app, 'demo-finance');
    await member.client.get(member.base + '/status').expect(200);
    allowed = false;
    await member.client.post(member.base).send({ message: 'Try after permission removal.' }).expect(403);
    expect(network).not.toHaveBeenCalled();
  });
});
