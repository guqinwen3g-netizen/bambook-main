/** 平台代管：平台人员限时、留痕地以公司超级管理员权限办理公司后台，不成为公司成员。 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildLoadedAuthTokenPayload } from '../tokenHelpers';
import { runWithCompanyContext, type SupportSession } from '../requestCompanyContext';
import { tenantSurfaceGuard } from '../tenantSurfaceGuard';
import { createAuthService } from '../service';
import { createPlatformRouter } from '../../platform/route';
import { createAuthorizationSnapshotGuard } from '../authorizationSnapshotGuard';

const companyId = 'c1';
const roleId = `role-super-admin@${companyId}`;
const platformUser = { id: 'p1', displayName: '平台', platformRole: 'platform_admin', status: 'active', deletedAt: null, metadata: {}, roles: [], companyMembers: [], primaryDepartment: null, primaryDeptId: null };
const support = (patch: Partial<SupportSession> = {}): SupportSession => ({
  companyId, companyName: '甲公司', reason: '客户来电协助开通账号', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), ...patch,
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

describe('platform support session authorization', () => {
  it('grants the company super-admin permissions without a membership', async () => {
    const { db } = prisma();
    const payload = await buildLoadedAuthTokenPayload(db, platformUser, companyId, support());
    expect(payload).toMatchObject({ companyId, roleIds: [roleId], support: { companyId } });
    expect(payload.permissions).toEqual(expect.arrayContaining(['users:admin', 'orders:read']));
    expect(payload.platformOnly).toBeUndefined();
  });

  it('applies the request support context to internal reloads', async () => {
    const { db } = prisma();
    const payload = await runWithCompanyContext(companyId, () => buildLoadedAuthTokenPayload(db, platformUser), support());
    expect(payload.roleIds).toEqual([roleId]);
  });

  it('ends on expiry, another company, or a non-platform account', async () => {
    const { db } = prisma();
    await expect(buildLoadedAuthTokenPayload(db, platformUser, companyId, support({ expiresAt: new Date(Date.now() - 1000).toISOString() }))).rejects.toMatchObject({ code: 'SUPPORT_SESSION_ENDED' });
    await expect(buildLoadedAuthTokenPayload(db, platformUser, 'c2', support())).rejects.toMatchObject({ code: 'SUPPORT_SESSION_ENDED' });
    const companyUser = { ...platformUser, platformRole: null };
    await expect(buildLoadedAuthTokenPayload(db, companyUser, companyId, support())).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' });
  });

  it('keeps support sessions out of company business data', () => {
    const run = (path: string) => {
      const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }, next = vi.fn();
      tenantSurfaceGuard({ path, actor: { companyId, support: support() } } as any, res, next);
      return next.mock.calls.length ? 'next' : res.json.mock.calls[0][0].error;
    };
    expect(run('/mist/workspaces')).toBe('SUPPORT_ROUTE_UNAVAILABLE');
    expect(run('/admin/users')).toBe('next');
    expect(run('/hr/departments')).toBe('next');
  });
});

describe('platform support session routes', () => {
  const auth = createAuthService();
  const token = auth.signToken({ userId: platformUser.id, roles: [], permissions: [], departmentIds: [], platformOnly: true });
  const app = (db: any) => {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use('/platform', createPlatformRouter({ prisma: db }));
    return a;
  };

  it('requires a reason', async () => {
    const res = await request(app(prisma().db)).post(`/platform/companies/${companyId}/support-session`).set('Authorization', `Bearer ${token}`).send({ reason: ' ' });
    expect(res.status).toBe(400);
  });

  it('starts a time-limited audited session and exits back to the platform', async () => {
    const { db, audit } = prisma();
    const started = await request(app(db)).post(`/platform/companies/${companyId}/support-session`).set('Authorization', `Bearer ${token}`).send({ reason: '客户来电协助开通账号' });
    expect(started.status).toBe(200);
    const issued = auth.verifyToken(started.body.token);
    expect(issued).toMatchObject({ companyId, roleIds: [roleId], support: { companyId, reason: '客户来电协助开通账号' } });
    expect(Date.parse(issued.support!.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 3600_000);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'platform_support_start', targetId: companyId }) }));

    const exited = await request(app(db)).post('/platform/support-session/exit').set('Authorization', `Bearer ${started.body.token}`).send();
    expect(exited.status).toBe(200);
    const back = auth.verifyToken(exited.body.token);
    expect(back.platformOnly).toBe(true);
    expect(back.support).toBeUndefined();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'platform_support_end' }) }));
  });

  it('refuses an inactive company', async () => {
    const res = await request(app(prisma().db)).post('/platform/companies/c9/support-session').set('Authorization', `Bearer ${token}`).send({ reason: '协助处理' });
    expect(res.status).toBe(404);
  });
});

describe('platform support session audit', () => {
  const auth = createAuthService();
  const token = auth.signToken({ userId: platformUser.id, companyId, roles: [], permissions: [], departmentIds: [], support: support() });
  const app = (db: any) => {
    const a = express();
    a.use(express.json());
    a.use(createAuthorizationSnapshotGuard({ prisma: db }));
    a.all('*', (req, res) => res.json({ ok: true, actor: (req as any).actor }));
    return a;
  };

  it('records every change made during support and lets reads through', async () => {
    const { db, audit } = prisma();
    const read = await request(app(db)).get('/admin/users').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.actor).toMatchObject({ companyId, support: { companyId } });
    expect(audit).not.toHaveBeenCalled();
    const write = await request(app(db)).post('/admin/users').set('Authorization', `Bearer ${token}`).send({});
    expect(write.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'platform_support_request', targetId: companyId, detail: expect.objectContaining({ method: 'POST', path: '/admin/users' }) }) }));
  });

  it('refuses a change it cannot record', async () => {
    const { db } = prisma({ auditLog: { create: vi.fn(async () => { throw new Error('down'); }) } });
    const res = await request(app(db)).post('/admin/users').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AUDIT_UNAVAILABLE');
  });
});
