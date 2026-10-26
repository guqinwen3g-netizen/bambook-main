/** 平台管理员直接选择公司，按平台权限管理，不成为公司成员。 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildLoadedAuthTokenPayload } from '../tokenHelpers';
import { runWithCompanyContext, type PlatformCompanyContext } from '../requestCompanyContext';
import { tenantSurfaceGuard } from '../tenantSurfaceGuard';
import { createAuthService } from '../service';
import { createPlatformRouter } from '../../platform/route';
import { createAuthorizationSnapshotGuard } from '../authorizationSnapshotGuard';

const companyId = 'c1';
const roleId = `role-super-admin@${companyId}`;
const platformUser = { id: 'p1', displayName: '平台', platformRole: 'platform_admin', status: 'active', deletedAt: null, metadata: {}, roles: [], companyMembers: [], primaryDepartment: null, primaryDeptId: null };
const platformCompany = (patch: Partial<PlatformCompanyContext> = {}): PlatformCompanyContext => ({
  companyId, companyName: '甲公司', startedAt: new Date().toISOString(), ...patch,
});

function prisma(overrides: Record<string, unknown> = {}) {
  const audit = vi.fn(async () => ({}));
  const db: any = {
    company: { findFirst: vi.fn(async ({ where }: any) => (where.id === companyId ? { id: companyId, name: '甲公司', slug: 'jia' } : null)) },
    role: { findFirst: vi.fn(async ({ where }: any) => (where.id === roleId ? { id: roleId, companyId, code: 'role-super-admin', name: '超级管理员', permissions: [{ permission: { scope: 'users:admin' } }, { permission: { scope: 'orders:read' } }] } : null)) },
    companyMember: { findFirst: vi.fn(async () => null) },
    userAccount: { findUnique: vi.fn(async () => platformUser), findFirst: vi.fn(async () => platformUser) },
    auditLog: { create: audit },
    ...overrides,
  };
  return { db, audit };
}

describe('platform company management authorization', () => {
  it('grants the company super-admin permissions without a membership', async () => {
    const { db } = prisma();
    const payload = await buildLoadedAuthTokenPayload(db, platformUser, companyId, platformCompany());
    expect(payload).toMatchObject({ companyId, roleIds: [roleId], platformCompany: { companyId } });
    expect(payload.permissions).toEqual(expect.arrayContaining(['users:admin', 'orders:read']));
    expect(payload.platformOnly).toBeUndefined();
  });

  it('applies the request platformCompany context to internal reloads', async () => {
    const { db } = prisma();
    const payload = await runWithCompanyContext(companyId, () => buildLoadedAuthTokenPayload(db, platformUser), platformCompany());
    expect(payload.roleIds).toEqual([roleId]);
  });

  it('rejects another company or a non-platform account', async () => {
    const { db } = prisma();
    await expect(buildLoadedAuthTokenPayload(db, platformUser, 'c2', platformCompany())).rejects.toMatchObject({ code: 'PLATFORM_COMPANY_ACCESS_DENIED' });
    const companyUser = { ...platformUser, platformRole: null };
    await expect(buildLoadedAuthTokenPayload(db, companyUser, companyId, platformCompany())).rejects.toMatchObject({ code: 'PLATFORM_COMPANY_ACCESS_DENIED' });
  });

  it('keeps platformCompany sessions out of company business data', () => {
    const run = (path: string) => {
      const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }, next = vi.fn();
      tenantSurfaceGuard({ path, actor: { companyId, platformCompany: platformCompany() } } as any, res, next);
      return next.mock.calls.length ? 'next' : res.json.mock.calls[0][0].error;
    };
    expect(run('/mist/workspaces')).toBe('PLATFORM_COMPANY_ROUTE_UNAVAILABLE');
    expect(run('/admin/users')).toBe('next');
    expect(run('/hr/departments')).toBe('next');
  });
});

describe('platform company management routes', () => {
  const auth = createAuthService();
  const token = auth.signToken({ userId: platformUser.id, roles: [], permissions: [], departmentIds: [], platformOnly: true });
  const app = (db: any) => {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use('/platform', createPlatformRouter({ prisma: db }));
    return a;
  };

  it('enters without an assistance reason', async () => {
    const res = await request(app(prisma().db)).post(`/platform/companies/${companyId}/management-session`).set('Authorization', `Bearer ${token}`).send({ reason: ' ' });
    expect(res.status).toBe(200);
    expect(res.body.user.platformCompany).not.toHaveProperty('expiresAt');
  });

  it('selects a company with audit and returns to the platform', async () => {
    const { db, audit } = prisma();
    const started = await request(app(db)).post(`/platform/companies/${companyId}/management-session`).set('Authorization', `Bearer ${token}`).send({ reason: '客户来电协助开通账号' });
    expect(started.status).toBe(200);
    const issued = auth.verifyToken(started.body.token);
    expect(issued).toMatchObject({ companyId, roleIds: [roleId], platformCompany: { companyId } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'platform_company_enter', targetId: companyId }) }));

    const exited = await request(app(db)).post('/platform/management-session/exit').set('Authorization', `Bearer ${started.body.token}`).send();
    expect(exited.status).toBe(200);
    const back = auth.verifyToken(exited.body.token);
    expect(back.platformOnly).toBe(true);
    expect(back.platformCompany).toBeUndefined();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'platform_company_exit' }) }));
  });

  it('refuses a nonexistent company', async () => {
    const res = await request(app(prisma().db)).post('/platform/companies/c9/management-session').set('Authorization', `Bearer ${token}`).send({ reason: '协助处理' });
    expect(res.status).toBe(404);
  });
});

describe('platform company management audit', () => {
  const auth = createAuthService();
  const token = auth.signToken({ userId: platformUser.id, companyId, roles: [], permissions: [], departmentIds: [], platformCompany: platformCompany() });
  const app = (db: any) => {
    const a = express();
    a.use(express.json());
    a.use(createAuthorizationSnapshotGuard({ prisma: db }));
    a.all('*', (req, res) => res.json({ ok: true, actor: (req as any).actor }));
    return a;
  };

  it('records every change made during platformCompany and lets reads through', async () => {
    const { db, audit } = prisma();
    const read = await request(app(db)).get('/admin/users').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.actor).toMatchObject({ companyId, platformCompany: { companyId } });
    expect(audit).not.toHaveBeenCalled();
    const write = await request(app(db)).post('/admin/users').set('Authorization', `Bearer ${token}`).send({});
    expect(write.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'platform_company_request', targetId: companyId, detail: expect.objectContaining({ method: 'POST', path: '/admin/users' }) }) }));
  });

  it('refuses a change it cannot record', async () => {
    const { db } = prisma({ auditLog: { create: vi.fn(async () => { throw new Error('down'); }) } });
    const res = await request(app(db)).post('/admin/users').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AUDIT_UNAVAILABLE');
  });
});

it('manages a suspended company without a company role or membership', async () => {
 const {db}=prisma({company:{findFirst:vi.fn(async()=>({id:companyId,name:'甲公司',status:'suspended'}))},role:{findFirst:vi.fn(async()=>null)}});
 const payload=await buildLoadedAuthTokenPayload(db,platformUser,companyId,platformCompany({startedAt:'2020-01-01T00:00:00Z'}));
 expect(payload.permissions).toContain('users:admin');expect(payload.permissions).toContain('hr:write');expect(db.role.findFirst).not.toHaveBeenCalled();expect(db.companyMember.findFirst).not.toHaveBeenCalled();
});
