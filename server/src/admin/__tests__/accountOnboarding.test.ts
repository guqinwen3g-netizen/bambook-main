/**
 * 公司管理员新建账号：首次登录强制改密、邀请开通方式、中文校验提示。
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminRouter } from '../route';
import { createAuthService } from '../../auth/service';

const token = createAuthService().signToken({ userId: 'owner', roles: ['owner'], permissions: ['users:admin'], departmentIds: [] });
const body = { displayName: '新员工', email: 'new@example.com', password: 'safe-test-only1', roles: ['role-sales'], departmentId: 'dept' };

function fixture(existing: any = null) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    userAccount: { create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })), update: vi.fn(async ({ data }: any) => ({ id: existing?.id ?? 'old', ...data })) },
    userRole: { deleteMany: vi.fn(), create: vi.fn() },
    companyMember: { upsert: vi.fn() },
  };
  const prisma: any = {
    userAccount: { findFirst: vi.fn().mockResolvedValue(existing), findUnique: vi.fn().mockResolvedValue(null) },
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-sales' }), findFirst: vi.fn().mockResolvedValue(null) },
    department: { findUnique: vi.fn().mockResolvedValue({ id: 'dept', parentId: 'company', status: 'active' }) },
    company: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', name: '青屿纺织' }) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const deliver = vi.fn().mockResolvedValue({ status: 'sent', message: '邮件已提交发送，请收件人检查收件箱及垃圾邮件。' });
  const app = express(); app.use(express.json());
  app.use('/admin', createAdminRouter({ prisma, accountAccess: { deliver } } as any));
  return { app, prisma, tx, deliver };
}
const post = (app: express.Express, data: object) => request(app).post('/admin/users').set('Authorization', `Bearer ${token}`).send(data);

describe('公司新建账号 · 首次登录强制改密', () => {
  it('设置初始密码新建的账号首次登录须先改密', async () => {
    const f = fixture();
    expect((await post(f.app, body)).status).toBe(200);
    expect(f.tx.userAccount.create.mock.calls[0][0].data.metadata).toMatchObject({ forceChangePassword: true, forceChangeReason: 'initial' });
  });
  it('重新启用已停用账号并设新初始密码时同样须先改密', async () => {
    const f = fixture({ id: 'old', status: 'disabled', deletedAt: null, platformRole: null, metadata: { note: 'keep' } });
    expect((await post(f.app, body)).status).toBe(200);
    expect(f.tx.userAccount.update.mock.calls[0][0].data.metadata).toMatchObject({ note: 'keep', forceChangePassword: true, forceChangeReason: 'initial' });
  });
});

describe('公司新建账号 · 邀请邮件开通', () => {
  it('邀请方式不需要初始密码，复用邀请链接并如实返回发送结果', async () => {
    const f = fixture();
    const res = await post(f.app, { ...body, password: undefined, deliveryMode: 'invite' });
    expect(res.status).toBe(200);
    expect(res.body.invitation).toEqual({ status: 'sent', message: '邮件已提交发送，请收件人检查收件箱及垃圾邮件。' });
    expect(f.deliver).toHaveBeenCalledWith(res.body.userId, 'invite', 'owner', undefined);
    expect(f.tx.userAccount.create.mock.calls[0][0].data.metadata).toMatchObject({ forceChangePassword: true, forceChangeReason: 'invite' });
  });
  it('邮件服务不可用时账号保留并如实提示未发送', async () => {
    const f = fixture();
    f.deliver.mockResolvedValueOnce({ status: 'unavailable', message: '账号已保留，邮件服务未配置，请联系平台管理员后重发。' });
    const res = await post(f.app, { ...body, password: undefined, deliveryMode: 'invite' });
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe('unavailable');
  });
  it('拒绝未知的开通方式', async () => {
    const res = await post(fixture().app, { ...body, deliveryMode: 'sms' });
    expect(res.status).toBe(400); expect(res.body.message).toBe('请选择账号开通方式。');
  });
});

describe('公司新建账号 · 中文校验提示', () => {
  it.each([
    [{ displayName: '' }, '请填写姓名。'],
    [{ email: '' }, '请填写登录邮箱。'],
    [{ email: 'not-an-email' }, '登录邮箱格式不正确。'],
    [{ password: '' }, '请设置初始密码，或改用邀请邮件。'],
  ])('缺少或无效字段 %o → %s', async (patch, message) => {
    const res = await post(fixture().app, { ...body, ...patch });
    expect(res.status).toBe(400); expect(res.body.message).toBe(message);
  });
  it('邮箱已被在用账号占用时说明状态', async () => {
    const res = await post(fixture({ id: 'x', status: 'active', deletedAt: null, platformRole: null }).app, body);
    expect(res.status).toBe(409); expect(res.body.message).toBe('该邮箱已被在用账号使用，请换一个邮箱。');
  });
  it('邮箱属于待审批申请时说明去审批', async () => {
    const res = await post(fixture({ id: 'x', status: 'pending', deletedAt: null, platformRole: null }).app, body);
    expect(res.status).toBe(409); expect(res.body.message).toBe('该邮箱已有待审批的注册申请，请在账号列表中审批。');
  });
});
