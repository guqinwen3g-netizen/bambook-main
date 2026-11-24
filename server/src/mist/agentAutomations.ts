/**
 * 小竹自动模式（2026-11-07 定案）：常驻规则，类似 hook。规则定义“什么情况发生就做什么”，
 * 触发一次做一次，不是目标驱动的长会话。规则只属于本人，权限不超过本人；需要确认的写入留提议后本次运行结束。
 * 记录与收件授权同样放在回执表，不进业务状态，也不经 MCP 或业务命令改动。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { TokenPayload } from '../auth/service';
import type { MistState } from '../shared/mistWorkspace';
import {mistBusinessDate,shiftCalendarDay} from '../shared/mistBusinessClock';
import { fail } from './errors';

export const AUTOMATION_PREFIX = 'mist-revision:agent-automation:';
export const AUTOMATION_HASH = 'mist-agent-automation:v1';
export const AUTOMATION_FIELD = '__agentAutomation';
export const AUTOMATION_TRIGGERS = ['new_mail', 'new_receipt', 'due_soon', 'daily'] as const;
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];
export const AUTOMATION_RULE_LIMIT = 20, AUTOMATION_DAY_LIMIT = 24, DUE_SOON_DAYS = 3;
const SEEN_LIMIT = 3000, RUN_LOG = 20, FACT_LIMIT = 20;
/** 新邮件 / 新到账按时间窗判断：比已见最新时间早出窗口的旧记录永远不算新；窗口内仍按编号去重，迟到的邮件不会漏。 */
const FRESH_WINDOW_MS: Record<'new_mail' | 'new_receipt', number> = { new_mail: 7 * 86400_000, new_receipt: 45 * 86400_000 };
export const AUTOMATION_FAILURE_LIMIT = 5, AUTOMATION_FAILURE_SPAN_MS = 30 * 60_000;
const ENDED_ORDER_STATES = ['已出运', '履约完成', '已完成', '已取消', '已作废', '待收尾款', '内部交付完成', '已交接'];
export type AutomationAuthority = { ownerId: string; companyId?: string; issuedAt: number; credentialVersion?: string };
export type AutomationRun = { at: string; taskId: string; detail: string };
export type AutomationRecord = {
  schemaVersion: 1; id: string; workspaceId: string; ownerId: string; ownerName: string; version: number;
  name: string; trigger: AutomationTrigger; time: string; instructions: string; enabled: boolean;
  createdAt: string; updatedAt: string; authority?: AutomationAuthority;
  seen: string[]; primed: boolean; lastDay?: string; day?: { date: string; count: number }; runs: AutomationRun[];
  /** 已见记录的最新时间（毫秒）；旧规则没有时重新记起点。 */ since?: number;
  /** 连续无法运行的次数；成功一次清零，达到上限停用并写明原因。 */ failures?: { count: number; since: number };
  halted?: { code: string; message: string }; removed?: boolean;
};
export type AutomationView = Pick<AutomationRecord, 'id' | 'name' | 'trigger' | 'time' | 'instructions' | 'enabled' | 'version' | 'createdAt' | 'updatedAt' | 'runs' | 'halted'>;
export type AutomationJob = { workspaceId: string; id: string; authority: AutomationAuthority };
export const automationView = (c: AutomationRecord): AutomationView => ({ id: c.id, name: c.name, trigger: c.trigger, time: c.time, instructions: c.instructions, enabled: c.enabled, version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt, runs: c.runs, ...(c.halted ? { halted: c.halted } : {}) });

const key = (id: string) => { if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) fail('INVALID_INPUT', '规则编号无效', 400); return AUTOMATION_PREFIX + id; };
const text = (value: unknown, label: string, limit: number) => { if (typeof value !== 'string' || !value.trim() || value.length > limit) fail('INVALID_INPUT', `${label}须为 1–${limit} 字`, 400); return (value as string).trim(); };

export async function automationRecord(db: any, workspaceId: string, id: string) {
  const row = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: key(id) } } });
  const value = row?.result?.[AUTOMATION_FIELD] as AutomationRecord | undefined;
  if (!row || row.inputHash !== AUTOMATION_HASH || value?.schemaVersion !== 1 || value.workspaceId !== workspaceId) fail('NOT_FOUND', '规则不存在', 404);
  return { row, value: value! };
}
export async function ownAutomation(db: any, actor: TokenPayload, workspaceId: string, id: string) {
  const found = await automationRecord(db, workspaceId, id);
  if (found.value.ownerId !== actor.userId || found.value.removed) fail('NOT_FOUND', '规则不存在', 404);
  return found;
}
export async function writeAutomation(db: any, row: any, previous: AutomationRecord, next: AutomationRecord, conflictCode = 'CONFLICT') {
  const update = await db.mistCommandReceipt.updateMany({ where: { id: row.id, workspaceId: next.workspaceId, inputHash: AUTOMATION_HASH, result: { path: [AUTOMATION_FIELD, 'version'], equals: previous.version } }, data: { result: { revision: 0, [AUTOMATION_FIELD]: next } } });
  if (update.count !== 1) fail(conflictCode, '规则已变化，请刷新后重试', 409);
}
export async function listAutomations(db: any, workspaceId: string, ownerId: string): Promise<AutomationRecord[]> {
  const rows = await db.mistCommandReceipt.findMany({ where: { workspaceId, actorId: ownerId, inputHash: AUTOMATION_HASH, requestId: { startsWith: AUTOMATION_PREFIX } } });
  return rows.map((row: any) => row.result?.[AUTOMATION_FIELD] as AutomationRecord).filter((c: AutomationRecord | undefined): c is AutomationRecord => c?.schemaVersion === 1 && c.workspaceId === workspaceId && !c.removed).sort((a: AutomationRecord, b: AutomationRecord) => a.createdAt.localeCompare(b.createdAt));
}
export function parseAutomationInput(input: Record<string, unknown>) {
  const trigger = input.trigger as AutomationTrigger;
  if (!AUTOMATION_TRIGGERS.includes(trigger)) fail('INVALID_INPUT', '触发条件无效', 400);
  const time = input.time === undefined || input.time === '' ? '09:00' : input.time;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('INVALID_INPUT', '时间格式为 HH:MM', 400);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail('INVALID_INPUT', '启用状态无效', 400);
  return { name: text(input.name, '规则名称', 40), trigger, time: time as string, instructions: text(input.instructions, '要做什么', 2000), enabled: input.enabled !== false };
}
function guardAutomationVersion(rule: AutomationRecord, expectedVersion: unknown, required = false) {
  if (expectedVersion === undefined && !required) return 'CONFLICT';
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    fail('INVALID_INPUT', '规则版本无效', 400);
  if (rule.version !== expectedVersion) fail('REVISION_CONFLICT', '规则已变化，请刷新后重试', 409);
  return 'REVISION_CONFLICT';
}

function automationAuthority(actor: TokenPayload, now: number): AutomationAuthority {
  return { ownerId: actor.userId, ...(actor.companyId ? { companyId: actor.companyId } : {}), issuedAt: now, ...(actor.credentialVersion ? { credentialVersion: actor.credentialVersion } : {}) };
}

function updatedAutomation(rule: AutomationRecord, settings: Partial<ReturnType<typeof parseAutomationInput>>, actor: TokenPayload, now: number): AutomationRecord {
  const enabled = settings.enabled ?? rule.enabled;
  const reset = settings.trigger !== undefined && rule.trigger !== settings.trigger;
  return {
    ...rule, ...settings, version: rule.version + 1, updatedAt: new Date(now).toISOString(),
    authority: enabled ? automationAuthority(actor, now) : undefined, halted: undefined, failures: undefined,
    // 改了触发条件就重新记起点，已有邮件和到账不算新事件。
    ...(reset ? { seen: [], primed: false, lastDay: undefined, since: undefined } : {}),
  };
}

export async function setAutomationEnabled(db: any, actor: TokenPayload, workspaceId: string, id: string, input: Record<string, unknown>, now: number) {
  const { row, value: rule } = await ownAutomation(db, actor, workspaceId, id);
  const conflict = guardAutomationVersion(rule, input.expectedVersion, true);
  if (typeof input.enabled !== 'boolean') fail('INVALID_INPUT', '启用状态无效', 400);
  const next = updatedAutomation(rule, { enabled: input.enabled as boolean }, actor, now);
  await writeAutomation(db, row, rule, next, conflict);
  return next;
}

export async function saveAutomation(db: any, actor: TokenPayload, workspaceId: string, id: string | undefined, input: Record<string, unknown>, now: number) {
  const fields = parseAutomationInput(input), at = new Date(now).toISOString();
  if (id) {
    const { row, value: rule } = await ownAutomation(db, actor, workspaceId, id);
    const conflict = guardAutomationVersion(rule, input.expectedVersion);
    const next = updatedAutomation(rule, fields, actor, now);
    await writeAutomation(db, row, rule, next, conflict);
    return next;
  }
  const authority = automationAuthority(actor, now);
  // The scoped receipt stores the original intent separately from the live, editable rule.
  const request = input.requestId === undefined ? undefined : AUTOMATION_PREFIX + 'create:'
    + createHash('sha256').update(JSON.stringify([actor.userId, text(input.requestId, '操作编号', 116)])).digest('hex');
  const inputHash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  if (request) {
    const receipt = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: request } } });
    if (receipt) {
      if (receipt.workspaceId !== workspaceId || receipt.actorId !== actor.userId || typeof receipt.result?.id !== 'string')
        fail('NOT_FOUND', '规则不存在', 404);
      if (receipt.inputHash !== inputHash) fail('CONFLICT', '操作编号已用于其他规则', 409);
      const { value: rule } = await automationRecord(db, workspaceId, receipt.result.id);
      if (rule.ownerId !== actor.userId) fail('NOT_FOUND', '规则不存在', 404);
      if (rule.removed) fail('AGENT_AUTOMATION_CREATED_RULE_GONE', '原规则已删除', 404);
      return rule;
    }
  }
  if ((await listAutomations(db, workspaceId, actor.userId)).length >= AUTOMATION_RULE_LIMIT) fail('PRECONDITION', `每人最多 ${AUTOMATION_RULE_LIMIT} 条规则`, 422);
  const c: AutomationRecord = { schemaVersion: 1, id: randomUUID(), workspaceId, ownerId: actor.userId, ownerName: actor.displayName || actor.userId, version: 1, ...fields, createdAt: at, updatedAt: at, ...(fields.enabled ? { authority } : {}), seen: [], primed: false, runs: [] };
  await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: key(c.id), actorId: actor.userId, inputHash: AUTOMATION_HASH, expectedRevision: 0, result: { revision: 0, [AUTOMATION_FIELD]: c }, createdAt: new Date(now) } });
  if (request) {
    await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: request, actorId: actor.userId,
      inputHash, expectedRevision: 0, result: { revision: 0, id: c.id }, createdAt: new Date(now) } });
  }
  return c;
}
export async function removeAutomation(db: any, actor: TokenPayload, workspaceId: string, id: string, expectedVersion?: number) {
  // 回执记录不物理删除：标记移除后不再列出，也不再触发。
  const { row, value: c } = await ownAutomation(db, actor, workspaceId, id);
  const conflict = guardAutomationVersion(c, expectedVersion);
  await writeAutomation(db, row, c, { ...c, version: c.version + 1, enabled: false, authority: undefined, removed: true }, conflict);
}
export async function dueAutomations(db: any, take: number, after?: string): Promise<{ jobs: AutomationJob[]; next?: string }> {
  const rows = await db.mistCommandReceipt.findMany({
    where: {
      inputHash: AUTOMATION_HASH,
      requestId: { startsWith: AUTOMATION_PREFIX },
      result: { path: [AUTOMATION_FIELD, 'enabled'], equals: true },
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { id: 'asc' },
    take,
  });
  const jobs = rows.flatMap((row: any) => {
    const rule = row.result?.[AUTOMATION_FIELD] as AutomationRecord;
    return rule?.schemaVersion === 1 && rule.enabled && rule.authority && !rule.halted
      && row.workspaceId === rule.workspaceId && row.actorId === rule.ownerId
      ? [{ workspaceId: rule.workspaceId, id: rule.id, authority: rule.authority }] : [];
  });
  // Advance past the last scanned row even when some rows have no valid grant.
  return { jobs, next: rows.length === take ? rows.at(-1)?.id : undefined };
}

const SHANGHAI_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clock = (now: number) => SHANGHAI_CLOCK.format(new Date(now));
const addDays = (day: string, days: number) => shiftCalendarDay(day, days);
export type AutomationDecision = { next: Pick<AutomationRecord, 'seen' | 'primed' | 'lastDay' | 'since'>; fire?: { detail: string; facts: string } };
/** 只判断要不要触发。state 是规则所有者的权限投影，看不到的邮件和到账不会触发。 */
export function evaluateAutomation(c: AutomationRecord, state: MistState, now: number): AutomationDecision {
  const base = { seen: c.seen, primed: c.primed, lastDay: c.lastDay, since: c.since }, day = mistBusinessDate(new Date(now));
  if (c.trigger === 'new_mail' || c.trigger === 'new_receipt') {
    const time = (v: unknown) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };
    const rows: Array<{ id: string; line: string; at: number }> = c.trigger === 'new_mail'
      ? ((state as any).email?.messages ?? []).filter((m: any) => m.folder === 'inbox').map((m: any) => ({ id: m.id, at: time(m.at), line: `email ${m.id}：${String(m.subject ?? '').slice(0, 80)}` }))
      : ((state as any).receipts ?? []).map((r: any) => ({ id: r.id, at: time(r.date), line: `receipt_record ${r.id}：${r.payer ?? ''} ${r.amount ?? ''} ${r.currency ?? ''}` }));
    const window = FRESH_WINDOW_MS[c.trigger], newest = rows.reduce((m, r) => Math.max(m, r.at), 0);
    const inWindow = (since: number) => rows.filter(r => r.at >= since - window);
    // 第一次（或旧规则没有时间起点）只记起点：开启规则时已有的邮件和到账不算新事件。
    if (!c.primed || c.since === undefined) {
      const since = Math.max(c.since ?? 0, newest);
      return { next: { ...base, seen: inWindow(since).map(r => r.id).slice(-SEEN_LIMIT), primed: true, since } };
    }
    const known = new Set(c.seen), fresh = inWindow(c.since).filter(r => !known.has(r.id));
    const since = Math.max(c.since, ...fresh.map(r => r.at)), keep = new Set(inWindow(since).map(r => r.id));
    const seen = [...c.seen.filter(id => keep.has(id)), ...fresh.map(r => r.id)].slice(-SEEN_LIMIT);
    if (!fresh.length) return { next: seen.length === c.seen.length ? base : { ...base, seen } };
    const label = c.trigger === 'new_mail' ? '封新邮件' : '笔新到账';
    return { next: { ...base, seen, since }, fire: { detail: `${fresh.length} ${label}`, facts: fresh.slice(0, FACT_LIMIT).map(r => r.line).join('\n') } };
  }
  if (c.lastDay === day || clock(now) < c.time) return { next: base };
  const next = { ...base, primed: true, lastDay: day };
  if (c.trigger === 'daily') return { next, fire: { detail: '每日定时', facts: `业务日期：${day}` } };
  const limit = addDays(day, DUE_SOON_DAYS), orders = ((state as any).orders ?? []).filter((o: any) => typeof o.due === 'string' && o.due && o.due.slice(0, 10) <= limit && !ENDED_ORDER_STATES.includes(o.state));
  if (!orders.length) return { next };
  return { next, fire: { detail: `${orders.length} 张订单交期临近`, facts: orders.slice(0, FACT_LIMIT).map((o: any) => `order ${o.id}：${o.code ?? ''} 交期 ${o.due}`).join('\n') } };
}
export const automationInstructions = (c: AutomationRecord, facts: string) => `【自动规则：${c.name}】\n${c.instructions}\n\n【本次触发】\n${facts}`.slice(0, 4000);
export function recordAutomationRun(c: AutomationRecord, decision: AutomationDecision, taskId: string | undefined, detail: string, now: number): AutomationRecord {
  const at = new Date(now).toISOString(), date = mistBusinessDate(new Date(now)), count = c.day?.date === date ? c.day.count : 0;
  return { ...c, ...decision.next, version: c.version + 1, failures: undefined, ...(taskId ? { day: { date, count: count + 1 }, runs: [{ at, taskId, detail }, ...c.runs].slice(0, RUN_LOG) } : {}) };
}
export const automationOverLimit = (c: AutomationRecord, now: number) => c.day?.date === mistBusinessDate(new Date(now)) && c.day.count >= AUTOMATION_DAY_LIMIT;
