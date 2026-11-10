import type { MistCalendarEvent, MistState, MistTarget, MistTask } from './mistWorkspace';

type CalendarSource = Pick<MistState, 'calendar' | 'tasks' | 'crm'>;

// Early-generated appointments had two independent IDs. Recognize only a single,
// untouched 09:00 appointment matching a single originating follow-up. Never
// infer a link from just the customer's name or the day, or rewrite old records on read.
function signature(title: string, date: string, note: string, ownerId: string | undefined, owner: string | undefined, target?: MistTarget) {
  return JSON.stringify([title, date, note, ownerId, owner, Object.entries(target ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
}
function unique<T>(index: Map<string, T | null>, key: string, value: T) {
  index.set(key, index.has(key) ? null : value);
}
export function crmCalendarTaskLinks(state: CalendarSource) {
  const tasks = new Map((state.tasks || []).filter(t => t.kind === 'crm-follow-up').map(t => [t.id, t]));
  const links = new Map<string, MistTask>(), bound = new Set<string>();
  const oldEvents = new Map<string, MistCalendarEvent | null>();
  for (const e of state.calendar || []) {
    if (e.sourceTaskId) {
      const t = tasks.get(e.sourceTaskId);
      if (t) { links.set(e.id, t); bound.add(t.id); }
    } else if (e.ownerId && e.time === '09:00' && !e.repeat && !e.remindMinutes && !e.participants?.length && (e.target?.view === 'crm' || e.target?.view === 'invoices')) {
      unique(oldEvents, signature(e.title, e.date, e.note, e.ownerId, e.owner, e.target), e);
    }
  }
  if (!oldEvents.size) return links;
  const origins = new Map<string, MistTask | null>();
  for (const f of state.crm?.followUps || []) {
    const t = tasks.get(f.nextTaskId);
    if (!t || !f.nextDate || bound.has(t.id)) continue;
    const owner = f.actorId || (t.assigneeIds?.length === 1 ? t.assigneeIds[0] : undefined);
    if (owner) unique(origins, signature(t.title, f.nextDate, f.content.slice(0, 200), owner, f.actor, t.target), t);
  }
  for (const [key, t] of origins) {
    const e = oldEvents.get(key);
    if (t && e) links.set(e.id, t);
  }
  return links;
}

/** Compute appointments before company/row/target visibility filters. Completing
 * a task removes its pending appointment; reopening restores the same calendar ID. */
export function currentCrmCalendar(state: CalendarSource): MistCalendarEvent[] {
  const links = crmCalendarTaskLinks(state);
  const voided = new Set((state.crm?.followUps || []).filter(f => f.voided).map(f => f.nextTaskId));
  return (state.calendar || []).flatMap(e => {
    const t = links.get(e.id);
    if (!t) return e.sourceTaskId ? [] : [e];
    if (t.done || voided.has(t.id)) return [];
    const ownerId = t.assigneeIds?.[0] || e.ownerId;
    return [{...e, sourceTaskId:t.id, date:t.due, target:t.target, ownerId, owner:ownerId === e.ownerId ? e.owner : undefined}];
  });
}
