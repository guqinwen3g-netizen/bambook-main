import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { MIST_DEMO_ACCOUNTS } from './mistAccounts';
import { pendingWeeklyArchive, teamReports, teamMembers, teamOverview, teamRow, teamWeeklyReport, teamWeeklyText, weekStartOf, type TeamTask } from './mistTeam';

const today = '2026-10-18';
function fixture() {
  let i = 0; const ctx = { id: () => `tm-${++i}`, now: '2026-10-18T02:00:00Z', actorName: '周敏', actorId: 'demo-reviewer', members: MIST_DEMO_ACCOUNTS } as unknown as MistContext;
  let state = createMistState(ctx, 'demo');
  const run = (payload: Record<string, unknown>, c: Partial<MistContext> = {}) => { const r = applyMistCommand(state, { type: 'team.nudge', payload } as MistCommand, { ...ctx, ...c }); state = r.state; return r.result as { id: string }; };
  return { run, get state() { return state as MistState; } };
}
const dir = [{ id: 'a', name: '甲', groups: ['garment' as const] }, { id: 'b', name: '乙', groups: ['fabric' as const] }, { id: 'boss', name: '主管', groups: ['garment' as const] }, { id: 'c', name: '丙', groups: [] }];

describe('主管团队视角', () => {
  it('团队范围：全部成员（P4 业务员不分线；本线范围由数据范围决定）', () => {
    expect(teamMembers(dir, { id: 'boss', owner: false }).map(m => m.id)).toEqual(['a', 'b', 'boss', 'c']);
    expect(teamMembers(dir, { id: 'boss', owner: true }).map(m => m.id)).toEqual(['a', 'b', 'boss', 'c']);
    expect(teamMembers(dir, { id: 'c', owner: false }, 'fabric').map(m => m.id)).toEqual(['a', 'b', 'boss', 'c']);
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
  it('周报：按周一至周日统计新单、出运、回款（到账日）、跟进与督办完成；当前快照单列；可生成文字版', () => {
    expect(weekStartOf('2026-10-18')).toBe('2026-10-12'); expect(weekStartOf('2026-10-12')).toBe('2026-10-12'); expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
    const f = fixture(), order = f.state.orders.find(o => o.code === 'SO-G-2026-018')!;
    const { id } = f.run({ assigneeId: 'demo-sales', title: '和工厂核对交期', due: '2026-10-20', target: { view: 'orders/detail', id: order.id } });
    const s = applyMistCommand(f.state, { type: 'task.complete', payload: { id, done: true } } as MistCommand, { id: () => 'z', now: '2026-10-18T03:00:00Z', actorName: '顾言', actorId: 'demo-sales' } as unknown as MistContext).state;
    expect(s.tasks.find(t => t.id === id)).toMatchObject({ done: true, doneAt: '2026-10-18T03:00:00Z', doneBy: '顾言' });
    order.createdAt = '2026-10-13T02:00:00Z';
    const inv = s.invoices.find(i => i.orderId === order.id)!;
    s.receipts.push({ id: 'rc-w', code: 'RC-W', date: '2026-10-14', payer: 'x', amount: 100, remaining: 0, currency: inv.currency, ref: '', state: 'matched' });
    s.allocations.push({ id: 'al-w', receiptId: 'rc-w', invoiceId: inv.id, amount: 100, currency: inv.currency, createdAt: '2026-10-19T02:00:00Z', actor: '财务' });
    const dir = MIST_DEMO_ACCOUNTS.map(a => ({ ...a }));
    const week = teamWeeklyReport(s, dir, { id: 'demo-reviewer', owner: true }, '2026-10-12', today);
    const sales = week.rows.find(r => r.id === 'demo-sales')!;
    expect(sales.newOrders).toBeGreaterThanOrEqual(1);
    expect(sales.collected.find(c => c.currency === inv.currency)!.amount).toBeGreaterThanOrEqual(100);
    expect(sales).toMatchObject({ nudgesIn: 1, nudgesDone: 1, nudgesOpenLate: 0 });
    expect(week.asOf).toBe(today);
    const prev = teamWeeklyReport(s, dir, { id: 'demo-reviewer', owner: true }, '2026-10-05', today);
    expect(prev.rows.find(r => r.id === 'demo-sales')).toMatchObject({ nudgesIn: 0, nudgesDone: 0 });
    expect(prev.asOf).toBe('2026-10-11');
    const text = teamWeeklyText(week);
    expect(text).toContain('团队周报（2026-10-12 至 2026-10-18）');
    expect(text).toContain('· 顾言');
    // 取消完成后完成时间清除
    const undone = applyMistCommand(s, { type: 'task.complete', payload: { id, done: false } } as MistCommand, { id: () => 'y', now: '2026-10-18T04:00:00Z', actorName: '顾言', actorId: 'demo-sales' } as unknown as MistContext).state;
    expect(undone.tasks.find(t => t.id === id)!.doneAt).toBeUndefined();
  });
  it('周报存档：只存已结束、周一开头的周；同一人同一周只存一次；存后“我的工作”提醒消失', () => {
    expect(mistCommandPermission({ type: 'team.weekly.archive', payload: {} } as unknown as MistCommand)).toBe('relations:admin');
    const f = fixture();
    const arc = (weekStart: string, c: Partial<MistContext> = {}) => { const r = applyMistCommand(f.state, { type: 'team.weekly.archive', payload: { weekStart } } as MistCommand, { id: () => 'wr-1', now: '2026-10-19T01:00:00Z', actorName: '周敏', actorId: 'demo-reviewer', members: MIST_DEMO_ACCOUNTS, ...c } as unknown as MistContext); return r; };
    expect(pendingWeeklyArchive(f.state, 'demo-reviewer', '2026-10-19')).toBe('2026-10-12');
    expect(pendingWeeklyArchive(f.state, 'demo-reviewer', '2026-10-18')).toBe('2026-10-05');
    expect(() => arc('2026-10-13')).toThrow('周一');
    expect(() => arc('2026-10-19')).toThrow('还没结束');
    expect(() => arc('2026-10-12', { members: undefined })).toThrow('成员');
    const r = arc('2026-10-12');
    const saved = teamReports(r.state);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ weekStart: '2026-10-12', weekEnd: '2026-10-18', generatedBy: '周敏', generatedById: 'demo-reviewer', scope: '全部成员（管理业务线：面料、成衣）' });
    expect(saved[0].text).toContain('团队周报 · 全部成员（管理业务线：面料、成衣）');
    expect(saved[0].report.rows.some(x => x.id === 'demo-sales')).toBe(true);
    expect(pendingWeeklyArchive(r.state, 'demo-reviewer', '2026-10-19')).toBeNull();
    expect(pendingWeeklyArchive(r.state, 'demo-buyer', '2026-10-19')).toBe('2026-10-12');
    expect(() => applyMistCommand(r.state, { type: 'team.weekly.archive', payload: { weekStart: '2026-10-12' } } as MistCommand, { id: () => 'wr-2', now: '2026-10-19T02:00:00Z', actorName: '周敏', actorId: 'demo-reviewer', members: MIST_DEMO_ACCOUNTS } as unknown as MistContext)).toThrow('已于');
  });
});
