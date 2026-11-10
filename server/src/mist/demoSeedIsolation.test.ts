import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as mistContract from '../shared/mistWorkspace';
import { MistRepository, type MistContract } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';

// 正式公司（有 companyId）与服务器上的任何账号都不得写入演示种子或示例邮箱；演示数据只属于本机演示 / 开发模式。
const COMPANY = '33333333-3333-4333-8333-333333333333';
const DEMO_ANSWER = '已按要求找到并确认面料';
let root: string, db: MemoryMistDatabase, repo: MistRepository;
const company = (id = 'owner') => ({ ...testActor(id), companyId: COMPANY });
const stored = () => [...db.workspaces.values()].map(row => row.state);

function expectNoDemo(state: any) {
  expect(state.orders ?? []).toEqual([]);
  expect(state.orderLines ?? []).toEqual([]);
  expect(state.devs ?? []).toEqual([]);
  expect(state.fabrics ?? []).toEqual([]);
  expect(state.productions ?? []).toEqual([]);
  expect(state.invoices ?? []).toEqual([]);
  expect(state.customers ?? []).toEqual([]);
  expect(state.email?.accounts ?? []).toEqual([]);
  expect(state.email?.messages ?? []).toEqual([]);
  expect(state.settings?.demoSeed).toBeUndefined();
  const text = JSON.stringify(state);
  expect(text).not.toContain(DEMO_ANSWER);
  expect(text).not.toContain('example.invalid');
  expect(text).not.toContain('"example":true');
  expect(text).not.toContain('demo-seed/');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mist-demo-isolation-'));
  db = new MemoryMistDatabase();
  for (const userId of ['owner', 'other']) db.companyMembers.push({ companyId: COMPANY, userId, status: 'active' });
  repo = new MistRepository(db, mistContract as MistContract, new MistPrivateFiles(root), testAuthority().authorize, () => new Date('2026-10-13T04:00:00Z'));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe('demo seed never reaches a real company', () => {
  for (const env of ['test', 'production']) it(`company library created on first entry is empty (NODE_ENV=${env})`, async () => {
    vi.stubEnv('NODE_ENV', env);
    const created = await repo.create(company(), { name: '公司业务', seed: 'demo' }, true);
    expectNoDemo(created.state);
    const read = await repo.get(company('other'), created.id);
    expectNoDemo(read.state);
    expect(db.workspaces.size).toBe(1);
    stored().forEach(expectNoDemo);
  });

  it('names the company library after the registered company and starts its letterhead from the registration', async () => {
    db.companies.push({ id: COMPANY, name: '云锦服饰', legalName: '云锦服饰进出口有限公司', englishName: 'Yunjin Apparel Co., Ltd.' });
    const created = await repo.create(company(), { name: '公司业务', seed: 'empty' }, true);
    expect(created.name).toBe('云锦服饰');
    expect(created.state.settings).toMatchObject({ workspaceName: '云锦服饰', companyProfile: { legalName: '云锦服饰进出口有限公司', englishName: 'Yunjin Apparel Co., Ltd.' } });
  });

  it('shows an existing placeholder-named library under the registered company name', async () => {
    const created = await repo.create(company(), { name: '公司业务', seed: 'empty' }, true);
    expect(created.name).toBe('公司业务');
    db.companies.push({ id: COMPANY, name: '云锦服饰' });
    const read = await repo.get(company('other'), created.id);
    expect(read.name).toBe('云锦服饰');
    expect(read.state.settings.workspaceName).toBe('云锦服饰');
  });

  it('ignores an explicit demo seed when a company member creates the library through POST', async () => {
    await repo.create(company(), { name: '公司', slug: 'explicit', seed: 'demo' });
    expect(db.workspaces.size).toBe(1);
    stored().forEach(expectNoDemo);
  });

  it('does not grant demo data to a forged local flag on the server', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('MIST_LOCAL_WORKSPACE', '1');
    const actor = { ...company(), mistLocal: true } as any;
    const created = await repo.create(actor, { name: '公司业务', seed: 'demo' }, true);
    expectNoDemo(created.state);
    stored().forEach(expectNoDemo);
  });

  it('never seeds demo data on a production server, even for an account without a company', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const fallback = await repo.create(testActor(), { name: '公司业务', seed: 'demo' }, true);
    expectNoDemo(fallback.state);
    await expect(repo.create(testActor(), { name: '演示', slug: 'demo-try', seed: 'demo' })).rejects.toMatchObject({ code: 'DEMO_SEED_DISABLED', status: 403 });
    const implicit = await repo.create(testActor(), { name: '未指定', slug: 'implicit' });
    expectNoDemo(implicit.state);
    stored().forEach(expectNoDemo);
  });

  it('keeps the demo seed available outside production for accounts without a company', async () => {
    const demo = await repo.create(testActor(), { name: 'Demo', slug: 'demo', seed: 'demo' });
    expect(demo.state.settings.demoSeed).toBeDefined();
    expect(JSON.stringify(stored())).toContain(DEMO_ANSWER);
  });
});
