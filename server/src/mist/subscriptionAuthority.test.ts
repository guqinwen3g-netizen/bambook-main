/**
 * 个人订阅与平台模型路由必须与其他 Mist 路由一样实时核验账号：
 * 待改密、已停用、已撤销的令牌都不能使用，拒绝码与 /workspaces 一致。
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMistRouter } from './route';
import { MistRepository, type MistContract } from './repository';
import { MistPrivateFiles } from './files';
import { CodexSubscriptionService } from '../ai/codexSubscription';
import { createPlatformProviderStore } from '../ai/platformProviders';
import { createAuthService } from '../auth/service';
import * as contract from '../shared/mistWorkspace';

const auth = createAuthService();
let dir: string;
let users: Record<string, any>;
const role = { roleId: 'role-sales', role: { id: 'role-sales', code: null, permissions: [{ permission: { scope: 'ai:chat' } }] } };
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mist-sub-auth-'));
  users = {
    staff: { id: 'staff', displayName: 'Staff', status: 'active', deletedAt: null, platformRole: null, primaryDeptId: null, primaryDepartment: null, roles: [role], metadata: { credentialVersion: 'v1' } },
    platform: { id: 'platform', displayName: 'Platform', status: 'active', deletedAt: null, platformRole: 'platform_admin', primaryDeptId: null, primaryDepartment: null, roles: [], metadata: { credentialVersion: 'v1' } },
  };
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function app() {
  const prisma: any = {
    userAccount: {
      findFirst: async ({ where }: any) => (users[where.id] && !(where.deletedAt === null && users[where.id].deletedAt != null) ? structuredClone(users[where.id]) : null),
      findUnique: async ({ where }: any) => (users[where.id] ? structuredClone(users[where.id]) : null),
    },
    userPermissionOverrides: { findMany: async () => [] },
    mistWorkspace: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  const repository = new MistRepository(prisma, contract as unknown as MistContract, new MistPrivateFiles(dir));
  const a = express(); a.use(express.json()); a.use(cookieParser());
  a.use('/api/mist', createMistRouter({ prisma, repository, subscriptions: new CodexSubscriptionService({ dir, enabled: false }), platformProviders: createPlatformProviderStore({ dir }) }));
  return a;
}
const tokenOf = (userId: string) => auth.signToken({ userId, roles: [], permissions: ['ai:chat'], departmentIds: [], credentialVersion: 'v1' } as any);
const get = (server: express.Express, url: string, token: string) => request(server).get(url).set('Authorization', `Bearer ${token}`);

describe('Mist 订阅 / 平台模型路由的实时授权', () => {
  it('正常账号可读取个人订阅，平台管理员可读取平台模型', async () => {
    const server = app();
    expect((await get(server, '/api/mist/ai/subscriptions', tokenOf('staff'))).status).toBe(200);
    expect((await get(server, '/api/mist/ai/platform-model', tokenOf('platform'))).status).toBe(200);
  });

  it.each([
    ['待改密', (u: any) => { u.metadata.forceChangePassword = true; u.metadata.forceChangeReason = 'initial'; }, 403, 'PASSWORD_CHANGE_REQUIRED'],
    ['已停用', (u: any) => { u.status = 'disabled'; }, 401, 'ACCOUNT_DISABLED'],
    ['凭据已换代', (u: any) => { u.metadata.credentialVersion = 'v2'; }, 401, 'SESSION_REVOKED'],
  ])('%s账号访问个人订阅：与其他 Mist 路由同码拒绝', async (_label, mutate, status, code) => {
    const server = app(), token = tokenOf('staff');
    mutate(users.staff);
    const other = await get(server, '/api/mist/workspaces', token);
    expect(other.status).toBe(status); expect(other.body.error.code).toBe(code);
    for (const url of ['/api/mist/ai/subscriptions', '/api/mist/ai/subscriptions/chatgpt/login/x']) {
      const res = await get(server, url, token);
      expect(res.status).toBe(status); expect(res.body.error.code).toBe(code);
    }
    const login = await request(server).post('/api/mist/ai/subscriptions/chatgpt/login').set('Authorization', `Bearer ${token}`).send({});
    expect(login.status).toBe(status); expect(login.body.error.code).toBe(code);
  });

  it.each([
    ['待改密', (u: any) => { u.metadata.forceChangePassword = true; }, 403, 'PASSWORD_CHANGE_REQUIRED'],
    ['已停用', (u: any) => { u.status = 'disabled'; }, 401, 'ACCOUNT_DISABLED'],
    ['已退出所有设备', (u: any) => { u.metadata.sessionsRevokedAt = new Date(Date.now() + 2000).toISOString(); }, 401, 'SESSION_REVOKED'],
  ])('%s平台管理员不能使用平台模型路由', async (_label, mutate, status, code) => {
    const server = app(), token = tokenOf('platform');
    mutate(users.platform);
    for (const req of [get(server, '/api/mist/ai/platform-model', token), request(server).put('/api/mist/ai/platform-model/order').set('Authorization', `Bearer ${token}`).send({})]) {
      const res = await req;
      expect(res.status).toBe(status); expect(res.body.error.code).toBe(code);
    }
  });
});
