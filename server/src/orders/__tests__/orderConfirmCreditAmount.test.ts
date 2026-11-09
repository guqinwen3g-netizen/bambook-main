/** 订单确认信用门禁：额度判定所用金额走订单金额唯一真源，而非只看报价额。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen: Array<number | undefined> = [];
vi.mock('../../credit/creditService', () => ({
  createCreditService: () => ({
    checkCreditAvailable: async ({ amount }: { amount?: number }) => { seen.push(amount); return { ok: false, error: { message: 'stop' } }; },
  }),
}));
import { evaluateOrderConfirmGates } from '../orderLifecycleService';

const gate = (order: Record<string, unknown>) => evaluateOrderConfirmGates({
  prisma: { order: { findUnique: async () => ({ id: 'O1', status: 'Pending', deletedAt: null, customerRelationId: 'R1', ...order }) } },
  orderId: 'O1',
});

describe('确认门禁的信用额度金额', () => {
  beforeEach(() => { seen.length = 0; });
  it('无报价额时按成交净额判定额度', async () => {
    expect((await gate({ quoteAmount: null, totalNet: '52000.00', lines: [] })).allowed).toBe(false);
    expect(seen).toEqual([52000]);
  });
  it('有明细行净额时以明细合计为准', async () => {
    await gate({ quoteAmount: '1000', totalNet: null, lines: [{ netValue: '30000' }, { netValue: '12000.5' }] });
    expect(seen).toEqual([42000.5]);
  });
  it('三处都没有金额时不臆造额度金额', async () => {
    await gate({ quoteAmount: null, totalNet: null, lines: [] });
    expect(seen).toEqual([undefined]);
  });
});
