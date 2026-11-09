/** 自动规则的长期可靠性：大邮箱不重复触发、待本人回答时不叠加、过期任务不卡住规则、意外失败持续后停用并写明原因。 */
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
import { evaluateAutomation, type AutomationRecord } from './agentAutomations';
import { TASK_FIELD } from './agentTasks';

const DAY = 86400_000, t0 = Date.parse('2026-11-07T03:00:00Z');
const rule = (over: Partial<AutomationRecord> = {}): AutomationRecord => ({ schemaVersion: 1, id: 'r', workspaceId: 'w', ownerId: 'u', ownerName: 'u', version: 1, name: '新邮件', trigger: 'new_mail', time: '00:00', instructions: '整理', enabled: true, createdAt: '', updatedAt: '', seen: [], primed: false, runs: [], ...over });
const inbox = (n: number, from: number, step = 60_000) => ({ email: { messages: Array.from({ length: n }, (_, i) => ({ id: 'm' + i, folder: 'inbox', subject: 's' + i, at: new Date(from + i * step).toISOString() })) } }) as any;

it('never re-fires old mail in a mailbox larger than the remembered window, but still catches late mail inside the window', () => {
  let c = rule();
  const big = inbox(2000, t0 - 30 * DAY, 20 * 60_000); // 2000 封，跨约 28 天
  let d = evaluateAutomation(c, big, t0); expect(d.fire).toBeUndefined(); c = { ...c, ...d.next };
  for (let tick = 0; tick < 3; tick++) { d = evaluateAutomation(c, big, t0 + tick * 30_000); expect(d.fire).toBeUndefined(); c = { ...c, ...d.next }; }
  expect(c.seen.length).toBeLessThanOrEqual(3000);
  const newest = Math.max(...big.email.messages.map((m: any) => Date.parse(m.at)));
  const withNew = { email: { messages: [...big.email.messages, { id: 'new', folder: 'inbox', subject: '新询价', at: new Date(newest + 60_000).toISOString() }, { id: 'late', folder: 'inbox', subject: '迟到', at: new Date(newest - 2 * DAY).toISOString() }, { id: 'ancient', folder: 'inbox', subject: '旧邮件', at: new Date(newest - 20 * DAY).toISOString() }] } } as any;
  d = evaluateAutomation(c, withNew, t0 + 120_000);
  expect(d.fire?.detail).toBe('2 封新邮件'); expect(d.fire?.facts).toContain('新询价'); expect(d.fire?.facts).toContain('迟到'); expect(d.fire?.facts).not.toContain('旧邮件');
  c = { ...c, ...d.next };
  expect(evaluateAutomation(c, withNew, t0 + 150_000).fire).toBeUndefined();
});

it('re-primes an older rule that has no time watermark instead of firing on its backlog', () => {
  const c = rule({ primed: true, seen: ['m1'] });
  const d = evaluateAutomation(c, inbox(800, t0 - 10 * DAY), t0);
  expect(d.fire).toBeUndefined(); expect(d.next.primed).toBe(true); expect(typeof d.next.since).toBe('number');
});

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

const taskRow = (taskId: string) => [...db.receipts.values()].find((r: any) => r.result?.[TASK_FIELD]?.id === taskId);
async function firstRun() {
  const saved = await repo.saveAutomation(clerk(), workspaceId, undefined, { name: '每日汇总', trigger: 'daily', time: '00:00', instructions: '汇总待办' });
  const [job] = await repo.dueAutomations(10), actor = await worker.actor(job.authority);
  const first = await repo.runAutomation(actor, workspaceId, saved.id, () => 'bma1_test', now);
  expect(first.fired).toBe(true);
  return { id: saved.id, actor, taskId: first.taskId! };
}

it('does not start another run while the last one waits for the owner, but an expired run never blocks the rule', async () => {
  const { id, actor, taskId } = await firstRun(), next = now + DAY;
  const row = taskRow(taskId); expect(row).toBeTruthy();
  row.result[TASK_FIELD].state = 'waiting_human';
  expect((await repo.runAutomation(actor, workspaceId, id, () => 'bma1_test', next)).fired).toBe(false);
  const again = taskRow(taskId); again.result[TASK_FIELD].state = 'running'; again.result[TASK_FIELD].expiresAt = next - 1;
  expect((await repo.runAutomation(actor, workspaceId, id, () => 'bma1_test', next)).fired).toBe(true);
});

it('keeps retrying through a short outage, then stops with a reason once failures persist', async () => {
  const saved = await repo.saveAutomation(clerk(), workspaceId, undefined, { name: '每日汇总', trigger: 'daily', time: '00:00', instructions: '汇总待办' });
  const [job] = await repo.dueAutomations(10), actor = await worker.actor(job.authority);
  const spy = vi.spyOn(repo, 'assignPersonalAgentTask').mockRejectedValue(new Error('connection reset'));
  for (let i = 0; i < 6; i++) await expect(repo.runAutomation(actor, workspaceId, saved.id, () => 'bma1_test', now + i * 30_000)).rejects.toThrow();
  let [rule] = (await repo.listAutomations(clerk(), workspaceId)).items; expect(rule.enabled).toBe(true);
  await expect(repo.runAutomation(actor, workspaceId, saved.id, () => 'bma1_test', now + 31 * 60_000)).rejects.toThrow();
  [rule] = (await repo.listAutomations(clerk(), workspaceId)).items;
  expect(rule.enabled).toBe(false); expect(rule.halted?.message).toMatch(/持续无法运行.*系统暂时无法创建任务/);
  spy.mockRestore();
});
