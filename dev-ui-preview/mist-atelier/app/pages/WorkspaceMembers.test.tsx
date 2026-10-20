// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MistRoot } from '../../../../components/mist';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
const seam = vi.hoisted(() => ({ workspace: null as any, session: null as any }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => seam.workspace }));
vi.mock('../runtime/auth', () => { const useMistSession = () => seam.session; return { useMistSession, useOptionalMistSession: useMistSession }; });
import { WorkspaceMembers } from './WorkspaceMembers';
import { AccessHiddenNotice } from './AccessHiddenNotice';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLElement;
const paint = (notice = false) => root.render(<MistRoot>{notice ? <AccessHiddenNotice keys={['payables', 'payments']} /> : <WorkspaceMembers busy={false} />}</MistRoot>);
const select = () => host.querySelector<HTMLSelectElement>('select[aria-label="要授权的本地工作身份"]')!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
async function choose(value: string) { await act(async () => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })); }); }
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  seam.session = { sessionKey: 'session-owner', user: { id: 'owner', displayName: '公司所有者' }, localMode: true, localProfiles: [{ id: 'owner', name: '公司所有者' }, { id: 'finance', name: '财务' }, { id: 'manager', name: '业务主管' }] };
  seam.workspace = { state: createMistState({ id: () => 'record', now: '2026-10-14T00:00:00Z', actorName: '测试' }, 'empty'), workspace: { id: 'space-one', ownerId: 'owner', access: { role: 'owner', canManageMembers: true, hidden: [] } }, pending: null, changeMember: vi.fn().mockResolvedValue(undefined) };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

describe('授权访问沿用 Mist 设置组件', () => {
  it('排除所有者和已有成员，只提交当前选中的账号；同拍点击不重复请求', async () => {
    seam.workspace.state.members = [{ userId: 'manager', name: '业务主管', addedBy: 'owner', addedByName: '所有者', addedAt: '2026-10-14T00:00:00Z' }];
    const wait = deferred(); seam.workspace.changeMember.mockReturnValue(wait.promise);
    act(() => paint());
    expect([...select().options].map(option => option.value)).not.toContain('owner');
    expect([...select().options].map(option => option.value)).not.toContain('manager');
    expect(button('授权进入').disabled).toBe(true);
    await choose('finance');
    await act(async () => { button('授权进入').click(); button('授权进入').click(); });
    expect(seam.workspace.changeMember).toHaveBeenCalledTimes(1);
    expect(seam.workspace.changeMember).toHaveBeenCalledWith('add', 'finance');
    expect(select().disabled).toBe(true);
    await act(async () => wait.resolve()); expect(select().value).toBe('');
  });

  it('被授权成员只读成员与历史，不出现授权及撤销动作', () => {
    seam.workspace.workspace.access = { role: 'member', canManageMembers: false, hidden: [] };
    seam.workspace.state.members = [{ userId: 'finance', name: '财务', addedBy: 'owner', addedByName: '所有者', addedAt: '2026-10-14T00:00:00Z' }];
    seam.workspace.state.memberLog = [{ id: 'log', action: 'add', userId: 'finance', name: '财务', actorId: 'owner', actorName: '所有者', at: '2026-10-14T00:00:00Z' }];
    act(() => paint());
    expect(host.textContent).toContain('你是被授权成员');
    expect(host.textContent).toContain('授权记录');
    expect(button('授权进入')).toBeUndefined();
    expect(button('撤销授权')).toBeUndefined();
    expect(seam.workspace.changeMember).not.toHaveBeenCalled();
  });

  it('失败保留账号输入，并显示真实错误', async () => {
    seam.workspace.changeMember.mockRejectedValue(new Error('当前版本已变化'));
    act(() => paint()); await choose('finance');
    await act(async () => button('授权进入').click());
    expect(select().value).toBe('finance');
    expect(host.textContent).toContain('当前版本已变化');
  });

  it('切换空间后，旧请求的迟到错误不能污染新空间及输入', async () => {
    const wait = deferred(); seam.workspace.changeMember.mockReturnValueOnce(wait.promise);
    act(() => paint()); await choose('finance');
    await act(async () => button('授权进入').click());
    seam.workspace = { ...seam.workspace, workspace: { ...seam.workspace.workspace, id: 'space-two' } };
    act(() => paint()); await choose('manager');
    await act(async () => wait.reject(new Error('旧空间错误')));
    expect(select().value).toBe('manager');
    expect(host.textContent).not.toContain('旧空间错误');
  });

  it('有待核对请求时禁用授权控件，不让用户叠加授权', () => {
    seam.workspace.pending = { kind: 'member' };
    act(() => paint()); expect(select().disabled).toBe(true); expect(button('授权进入').disabled).toBe(true);
  });

  it('无查看权限不是没有记录，不把隐藏的数据说成零', () => {
    seam.workspace.workspace.access.hidden = [{ key: 'payables', label: '供应商票据与应付' }, { key: 'employees', label: '员工档案' }];
    act(() => paint(true));
    expect(host.textContent).toContain('供应商票据与应付');
    expect(host.textContent).toContain('并不代表没有记录');
    expect(host.textContent).not.toContain('员工档案');
    seam.workspace.workspace.access.hidden = [];
    act(() => paint(true)); expect(host.textContent).toBe('');
  });
});
describe('成员整体交接', () => {
  const ownerRow = (id: string, name: string) => ({ ownerId: id, owner: name });
  function seed() {
    const s = seam.workspace.state;
    s.members = [{ userId: 'manager', name: '业务主管', addedBy: 'owner', addedByName: '所有者', addedAt: '2026-10-14T00:00:00Z' }];
    s.customers = [{ id: 'c1', code: 'C1', name: '客户甲', ...ownerRow('left', '离职业务员') }];
    s.orders = [{ id: 'o1', code: 'SO-1', customer: '客户甲', ...ownerRow('left', '离职业务员') }, { id: 'o2', code: 'SO-2', customer: '客户甲', governance: { status: 'pending' }, ...ownerRow('manager', '业务主管') }];
    s.tasks = [{ id: 't1', title: '跟进', due: '', done: false, kind: 'x', target: { view: 'orders' }, assigneeIds: ['left'] }];
    seam.workspace.run = vi.fn().mockResolvedValue({ result: { id: 'h1' } });
  }
  const pick = async (label: string, value: string) => { const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; await act(async () => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }); };
  const type = async (label: string, value: string) => { const el = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
  it('列出前成员名下业务，预览后整体交给在用成员', async () => {
    seed(); act(() => paint());
    const from = host.querySelector<HTMLSelectElement>('select[aria-label="交接原负责人"]')!;
    expect([...from.options].map(o => o.textContent)).toContain('离职业务员（2 项，已不在本公司）');
    await pick('交接原负责人', 'left'); await pick('交接新负责人', 'manager');
    expect(host.querySelector('[data-handover-preview]')?.textContent).toContain('客户 1、订单 1；未完成待办 1 条');
    expect(button('整体交接').disabled).toBe(true);
    await type('成员交接原因', '离职，业务由主管接手');
    await act(async () => button('整体交接').click());
    expect(seam.workspace.run).toHaveBeenCalledWith({ type: 'handover.account', payload: { fromUserId: 'left', toUserId: 'manager', reason: '离职，业务由主管接手' } });
  });
  it('审批中的订单列为阻断项，不能提交', async () => {
    seed(); act(() => paint());
    await pick('交接原负责人', 'manager'); await pick('交接新负责人', 'owner'); await type('成员交接原因', '调岗');
    expect(host.textContent).toContain('订单 SO-2 审批中，审批完成后再交接');
    expect(button('整体交接').disabled).toBe(true);
  });
  it('被授权成员看不到交接区块', () => {
    seam.workspace.workspace.access.canManageMembers = false; act(() => paint());
    expect(host.querySelector('[data-member-handover]')).toBeNull();
  });
});
