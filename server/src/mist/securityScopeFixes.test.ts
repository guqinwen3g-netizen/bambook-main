import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import { applyMistCommand, createMistState, type MistCommand, type MistContext, type MistState, type MistTask } from '../shared/mistWorkspace';
import { accountHandovers } from '../shared/mistHandover';
import { MIST_READ_SECTIONS, projectState } from './access';
import { MistRepository } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';

/** 2026-11 安全复核回归：私人日程、待办办理资格、审批回执公司边界、成员交接档案范围。 */
const now = '2026-10-14T04:00:00.000Z';
const READ_ALL = [...new Set(MIST_READ_SECTIONS.flatMap(section => section.permissions))];
const actor = (id = 'other') => ({ ...testActor(id), roles: [], authorizationLoaded: true as const });
let directory: string, workspaceId: string, db: MemoryMistDatabase, repo: MistRepository, auth: ReturnType<typeof testAuthority>;
const execute = (command: MistCommand, requestId = command.type + '-' + randomUUID(), subject = actor()) =>
  repo.execute(subject, workspaceId, { requestId, expectedRevision: db.workspaces.get(workspaceId).revision, command });
const stored = () => db.workspaces.get(workspaceId).state as MistState;
const task = (id: string, patch: Partial<MistTask> = {}): MistTask => ({ id, title: id, due: '2026-10-20', done: false, kind: 'finance', target: { view: 'orders/list', id: 'order' }, assigneeIds: [], ...patch });

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-security-scope-'));
  db = new MemoryMistDatabase(); auth = testAuthority();
  auth.users.get('owner')!.permissions = [...READ_ALL, 'vouchers:write', 'invoices:write', 'invoices:reconcile'];
  auth.users.get('other')!.permissions = ['orders:read'];
  auth.users.set('third', { active: true, permissions: ['orders:read'] });
  repo = new MistRepository(db, contract, new MistPrivateFiles(directory), auth.authorize, () => new Date(now));
  workspaceId = (await repo.create(actor('owner'), { name: '安全复核', seed: 'empty' })).id;
  const state = stored();
  state.memberIds = ['other', 'third'];
  state.members = [{ userId: 'other', name: 'other', addedBy: 'owner', addedByName: 'owner', addedAt: now }, { userId: 'third', name: 'third', addedBy: 'owner', addedByName: 'owner', addedAt: now }] as any;
  state.calendar.push(
    { id: 'shared', title: '公司例会', date: '2026-10-15', time: '09:00', note: '' },
    { id: 'owner-private', title: '体检 PRIVATE-OWNER', date: '2026-10-15', time: '10:00', note: '私事 PRIVATE-NOTE', ownerId: 'owner', owner: 'owner' },
    { id: 'owner-with-third', title: '面谈 PRIVATE-PAIR', date: '2026-10-15', time: '11:00', note: '', ownerId: 'owner', owner: 'owner', participants: [{ id: 'third', name: 'third' }] },
    { id: 'other-private', title: '本人日程', date: '2026-10-15', time: '12:00', note: '', ownerId: 'other', owner: 'other' },
  );
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('1. 私人日程只下发给本人和参与人', () => {
  it('读取工作区时按本人和参与人过滤日程，原文不出现在响应中', async () => {
    const other = await repo.get(actor('other'), workspaceId);
    expect(other.state.calendar.map(e => e.id).sort()).toEqual(['other-private', 'shared']);
    expect(JSON.stringify(other)).not.toMatch(/PRIVATE-(OWNER|NOTE|PAIR)/);
    const third = await repo.get(actor('third'), workspaceId);
    expect(third.state.calendar.map(e => e.id).sort()).toEqual(['owner-with-third', 'shared']);
    const owner = await repo.get(actor('owner'), workspaceId);
    expect(owner.state.calendar.map(e => e.id).sort()).toEqual(['owner-private', 'owner-with-third', 'shared']);
  });

  it('无行级范围的全权限账号同样看不到他人私人日程', () => {
    auth.users.set('boss', { active: true, permissions: READ_ALL });
    const visible = projectState(stored(), { ...actor('boss'), permissions: READ_ALL }, () => createMistState({ id: () => 'x', now, actorName: 'x' }, 'empty')).state;
    expect(visible.calendar.map(e => e.id)).toEqual(['shared']);
  });

  it('知道他人私人日程编号也不能修改、删除或预演，且不回显原文', async () => {
    const before = structuredClone(stored().calendar), receipts = db.receipts.size;
    for (const command of [
      { type: 'calendar.save', payload: { id: 'owner-private', title: '改', date: '2026-10-15', time: '10:00', note: '' } },
      { type: 'calendar.delete', payload: { id: 'owner-private' } },
    ] as MistCommand[]) {
      const error = await execute(command).catch(e => e);
      expect(error).toMatchObject({ status: 404 });
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
      const preview = await repo.preview(actor('other'), workspaceId, { requestId: 'preview-' + randomUUID(), expectedRevision: db.workspaces.get(workspaceId).revision, command }).catch(e => e);
      expect(preview).toMatchObject({ status: 404 });
    }
    expect(stored().calendar).toEqual(before);
    expect(db.receipts.size).toBe(receipts);
  });

  it('参与人仍可修改，但删除仍只限本人（现有限制不变）', async () => {
    await execute({ type: 'calendar.save', payload: { id: 'owner-with-third', title: '面谈（改）', date: '2026-10-15', time: '11:30', note: '' } }, 'third-edit', actor('third'));
    expect(stored().calendar.find(e => e.id === 'owner-with-third')).toMatchObject({ title: '面谈（改）', ownerId: 'owner' });
    await expect(execute({ type: 'calendar.delete', payload: { id: 'owner-with-third' } }, 'third-delete', actor('third'))).rejects.toMatchObject({ status: 403 });
  });

  it('共享日程不能被任何成员改成私人日程；参与人不能再把私人日程分享给他人', async () => {
    const before = structuredClone(stored().calendar);
    await expect(execute({ type: 'calendar.save', payload: { id: 'shared', title: '例会', date: '2026-10-15', time: '09:00', note: '', personal: true } } as MistCommand)).rejects.toMatchObject({ status: 403 });
    await expect(execute({ type: 'calendar.save', payload: { id: 'owner-with-third', title: '面谈', date: '2026-10-15', time: '11:30', note: '', participantIds: ['third', 'other'] } } as MistCommand, 'third-share', actor('third'))).rejects.toMatchObject({ status: 403 });
    expect(stored().calendar).toEqual(before);
    const owner = await repo.get(actor('owner'), workspaceId);
    expect(owner.state.calendar.some(e => e.id === 'shared')).toBe(true);
  });
});

describe('2. 修改已有待办须具备办理资格', () => {
  beforeEach(() => {
    stored().tasks.push(
      task('assigned-owner', { assigneeIds: ['owner'] }),
      task('assigned-other', { assigneeIds: ['other'] }),
      task('pool-duty', { permission: 'logistics:handle' }),
      task('pool-target'),
      task('hidden', { assigneeIds: ['owner'], target: { view: 'payables', id: 'bill' } }),
      task('email-review', { kind: 'email-extraction-review', assigneeIds: ['owner'] }),
      task('internal-delivery:d1', { kind: 'internal-delivery', assigneeIds: ['owner'] }),
    );
  });
  const complete = (id: string, subject = actor()) => execute({ type: 'task.complete', payload: { id, done: true } }, 'complete-' + id + '-' + randomUUID(), subject);
  const save = (id: string, subject = actor()) => execute({ type: 'task.save', payload: { id, title: id, due: '2026-10-25', assigneeId: subject.userId } } as MistCommand, 'save-' + id + '-' + randomUUID(), subject);

  it('可见但指派给他人的事项：完成与改派都返回 403，状态与回执不变', async () => {
    const before = structuredClone(stored()), receipts = db.receipts.size;
    for (const run of [complete, save]) await expect(run('assigned-owner')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: '只能办理指派给本人的事项' });
    expect(stored()).toEqual(before);
    expect(db.receipts.size).toBe(receipts);
  });

  it('不可见事项仍统一 404，不泄露存在性', async () => {
    await expect(complete('hidden')).rejects.toMatchObject({ status: 404 });
    await expect(complete('no-such-task')).rejects.toMatchObject({ status: 404 });
  });

  it('指派给本人的事项可以办理', async () => {
    await complete('assigned-other');
    expect(stored().tasks.find(t => t.id === 'assigned-other')).toMatchObject({ done: true, doneBy: 'other' });
  });

  it('公共待办池：有岗位权限的可办，没有的 403；无岗位权限时须对来源有写入权限', async () => {
    await expect(complete('pool-duty')).rejects.toMatchObject({ status: 403 });
    await expect(complete('pool-target')).rejects.toMatchObject({ status: 403 });
    auth.users.get('other')!.permissions = ['orders:read', 'logistics:handle'];
    await complete('pool-duty');
    await expect(complete('pool-target')).rejects.toMatchObject({ status: 403 });
    auth.users.get('other')!.permissions = ['orders:read', 'orders:write'];
    await complete('pool-target');
    expect(stored().tasks.filter(t => t.done).map(t => t.id).sort()).toEqual(['pool-duty', 'pool-target']);
  });

  it('有指派人且标了岗位权限的事项：岗位持有人也可办理（与“我的工作”归属一致），其他人仍 403', async () => {
    stored().tasks.push(task('duty-assigned', { assigneeIds: ['owner'], permission: 'invoices:reconcile' }));
    await expect(complete('duty-assigned')).rejects.toMatchObject({ status: 403 });
    auth.users.get('other')!.permissions = ['orders:read', 'invoices:reconcile'];
    await complete('duty-assigned');
    expect(stored().tasks.find(t => t.id === 'duty-assigned')).toMatchObject({ done: true, doneBy: 'other' });
  });

  it('业务主管（relations:admin）可调度他人待办', async () => {
    auth.users.get('other')!.permissions = ['orders:read', 'relations:admin'];
    await save('assigned-owner');
    expect(stored().tasks.find(t => t.id === 'assigned-owner')).toMatchObject({ assigneeIds: ['other'], due: '2026-10-25' });
  });

  it('新建个人待办保持现状：可以给他人建', async () => {
    await execute({ type: 'task.save', payload: { title: '帮我核对', due: '2026-10-25', assigneeId: 'third' } } as MistCommand);
    expect(stored().tasks.find(t => t.title === '帮我核对')).toMatchObject({ assigneeIds: ['third'], kind: 'personal' });
  });

  it('只读权限不能作为办理依据：持 orders:read 的同事不能改派或完成标了只读权限的待办', async () => {
    stored().tasks.push(task('read-duty', { assigneeIds: ['owner'], permission: 'orders:read' }), task('read-pool', { permission: 'orders:read' }));
    for (const id of ['read-duty', 'read-pool']) for (const run of [complete, save]) await expect(run(id)).rejects.toMatchObject({ status: 403 });
    expect(stored().tasks.find(t => t.id === 'read-duty')).toMatchObject({ assigneeIds: ['owner'], done: false });
  });

  it('内部交付与邮件复核待办也不能经通用编辑改派或改期', async () => {
    auth.users.get('other')!.permissions = ['orders:read', 'relations:admin'];
    for (const id of ['email-review', 'internal-delivery:d1']) await expect(save(id)).rejects.toMatchObject({ code: 'PRECONDITION' });
    expect(stored().tasks.find(t => t.id === 'internal-delivery:d1')).toMatchObject({ assigneeIds: ['owner'] });
  });

  it('邮件提取复核与内部交付事项不被新规则放开', async () => {
    for (const id of ['email-review', 'internal-delivery:d1']) await expect(complete(id)).rejects.toMatchObject({ status: 403 });
    auth.users.get('other')!.permissions = ['orders:read', 'relations:admin'];
    for (const id of ['email-review', 'internal-delivery:d1']) await expect(complete(id)).rejects.toMatchObject({ code: 'PRECONDITION' });
    expect(stored().tasks.filter(t => t.done)).toEqual([]);
  });
});

describe('3. 审批回执须属于当前会话的公司', () => {
  const COMPANY_A = '22222222-2222-4222-8222-222222222222', COMPANY_B = '33333333-3333-4333-8333-333333333333';
  const receipt = (wid: string, requestId: string, actorId = 'owner') => db.receipts.set(`${wid}:${requestId}`, { id: randomUUID(), workspaceId: wid, requestId, actorId, inputHash: 'x', expectedRevision: 0, result: { revision: 1, result: { reviewId: 'r1' } } });
  const company = (companyId: string) => { const id = randomUUID(); db.workspaces.set(id, { id, ownerId: 'founder', companyId, slug: 'company@' + companyId, name: companyId, revision: 1, state: { secret: 'WHOLE-STATE' }, createdAt: new Date(), updatedAt: new Date() }); return id; };
  const session = (companyId?: string) => ({ ...actor('owner'), ...(companyId ? { companyId } : {}) });

  it('同一账号在另一公司的回执不能跨公司读取', async () => {
    const wid = company(COMPANY_A); receipt(wid, 'decision');
    expect((await repo.reviewReceipt(session(COMPANY_A), wid, 'decision')).result.reviewId).toBe('r1');
    await expect(repo.reviewReceipt(session(COMPANY_B), wid, 'decision')).rejects.toMatchObject({ status: 404, message: '原审批回执不存在' });
    await expect(repo.reviewReceipt(session(), wid, 'decision')).rejects.toMatchObject({ status: 404, message: '原审批回执不存在' });
  });

  it('工作区不存在或已移入回收站时返回 404', async () => {
    const missing = randomUUID(); receipt(missing, 'orphan');
    await expect(repo.reviewReceipt(session(), missing, 'orphan')).rejects.toMatchObject({ status: 404, message: '原审批回执不存在' });
    receipt(workspaceId, 'archived');
    expect((await repo.reviewReceipt(session(), workspaceId, 'archived')).requestId).toBe('archived');
    stored().workspaceArchive = { at: now, actorId: 'owner' };
    await expect(repo.reviewReceipt(session(), workspaceId, 'archived')).rejects.toMatchObject({ status: 404, message: '原审批回执不存在' });
  });

  it('不再按他人账号读取回执', async () => {
    const wid = company(COMPANY_A); receipt(wid, 'mine', 'someone');
    await expect(repo.reviewReceipt(session(COMPANY_A), wid, 'mine')).rejects.toMatchObject({ status: 404 });
  });
});

describe('4. 成员交接档案按办理资格和当前可见范围下发', () => {
  const members = [{ id: 'demo-sales', name: '顾言', active: true, groups: ['garment'] }, { id: 'demo-buyer', name: '沈禾', active: true, groups: ['garment', 'fabric'] }, { id: 'demo-new', name: '林舟', active: true, groups: ['garment', 'fabric'] }];
  const ctx = { id: (() => { let n = 0; return () => `mh-${++n}`; })(), now, actorId: 'boss', actorName: '老板', members } as unknown as MistContext;
  const empty = () => createMistState({ id: () => 'e', now, actorName: 'e' }, 'empty');
  const reader = (userId: string, extra: string[] = []) => ({ ...actor(userId), permissions: [...READ_ALL, ...extra] });
  let state: MistState;
  beforeEach(() => {
    state = createMistState(ctx, 'demo');
    for (const o of state.orders) if (o.ownerId === 'demo-buyer' && o.governance) o.governance.status = 'approved' as any;
    state = applyMistCommand(state, { type: 'handover.account', payload: { fromUserId: 'demo-buyer', toUserId: 'demo-new', reason: '沈禾离职 PRIVATE-REASON' } } as MistCommand, ctx).state;
  });
  const record = () => accountHandovers(state)[0];
  const workspaceEvents = (s: MistState) => s.events.filter(e => e.entityType === 'workspace' && e.text.startsWith('成员交接'));

  it('能办理成员交接或全公司可见的账号看到完整记录与事件', () => {
    expect(record().objects.length).toBeGreaterThan(0);
    for (const view of [projectState(state, reader('admin', ['users:write']), empty, undefined, { userIds: ['admin'], teamIds: [] }).state, projectState(state, reader('finance'), empty).state]) {
      expect(accountHandovers(view)).toEqual([record()]);
      expect(workspaceEvents(view)[0].text).toContain('PRIVATE-REASON');
    }
  });

  it('受限账号只看到本人作为交出人或接手人的记录，对象按当前可见范围过滤且不暴露隐藏数量', () => {
    const unrelated = projectState(state, reader('demo-sales'), empty, undefined, { userIds: ['demo-sales'], teamIds: [] }).state;
    expect(accountHandovers(unrelated)).toEqual([]);
    const from = projectState(state, reader('demo-buyer'), empty, undefined, { userIds: ['demo-buyer'], teamIds: [] }).state;
    const own = accountHandovers(from);
    expect(own).toHaveLength(1);
    // 订单、开发案已转给接手人，交出人当前范围内看不到；客户档案与供应商不按行裁剪，仍按现有读权限可见。
    expect(record().objects.some(text => /^(订单负责人|开发负责人) /.test(text))).toBe(true);
    expect(own[0].objects.some(text => /^(订单负责人|开发负责人) /.test(text))).toBe(false);
    expect(own[0].counts.order).toBeUndefined();
    expect(own[0].objects.length).toBeLessThan(record().objects.length);
    expect(Object.values(own[0].counts).reduce((n, v) => n + (v || 0), 0)).toBe(own[0].objects.length);
    const to = projectState(state, reader('demo-new'), empty, undefined, { userIds: ['demo-new'], teamIds: [] }).state;
    expect(accountHandovers(to)[0].objects.length).toBeGreaterThan(own[0].objects.length);
  });

  it('内部交付接收人改派事件对受限账号去掉交接原因', () => {
    const event = { id: 'ev-delivery', entityType: 'order', entityId: state.orders[0].id, actor: '老板', at: now, text: '内部交付接收人：沈禾→林舟：沈禾离职 PRIVATE-REASON', fileIds: [] };
    state.events.unshift(event as any);
    const scoped = projectState(state, reader('demo-sales'), empty, undefined, { userIds: ['demo-sales'], teamIds: [] }).state;
    expect(scoped.events.find(e => e.id === 'ev-delivery')?.text ?? '内部交付接收人：沈禾→林舟').toBe('内部交付接收人：沈禾→林舟');
    const full = projectState(state, reader('finance'), empty).state;
    expect(full.events.find(e => e.id === 'ev-delivery')?.text).toContain('PRIVATE-REASON');
  });

  it('工作区事件对受限账号改为不含数量与原因的中性文本，接手待办只给接手人', () => {
    const scoped = projectState(state, reader('demo-sales'), empty, undefined, { userIds: ['demo-sales'], teamIds: [] }).state;
    expect(workspaceEvents(scoped).map(e => e.text)).toEqual(['成员交接：沈禾→林舟']);
    expect(JSON.stringify(scoped)).not.toContain('PRIVATE-REASON');
    expect(scoped.tasks.some(t => t.kind === 'account-handover')).toBe(false);
    const to = projectState(state, reader('demo-new'), empty, undefined, { userIds: ['demo-new'], teamIds: [] }).state;
    expect(to.tasks.some(t => t.kind === 'account-handover')).toBe(true);
  });
});
