/** 平台管理入口与公司登录入口分开：平台账号只能从平台入口登录，公司账号只能从公司入口登录。 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { createAuthRouter } from '../route';

const password = 'EntrySeparation2026';

function app(platformRole: string | null) {
  const user = {
    id: 'entry-user', displayName: 'Entry user', email: 'entry@example.invalid', platformRole,
    passwordHash: bcrypt.hashSync(password, 4), status: 'active', deletedAt: null, metadata: {},
    primaryDeptId: null, primaryDepartment: null, roles: [],
  };
  const known: any = {
    userAccount: { findFirst: vi.fn(async () => user), findUnique: vi.fn(async () => user), update: vi.fn(async () => user) },
    companyMember: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
  };
  // 其余表（审计、会话等）只需返回空结果，让登录流程走完。
  const empty = new Proxy({}, { get: (_t, method) => vi.fn(async () => (String(method).startsWith('findMany') ? [] : String(method) === 'count' ? 0 : {})) });
  const prisma: any = new Proxy(known, { get: (target, model) => target[model as string] ?? (model === '$transaction' ? async (fn: any) => fn(prisma) : empty) });
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/auth', createAuthRouter({ prisma, loginRateLimit: false }));
  return a;
}

const login = (server: express.Express, entry?: string) =>
  request(server).post('/auth/login').send({ email: 'entry@example.invalid', password, ...(entry ? { entry } : {}) });

describe('separate platform and company login entries', () => {
  it('refuses a platform account on the company entry and by default', async () => {
    for (const entry of ['company', undefined]) {
      const res = await login(app('platform_admin'), entry);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'COMPANY_ENTRY_ONLY', message: '平台账号请从平台管理入口登录。' });
    }
  });

  it('refuses a company account on the platform entry', async () => {
    const res = await login(app(null), 'platform');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'PLATFORM_ENTRY_ONLY', message: '该账号不是平台账号，请从公司登录入口登录。' });
  });

  it('lets each account past the entry rule on its own entry', async () => {
    for (const [role, entry] of [['platform_admin', 'platform'], [null, 'company']] as const) {
      const res = await login(app(role), entry);
      expect(['PLATFORM_ENTRY_ONLY', 'COMPANY_ENTRY_ONLY']).not.toContain(res.body?.error);
    }
  });

  it('checks the password before revealing the entry rule', async () => {
    const res = await request(app('platform_admin')).post('/auth/login').send({ email: 'entry@example.invalid', password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });
});
