import { beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { MemoryMistDatabase } from './__tests__/support';
import { createIdentity, issueServiceKey, revokeServiceKey } from './agentIdentities';
import { assertTaskLease, changeTask, checkpointTask, claimTask, createTask, finishTask, heartbeatTask, reserveTaskStep, settleTaskProposal, taskRecord, taskView, waitTaskForProposal, type AgentTaskLease } from './agentTasks';
import type { AgentActor } from './agentDelegation';
import type { TokenPayload } from '../auth/service';

let db: MemoryMistDatabase, actor: TokenPayload, service: AgentActor, workspaceId: string, identityId: string, taskId: string;
let now: number;
const make = (w: string, t: string, r: string, n: string) => [w,t,r,n].join('.');
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const tx = <T>(fn: (db: any) => Promise<T>) => db.$transaction(fn);
beforeEach(async () => {
  db = new MemoryMistDatabase(); workspaceId = randomUUID(); now = Date.parse('2026-11-01T00:00:00Z');
  actor = { userId: 'owner', displayName: '业务员', permissions: ['users:write','ai:chat','orders:read','orders:write'], roles: [], departmentIds: [], authorizationLoaded: true, credentialVersion: 'cv' } as TokenPayload;
  const identity = await tx(d => createIdentity(d, actor, workspaceId, { id: randomUUID(), name: '业务助理', ownerId: actor.userId, mode: 'operate' }, { id: actor.userId, name: actor.displayName! }, now)); identityId = identity.id;
  await tx(d => issueServiceKey(d, actor, workspaceId, identityId, { requestId: randomUUID(), version: identity.version }, (_w,_i,g) => 'test-key-' + g, now));
  const task = await tx(d => createTask(d, actor, workspaceId, { requestId: randomUUID(), identityId, name: '核对订单', instructions: '核对当前授权订单，任何变更先交本人确认。' }, now)); taskId = task.id;
  const c = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  service = { ...actor, actorKind: 'agent', agentIdentity: { id: identityId, name: '业务助理' }, agentMode: 'operate', agentSessionId: identityId, agentWorkspaceId: workspaceId, agentServiceLease: c.authority } as AgentActor;
});
async function claim(requestId = randomUUID(), workerId = 'worker') {
  const result = await tx(d => claimTask(d, service, workspaceId, taskId, { requestId, workerId }, make, now, []));
  const c = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  return { result, lease: { taskId, workspaceId, runId: c.lease!.id, grantHash: digest(result.token!), serviceLease: c.authority } as AgentTaskLease };
}
it('creates an idle task without pretending an executor exists, and never exposes credentials in a view', async () => {
  const c = (await tx(d => taskRecord(d, workspaceId, taskId))).value, view = taskView(c, actor, now);
  expect(view).toMatchObject({ state: 'queued', lastHeartbeatAt: null, stepsUsed: 0 });
  expect(JSON.stringify(view)).not.toMatch(/grantHash|nonce|authority|test-key/);
});
it('only one executor can claim, identical claim replays its grant, and different task identity cannot claim', async () => {
  const requestId = randomUUID(), first = await claim(requestId);
  const repeated = await tx(d => claimTask(d, service, workspaceId, taskId, { requestId, workerId: 'worker' }, make, now, [])); expect(repeated.token).toBe(first.result.token);
  await expect(claim(randomUUID(), 'other')).rejects.toMatchObject({ code: 'AGENT_TASK_BUSY' });
  await expect(tx(d => claimTask(d, { ...service, agentIdentity: { id: randomUUID(), name: 'other' } }, workspaceId, taskId, { requestId: randomUUID(), workerId: 'other' }, make, now, []))).rejects.toMatchObject({ status: 403 });
});
it('monotonic heartbeat does not revive expired or superseded leases and checkpoints survive process recreation', async () => {
  const { lease } = await claim(); now += 20_000;
  await tx(d => heartbeatTask(d, actor, lease, 1, now));
  await tx(d => checkpointTask(d, actor, lease, { requestId: 'checkpoint-1', summary: '已核对订单，尚未修改。' }, now));
  now += 10_000; await tx(d => heartbeatTask(d, actor, lease, 2, now));
  await expect(tx(d => heartbeatTask(d, actor, lease, 1, now))).rejects.toMatchObject({ code: 'AGENT_TASK_CHANGED' });
  await tx(d => checkpointTask(d, actor, lease, { requestId: 'checkpoint-1', summary: '已核对订单，尚未修改。' }, now));
  now += 100_000; await expect(tx(d => assertTaskLease(d, actor, lease, now))).rejects.toMatchObject({ code: 'AGENT_TASK_LEASE_INVALID' });
  const second = await claim(); expect(second.lease.runId).not.toBe(lease.runId); expect(second.result.item.checkpoint).toBe('已核对订单，尚未修改。');
  await expect(tx(d => heartbeatTask(d, actor, lease, 3, now))).rejects.toMatchObject({ code: 'AGENT_TASK_LEASE_INVALID' });
});
it('counts an operation once even when retried, refuses changed input and caps failed attempts too', async () => {
  const { lease } = await claim();
  await tx(d => reserveTaskStep(d, actor, lease, 'operation', 'hash', now)); await tx(d => reserveTaskStep(d, actor, lease, 'operation', 'hash', now));
  expect((await tx(d => taskRecord(d, workspaceId, taskId))).value.stepsUsed).toBe(1);
  await expect(tx(d => reserveTaskStep(d, actor, lease, 'operation', 'changed', now))).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  for (let i = 1; i < 40; i++) await tx(d => reserveTaskStep(d, actor, lease, 'attempt-' + i, 'hash', now));
  await expect(tx(d => reserveTaskStep(d, actor, lease, 'attempt-41', 'hash', now))).rejects.toMatchObject({ code: 'AGENT_TASK_BUDGET' });
});
it('waiting for human confirmation immediately fences the old executor; settling enables a fresh claim only', async () => {
  const { lease } = await claim();
  await tx(d => waitTaskForProposal(d, actor, lease, 'proposal', 'proposal-request', now));
  await expect(tx(d => assertTaskLease(d, actor, lease, now))).rejects.toMatchObject({ code: 'AGENT_TASK_LEASE_INVALID' });
  expect((await tx(d => taskRecord(d, workspaceId, taskId))).value.state).toBe('waiting_human');
  await tx(d => settleTaskProposal(d, actor, workspaceId, taskId, 'proposal', 'confirm-request', 'confirmed', now));
  const second = await claim(); expect(second.lease.runId).not.toBe(lease.runId); expect(second.result.item.checkpoint).toContain('本人已确认');
});
it('pause/resume and cancellation fence old traffic; replaying an old pause cannot stop a later resumed task', async () => {
  const { lease } = await claim(), c = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  const paused = await tx(d => changeTask(d, actor, workspaceId, taskId, 'pause', { requestId: 'pause-1', version: c.controlVersion }, now, []));
  expect(paused.lastHeartbeatAt).not.toBeNull();
  await expect(tx(d => assertTaskLease(d, actor, lease, now))).rejects.toMatchObject({ status: 401 });
  const resumed = await tx(d => changeTask(d, actor, workspaceId, taskId, 'resume', { requestId: 'resume-1', version: paused.version }, now, []));
  const replay = await tx(d => changeTask(d, actor, workspaceId, taskId, 'pause', { requestId: 'pause-1', version: c.controlVersion }, now, [])); expect(replay.state).toBe('queued');
  await tx(d => changeTask(d, actor, workspaceId, taskId, 'cancel', { requestId: 'cancel-1', version: resumed.version }, now, []));
  await expect(claim()).rejects.toMatchObject({ code: 'AGENT_TASK_NOT_READY' });
});
it('revoked credentials, changed permissions or another owner cannot continue, and protected details disappear after scope loss', async () => {
  const { lease } = await claim();
  await expect(tx(d => assertTaskLease(d, { ...actor, userId: 'other' }, lease, now))).rejects.toMatchObject({ status: 404 });
  const limited = { ...actor, permissions: ['ai:chat'] };
  await expect(tx(d => assertTaskLease(d, limited, lease, now))).rejects.toMatchObject({ code: 'AGENT_TASK_ACCESS_CHANGED' });
  const c = (await tx(d => taskRecord(d, workspaceId, taskId))).value; expect(taskView(c, limited, now)).toMatchObject({ state: 'access_changed', instructions: '', checkpoint: '' });
  await tx(d => revokeServiceKey(d, actor, workspaceId, identityId, { requestId: randomUUID() }, now));
  await expect(tx(d => assertTaskLease(d, actor, lease, now))).rejects.toMatchObject({ code: 'AGENT_KEY_INVALID' });
});
it('a finished task cannot be executed again', async () => {
  const { lease } = await claim(); await tx(d => finishTask(d, actor, lease, { requestId: 'finish-1', outcome: 'succeeded', result: '核对完成，无需变更。' }, now));
  await expect(tx(d => assertTaskLease(d, actor, lease, now))).rejects.toMatchObject({ status: 401 });
  await expect(claim()).rejects.toMatchObject({ code: 'AGENT_TASK_NOT_READY' });
});
it('accumulates runtime across pause/resume and refuses renewal beyond the total runtime budget', async () => {
  const first = await claim(); now += 20_000; await tx(d => heartbeatTask(d, actor, first.lease, 1, now));
  const c = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  const paused = await tx(d => changeTask(d, actor, workspaceId, taskId, 'pause', { requestId:'pause', version:c.controlVersion }, now, []));
  await tx(d => changeTask(d, actor, workspaceId, taskId, 'resume', { requestId:'resume', version:paused.version }, now, []));
  const second = await claim();
  for (let n=1;n<89;n++) { now+=20_000; await tx(d => heartbeatTask(d, actor, second.lease, n, now)); }
  now+=20_000; await expect(tx(d => heartbeatTask(d, actor, second.lease, 89, now))).rejects.toMatchObject({ code:'AGENT_TASK_LEASE_INVALID' });
  expect(taskView((await tx(d => taskRecord(d,workspaceId,taskId))).value,actor,now).state).toBe('budget_exhausted');
});
