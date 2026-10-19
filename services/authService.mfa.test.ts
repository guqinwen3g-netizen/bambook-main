// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const user = { id: 'boss', displayName: '老板', email: 'boss@example.test', roles: ['owner'], permissions: [], departmentIds: [], department: null };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as Response;
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

it('rejects a stale backend challenge without caching a session or submitting an OTP', async () => {
  const fetch = vi.fn(async () => json({ ok: true, mfaRequired: true, mfaToken: 'old-challenge' }));
  vi.stubGlobal('fetch', fetch);
  const auth = await import('./authService');
  await expect(auth.login('boss@example.test', 'pw')).rejects.toThrow('登录服务版本未更新');
  expect(auth.getAuthState().isAuthenticated).toBe(false);
  expect(localStorage.getItem('bambook_auth_token')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('改密成功后用服务器换发的新令牌替换当前令牌，保持原存放位置', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, otherSessionsRevoked: true, token: 'fresh' })));
  const auth = await import('./authService');
  sessionStorage.setItem('bambook_auth_token', 'old');
  await auth.changePassword('a', 'b');
  expect(sessionStorage.getItem('bambook_auth_token')).toBe('fresh'); expect(localStorage.getItem('bambook_auth_token')).toBeNull();
  localStorage.setItem('bambook_auth_token', 'fresh');
  vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, token: 'fresher' })));
  await auth.changePassword('b', 'c');
  expect(localStorage.getItem('bambook_auth_token')).toBe('fresher');
});
