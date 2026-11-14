// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../../components/mist';
import { createMistState } from '../../../../../server/src/shared/mistWorkspace';
import { usableSeals } from './CompanySeals';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const store = vi.hoisted(() => ({ state: null as any, loading: false, run: vi.fn(), uploadFile: vi.fn(), readFile: vi.fn() }));
vi.mock('../../runtime/workspace', () => ({ useMistWorkspace: () => ({ state: store.state, loading: store.loading, workspace: { id: 'ws', ownerId: 'owner', access: { companyLibrary: true } }, run: store.run, uploadFile: store.uploadFile, readFile: store.readFile, saving: false, pending: null }) }));
vi.mock('../../runtime/auth', () => ({ useOptionalMistSession: () => ({ user: { id: 'owner', displayName: '陆衡' } }) }));
import { CompanySealsSection } from './CompanySeals';

let root: Root | undefined, host: HTMLDivElement;
const seal = { id: 'seal-1', name: '雾织贸易公章', kind: 'company', fileId: 'seal-file', userIds: ['u-li'], status: 'active', createdAt: '2026-11-01T00:00:00Z', createdBy: '陆衡', updatedAt: '2026-11-01T00:00:00Z' };
beforeEach(() => {
  const state = createMistState({ id: () => crypto.randomUUID(), now: '2026-11-05T00:00:00.000Z', actorName: 'test' }, 'empty') as any;
  state.members = [{ userId: 'u-li', name: '陈晓', addedBy: '', addedByName: '', addedAt: '' }, { userId: 'u-gu', name: '顾言', addedBy: '', addedByName: '', addedAt: '' }];
  state.files.push({ id: 'seal-file', name: '公章.png', mimeType: 'image/png', size: 10, storageKey: 'k', createdAt: '' });
  state.seals = [seal, { ...seal, id: 'seal-2', name: '旧合同章', kind: 'contract', status: 'disabled', userIds: ['u-gu'] }];
  state.sealUses = [{ id: 'use-1', sealId: 'seal-1', sealName: '雾织贸易公章', documentKind: 'CI', documentId: 'd', documentNumber: 'CI-2026-1110', fileId: 'f', actorId: 'u-li', actor: '陈晓', at: '2026-11-05T06:00:00Z', reason: 'CI 对外签发' }];
  store.state = state; store.loading = false; store.run.mockReset().mockResolvedValue({ result: {} }); store.readFile.mockReset().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); host.remove(); document.body.innerHTML = ''; });
const render = async (canManage: boolean) => act(async () => root!.render(<MistRoot><ToastProvider><CompanySealsSection canManage={canManage} /></ToastProvider></MistRoot>));
const click = async (el: Element) => act(async () => { (el as HTMLElement).click(); });
function mockImageUrls() {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:seal-preview'); URL.revokeObjectURL = vi.fn();
  return () => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; };
}

it('waits for company loading to finish even when its file and reader identities stay the same', async () => {
  const restore = mockImageUrls(); store.state.seals = [seal]; store.loading = true;
  store.readFile.mockImplementation(async () => { if (store.loading) throw new Error('公司已切换，请在本公司重新操作'); return new Blob(['seal'], { type: 'image/png' }); });
  try {
    await render(true); expect(store.readFile).not.toHaveBeenCalled();
    store.loading = false; await render(true);
    expect(getByRole(host, 'img', { name: '印章图片' }).getAttribute('src')).toBe('blob:seal-preview'); expect(store.readFile).toHaveBeenCalledTimes(1);
  } finally { if (root) { await act(async () => root!.unmount()); root = undefined; } restore(); }
});

it('retries the same seal file after the company-bound reader becomes ready', async () => {
  const restore = mockImageUrls(), reader = store.readFile; store.state.seals = [seal];
  try {
    reader.mockRejectedValue(new Error('公司已切换，请在本公司重新操作')); await render(true);
    expect(queryByRole(host, 'img', { name: '印章图片' })).toBeNull();
    store.readFile = vi.fn().mockResolvedValue(new Blob(['seal'], { type: 'image/png' })); await render(true);
    expect(getByRole(host, 'img', { name: '印章图片' }).getAttribute('src')).toBe('blob:seal-preview'); expect(store.readFile).toHaveBeenCalledTimes(1);
  } finally { if (root) { await act(async () => root!.unmount()); root = undefined; } store.readFile = reader; restore(); }
});

it('removes a loaded seal preview when the image is no longer in the authorized file list', async () => {
  const restore = mockImageUrls(); store.state.seals = [seal];
  try {
    await render(true); expect(getByRole(host, 'img', { name: '印章图片' })).toBeTruthy();
    store.state = { ...store.state, files: [] }; await render(true);
    expect(queryByRole(host, 'img', { name: '印章图片' })).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:seal-preview');
  } finally { if (root) { await act(async () => root!.unmount()); root = undefined; } restore(); }
});

it('only active seals that list the user are usable', () => {
  expect(usableSeals(store.state, 'u-li').map(s => s.id)).toEqual(['seal-1']);
  expect(usableSeals(store.state, 'u-gu')).toEqual([]);
  expect(usableSeals(store.state, undefined)).toEqual([]);
});

it('members see seals and use records but no management actions', async () => {
  await render(false);
  expect(host.textContent).toContain('雾织贸易公章'); expect(host.textContent).toContain('CI-2026-1110'); expect(host.textContent).toContain('已停用');
  expect(queryByRole(host, 'button', { name: '登记印章' })).toBeNull(); expect(queryByRole(host, 'button', { name: '停用' })).toBeNull();
});

it('a maintainer registers a seal only with an image and at least one designated user', async () => {
  store.uploadFile.mockResolvedValue({ id: 'new-file', name: 'seal.png', mimeType: 'image/png', size: 10, storageKey: 'k', createdAt: '' });
  await render(true);
  await click(getByRole(host, 'button', { name: '登记印章' }));
  const dialog = getByRole(document.body, 'dialog');
  const name = getByRole(dialog, 'textbox', { name: '印章名称' }) as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '合同专用章'); name.dispatchEvent(new Event('input', { bubbles: true })); });
  await click(getByRole(dialog, 'button', { name: '保存' }));
  expect(dialog.textContent).toContain('请上传印章图片'); expect(store.run).not.toHaveBeenCalled();
  const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'seal.png', { type: 'image/png' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(getByRole(dialog, 'button', { name: '保存' }));
  expect(dialog.textContent).toContain('请至少指定一名用印人');
  await click([...dialog.querySelectorAll('label.mist-check')].find(l => l.textContent === '陈晓')!.querySelector('input')!);
  await click(getByRole(dialog, 'button', { name: '保存' }));
  expect(store.run).toHaveBeenCalledWith({ type: 'seal.save', payload: { name: '合同专用章', kind: 'company', fileId: 'new-file', userIds: ['u-li'] } });
});

it('disabling a seal requires a reason', async () => {
  await render(true);
  await click(getByRole(host, 'button', { name: '停用' }));
  const dialog = getByRole(document.body, 'dialog');
  await click(getByRole(dialog, 'button', { name: '停用' }));
  expect(dialog.textContent).toContain('请填写停用原因'); expect(store.run).not.toHaveBeenCalled();
  const area = getByRole(dialog, 'textbox', { name: '停用原因' }) as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '印章遗失'); area.dispatchEvent(new Event('input', { bubbles: true })); });
  await click(getByRole(dialog, 'button', { name: '停用' }));
  expect(store.run).toHaveBeenCalledWith({ type: 'seal.disable', payload: { id: 'seal-1', reason: '印章遗失' } });
});
