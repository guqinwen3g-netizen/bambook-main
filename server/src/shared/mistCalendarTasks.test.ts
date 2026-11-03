import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';

const members = [{ id: 'a', name: '顾言', active: true, groups: ['garment'] }, { id: 'b', name: '沈禾', active: true, groups: ['garment'] }];
function fixture() {
  let n = 0; const ctx = (actorId = 'a', actorName = '顾言') => ({ id: () => `ct-${++n}`, now: '2026-10-14T02:00:00Z', actorId, actorName, members } as MistContext);
  let state: MistState = createMistState(ctx(), 'empty');
  const run = (command: MistCommand, c = ctx()) => { const out = applyMistCommand(state, command, c); state = out.state; return out.result as { id: string }; };
  return { run, ctx, get state() { return state; } };
}
describe('mar59/mar60/mar64 calendar delete, personal events and personal tasks', () => {
  it('deletes events, and only the owner may delete a personal event', () => {
    const f = fixture();
    expect(mistCommandPermission({ type: 'calendar.delete', payload: { id: 'x' } } as MistCommand)).toBeNull();
    const shared = f.run({ type: 'calendar.save', payload: { title: '周会', date: '2026-10-15', time: '09:00', note: '' } }).id;
    const mine = f.run({ type: 'calendar.save', payload: { title: '看病', date: '2026-10-15', time: '14:00', note: '', personal: true } }).id;
    expect(f.state.calendar.find(e => e.id === mine)).toMatchObject({ ownerId: 'a' });
    expect(() => f.run({ type: 'calendar.delete', payload: { id: mine } }, f.ctx('b', '沈禾'))).toThrow('本人');
    f.run({ type: 'calendar.delete', payload: { id: shared } }, f.ctx('b', '沈禾'));
    f.run({ type: 'calendar.delete', payload: { id: mine } });
    expect(f.state.calendar).toEqual([]);
  });
  it('mar60: participants, reminders and repeats; participants may edit a personal event', () => {
    const f = fixture();
    const id = f.run({ type: 'calendar.save', payload: { title: '周例会', date: '2026-10-15', time: '09:00', note: '', personal: true, participantIds: ['b', 'a'], remindMinutes: 15, repeat: { every: 'week', until: '2026-11-30' } } }).id;
    expect(f.state.calendar.find(e => e.id === id)).toMatchObject({ ownerId: 'a', participants: [{ id: 'b', name: '沈禾' }], remindMinutes: 15, repeat: { every: 'week', until: '2026-11-30' } });
    expect(() => f.run({ type: 'calendar.save', payload: { title: 'x', date: '2026-10-15', time: '09:00', note: '', participantIds: ['nobody'] } })).toThrow();
    expect(() => f.run({ type: 'calendar.save', payload: { title: 'x', date: '2026-10-15', time: '09:00', note: '', repeat: { every: 'week', until: '2026-10-01' } } })).toThrow('结束日');
    expect(() => f.run({ type: 'calendar.save', payload: { title: 'x', date: '2026-10-15', time: '09:00', note: '', remindMinutes: -5 } })).toThrow('提醒');
    f.run({ type: 'calendar.save', payload: { id, title: '周例会（改）', date: '2026-10-15', time: '10:00', note: '' } }, f.ctx('b', '沈禾'));
    expect(f.state.calendar.find(e => e.id === id)).toMatchObject({ title: '周例会（改）', ownerId: 'a', participants: [{ id: 'b' }], repeat: { every: 'week' } });
    f.run({ type: 'calendar.save', payload: { id, title: '周例会', date: '2026-10-15', time: '10:00', note: '', repeat: null } });
    expect(f.state.calendar.find(e => e.id === id)!.repeat).toBeUndefined();
  });
  it('creates a personal task, reschedules and reassigns it, and only changes due/assignee on system tasks', () => {
    const f = fixture();
    const id = f.run({ type: 'task.save', payload: { title: '整理样衣间', due: '2026-10-20' } }).id;
    expect(f.state.tasks[0]).toMatchObject({ id, kind: 'personal', assigneeIds: ['a'], done: false });
    f.run({ type: 'task.save', payload: { id, title: '整理样衣间并拍照', due: '2026-10-22', assigneeId: 'b', note: '周四前' } });
    expect(f.state.tasks.find(t => t.id === id)).toMatchObject({ title: '整理样衣间并拍照', due: '2026-10-22', assigneeIds: ['b'], note: '周四前' });
    f.state.tasks.unshift({ id: 'sys', title: '核对 SO-1 出运交接', due: '2026-10-18', done: false, kind: 'shipping', target: { view: 'orders/detail', id: 'o' }, assigneeIds: [] });
    f.run({ type: 'task.save', payload: { id: 'sys', title: '改名', due: '2026-10-21', assigneeId: 'b' } });
    expect(f.state.tasks.find(t => t.id === 'sys')).toMatchObject({ title: '核对 SO-1 出运交接', due: '2026-10-21', assigneeIds: ['b'] });
  });
});
