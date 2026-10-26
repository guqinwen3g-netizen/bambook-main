import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../../auth/service';
import { createAdminRouter } from '../route';

const COMPANY = 'co-1';
const token = () => createAuthService().signToken({
  userId: 'owner-1', displayName: 'Owner', roles: ['owner'], companyId: COMPANY,
  permissions: ['users:read', 'users:write', 'users:admin', 'roles:read', 'roles:write'], departmentIds: [],
} as any);

let prisma: any, member: any;
function app() {
  const a = express();
  a.use(express.json());
  a.use('/admin', createAdminRouter({ prisma }));
  return a;
}

beforeEach(() => {
  member = { id: 'm-1', companyId: COMPANY, userId: 'applicant', status: 'pending' };
  const salesRole = { id: `role-sales@${COMPANY}`, name: '业务员', isSystem: true, companyId: COMPANY };
  prisma = {
    companyMember: {
      findMany: vi.fn(async ({ where }: any) => (where.status?.in ?? [where.status]).includes(member.status) ? [{ companyId: COMPANY }] : []),
      findUnique: vi.fn(async () => member),
      update: vi.fn(async ({ data }: any) => Object.assign(member, data)),
      updateMany: vi.fn(async ({ data }: any) => { Object.assign(member, data); return { count: 1 }; }),
      count: vi.fn(async () => 3),
    },
    company: { findUnique: vi.fn(async () => ({ seatLimit: 10 })) },
    department: { findUnique: vi.fn(async () => ({ id: 'dept-sales', parentId: `dept-company@${COMPANY}`, status: 'active', companyId: COMPANY })) },
    userAccount: {
      findUnique: vi.fn(async () => ({ id: 'applicant', status: 'pending', primaryDeptId: null, metadata: {}, email: 'staff@example.test', displayName: '林澈' })),
      update: vi.fn(async ({ data }: any) => data),
    },
    role: { findUnique: vi.fn(async () => salesRole), findFirst: vi.fn(async () => salesRole) },
    userRole: { deleteMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
});

describe('company admin handling of join requests', () => {
  it('lets the company admin reach its own pending applicant', async () => {
    const res = await request(app()).post('/admin/users/applicant/approve').set('Authorization', `Bearer ${token()}`).send({ roles: [`role-sales@${COMPANY}`], departmentId: 'dept-sales' });
    expect(res.status).not.toBe(404);
    expect(prisma.companyMember.findMany.mock.calls[0][0].where.status).toEqual({ in: ['active', 'pending', 'suspended'] });
  });

  it('activates the pending membership together with the account', async () => {
    const res = await request(app()).post('/admin/users/applicant/approve').set('Authorization', `Bearer ${token()}`).send({ roles: [`role-sales@${COMPANY}`], departmentId: 'dept-sales' });
    expect(res.status).toBe(200);
    expect(member.status).toBe('active');
    expect(member.joinedAt).toBeInstanceOf(Date);
    expect(prisma.userAccount.update.mock.calls[0][0].data).toMatchObject({ status: 'active', primaryDeptId: 'dept-sales' });
  });

  it('refuses approval when the company has no free seat', async () => {
    prisma.company.findUnique.mockResolvedValue({ seatLimit: 3 });
    const res = await request(app()).post('/admin/users/applicant/approve').set('Authorization', `Bearer ${token()}`).send({ roles: [`role-sales@${COMPANY}`], departmentId: 'dept-sales' });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('席位已满');
    expect(member.status).toBe('pending');
    expect(prisma.userAccount.update).not.toHaveBeenCalled();
  });

  it('refuses a department from another company', async () => {
    prisma.department.findUnique.mockResolvedValue({ id: 'dept-x', parentId: 'dept-company@co-2', status: 'active', companyId: 'co-2' });
    const res = await request(app()).post('/admin/users/applicant/approve').set('Authorization', `Bearer ${token()}`).send({ roles: [`role-sales@${COMPANY}`], departmentId: 'dept-x' });
    expect(res.status).toBe(400);
    expect(member.status).toBe('pending');
  });

  it('closes the pending membership when the request is rejected', async () => {
    const res = await request(app()).post('/admin/users/applicant/reject').set('Authorization', `Bearer ${token()}`).send({ reason: '不是本公司员工' });
    expect(res.status).toBe(200);
    expect(prisma.companyMember.updateMany.mock.calls[0][0]).toEqual({ where: { companyId: COMPANY, userId: 'applicant', status: 'pending' }, data: { status: 'left' } });
    expect(member.status).toBe('left');
  });
});
