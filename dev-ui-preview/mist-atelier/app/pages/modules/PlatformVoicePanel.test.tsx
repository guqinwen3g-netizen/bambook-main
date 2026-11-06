// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByLabelText, getByRole } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../../components/mist';
vi.mock('../../../../../services/apiService', () => ({ apiService: { getAuthHeaders: () => ({}) } }));
import { PlatformVoicePanel } from './PlatformVoicePanel';
let root: Root, host: HTMLDivElement;
const fetcher = vi.fn();
const view = { revision: 1, enabled: true, hasKey: true, configured: true, voice: 'zh_female_qingchezizi_uranus_bigtts', speed: 0, loudness: 0 };
const response = (value: unknown) => ({ ok: true, json: async () => value });
const flush = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const paint = (key = 'A') => act(() => root.render(<MistRoot><ToastProvider><PlatformVoicePanel sessionKey={key} /></ToastProvider></MistRoot>));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); fetcher.mockResolvedValue(response(view));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('keeps the stored key out of the page and preserves it on an ordinary settings save', async () => {
  paint(); await flush(); expect((getByLabelText(host, '实时语音 API Key') as HTMLInputElement).value).toBe('');
  act(() => getByRole(host, 'button', { name: '保存', exact: true }).click()); await flush();
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(post[1].body)).toMatchObject({ revision: 1, enabled: true }); expect(JSON.parse(post[1].body)).not.toHaveProperty('apiKey');
});
it('removes the connection only after the explicit dialog action and disables speech with key removal', async () => {
  paint(); await flush(); act(() => getByRole(host, 'button', { name: '移除连接', exact: true }).click()); await flush();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  const dialog = getByRole(document.body, 'dialog', { name: '移除语音连接？' });
  act(() => getByRole(dialog, 'button', { name: '移除', exact: true }).click()); await flush();
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(post[1].body)).toMatchObject({ enabled: false, clearKey: true });
});
it('ignores a previous account’s late response after the signed-in session changes', async () => {
  let finish!: (value: unknown) => void; fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  paint(); paint('B'); await flush();
  finish(response({ ...view, voice: 'previous-account-voice' })); await flush();
  expect((getByLabelText(host, '音色 ID') as HTMLInputElement).value).toBe(view.voice);
});
