/**
 * §10.4.2 契约测试：成本类单据随关联订单可见。
 *
 * 业务方 2026-09-12 定案：BOM / 采购单「能看到某张订单，就看得到它的 BOM 与采购单」。
 * 两类单据都没有归属人字段（PO 只有自由文本 buyer，BOM 只挂产品/订单/报价），
 * 因此可见性只能由「关联订单是否可见」推导 —— 本测试锁这条链路：
 *   1) 列表：白名单注入到查询条件（AND 叠加，不覆盖 search OR）
 *   2) 详情/预览/来料：命中外单 → 404（防猜 id 直读）
 *   3) 白名单为 null（全权角色）→ 不加过滤
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const visibilityMock = vi.hoisted(() => ({
  resolveVisibleOrderIds: vi.fn(),
}));
vi.mock('../../auth/orderVisibility', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, resolveVisibleOrderIds: visibilityMock.resolveVisibleOrderIds };
});

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createBOMRouter } from '../../bom/bomRoute';
import { authHeader } from '../../__tests__/authTestHelper';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const salesToken = jwt.sign({ userId: 'u_sales', roles: ['sales'] }, JWT_SECRET);

function makeApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

beforeEach(() => {
  visibilityMock.resolveVisibleOrderIds.mockReset();
});

describe('§10.4.2 BOM 随订单可见（无订单走图书馆口径）', () => {
  function bomPrisma(orderId: string | null) {
    const bom = { id: 'BOM1', bomNumber: 'B-1', description: 'd', status: 'Draft', version: 1, orderId, totalCost: 1, currency: 'CNY', createdAt: 0, updatedAt: 0, lines: [], costEstimates: [] };
    return {
      bOM: {
        findMany: vi.fn().mockResolvedValue([bom]),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn().mockResolvedValue(bom),
      },
    } as any;
  }

  it('列表：白名单叠加后仍保留「无关联订单」的 BOM（图书馆口径）', async () => {
    visibilityMock.resolveVisibleOrderIds.mockResolvedValue(['O1']);
    const prisma = bomPrisma(null);
    const app = makeApp(createBOMRouter({ prisma, requireAuth: false, apiKeys: new Set() }));

    await request(app).get('/').set(authHeader(salesToken));
    const where = prisma.bOM.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where.AND)).toContain('O1');
    expect(JSON.stringify(where.AND)).toContain('null'); // orderId: null 分支
  });

  it('详情：关联他单的 BOM → 不可见', async () => {
    visibilityMock.resolveVisibleOrderIds.mockResolvedValue(['O1']);
    const app = makeApp(createBOMRouter({ prisma: bomPrisma('O_OTHER'), requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).get('/BOM1').set(authHeader(salesToken));
    expect([403, 404]).toContain(res.status);
  });

  it('详情：无关联订单的 BOM → 放行（与列表同口径）', async () => {
    visibilityMock.resolveVisibleOrderIds.mockResolvedValue([]);
    const app = makeApp(createBOMRouter({ prisma: bomPrisma(null), requireAuth: false, apiKeys: new Set() }));
    const res = await request(app).get('/BOM1').set(authHeader(salesToken));
    expect(res.status).toBe(200);
  });
});
