/**
 * 小竹对话列表的本人设置：改名、从列表移除。对话本身由带 conversationId 的任务组成，任务记录照常留存审计；
 * 这里只存一份按人按公司的小表（回执表一行），不进业务状态，也不经 MCP 或业务命令改动。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { TokenPayload } from '../auth/service';
import { fail } from './errors';

export const CONVERSATION_PREFIX = 'mist-revision:agent-conversation:';
export const CONVERSATION_HASH = 'mist-agent-conversation:v1';
const FIELD = '__agentConversations', LIMIT = 300, TITLE_LIMIT = 60;
export type ConversationMeta = { title?: string; hidden?: true; at: string };
type Record_ = { schemaVersion: 1; workspaceId: string; ownerId: string; version: number; items: Record<string, ConversationMeta> };
export type ConversationMetaView = { id: string; title?: string; hidden?: true };

const key = (ownerId: string) => CONVERSATION_PREFIX + createHash('sha256').update(ownerId).digest('hex').slice(0, 32);
export const validConversationId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

async function read(db: any, workspaceId: string, ownerId: string) {
  const row = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: key(ownerId) } } });
  const value = row?.result?.[FIELD] as Record_ | undefined;
  if (!row) return { row: null, value: { schemaVersion: 1, workspaceId, ownerId, version: 0, items: {} } as Record_ };
  if (row.inputHash !== CONVERSATION_HASH || value?.schemaVersion !== 1 || value.workspaceId !== workspaceId || value.ownerId !== ownerId) fail('CONFLICT', '对话设置记录无效', 409);
  return { row, value };
}

export async function listConversationMeta(db: any, workspaceId: string, ownerId: string): Promise<ConversationMetaView[]> {
  const { value } = await read(db, workspaceId, ownerId);
  return Object.entries(value.items).map(([id, m]) => ({ id, ...(m.title ? { title: m.title } : {}), ...(m.hidden ? { hidden: true as const } : {}) }));
}

/** input: { title?: string | null（null 恢复默认标题）, hidden?: boolean } */
export async function saveConversationMeta(db: any, actor: TokenPayload, workspaceId: string, id: string, input: Record<string, unknown>, now: number): Promise<ConversationMetaView> {
  if (!validConversationId(id)) fail('INVALID_INPUT', '对话编号无效', 400);
  if (!Object.keys(input).length || Object.keys(input).some(k => !['title', 'hidden'].includes(k))) fail('INVALID_INPUT', '对话设置字段无效', 400);
  let title: string | undefined | null;
  if ('title' in input) {
    if (input.title === null) title = null;
    else if (typeof input.title === 'string' && input.title.trim() && input.title.trim().length <= TITLE_LIMIT) title = input.title.trim();
    else fail('INVALID_INPUT', `标题须为 1–${TITLE_LIMIT} 字`, 400);
  }
  if ('hidden' in input && typeof input.hidden !== 'boolean') fail('INVALID_INPUT', '对话设置字段无效', 400);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { row, value } = await read(db, workspaceId, actor.userId);
    const prev = value.items[id], at = new Date(now).toISOString();
    const nextMeta: ConversationMeta = { at, ...(prev?.title && title === undefined ? { title: prev.title } : {}), ...(title ? { title } : {}), ...((input.hidden ?? prev?.hidden) ? { hidden: true as const } : {}) };
    const items = { ...value.items };
    if (!nextMeta.title && !nextMeta.hidden) delete items[id]; else items[id] = nextMeta;
    const kept = Object.entries(items).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, LIMIT);
    const next: Record_ = { ...value, version: value.version + 1, items: Object.fromEntries(kept) };
    if (!row) {
      try { await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: key(actor.userId), actorId: actor.userId, inputHash: CONVERSATION_HASH, expectedRevision: 0, result: { revision: 0, [FIELD]: next } } }); }
      catch { continue; }
    } else {
      const update = await db.mistCommandReceipt.updateMany({ where: { id: row.id, workspaceId, inputHash: CONVERSATION_HASH, result: { path: [FIELD, 'version'], equals: value.version } }, data: { result: { revision: 0, [FIELD]: next } } });
      if (update.count !== 1) continue;
    }
    const saved = next.items[id];
    return { id, ...(saved?.title ? { title: saved.title } : {}), ...(saved?.hidden ? { hidden: true as const } : {}) };
  }
  fail('CONFLICT', '对话设置已变化，请重试', 409);
}
