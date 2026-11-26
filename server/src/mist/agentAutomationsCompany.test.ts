/** 公司账号模式下的自动规则：没有登录会话也能按所有者当前授权运行，账号失效后规则停下并写明原因。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyMistCommand, createMistState, mistCommandPermission } from '../shared/mistWorkspace';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { MemoryMistDatabase, testAuthority } from './__tests__/support';
import { MistRepository } from './repository';
import { MistPrivateFiles } from './files';
import { MistAutomationWorker } from './agentAutomationWorker';

const company = '11111111-1111-4111-8111-111111111111', now = Date.parse('2026-11-07T03:00:00Z');
let directory: string, db: MemoryMistDatabase, repo: MistRepository, auth: ReturnType<typeof testAuthority>, workspaceId: string, worker: MistAutomationWorker;
const clerk = (): any => ({ userId: 'clerk', displayName: 'Clerk', roleIds: [SYSTEM_ROLE_IDS.SUPER_ADMIN + '@' + company], roles: [], companyId: company, authorizationLoaded: true, iat: Math.floor(now / 1000) - 60 });
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'agent-automation-')); db = new MemoryMistDatabase(); auth = testAuthority();
  auth.users.set('clerk', { active: true, permissions: ['ai:chat', 'orders:read', 'relations:read'] }); db.companyMembers.push({ companyId: company, userId: 'clerk', status: 'active' } as any);
  const state = createMistState({ id: randomUUID, now: new Date(now).toISOString(), actorId: 'clerk', actorName: 'Clerk' }, 'empty');
  workspaceId = randomUUID(); db.workspaces.set(workspaceId, { id: workspaceId, ownerId: 'other', companyId: company, slug: 'company@' + company, name: 'Company', revision: 1, state, createdAt: new Date(), updatedAt: new Date() });
  repo = new MistRepository(db as any, { createMistState, applyMistCommand, mistCommandPermission } as any, new MistPrivateFiles(directory), auth.authorize as any);
  repo.setPlatformTaskRuntime(() => true);
  worker = new MistAutomationWorker(repo, { make: () => 'bma1_test', now: () => now });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

it('saves a rule in a session, then runs it from the stored grant without one', async () => {
  const saved = await repo.saveAutomation(clerk(), workspaceId, undefined, { name: '每日汇总', trigger: 'daily', time: '00:00', instructions: '汇总待办' });
  const [job] = (await repo.dueAutomations(10)).jobs; expect(job).toMatchObject({ workspaceId, id: saved.id }); expect(job.authority).toMatchObject({ ownerId: 'clerk', companyId: company });
  const result = await repo.runAutomation(await worker.actor(job.authority), workspaceId, saved.id, () => 'bma1_test', now);
  expect(result.fired).toBe(true);
  const [rule] = (await repo.listAutomations(clerk(), workspaceId)).items; expect(rule.runs).toHaveLength(1); expect(rule.halted).toBeUndefined();
});
it('halts with a reason when the owner can no longer act, and never runs for them again', async () => {
  const saved = await repo.saveAutomation(clerk(), workspaceId, undefined, { name: '每日汇总', trigger: 'daily', time: '00:00', instructions: '汇总待办' });
  const [job] = (await repo.dueAutomations(10)).jobs; auth.users.get('clerk')!.active = false;
  await expect(repo.runAutomation(await worker.actor(job.authority), workspaceId, saved.id, () => 'bma1_test', now)).resolves.toMatchObject({ fired: false });
  auth.users.get('clerk')!.active = true;
  const [rule] = (await repo.listAutomations(clerk(), workspaceId)).items; expect(rule).toMatchObject({ enabled: false }); expect(rule.halted?.message).toBeTruthy();
  expect((await repo.dueAutomations(10)).jobs).toEqual([]);
});

it('reaches later companies beyond the first 50 enabled rules and keeps the original run after restart', async () => {
  const firstCompanyActor = clerk();
  for (const userId of ['clerk', 'second', 'third']) {
    auth.users.set(userId, { active: true, permissions: ['ai:chat'] });
    db.companyMembers.push({ companyId: company, userId, status: 'active' } as any);
    for (let index = 0; index < 20; index++) {
      await repo.saveAutomation({ ...firstCompanyActor, userId }, workspaceId, undefined, {
        name: '晚间汇总 ' + index, trigger: 'daily', time: '23:00', instructions: '汇总待办',
      }, now);
    }
  }

  const laterCompany = randomUUID(), laterWorkspace = randomUUID();
  db.workspaces.set(laterWorkspace, {
    ...db.workspaces.get(workspaceId)!, id: laterWorkspace, companyId: laterCompany, slug: 'company@' + laterCompany,
  });
  db.companyMembers.push({ companyId: laterCompany, userId: 'clerk', status: 'active' } as any);
  const laterActor = {
    ...firstCompanyActor, companyId: laterCompany, roleIds: [SYSTEM_ROLE_IDS.SUPER_ADMIN + '@' + laterCompany],
  };
  const laterRule = await repo.saveAutomation(laterActor, laterWorkspace, undefined, {
    name: '上午汇总', trigger: 'daily', time: '10:00', instructions: '汇总待办',
  }, now);

  const run = vi.spyOn(repo, 'runAutomation');
  await worker.tick();
  expect(run).toHaveBeenCalledTimes(61);
  expect(new Set(run.mock.calls.map(call => call[2])).size).toBe(61);
  const [saved] = (await repo.listAutomations(laterActor, laterWorkspace)).items;
  expect(saved.id).toBe(laterRule.id);
  expect(saved.runs).toHaveLength(1);
  expect((await repo.listAutomations(firstCompanyActor, workspaceId)).items.every(rule => !rule.runs.length)).toBe(true);

  const restarted = new MistAutomationWorker(repo, { make: () => 'bma1_test', now: () => now + 30_000 });
  await restarted.tick();
  expect((await repo.listAutomations(laterActor, laterWorkspace)).items[0].runs).toEqual(saved.runs);
});
