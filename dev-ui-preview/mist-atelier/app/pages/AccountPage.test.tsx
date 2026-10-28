// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../components/mist';
const seam = vi.hoisted(() => ({ section: 'profile', go: vi.fn(), run: vi.fn(), logout: vi.fn() }));
vi.mock('../runtime/auth', () => ({ useMistSession: () => ({ user: { id: 'sales', displayName: '沈禾', email: 'sales@example.test', department: '面料部' }, logout: seam.logout }) }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => ({ state: { settings: { profileName: '总经理', companyProfile: { legalName: '雾织贸易' } } }, run: seam.run }) }));
vi.mock('../runtime/organizationContext', () => ({ useOrganizationContext: () => ({ teams: [{ name: '面料一组' }], retry: vi.fn() }) }));
vi.mock('../nav', () => ({ useNav: () => ({ route: { section: seam.section }, go: seam.go }) }));
vi.mock('./AvatarStudio', () => ({ AvatarSettingRow: () => <button>编辑头像</button> }));
vi.mock('./ChangePassword', () => ({ ChangePasswordRow: () => <button>修改密码</button>, LogoutAllRow: () => <button>退出所有设备</button> }));
import { AccountPage } from './AccountPage';
let root: Root, host: HTMLDivElement;
function paint() { root.render(<MistRoot><ToastProvider><AccountPage /></ToastProvider></MistRoot>); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; seam.section = 'profile'; vi.clearAllMocks(); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
it('shows the authenticated employee and organization without company-owner aliases or technical metadata', () => {
  act(paint);
  expect(getByRole(host, 'heading', { name: '我的账号' })).toBeTruthy();
  expect(host.textContent).toContain('沈禾'); expect(host.textContent).toContain('sales@example.test'); expect(host.textContent).toContain('面料一组');
  for (const absent of ['总经理', '分支', '代码版本', '提交时间', '数据类型', '公司内显示名']) expect(host.textContent).not.toContain(absent);
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(seam.run).not.toHaveBeenCalled();
});
it('keeps appearance settings local and navigates between page sections', () => {
  seam.section = 'appearance'; act(paint);
  const select = getByRole(host, 'combobox', { name: '界面语言' }) as HTMLSelectElement;
  expect([...select.options].map(option => option.value)).toEqual(['system', 'zh-CN', 'en-US']);
  act(() => { select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(localStorage.getItem('bambook.device.locale')).toBe('"system"'); expect(seam.run).not.toHaveBeenCalled();
  act(() => getByRole(host, 'button', { name: /安全/ }).click());
  expect(seam.go).toHaveBeenCalledWith('account', undefined, { section: 'security' });
});
it('keeps logout available on the security page', () => {
  seam.section = 'security'; seam.logout.mockResolvedValue(undefined); act(paint);
  act(() => getByRole(host, 'button', { name: '退出登录' }).click());
  expect(seam.logout).toHaveBeenCalledOnce();
});
it('changes theme and table density without updating the company', () => {
  seam.section = 'appearance'; act(paint);
  act(() => getByRole(host, 'radio', { name: '深色', exact: true }).click());
  expect(localStorage.getItem('bambook.device.theme')).toBe('"dark"');
  const density = getByRole(host, 'combobox', { name: '列表密度' }) as HTMLSelectElement;
  act(() => { density.value = 'compact'; density.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(localStorage.getItem('bambook.device.density')).toBe('"compact"'); expect(seam.run).not.toHaveBeenCalled();
});
it('offers device-only notification and operation sound controls',()=>{
  seam.section='appearance';act(paint);
  const notifications=getByRole(host,'switch',{name:'通知提示音'});
  const operations=getByRole(host,'switch',{name:'操作反馈音'});
  expect((notifications as HTMLInputElement).checked).toBe(true);
  expect((operations as HTMLInputElement).checked).toBe(true);
  expect(queryByRole(host,'button',{name:'试听通知'})).toBeNull();
  expect(queryByRole(host,'button',{name:'试听完成'})).toBeNull();
  expect(queryByRole(host,'button',{name:'试听失败'})).toBeNull();
  expect(queryByRole(host,'combobox',{name:'声音风格'})).toBeNull();
  expect(getByRole(host,'slider',{name:'提示音量'})).toBeTruthy();
  act(()=>notifications.click());
  expect(JSON.parse(localStorage.getItem('bambook.ui-sound.v1')!).notifications).toBe(false);
  expect(seam.run).not.toHaveBeenCalled();
});
