/** 平台开户选“设置初始密码”时，公司负责人首次登录也须先改密（初始密码平台人员知道）。 */
import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
vi.mock('./companyProvisioning', async orig => ({
  ...(await orig<typeof import('./companyProvisioning')>()),
  createCompany: vi.fn(async () => ({ company: { id: 'c1', slug: 'acme', name: '雾织', status: 'active' }, roles: 0 })),
}));
import { createPlatformRouter } from './route';
import { createAuthService } from '../auth/service';

it('marks an owner created with an initial password as must-change-at-first-login', async () => {
  const created: any[] = [];
  const tx: any = { userAccount: { create: vi.fn(async ({ data }: any) => { created.push(data); return { id: data.id }; }) }, systemConfig: { findUnique: vi.fn(async () => null) }, userRole: { create: vi.fn() } };
  const prisma: any = {
    userAccount: { findUnique: vi.fn(async () => ({ id: 'platform', platformRole: 'platform_admin', status: 'active', deletedAt: null, companyMembers: [], roles: [] })), findFirst: vi.fn(async () => null) },
    company: { findUnique: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const app = express(); app.use(express.json()); app.use('/platform', createPlatformRouter({ prisma }));
  const token = createAuthService().signToken({ userId: 'platform', roles: [], permissions: [], departmentIds: [], platformOnly: true });
  const res = await request(app).post('/platform/companies').set('Authorization', `Bearer ${token}`)
    .send({ name: '雾织', slug: 'acme', ownerName: '林乔', ownerEmail: 'owner@example.invalid', deliveryMode: 'password', initialPassword: 'Initial-pass-1' });
  expect(res.status).toBe(201);
  expect(created[0].metadata).toMatchObject({ forceChangePassword: true, forceChangeReason: 'initial' });
});
