import type { MistCalendarEvent, MistState } from '../../../../server/src/shared/mistWorkspace';
/**
 * mar45：季节里程碑与展会日期按读取时派生进日历与「今日安排」，不另存日程，季节或展会改期后自动同步。
 * 派生项 id 以 `derived:` 开头，只读，点开回到季节或展会。
 */
export function derivedCalendarEvents(state: MistState | null | undefined): MistCalendarEvent[] {
  const m = state?.market; if (!m) return [];
  const out: MistCalendarEvent[] = [];
  for (const season of m.seasons || []) for (const [i, ms] of (season.milestones || []).entries()) if (ms.date) out.push({ id: `derived:season:${season.id}:${i}`, title: `${season.name} · ${ms.label}`, date: ms.date, time: '00:00', note: '', target: { view: 'seasons', id: season.id } } as MistCalendarEvent);
  for (const show of m.shows || []) if (show.status !== 'Cancelled' && show.startDate) out.push({ id: `derived:show:${show.id}`, title: `展会 · ${show.name}${show.endDate && show.endDate !== show.startDate ? `（至 ${show.endDate}）` : ''}`, date: show.startDate, time: '00:00', note: show.location, target: { view: 'seasons', id: show.id, section: 'shows' } } as MistCalendarEvent);
  return out;
}
export const isDerivedCalendarEvent = (event: Pick<MistCalendarEvent, 'id' | 'sourceTaskId'>) => !!event.sourceTaskId || event.id.startsWith('derived:');
/** mar60：重复日程按读取时展开，后续各次 id 带 `@日期`，编辑时回到原日程。 */
export const addCalendarMonths = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, last)); return t.toISOString().slice(0, 10); };
export function expandRepeats(events: MistCalendarEvent[]): MistCalendarEvent[] {
  const out: MistCalendarEvent[] = [];
  for (const e of events) {
    out.push(e);
    if (!e.repeat) continue;
    for (let i = 1; i < 60; i++) {
      const day = e.repeat.every === 'week' ? new Date(Date.parse(e.date + 'T00:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10) : addCalendarMonths(e.date, i);
      if (day > e.repeat.until) break;
      out.push({ ...e, id: `${e.id}@${day}`, date: day });
    }
  }
  return out;
}
export const calendarSourceId = (id: string) => id.split('@')[0];
/** 个人日程只给本人与参与人。 */
export const calendarVisibleTo = (event: MistCalendarEvent, me: string) => !event.ownerId || event.ownerId === me || !!event.participants?.some(p => p.id === me);
export const calendarWithDerived = (state: MistState | null | undefined) => [...expandRepeats(state?.calendar || []), ...derivedCalendarEvents(state)];
