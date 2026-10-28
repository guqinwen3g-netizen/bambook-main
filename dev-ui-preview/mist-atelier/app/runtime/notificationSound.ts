import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import { visibleMistNotifications } from './notificationPreferences';

/** Only newly created, unread notices visible to this user; preference changes do not replay old notices. */
export function newAudibleNotices(previous: MistState, next: MistState, canRead: (view: string) => boolean): string[] {
  const existing = new Set(previous.notifications.map(item => item.id));
  return visibleMistNotifications(next, canRead).filter(item => !item.readAt && !existing.has(item.id)).map(item => item.id);
}

const KEY = 'bambook.ui-sound.seen-notices.v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
const memory = new Map<string, number>();
/** Best-effort cross-tab deduplication; only opaque user, workspace and notification IDs are stored locally. */
export function markNoticeSounds(scope: string, ids: string[]): boolean {
  if (!ids.length) return false;
  const now = Date.now();
  let entries: Array<[string, number]> = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(parsed)) entries = parsed.filter((entry): entry is [string, number] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && now - entry[1] < MAX_AGE && now >= entry[1]);
  } catch { /* Restricted storage falls back to in-memory deduplication. */ }
  for (const [key, at] of memory) if (now - at >= MAX_AGE || now < at) memory.delete(key);
  const seen = new Set([...entries.map(([key]) => key), ...memory.keys()]);
  let added = false;
  for (const id of ids) {
    const key = JSON.stringify([scope, id]);
    if (seen.has(key)) continue;
    added = true; seen.add(key); memory.set(key, now); entries.push([key, now]);
  }
  while (memory.size > 256) memory.delete(memory.keys().next().value!);
  try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-256))); } catch { /* Keep in-memory behavior. */ }
  return added;
}
