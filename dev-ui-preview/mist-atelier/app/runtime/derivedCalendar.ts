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
export const isDerivedCalendarEvent = (event: { id: string }) => event.id.startsWith('derived:');
export const calendarWithDerived = (state: MistState | null | undefined) => [...(state?.calendar || []), ...derivedCalendarEvents(state)];
