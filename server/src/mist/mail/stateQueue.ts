import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { TokenPayload } from '../../auth/service';
import { hasScope } from '../../auth/permissionService';
import type { MistState } from '../../shared/mistWorkspace';
import type { MailRemoteRef, MailStateField, MailStateObservation, MailStateView } from '../../shared/mistMailState';
import type { EmailMessageFolder } from '../../shared/mistEmail';
import { fail } from '../errors';
import { receiveSource } from './receiverRegistry';

export const MAIL_STATE_PREFIX = 'mist-revision:mail-state:';
export const MAIL_STATE_HASH = 'mist-mail-state:v1';
export const MAIL_STATE_FIELD = '__mailState';
export type MailStateOperation = { kind: 'flag'; flag: 'read' | 'starred'; value: boolean } | { kind: 'move'; folder: EmailMessageFolder };
export type MailStateAttempt = { id: string; origin: MailRemoteRef; target?: { path: string; folder: EmailMessageFolder; uidValidity: number; uidNext: number }; messageId: string; hash?: string; issued: boolean; confirmedNotApplied?: boolean; result?: MailStateObservation };
export type MailStateRecord = {
  schemaVersion: 1; id: string; workspaceId: string; accountId: string; messageId: string; source: number; sourceHash: string;
  initiatorId: string; authority: TokenPayload; authorizedAt: number; operation: MailStateOperation;
  phase: 'pending' | 'running' | 'failed' | 'unknown' | 'blocked' | 'done' | 'superseded';
  version: number; createdAt: string; nextRunAt: number; failures: number; error?: string;
  leaseId?: string; attempt?: MailStateAttempt; acceptRemote?: boolean; retries?: Array<{ actorId: string; at: number }>;
};
export const mailStateField = (r: MailStateRecord): MailStateField => r.operation.kind === 'move' ? 'folder' : r.operation.flag;
const active = (r: MailStateRecord) => !['done', 'superseded'].includes(r.phase);
const authority = (actor: TokenPayload, prior: TokenPayload) => {
  // No bearer token or role cache is saved. Current role/account/company and delegated lease
  // are rechecked before network access and publication, with a mail-only issuance ceiling.
  const out: any = { userId: actor.userId, ...(actor.companyId ? { companyId: actor.companyId } : {}),
    ...((prior as any).iat !== undefined ? { iat: (prior as any).iat } : {}),
    ...(actor.credentialVersion ? { credentialVersion: actor.credentialVersion } : {}),
    permissionCeiling: ['emails:read', 'emails:write'].filter(p => hasScope(actor, p as any)) };
  for (const k of ['actorKind', 'agentSessionId', 'agentMode', 'agentWorkspaceId', 'agentLease', 'agentServiceLease', 'agentIdentity', 'agentTaskLease', 'agentTaskOperation']) if ((prior as any)[k] !== undefined) out[k] = structuredClone((prior as any)[k]);
  return out as TokenPayload;
};
function value(row: any): MailStateRecord {
  const r = row?.result?.[MAIL_STATE_FIELD];
  if (!r || row.inputHash !== MAIL_STATE_HASH || r.schemaVersion !== 1 || r.workspaceId !== row.workspaceId || row.requestId !== MAIL_STATE_PREFIX + r.id || row.actorId !== r.initiatorId || !Number.isSafeInteger(r.version)) fail('MAIL_STATE_INVALID', '邮件同步登记无效', 409);
  return r;
}
export async function readMailState(db: any, workspaceId: string, id: string) {
  const row = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: MAIL_STATE_PREFIX + id } } });
  if (!row) fail('NOT_FOUND', '邮件同步操作不存在', 404);
  return { row, record: value(row) };
}
async function save(db: any, row: any, r: MailStateRecord, patch: Partial<MailStateRecord>) {
  const next = { ...r, ...patch, version: r.version + 1 };
  const update = await db.mistCommandReceipt.updateMany({ where: { id: row.id, workspaceId: r.workspaceId, inputHash: MAIL_STATE_HASH, result: { path: [MAIL_STATE_FIELD, 'version'], equals: r.version } }, data: { result: { revision: 0, [MAIL_STATE_FIELD]: next } } });
  if (update.count !== 1) fail('MAIL_STATE_CHANGED', '邮件同步状态已变化，请重试', 409);
  return next;
}
export async function mailStateRecords(db: any, workspaceId: string): Promise<MailStateRecord[]> {
  const rows = await db.mistCommandReceipt.findMany({ where: { workspaceId, inputHash: MAIL_STATE_HASH, requestId: { startsWith: MAIL_STATE_PREFIX }, OR: ['pending','running','failed','unknown','blocked'].map(phase=>({result:{path:[MAIL_STATE_FIELD,'phase'],equals:phase}})) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map(value).filter(active);
}
export async function taskHasPendingMail(db:any,workspaceId:string,taskId:string){
  const rows=await db.mistCommandReceipt.findMany({where:{workspaceId,inputHash:MAIL_STATE_HASH,AND:[{result:{path:[MAIL_STATE_FIELD,'authority','agentTaskLease','taskId'],equals:taskId}},{OR:['pending','running','failed','unknown','blocked'].map(phase=>({result:{path:[MAIL_STATE_FIELD,'phase'],equals:phase}}))}]},take:1});return rows.length>0;
}
export async function pendingMailFields(db: any, workspaceId: string, exclude?: string) {
  const out: Record<string, MailStateField[]> = {};
  for (const r of await mailStateRecords(db, workspaceId)) if (r.id !== exclude) {
    const fields = out[r.messageId] || (out[r.messageId] = []), field = mailStateField(r);
    if (!fields.includes(field)) fields.push(field);
  }
  return out;
}
export async function enqueueMailState(db: any, workspace: { id: string; state: MistState }, after: MistState, command: any, actor: TokenPayload, prior: TokenPayload, now: number) {
  if (!['email.flag', 'email.move', 'email.state.retry'].includes(command?.type)) return false;
  const m = after.email.messages.find(m => m.id === command.payload.id), a = m && after.email.accounts.find(a => a.id === m.accountId);
  if (!m || !a || m.example || a.example || !m.remote) return false;
  const records = await mailStateRecords(db, workspace.id);
  const rows = records.filter(r => r.messageId === m.id);
  if (command.type === 'email.state.retry') {
    const retry = rows.find(r=>r.phase==='unknown') || rows.find(r=>r.phase==='blocked') || rows.find(r=>r.phase==='failed'||r.phase==='pending'&&r.error);
    if (!retry) return false;
    if ((m.source || 1) !== (a.sourceGeneration || 1) || receiveSource(a) !== retry.sourceHash) fail('MAIL_SOURCE_CHANGED', '这是旧来源邮件，请在原邮箱处理', 409);
    if (!a.credentialSet) fail('MAIL_CREDENTIAL_MISSING', '请先重新连接邮箱', 422);
    const current = await readMailState(db, workspace.id, retry.id);
    if (current.record.phase === 'running' || !active(current.record)) return false;
    await save(db, current.row, current.record, { phase: 'pending', acceptRemote:command.payload.acceptRemote===true, authority: authority(actor, prior), authorizedAt: now, nextRunAt: now, error: undefined, retries: [...(retry.retries || []), { actorId: actor.userId, at: now }].slice(-20) });
    return true;
  }
  if (command.type === 'email.flag' && command.payload.flag === 'important') return false;
  const operation: MailStateOperation = command.type === 'email.flag' ? { kind: 'flag', flag: command.payload.flag, value: !!command.payload.value } : { kind: 'move', folder: m.folder };
  const field = operation.kind === 'move' ? 'folder' : operation.flag;
  for (const candidate of rows.filter(r => mailStateField(r) === field)) {
    const current = await readMailState(db, workspace.id, candidate.id), old = current.record;
    if (!active(old)) continue;
    if (field === 'folder' && (old.phase === 'running' || old.phase === 'unknown' || (old.attempt?.issued && !old.attempt.confirmedNotApplied) || old.attempt?.result)) fail('MAIL_STATE_PENDING', '先核对上一项移动的结果，再继续移动', 409);
    await save(db, current.row, current.record, { phase: 'superseded', nextRunAt: 0 });
  }
  if (records.filter(r=>r.accountId===a.id).length >= 500 && !rows.length) fail('MAIL_STATE_LIMIT', '待同步操作过多，请先处理同步异常', 409);
  const id = randomUUID(), source = m.source || 1, valid = source === (a.sourceGeneration || 1) && a.credentialSet;
  const r: MailStateRecord = { schemaVersion: 1, id, workspaceId: workspace.id, accountId: a.id, messageId: m.id, source, sourceHash: receiveSource(a), initiatorId: actor.userId,
    authority: authority(actor, prior), authorizedAt: now, operation, phase: valid ? 'pending' : 'blocked', version: 1, createdAt: new Date(now).toISOString(), nextRunAt: valid ? now : 0, failures: 0,
    ...(!valid ? { error: source !== (a.sourceGeneration || 1) ? '这是旧来源邮件，请在原邮箱处理' : '邮箱未连接，请重新绑定凭据' } : {}) };
  await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId: workspace.id, requestId: MAIL_STATE_PREFIX + id, actorId: r.initiatorId, inputHash: MAIL_STATE_HASH, expectedRevision: 0, createdAt: new Date(r.createdAt), result: { revision: 0, [MAIL_STATE_FIELD]: r } } });
  return true;
}
export async function mailStateViews(db: any, workspaceId: string, state: MistState, actor: TokenPayload): Promise<MailStateView[]> {
  const visible = new Map(state.email.messages.map(m => [m.id, m])), groups = new Map<string, MailStateRecord[]>();
  for (const r of await mailStateRecords(db, workspaceId)) if (visible.has(r.messageId)) groups.set(r.messageId, [...(groups.get(r.messageId) || []), r]);
  return [...groups].map(([messageId, rows]) => {
    const worst = rows.find(r => r.phase === 'unknown') || rows.find(r => r.phase === 'blocked') || rows.find(r => r.error) || rows.find(r => r.phase === 'running') || rows[0];
    const m = visible.get(messageId)!, a = state.email.accounts.find(a => a.id === m.accountId);
    return { messageId, state: worst.phase === 'pending' && worst.error ? 'failed' : worst.phase as MailStateView['state'], fields: [...new Set(rows.map(mailStateField))],
      canRetry: rows.some(r => ['failed', 'blocked', 'unknown'].includes(r.phase) || !!r.error) && !!a?.credentialSet && (m.source || 1) === (a.sourceGeneration || 1) && hasScope(actor, 'emails:write') && (actor as any).actorKind !== 'agent', ...(worst.error ? { error: worst.error } : {}) };
  });
}
export async function dueMailState(db: any, now: number, take = 2): Promise<MailStateRecord[]> {
  const rows = await db.mistCommandReceipt.findMany({ where: { inputHash: MAIL_STATE_HASH, requestId: { startsWith: MAIL_STATE_PREFIX }, AND: [{ OR: [{ result: { path: [MAIL_STATE_FIELD, 'phase'], equals: 'pending' } }, { result: { path: [MAIL_STATE_FIELD, 'phase'], equals: 'running' } }] }, { result: { path: [MAIL_STATE_FIELD, 'nextRunAt'], lte: now } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take });
  return rows.map(value);
}
export async function claimMailState(db: any, job: MailStateRecord, leaseId: string, expiresAt: number, now: number) {
  const { row, record } = await readMailState(db, job.workspaceId, job.id);
  if (record.version !== job.version || !['pending', 'running'].includes(record.phase) || record.nextRunAt > now) fail('MAIL_STATE_CHANGED', '邮件同步已被其他任务处理', 409);
  return save(db, row, record, { phase: 'running', leaseId, nextRunAt: expiresAt, error: undefined });
}
export async function planMailState(db: any, job: MailStateRecord, attempt: MailStateAttempt) {
  const { row, record } = await readMailState(db, job.workspaceId, job.id);
  if (record.phase !== 'running' || record.leaseId !== job.leaseId) fail('MAIL_STATE_CHANGED', '邮件同步任务已变化', 409);
  return save(db, row, record, { attempt });
}
export async function rememberMailState(db: any, job: MailStateRecord, observation: MailStateObservation) {
  const { row, record } = await readMailState(db, job.workspaceId, job.id);
  if (!record.attempt?.issued || record.attempt.id !== job.attempt?.id || !active(record)) return;
  return save(db, row, record, { attempt: { ...record.attempt, result: observation } });
}
export async function failMailState(db: any, job: MailStateRecord, phase: 'pending' | 'failed' | 'unknown' | 'blocked', error: string, now: number, confirmedNotApplied = false) {
  const { row, record } = await readMailState(db, job.workspaceId, job.id);
  if (!active(record) || record.leaseId !== job.leaseId) return;
  const failures = record.failures + 1;
  return save(db, row, record, { phase, error, failures, ...(confirmedNotApplied && record.attempt ? {attempt:{...record.attempt,confirmedNotApplied:true}} : {}), leaseId: undefined, nextRunAt: phase === 'pending' ? now + Math.min(30 * 60_000, 5 * 60_000 * 2 ** Math.min(failures - 1, 3)) : 0 });
}
export async function completeMailState(db: any, workspaceId: string, operationId: string, attemptId: string, observation: MailStateObservation, leaseId: string) {
  const { row, record } = await readMailState(db, workspaceId, operationId);
  if (record.phase !== 'running' || record.leaseId !== leaseId || record.attempt?.id !== attemptId || !isDeepStrictEqual(record.attempt.result,JSON.parse(JSON.stringify(observation)))) fail('MAIL_STATE_CHANGED', '邮件同步结果未获当前任务确认', 409);
  await save(db, row, record, { phase: 'done', nextRunAt: 0, leaseId: undefined, error: undefined });
}
