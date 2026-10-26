import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAdminRouter } from './route';
import { createAuthService } from '../auth/service';

const url = process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('company account suspension and restoration on PostgreSQL', () => {
  const key = randomUUID(), companyId = randomUUID(), otherCompanyId = randomUUID();
  const ownerId = 'account-owner-' + key, memberId = 'account-member-' + key, outsiderId = 'account-outsider-' + key;
  let db: PrismaClient, app: express.Express, token: string;
  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    for (const [id, slug] of [[companyId, 'a-' + key], [otherCompanyId, 'b-' + key]]) {
      await db.company.create({ data: { id, name: slug, slug, status: 'active' } });
    }
    for (const id of [ownerId, memberId, outsiderId]) await db.userAccount.create({ data: { id, displayName: id, status: 'active', email: id + '@example.invalid' } });
    for (const [company, user] of [[companyId, ownerId], [companyId, memberId], [otherCompanyId, memberId], [otherCompanyId, outsiderId]]) {
      await db.companyMember.create({ data: { id: randomUUID(), companyId: company, userId: user, status: 'active' } });
    }
    app = express(); app.use(express.json()); app.use('/admin', createAdminRouter({ prisma: db }));
    token = createAuthService().signToken({ userId: ownerId, roles: ['owner'], permissions: ['*'], departmentIds: [], companyId });
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: ownerId } });
    await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await db.userAccount.deleteMany({ where: { id: { in: [ownerId, memberId, outsiderId] } } });
    await db.$disconnect();
  });
  const call = (method: 'get' | 'post' | 'patch', path: string) => request(app)[method]('/admin' + path).set('Authorization', 'Bearer ' + token);

  it('keeps a suspended member visible with the disabled status, including the status filter', async () => {
    expect((await call('post', '/users/' + memberId + '/disable-account').send({})).status).toBe(200);
    for (const path of ['/users', '/users?status=disabled']) {
      const list = await call('get', path);
      expect(list.status).toBe(200);
      expect(list.body.users.find((u: any) => u.id === memberId)).toMatchObject({ status: 'disabled' });
    }
    expect((await call('get', '/users?status=active')).body.users.some((u: any) => u.id === memberId)).toBe(false);
    expect((await db.userAccount.findUniqueOrThrow({ where: { id: memberId } })).status).toBe('active');
    expect((await db.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: otherCompanyId, userId: memberId } } })).status).toBe('active');
  });

  it('restores the current company membership without changing the global identity', async () => {
    const before = await db.userAccount.findUniqueOrThrow({ where: { id: memberId } });
    expect((await call('patch', '/users/' + memberId).send({ status: 'active' })).status).toBe(200);
    expect((await db.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: memberId } } })).status).toBe('active');
    expect(await db.userAccount.findUniqueOrThrow({ where: { id: memberId } })).toEqual(before);
  });

  it('records the company scope for both state changes', async () => {
    const logs = await db.auditLog.findMany({ where: { actorId: ownerId, targetId: memberId } });
    expect(logs.map(l => l.action).sort()).toEqual(['disable_company_account', 'enable_company_account']);
    expect(logs.every(l => (l.detail as any).companyId === companyId)).toBe(true);
  });

  it('preserves the disabled state when the company has no free seat', async () => {
    await call('post', '/users/' + memberId + '/disable-account').send({});
    await db.company.update({ where: { id: companyId }, data: { seatLimit: 1 } });
    expect((await call('patch', '/users/' + memberId).send({ status: 'active' })).status).toBe(409);
    expect((await db.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: memberId } } })).status).toBe('suspended');
    await db.company.update({ where: { id: companyId }, data: { seatLimit: null } });
    expect((await call('patch', '/users/' + memberId).send({ status: 'active' })).status).toBe(200);
  });

  it('cannot restore a globally disabled identity or alter a different company account', async () => {
    await call('post', '/users/' + memberId + '/disable-account').send({});
    await db.userAccount.update({ where: { id: memberId }, data: { status: 'disabled' } });
    expect((await call('patch', '/users/' + memberId).send({ status: 'active' })).status).toBe(409);
    expect((await db.userAccount.findUniqueOrThrow({ where: { id: memberId } })).status).toBe('disabled');
    expect((await call('patch', '/users/' + outsiderId).send({ status: 'active' })).status).toBe(404);
  });

  it('prevents self suspension and mixed identity/status writes', async () => {
    expect((await call('post', '/users/' + ownerId + '/disable-account').send({})).status).toBe(400);
    expect((await call('patch', '/users/' + ownerId).send({ status: 'active', displayName: 'changed' })).status).toBe(400);
    expect((await db.userAccount.findUniqueOrThrow({ where: { id: ownerId } })).displayName).toBe(ownerId);
  });
});
