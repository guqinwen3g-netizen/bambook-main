import { createHash, randomUUID } from 'node:crypto';
import type { TokenPayload } from '../../auth/service';
import { hasScope } from '../../auth/permissionService';
import { emailAccountAccessible, type EmailAccount } from '../../shared/mistEmail';
import type { MailReceivingView } from '../../shared/mistMailReceiving';
import { fail } from '../errors';

export const RECEIVING_PREFIX = 'mist-revision:mail-receiving:';
export const RECEIVING_HASH = 'mist-mail-receiving:v1';
export const RECEIVING_FIELD = '__mailReceiving';
export const RECEIVE_INTERVAL_MS = 5 * 60_000;
export const RECEIVE_LEASE_MS = 120_000;
type Problem = { code: string; message: string };
export type ReceiveAuthority = {
  ownerId: string; companyId?: string; issuedAt: number;
  credentialVersion?: string; ceiling: string[];
};
export type MailSyncLease = {
  id: string; workspaceId: string; accountId: string; actorId: string;
  sourceHash: string; background: boolean; expiresAt: number;
};
export type MailSyncActor = TokenPayload & { mailSyncLease?: MailSyncLease };
export type ReceivingRecord = {
  schemaVersion: 1; workspaceId: string; accountId: string; ownerId: string;
  sourceHash: string; version: number; enabled: boolean; createdAt: string;
  authority?: ReceiveAuthority; lease?: MailSyncLease;
  nextRunAt: number; failures: number; pending: number;
  lastAttemptAt?: number; lastSuccessAt?: number;
  blocked?: Problem; error?: Problem;
  lastRequestId?: string; lastExpectedVersion?: number; lastEnabled?: boolean; lastSourceGeneration?: number;
};
export type ReceivingJob = { workspaceId: string; accountId: string; version: number; authority: ReceiveAuthority };
const key = (accountId: string) => {
  if (!/^[A-Za-z0-9-]{1,120}$/.test(accountId)) fail('INVALID_INPUT', '邮箱编号无效', 400);
  return RECEIVING_PREFIX + accountId;
};
export function receiveSource(account: EmailAccount) {
  const t = account.transport;
  return createHash('sha256').update(JSON.stringify([
    account.ownerId, account.address.toLowerCase(), account.sourceGeneration || 1,
    t?.username, t?.imapHost, t?.imapPort, t?.imapSecure,
  ])).digest('hex');
}
const changed: Problem = { code: 'MAIL_SOURCE_CHANGED', message: '邮箱设置已变更，请重新开启自动收件' };
export async function receivingRecord(db: any, workspaceId: string, accountId: string) {
  const row = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: key(accountId) } } });
  if (!row) return { row: null, value: null as ReceivingRecord | null };
  const value = row.result?.[RECEIVING_FIELD] as ReceivingRecord;
  if (row.inputHash !== RECEIVING_HASH || value?.schemaVersion !== 1 || value.workspaceId !== workspaceId || value.accountId !== accountId || row.actorId !== value.ownerId || !Number.isSafeInteger(value.version)) fail('MAIL_RECEIVING_INVALID', '自动收件登记无效，请联系维护人员', 409);
  return { row, value };
}
async function save(db: any, row: any, previous: ReceivingRecord | null, next: ReceivingRecord) {
  const result = { revision: 0, [RECEIVING_FIELD]: next };
  if (!row) {
    await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId: next.workspaceId, requestId: key(next.accountId), actorId: next.ownerId, inputHash: RECEIVING_HASH, expectedRevision: 0, result, createdAt: new Date(next.createdAt) } });
  } else {
    const update = await db.mistCommandReceipt.updateMany({ where: { id: row.id, workspaceId: next.workspaceId, inputHash: RECEIVING_HASH, result: { path: [RECEIVING_FIELD, 'version'], equals: previous!.version } }, data: { actorId: next.ownerId, result } });
    if (update.count !== 1) fail('MAIL_RECEIVING_CHANGED', '收件状态已变化，请核对后重试', 409);
  }
}
function base(workspaceId: string, account: EmailAccount, now: number): ReceivingRecord {
  return { schemaVersion: 1, workspaceId, accountId: account.id, ownerId: account.ownerId!, sourceHash: receiveSource(account), version: 0, enabled: false, createdAt: new Date(now).toISOString(), nextRunAt: 0, failures: 0, pending: 0 };
}
export function receivingView(value: ReceivingRecord | null, account: EmailAccount, actor: TokenPayload, now: number): MailReceivingView {
  const validSource = !value || value.ownerId === account.ownerId && value.sourceHash === receiveSource(account);
  const ready = !account.example && !!account.transport && !!account.credentialSet;
  const problem = !validSource ? changed : value?.blocked ?? null;
  const enabled = !!value?.enabled && validSource && ready;
  return { accountId: account.id, version: value?.version ?? 0, enabled,
    state: problem ? 'blocked' : !enabled ? 'off' : value?.lease && value.lease.expiresAt > now ? 'running' : value?.error ? 'retrying' : 'waiting',
    canEnable: ready && actor.userId === account.ownerId && hasScope(actor, 'emails:write'),
    canDisable: actor.userId === account.ownerId && hasScope(actor, 'emails:write'),
    lastAttemptAt: value?.lastAttemptAt ? new Date(value.lastAttemptAt).toISOString() : null,
    lastSuccessAt: value?.lastSuccessAt ? new Date(value.lastSuccessAt).toISOString() : null,
    nextRunAt: enabled && value?.nextRunAt ? new Date(value.nextRunAt).toISOString() : null,
    pending: value?.pending ?? 0, error: problem ?? value?.error ?? null,
    ...(actor.userId===account.ownerId&&value?.lastRequestId?{lastChangeId:value.lastRequestId}:{}) };
}
async function event(db: any, value: ReceivingRecord, actorId: string, action: 'enabled' | 'disabled' | 'blocked', requestId: string, now: number) {
  const suffix = createHash('sha256').update(requestId).digest('hex').slice(0, 32);
  const id = `mist-revision:mail-receiving-event:${value.accountId}:${suffix}`;
  const prior = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: value.workspaceId, requestId: id } } });
  if (prior) fail('CONFLICT', '操作编号已使用，请重新核对状态', 409);
  await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId: value.workspaceId, requestId: id, actorId, inputHash: 'mist-mail-receiving-event:v1', expectedRevision: 0, result: { revision: 0, accountId: value.accountId, action, at: new Date(now).toISOString(), ownerId: value.ownerId, version: value.version }, createdAt: new Date(now) } });
}
export async function setReceiving(db: any, actor: TokenPayload, workspaceId: string, account: EmailAccount, input: Record<string, unknown>, now: number, companyId?: string) {
  if (account.example || actor.userId !== account.ownerId) fail('FORBIDDEN', '只有邮箱接入人可以设置自动收件', 403);
  if (Object.keys(input).some(k => !['enabled', 'version', 'requestId','sourceGeneration'].includes(k)) || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.version) || !Number.isSafeInteger(input.sourceGeneration) || Number(input.sourceGeneration)<1 || typeof input.requestId !== 'string' || !input.requestId || input.requestId.trim() !== input.requestId || input.requestId.length > 116) fail('INVALID_INPUT', '自动收件设置无效', 400);
  const { row, value } = await receivingRecord(db, workspaceId, account.id), c = value ?? base(workspaceId, account, now);
  if (c.lastRequestId === input.requestId) {
    if (input.enabled !== c.lastEnabled || input.version !== c.lastExpectedVersion || input.sourceGeneration!==c.lastSourceGeneration) fail('CONFLICT', '操作编号已用于其他设置', 409);
    return receivingView(c, account, actor, now);
  }
  // A stop must not race with ordinary worker progress versions. Historical operation IDs
  // are still fenced by the immutable event receipt, so an old stop cannot undo a later re-enable.
  if (input.enabled&&input.version !== c.version) fail('MAIL_RECEIVING_CHANGED', '收件状态已变化，请核对后重试', 409);
  if(input.enabled&&input.sourceGeneration!==(account.sourceGeneration||1))fail('MAIL_SOURCE_CHANGED','邮箱设置已变化，请核对后重新开启',409);
  if (input.enabled && (!account.transport || !account.credentialSet)) fail('MAIL_CREDENTIAL_MISSING', '请先绑定邮箱凭据', 422);
  const next: ReceivingRecord = { ...c, ownerId: account.ownerId!, sourceHash: receiveSource(account), version: c.version + 1, enabled: input.enabled, nextRunAt: input.enabled ? now : 0, failures: 0, pending: 0, blocked: undefined, error: undefined, lastRequestId: input.requestId as string, lastExpectedVersion: input.version as number, lastEnabled: input.enabled,lastSourceGeneration:input.sourceGeneration as number,
    authority: input.enabled ? { ownerId: actor.userId, ...(companyId ? { companyId } : {}), issuedAt: now, ...(actor.credentialVersion ? { credentialVersion: actor.credentialVersion } : {}), ceiling: ['emails:read', 'emails:write'].filter(p => hasScope(actor, p as any)) } : undefined,
    lease: c.lease?.background ? undefined : c.lease };
  await event(db, next, actor.userId, input.enabled ? 'enabled' : 'disabled', input.requestId as string, now);
  await save(db, row, value, next);
  return receivingView(next, account, actor, now);
}
export async function claimReceiving(db: any, actor: TokenPayload, workspaceId: string, account: EmailAccount, now: number, background: boolean, leaseMs: number, expected?: ReceivingJob) {
  if (account.example || !account.ownerId || !account.transport || !account.credentialSet) fail('MAIL_CREDENTIAL_MISSING', '请先绑定邮箱凭据', 422);
  const { row, value } = await receivingRecord(db, workspaceId, account.id), c = value ?? base(workspaceId, account, now), sourceHash = receiveSource(account);
  const sameSource = c.ownerId === account.ownerId && c.sourceHash === sourceHash;
  if (background && (!sameSource || !c.enabled || !c.authority || c.authority.ownerId !== actor.userId || expected?.version !== c.version || c.nextRunAt > now)) fail('MAIL_RECEIVING_CHANGED', '自动收件授权已变化', 409);
  if (sameSource && c.lease && c.lease.expiresAt > now) fail('MAIL_BUSY', '该邮箱正在同步，请稍后核对', 409);
  const lease: MailSyncLease = { id: randomUUID(), workspaceId, accountId: account.id, actorId: actor.userId, sourceHash, background, expiresAt: now + leaseMs };
  const next: ReceivingRecord = { ...c, ...(!sameSource ? { enabled: false, authority: undefined, blocked: changed, sourceHash, ownerId: account.ownerId } : {}), version: c.version + 1, lease, lastAttemptAt: now, nextRunAt: c.enabled && sameSource ? lease.expiresAt : 0 };
  await save(db, row, value, next); return lease;
}
/** Called under the business workspace lock before commit; touching the registry row fences a concurrent stop. */
export async function assertReceivingLease(db: any, actor: TokenPayload, lease: MailSyncLease, workspace: { id: string; state: { email?: { accounts: EmailAccount[] } } }, now: number, lock = false) {
  const { row, value: c } = await receivingRecord(db, lease.workspaceId, lease.accountId);
  const account = workspace.state.email?.accounts.find(a => a.id === lease.accountId);
  if (workspace.id !== lease.workspaceId || !account || !account.credentialSet || account.example || !emailAccountAccessible(account, actor.userId) || !c?.lease || c.lease.id !== lease.id || c.lease.actorId !== actor.userId || c.lease.expiresAt <= now || receiveSource(account) !== lease.sourceHash || c.sourceHash !== lease.sourceHash || lease.background && !c.enabled) fail('MAIL_SYNC_STOPPED', '收件操作已停止或邮箱授权已变化', 409);
  if (lock) {
    const touched = await db.mistCommandReceipt.updateMany({ where: { id: row.id, workspaceId: lease.workspaceId, inputHash: RECEIVING_HASH, result: { path: [RECEIVING_FIELD, 'version'], equals: c.version } }, data: { result: { revision: 0, [RECEIVING_FIELD]: c } } });
    if (touched.count !== 1) fail('MAIL_SYNC_STOPPED', '收件操作已停止，请核对邮箱状态', 409);
  }
}
export async function finishReceiving(db: any, lease: MailSyncLease, outcome: { ok: boolean; pending?: number; error?: Problem; block?: boolean }, now: number, intervalMs: number) {
  const { row, value: c } = await receivingRecord(db, lease.workspaceId, lease.accountId);
  if (!c || c.lease?.id !== lease.id) return;
  const failures = outcome.ok ? 0 : c.failures + 1;
  const delay = outcome.ok ? outcome.pending ? Math.min(intervalMs, 5000) : intervalMs : Math.min(30 * 60_000, intervalMs * 2 ** Math.min(failures - 1, 6));
  const next: ReceivingRecord = { ...c, version: c.version + 1, lease: undefined, failures, pending: outcome.pending ?? 0, ...(outcome.ok ? { lastSuccessAt: now, error: undefined } : { error: outcome.error ?? { code: 'MAIL_RECEIVE_FAILED', message: '暂时无法收信，将自动重试' } }),
    ...(outcome.block ? { enabled: false, authority: undefined, blocked: outcome.error ?? { code: 'MAIL_AUTH_CHANGED', message: '邮箱授权已失效，请重新绑定并开启自动收件' } } : {}), nextRunAt: c.enabled && !outcome.block ? now + delay : 0 };
  if (outcome.block && c.enabled) await event(db, next, c.ownerId, 'blocked', lease.id, now);
  await save(db, row, c, next);
}
export async function blockReceiving(db: any, job: ReceivingJob, problem: Problem, now: number) {
  const { row, value: c } = await receivingRecord(db, job.workspaceId, job.accountId);
  if (!c || c.version !== job.version || !c.enabled) return;
  const next = { ...c, version: c.version + 1, enabled: false, authority: undefined, lease: undefined, blocked: problem, nextRunAt: 0 };
  await event(db, next, c.ownerId, 'blocked', 'blocked-' + c.version, now); await save(db, row, c, next);
}
export async function invalidateReceiving(db: any, workspaceId: string, accountId: string, now: number) {
  const { row, value: c } = await receivingRecord(db, workspaceId, accountId); if (!c) return;
  const next = { ...c, version: c.version + 1, enabled: false, authority: undefined, lease: undefined, nextRunAt: 0, blocked: undefined, error: undefined };
  if (c.enabled) await event(db, next, c.ownerId, 'disabled', 'disconnect-' + c.version, now);
  await save(db, row, c, next);
}
export async function dueReceiving(db: any, now: number, take: number): Promise<ReceivingJob[]> {
  const rows = await db.mistCommandReceipt.findMany({ where: { inputHash: RECEIVING_HASH, requestId: { startsWith: RECEIVING_PREFIX }, AND: [{ result: { path: [RECEIVING_FIELD, 'enabled'], equals: true } }, { result: { path: [RECEIVING_FIELD, 'nextRunAt'], lte: now } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take });
  return rows.flatMap((row: any) => {
    const c = row.result?.[RECEIVING_FIELD] as ReceivingRecord;
    if (c?.schemaVersion !== 1 || row.workspaceId !== c.workspaceId || row.actorId !== c.ownerId || typeof c.accountId!=='string' || !/^[A-Za-z0-9-]{1,120}$/.test(c.accountId) || row.requestId !== key(c.accountId) || !c.enabled || !c.authority || c.authority.ownerId !== c.ownerId || !Number.isSafeInteger(c.version) || !Number.isFinite(c.authority.issuedAt) || c.authority.issuedAt>now+30_000 || !Array.isArray(c.authority.ceiling) || !c.authority.ceiling.includes('emails:write') || c.authority.ceiling.some(s=>!['emails:read','emails:write'].includes(s))) return [];
    return [{ workspaceId: c.workspaceId, accountId: c.accountId, version: c.version, authority: c.authority }];
  });
}
