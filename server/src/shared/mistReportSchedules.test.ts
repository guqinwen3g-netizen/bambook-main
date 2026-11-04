import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { dueReportSchedules, readReportSchedules, reportSchedulePeriod } from './mistReportSchedules';

function fixture(now = '2026-11-04T02:00:00Z') {
  let n = 0; const ctx = (actorId = 'a', at = now): MistContext => ({ id: () => `rs-${++n}`, now: at, actorName: actorId === 'a' ? '林舒' : '顾言', actorId } as MistContext);
  let state: MistState = createMistState(ctx(), 'empty');
  const run = (command: { type: string; payload: unknown }, actorId = 'a', at = now) => { const r = applyMistCommand(state, command as MistCommand, ctx(actorId, at)); state = r.state; return r.result as any; };
  return { run, get state() { return state; } };
}

describe('fin63 报表定时发送', () => {
  it('按报表类型分权限；资金月报与毛利只给报表管理者', () => {
    expect(mistCommandPermission({ type: 'report.schedule.save', payload: { kind: 'aging' } } as any)).toBe('reports:read');
    expect(mistCommandPermission({ type: 'report.schedule.save', payload: { kind: 'cash' } } as any)).toBe('reports:admin');
    expect(mistCommandPermission({ type: 'report.schedule.save', payload: { kind: 'margin' } } as any)).toBe('reports:admin');
  });
  it('每周 / 每月的本期与到期日', () => {
    // 2026-11-04 是星期三
    expect(reportSchedulePeriod({ every: 'week', day: 1 }, '2026-11-04')).toEqual({ period: '2026-11-02', due: '2026-11-02' });
    expect(reportSchedulePeriod({ every: 'week', day: 3 }, '2026-11-04')).toEqual({ period: '2026-11-04', due: '2026-11-04' });
    expect(reportSchedulePeriod({ every: 'week', day: 5 }, '2026-11-04')).toEqual({ period: '2026-10-30', due: '2026-10-30' });
    expect(reportSchedulePeriod({ every: 'month', day: 1 }, '2026-11-04')).toEqual({ period: '2026-11', due: '2026-11-01' });
    expect(reportSchedulePeriod({ every: 'month', day: 20 }, '2026-01-04')).toEqual({ period: '2025-12', due: '2025-12-20' });
  });
  it('订阅后到期才列为待发，登记已发后本期消失，下期再出现；只能管本人的订阅', () => {
    const f = fixture('2026-11-02T02:00:00Z');
    expect(() => f.run({ type: 'report.schedule.save', payload: { kind: 'aging', every: 'week', day: 1, to: 'boss@example' } })).toThrow('邮箱格式');
    expect(() => f.run({ type: 'report.schedule.save', payload: { kind: 'aging', every: 'month', day: 30, to: 'boss@example.com' } })).toThrow('1–28');
    const id = f.run({ type: 'report.schedule.save', payload: { kind: 'aging', every: 'week', day: 1, to: 'boss@example.com；cfo@example.com', note: '周一早会用' } }, 'a', '2026-11-02T02:00:00Z').id;
    expect(readReportSchedules(f.state)[0]).toMatchObject({ ownerId: 'a', to: 'boss@example.com, cfo@example.com', active: true });
    expect(dueReportSchedules(f.state, 'a', '2026-11-02').map(x => x.period)).toEqual(['2026-11-02']);
    expect(dueReportSchedules(f.state, 'b', '2026-11-02')).toEqual([]);
    expect(() => f.run({ type: 'report.schedule.sent', payload: { id, period: '2026-11-02' } }, 'b', '2026-11-02T03:00:00Z')).toThrow('本人');
    expect(() => f.run({ type: 'report.schedule.sent', payload: { id, period: '2026-10-26' } }, 'a', '2026-11-02T03:00:00Z')).toThrow('期次');
    f.run({ type: 'report.schedule.sent', payload: { id, period: '2026-11-02' } }, 'a', '2026-11-02T03:00:00Z');
    expect(dueReportSchedules(f.state, 'a', '2026-11-05')).toEqual([]);
    expect(dueReportSchedules(f.state, 'a', '2026-11-09').map(x => x.period)).toEqual(['2026-11-09']);
    f.run({ type: 'report.schedule.stop', payload: { id } });
    expect(dueReportSchedules(f.state, 'a', '2026-11-09')).toEqual([]);
  });
  it('新建当天之前的期次不补发', () => {
    const f = fixture('2026-11-04T02:00:00Z');
    f.run({ type: 'report.schedule.save', payload: { kind: 'orders', every: 'week', day: 1, to: 'pm@example.com' } });
    expect(dueReportSchedules(f.state, 'a', '2026-11-04')).toEqual([]);
    expect(dueReportSchedules(f.state, 'a', '2026-11-09')).toHaveLength(1);
  });
});
