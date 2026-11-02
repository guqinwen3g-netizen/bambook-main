import { describe, expect, it, vi } from 'vitest';
/** 2026-11：Capsule 豁免写入按实时权限 moq:capsule_exemption:write 判定；缺码时在任何业务读写之前拒绝。 */
const current = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('../../auth/tokenHelpers', async original => ({
  ...await original<typeof import('../../auth/tokenHelpers')>(),
  loadUserWithRoles: vi.fn(async (_db: unknown, id: string) => ({ id, status: 'active', deletedAt: null, roles: [] })),
  buildLoadedAuthTokenPayload: vi.fn(async (_db: unknown, user: { id: string }) => ({ userId: user.id, roles: [], departmentIds: [], permissions: [...current.permissions], authorizationLoaded: true })),
}));
vi.mock('../../config/systemConfigService', () => ({ getSystemConfigService: () => ({ getString: vi.fn(async (_k: string, d: string) => d) }) }));
vi.mock('../../dictionaries/dataDictionaryService', () => ({ getDataDictionaryService: () => ({ getEntries: vi.fn(async () => []) }) }));
import { createOrderServiceV2 } from '../orderServiceV2';
const actor = { userId: 'sales-1', roles: [], departmentIds: [], permissions: ['orders:write', 'moq:capsule_exemption:write'], authorizationLoaded: true } as any;
const input = { customer: 'Peerless', product: 'Coat', type: 'Garment', businessLine: 'garment', quantity: 100, dueDate: '2026-12-01', quoteAmount: 1000, capsuleExemption: true } as any;
describe('Capsule 豁免写入权限', () => {
  it('当前账号没有 moq:capsule_exemption:write 时拒绝建单勾选豁免（会话里的旧权限不算），且不建单', async () => {
    current.permissions = ['orders:write'];
    const create = vi.fn(), prisma: any = new Proxy({ order: { create } }, { get: (t: any, k) => t[k] ?? new Proxy({}, { get: () => vi.fn(async () => null) }) });
    const r = await createOrderServiceV2(prisma).createOrder(actor, input);
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } }); expect(r.error!.message).toContain('Capsule 豁免');
    expect(create).not.toHaveBeenCalled();
  });
  it('持有该码时不在豁免门禁处拒绝', async () => {
    current.permissions = ['orders:write', 'moq:capsule_exemption:write'];
    const prisma: any = new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn(async () => null) }) });
    const r = await createOrderServiceV2(prisma).createOrder(actor, input);
    expect(r.error?.message ?? '').not.toContain('Capsule 豁免需要');
  });
});
