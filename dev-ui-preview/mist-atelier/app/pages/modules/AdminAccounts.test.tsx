// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MistRoot, ToastProvider } from '../../../../../components/mist';
import { AdminAccounts } from './AdminAccounts';

const api = vi.hoisted(() => ({
  listAccounts: vi.fn(), listRoles: vi.fn(), createAccount: vi.fn(),
}));
vi.mock('../../runtime/organization', async orig => ({ ...(await orig<typeof import('../../runtime/organization')>()), organizationApi: api }));
vi.mock('../../runtime/workspace', () => ({ useMistWorkspace: () => ({ workspace: null, state: null }) }));
vi.mock('../../runtime/auth', () => { const useMistSession = () => ({ sessionKey: 'a', user: { id: 'owner', companyId: 'c1' }, hasRole: () => true, hasPermission: () => true }); return { useMistSession, useOptionalMistSession: useMistSession }; });
vi.mock('../../nav', () => ({ useNav: () => ({ route: { view: 'admin-panel' }, go: vi.fn() }) }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root;
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function type(element: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
function choose(label: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  act(() => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
beforeEach(async () => {
  api.listAccounts.mockResolvedValue({ users: [], departments: [{ id: 'company', name: '公司', parentId: null }, { id: 'd1', name: '业务部', parentId: 'company' }] });
  api.listRoles.mockResolvedValue({ roles: [{ id: 'role-sales@c1', name: '业务员', permissions: [], isSystem: true }] });
  api.createAccount.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MistRoot><ToastProvider><AdminAccounts /></ToastProvider></MistRoot>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

async function openCreate() {
  await act(async () => button('新建账号').click());
  type(field('姓名'), '新员工'); type(field('登录邮箱'), 'new@example.com');
  choose('任职部门', 'd1'); choose('岗位', 'role-sales@c1');
}

it('creates an account by invitation without an initial password and reports the real delivery result', async () => {
  api.createAccount.mockResolvedValueOnce({ userId: 'u1', reactivated: false, invitation: { status: 'unavailable', message: '账号已保留，邮件服务未配置，请联系平台管理员后重发。' } });
  await openCreate();
  choose('账号开通方式', 'invite');
  expect(field('初始密码')).toBeNull();
  await act(async () => button('创建账号').click());
  expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({ deliveryMode: 'invite', email: 'new@example.com' }));
  expect(api.createAccount.mock.calls[0][0]).not.toHaveProperty('password');
  expect(document.body.textContent).toContain('邀请邮件未发出');
  expect(document.body.textContent).toContain('邮件服务未配置');
  expect(document.body.textContent).not.toContain('邀请邮件已提交发送');
});

it('keeps the initial-password mode and tells the admin the employee must change it at first login', async () => {
  api.createAccount.mockResolvedValueOnce({ userId: 'u1', reactivated: false });
  await openCreate();
  type(field('初始密码'), 'safe-pass-1');
  await act(async () => button('创建账号').click());
  expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({ deliveryMode: 'password', password: 'safe-pass-1' }));
  expect(document.body.textContent).toContain('首次登录');
});
