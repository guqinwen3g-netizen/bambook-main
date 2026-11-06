import { describe, expect, it } from 'vitest';
import { mistNavCounts } from './workQueue';

const base = { tasks: [], fulfillment: { qcTasks: [], shipments: [] }, payables: { requests: [] } } as any;
const task = (id: string, view: string, patch: any = {}) => ({ id, title: id, due: '', done: false, kind: 'work', target: { view, id: 'x' }, assigneeIds: ['u1'], ...patch });
describe('mistNavCounts', () => {
  it('counts risk owner work consistently and excludes approval, closed, unowned and unreadable risks', () => {
    const state = { ...base, platform: { risks: [
      { id: 'new', ownerId: 'u1', state: 'Open' },
      { id: 'ack', ownerId: 'u1', state: 'Acknowledged' },
      { id: 'late', ownerId: 'u1', state: 'InProgress', planDue: '2026-10-01' },
      { id: 'approval', ownerId: 'u1', state: 'Escalated' },
      { id: 'closed', ownerId: 'u1', state: 'Resolved' },
      { id: 'other', ownerId: 'u2', state: 'Open' },
      { id: 'unbound', owner: 'u1', state: 'Open' },
    ] } } as any;
    const options = { canRead: () => true, me: 'u1', today: '2026-10-15' };
    expect(mistNavCounts(state, options)).toEqual({ cockpit: 3, risks: 3 });
    expect(mistNavCounts(state, { ...options, canRead: view => view !== 'risks' })).toEqual({});
    expect(mistNavCounts(state, { ...options, me: '' })).toEqual({});
  });
  it('counts what waits for me per module, with 我的工作 as the total', () => {
    const state = { ...base,
      tasks: [task('t1', 'development/detail'), task('t2', 'development/detail', { done: true }), task('t3', 'orders/detail'), task('t4', 'orders/detail', { assigneeIds: ['u2'] }), task('t5', 'orders/detail', { assigneeIds: [] }), task('t6', 'invoices', { assigneeIds: [], permission: 'invoices:write' })],
      fulfillment: { qcTasks: [{ id: 'q1', code: 'QC-1', source: { kind: 'orderLine', orderId: 'o1', lineId: 'l1' }, kind: 'sample', domain: 'garment', state: 'reported', reportIds: ['report-1'], factory: 'F', createdAt: '2026-10-01' }], shipments: [] },
      // 存量记录（订单、开发案总数）不计入侧栏数字。
      orders: [{ id: 'o1' }, { id: 'o2' }], devs: [{ id: 'd1' }, { id: 'd2' }] };
    const reviews = [{ id: 'r1', workspaceId: 'w1', workspaceName: '甲', title: '本公司', status: 'pending', canDecide: true, submittedAt: '2026-10-16T00:00:00Z', target: { view: 'orders/detail', id: 'o1' } }, { id: 'r2', workspaceId: 'w2', workspaceName: '乙', title: '其他公司', status: 'pending', canDecide: true, submittedAt: '2026-10-16T00:00:00Z', target: { view: 'orders/detail', id: 'o9' } }] as any;
    const counts = mistNavCounts(state, { canRead: () => true, can: p => p === 'orders:write' || p === 'invoices:write', me: 'u1', today: '2026-10-17', reviews, workspaceId: 'w1' });
    expect(counts).toEqual({ cockpit: 6, development: 1, orders: 2, 'qc-workbench': 1, 'payment-vouchers': 1, approvals: 1 });
  });
  it('hides sources the account cannot read and returns nothing when there is no work', () => {
    const state = { ...base, fulfillment: { qcTasks: [{ id: 'q1', code: 'QC-1', source: { kind: 'orderLine', orderId: 'o1', lineId: 'l1' }, kind: 'sample', domain: 'garment', state: 'reported', factory: 'F', createdAt: '2026-10-01' }], shipments: [] } };
    expect(mistNavCounts(state, { canRead: view => view !== 'qc-workbench', can: p => p !== 'relations:admin', me: 'u1', today: '2026-10-17' })).toEqual({});
    expect(mistNavCounts(null, { canRead: () => true, me: 'u1', today: '2026-10-17' })).toEqual({});
  });
});

describe('sample handoff counts', () => {
  it('uses the same owner, return and permission rules as 我的工作', () => {
    const state = { ...base, devs: [{ id: 'd', ownerId: 'u1' }], versions: [{ id: 'v', devId: 'd', confirmations: [] }],
      fulfillment: { qcTasks: [{ id: 'q', code: 'QC', source: { kind: 'version', devId: 'd', versionId: 'v' }, kind: 'sample', domain: 'fabric', state: 'blocked', reportIds: ['r'] }], qcReports: [{ id: 'r', result: 'reject' }], shipments: [],
        samples: [{ id: 's', name: '样布', unit: '米' }], sampleMovements: [{ id: 'loan', kind: 'lend', sampleId: 's', quantity: 2, borrowerId: 'u1', expectedReturn: '2026-10-14' }] } } as any;
    const options = { canRead: () => true, can: p => p === 'orders:write', me: 'u1', today: '2026-10-15' };
    expect(mistNavCounts(state, options)).toEqual({ cockpit: 2, development: 1, samples: 1 });
    expect(mistNavCounts(state, { ...options, me: 'other' })).toEqual({});
    expect(mistNavCounts(state, { ...options, canRead: v => v !== 'samples' && v !== 'development' })).toEqual({});
    state.versions[0].qcDecision = { kind: 'resample' };
    expect(mistNavCounts(state, options)).toEqual({ cockpit: 1, samples: 1 });
    state.fulfillment.sampleMovements.push({ id: 'return', kind: 'return', sampleId: 's', loanId: 'loan', quantity: 2 });
    expect(mistNavCounts(state, options)).toEqual({});
  });
});
