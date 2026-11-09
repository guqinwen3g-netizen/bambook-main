/**
 * 写接口匿名访问普查（运行时）：把服务端实际挂载的每个路由器按生产配置（requireAuth=true）
 * 装起来，枚举全部 POST/PUT/PATCH/DELETE，不带任何凭据逐个请求。
 * 非公开接口必须在触库前以 401/403/404 拒绝；数据库替身一被访问就抛错（→ 500 → 红）。
 * 公开接口（登录、注册、找回密码等）单独登记，只要求空请求不成功。
 */
import express, { type Router } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAuthRouter } from '../auth/route';
import { createAdminRouter } from '../admin/route';
import { createPlatformRouter } from '../platform/route';
import { createHRRouter } from '../hr/route';
import { createSupplierApprovalAuthorityRouter } from '../procurement/supplierApprovalAuthorityRoute';
import { createDevPanelRouter } from '../devPanel/route';
import { createMistRouter } from '../mist/route';

const touched: string[] = [];
const db: any = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'then') return undefined;
    touched.push(String(prop));
    throw new Error(`database touched: ${String(prop)}`);
  },
});

const mounts: Array<[string, Router]> = [
  ['/api/auth', createAuthRouter({ prisma: db, loginRateLimit: false })],
  ['/api/dev', createDevPanelRouter({ prisma: db })],
  ['/api/admin', createAdminRouter({ prisma: db, requireAuth: true, apiKeys: new Set() })],
  ['/api/platform', createPlatformRouter({ prisma: db } as any)],
  ['/api/hr', createHRRouter({ prisma: db, requireAuth: true, apiKeys: new Set() })],
  ['/api/v1/procurement/contracts/approval-authority', createSupplierApprovalAuthorityRouter({ prisma: db, requireAuth: true, apiKeys: new Set() })],
  ['/api/mist', createMistRouter({ prisma: db, repository: db })],
];

/** 公开接口：匿名可达是设计如此（自身有限流 / 令牌校验）。 */
const PUBLIC = new Set([
  'POST /api/auth/login',
  'POST /api/auth/send-code',
  'POST /api/auth/register',
  'POST /api/auth/logout',
  'POST /api/auth/register/company',
  'POST /api/auth/register/join',
  'POST /api/auth/account-access/request',
  'POST /api/auth/account-access/complete',
]);

type Route = { method: string; path: string };
function routesOf(router: any, prefix: string, out: Route[] = []): Route[] {
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) for (const m of Object.keys(layer.route.methods)) {
        if (['post', 'put', 'patch', 'delete'].includes(m)) out.push({ method: m.toUpperCase(), path: (prefix + p).replace(/\/{2,}/g, '/') });
      }
    } else if (layer.handle?.stack) {
      const src = String(layer.regexp?.source ?? '');
      const mount = src === '^\\/?(?=\\/|$)' ? '' : src.replace(/^\^\\/, '/').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/');
      routesOf(layer.handle, prefix + mount, out);
    }
  }
  return out;
}

const app = express();
app.use(express.json());
app.use(cookieParser());
const all: Route[] = [];
for (const [prefix, router] of mounts) { app.use(prefix, router); routesOf(router, prefix, all); }
app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ ok: false, error: String(err?.message ?? err) }));
const concrete = (p: string) => p.replace(/:([A-Za-z_]+)\??/g, 'probe-$1');
async function leaksOf(target: express.Express, routes: Route[]): Promise<string[]> {
  const leaks: string[] = [];
  for (const r of routes) {
    touched.length = 0;
    const res = await (request(target) as any)[r.method.toLowerCase()](concrete(r.path)).send({});
    if (![401, 403, 404].includes(res.status) || touched.length) leaks.push(`${r.method} ${r.path} → ${res.status}${touched.length ? ` db:${touched[0]}` : ''}`);
  }
  return leaks;
}

describe('写接口匿名访问普查', () => {
  it('枚举到全部挂载路由器的写接口（分母不许塌）', () => {
    expect(all.length).toBeGreaterThanOrEqual(130);
    for (const prefix of ['/api/auth', '/api/admin', '/api/platform', '/api/hr', '/api/mist']) {
      expect(all.some(r => r.path.startsWith(prefix + '/')), prefix).toBe(true);
    }
    const listed = new Set(all.map(r => `${r.method} ${r.path}`));
    expect([...PUBLIC].filter(k => !listed.has(k)), '公开名单里有已不存在的接口').toEqual([]);
  });

  it('非公开写接口匿名请求一律在触库前被拒（401/403/404）', async () => {
    expect(await leaksOf(app, all.filter(r => !PUBLIC.has(`${r.method} ${r.path}`)))).toEqual([]);
  });

  it('判据自检：没挂门的写接口必须被抓（触库或放行都算漏）', async () => {
    const naked = express.Router();
    naked.post('/reach-db', async (_req, res) => { try { await db.userAccount.findMany(); } catch { /* noop */ } res.json({ ok: true }); });
    naked.post('/open', (_req, res) => { res.json({ ok: true }); });
    const probe = express(); probe.use(express.json()); probe.use('/naked', naked);
    expect(await leaksOf(probe, routesOf(naked, '/naked'))).toEqual(['POST /naked/reach-db → 200 db:userAccount', 'POST /naked/open → 200']);
  });

  it('公开写接口空请求不会成功', async () => {
    for (const key of PUBLIC) {
      const [method, path] = key.split(' ');
      if (path === '/api/auth/logout') continue; // 退出登录对匿名请求幂等成功
      const res = await (request(app) as any)[method.toLowerCase()](path).send({});
      expect(res.status, key).toBeGreaterThanOrEqual(400);
      expect(res.status, key).toBeLessThan(500);
    }
  });
});
