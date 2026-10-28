import { expect, it } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { ALL_TEAMS, teamOrigins, teamViewState } from './teamView';

// 示例数据：customer-2 名下只有订单 SO-G-2026-012。
const demo = () => { let n = 0; const state: any = createMistState({ id: () => `id-${++n}`, now: '2026-10-13T00:00:00Z', actorName: 'boss' } as any, 'demo');
  state.teamScopes = [{ teamId: 't1', teamName: 'Lune', conditions: [{ id: 'c1', customerId: 'customer-2' }], picks: [], exclusions: [], updatedAt: '', updatedById: 'boss', updatedBy: 'boss', history: [] }];
  return state; };

it('narrows the received data to the chosen group and leaves the "all" view untouched', () => {
  const state = demo();
  expect(teamViewState(state, ALL_TEAMS, 'demo-sales')).toBe(state);
  const view = teamViewState(state, 't1', 'demo-sales');
  expect(view.orders.map(o => o.id)).toEqual(['SO-G-2026-012']);
  expect(view.orderLines.every(line => line.orderId === 'SO-G-2026-012')).toBe(true);
  expect(view.customers).toHaveLength(state.customers.length); // 档案共享，不按视角收窄
  expect(view.tasks.filter(task => task.assigneeIds?.includes('demo-sales'))).toEqual(state.tasks.filter((task: any) => task.assigneeIds?.includes('demo-sales'))); // 本人待办保留
  expect(teamViewState(state, 't1', 'demo-sales')).toBe(view); // 同一份数据只计算一次
});

it('names the own groups a record is shared through', () => {
  const state = demo();
  expect(teamOrigins(state, [{ id: 't1', name: 'Maison Lune 组' }], 'order', 'SO-G-2026-012')).toEqual(['Maison Lune 组']);
  expect(teamOrigins(state, [{ id: 't1', name: 'Maison Lune 组' }], 'order', 'SO-G-2026-018')).toEqual([]);
  expect(teamOrigins(state, [{ id: 'other', name: '别组' }], 'order', 'SO-G-2026-012')).toEqual([]);
});

it('uses server-resolved group references when HR configuration is hidden', () => {
  const state = demo(); delete state.teamScopes;
  const views = { t1: [{kind: 'order' as const, id: 'SO-G-2026-012'}] };
  expect(teamViewState(state, 't1', 'demo-sales', views).orders.map(row => row.id)).toEqual(['SO-G-2026-012']);
  expect(teamViewState(state, 't2', 'demo-sales', views).orders).toEqual([]);
  expect(teamOrigins(state, [{id:'t1',name:'一组'}], 'order', 'SO-G-2026-012', views)).toEqual(['一组']);
});

it('preserves server partial financial redactions on a second group projection', () => {
  const state = demo();
  state.partialLettersOfCredit = [{id:'lc',code:'LC',lcNo:'LC',customerId:'customer-2',customer:'test',currency:'USD',orderIds:['SO-G-2026-012','SO-G-2026-018'],hiddenCount:3,cancelled:false}];
  state.partialExpenses = [{id:'expense', code:'E',category:'other',date:'2026-10-01',currency:'USD',shares:[{orderId:'SO-G-2026-012',amount:10},{orderId:'SO-G-2026-018',amount:20}],hiddenCount:2,voided:false}];
  const view = teamViewState(state, 't1', 'demo-sales');
  expect(view.partialLettersOfCredit?.[0]).toMatchObject({orderIds:['SO-G-2026-012'],hiddenCount:4});
  expect(view.partialExpenses?.[0]).toMatchObject({shares:[{orderId:'SO-G-2026-012',amount:10}],hiddenCount:3});
  expect(state.partialLettersOfCredit[0].hiddenCount).toBe(3);
});
