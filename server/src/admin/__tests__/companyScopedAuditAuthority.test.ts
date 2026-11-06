import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthService } from '../../auth/service';
import { createAdminRouter } from '../route';
import { tenantSurfaceGuard } from '../../auth/tenantSurfaceGuard';
import { auditCompanyIdFor, installAuditCompanyStamp } from '../../audit/auditCompanyStamp';
import { runWithCompanyContext } from '../../auth/requestCompanyContext';
import { createOrderMainApprovalService } from '../../orders/orderMainApprovalService';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const token = (companyId?: string) => createAuthService().signToken({ userId: 'owner-1', roles: ['owner'], permissions: ['users:admin', 'audit:export'], departmentIds: [], ...(companyId ? { companyId } : {}) });

function app(prisma: any) {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { (req as any).actor = createAuthService().verifyToken(String(req.headers.authorization).slice(7)); next(); }, tenantSurfaceGuard);
  a.use('/admin', createAdminRouter({ prisma })); return a;
}

describe('company-scoped admin audit log', () => {
  const prisma = () => ({ auditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } });
  it('company account is no longer blocked and only queries its own company', async () => {
    const db = prisma();
    const r = await request(app(db)).get('/admin/audit-logs?targetType=Order').set('Authorization', 'Bearer ' + token(A));
    expect(r.status).toBe(200);
    expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({ AND: [expect.objectContaining({ targetType: 'Order' }), { companyId: A }] });
    expect(db.auditLog.count.mock.calls[0][0].where).toEqual(db.auditLog.findMany.mock.calls[0][0].where);
  });
  it('a forged companyId query parameter cannot widen the company filter', async () => {
    const db = prisma();
    await request(app(db)).get('/admin/audit-logs?companyId=' + B).set('Authorization', 'Bearer ' + token(A));
    expect(JSON.stringify(db.auditLog.findMany.mock.calls[0][0].where)).not.toContain(B);
  });
  it('export is filtered by the company too', async () => {
    const db = prisma();
    const r = await request(app(db)).get('/admin/audit-logs/export').set('Authorization', 'Bearer ' + token(A));
    expect(r.status).toBe(200);
    expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({ AND: [expect.anything(), { companyId: A }] });
  });
  it('platform session that entered a company is scoped to it even without a token companyId', async () => {
    const db = prisma();
    const entered = createAuthService().signToken({ userId: 'platform-1', roles: ['owner'], permissions: ['users:admin'], departmentIds: [],
      platformCompany: { companyId: B, companyName: 'B', startedAt: new Date().toISOString() } } as any);
    const a = express(); a.use((req, _res, next) => { (req as any).actor = createAuthService().verifyToken(entered); next(); }); a.use('/admin', createAdminRouter({ prisma: db }));
    expect((await request(a).get('/admin/audit-logs').set('Authorization', 'Bearer ' + entered)).status).toBe(200);
    expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({ AND: [expect.anything(), { companyId: B }] });
  });
  it('no-company session keeps the global query', async () => {
    const db = prisma();
    await request(app(db)).get('/admin/audit-logs').set('Authorization', 'Bearer ' + token());
    expect(db.auditLog.findMany.mock.calls[0][0].where).not.toHaveProperty('AND');
  });
  it('other legacy admin surfaces stay closed to company sessions', async () => {
    expect((await request(app(prisma())).get('/admin/knowledge-acl').set('Authorization', 'Bearer ' + token(A))).status).toBe(403);
  });
});

describe('audit company stamp', () => {
  it('uses request company context, keeps explicit values, falls back to detail.companyId', () => {
    expect(runWithCompanyContext(A, () => auditCompanyIdFor({ actorId: 'x' }))).toBe(A);
    expect(runWithCompanyContext(A, () => auditCompanyIdFor({ actorId: 'x', companyId: null }))).toBeUndefined();
    expect(auditCompanyIdFor({ actorId: 'x', detail: { companyId: B } })).toBe(B);
    expect(auditCompanyIdFor({ actorId: 'x', detail: { companyId: 'not-a-uuid' } })).toBeUndefined();
    expect(auditCompanyIdFor({ actorId: 'x' })).toBeUndefined();
  });
  it('stamps creates through the Prisma middleware', async () => {
    let middleware: any; installAuditCompanyStamp({ $use: (fn: any) => { middleware = fn; } });
    const next = vi.fn(async (params: any) => params.args.data);
    expect(await runWithCompanyContext(A, () => middleware({ model: 'AuditLog', action: 'create', args: { data: { id: '1' } } }, next))).toEqual({ id: '1', companyId: A });
    expect(await middleware({ model: 'Order', action: 'create', args: { data: { id: '2' } } }, next)).toEqual({ id: '2' });
  });
});

describe('company-scoped order approval authority service', () => {
  function db() {
    const tx: any = {
      userAccount: { findMany: vi.fn(async () => [{ id: 'm1' }]) },
      orderApprovalAuthority: { findMany: vi.fn(async () => [{ userId: 'm1' }]), updateMany: vi.fn(), findFirst: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    return { tx, prisma: { ...tx, $transaction: async (fn: any) => fn(tx) } as any };
  }
  it('resolve only considers the given company assignments and owners', async () => {
    const { tx, prisma } = db();
    expect(await createOrderMainApprovalService(prisma).resolveEligibleReviewerIds(tx, 'garment', A)).toEqual(['m1']);
    expect(tx.orderApprovalAuthority.findMany.mock.calls[0][0].where).toMatchObject({ companyId: A, user: { companyMembers: { some: { companyId: A, status: 'active' } } } });
    expect(tx.userAccount.findMany.mock.calls[0][0].where).toMatchObject({ companyMembers: { some: { companyId: A } }, roles: { some: { role: { companyId: A } } } });
  });
  it('resolve without company only reads unscoped configuration', async () => {
    const { tx, prisma } = db();
    await createOrderMainApprovalService(prisma).resolveEligibleReviewerIds(tx, 'garment', null);
    expect(tx.orderApprovalAuthority.findMany.mock.calls[0][0].where.companyId).toBeNull();
  });
  it('replace rejects non-members and only touches the company rows', async () => {
    const { tx, prisma } = db(); tx.userAccount.findMany.mockResolvedValueOnce([]);
    await expect(createOrderMainApprovalService(prisma).replaceAuthorityConfig({ businessLine: 'fabric', userIds: ['outsider'], actorId: 'owner-1', companyId: A }))
      .rejects.toMatchObject({ code: 'ORDER_APPROVAL_AUTHORITY_INVALID_USER' });
    expect(tx.orderApprovalAuthority.updateMany).not.toHaveBeenCalled();
    const ok = db(); await createOrderMainApprovalService(ok.prisma).replaceAuthorityConfig({ businessLine: 'fabric', userIds: ['m1'], actorId: 'owner-1', companyId: A });
    expect(ok.tx.orderApprovalAuthority.updateMany.mock.calls[0][0].where).toEqual({ businessLine: 'fabric', companyId: A });
    expect(ok.tx.orderApprovalAuthority.create.mock.calls[0][0].data).toMatchObject({ companyId: A, userId: 'm1' });
    expect(ok.tx.auditLog.create.mock.calls[0][0].data.companyId).toBe(A);
  });
});
