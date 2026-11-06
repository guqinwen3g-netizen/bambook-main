import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext, type MistState } from './mistWorkspace';

const members = [{ id: 'u-a', name: '顾言', active: true, groups: ['fabric'] }, { id: 'u-b', name: '沈禾', active: true, groups: ['fabric'] }];
function fixture() {
  let n = 0; const ctx: MistContext = { id: () => `fs-${++n}`, now: '2026-10-17T02:00:00.000Z', actorId: 'u-a', actorName: '顾言', members } as MistContext;
  let state: MistState = createMistState(ctx, 'demo');
  const run = (command: MistCommand) => { const out = applyMistCommand(state, command, ctx); state = out.state; return out.result as { id: string }; };
  const id = run({ type: 'fabric.create', payload: { name: '棉府绸', request: '40s 府绸', ownerId: 'u-a', due: '2026-11-01' } }).id;
  return { run, id, get f() { return state.fabrics.find(x => x.id === id)!; }, get state() { return state; } };
}
describe('ord9/10 fabric sourcing', () => {
  it('edits an open request, records candidate offers and confirms the chosen one', () => {
    const t = fixture(), sup = t.state.market.suppliers[0];
    t.run({ type: 'fabric.update', payload: { id: t.id, name: '棉府绸 140cm', request: '40s 府绸，幅宽 140cm', ownerId: 'u-b', due: '2026-11-05' } });
    expect(t.f).toMatchObject({ name: '棉府绸 140cm', owner: '沈禾', due: '2026-11-05' });
    expect(() => t.run({ type: 'fabric.answer', payload: { id: t.id, answer: '', fileIds: [], candidates: [{ supplierId: sup.id, article: 'F-1', price: 'abc', currency: 'CNY', moq: '', leadDays: '', note: '' }] } })).toThrow('价格');
    t.run({ type: 'fabric.answer', payload: { id: t.id, answer: '', fileIds: [], candidates: [{ supplierId: sup.id, article: 'F-1', price: '18.5', currency: 'CNY', moq: '500 米', leadDays: '15 天', note: '' }, { supplierId: sup.id, article: 'F-2', price: '17', currency: 'CNY', moq: '1000 米', leadDays: '20 天', note: '' }] } });
    expect(t.f.candidates!.map(c => [c.supplier, c.article])).toEqual([[sup.name, 'F-1'], [sup.name, 'F-2']]);
    expect(() => t.run({ type: 'fabric.confirm', payload: { id: t.id, approved: true, note: '' } })).toThrow('请选择');
    t.run({ type: 'fabric.confirm', payload: { id: t.id, approved: true, note: '', candidateId: t.f.candidates![1].id } });
    expect(t.f).toMatchObject({ confirmed: true, chosenCandidateId: t.f.candidates![1].id });
    expect(() => t.run({ type: 'fabric.update', payload: { id: t.id, name: 'x', request: 'x', ownerId: 'u-a', due: '2026-11-05' } })).toThrow('已结案');
  });
  it.each([true, false])('does not confirm or reopen an already chosen sourcing result (approved=%s)', approved => {
    const t = fixture();
    t.run({ type: 'fabric.answer', payload: { id: t.id, answer: '已找到符合要求的面料', fileIds: [] } });
    t.run({ type: 'fabric.confirm', payload: { id: t.id, approved: true, note: '采用' } });
    const before = JSON.stringify(t.state);
    expect(() => t.run({ type: 'fabric.confirm', payload: { id: t.id, approved, note: '再次确认' } })).toThrow('已结案');
    expect(JSON.stringify(t.state)).toBe(before);
  });
  it('can replace rejected candidates with an explicit empty candidate list', () => {
    const t = fixture(), supplierId = t.state.market.suppliers[0].id;
    t.run({ type: 'fabric.answer', payload: { id: t.id, answer: '', fileIds: [], candidates: [{ supplierId, article: 'F-OLD', price: '18', currency: 'CNY', moq: '', leadDays: '', note: '' }] } });
    const oldId = t.f.candidates![0].id;
    t.run({ type: 'fabric.confirm', payload: { id: t.id, approved: false, note: '候选不符合要求' } });
    t.run({ type: 'fabric.answer', payload: { id: t.id, answer: '暂无符合要求的现货，继续寻找', fileIds: [], candidates: [] } });
    expect(t.f.candidates).toEqual([]);
    const before = JSON.stringify(t.state);
    expect(() => t.run({ type: 'fabric.confirm', payload: { id: t.id, approved: true, note: '', candidateId: oldId } })).toThrow(/候选/);
    expect(JSON.stringify(t.state)).toBe(before);
  });
  it('cancels an open request with a reason and keeps it read-only', () => {
    const t = fixture();
    expect(() => t.run({ type: 'fabric.cancel', payload: { id: t.id, reason: '' } })).toThrow('取消原因');
    t.run({ type: 'fabric.cancel', payload: { id: t.id, reason: '客户改用库存面料' } });
    expect(t.f).toMatchObject({ state: '已取消', cancelled: { reason: '客户改用库存面料' } });
    expect(() => t.run({ type: 'fabric.answer', payload: { id: t.id, answer: '有了', fileIds: [] } })).toThrow('已取消');
  });
});
