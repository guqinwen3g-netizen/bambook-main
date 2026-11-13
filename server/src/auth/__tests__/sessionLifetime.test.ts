/** 保持登录：勾选 = 30 天并在使用中续期；不勾选 = 会话 Cookie。改密 / 停用后旧令牌被拒，续期不能复活失效凭据。 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../tokenHelpers', async orig => ({
  ...(await orig<typeof import('../tokenHelpers')>()),
  loadUserWithRoles: async (_p: unknown, id: string) => (id === user?.id ? structuredClone(user) : null),
  buildLoadedAuthTokenPayload: async (_p: unknown, u: any) => {
    if (u.status !== 'active') throw new Error('AUTHORIZATION_ACCOUNT_INACTIVE');
    return { userId: u.id, displayName: 'U', roles: ['viewer'], roleIds: [], permissions: [], departmentIds: [], authorizationLoaded: true, ...(typeof u.metadata?.credentialVersion === 'string' ? { credentialVersion: u.metadata.credentialVersion } : {}) };
  },
}));
import { createAuthRouter } from '../route';
import { createAuthService } from '../service';

const auth = createAuthService();
const DAY = 24 * 3600;
let user: any;
let revoked: Map<string, any>, revocationFailure: boolean;
function app() {
  const known: any = {
    authSessionRevocation: {
      findUnique: async ({where}:any) => revoked.get(where.id) ?? null,
      createMany: async ({data}:any) => {if(revocationFailure)throw new Error('store unavailable');let count=0;for(const row of data)if(!revoked.has(row.id)){revoked.set(row.id,structuredClone(row));count++;}return{count};},
    },
    userAccount: {
      findFirst: async () => structuredClone(user), findUnique: async ({ where }: any) => (where.id === user.id ? structuredClone(user) : null),
      update: async ({ data }: any) => { Object.assign(user, structuredClone(data)); return structuredClone(user); },
    },
    companyMember: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    auditLog: { create: async () => ({}) },
  };
  const a = express(); a.use(cookieParser()); a.use(express.json());
  a.use('/auth', createAuthRouter({ prisma: known, loginRateLimit: false, requireEmailVerification: false }));
  return a;
}
const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find(c => c.startsWith('bambook_token=')) ?? '';
const claims = (token: string) => jwt.decode(token) as any;
const login = (remember?: boolean) => request(app()).post('/auth/login').send({ email: 'staff@example.test', password: 'Current-pass-1', ...(remember === undefined ? {} : { remember }) });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeEach(async () => {
  revoked=new Map();revocationFailure=false;
  user = { id: 'u1', email: 'staff@example.test', displayName: 'U', status: 'active', deletedAt: null, platformRole: null, roles: [], primaryDepartment: null, passwordHash: await auth.hashPassword('Current-pass-1'), metadata: { credentialVersion: 'v1' } };
});

describe('current device logout',()=>{
 it('issues a logout-only capability that survives loss of cookies and login storage',async()=>{
  const first=await login(true),other=await login(true),ticket=first.body.logoutTicket;expect(typeof ticket).toBe('string');expect(auth.verifyLogoutToken(ticket)).toMatchObject({kind:'session-logout'});expect(auth.verifyLogoutToken(ticket).userId).toBeUndefined();
  for(const path of ['me','companies'])expect((await request(app()).get('/auth/'+path).set(bearer(ticket))).status).toBe(401);
  expect((await request(app()).post('/auth/refresh').set(bearer(ticket))).status).toBe(401);
  const out=await request(app()).post('/auth/logout').send({logoutTicket:ticket});expect(out.status).toBe(200);expect(out.body.revokedSession).toBe(true);expect((await request(app()).get('/auth/me').set(bearer(first.body.token))).status).toBe(401);expect((await request(app()).get('/auth/me').set(bearer(other.body.token))).status).toBe(200);
 });
 it('rejects forged logout tickets and never substitutes an unrelated passive cookie',async()=>{
  const first=await login(true),other=await login(true),parts=first.body.logoutTicket.split('.');parts[2]='invalid';const bad=await request(app()).post('/auth/logout').set('Cookie',cookieOf(other).split(';')[0]).send({logoutTicket:parts.join('.')});expect(bad.status).toBe(400);expect(bad.headers['set-cookie']).toBeUndefined();expect((await request(app()).get('/auth/me').set(bearer(other.body.token))).status).toBe(200);
  const good=await request(app()).post('/auth/logout').set('Cookie',cookieOf(other).split(';')[0]).send({logoutTicket:first.body.logoutTicket});expect(good.status).toBe(200);expect(good.headers['set-cookie']).toBeUndefined();expect((await request(app()).get('/auth/me').set(bearer(first.body.token))).status).toBe(401);expect((await request(app()).get('/auth/me').set(bearer(other.body.token))).status).toBe(200);
 });
 it('does not label an anonymous acknowledgement as a session revocation',async()=>{const r=await request(app()).post('/auth/logout');expect(r.status).toBe(200);expect(r.body.revokedSession).toBe(false);});
 it('revokes a still-active family even when the presented pre-refresh token has expired',async()=>{
  const issued=Math.floor(Date.now()/1000)-13*3600,base={userId:'u1',roles:[],permissions:[],departmentIds:[],credentialVersion:'v1',sessionId:'expired-original',authTime:issued};
  const expired=auth.signToken({...base,iat:issued} as any,{expiresInSec:12*3600}),current=auth.signToken(base);
  expect((await request(app()).get('/auth/me').set(bearer(current))).status).toBe(200);expect((await request(app()).post('/auth/logout').set(bearer(expired))).status).toBe(200);expect((await request(app()).get('/auth/me').set(bearer(current))).status).toBe(401);
 });
 it('revokes the device session and its refreshed token while preserving another device',async()=>{
  const current=(await login(true)).body.token,other=(await login(true)).body.token;
  const refreshed=await request(app()).post('/auth/refresh').set(bearer(current));expect(refreshed.status).toBe(200);
  expect((await request(app()).post('/auth/logout').set(bearer(current))).status).toBe(200);
  for(const token of [current,refreshed.body.token]){
   expect((await request(app()).get('/auth/me').set(bearer(token))).status).toBe(401);
   expect((await request(app()).get('/auth/companies').set(bearer(token))).status).toBe(401);
   expect((await request(app()).post('/auth/refresh').set(bearer(token))).status).toBe(401);
  }
  expect((await request(app()).get('/auth/me').set(bearer(other))).status).toBe(200);
  expect((await request(app()).post('/auth/refresh').set(bearer(other))).status).toBe(200);
 });
 it('persists cookie-only logout across router instances without storing credentials',async()=>{
  const first=await login(true),token=first.body.token;
  expect((await request(app()).post('/auth/logout').set('Cookie',cookieOf(first).split(';')[0])).status).toBe(200);
  expect((await request(app()).get('/auth/me').set(bearer(token))).status).toBe(401);
  expect(revoked.size).toBe(1);expect(JSON.stringify([...revoked.values()])).not.toContain(token);
  expect((await request(app()).post('/auth/logout').set(bearer(token))).status).toBe(200);expect(revoked.size).toBe(1);
 });
 it('does not revoke a passive cookie session when another session is selected explicitly',async()=>{
  const current=await login(true),other=await login(true);
  const out=await request(app()).post('/auth/logout').set(bearer(current.body.token)).set('Cookie',cookieOf(other).split(';')[0]).send({userId:'forged',sessionId:auth.verifyToken(other.body.token).sessionId});expect(out.status).toBe(200);expect(out.headers['set-cookie']).toBeUndefined();
  expect((await request(app()).get('/auth/me').set(bearer(current.body.token))).status).toBe(401);
  expect((await request(app()).get('/auth/me').set(bearer(other.body.token))).status).toBe(200);
 });
 it('keeps legacy token refreshes in the same revocable family',async()=>{
  const token=auth.signToken({userId:'u1',roles:[],permissions:[],departmentIds:[],credentialVersion:'v1'});
  const refreshed=await request(app()).post('/auth/refresh').set(bearer(token));expect(refreshed.status).toBe(200);
  expect((await request(app()).post('/auth/logout').set(bearer(token))).status).toBe(200);
  expect((await request(app()).get('/auth/me').set(bearer(token))).status).toBe(401);
  expect((await request(app()).get('/auth/me').set(bearer(refreshed.body.token))).status).toBe(401);
 });
 it('does not acknowledge server logout when the revocation cannot be persisted',async()=>{
  const token=(await login(true)).body.token;revocationFailure=true;
  const res=await request(app()).post('/auth/logout').set(bearer(token));expect(res.status).toBe(503);expect(res.body.ok).toBe(false);
 });
});
it('logout-all invalidates tokens from the same second while allowing a fresh password login',async()=>{
 vi.useFakeTimers({toFake:['Date']});try{const token=(await login(true)).body.token;expect((await request(app()).post('/auth/logout-all').set(bearer(token))).status).toBe(200);expect((await request(app()).get('/auth/me').set(bearer(token))).status).toBe(401);expect((await request(app()).get('/auth/companies').set(bearer(token))).status).toBe(401);const fresh=await login(true);expect(fresh.status).toBe(200);expect((await request(app()).get('/auth/me').set(bearer(fresh.body.token))).status).toBe(200);}finally{vi.useRealTimers();}
});

describe('保持登录', () => {
  it('勾选：令牌与 Cookie 都是 30 天', async () => {
    const res = await login(true);
    expect(res.status).toBe(200);
    const token = claims(res.body.token);
    expect(token.exp - token.iat).toBe(30 * DAY);
    expect(token).toMatchObject({ remember: true, sessionId: expect.any(String), authTime: token.iat });
    expect(cookieOf(res)).toMatch(/Max-Age=2592000/);
  });
  it.each([false, undefined])('不勾选（remember=%s）：会话 Cookie，令牌有效期较短', async remember => {
    const res = await login(remember);
    expect(res.status).toBe(200);
    const token = claims(res.body.token);
    expect(token.remember).not.toBe(true);
    expect(token.exp - token.iat).toBe(12 * 3600);
    expect(cookieOf(res)).not.toMatch(/Max-Age|Expires/);
  });
  it('使用中续期：新令牌延后到期，保留同一会话与登录方式', async () => {
    const issued = Math.floor(Date.now() / 1000) - 10 * DAY;
    const old = auth.signToken({ userId: 'u1', roles: [], permissions: [], departmentIds: [], credentialVersion: 'v1', remember: true, sessionId: 's1', authTime: issued, iat: issued } as any, { expiresInSec: 30 * DAY });
    const res = await request(app()).post('/auth/refresh').set(bearer(old));
    expect(res.status).toBe(200);
    const next = claims(res.body.token);
    expect(next.exp).toBeGreaterThan(claims(old).exp);
    expect(next).toMatchObject({ remember: true, sessionId: 's1', authTime: issued, credentialVersion: 'v1' });
    expect(cookieOf(res)).toMatch(/Max-Age=2592000/);
  });
  it('不勾选的会话续期后仍是会话 Cookie', async () => {
    const first = await login(false);
    const res = await request(app()).post('/auth/refresh').set(bearer(first.body.token));
    expect(res.status).toBe(200);
    expect(claims(res.body.token).remember).not.toBe(true);
    expect(cookieOf(res)).not.toMatch(/Max-Age|Expires/);
  });
  it('续期不能无限延长：距登录超过 90 天须重新登录', async () => {
    const authTime = Math.floor(Date.now() / 1000) - 91 * DAY;
    const old = auth.signToken({ userId: 'u1', roles: [], permissions: [], departmentIds: [], credentialVersion: 'v1', remember: true, sessionId: 's1', authTime } as any);
    const res = await request(app()).post('/auth/refresh').set(bearer(old));
    expect(res.status).toBe(401); expect(res.body.token).toBeUndefined();
  });
  it('续期令牌的到期时间不超过登录后 90 天', async () => {
    const authTime = Math.floor(Date.now() / 1000) - 89 * DAY;
    const old = auth.signToken({ userId: 'u1', roles: [], permissions: [], departmentIds: [], credentialVersion: 'v1', remember: true, sessionId: 's1', authTime } as any);
    const res = await request(app()).post('/auth/refresh').set(bearer(old));
    expect(res.status).toBe(200);
    expect(claims(res.body.token).exp).toBeLessThanOrEqual(authTime + 90 * DAY);
  });
});

describe('会话失效', () => {
  it('改密后其他设备的旧令牌被拒，也不能续期；当前设备拿到的新令牌可用', async () => {
    const other = (await login(true)).body.token, current = (await login(true)).body.token;
    const changed = await request(app()).post('/auth/change-password').set(bearer(current)).send({ currentPassword: 'Current-pass-1', newPassword: 'Next-pass-22' });
    expect(changed.status).toBe(200);
    expect(user.metadata.credentialVersion).not.toBe('v1');
    expect((await request(app()).get('/auth/me').set(bearer(other))).status).toBe(401);
    const revived = await request(app()).post('/auth/refresh').set(bearer(other));
    expect(revived.status).toBe(401); expect(revived.body.token).toBeUndefined();
    expect((await request(app()).get('/auth/me').set(bearer(changed.body.token))).status).toBe(200);
    expect(claims(changed.body.token)).toMatchObject({ remember: true, sessionId: claims(current).sessionId });
  });
  it('管理员重置密码（凭据代次变化 / 全部退出时间）后旧令牌不能续期', async () => {
    const token = (await login(true)).body.token;
    user.metadata = { credentialVersion: 'v2', forceChangePassword: true };
    expect((await request(app()).post('/auth/refresh').set(bearer(token))).status).toBe(401);
    user.metadata = { credentialVersion: 'v1', sessionsRevokedAt: new Date(Date.now() + 2000).toISOString() };
    expect((await request(app()).post('/auth/refresh').set(bearer(token))).status).toBe(401);
    expect((await request(app()).get('/auth/me').set(bearer(token))).status).toBe(401);
  });
  it('停用账号后旧令牌被拒，也不能续期', async () => {
    const token = (await login(true)).body.token;
    user.status = 'disabled';
    expect((await request(app()).get('/auth/me').set(bearer(token))).status).toBe(401);
    const res = await request(app()).post('/auth/refresh').set(bearer(token));
    expect(res.status).toBe(401); expect(res.body.token).toBeUndefined();
  });
});
