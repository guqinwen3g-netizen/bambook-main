// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Avatar, ToastProvider } from '../../../../components/mist';
import { AvatarSettingRow } from './AvatarStudio';

const update = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ user: { id: 'u1', email: 'a@x.test', displayName: '顾青', avatarUrl: null as string | null } as any }));
vi.mock('../../../../services/authService', () => ({ updateMyProfile: update }));
vi.mock('../runtime/auth', () => { const useMistSession = () => session; return { useMistSession, useOptionalMistSession: useMistSession }; });
let root: Root, host: HTMLDivElement;
const button = (t: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === t);
const settle = async (ms = 40) => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; update.mockReset(); session.user.avatarUrl = null;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });

it('generates a style avatar and saves its preset identity', async () => {
  update.mockResolvedValueOnce({});
  await act(async () => root.render(<ToastProvider><AvatarSettingRow /></ToastProvider>));
  expect(document.body.textContent).toContain('当前显示姓名首字');
  await act(async () => button('编辑头像')!.click());
  expect(document.body.textContent).toContain('找到，属于你的样子');
  expect(button('恢复姓名首字')).toBeUndefined();
  await act(async () => button('开始探索 ↗')!.click());
  await settle();
  const apply = button('就用这个')!;
  expect(apply.disabled).toBe(false);
  await act(async () => apply.click());
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][0].avatarUrl).toMatch(/^dicebear:v1:[a-z-]+:c\d+_v6_\d+_\d+_[\w-]+-0:(animated|still)$/);
});

it('restores initials by clearing the avatar', async () => {
  session.user.avatarUrl = 'dicebear:v1:glass:c205_v6_12_12_abc-0:animated';
  update.mockResolvedValueOnce({});
  await act(async () => root.render(<ToastProvider><AvatarSettingRow /></ToastProvider>));
  await act(async () => button('编辑头像')!.click());
  await act(async () => button('恢复姓名首字')!.click());
  expect(update).toHaveBeenCalledWith({ avatarUrl: null });
});

it('renders preset identities as generated SVG and plain URLs as-is', async () => {
  await act(async () => root.render(<><Avatar name="顾青" src="dicebear:v1:glass:c205_v6_12_12_abc-0:still" /><Avatar name="林" src="data:image/webp;base64,AAAA" /><Avatar name="王" /></>));
  await settle();
  const imgs = [...host.querySelectorAll('img')].map(i => i.getAttribute('src') || '');
  expect(imgs[0]).toMatch(/^data:image\/svg\+xml/);
  expect(imgs[1]).toBe('data:image/webp;base64,AAAA');
  expect(host.textContent).toBe('王');
});
