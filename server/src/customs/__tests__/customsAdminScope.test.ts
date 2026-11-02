import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentTemplateRouter } from '../documentTemplateRoute';
import { createSealRouter } from '../../seal/sealRoute';
import { DEFAULT_ROLE_PERMISSION_MATRIX, SYSTEM_ROLE_IDS } from '../../_shared/rolePermissionMatrix';
/** 2026-11：单证模板与印章 / 签章配置写入按 customs:admin 判定；只有单证写权限的人不能改。 */
const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const token = (permissions: string[], roleIds: string[] = []) => jwt.sign({ userId: 'u1', roles: [], roleIds, permissions, departmentIds: [], authorizationLoaded: true }, SECRET);
const prismaProxy = () => { const call = vi.fn(); return { call, prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => call }) }) as any }; };
describe('customs:admin 判定点', () => {
  it('单证模板：只有 customs:write 不能新建或修改模板，且不触库', async () => {
    const { call, prisma } = prismaProxy(), app = express(); app.use(express.json());
    app.use('/t', createDocumentTemplateRouter({ prisma, requireAuth: true, apiKeys: new Set() }));
    const auth = `Bearer ${token(['customs:read', 'customs:write'])}`;
    expect((await request(app).post('/t').set('Authorization', auth).send({ name: 'CI', type: 'CI', content: 'x' })).status).toBe(403);
    expect((await request(app).patch('/t/1').set('Authorization', auth).send({ name: 'CI' })).status).toBe(403);
    expect((await request(app).delete('/t/1').set('Authorization', auth)).status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });
  it('印章：管理员角色但没有 customs:admin 时不能上传或修改印章', async () => {
    const { call, prisma } = prismaProxy(), app = express(); app.use(express.json());
    app.use('/s', createSealRouter({ prisma, requireAuth: true, apiKeys: new Set() }));
    const auth = `Bearer ${token(['users:admin'], [SYSTEM_ROLE_IDS.ADMIN])}`;
    expect((await request(app).post('/s').set('Authorization', auth).send({})).status).toBe(403);
    expect((await request(app).patch('/s/1').set('Authorization', auth).send({})).status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });
  it('岗位默认矩阵：后勤与管理员持有 customs:admin，业务员没有', () => {
    expect(DEFAULT_ROLE_PERMISSION_MATRIX[SYSTEM_ROLE_IDS.LOGISTICS]['customs:admin']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSION_MATRIX[SYSTEM_ROLE_IDS.ADMIN]['customs:admin']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSION_MATRIX[SYSTEM_ROLE_IDS.SALES]['customs:admin']).toBeUndefined();
  });
});
