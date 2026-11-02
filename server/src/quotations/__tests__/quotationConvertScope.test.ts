import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { createQuotationRouter } from '../quotationRoute';
/** 2026-11：报价转订单除报价写权限外，还须持有 quotations:convert；缺码时在读库之前 403。 */
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
const token = (permissions: string[]) => jwt.sign({ userId: 'u_sales', roles: [], permissions, departmentIds: [], authorizationLoaded: true }, JWT_SECRET);
describe('REST 报价转订单：quotations:convert', () => {
  it('只有 quotations:write、没有 quotations:convert 时拒绝转单且不读取报价', async () => {
    const findUnique = vi.fn(), prisma: any = new Proxy({}, { get: () => new Proxy({}, { get: () => findUnique }) });
    const app = express(); app.use(express.json()); app.use('/q', createQuotationRouter({ prisma, requireAuth: true, apiKeys: new Set() } as any));
    const res = await request(app).post('/q/QT_1/convert-to-order').set('Authorization', `Bearer ${token(['quotations:read', 'quotations:write', 'orders:write'])}`).send({});
    expect(res.status).toBe(403); expect(JSON.stringify(res.body)).toContain('quotations:convert');
    expect(findUnique).not.toHaveBeenCalled();
  });
});
