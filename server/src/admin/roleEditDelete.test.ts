import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAdminRouter } from './route';
import { createAuthService } from '../auth/service';

const token = (roles: string[]) => createAuthService().signToken({
  userId: roles.includes('owner') ? 'owner-1' : 'admin-1', displayName: 'Tester', roles,
  permissions: ['users:read', 'users:write', 'users:admin', 'roles:read', 'roles:write'], departmentIds: [],
} as any);

function setup(role: any, options: { others?: Array<{ id: string; name: string }>; holders?: any[] } = {}) {
  const tx = {
    role: { update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
    knowledgeAcl: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    agentPolicy: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    role: { findUnique: vi.fn().mockResolvedValue(role), findMany: vi.fn().mockResolvedValue([...(role ? [{ id: role.id, name: role.name }] : []), ...(options.others ?? [])]) },
    userRole: { findMany: vi.fn().mockResolvedValue(options.holders ?? []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const app = express(); app.use(express.json()); app.use('/admin', createAdminRouter({ prisma }));
  return { app, prisma, tx };
}
const custom = { id: 'role-merch', name: '跟单员（服装）', description: null, isSystem: false, companyId: null };

describe('custom role edit and delete', () => {
  it('owner renames a custom role and the change is audited', async () => {
    const f = setup(custom);
    const res = await request(f.app).patch('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`).send({ name: '  跟单员 ( 成衣 ) ', description: '成衣订单跟进' });
    expect(res.status).toBe(200);
    expect(f.tx.role.update).toHaveBeenCalledWith({ where: { id: 'role-merch' }, data: { name: '跟单员 ( 成衣 )', description: '成衣订单跟进' } });
    expect(f.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'update_role', targetId: 'role-merch' });
  });

  it('refuses a duplicate name, an empty name, a system role and a non-owner, without writing', async () => {
    const dup = setup(custom, { others: [{ id: 'role-x', name: '外贸经理' }] });
    expect((await request(dup.app).patch('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`).send({ name: '外贸经理' })).body.error).toBe('DUPLICATE_ROLE_NAME');
    expect((await request(dup.app).patch('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`).send({ name: '  ' })).status).toBe(400);
    const sys = setup({ ...custom, isSystem: true });
    expect((await request(sys.app).patch('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`).send({ name: '新名' })).body.error).toBe('SYSTEM_ROLE');
    expect((await request(sys.app).delete('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`)).body.error).toBe('SYSTEM_ROLE');
    const admin = setup(custom);
    expect((await request(admin.app).patch('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['admin'])}`).send({ name: '新名' })).status).toBe(403);
    expect((await request(admin.app).delete('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['admin'])}`)).status).toBe(403);
    for (const f of [dup, sys, admin]) { expect(f.tx.role.update).not.toHaveBeenCalled(); expect(f.tx.role.delete).not.toHaveBeenCalled(); }
  });

  it('will not delete a role still held by active accounts and names them', async () => {
    const f = setup(custom, { holders: [{ user: { displayName: '林澈' } }, { user: { displayName: '沈禾' } }] });
    const res = await request(f.app).delete('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'ROLE_IN_USE' });
    expect(res.body.message).toContain('林澈');
    expect(f.tx.role.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused role with its knowledge grants and assistant policies, and audits it', async () => {
    const f = setup(custom);
    const res = await request(f.app).delete('/admin/roles/role-merch').set('Authorization', `Bearer ${token(['owner'])}`);
    expect(res.status).toBe(200);
    expect(f.tx.knowledgeAcl.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-merch' } });
    expect(f.tx.agentPolicy.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-merch' } });
    expect(f.tx.role.delete).toHaveBeenCalledWith({ where: { id: 'role-merch' } });
    expect(f.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'delete_role', targetId: 'role-merch' });
  });

  it('treats another company\'s role as not found', async () => {
    const f = setup({ ...custom, companyId: 'company-b' });
    const companyToken = createAuthService().signToken({ userId: 'owner-a', displayName: 'A', roles: ['owner'], permissions: ['roles:read', 'roles:write'], departmentIds: [], companyId: 'company-a' } as any);
    expect((await request(f.app).delete('/admin/roles/role-merch').set('Authorization', `Bearer ${companyToken}`)).status).toBe(404);
    expect(f.tx.role.delete).not.toHaveBeenCalled();
  });
});
