import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthService } from '../../auth/service';
import { createAdminRouter } from '../route';
/** 2026-11：后台账号只读按 users:read；审计日志导出按 audit:export；其余后台接口仍要 users:admin。 */
const token = (permissions: string[]) => createAuthService().signToken({ userId: 'u-1', displayName: 'U', roles: [], permissions, departmentIds: [] } as any);
function app() {
  const prisma: any = {
    userAccount: { findMany: vi.fn().mockResolvedValue([]) },
    department: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeAcl: { create: vi.fn().mockResolvedValue({ id: 'acl-1' }), findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', action: 'login', createdAt: new Date('2026-10-18T02:00:00Z'), actor: { id: 'u1', displayName: '林舒', email: 'l@x' }, targetType: 'UserAccount', targetId: 'u1' }]), count: vi.fn().mockResolvedValue(1) },
  };
  const a = express(); a.use(express.json()); a.use('/admin', createAdminRouter({ prisma })); return { a, prisma };
}
describe('后台权限码判定点', () => {
  it('users:read 可以读取账号列表，但不能修改账号或读取审计日志', async () => {
    const { a } = app(), auth = `Bearer ${token(['users:read'])}`;
    expect((await request(a).get('/admin/users').set('Authorization', auth)).status).toBe(200);
    expect((await request(a).post('/admin/users').set('Authorization', auth).send({})).status).toBe(403);
    expect((await request(a).get('/admin/audit-logs').set('Authorization', auth)).status).toBe(403);
  });
  it('没有 users:read / users:admin 时不能读取账号列表', async () => {
    const { a } = app();
    expect((await request(a).get('/admin/users').set('Authorization', `Bearer ${token(['orders:read'])}`)).status).toBe(403);
  });
  it('audit:export 可以导出审计日志 CSV；只有 users:admin 不能导出', async () => {
    const { a, prisma } = app();
    const ok = await request(a).get('/admin/audit-logs/export?targetType=UserAccount').set('Authorization', `Bearer ${token(['audit:export'])}`);
    expect(ok.status).toBe(200); expect(ok.headers['content-type']).toContain('text/csv'); expect(ok.text).toContain('林舒');
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ targetType: 'UserAccount' });
    expect((await request(a).get('/admin/audit-logs/export').set('Authorization', `Bearer ${token(['users:admin'])}`)).status).toBe(403);
  });
  it('导出筛选参数非法时 400，不查库', async () => {
    const { a, prisma } = app();
    expect((await request(a).get('/admin/audit-logs/export?createdFrom=abc').set('Authorization', `Bearer ${token(['audit:export'])}`)).status).toBe(400);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
  it('知识库 ACL 写入需要 knowledge:admin；只有 users:admin 不能改', async () => {
    const { a, prisma } = app();
    const res = await request(a).post('/admin/knowledge-acl').set('Authorization', `Bearer ${token(['users:admin'])}`).send({ documentId: 'd', roleId: 'r', permission: 'read' });
    expect(res.status).toBe(403); expect(prisma.knowledgeAcl.create).not.toHaveBeenCalled();
    const ok = await request(a).post('/admin/knowledge-acl').set('Authorization', `Bearer ${token(['users:admin', 'knowledge:admin'])}`).send({ documentId: 'd', roleId: 'r', permission: 'read' });
    expect(ok.status).not.toBe(403);
  });
});
