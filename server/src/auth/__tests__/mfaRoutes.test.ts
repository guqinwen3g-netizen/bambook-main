import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../tokenHelpers', async (orig) => ({
  ...(await orig<typeof import('../tokenHelpers')>()),
  buildLoadedAuthTokenPayload: async (_p: unknown, user: any) => ({ userId: user.id, displayName: 'U', roles: ['viewer'], roleIds: [], permissions: [], departmentIds: [], authorizationLoaded: true }),
}));

import { createAuthRouter } from '../route';
import { createAuthService } from '../service';

const auth = createAuthService();
let user: any; let audits: any[];
function app() {
  const find = async ({ where }: any) => (where.id === user.id || where.OR ? structuredClone(user) : null);
  const prisma = {
    userAccount: {
      findUnique: find, findFirst: find,
      update: async ({ where, data }: any) => { if (where.id !== user.id) throw new Error('unexpected'); Object.assign(user, structuredClone(data)); return structuredClone(user); },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
  const a = express(); a.use(cookieParser()); a.use(express.json());
  a.use('/auth', createAuthRouter({ prisma: prisma as any, loginRateLimit: false, requireEmailVerification: false }));
  return a;
}
const bearer = () => `Bearer ${auth.signToken({ userId: user.id, displayName: 'U', roles: ['viewer'], roleIds: [], permissions: [], departmentIds: [] } as any)}`;
beforeEach(async () => { user = { id: 'u1', email: 'u1@x.cn', displayName: 'U', status: 'active', passwordHash: await auth.hashPassword('Pass-word-1'), metadata: { note: 'keep', mfa: { enabled: true, secret: 'legacy-encrypted-secret' } }, roles: [] }; audits = []; });
it('uses password login even if historical metadata has an enabled binding', async () => {
 const r=await request(app()).post('/auth/login').send({email:user.email,password:'Pass-word-1'});
 expect(r.status).toBe(200);expect(r.body.token).toBeTruthy();expect(r.body.mfaRequired).toBeUndefined();expect(r.body.mfaToken).toBeUndefined();
});
it('still rejects an incorrect password for a historical MFA account', async () => {
 expect((await request(app()).post('/auth/login').send({email:user.email,password:'wrong'})).status).toBe(401);
});
it.each(['/mfa','/mfa/setup','/mfa/enable','/mfa/disable','/login/mfa'])('retires %s without reading or changing a binding', async path => {
 const a=app();const r=path==='/mfa'?await request(a).get('/auth'+path):await request(a).post('/auth'+path).send({mfaToken:auth.signPurposeToken('mfa-login', user.id,300),code:'123456'});
 expect(r.status).toBe(410);expect(r.body.error).toBe('AUTH_METHOD_RETIRED');expect(user.metadata.mfa.enabled).toBe(true);expect(audits).toEqual([]);
});
