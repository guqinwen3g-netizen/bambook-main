/**
 * 停用 → 重新启用不能让停用前签发的令牌复活：停用与启用都须换新凭据代次并写入全部退出时间。
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { createAdminRouter } from '../route';
import { createAuthRouter } from '../../auth/route';
import { createAuthService } from '../../auth/service';
import { createAccountStatusGuard, invalidateAccountStatusCache } from '../../auth/accountStatusGuard';
import { createAuthorizationSnapshotGuard } from '../../auth/authorizationSnapshotGuard';

const auth = createAuthService();
const adminToken = auth.signToken({ userId: 'owner-1', roles: ['owner'], permissions: ['users:admin'], departmentIds: [] });
let user: any;

function makeApp() {
  const prisma: any = {
    userAccount: {
      findUnique: async ({ where }: any) => (where.id === user.id ? structuredClone(user) : null),
      findFirst: async ({ where }: any) => ((where.id ?? user.id) === user.id && (where.email ?? user.email) === user.email && !(where.deletedAt === null && user.deletedAt != null) ? structuredClone(user) : null),
      update: async ({ data }: any) => { Object.assign(user, structuredClone(data)); return structuredClone(user); },
    },
    userRole: { findMany: async () => [], deleteMany: async () => ({}), create: async () => ({}) },
    userPermissionOverrides: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
    $transaction: async (fn: any) => fn(prisma),
  };
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/admin', createAdminRouter({ prisma, accountAccess: { deliver: vi.fn() } } as any));
  app.use('/api', createAccountStatusGuard(prisma), createAuthorizationSnapshotGuard({ prisma }));
  app.use('/api/auth', createAuthRouter({ prisma, loginRateLimit: false, requireEmailVerification: false }));
  app.get('/api/orders', (_req, res) => res.json({ orders: [] }));
  return app;
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const admin = (app: express.Express, method: 'post' | 'patch', path: string, body: object = {}) => request(app)[method]('/admin' + path).set(bearer(adminToken)).send(body);

async function expectRejected(app: express.Express, token: string) {
  expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
  const refreshed = await request(app).post('/api/auth/refresh').set(bearer(token));
  expect(refreshed.status).toBe(401); expect(refreshed.body.token).toBeUndefined();
  expect((await request(app).get('/api/orders').set(bearer(token))).status).toBe(401);
}

beforeEach(() => {
  invalidateAccountStatusCache('u1');
  user = { id: 'u1', email: 'staff@example.test', displayName: 'Staff', status: 'active', deletedAt: null, platformRole: null, roles: [], primaryDeptId: null, primaryDepartment: null, metadata: { credentialVersion: 'v1' } };
});
const oldToken = () => auth.signToken({ userId: 'u1', roles: [], permissions: [], departmentIds: [], credentialVersion: 'v1' } as any);

describe('停用后重新启用', () => {
  it('停用前的令牌在停用时即失效', async () => {
    const app = makeApp(), token = oldToken();
    expect((await request(app).get('/api/orders').set(bearer(token))).status).toBe(200);
    expect((await admin(app, 'post', '/users/u1/disable-account')).status).toBe(200);
    expect(user.metadata.credentialVersion).not.toBe('v1');
    expect(user.metadata.sessionsRevokedAt).toEqual(expect.any(String));
  });

  it('经账号状态切换重新启用后，停用前的令牌仍被拒（/me、/refresh、业务接口）', async () => {
    const app = makeApp(), token = oldToken();
    expect((await admin(app, 'post', '/users/u1/disable-account')).status).toBe(200);
    const disabledVersion = user.metadata.credentialVersion;
    expect((await admin(app, 'patch', '/users/u1', { status: 'active' })).status).toBe(200);
    expect(user.status).toBe('active');
    expect(user.metadata.credentialVersion).not.toBe(disabledVersion);
    await expectRejected(app, token);
  });

  it('重新建号复用已停用账号时，停用前的令牌仍被拒', async () => {
    user.status = 'disabled';
    const app = makeApp(), token = oldToken();
    const res = await admin(app, 'post', '/users', { displayName: 'Staff', email: 'staff@example.test', password: 'Fresh-pass-12' });
    expect(res.status).toBe(200); expect(res.body.reactivated).toBe(true);
    expect(user.metadata.credentialVersion).not.toBe('v1');
    await expectRejected(app, token);
  });
});
