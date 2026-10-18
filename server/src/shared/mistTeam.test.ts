import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { MIST_DEMO_ACCOUNTS } from './mistAccounts';
import { teamMembers, teamOverview, teamRow, type TeamTask } from './mistTeam';

const today = '2026-10-18';
function fixture() {
  let i = 0; const ctx = { id: () => `tm-${++i}`, now: '2026-10-18T02:00:00Z', actorName: '周敏', actorId: 'demo-reviewer', members: MIST_DEMO_ACCOUNTS } as unknown as MistContext;
  let state = createMistState(ctx, 'demo');
  const run = (payload: Record<string, unknown>, c: Partial<MistContext> = {}) => { const r = applyMistCommand(state, { type: 'team.nudge', payload } as MistCommand, { ...ctx, ...c }); state = r.state; return r.result as { id: string }; };
  return { run, get state() { return state as MistState; } };
}
const dir = [{ id: 'a', name: '甲', groups: ['garment' as const] }, { id: 'b', name: '乙', groups: ['fabric' as const] }, { id: 'boss', name: '主管', groups: ['garment' as const] }, { id: 'c', name: '丙', groups: [] }];

describe('主管团队视角', () => {
  it('团队范围：所有者或未设业务组看全部，否则看同业务组成员（含本人）', () => {
    expect(teamMembers(dir, { id: 'boss', owner: false }).map(m => m.id)).toEqual(['a', 'boss']);
    expect(teamMembers(dir, { id: 'boss', owner: true }).map(m => m.id)).toEqual(['a', 'b', 'boss', 'c']);
    expect(teamMembers(dir, { id: 'c', owner: false }).map(m => m.id)).toEqual(['a', 'b', 'boss', 'c']);
    expect(teamMembers(dir, { id: 'c', owner: false }, 'fabric').map(m => m.id)).toEqual(['b']);
  });
  it('每人在手：逾期/临近订单、逾期待办、逾期应收按币种、久未跟进客户，并按关注程度排序', () => {
    const f = fixture(), s = f.state;
    const sales = teamRow(s, { id: 'demo-sales', name: '顾言' }, today);
    expect(sales.orders.map(o => o.code)).toEqual(['SO-G-2026-018', 'SO-F-2026-0006', 'SO-G-2026-015']);
    expect(sales.orders.every(o => o.status === 'ontrack')).toBe(true);
    expect(sales.tasks.filter(t => t.overdue).length).toBe(2);
    expect(sales.receivables.length).toBeGreaterThan(0);
    expect(sales.overdueReceivable.every(r => r.amount > 0)).toBe(true);
    expect(sales.attention).not.toBe('ok');
    // 已结清的订单不算在手；终止订单不算
    const order = s.orders.find(o => o.code === 'SO-G-2026-018')!;
    (order as any).governance = { ...(order as any).governance, status: 'cancelled' };
    expect(teamRow(s, { id: 'demo-sales', name: '顾言' }, today).orders.map(o => o.code)).not.toContain('SO-G-2026-018');
    // 前成员名下仍有业务：单独列出、最需关注
    s.customers[0].ownerId = 'gone'; s.customers[0].owner = '离职同事';
    const rows = teamOverview(s, MIST_DEMO_ACCOUNTS.map(a => ({ ...a })), { id: 'demo-reviewer', owner: true }, today);
    const gone = rows.find(r => r.id === 'gone')!;
    expect(gone).toMatchObject({ former: true, attention: 'bad', name: '离职同事' });
    expect(gone.reasons[0]).toContain('待交接');
    expect(rows.findIndex(r => r.attention === 'bad')).toBe(0);
  });
  it('督办：主管权限、派给在用成员的带期限待办；不能督办自己、不能重复、期限不能早于今天', () => {
    expect(mistCommandPermission({ type: 'team.nudge', payload: {} } as unknown as MistCommand)).toBe('relations:admin');
    const f = fixture(), order = f.state.orders.find(o => o.code === 'SO-G-2026-018')!;
    const target = { view: 'orders/detail', id: order.id };
    expect(() => f.run({ assigneeId: 'demo-reviewer', title: '核对交期', due: '2026-10-20', target })).toThrow('不能督办自己');
    expect(() => f.run({ assigneeId: 'demo-sales', title: '核对交期', due: '2026-10-17', target })).toThrow('不能早于今天');
    expect(() => f.run({ assigneeId: 'demo-sales', title: '核', due: '2026-10-20', target })).toThrow('2–60');
    expect(() => f.run({ assigneeId: 'demo-sales', title: '核对交期', due: '2026-10-20', target: { view: 'shipments', id: 'x' } })).toThrow('只能是订单');
    expect(() => f.run({ assigneeId: 'nobody', title: '核对交期', due: '2026-10-20', target })).toThrow('成员账号');
    const { id } = f.run({ assigneeId: 'demo-sales', title: '和工厂核对交期', due: '2026-10-20', note: '客户在问', target });
    const task = f.state.tasks.find(t => t.id === id) as TeamTask;
    expect(task).toMatchObject({ title: '督办：和工厂核对交期', kind: 'supervision', assigneeIds: ['demo-sales'], due: '2026-10-20', target, nudge: { byId: 'demo-reviewer', by: '周敏', note: '客户在问' } });
    expect(f.state.events[0]).toMatchObject({ entityType: 'order', entityId: order.id, actor: '周敏' });
    expect(() => f.run({ assigneeId: 'demo-sales', title: '再催一次', due: '2026-10-21', target })).toThrow('督办过');
    expect(teamRow(f.state, { id: 'demo-sales', name: '顾言' }, today).nudges.map(n => n.id)).toEqual([id]);
    const done = applyMistCommand(f.state, { type: 'task.complete', payload: { id, done: true } } as MistCommand, { id: () => 'z', now: '2026-10-18T03:00:00Z', actorName: '顾言', actorId: 'demo-sales' } as unknown as MistContext).state;
    expect(teamRow(done, { id: 'demo-sales', name: '顾言' }, today).nudges).toEqual([]);
  });
});
