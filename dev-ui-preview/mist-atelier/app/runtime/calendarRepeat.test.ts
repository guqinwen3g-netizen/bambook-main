import { describe, expect, it } from 'vitest';
import { calendarVisibleTo, expandRepeats } from './derivedCalendar';
import { mistWorkQueue } from './workQueue';
import { createMistState, type MistCalendarEvent, type MistContext } from '../../../../server/src/shared/mistWorkspace';

const event = (over: Partial<MistCalendarEvent> = {}): MistCalendarEvent => ({ id: 'e1', title: '周例会', date: '2026-10-15', time: '09:00', note: '', ...over });

describe('mar60 repeat, participants, reminders', () => {
  it('expands weekly and monthly repeats up to the end date; month end clamps', () => {
    expect(expandRepeats([event({ repeat: { every: 'week', until: '2026-11-05' } })]).map(e => e.date)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']);
    expect(expandRepeats([event({ date: '2026-01-31', repeat: { every: 'month', until: '2026-04-30' } })]).map(e => e.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(expandRepeats([event({ repeat: { every: 'week', until: '2026-10-22' } })])[1].id).toBe('e1@2026-10-22');
  });
  it('personal events are visible to the owner and participants only', () => {
    const e = event({ ownerId: 'a', participants: [{ id: 'b', name: '沈禾' }] });
    expect([calendarVisibleTo(e, 'a'), calendarVisibleTo(e, 'b'), calendarVisibleTo(e, 'c')]).toEqual([true, true, false]);
    expect(calendarVisibleTo(event(), 'c')).toBe(true);
  });
  it('lists a reminder inside its window on the day, including repeat occurrences', () => {
    const state = createMistState({ id: () => 'x', now: '2026-10-22T00:00:00Z', actorName: 'a' } as MistContext, 'empty');
    state.calendar = [event({ remindMinutes: 30, repeat: { every: 'week', until: '2026-11-30' } })];
    const at = (now: string) => mistWorkQueue(state, { canRead: () => true, me: 'a', today: '2026-10-22', now }).filter(i => i.source === 'calendar');
    expect(at('2026-10-22T00:20:00Z')).toEqual([]);
    expect(at('2026-10-22T00:40:00Z')).toEqual([expect.objectContaining({ id: 'calendar:e1@2026-10-22', title: '周例会', target: { view: 'calendar', section: '2026-10-22' } })]);
    expect(at('2026-10-22T01:10:00Z')).toEqual([]);
  });
});
