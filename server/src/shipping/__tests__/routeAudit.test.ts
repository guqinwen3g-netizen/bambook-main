import { describe, expect, it, vi } from 'vitest';
import { syncShipmentReferences } from '../../entities/sync';

// 2026-11-06：shipmentMutationService.ts 与 shipping/route.ts 随旧主 API 删除，
// 只保留仍被 Mist 出运链路使用的 syncShipmentReferences(tx) 行为用例。

describe('task_mqxxxu3k: syncShipmentReferences(tx) 真实分支', () => {
  it('传 tx 时逐个 await tx.entityReference/entityLink upsert，不调 tx.$transaction', async () => {
    const entityReferenceUpsert = vi.fn().mockResolvedValue({});
    const entityLinkUpsert = vi.fn().mockResolvedValue({});
    const txTransaction = vi.fn();

    const tx = {
      entityReference: { upsert: entityReferenceUpsert },
      entityLink: { upsert: entityLinkUpsert },
      $transaction: txTransaction,
    } as any;

    const shipment = {
      id: 'SHP-1', shipmentNumber: 'SHP001',
      orderId: 'ORDER-1', customerRelationId: 'REL-1', customerName: 'Acme', carrierRelationId: 'CARR-1', carrierName: 'FastShip',
    };

    await syncShipmentReferences({} as any, shipment, { source: 'route:test' }, tx);

    expect(txTransaction).not.toHaveBeenCalled();
    expect(entityReferenceUpsert.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(entityLinkUpsert.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('某个 upsert reject 时整体 reject（事务回滚语义）', async () => {
    const entityReferenceUpsert = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('SYNC_FAIL'));
    const entityLinkUpsert = vi.fn().mockResolvedValue({});

    const tx = {
      entityReference: { upsert: entityReferenceUpsert },
      entityLink: { upsert: entityLinkUpsert },
    } as any;

    const shipment = {
      id: 'SHP-1', shipmentNumber: 'SHP001',
      orderId: 'ORDER-1', customerRelationId: 'REL-1', customerName: 'Acme',
    };

    await expect(syncShipmentReferences({} as any, shipment, { source: 'route:test' }, tx))
      .rejects.toThrow('SYNC_FAIL');
  });

  it('无 tx 时保持原 prisma.$transaction(ops) 逻辑（向后兼容）', async () => {
    const entityReferenceUpsert = vi.fn().mockResolvedValue({});
    const entityLinkUpsert = vi.fn().mockResolvedValue({});
    const prismaTransaction = vi.fn().mockResolvedValue([]);

    const prisma = {
      entityReference: { upsert: entityReferenceUpsert },
      entityLink: { upsert: entityLinkUpsert },
      $transaction: prismaTransaction,
    } as any;

    const shipment = { id: 'SHP-1', shipmentNumber: 'SHP001', orderId: 'ORDER-1' };

    await syncShipmentReferences(prisma, shipment, { source: 'route:test' });

    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    const opsArg = prismaTransaction.mock.calls[0][0];
    expect(Array.isArray(opsArg)).toBe(true);
    expect(opsArg.length).toBeGreaterThan(0);
  });
});
