import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let actor: any = { userId: 'u1', roles: [], permissions: [], departmentIds: [], companyId: 'c1' };
vi.mock('../../auth/middleware', () => ({ extractActorFromRequest: () => actor }));
vi.mock('../supplierContractAccess', () => ({ freshSupplierActor: vi.fn(async () => ({})) }));
const setAuthority = vi.fn(async () => ({ ok: true, item: { version: 2 } }));
vi.mock('../supplierCommitmentAuthority', async orig => ({ ...(await orig() as object), setSupplierApprovalAuthority: (...args: any[]) => (setAuthority as any)(...args) }));
import { createSupplierApprovalAuthorityRouter } from '../supplierApprovalAuthorityRoute';

const app = (row: unknown = null) => {
  const findUnique = vi.fn(async () => row);
  const prisma: any = { $transaction: async (fn: any) => fn({ systemConfig: { findUnique } }) };
  const a = express(); a.use(express.json());
  a.use('/api/v1/procurement/contracts/approval-authority', createSupplierApprovalAuthorityRouter({ prisma, requireAuth: false, apiKeys: new Set() }));
  return { a, findUnique };
};

describe('supplier approval authority after legacy procurement retirement', () => {
  it('reads the company list at the original path', async () => {
    const { a, findUnique } = app({ value: { schemaVersion: 1, userIds: ['m1'] }, version: 3 });
    const res = await request(a).get('/api/v1/procurement/contracts/approval-authority/purchase/fabric');
    expect(res.status).toBe(200);
    expect(res.body.item).toEqual({ key: 'supplierCommitment.approvers.purchase.fabric', version: 3, userIds: ['m1'] });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'company:c1::supplierCommitment.approvers.purchase.fabric' } });
  });

  it('saves through setSupplierApprovalAuthority and rejects unknown kinds', async () => {
    const { a } = app();
    const ok = await request(a).put('/api/v1/procurement/contracts/approval-authority/processing/garment').send({ requestKey: 'k1', userIds: ['m1'], expectedConfigVersion: 0, reason: '配置' });
    expect(ok.status).toBe(200);
    expect(setAuthority).toHaveBeenCalledWith(expect.objectContaining({ kind: 'processing', family: 'garment', userIds: ['m1'] }));
    const bad = await request(a).get('/api/v1/procurement/contracts/approval-authority/other/fabric');
    expect(bad.status).toBe(400);
  });

  it('serves nothing else under the retired procurement prefix', async () => {
    const { a } = app();
    expect((await request(a).get('/api/v1/procurement/contracts/approval-authority')).status).toBe(404);
  });
});
