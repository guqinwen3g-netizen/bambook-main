// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByRole, queryByText } from '@testing-library/dom';
import { MistRoot } from '../../../../../components/mist';
import type { EmailAccount } from '../../../../../server/src/shared/mistEmail';
const seam = vi.hoisted(() => ({ api: vi.fn(), session: 'owner-a', workspace: 'company-a', source: 1 }));
vi.mock('../../runtime/auth', () => ({ useMistSession: () => ({ sessionKey: seam.session }) }));
vi.mock('../../runtime/workspace', () => ({ useMistWorkspace: () => ({ workspace: { id: seam.workspace } }), mistApiRequest: (...args: any[]) => seam.api(...args) }));
import { MailReceivingControl, MailReceivingNotice, useMailReceiving } from './MailReceiving';
let root: Root, host: HTMLDivElement;
const row = (enabled = false) => ({ accountId: 'account-a', version: 0, enabled, state: enabled ? 'waiting' : 'off', canEnable: true, canDisable: true, lastAttemptAt: null, lastSuccessAt: null, nextRunAt: null, pending: 0, error: null });
const account = () => ({ id: 'account-a', displayName: '业务邮箱', ownerId: 'owner', sourceGeneration: seam.source, credentialSet: true, example: false }) as EmailAccount;
function Fixture() { const control = useMailReceiving([account()]); return <MistRoot><MailReceivingNotice control={control}/><MailReceivingControl account={account()} control={control} locked={false}/></MistRoot>; }
const paint = () => root.render(<Fixture/>);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); seam.session = 'owner-a'; seam.workspace = 'company-a'; seam.source = 1; localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it('saves an owner grant against the current mailbox source and never calls the receive operation from the page', async () => {
  let item = row(); seam.api.mockImplementation(async (_url: string, init: any) => {
    if (init?.method === 'PUT') { const body = JSON.parse(init.body); expect(body.sourceGeneration).toBe(1); item = { ...row(true), version: 1, lastChangeId: body.requestId } as any; return { item }; }
    return { serviceAvailable: true, items: [item] };
  });
  act(paint); await flush(); await act(async () => getByRole(host, 'switch', { name: '业务邮箱 自动收件' }).click()); await flush();
  expect((getByRole(host, 'switch') as HTMLInputElement).checked).toBe(true);
  expect(seam.api.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(seam.api.mock.calls.every(([url]) => !url.endsWith('/sync'))).toBe(true);
});
it('resolves a lost mutation response by querying its operation identity, without submitting twice', async () => {
  let item = row(); seam.api.mockImplementation(async (_url: string, init: any) => {
    if (init?.method === 'PUT') { const body = JSON.parse(init.body); item = { ...row(true), version: 1, lastChangeId: body.requestId } as any; throw Error('Response lost'); }
    return { serviceAvailable: true, items: [item] };
  });
  act(paint); await flush(); await act(async () => getByRole(host, 'switch').click()); await flush();
  expect((getByRole(host, 'switch') as HTMLInputElement).checked).toBe(true); expect(queryByText(host, '自动收件设置结果待核对')).toBeNull();
  expect(seam.api.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
});
it('retains the same operation when an unknown result requires a user retry', async () => {
  let attempts = 0, item = row(); seam.api.mockImplementation(async (_url: string, init: any) => {
    if (init?.method === 'PUT') { if (++attempts === 1) throw Error('Request lost'); const body = JSON.parse(init.body); item = { ...row(true), version: 1, lastChangeId: body.requestId } as any; return { item }; }
    return { serviceAvailable: true, items: [item] };
  });
  act(paint); await flush(); await act(async () => getByRole(host, 'switch').click()); await flush();
  expect(getByRole(host, 'switch').hasAttribute('disabled')).toBe(true); await act(async () => getByRole(host, 'button', { name: '重试' }).click()); await flush();
  const writes = seam.api.mock.calls.filter(([, init]) => init?.method === 'PUT'); expect(writes[0][1].body).toBe(writes[1][1].body);
});
it('ignores a late response after an account/session switch', async () => {
  let finish!: (value: any) => void; seam.api.mockImplementation((_url: string, init: any) => init?.method === 'PUT' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ serviceAvailable: true, items: [{ ...row(), canEnable: seam.session === 'owner-a' }] }));
  act(paint); await flush(); await act(async () => getByRole(host, 'switch').click()); seam.session = 'member-b'; act(paint); await flush();
  await act(async () => finish({ item: { ...row(true), lastChangeId: 'old-result' } })); await flush();
  expect((getByRole(host, 'switch') as HTMLInputElement).checked).toBe(false); expect(getByRole(host, 'switch').hasAttribute('disabled')).toBe(true);
});
it('does not revoke a persistent registration when the settings drawer closes', async () => {
  seam.api.mockResolvedValue({ serviceAvailable: true, items: [row(true)] }); act(paint); await flush();
  act(() => root.render(<div>Another page</div>)); expect(seam.api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it('allows stopping an enabled registration while the receive service is unavailable', async () => {
  let item = row(true); seam.api.mockImplementation(async (_url: string, init: any) => {
    if (init?.method === 'PUT') { const body = JSON.parse(init.body); expect(body.enabled).toBe(false); item = { ...row(false), version: 1, lastChangeId: body.requestId } as any; return { item }; }
    return { serviceAvailable: false, items: [item] };
  });
  act(paint); await flush(); expect(getByRole(host, 'switch').hasAttribute('disabled')).toBe(false);
  await act(async () => getByRole(host, 'switch').click()); await flush(); expect((getByRole(host, 'switch') as HTMLInputElement).checked).toBe(false);
});
it('keeps a rejected setting visible after a successful status recheck', async () => {
  seam.api.mockImplementation(async (_url: string, init: any) => {
    if (init?.method === 'PUT') throw Object.assign(new Error('当前授权已失效'), { status: 403 });
    return { serviceAvailable: true, items: [row()] };
  });
  act(paint); await flush(); await act(async () => getByRole(host, 'switch').click()); await flush();
  expect(queryByText(host, '当前授权已失效')).not.toBeNull();
  expect((getByRole(host, 'switch') as HTMLInputElement).checked).toBe(false);
});
it('clears a failed status read when the user successfully checks again', async () => {
  seam.api.mockRejectedValueOnce(Error('收件状态读取失败')).mockResolvedValue({ serviceAvailable: true, items: [row()] });
  act(paint); await flush(); expect(queryByText(host, '收件状态读取失败')).not.toBeNull();
  await act(async () => getByRole(host, 'button', { name: '核对状态' }).click()); await flush();
  expect(queryByText(host, '收件状态读取失败')).toBeNull();
});
