// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MistWorkspaceScope, useMistWorkspace } from '../runtime/workspace';
import { PlatformCompanySettingsPage } from './PlatformCompanySettingsPage';
const m = vi.hoisted(() => ({ session: { sessionKey: 'one', user: { id: 'platform', displayName: '平台', platformCompany: { companyId: 'c1' } } }, read: vi.fn(), save: vi.fn() }));
vi.mock('../runtime/auth', () => ({ useMistSession: () => m.session }));
vi.mock('../runtime/platformAdmin', () => ({ platformAdminApi: { companySettings: m.read, saveCompanySettings: m.save } }));
vi.mock('./SettingsPage', () => ({ SettingsPage: () => { const value = useMistWorkspace(); return <div><span>{value.state?.settings.workspaceName}</span><span>{value.error}</span><button onClick={() => void value.run({ type: 'settings.update', payload: { workspaceName: '新名称' } })}>保存</button></div>; } }));
const snapshot = (companyId: string, name: string) => ({ companyId, workspaceId: 'workspace-'+companyId, ownerId: 'company-owner', revision: 3, settings: { workspaceName: name, notifications: { qc: true, shipping: true, suggestions: false, digest: false } }, events: [] });
let root: Root, host: HTMLDivElement;
const paint = () => act(async () => root.render(<MistWorkspaceScope value={{} as any}><PlatformCompanySettingsPage /></MistWorkspaceScope>));
const settle = async () => act(async () => { await Promise.resolve(); });
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; m.session = { sessionKey: 'one', user: { id: 'platform', displayName: '平台', platformCompany: { companyId: 'c1' } } }; m.read.mockReset(); m.save.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('uses the selected company settings API and saves with the current revision', async () => {
  m.read.mockResolvedValue({ snapshot: snapshot('c1', '雾织') });
  m.save.mockResolvedValue({ snapshot: { ...snapshot('c1', '新名称'), revision: 4 }, receipt: { requestId: 'saved', revision: 4, result: {} } });
  await paint(); await settle(); expect(host.textContent).toContain('雾织');
  await act(async () => host.querySelector('button')!.click()); await settle();
  expect(m.save).toHaveBeenCalledWith('c1', expect.objectContaining({ expectedRevision: 3, patch: { workspaceName: '新名称' } }));
  expect(host.textContent).toContain('新名称');
});
it('discards the previous company response after switching context', async () => {
  let first: (x: any) => void = () => {}; m.read.mockReturnValueOnce(new Promise(resolve => { first = resolve; }));
  await paint(); m.session = { ...m.session, sessionKey: 'two', user: { ...m.session.user, platformCompany: { companyId: 'c2' } } };
  m.read.mockResolvedValue({ snapshot: snapshot('c2', '第二公司') }); await paint(); await settle();
  await act(async () => first({ snapshot: snapshot('c1', '旧公司') }));
  expect(host.textContent).toContain('第二公司'); expect(host.textContent).not.toContain('旧公司');
});
it('shows a read failure without making up a company workspace', async () => {
  m.read.mockRejectedValue(new Error('无权管理此公司')); await paint(); await settle();
  expect(host.textContent).toContain('无权管理此公司'); expect(host.textContent).not.toContain('雾织'); expect(m.save).not.toHaveBeenCalled();
});
