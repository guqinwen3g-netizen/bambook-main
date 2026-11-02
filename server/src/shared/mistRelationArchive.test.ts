import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistContext } from './mistWorkspace';
import { relationBusiness } from './mistRelationBusiness';
/** mar30：还有在手业务时服务端拒绝归档关系档案，并写操作记录（智能体或接口不能绕过页面拦截）。 */
let n = 0;
const ctx = (): MistContext => ({ id: () => 'ra-' + (++n), now: '2026-10-14T02:00:00.000Z', actorName: '业务-王', actorId: '业务-王' } as MistContext);
const archive = (state: any, id: string, status: 'archived' | 'active' = 'archived') => applyMistCommand(state, { type: 'market.relation.status', payload: { id, status } } as any, ctx());
const err = (fn: () => unknown) => { try { fn(); return ''; } catch (e: any) { return `${e.code}:${e.message}`; } };
describe('关系档案归档：服务端拦截在手业务', () => {
  const state = createMistState(ctx(), 'demo');
  it('有在手业务的关系不能归档，状态不变', () => {
    const busy = state.market.relations.find(r => relationBusiness(state, r).total > 0)!;
    expect(busy).toBeTruthy();
    const e = err(() => archive(state, busy.id));
    expect(e).toContain('PRECONDITION'); expect(e).toContain('还有在手业务');
    expect(state.market.relations.find(r => r.id === busy.id)!.status).toBe('active');
  });
  it('没有在手业务的关系可以归档，并写一条操作记录；恢复同样留痕', () => {
    const idle = state.market.relations.find(r => r.status === 'active' && relationBusiness(state, r).total === 0)!;
    expect(idle).toBeTruthy();
    const done = archive(state, idle.id);
    expect(done.state.market.relations.find(r => r.id === idle.id)!.status).toBe('archived');
    expect(done.state.events[0]).toMatchObject({ entityType: 'relation', entityId: idle.id, actor: '业务-王', text: '归档关系档案 ' + idle.name });
    const back = archive(done.state, idle.id, 'active');
    expect(back.state.events[0].text).toBe('恢复关系档案 ' + idle.name);
    expect(err(() => archive(back.state, idle.id, 'active'))).toContain('CONFLICT');
  });
});
