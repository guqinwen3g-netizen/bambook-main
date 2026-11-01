import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { AgentTaskEvent, AgentTaskQuestion, AgentTaskView } from '../shared/mistAgentTasks';
import { isAgentActor, type AgentActor } from './agentDelegation';
import { identityRecord, assertServiceLease, serviceActorFromIdentity, type AgentServiceLease } from './agentIdentities';
import { fail, MistApiError } from './errors';
import { taskScopeHash, type TaskSourceRef } from './agentTaskVisibility';
import {compactPlatformTaskSteps,newPlatformTaskStep,PLATFORM_TASK_TURN_LIMIT,type PlatformTaskPlan,type PlatformTaskProgress} from './platformTaskPlan';
import{responseLocale,type ResponseLocale}from'./responseLanguage';

export const TASK_PREFIX = 'mist-revision:agent-task:';
export const TASK_HASH = 'mist-agent-task:v1';
export const TASK_FIELD = '__agentTask';
export const TASK_HEADER = 'x-bambook-agent-task';
export const TASK_CONTROL_HEADER = 'x-bambook-task-control';
export const TASK_LEASE_MS = 90_000;
const EVENT_PREFIX = 'mist-revision:agent-task-event:';
const EVENT_HASH = 'mist-agent-task-event:v1';
const STEP_LIMIT = 40;
const RUNTIME_LIMIT = 30 * 60_000;
const TASK_TTL = 24 * 60 * 60_000;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const plain = (v: unknown, max: number, label: string, optional = false) => {
  if (typeof v !== 'string' || (!optional && !v.trim()) || v.length > max || /\u0000/.test(v)) fail('INVALID_INPUT', `${label}无效`, 400);
  return (v as string).trim();
};
const rid = (v: unknown) => plain(v, 116, '操作编号');
const id = (v: unknown) => { if (!uuid(v)) fail('INVALID_INPUT', '任务编号无效', 400); return v as string; };
export type AgentTaskLease = { workspaceId: string; taskId: string; runId: string; grantHash: string; serviceLease: AgentServiceLease };
export type AgentTaskControlLease = { workspaceId:string; taskId:string; hash:string };
export type MakeTaskCredential = (workspaceId: string, taskId: string, runId: string, nonce: string) => string;
export type MakeTaskControl = (workspaceId:string,taskId:string,generation:string)=>string;
export type TaskRecord = {
  schemaVersion: 1; id: string; workspaceId: string; identityId: string; identityName: string; ownerId: string; ownerName: string;
  name: string; instructions: string; state: Exclude<AgentTaskView['state'], 'expired' | 'budget_exhausted' | 'access_changed'>; version: number; controlVersion: number;
  createdAt: string; updatedAt: string; expiresAt: number; authority: AgentServiceLease; ceiling: string[];
  credentialVersion?: string;
  scopeHash: string; sources: TaskSourceRef[];
  mode: 'read'|'operate';
  lastHeartbeatAt?:number;
  control?:{generation:string;hash:string;issuedAt:number};
  stepsUsed: number; runtimeUsedMs: number; checkpoint: string; result: string; waitingProposalIds: string[];
  questions?:AgentTaskQuestion[];
  executor?:'platform';
  locale?:ResponseLocale;
  platform?:PlatformTaskProgress;
  noticeRead?:{key:string;at:string};
  lease?: { id: string; nonce: string; grantHash: string; startedAt: number; expiresAt: number; heartbeatAt: number; sequence: number; claimRequestId: string; workerId: string };
  operations: Array<{ requestId: string; inputHash: string }>;
  lastRequestId: string; lastAction: string; lastInputHash: string;
};
function record(row: any, workspaceId: string): TaskRecord {
  const value = row?.result?.[TASK_FIELD];
  if (!value || row.inputHash !== TASK_HASH || row.workspaceId !== workspaceId || value.workspaceId !== workspaceId || value.schemaVersion !== 1 || row.requestId !== TASK_PREFIX + value.id || row.actorId !== value.ownerId) fail('NOT_FOUND', '任务不存在或无权访问', 404);
  return value;
}
export async function taskRecord(db: any, workspaceId: string, taskId: unknown) {
  const row = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: TASK_PREFIX + id(taskId) } } });
  return { row, value: record(row, workspaceId) };
}
export async function lockTaskRecord(db: any, workspaceId: string, taskId: unknown) {
  await db.$queryRawUnsafe('SELECT "id" FROM "MistCommandReceipt" WHERE "workspaceId" = $1::uuid AND "requestId" = $2 FOR UPDATE', workspaceId, TASK_PREFIX + id(taskId));
}
function owner(actor: TokenPayload, c: TaskRecord) { if (actor.userId !== c.ownerId) fail('NOT_FOUND', '任务不存在或无权访问', 404); }
const usedRuntime = (c: TaskRecord, now: number) => c.runtimeUsedMs + (c.lease ? Math.max(0, Math.min(now, c.lease.expiresAt) - c.lease.startedAt) : 0);
const canReadContents = (c: TaskRecord, actor: TokenPayload) => c.ceiling.every(scope => hasScope(actor, scope as any));
const hasUnansweredQuestion=(c:TaskRecord)=>(c.questions??[]).some(q=>!q.answeredAt);
export function taskView(c: TaskRecord, actor: TokenPayload, now: number, authorityValid = true): AgentTaskView {
  owner(actor, c); const readable = authorityValid && canReadContents(c, actor) && c.credentialVersion === actor.credentialVersion, ended = ['succeeded', 'failed', 'cancelled'].includes(c.state);
  const state = ended ? c.state : !readable ? 'access_changed' : now >= c.expiresAt ? 'expired' : (usedRuntime(c, now) >= RUNTIME_LIMIT || c.stepsUsed >= STEP_LIMIT && (!c.lease||c.lease.expiresAt<=now)) ? 'budget_exhausted' : c.state === 'running' && (!c.lease || c.lease.expiresAt <= now) ? 'queued' : c.state;
  return { id: c.id, identityId: c.identityId, identityName: c.identityName, name: readable ? c.name : 'Agent任务', ownerId: c.ownerId, ownerName: c.ownerName, instructions: readable ? c.instructions : '', mode:c.mode, state, version: c.controlVersion, createdAt: c.createdAt, updatedAt: c.updatedAt, expiresAt: new Date(c.expiresAt).toISOString(), stepsUsed: c.stepsUsed, stepLimit: STEP_LIMIT, runtimeUsedMs: usedRuntime(c, now), runtimeLimitMs: RUNTIME_LIMIT, lastHeartbeatAt: c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt).toISOString() : c.lease ? new Date(c.lease.heartbeatAt).toISOString() : null, checkpoint: readable ? c.checkpoint : '', result: readable ? c.result : '', waitingProposalIds: readable ? c.waitingProposalIds : [], canControl: !ended, executor:c.executor??'external', ...(c.platform?.issue?{executionIssue:{code:c.platform.issue,...(c.platform.retryAt?{retryAt:new Date(c.platform.retryAt).toISOString()}:{} )}}:{}), questions:readable?c.questions??[]:[] };
}
async function save(db: any, row: any, before: TaskRecord, next: TaskRecord) {
  const changed = await db.mistCommandReceipt.updateMany({ where: { id: row.id, workspaceId: before.workspaceId, inputHash: TASK_HASH, result: { path: [TASK_FIELD, 'version'], equals: before.version } }, data: { result: { revision: 0, [TASK_FIELD]: next } } });
  if (changed.count !== 1) fail('AGENT_TASK_CHANGED', '任务已更新，请核对状态', 409);
}
async function event(db: any, c: TaskRecord, actor: TokenPayload, action: string, requestId: string, now: number) {
  const request = EVENT_PREFIX + c.id + ':' + hash(requestId).slice(0, 32);
  if (await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: c.workspaceId, requestId: request } } })) fail('CONFLICT', '操作编号已使用，请核对原结果', 409);
  const value: AgentTaskEvent = { action, at: new Date(now).toISOString(), actorId: actor.userId,actorName:['claimed','checkpoint','waiting_human','question','model_retry','model_paused','recovering','finished'].includes(action)?c.identityName:actor.displayName||'本人', version: c.version, state: c.state };
  await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId: c.workspaceId, requestId: request, actorId: actor.userId, inputHash: EVENT_HASH, expectedRevision: 0, result: { revision: 0, taskId: c.id, event: value, operation: { action, inputHash: c.lastInputHash,...(action==='connected'?{controlGeneration:c.control?.generation}:{}) } }, createdAt: new Date(now) } });
}
function next(c: TaskRecord, now: number, action: string, requestId: string, input: unknown): TaskRecord {
  return { ...c, version: c.version + 1, updatedAt: new Date(now).toISOString(), lastAction: action, lastRequestId: requestId, lastInputHash: hash(JSON.stringify(input)) };
}
function replay(c: TaskRecord, action: string, requestId: string, input: unknown) {
  if (c.lastRequestId !== requestId) return false;
  if (c.lastAction !== action || c.lastInputHash !== hash(JSON.stringify(input))) fail('CONFLICT', '操作编号已用于其他内容', 409);
  return true;
}
export async function createTask(db: any, actor: TokenPayload, workspaceId: string, input: Record<string, unknown>, now: number, scopeHash = taskScopeHash()) {
  if (Object.keys(input).some(k => !['requestId', 'identityId', 'name', 'instructions','executor','locale'].includes(k))||input.executor!==undefined&&!['platform','external'].includes(input.executor as string)||input.locale!==undefined&&input.executor!=='platform') fail('INVALID_INPUT', '任务字段无效', 400);
  const requestId = rid(input.requestId), name = plain(input.name, 60, '任务名称'), instructions = plain(input.instructions, 4000, '任务内容');
  const { value: identity } = await identityRecord(db, workspaceId, id(input.identityId));
  if (identity.ownerId !== actor.userId || !identity.enabled || !identity.key || identity.key.revokedAt || identity.key.expiresAt <= now || identity.key.credentialVersion !== actor.credentialVersion) fail('PRECONDITION', '请先启用本人负责的Agent连接', 422);
  const key = identity.key!, ceiling = key.ceiling.filter(scope => hasScope(actor, scope as any));
  const request = TASK_PREFIX + 'create:' + hash(actor.userId + ':' + requestId).slice(0, 32);
  const previous = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: request } } });
  const locale=input.executor==='platform'?responseLocale(input.locale):undefined,inputHash = hash(JSON.stringify([identity.id, name, instructions,...(input.executor==='platform'?['platform',locale]:[])]));
  if (previous) { if (previous.inputHash !== inputHash) fail('CONFLICT', '操作编号已用于其他任务', 409);const c=(await taskRecord(db, workspaceId, previous.result.id)).value;let valid=c.scopeHash===scopeHash;try{await assertTaskAuthority(db,actor,c,now);}catch(e){if(!(e instanceof MistApiError))throw e;valid=false;}return taskView(c, actor, now,valid); }
  const active = await db.mistCommandReceipt.findMany({ where: { workspaceId, actorId: actor.userId, inputHash: TASK_HASH, AND: [{ OR: ['queued','running','waiting_human','paused'].map(state => ({ result: { path: [TASK_FIELD, 'state'], equals: state } })) }, { result: { path: [TASK_FIELD, 'expiresAt'], gte: now } }] }, take: 10 });
  if (active.length >= 10) fail('AGENT_TASK_LIMIT', '请先结束已有任务', 422);
  const taskId = randomUUID(), at = new Date(now).toISOString();
  const c: TaskRecord = { schemaVersion: 1, id: taskId, workspaceId, identityId: identity.id, identityName: identity.name, ownerId: actor.userId, ownerName: actor.displayName || actor.userId, name, instructions, state: 'queued', version: 1, controlVersion: 1, createdAt: at, updatedAt: at, expiresAt: Math.min(now + TASK_TTL, key.expiresAt), authority: { id: identity.id, workspaceId, hash: key.hash, ownerId: actor.userId, issuedAt: key.issuedAt, expiresAt: key.expiresAt }, ceiling, credentialVersion: actor.credentialVersion, scopeHash, sources: [], mode:key.mode, stepsUsed: 0, runtimeUsedMs: 0, checkpoint: '', result: '', waitingProposalIds: [], operations: [], lastRequestId: requestId, lastAction: 'created', lastInputHash: inputHash };
  if(input.executor==='platform'){c.executor='platform';c.locale=locale;c.platform={steps:[],nextRunAt:0};}
  await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: TASK_PREFIX + taskId, actorId: actor.userId, inputHash: TASK_HASH, expectedRevision: 0, result: { revision: 0, [TASK_FIELD]: c }, createdAt: new Date(now) } });
  await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: request, actorId: actor.userId, inputHash, expectedRevision: 0, result: { revision: 0, id: taskId }, createdAt: new Date(now) } });
  await event(db, c, actor, 'created', requestId, now); return taskView(c, actor, now);
}
export async function assertTaskAuthority(db: any, actor: TokenPayload, c: TaskRecord, now: number) {
  owner(actor, c); await assertServiceLease(db, actor, c.authority, now);
  const identity = (await identityRecord(db, c.workspaceId, c.identityId)).value;
  if (identity.key?.credentialVersion !== actor.credentialVersion) fail('AGENT_TASK_ACCESS_CHANGED', '账号安全授权已变化', 401);
  if (!canReadContents(c, actor)) fail('AGENT_TASK_ACCESS_CHANGED', '任务权限已变化，请重新安排', 403);
}
/** Revoking an executor must not erase its owner's closed-task history. Current scope still gates every view. */
export async function assertTaskViewAuthority(db:any,actor:TokenPayload,c:TaskRecord,now:number){
  owner(actor,c);
  if(!isAgentActor(actor)&&['succeeded','failed','cancelled'].includes(c.state))return;
  await assertTaskAuthority(db,actor,c,now);
}
export async function issueTaskControl(db:any,actor:TokenPayload,workspaceId:string,taskId:string,input:Record<string,unknown>,make:MakeTaskControl,now:number,pendingProposalIds:string[]){
  if(Object.keys(input).some(k=>!['requestId','version'].includes(k))||!Number.isSafeInteger(input.version))fail('INVALID_INPUT','连接请求无效',400);
  const requestId=rid(input.requestId);await lockTaskRecord(db,workspaceId,taskId);const{row,value:c}=await taskRecord(db,workspaceId,taskId);owner(actor,c);await assertTaskAuthority(db,actor,c,now);
  if(c.executor==='platform')fail('FORBIDDEN','平台任务由平台执行，无须外部连接',403);
  if(['succeeded','failed','cancelled'].includes(c.state)||c.expiresAt<=now||usedRuntime(c,now)>=RUNTIME_LIMIT||c.stepsUsed>=STEP_LIMIT)fail('AGENT_TASK_NOT_READY','任务已结束或达到执行限额',409);
  if(await pastOperation(db,c,requestId,'connected',[input.version])&&c.control){const prior=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:EVENT_PREFIX+c.id+':'+hash(requestId).slice(0,32)}}});if(prior?.result?.operation?.controlGeneration!==c.control.generation||now-c.control.issuedAt>5*60_000)fail('AGENT_TASK_CHANGED','连接已更新，请重新连接',409);const token=make(workspaceId,c.id,c.control.generation);if(!equal(hash(token),c.control.hash))fail('AGENT_TASK_CHANGED','签发环境已更新，请重新连接',409);return{item:taskView(c,actor,now),token};}
  if(c.controlVersion!==input.version)fail('AGENT_TASK_CHANGED','任务设置已更新，请核对状态',409);
  const generation=randomUUID(),token=make(workspaceId,c.id,generation),n=next(c,now,'connected',requestId,[input.version]);
  n.controlVersion++;n.runtimeUsedMs=usedRuntime(c,now);n.lease=undefined;n.control={generation,hash:hash(token),issuedAt:now};n.waitingProposalIds=pendingProposalIds;
  if(n.state!=='paused')n.state=pendingProposalIds.length||hasUnansweredQuestion(c)?'waiting_human':'queued';
  await save(db,row,c,n);await event(db,n,actor,'connected',requestId,now);return{item:taskView(n,actor,now),token};
}
export async function assertTaskControl(db:any,actor:TokenPayload,lease:AgentTaskControlLease,now:number){
  const c=(await taskRecord(db,lease.workspaceId,lease.taskId)).value;owner(actor,c);await assertTaskAuthority(db,actor,c,now);
  if(!c.control||!equal(c.control.hash,lease.hash)||['succeeded','failed','cancelled'].includes(c.state)||c.expiresAt<=now)fail('AGENT_TASK_CONTROL_INVALID','任务连接已失效',401);
  return c;
}
export async function resolveTaskControl(db:any,token:unknown,now:number):Promise<AgentActor>{
  if(typeof token!=='string'||token.length>300)fail('AGENT_TASK_CONTROL_INVALID','任务连接凭据无效',401);
  const match=/^bmc1_([0-9a-f-]{36})_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/.exec(token as string);
  if(!match||!match.slice(1,3).every(uuid))fail('AGENT_TASK_CONTROL_INVALID','任务连接凭据无效',401);
  const[,workspaceId,taskId]=match!,c=(await taskRecord(db,workspaceId,taskId)).value;
  if(!c.control||!equal(c.control.hash,hash(token as string))||['succeeded','failed','cancelled'].includes(c.state)||c.expiresAt<=now)fail('AGENT_TASK_CONTROL_INVALID','任务连接已失效',401);
  const identity=(await identityRecord(db,workspaceId,c.identityId)).value;
  if(!identity.enabled||identity.ownerId!==c.ownerId||!identity.key||identity.key.revokedAt||identity.key.expiresAt<=now||!equal(identity.key.hash,c.authority.hash))fail('AGENT_TASK_CONTROL_INVALID','Agent连接已失效',401);
  const raw=serviceActorFromIdentity(identity,c.authority.hash);raw.permissionCeiling=[...c.ceiling];raw.agentTaskControlLease={workspaceId,taskId,hash:hash(token as string)};return raw;
}
export async function claimTask(db: any, actor: AgentActor, workspaceId: string, taskId: string, input: Record<string, unknown>, make: MakeTaskCredential, now: number, pendingProposalIds: string[]) {
  if (Object.keys(input).some(k => !['requestId', 'workerId'].includes(k)) || !actor.agentServiceLease || actor.agentIdentity?.id === undefined) fail('FORBIDDEN', '请使用长期Agent连接领取任务', 403);
  const requestId = rid(input.requestId), workerId = plain(input.workerId, 80, '执行器编号'), { row, value: c } = await taskRecord(db, workspaceId, taskId);
  if((c.executor==='platform')!==(actor.agentExecutor==='platform'))fail('FORBIDDEN','任务执行方式不匹配',403);
  await assertTaskAuthority(db, actor, c, now);
  if (actor.agentIdentity.id !== c.identityId) fail('FORBIDDEN', '任务不属于此Agent', 403);
  if (c.lease && c.lease.expiresAt > now && c.state === 'running') {
    if (c.lease.claimRequestId !== requestId || c.lease.workerId !== workerId) fail('AGENT_TASK_BUSY', '任务已由其他执行器领取', 409);
    const token = make(workspaceId, c.id, c.lease.id, c.lease.nonce);
    if (!equal(hash(token), c.lease.grantHash)) fail('AGENT_TASK_LEASE_INVALID', '执行授权已变化，请等待重新领取', 409);
    return { item: taskView(c, actor, now), token };
  }
  if (c.state !== 'queued' && c.state !== 'running') fail('AGENT_TASK_NOT_READY', '任务当前不能领取', 409);
  if (c.expiresAt <= now || usedRuntime(c, now) >= RUNTIME_LIMIT || c.stepsUsed >= STEP_LIMIT) fail('AGENT_TASK_BUDGET', '任务已达到执行限额', 409);
  const n = next(c, now, 'claimed', requestId, [workerId]); n.runtimeUsedMs = usedRuntime(c, now); n.lease = undefined;
  if (pendingProposalIds.length) { n.state = 'waiting_human'; n.waitingProposalIds = pendingProposalIds; await save(db, row, c, n); await event(db, n, actor, 'waiting_human', requestId, now); return { item: taskView(n, actor, now) }; }
  const runId = randomUUID(), nonce = randomUUID(), token = make(workspaceId, c.id, runId, nonce);
  n.state = 'running'; n.lease = { id: runId, nonce, grantHash: hash(token), startedAt: now, heartbeatAt: now, sequence: 0, expiresAt: Math.min(now + TASK_LEASE_MS, n.expiresAt, now + RUNTIME_LIMIT - n.runtimeUsedMs), claimRequestId: requestId, workerId };
  n.lastHeartbeatAt=now;
  if(n.platform)n.platform={...n.platform,nextRunAt:n.lease!.expiresAt};
  await save(db, row, c, n); await event(db, n, actor, 'claimed', requestId, now); return { item: taskView(n, actor, now), token };
}
export async function assertTaskLease(db: any, actor: TokenPayload, lease: AgentTaskLease, now: number, lock = false) {
  if (lock) await lockTaskRecord(db, lease.workspaceId, lease.taskId);
  const { row, value: c } = await taskRecord(db, lease.workspaceId, lease.taskId); await assertTaskAuthority(db, actor, c, now);
  if (c.state !== 'running' || !c.lease || c.lease.id !== lease.runId || !equal(c.lease.grantHash, lease.grantHash) || c.lease.expiresAt <= now || c.expiresAt <= now || usedRuntime(c, now) >= RUNTIME_LIMIT) fail('AGENT_TASK_LEASE_INVALID', '任务执行已停止或租约已失效', 401);
  return { row, value: c };
}
function platformEffect(c:TaskRecord,requestId:string,result:unknown){
  const pending=c.platform?.steps.at(-1);if(!pending||pending.result!==undefined||![pending.id,'mcp-'+pending.id].includes(requestId))return;
  c.platform={...c.platform!,steps:compactPlatformTaskSteps(c.platform!.steps.map(s=>s.id===pending.id?{...s,result}:s)),nextRunAt:0,issue:undefined,retryAt:undefined,failures:0};
}
export type PlatformTaskJob={workspaceId:string;taskId:string;ownerId:string;version:number};
/** Metadata-only scheduler scan; task contents are not released before fresh owner/scope checks. */
export async function duePlatformTasks(db:any,now:number,take=2):Promise<PlatformTaskJob[]>{
  const rows=await db.mistCommandReceipt.findMany({where:{inputHash:TASK_HASH,requestId:{startsWith:TASK_PREFIX},AND:[{result:{path:[TASK_FIELD,'executor'],equals:'platform'}},{OR:['queued','running'].map(state=>({result:{path:[TASK_FIELD,'state'],equals:state}}))},{result:{path:[TASK_FIELD,'expiresAt'],gte:now+1}},{result:{path:[TASK_FIELD,'stepsUsed'],lte:STEP_LIMIT-1}},{result:{path:[TASK_FIELD,'platform','nextRunAt'],lte:now}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take});
  return rows.flatMap((row:any)=>{let c:TaskRecord;try{c=record(row,row.workspaceId);}catch{return[];}if(c.executor!=='platform'||!c.platform||!Array.isArray(c.platform.steps)||usedRuntime(c,now)>=RUNTIME_LIMIT)return[];return[{workspaceId:c.workspaceId,taskId:c.id,ownerId:c.ownerId,version:c.version}];});
}
export async function savePlatformPlan(db:any,actor:AgentActor,lease:AgentTaskLease,plan:PlatformTaskPlan,now:number){
  await lockTaskRecord(db,lease.workspaceId,lease.taskId);const{row,value:c}=await assertTaskLease(db,actor,lease,now);
  if(c.executor!=='platform'||actor.agentExecutor!=='platform'||!c.platform)fail('FORBIDDEN','请使用平台任务执行器',403);
  const pending=c.platform.steps.at(-1);if(pending?.result===undefined&&pending)return pending;
  if(c.platform.steps.length>=PLATFORM_TASK_TURN_LIMIT)fail('AGENT_TASK_BUDGET','任务已达到模型轮次上限',409);
  const step=newPlatformTaskStep(plan,now),n={...next(c,now,'model_plan','plan-'+step.id,plan),platform:{...c.platform,steps:[...c.platform.steps,step],issue:undefined,retryAt:undefined,failures:0,checkpointBeforeIssue:undefined}};
  if(c.platform.checkpointBeforeIssue!==undefined)n.checkpoint=c.platform.checkpointBeforeIssue;
  await save(db,row,c,n);return step;
}
export async function acknowledgePlatformStep(db:any,actor:AgentActor,lease:AgentTaskLease,stepId:string,result:unknown,now:number){
  await lockTaskRecord(db,lease.workspaceId,lease.taskId);const{row,value:c}=await assertTaskLease(db,actor,lease,now);
  if(c.executor!=='platform'||actor.agentExecutor!=='platform'||!c.platform)fail('FORBIDDEN','请使用平台任务执行器',403);
  const step=c.platform.steps.at(-1);if(!step||step.id!==stepId)fail('AGENT_TASK_CHANGED','执行步骤已变化',409);if(step.result!==undefined)return;
  const n={...next(c,now,'model_step','ack-'+stepId,[result]),platform:{...c.platform,steps:compactPlatformTaskSteps(c.platform.steps.map(s=>s.id===stepId?{...s,result}:s)),failures:0,issue:undefined,retryAt:undefined,checkpointBeforeIssue:undefined}};
  if(c.platform.checkpointBeforeIssue!==undefined)n.checkpoint=c.platform.checkpointBeforeIssue;
  const data=result as any;if(['bambook_get','bambook_query','bambook_related','bambook_audit','bambook_mail_receiving'].includes(step.plan.name)&&!data?.error&&!data?.truncated)n.platform.requiresRead=false;
  await save(db,row,c,n);
}
/** Release only this completed local runner; human stop/pause or a revoked grant always wins. */
export async function releasePlatformTask(db:any,actor:AgentActor,lease:AgentTaskLease,issue:'model_unavailable'|'model_response_invalid'|undefined,now:number){
  await lockTaskRecord(db,lease.workspaceId,lease.taskId);const{row,value:c}=await assertTaskLease(db,actor,lease,now);
  if(c.executor!=='platform'||actor.agentExecutor!=='platform'||!c.platform)fail('FORBIDDEN','请使用平台任务执行器',403);
  const failures=issue?(c.platform.failures??0)+1:c.platform.failures??0,retryAt=now+(issue?Math.min(300_000,10_000*2**Math.min(failures,5)):1000),paused=!!issue&&failures>=3;
  const requestId=randomUUID(),action=issue?(paused?'model_paused':'model_retry'):'recovering',n={...next(c,now,action,requestId,[issue??'interrupted']),state:paused?'paused' as const:'queued' as const,controlVersion:c.controlVersion+(paused?1:0),runtimeUsedMs:usedRuntime(c,now),lease:undefined,platform:{...c.platform,nextRunAt:retryAt,retryAt:issue&&!paused?retryAt:undefined,issue,failures}};
  if(issue)n.checkpoint=(issue==='model_response_invalid'?'模型响应无效':'模型暂不可用')+(paused?'，任务已暂停；恢复后可从原步骤继续。':'，稍后核对原步骤重试。');
  if(issue)n.platform.checkpointBeforeIssue=c.platform.checkpointBeforeIssue??c.checkpoint;
  await save(db,row,c,n);await event(db,n,actor,action,requestId,now);
}
/** An unavailable owner may defer metadata, never authorize or revive execution. */
export async function deferPlatformJob(db:any,job:PlatformTaskJob,now:number){
  await lockTaskRecord(db,job.workspaceId,job.taskId);const{row,value:c}=await taskRecord(db,job.workspaceId,job.taskId);
  if(c.executor!=='platform'||!c.platform||c.ownerId!==job.ownerId||c.version!==job.version||!['queued','running'].includes(c.state))return;
  await save(db,row,c,{...c,version:c.version+1,platform:{...c.platform,nextRunAt:now+300_000}});
}
async function pastOperation(db: any, c: TaskRecord, requestId: string, action: string, input: unknown) {
  if (replay(c, action, requestId, input)) return true;
  const row = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: c.workspaceId, requestId: EVENT_PREFIX + c.id + ':' + hash(requestId).slice(0, 32) } } });
  if (!row) return false;
  if (row.inputHash !== EVENT_HASH || row.result.operation?.action !== action || row.result.operation?.inputHash !== hash(JSON.stringify(input))) fail('CONFLICT', '操作编号已用于其他内容', 409);
  return true;
}
/** A monotonic heartbeat never revives a previous execution or replays an older renewal. */
export async function heartbeatTask(db: any, actor: TokenPayload, lease: AgentTaskLease, sequence: unknown, now: number) {
  if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) fail('INVALID_INPUT', '心跳编号无效', 400);
  const { row, value: c } = await assertTaskLease(db, actor, lease, now);
  if (Number(sequence) < c.lease!.sequence) fail('AGENT_TASK_CHANGED', '旧心跳已失效', 409);
  if (Number(sequence) === c.lease!.sequence) return taskView(c, actor, now);
  const n = { ...c, version: c.version + 1, lastHeartbeatAt:now,updatedAt: new Date(now).toISOString(), lease: { ...c.lease!, sequence: Number(sequence), heartbeatAt: now, expiresAt: Math.min(now + TASK_LEASE_MS, c.expiresAt, c.lease!.startedAt + RUNTIME_LIMIT - c.runtimeUsedMs) } };
  if(n.platform)n.platform={...n.platform,nextRunAt:n.lease.expiresAt};
  await save(db, row, c, n); return taskView(n, actor, now);
}
export async function checkpointTask(db: any, actor: TokenPayload, lease: AgentTaskLease, input: Record<string, unknown>, now: number) {
  if (Object.keys(input).some(k => !['requestId', 'summary'].includes(k))) fail('INVALID_INPUT', '检查点字段无效', 400);
  const requestId = rid(input.requestId), summary = plain(input.summary, 4000, '检查点');
  const { row, value: c } = await assertTaskLease(db, actor, lease, now);
  if (await pastOperation(db, c, requestId, 'checkpoint', [summary])) return taskView(c, actor, now);
  const n = next(c, now, 'checkpoint', requestId, [summary]); n.checkpoint = summary;
  await save(db, row, c, n); await event(db, n, actor, 'checkpoint', requestId, now); return taskView(n, actor, now);
}
/** Reserve attempts before the business transaction. Failed commands still consume a bounded step. */
export async function reserveTaskStep(db: any, actor: TokenPayload, lease: AgentTaskLease, requestId: string, intentHash: string, now: number) {
  rid(requestId); const { row, value: c } = await assertTaskLease(db, actor, lease, now), prior = c.operations.find(p => p.requestId === requestId);
  if (prior) { if (prior.inputHash !== intentHash) fail('REQUEST_CONFLICT', '任务操作编号已用于其他内容', 409); return false; }
  if (c.stepsUsed >= STEP_LIMIT) fail('AGENT_TASK_BUDGET', '任务已达到操作上限', 409);
  const n = { ...c, version: c.version + 1, stepsUsed: c.stepsUsed + 1, updatedAt: new Date(now).toISOString(), operations: [...c.operations, { requestId, inputHash: intentHash }] };
  await save(db, row, c, n); return true;
}
export async function changeTask(db: any, actor: TokenPayload, workspaceId: string, taskId: string, action: 'pause' | 'resume' | 'cancel', input: Record<string, unknown>, now: number, pendingProposalIds: string[]) {
  if (Object.keys(input).some(k => !['requestId', 'version'].includes(k)) || !Number.isSafeInteger(input.version)) fail('INVALID_INPUT', '任务操作无效', 400);
  const requestId = rid(input.requestId); await lockTaskRecord(db, workspaceId, taskId); const { row, value: c } = await taskRecord(db, workspaceId, taskId); owner(actor, c);
  const values = [input.version]; if (await pastOperation(db, c, requestId, action, values)) return taskView(c, actor, now);
  if (c.controlVersion !== input.version) fail('AGENT_TASK_CHANGED', '任务设置已更新，请核对状态', 409);
  if (['succeeded','failed','cancelled'].includes(c.state)) fail('AGENT_TASK_NOT_READY', '任务已结束', 409);
  if (action === 'resume') { await assertTaskAuthority(db, actor, c, now); if (c.expiresAt <= now || c.stepsUsed >= STEP_LIMIT || usedRuntime(c, now) >= RUNTIME_LIMIT) fail('AGENT_TASK_BUDGET', '任务已达到执行限额', 409); }
  const n = next(c, now, action, requestId, values); n.controlVersion++; n.runtimeUsedMs = usedRuntime(c, now); n.lease = undefined;
  n.state = action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : pendingProposalIds.length||hasUnansweredQuestion(c) ? 'waiting_human' : 'queued';
  n.waitingProposalIds = action === 'cancel' ? [] : pendingProposalIds;
  if(n.platform){if(n.platform.checkpointBeforeIssue!==undefined)n.checkpoint=n.platform.checkpointBeforeIssue;n.platform={...n.platform,nextRunAt:0,retryAt:undefined,issue:undefined,checkpointBeforeIssue:undefined};}
  await save(db, row, c, n); await event(db, n, actor, action, requestId, now); return taskView(n, actor, now);
}
/** Missing facts suspend the same durable task; an answer is data, never business approval. */
export async function askTaskQuestion(db:any,actor:TokenPayload,lease:AgentTaskLease,input:Record<string,unknown>,now:number){
  if(Object.keys(input).some(k=>!['requestId','question'].includes(k)))fail('INVALID_INPUT','提问字段无效',400);
  const requestId=rid(input.requestId),question=plain(input.question,2000,'需要补充的资料');
  await lockTaskRecord(db,lease.workspaceId,lease.taskId);
  const {row,value:c}=await assertTaskLease(db,actor,lease,now);
  if((c.questions??[]).length>=10)fail('AGENT_TASK_LIMIT','任务提问已达上限，请结束后重新安排',422);
  const n=next(c,now,'question',requestId,[question]);n.controlVersion++;n.state='waiting_human';n.runtimeUsedMs=usedRuntime(c,now);n.lease=undefined;
  n.questions=[...(c.questions??[]),{id:randomUUID(),question,askedAt:new Date(now).toISOString()}];n.checkpoint='等待本人补充资料。';
  platformEffect(n,requestId,{status:'waiting_human',questionId:n.questions.at(-1)!.id});
  await save(db,row,c,n);await event(db,n,actor,'question',requestId,now);return taskView(n,actor,now);
}
export async function answerTaskQuestion(db:any,actor:TokenPayload,workspaceId:string,taskId:string,input:Record<string,unknown>,now:number){
  if(isAgentActor(actor))fail('FORBIDDEN','资料须由本人补充',403);
  if(Object.keys(input).some(k=>!['requestId','version','questionId','answer'].includes(k))||!Number.isSafeInteger(input.version))fail('INVALID_INPUT','补充资料请求无效',400);
  const requestId=rid(input.requestId),questionId=id(input.questionId),answer=plain(input.answer,4000,'补充资料');
  await lockTaskRecord(db,workspaceId,taskId);const{row,value:c}=await taskRecord(db,workspaceId,taskId);owner(actor,c);await assertTaskAuthority(db,actor,c,now);
  const values=[input.version,questionId,answer];if(await pastOperation(db,c,requestId,'answered',values))return taskView(c,actor,now);
  if(c.controlVersion!==input.version)fail('AGENT_TASK_CHANGED','任务设置已更新，请核对状态',409);
  if(!['waiting_human','paused'].includes(c.state))fail('AGENT_TASK_NOT_READY','任务当前不等待补充资料',409);
  if(c.expiresAt<=now||c.stepsUsed>=STEP_LIMIT||usedRuntime(c,now)>=RUNTIME_LIMIT)fail('AGENT_TASK_BUDGET','任务已达到执行限额',409);
  const question=c.questions?.find(q=>q.id===questionId&&!q.answeredAt);if(!question)fail('AGENT_TASK_CHANGED','问题已处理，请刷新核对',409);
  const n=next(c,now,'answered',requestId,values);n.controlVersion++;n.lease=undefined;n.questions=c.questions!.map(q=>q.id===questionId?{...q,answer,answeredAt:new Date(now).toISOString()}:q);
  n.state=c.state==='paused'?'paused':n.waitingProposalIds.length||hasUnansweredQuestion(n)?'waiting_human':'queued';n.checkpoint='本人已补充资料；续办前核对原问题与答案。';
  if(n.platform)n.platform={...n.platform,nextRunAt:0,requiresRead:true};
  await save(db,row,c,n);await event(db,n,actor,'answered',requestId,now);return taskView(n,actor,now);
}
/** In the SAME transaction as proposal creation: a model cannot continue after requesting approval. */
export async function waitTaskForProposal(db: any, actor: TokenPayload, lease: AgentTaskLease, proposalId: string, requestId: string, now: number) {
  const { row, value: c } = await assertTaskLease(db, actor, lease, now), n = next(c, now, 'waiting_human', requestId, [proposalId]);
  n.state = 'waiting_human'; n.runtimeUsedMs = usedRuntime(c, now); n.lease = undefined; n.waitingProposalIds = [proposalId];
  platformEffect(n,requestId,{status:'awaiting_confirmation',proposalId});
  await save(db, row, c, n); await event(db, n, actor, 'waiting_human', requestId, now);
}
/** Human confirmation/rejection is independent of the old executor lease and never revives it. */
export async function settleTaskProposal(db: any, actor: TokenPayload, workspaceId: string, taskId: string, proposalId: string, requestId: string, outcome: 'confirmed' | 'rejected', now: number) {
  const { row, value: c } = await taskRecord(db, workspaceId, taskId); owner(actor, c);
  if(outcome==='rejected'&&!c.waitingProposalIds.includes(proposalId))return;
  if (!['running','waiting_human','paused'].includes(c.state)) fail('AGENT_TASK_NOT_READY', '所属任务已停止，不能继续执行', 409);
  if (outcome === 'confirmed') await assertTaskAuthority(db, actor, c, now);
  if ((outcome === 'confirmed' && c.expiresAt <= now) || !c.waitingProposalIds.includes(proposalId)) fail('AGENT_TASK_NOT_READY', '所属任务或提议已失效', 409);
  const n = next(c, now, outcome, requestId, [proposalId]); n.waitingProposalIds = c.waitingProposalIds.filter(p => p !== proposalId); n.lease = undefined;
  if (c.state !== 'paused') n.state = n.waitingProposalIds.length||hasUnansweredQuestion(c) ? 'waiting_human' : 'queued';
  n.checkpoint = outcome === 'confirmed' ? '本人已确认上一步提议；续办前核对业务结果。' : '本人已拒绝上一步提议；续办前查看拒绝原因。';
  if(n.platform)n.platform={...n.platform,nextRunAt:0,requiresRead:true};
  await save(db, row, c, n); await event(db, n, actor, outcome, requestId, now);
}
export async function assertHumanTaskProposal(db: any, actor: TokenPayload, workspaceId: string, taskId: string, proposalId: string, now: number) {
  await lockTaskRecord(db, workspaceId, taskId);
  const c = (await taskRecord(db, workspaceId, taskId)).value; owner(actor, c); await assertTaskAuthority(db, actor, c, now);
  if (!['waiting_human','paused'].includes(c.state) || c.expiresAt <= now || !c.waitingProposalIds.includes(proposalId)) fail('AGENT_TASK_NOT_READY', '所属任务或提议已停止', 409);
}
export async function finishTask(db: any, actor: TokenPayload, lease: AgentTaskLease, input: Record<string, unknown>, now: number) {
  if (Object.keys(input).some(k => !['requestId','result','outcome'].includes(k)) || !['succeeded','failed'].includes(String(input.outcome))) fail('INVALID_INPUT', '任务结果无效', 400);
  const requestId = rid(input.requestId), result = plain(input.result, 4000, '执行结果');
  const { row, value: c } = await assertTaskLease(db, actor, lease, now);
  if (await pastOperation(db, c, requestId, 'finished', [input.outcome,result])) return taskView(c, actor, now);
  if (c.waitingProposalIds.length) fail('AGENT_TASK_NOT_READY', '请先处理待确认提议', 409);
  const n = next(c, now, 'finished', requestId, [input.outcome,result]); n.state = input.outcome as 'succeeded'|'failed'; n.result = result; n.runtimeUsedMs = usedRuntime(c, now); n.lease = undefined;platformEffect(n,requestId,{status:'finished',outcome:input.outcome});
  await save(db, row, c, n); await event(db, n, actor, 'finished', requestId, now); return taskView(n, actor, now);
}
export async function finishTaskSession(db:any,actor:TokenPayload,control:AgentTaskControlLease,workerId:string,input:Record<string,unknown>,now:number){
  if(Object.keys(input).some(k=>!['requestId','result','outcome'].includes(k))||!['succeeded','failed'].includes(String(input.outcome)))fail('INVALID_INPUT','任务结果无效',400);
  const requestId=rid(input.requestId),result=plain(input.result,4000,'执行结果');await lockTaskRecord(db,control.workspaceId,control.taskId);const{row,value:c}=await taskRecord(db,control.workspaceId,control.taskId);await assertTaskControl(db,actor,control,now);
  if(c.state==='paused'||c.state==='waiting_human'||c.waitingProposalIds.length)fail('AGENT_TASK_NOT_READY','任务已暂停或等待本人确认',409);
  if(c.lease&&c.lease.expiresAt>now&&c.lease.workerId!==workerId)fail('AGENT_TASK_BUSY','任务已由其他执行器领取',409);
  const n=next(c,now,'finished',requestId,[input.outcome,result]);n.state=input.outcome as 'succeeded'|'failed';n.result=result;n.runtimeUsedMs=usedRuntime(c,now);n.lease=undefined;platformEffect(n,requestId,{status:'finished',outcome:input.outcome});
  await save(db,row,c,n);await event(db,n,actor,'finished',requestId,now);return taskView(n,actor,now);
}
export async function resolveTaskCredential(db: any, token: unknown, now: number): Promise<AgentActor> {
  if (typeof token !== 'string' || token.length > 300) fail('AGENT_TASK_LEASE_INVALID', '任务执行凭据无效', 401);
  const match = /^bmt1_([0-9a-f-]{36})_([0-9a-f-]{36})_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/.exec(token as string);
  if (!match || !match.slice(1,4).every(uuid)) fail('AGENT_TASK_LEASE_INVALID', '任务执行凭据无效', 401);
  const [, workspaceId, taskId, runId] = match!, c = (await taskRecord(db, workspaceId, taskId)).value;
  if (!c.lease || c.state !== 'running' || c.lease.id !== runId || c.lease.expiresAt <= now || !equal(c.lease.grantHash, hash(token as string))) fail('AGENT_TASK_LEASE_INVALID', '任务执行已停止或租约已失效', 401);
  const identity = (await identityRecord(db, workspaceId, c.identityId)).value;
  if (!identity.enabled || identity.ownerId !== c.ownerId || !identity.key || identity.key.revokedAt || identity.key.expiresAt <= now || !equal(identity.key.hash, c.authority.hash)) fail('AGENT_TASK_LEASE_INVALID', 'Agent连接已失效', 401);
  const raw = serviceActorFromIdentity(identity, c.authority.hash);
  raw.permissionCeiling = [...c.ceiling]; raw.agentTaskLease = { workspaceId, taskId, runId, grantHash: hash(token as string), serviceLease: c.authority };
  return raw;
}
export async function listTasks(db: any, actor: TokenPayload, workspaceId: string, cursor: unknown, now: number, sourcesVisible: (c:TaskRecord)=>boolean = ()=>true) {
  const where: any = { workspaceId, actorId: actor.userId, inputHash: TASK_HASH };
  if ((actor as AgentActor).agentIdentity) where.AND = [{ result: { path: [TASK_FIELD, 'identityId'], equals: (actor as AgentActor).agentIdentity!.id } }];
  if (cursor !== undefined) {
    let value: any;
    try { if (typeof cursor !== 'string' || cursor.length > 300) throw Error(); value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { fail('INVALID_INPUT', '翻页位置无效', 400); }
    if (!uuid(value?.id) || typeof value?.at !== 'string' || !Number.isFinite(Date.parse(value.at))) fail('INVALID_INPUT', '翻页位置无效', 400);
    where.OR = [{ createdAt: { lt: new Date(value.at) } }, { createdAt: new Date(value.at), id: { lt: value.id } }];
  }
  const rows = await db.mistCommandReceipt.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31 }), page = rows.slice(0,30), last = page.at(-1);
  const items: AgentTaskView[] = [];
  for (const row of page) {
    const c = record(row, workspaceId); let valid = true;
    try { await assertTaskViewAuthority(db, actor, c, now); } catch (e) { if (!(e instanceof MistApiError)) throw e; valid = false; }
    items.push(taskView(c, actor, now, valid&&sourcesVisible(c)));
  }
  return { items, nextCursor: rows.length > 30 && last ? Buffer.from(JSON.stringify({ at: new Date(last.createdAt).toISOString(), id: last.id })).toString('base64url') : null };
}
export async function saveTaskSources(db: any, actor: TokenPayload, lease: AgentTaskLease, sources: TaskSourceRef[], now: number) {
  const {row,value:c}=await assertTaskLease(db,actor,lease,now);
  if(JSON.stringify(c.sources)===JSON.stringify(sources))return;
  await save(db,row,c,{...c,version:c.version+1,sources});
}
export async function advanceTaskSources(db:any,actor:TokenPayload,workspaceId:string,taskId:string,keys:string[][]|null,revision:number){
  if(!keys)return;const{row,value:c}=await taskRecord(db,workspaceId,taskId);owner(actor,c);let changed=false;
  const sources=c.sources.map(ref=>{if(ref.observedRevision===undefined)return ref;const prefix=ref.path.split('.').map(k=>'k:'+k);const touched=keys.filter(key=>prefix.every((p,i)=>key[i]===p)&&(key.length<=prefix.length||key[prefix.length]==='i:'+ref.id));if(!touched.length)return ref;changed=true;if(ref.path==='email.messages'){const fields={...ref.fieldRevisions};for(const key of touched){const field=key[prefix.length+1];if(field?.startsWith('k:'))fields[field.slice(2)]=revision;}return{...ref,fieldRevisions:fields};}return{...ref,observedRevision:revision};});
  if(changed)await save(db,row,c,{...c,version:c.version+1,sources});
}
export function readTaskRecord(row:any,workspaceId:string){return record(row,workspaceId);}
/** Reading a personal reminder changes neither the business state nor the task control version. */
export async function markTaskNoticeRead(db:any,actor:TokenPayload,workspaceId:string,taskId:string,key:string,version:number,now:number){
  if(isAgentActor(actor))fail('FORBIDDEN','提醒只供本人管理',403);
  const{row,value:c}=await taskRecord(db,workspaceId,taskId);owner(actor,c);
  if(c.version!==version)fail('AGENT_TASK_CHANGED','任务已更新，请刷新核对',409);
  if(!/^[a-f0-9]{64}$/.test(key))fail('INVALID_INPUT','提醒编号无效',400);
  if(c.noticeRead?.key===key)return;
  await save(db,row,c,{...c,version:c.version+1,noticeRead:{key,at:new Date(now).toISOString()}});
}
export async function taskHistory(db:any,actor:TokenPayload,workspaceId:string,taskId:string,cursor:unknown){
  const c=(await taskRecord(db,workspaceId,taskId)).value;owner(actor,c);
  const where:any={workspaceId,actorId:c.ownerId,inputHash:EVENT_HASH,requestId:{startsWith:EVENT_PREFIX+c.id+':'}};
  if(cursor!==undefined){let value:any;try{if(typeof cursor!=='string'||cursor.length>300)throw Error();value=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{fail('INVALID_INPUT','翻页位置无效',400);}if(!uuid(value?.id)||typeof value?.at!=='string'||!Number.isFinite(Date.parse(value.at)))fail('INVALID_INPUT','翻页位置无效',400);where.OR=[{createdAt:{lt:new Date(value.at)}},{createdAt:new Date(value.at),id:{lt:value.id}}];}
  const rows=await db.mistCommandReceipt.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:31}),page=rows.slice(0,30),last=page.at(-1);
  return {items:page.map((row:any)=>row.result.event as AgentTaskEvent),nextCursor:rows.length>30&&last?Buffer.from(JSON.stringify({at:new Date(last.createdAt).toISOString(),id:last.id})).toString('base64url'):null};
}
