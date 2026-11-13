// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../../../../services/authService';
import { View } from '../../../../types';
import { MistSessionProvider, useMistSession, type MistSession } from './auth';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const user = (id: string): auth.AuthUser => ({ id, displayName: id, email: `${id}@example.com`, roles: ['sales'], roleIds: ['sales-role'], permissions: ['orders:read'], permissionCeiling: ['orders:read'], departmentIds: ['team-a'], department: 'Team A' });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const jwtLike = (claims: Record<string, unknown>) => ['e30', btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'), 'sig'].join('.');
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let actor: auth.AuthUser | null, root: Root | undefined, host: HTMLElement | undefined, session: MistSession;
let override: ((url: URL, init: RequestInit) => Promise<Response> | null) | undefined;
let requests: Array<{ path: string; method: string; body?: unknown }>;
async function waitFor(check: () => void) { let last: unknown; for (let i = 0; i < 60; i++) { try { check(); return; } catch (error) { last = error; await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); }); } } throw last; }
function Probe() { session = useMistSession(); return <div data-status={session.status}>{session.user?.id ?? 'guest'}</div>; }
async function mount() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<MistSessionProvider><Probe /></MistSessionProvider>)); }
beforeEach(async () => {
  actor = null; override = undefined; requests = []; localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('panda_system_config', JSON.stringify({ cloudEndpoint: 'https://mist-session.example/api' }));
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input), location.href); const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ path: url.pathname, method: init.method ?? 'GET', body });
    const special = override?.(url, init); if (special) return special;
    if(url.pathname==='/api/mist/session')return json({message:'Not found'},404);
    if (url.pathname.endsWith('/auth/logout')) return json({ ok: true,revokedSession:true });
    if (url.pathname.endsWith('/auth/login')) { actor = user(String(body.identifier)); return json({ user: actor, token: `token-${actor.id}` }); }
    if (url.pathname.endsWith('/auth/me')) return actor ? json({ user: actor }) : json({ message: '未登录' }, 401);
    throw new Error(`Unexpected test request: ${url.pathname}`);
  }));
  await auth.logout();localStorage.removeItem('bambook_auth_signed_out'); requests = [];
});
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });
describe('Mist session adapter with production auth service', () => {
  it('keeps an explicit confirmed logout anonymous instead of restoring a surviving cookie',async()=>{
    await auth.login('signed-out','password');await auth.logout();requests=[];await mount();await waitFor(()=>expect(session.status).toBe('anonymous'));expect(requests.map(r=>r.path)).toEqual(['/api/mist/session']);expect(session.user).toBeNull();
  });
  it('retains an unconfirmed logout and supports retry without passive cookie restoration',async()=>{
    await auth.login('signed-out','password');override=url=>url.pathname.endsWith('/auth/logout')?Promise.reject(new TypeError('offline')):null;await expect(auth.logout()).rejects.toThrow('服务器退出未确认');override=undefined;requests=[];await mount();await waitFor(()=>expect(session.status).toBe('anonymous'));expect(session.error).toContain('服务器退出未确认');expect(requests.some(r=>r.path.endsWith('/auth/me'))).toBe(false);await act(async()=>session.logout());expect(session.error).toBe('');expect(session.user).toBeNull();
  });
  it('retries an unverified discovery into company authentication only after a confirmed server response',async()=>{
    override=url=>url.pathname==='/api/mist/session'?Promise.resolve(json({message:'Service unavailable'},503)):null;
    await mount();await waitFor(()=>expect(session.status).toBe('anonymous'));
    expect(session.localMode).toBe(false);expect(session.connectionModeUnverified).toBe(true);expect(session.user).toBeNull();expect(requests.every(r=>r.path==='/api/mist/session'&&r.method==='GET')).toBe(true);
    override=undefined;await act(async()=>session.refresh());await waitFor(()=>expect(session.connectionModeUnverified).not.toBe(true));
    expect(session.localMode).not.toBe(true);expect(session.status).toBe('anonymous');expect(requests.some(r=>r.path==='/api/auth/me')).toBe(true);
    await act(async()=>session.login('reconnected-staff','password'));await waitFor(()=>expect(session.user?.id).toBe('reconnected-staff'));expect(session.localMode).not.toBe(true);
  });
  it('declares the session probe protocol so remote servers answer 200 only to new clients', async () => {
    const probes: Array<string | null> = [];
    override = (url, init) => { if (url.pathname !== '/api/mist/session') return null; probes.push(new Headers(init.headers).get('X-Mist-Session-Probe')); return Promise.resolve(json({ ok: true, mode: 'remote' })); };
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    expect(probes).toEqual(['2']); expect(session.localMode).not.toBe(true); expect(session.connectionModeUnverified).not.toBe(true);
  });
  it('treats an explicit remote-mode answer like the legacy 404 and continues with account sign-in', async () => {
    override = url => url.pathname === '/api/mist/session' ? Promise.resolve(json({ ok: true, mode: 'remote' })) : null;
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    expect(session.localMode).not.toBe(true); expect(session.connectionModeUnverified).not.toBe(true);
    expect(requests.map(r => r.path)).toEqual(['/api/mist/session', '/api/auth/me']);
    await act(async () => session.login('remote-staff', 'password')); expect(session.user?.id).toBe('remote-staff');
  });
  it('initializes only through real /me and never automatically logs into a development identity', async () => {
    const response = deferred<Response>(); override = url => url.pathname.endsWith('/auth/me') ? response.promise : null;
    await mount(); expect(session.status).toBe('loading'); expect(session.user).toBeNull(); expect(session.canAccessView(View.Orders)).toBe(false);
    expect(requests.map(request => request.path)).toEqual(['/api/mist/session','/api/auth/me']);
    await expect(session.login('cannot-bypass', 'password')).rejects.toThrow('正在核验');
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    await act(async () => response.resolve(json({ message: '未登录' }, 401)));
    await waitFor(() => expect(session.status).toBe('anonymous'));
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
  it('restores a validated session, respects the permission ceiling and exposes no token in its session key', async () => {
    await auth.login('cached-user', 'password'); actor = { ...user('cached-user'), permissions: ['*'], permissionCeiling: ['orders:read'] }; requests = [];
    await mount(); await waitFor(() => expect(session.status).toBe('authenticated'));
    expect(session.user?.id).toBe('cached-user'); expect(session.canAccessView(View.Orders)).toBe(true); expect(session.hasPermission('finance:write')).toBe(false); expect(session.hasRole('sales')).toBe(true);
    expect(session.sessionKey).not.toContain('token-cached-user'); expect(session.sessionKey).not.toContain('cached-user');
    expect(requests.map(request => request.path)).toEqual(['/api/mist/session','/api/auth/me']);
  });
  it('keeps the signed permission ceiling after a profile update', async () => {
    await auth.login('profile-user', 'password'); actor = { ...user('profile-user'), permissions: ['*'], permissionCeiling: ['orders:read'] };
    await mount(); await waitFor(() => expect(session.status).toBe('authenticated'));
    override = (url, init) => url.pathname.endsWith('/auth/me') && init.method === 'PATCH' ? Promise.resolve(json({ ok: true, user: { ...actor!, displayName: 'Renamed' } })) : null;
    await act(async () => { await auth.updateMyProfile({ displayName: 'Renamed' }); });
    expect(session.user?.displayName).toBe('Renamed'); expect(session.user?.permissionCeiling).toEqual(['orders:read']);
    expect(session.hasPermission('orders:read')).toBe(true); expect(session.hasPermission('finance:write')).toBe(false);
    expect(JSON.parse(localStorage.getItem('bambook_auth_user')!).permissionCeiling).toEqual(['orders:read']);
  });
  it('drops the exposed user and advances session identity on a server 401', async () => {
    await auth.login('first', 'password'); await mount(); await waitFor(() => expect(session.status).toBe('authenticated')); const key = session.sessionKey;
    actor = null; await act(async () => session.refresh());
    expect(session.status).toBe('anonymous'); expect(session.user).toBeNull(); expect(session.sessionKey).not.toBe(key); expect(session.hasPermission('orders:read')).toBe(false);
  });
  it('rejects a malformed successful login response without exposing an authenticated page', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    override = url => url.pathname.endsWith('/auth/login') ? Promise.resolve(json({ token: 'malformed-token' })) : null;
    let failure: unknown; await act(async () => { failure = await session.login('first', 'password').catch(error => error); });
    expect((failure as Error).message).toContain('未包含有效账号'); expect(session.status).toBe('anonymous'); expect(session.user).toBeNull();
  });
  it('does not allow a late login to revive an explicitly logged-out session', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    const response = deferred<Response>(); override = url => url.pathname.endsWith('/auth/login') ? response.promise : null;
    let login!: Promise<unknown>;
    act(() => { login = session.login('first', 'password').catch(error => error); });
    await act(async () => session.logout());
    await act(async () => response.resolve(json({ user: user('first'), token: 'late-token' })));
    await login;
    expect(session.status).toBe('anonymous'); expect(session.user).toBeNull(); expect(localStorage.getItem('bambook_auth_token')).toBeNull();
  });
  it('keeps a newer login when an older logout acknowledgement arrives late', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous')); await act(async () => session.login('first', 'password'));
    const response = deferred<Response>(); override = url => url.pathname.endsWith('/auth/logout') ? response.promise : null;
    let logout!: Promise<void>; act(() => { logout = session.logout(); });
    await act(async () => session.login('second', 'password'));
    await act(async () => response.resolve(json({ ok: true,revokedSession:true }))); await logout;
    expect(session.user?.id).toBe('second'); expect(session.status).toBe('authenticated'); expect(localStorage.getItem('bambook_auth_token')).toBe('token-second');
  });
  it('uses session-only token persistence when keep-login is unchecked', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    await act(async () => session.login('session-only', 'password', { remember: false }));
    expect(localStorage.getItem('bambook_auth_token')).toBeNull(); expect(sessionStorage.getItem('bambook_auth_token')).toBe('token-session-only'); expect(session.user?.id).toBe('session-only');
  });
  it('sends the keep-login choice to the server and stores the token to match it', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    await act(async () => session.login('kept', 'password', { remember: true }));
    expect(requests.find(r => r.path.endsWith('/auth/login'))?.body).toMatchObject({ remember: true });
    expect(localStorage.getItem('bambook_auth_token')).toBe('token-kept');
    await act(async () => session.logout()); requests = [];
    await act(async () => session.login('browser-only', 'password', { remember: false }));
    expect(requests.find(r => r.path.endsWith('/auth/login'))?.body).toMatchObject({ remember: false });
    expect(localStorage.getItem('bambook_auth_token')).toBeNull(); expect(sessionStorage.getItem('bambook_auth_token')).toBe('token-browser-only');
  });
  it('renews an aging session token in place without resetting the page session', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = jwtLike({ userId: 'renewing', sessionId: 's1', iat: now - 2 * 86400, exp: now + 28 * 86400 });
    const renewed = jwtLike({ userId: 'renewing', sessionId: 's1', iat: now, exp: now + 30 * 86400 });
    override = url => url.pathname.endsWith('/auth/login') ? (actor = user('renewing'), Promise.resolve(json({ user: actor, token: old })))
      : url.pathname.endsWith('/auth/refresh') ? Promise.resolve(json({ ok: true, token: renewed })) : null;
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    await act(async () => session.login('renewing', 'password', { remember: true })); const key = session.sessionKey;
    await act(async () => { expect(await auth.renewSessionIfDue()).toBe(true); });
    expect(requests.filter(r => r.path.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(localStorage.getItem('bambook_auth_token')).toBe(renewed); expect(sessionStorage.getItem('bambook_auth_token')).toBe(renewed);
    expect(session.sessionKey).toBe(key); expect(session.status).toBe('authenticated');
    await act(async () => { expect(await auth.renewSessionIfDue()).toBe(false); });
    expect(requests.filter(r => r.path.endsWith('/auth/refresh'))).toHaveLength(1);
  });
  it('keeps a browser-only session out of persistent storage when renewing', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = jwtLike({ userId: 'tab', sessionId: 's2', iat: now - 7 * 3600, exp: now + 5 * 3600 });
    const renewed = jwtLike({ userId: 'tab', sessionId: 's2', iat: now, exp: now + 12 * 3600 });
    override = url => url.pathname.endsWith('/auth/login') ? (actor = user('tab'), Promise.resolve(json({ user: actor, token: old })))
      : url.pathname.endsWith('/auth/refresh') ? Promise.resolve(json({ ok: true, token: renewed })) : null;
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    await act(async () => session.login('tab', 'password', { remember: false }));
    await act(async () => { expect(await auth.renewSessionIfDue()).toBe(true); });
    expect(localStorage.getItem('bambook_auth_token')).toBeNull(); expect(sessionStorage.getItem('bambook_auth_token')).toBe(renewed);
  });
  it('ends the session when the server refuses to renew a revoked credential', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = jwtLike({ userId: 'revoked', sessionId: 's3', iat: now - 2 * 86400, exp: now + 28 * 86400 });
    override = url => url.pathname.endsWith('/auth/login') ? (actor = user('revoked'), Promise.resolve(json({ user: actor, token: old })))
      : url.pathname.endsWith('/auth/refresh') ? (actor = null, Promise.resolve(json({ ok: false, error: 'SESSION_REVOKED' }, 401))) : null;
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    await act(async () => session.login('revoked', 'password', { remember: true }));
    await act(async () => { expect(await auth.renewSessionIfDue()).toBe(false); });
    await waitFor(() => expect(session.status).toBe('anonymous')); expect(session.user).toBeNull();
  });
  it('does not reuse an old cached actor after endpoint change fails to revalidate', async () => {
    await auth.login('old-server-user', 'password'); await mount(); await waitFor(() => expect(session.status).toBe('authenticated')); const key = session.sessionKey;
    override = url => url.pathname.endsWith('/auth/me') ? Promise.resolve(json({ message: '离线' }, 503)) : null;
    localStorage.setItem('panda_system_config', JSON.stringify({ cloudEndpoint: 'https://other-server.example/api' }));
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'panda_system_config' })); });
    await waitFor(() => expect(session.status).toBe('anonymous'));
    expect(session.user).toBeNull(); expect(session.sessionKey).not.toBe(key); expect(session.canAccessView(View.Orders)).toBe(false);
    expect(session.error).toContain('登录凭据或服务地址已变化');
    override = undefined; await act(async () => session.login('new-server-user', 'password'));
    expect(session.status).toBe('authenticated'); expect(session.user?.id).toBe('new-server-user');
  });
  it.each(['write', 'remove'] as const)('keeps a settled guest screen when another tab %s changes only the user cache', async change => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    const key = session.sessionKey, count = requests.length;
    await act(async () => window.dispatchEvent(new StorageEvent('storage', {
      key: 'bambook_auth_user', newValue: change === 'write' ? JSON.stringify(user('other-tab')) : null,
    })));
    expect(session.status).toBe('anonymous'); expect(session.sessionKey).toBe(key);
    expect(session.user).toBeNull(); expect(requests).toHaveLength(count);
  });
  it('does not retire a pending login or adopt another tabs cached permissions', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous'));
    const response = deferred<Response>();
    override = url => url.pathname.endsWith('/auth/login') ? response.promise : null;
    let login!: Promise<unknown>;
    act(() => { login = session.login('current', 'password').catch(error => error); });
    const count = requests.length;
    await act(async () => window.dispatchEvent(new StorageEvent('storage', {
      key: 'bambook_auth_user', newValue: JSON.stringify({ ...user('other-tab'), permissions: ['*'] }),
    })));
    expect(requests).toHaveLength(count); expect(session.signingIn).toBe(true);
    await act(async () => response.resolve(json({ user: user('current'), token: 'token-current' })));
    expect(await login).toMatchObject({ id: 'current' });
    expect(session.user?.id).toBe('current'); expect(session.hasPermission('finance:write')).toBe(false);
  });
  it('still revalidates changed credentials and a cleared storage instead of trusting the display cache', async () => {
    await auth.login('first', 'password'); await mount();
    await waitFor(() => expect(session.user?.id).toBe('first'));
    actor = user('second'); localStorage.setItem('bambook_auth_token', 'token-second');
    const count = requests.length;
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'bambook_auth_token' })));
    await waitFor(() => expect(session.user?.id).toBe('second'));
    expect(requests.slice(count).map(r => r.path)).toEqual(['/api/auth/me']);
    actor = null; localStorage.clear(); sessionStorage.clear();
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    await waitFor(() => expect(session.status).toBe('anonymous'));
    expect(session.user).toBeNull(); expect(session.hasPermission('orders:read')).toBe(false);
  });
  it('retired provider callbacks cannot log out a later session', async () => {
    await mount(); await waitFor(() => expect(session.status).toBe('anonymous')); const retired = session;
    act(() => root!.unmount()); root = undefined;
    await auth.login('current-session', 'password'); const before = requests.length;
    await expect(retired.logout()).rejects.toThrow('会话页面已关闭'); await expect(retired.login('retired', 'password')).rejects.toThrow('会话页面已关闭');
    await retired.refresh(); expect(requests).toHaveLength(before); expect(auth.getAuthState().user?.id).toBe('current-session');
  });
  it('applies the latest concurrent /me response and ignores an older account snapshot', async () => {
    await auth.login('first', 'password'); await mount(); await waitFor(() => expect(session.status).toBe('authenticated'));
    const old = deferred<Response>(); let count = 0;
    override = url => url.pathname.endsWith('/auth/me') ? (++count === 1 ? old.promise : Promise.resolve(json({ user: user('second') }))) : null;
    let first!: Promise<void>; act(() => { first = session.refresh(); }); await act(async () => session.refresh());
    await act(async () => old.resolve(json({ user: user('first') }))); await first;
    expect(session.user?.id).toBe('second'); expect(session.status).toBe('authenticated');
  });
});
