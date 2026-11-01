import { beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { MemoryMistDatabase } from './__tests__/support';
import { createIdentity, identityRecord, identityView, issueServiceKey, revokeServiceKey } from './agentIdentities';
import { answerTaskQuestion, askTaskQuestion, assertTaskLease, changeTask, checkTaskCondition, checkpointTask, claimTask, createTask, finishTask, heartbeatTask, issueTaskControl, reserveTaskStep, saveTaskSources, settleTaskProposal, taskRecord, taskView, waitTaskForProposal, waitTaskUntil, type AgentTaskLease } from './agentTasks';
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
const conditionTarget={type:'order',id:'source-order'},preparedCondition=()=>({...conditionTarget,label:'SO-1',hash:'server-full-read-hash'});
it('checks a condition on a bounded cadence without a lease or runtime charge, then requires the exact original full read',async()=>{
 const first=await claim();now+=5000;const requestId=randomUUID(),input={requestId,delaySeconds:120,condition:conditionTarget,summary:'等待原订单变化。'};
 const waiting=await tx(d=>waitTaskUntil(d,service,first.lease,input,now,preparedCondition));expect(waiting).toMatchObject({state:'waiting_condition',runtimeUsedMs:5000,waitingFor:{...conditionTarget,label:'SO-1'}});
 let checks=0;now+=29999;expect((await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>{checks++;return false;}))).state).toBe('waiting_condition');expect(checks).toBe(0);
 now++;const unchanged=await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>{checks++;return false;}));expect(unchanged.condition!.nextCheckAt).toBe(now+30000);expect(unchanged.runtimeUsedMs).toBe(5000);expect(unchanged.lease).toBeUndefined();
 now+=30000;const ready=await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>true));expect(ready).toMatchObject({state:'queued',wakeReason:'changed',requiredRead:conditionTarget,runtimeUsedMs:5000});expect(ready.expiresAt).toBe(unchanged.expiresAt);expect(ready.condition).toBeUndefined();
 const run=await claim();await expect(tx(d=>finishTask(d,actor,run.lease,{requestId:randomUUID(),outcome:'succeeded',result:'旧资料不算已核对。'},now))).rejects.toMatchObject({code:'AGENT_TASK_READ_REQUIRED'});
 await tx(d=>saveTaskSources(d,actor,run.lease,[],now,{type:'order',id:'another-order'}));expect((await tx(d=>taskRecord(d,workspaceId,taskId))).value.requiredRead).toEqual(conditionTarget);
 await tx(d=>saveTaskSources(d,actor,run.lease,[],now,conditionTarget));
 const replay=await tx(d=>waitTaskUntil(d,service,run.lease,input,now,()=>{throw Error('The old baseline must not be rearmed');}));expect(replay).toMatchObject({state:'running',resumeAt:null,requiredRead:null});
 const ended=await tx(d=>finishTask(d,actor,run.lease,{requestId:randomUUID(),outcome:'succeeded',result:'已重新核对原订单。'},now));expect(ended.state).toBe('succeeded');
});
it('keeps condition and deadline through pause and control rotation, and treats a deadline as a reason to reread rather than a satisfied condition',async()=>{
 const first=await claim(),waiting=await tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),delaySeconds:60,condition:conditionTarget,summary:'等待原订单变化。'},now,preparedCondition));
 const rotated=await tx(d=>issueTaskControl(d,actor,workspaceId,taskId,{requestId:randomUUID(),version:waiting.version},(w,t,g)=>[w,t,g].join('.'),now,[]));expect(rotated.item).toMatchObject({state:'waiting_condition',resumeAt:waiting.resumeAt});
 const paused=await tx(d=>changeTask(d,actor,workspaceId,taskId,'pause',{requestId:randomUUID(),version:rotated.item.version},now,[]));now+=61000;let checks=0;expect((await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>{checks++;return true;}))).state).toBe('paused');
 const resumed=await tx(d=>changeTask(d,actor,workspaceId,taskId,'resume',{requestId:randomUUID(),version:paused.version},now,[]));expect(resumed.resumeAt).toBe(waiting.resumeAt);
 const expiredCondition=await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>{checks++;return true;}));expect(expiredCondition).toMatchObject({state:'queued',wakeReason:'deadline',requiredRead:conditionTarget});expect(checks).toBe(0);
 const hidden=taskView(expiredCondition,{...actor,permissionCeiling:[]},now);expect(hidden.requiredRead).toBeNull();expect(hidden.waitingFor).toBeNull();expect(hidden.wakeReason).toBeUndefined();
});
it('stopping a condition permanently clears its schedule and never calls the business predicate afterward',async()=>{
 const first=await claim(),waiting=await tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),delaySeconds:60,condition:conditionTarget,summary:'等待原订单变化。'},now,preparedCondition));
 const stopped=await tx(d=>changeTask(d,actor,workspaceId,taskId,'cancel',{requestId:randomUUID(),version:waiting.version},now,[]));expect(stopped).toMatchObject({state:'cancelled',waitingFor:null,resumeAt:null});now+=61000;
 expect((await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>{throw Error('Stopped wait must not inspect business');}))).state).toBe('cancelled');await expect(claim()).rejects.toMatchObject({code:'AGENT_TASK_NOT_READY'});
});
it('can return a failed outcome when the changed original cannot be fully reread, without manufacturing a successful business result',async()=>{
 const first=await claim();await tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),delaySeconds:60,condition:conditionTarget,summary:'等待原订单变化。'},now,preparedCondition));now+=30000;await tx(d=>checkTaskCondition(d,actor,workspaceId,taskId,now,()=>true));const run=await claim();
 const failed=await tx(d=>finishTask(d,actor,run.lease,{requestId:randomUUID(),outcome:'failed',result:'原资料无法完整读取，未继续办理。'},now));expect(failed.state).toBe('failed');expect(failed.requiredRead).toEqual(conditionTarget);
});
it.each([
  ['2026-11-30T23:59:00Z', '2026-11-31T00:01:00Z'],
  ['2027-02-28T23:59:00Z', '2027-02-29T00:01:00Z'],
  ['2028-02-29T23:59:00Z', '2028-02-30T00:01:00Z'],
])('rejects an impossible civil date near %s without silently scheduling its normalized successor', async (clock, until) => {
  now = Date.parse(clock);
  const identity = (await tx(d => identityRecord(d, workspaceId, identityId))).value;
  await tx(d => issueServiceKey(d, actor, workspaceId, identityId, { requestId: randomUUID(), version: identity.version }, (_w, _i, g) => 'new-key-' + g, now));
  const created = await tx(d => createTask(d, actor, workspaceId, { requestId: randomUUID(), identityId, name: '约定核对', instructions: '按约定时间核对。' }, now)); taskId = created.id;
  service.agentServiceLease = (await tx(d => taskRecord(d, workspaceId, taskId))).value.authority;
  const first = await claim(), original = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  // These normalize to a valid time inside the task TTL, so the ordinary TTL check cannot catch them.
  expect(Date.parse(until)).toBeGreaterThan(now + 30_000);
  expect(Date.parse(until)).toBeLessThan(original.expiresAt);
  await expect(tx(d => waitTaskUntil(d, service, first.lease, { requestId: randomUUID(), until, summary: '等待约定时间。' }, now))).rejects.toMatchObject({ code: 'INVALID_INPUT', message: '等待时间的日期或时区无效' });
  expect((await tx(d => taskRecord(d, workspaceId, taskId))).value).toEqual(original);
});
it('accepts an explicit offset and rejects invalid clock, offset and conflicting repeated waits', async () => {
  const first = await claim(), original = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  for (const until of ['2026-11-01T24:01:00Z', '2026-11-01T00:61:00Z', '2026-11-01T00:01:60Z', '2026-11-01T08:01:00+24:00', '2026-11-01T08:01:00+08:60']) {
    await expect(tx(d => waitTaskUntil(d, service, first.lease, { requestId: randomUUID(), until, summary: '等待' }, now))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  expect((await tx(d => taskRecord(d, workspaceId, taskId))).value).toEqual(original);
  const requestId = randomUUID(), waiting = await tx(d => waitTaskUntil(d, service, first.lease, { requestId, until: '2026-11-01T08:01:00.123+08:00', summary: '等待约定时间。' }, now));
  expect(waiting.resumeAt).toBe('2026-11-01T00:01:00.123Z');
  now += 60_124; const next = await claim();
  await expect(tx(d => waitTaskUntil(d, service, next.lease, { requestId, until: '2026-11-01T08:02:00+08:00', summary: '等待约定时间。' }, now))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await tx(d => taskRecord(d, workspaceId, taskId))).value.resumeAt).toBeUndefined();
});
it('does not renew authority or the task lifetime when a scheduled wait becomes due', async () => {
  const first = await claim();
  await tx(d => waitTaskUntil(d, service, first.lease, { requestId: randomUUID(), delaySeconds: 60, summary: '等待约定时间。' }, now));
  const waiting = (await tx(d => taskRecord(d, workspaceId, taskId))).value;
  await tx(d => revokeServiceKey(d, actor, workspaceId, identityId, { requestId: randomUUID() }, now));
  now += 60_000; await expect(claim()).rejects.toMatchObject({ code: 'AGENT_KEY_INVALID' });
  expect((await tx(d => taskRecord(d, workspaceId, taskId))).value).toEqual(waiting);
  now = waiting.expiresAt;
  expect(taskView(waiting, actor, now).state).toBe('expired');
});
it('releases a durable timed wait without charging its elapsed wall time or issuing an early lease',async()=>{
 const first=await claim(),original=(await tx(d=>taskRecord(d,workspaceId,taskId))).value;now+=5000;const waiting=await tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),delaySeconds:60,summary:'到约定时间再核对。'},now));expect(waiting.state).toBe('waiting_time');expect(waiting.runtimeUsedMs).toBe(5000);expect(waiting.expiresAt).toBe(new Date(original.expiresAt).toISOString());
 await expect(tx(d=>assertTaskLease(d,service,first.lease,now))).rejects.toMatchObject({code:'AGENT_TASK_LEASE_INVALID'});now+=59000;await expect(claim()).rejects.toMatchObject({code:'AGENT_TASK_NOT_READY'});expect(taskView((await tx(d=>taskRecord(d,workspaceId,taskId))).value,actor,now).runtimeUsedMs).toBe(5000);
 now+=1000;const next=await claim();expect(next.lease.runId).not.toBe(first.lease.runId);expect(next.result.item.state).toBe('running');expect(next.result.item.resumeAt).toBeNull();expect(next.result.item.runtimeUsedMs).toBe(5000);
});
it('retains the original scheduled time across pause, resume and control rotation without reviving a stopped wait',async()=>{
 const first=await claim(),waiting=await tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),delaySeconds:600,summary:'等待约定时间。'},now));
 const paused=await tx(d=>changeTask(d,actor,workspaceId,taskId,'pause',{requestId:randomUUID(),version:waiting.version},now,[]));now+=1000;const resumed=await tx(d=>changeTask(d,actor,workspaceId,taskId,'resume',{requestId:randomUUID(),version:paused.version},now,[]));expect(resumed).toMatchObject({state:'waiting_time',resumeAt:waiting.resumeAt});
 const rotated=await tx(d=>issueTaskControl(d,actor,workspaceId,taskId,{requestId:randomUUID(),version:resumed.version},(w,t,g)=>[w,t,g].join('.'),now,[]));expect(rotated.item).toMatchObject({state:'waiting_time',resumeAt:waiting.resumeAt});await expect(claim()).rejects.toMatchObject({code:'AGENT_TASK_NOT_READY'});
 const stopped=await tx(d=>changeTask(d,actor,workspaceId,taskId,'cancel',{requestId:randomUUID(),version:rotated.item.version},now,[]));expect(stopped.resumeAt).toBeNull();now+=600000;await expect(claim()).rejects.toMatchObject({code:'AGENT_TASK_NOT_READY'});
});
it('validates timed-wait bounds, exact inputs and current authority before changing any registration',async()=>{
 const first=await claim(),original=(await tx(d=>taskRecord(d,workspaceId,taskId))).value;
 for(const time of[{delaySeconds:0},{delaySeconds:1.5},{delaySeconds:86400},{until:'2026-11-01'},{delaySeconds:60,until:new Date(now+60000).toISOString()}])await expect(tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),summary:'等待',...time},now))).rejects.toMatchObject({status:400});
 await expect(tx(d=>waitTaskUntil(d,actor,first.lease,{requestId:randomUUID(),delaySeconds:60,summary:'等待'},now))).rejects.toMatchObject({status:403});await expect(tx(d=>waitTaskUntil(d,{...service,userId:'other'},first.lease,{requestId:randomUUID(),delaySeconds:60,summary:'等待'},now))).rejects.toMatchObject({status:404});expect((await tx(d=>taskRecord(d,workspaceId,taskId))).value).toEqual(original);
 const waiting=await tx(d=>waitTaskUntil(d,service,first.lease,{requestId:randomUUID(),until:new Date(now+60000).toISOString(),summary:'等待原定时间。'},now));expect(waiting.state).toBe('waiting_time');expect(taskView((await tx(d=>taskRecord(d,workspaceId,taskId))).value,{...actor,permissionCeiling:[]},now).resumeAt).toBeNull();
});
it('waits durably for missing facts, fences execution and resumes only after the owner answers',async()=>{
  const {lease}=await claim(),requestId=randomUUID();
  const waiting=await tx(d=>askTaskQuestion(d,service,lease,{requestId,question:'请提供准确工厂交期及依据。'},now));
  expect(waiting.state).toBe('waiting_human');expect(waiting.questions).toHaveLength(1);
  await expect(tx(d=>assertTaskLease(d,actor,lease,now))).rejects.toMatchObject({code:'AGENT_TASK_LEASE_INVALID'});
  const question=waiting.questions![0];expect(question).toMatchObject({question:'请提供准确工厂交期及依据。'});
  const answer={requestId:randomUUID(),version:waiting.version,questionId:question.id,answer:'工厂确认11月25日，按本次书面确认继续核对。'};
  const before=(await tx(d=>taskRecord(d,workspaceId,taskId))).value;
  await expect(tx(d=>answerTaskQuestion(d,{...actor,userId:'other'},workspaceId,taskId,answer,now))).rejects.toMatchObject({status:404});
  await expect(tx(d=>answerTaskQuestion(d,service,workspaceId,taskId,answer,now))).rejects.toMatchObject({status:403});
  const answered=await tx(d=>answerTaskQuestion(d,actor,workspaceId,taskId,answer,now));expect(answered.state).toBe('queued');expect(answered.questions![0].answer).toBe(answer.answer);
  const replay=await tx(d=>answerTaskQuestion(d,actor,workspaceId,taskId,answer,now));expect(replay.questions).toEqual(answered.questions);
  await expect(tx(d=>answerTaskQuestion(d,actor,workspaceId,taskId,{...answer,answer:'改为其他日期'},now))).rejects.toMatchObject({code:'CONFLICT'});
  const after=(await tx(d=>taskRecord(d,workspaceId,taskId))).value;expect(after.stepsUsed).toBe(before.stepsUsed);expect(after.runtimeUsedMs).toBe(before.runtimeUsedMs);expect(after.questions).toHaveLength(1);
  const nextRun=await claim();expect(nextRun.lease.runId).not.toBe(lease.runId);expect(nextRun.result.item.questions![0].answer).toBe(answer.answer);
});
it('keeps a paused question paused after answering and hides questions when authority is lost',async()=>{
  const {lease}=await claim(),waiting=await tx(d=>askTaskQuestion(d,service,lease,{requestId:randomUUID(),question:'请补充报价原件。'},now));
  const paused=await tx(d=>changeTask(d,actor,workspaceId,taskId,'pause',{requestId:randomUUID(),version:waiting.version},now,[]));
  const resumed=await tx(d=>changeTask(d,actor,workspaceId,taskId,'resume',{requestId:randomUUID(),version:paused.version},now,[]));expect(resumed.state).toBe('waiting_human');
  const again=await tx(d=>changeTask(d,actor,workspaceId,taskId,'pause',{requestId:randomUUID(),version:resumed.version},now,[]));
  const answered=await tx(d=>answerTaskQuestion(d,actor,workspaceId,taskId,{requestId:randomUUID(),version:again.version,questionId:waiting.questions![0].id,answer:'原件尚未收到，请继续等待。'},now));expect(answered.state).toBe('paused');
  const c=(await tx(d=>taskRecord(d,workspaceId,taskId))).value;expect(taskView(c,{...actor,permissionCeiling:[]},now).questions).toEqual([]);
});
it('does not accept answers after stop or silently replace a pending question',async()=>{
  const {lease}=await claim(),waiting=await tx(d=>askTaskQuestion(d,service,lease,{requestId:randomUUID(),question:'请确认本次缺少的资料。'},now));
  await expect(tx(d=>askTaskQuestion(d,service,lease,{requestId:randomUUID(),question:'换一个问题'},now))).rejects.toMatchObject({code:'AGENT_TASK_LEASE_INVALID'});
  const stopped=await tx(d=>changeTask(d,actor,workspaceId,taskId,'cancel',{requestId:randomUUID(),version:waiting.version},now,[]));
  await expect(tx(d=>answerTaskQuestion(d,actor,workspaceId,taskId,{requestId:randomUUID(),version:stopped.version,questionId:waiting.questions![0].id,answer:'补充答案'},now))).rejects.toMatchObject({code:'AGENT_TASK_NOT_READY'});
});
it('keeps a missing-facts wait across connection rotation and prevents reclaim before an answer',async()=>{
  const {lease}=await claim(),waiting=await tx(d=>askTaskQuestion(d,service,lease,{requestId:randomUUID(),question:'请补充准确依据。'},now));
  const issued=await tx(d=>issueTaskControl(d,actor,workspaceId,taskId,{requestId:randomUUID(),version:waiting.version},(w,t,g)=>[w,t,g].join('.'),now,[]));
  expect(issued.item.state).toBe('waiting_human');expect(issued.item.questions).toEqual(waiting.questions);await expect(claim()).rejects.toMatchObject({code:'AGENT_TASK_NOT_READY'});
});
it('bounds persistent questions and validates their length without consuming execution on an invalid question',async()=>{
  let run=await claim();await expect(tx(d=>askTaskQuestion(d,service,run.lease,{requestId:randomUUID(),question:'x'.repeat(2001)},now))).rejects.toMatchObject({status:400});
  for(let i=0;i<10;i++){
    const waiting=await tx(d=>askTaskQuestion(d,service,run.lease,{requestId:randomUUID(),question:'缺少依据 '+i},now));
    const q=waiting.questions!.at(-1)!;await tx(d=>answerTaskQuestion(d,actor,workspaceId,taskId,{requestId:randomUUID(),version:waiting.version,questionId:q.id,answer:'继续核对，保留原值。'},now));run=await claim();
  }
  await expect(tx(d=>askTaskQuestion(d,service,run.lease,{requestId:randomUUID(),question:'再次提问'},now))).rejects.toMatchObject({code:'AGENT_TASK_LIMIT'});
  expect((await tx(d=>taskRecord(d,workspaceId,taskId))).value.questions).toHaveLength(10);
});
it('creates an idle task without pretending an executor exists, and never exposes credentials in a view', async () => {
  const c = (await tx(d => taskRecord(d, workspaceId, taskId))).value, view = taskView(c, actor, now);
  expect(view).toMatchObject({ state: 'queued', lastHeartbeatAt: null, stepsUsed: 0 });
  expect(JSON.stringify(view)).not.toMatch(/grantHash|nonce|authority|test-key/);
});
it('normalizes explicit external execution to the legacy create request without changing its identity',async()=>{
 const input={requestId:randomUUID(),identityId,name:'核对资料',instructions:'读取当前授权资料。'},first=await tx(d=>createTask(d,actor,workspaceId,input,now)),replay=await tx(d=>createTask(d,actor,workspaceId,{...input,executor:'external'},now));expect(replay.id).toBe(first.id);expect(replay.executor).toBe('external');
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

it('keeps owner cleanup available without AI but never gives another user the same personal controls',async()=>{
 const c=(await tx(d=>taskRecord(d,workspaceId,taskId))).value,limited={...actor,permissions:[],permissionCeiling:[]},other={...limited,userId:'other'};
 expect(taskView(c,limited,now)).toMatchObject({state:'access_changed',instructions:'',canControl:true});expect(()=>taskView(c,other,now)).toThrow();
 await expect(tx(d=>changeTask(d,other,workspaceId,taskId,'cancel',{requestId:'other-stop',version:c.controlVersion},now,[]))).rejects.toMatchObject({code:'NOT_FOUND'});
 const identity=(await tx(d=>identityRecord(d,workspaceId,identityId))).value;expect(identityView(identity,limited,now)).toMatchObject({canManage:false,canIssue:false,canRevoke:true});expect(identityView(identity,other,now).canRevoke).toBe(false);
 await expect(tx(d=>revokeServiceKey(d,other,workspaceId,identityId,{requestId:'other-revoke'},now))).rejects.toMatchObject({status:403});
 await tx(d=>revokeServiceKey(d,limited,workspaceId,identityId,{requestId:'owner-revoke'},now));expect(identityView((await tx(d=>identityRecord(d,workspaceId,identityId))).value,limited,now).canRevoke).toBe(false);
});
