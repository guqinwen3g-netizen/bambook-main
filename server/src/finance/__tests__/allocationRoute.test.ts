import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { recalcInvoiceStatus, recalcVoucherStatus, syncAllocationVoucherLinks, validateAllocationInput } from '../allocationService';

// ============================================================================
// task ERP-P1-payment-allocation-route-foundation: allocationService 纯函数
// ============================================================================

describe('task allocation-foundation: validateAllocationInput（fail closed）', () => {
  it('缺失 invoiceId → MISSING_INVOICE', () => {
    const r = validateAllocationInput({ voucherId: 'V1', appliedAmount: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MISSING_INVOICE');
  });

  it('缺失 voucherId → MISSING_VOUCHER', () => {
    const r = validateAllocationInput({ invoiceId: 'I1', appliedAmount: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MISSING_VOUCHER');
  });

  it('缺失 appliedAmount → MISSING_AMOUNT', () => {
    const r = validateAllocationInput({ invoiceId: 'I1', voucherId: 'V1' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('MISSING_AMOUNT');
  });

  it('appliedAmount 非数字 → INVALID_AMOUNT', () => {
    const r = validateAllocationInput({ invoiceId: 'I1', voucherId: 'V1', appliedAmount: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INVALID_AMOUNT');
  });

  it('appliedAmount <= 0 → INVALID_AMOUNT', () => {
    expect(validateAllocationInput({ invoiceId: 'I1', voucherId: 'V1', appliedAmount: 0 }).error).toBe('INVALID_AMOUNT');
    expect(validateAllocationInput({ invoiceId: 'I1', voucherId: 'V1', appliedAmount: -50 }).error).toBe('INVALID_AMOUNT');
  });

  it('合法输入 → ok', () => {
    expect(validateAllocationInput({ invoiceId: 'I1', voucherId: 'V1', appliedAmount: 100 }).ok).toBe(true);
  });
});

describe('task allocation-foundation: recalcInvoiceStatus（Decimal-safe）', () => {
  function makeTx(allocs: any[], invoice: any) {
    return {
      invoice: { findUnique: vi.fn().mockResolvedValue(invoice) },
      invoiceAllocation: { findMany: vi.fn().mockResolvedValue(allocs) },
    } as any;
  }

  it('totalApplied >= invoice.amount → Paid', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal(100) }, { appliedAmount: new Prisma.Decimal(50) }],
      { id: 'I1', amount: new Prisma.Decimal(150), status: 'Issued' },
    );
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('Paid');
  });

  it('totalApplied > 0 but < amount → PartiallyPaid', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal(50) }],
      { id: 'I1', amount: new Prisma.Decimal(150), status: 'Issued' },
    );
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('PartiallyPaid');
  });

  it('totalApplied == 0 且当前 Paid → 回退 Issued（删除最后一条后回退）', async () => {
    const tx = makeTx([], { id: 'I1', amount: new Prisma.Decimal(150), status: 'Paid' });
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('Issued');
  });

  it('totalApplied == 0 且当前 PartiallyPaid → 回退 Issued', async () => {
    const tx = makeTx([], { id: 'I1', amount: new Prisma.Decimal(150), status: 'PartiallyPaid' });
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('Issued');
  });

  it('totalApplied == 0 且当前 Issued → 保持 Issued（不回退）', async () => {
    const tx = makeTx([], { id: 'I1', amount: new Prisma.Decimal(150), status: 'Issued' });
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('Issued');
  });

  it('invoice 不存在 → Draft', async () => {
    const tx = makeTx([], null);
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('Draft');
  });

  it('Decimal 精度安全（0.1+0.2 不漂移）', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal('0.1') }, { appliedAmount: new Prisma.Decimal('0.2') }],
      { id: 'I1', amount: new Prisma.Decimal('0.3'), status: 'Issued' },
    );
    // 0.1+0.2 = 0.3（Decimal 精确），>= 0.3 → Paid
    expect(await recalcInvoiceStatus(tx, 'I1')).toBe('Paid');
  });
});

describe('task allocation-foundation: recalcVoucherStatus（Decimal-safe）', () => {
  function makeTx(allocs: any[], voucher: any) {
    return {
      paymentVoucher: { findUnique: vi.fn().mockResolvedValue(voucher) },
      invoiceAllocation: { findMany: vi.fn().mockResolvedValue(allocs) },
    } as any;
  }

  it('totalAllocated >= voucherAmount → reconciled + 汇总 totalAllocated', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal(200) }],
      { id: 'V1', amount: new Prisma.Decimal(200) },
    );
    const r = await recalcVoucherStatus(tx, 'V1');
    expect(r.status).toBe('reconciled');
    expect(Number(r.totalAllocated)).toBe(200);
  });

  it('totalAllocated > 0 but < voucherAmount → partially_reconciled', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal(50) }],
      { id: 'V1', amount: new Prisma.Decimal(200) },
    );
    const r = await recalcVoucherStatus(tx, 'V1');
    expect(r.status).toBe('partially_reconciled');
  });

  it('totalAllocated == 0 → unreconciled', async () => {
    const tx = makeTx([], { id: 'V1', amount: new Prisma.Decimal(200) });
    expect((await recalcVoucherStatus(tx, 'V1')).status).toBe('unreconciled');
  });

  it('voucherAmount == 0 → unreconciled（边界）', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal(100) }],
      { id: 'V1', amount: new Prisma.Decimal(0) },
    );
    expect((await recalcVoucherStatus(tx, 'V1')).status).toBe('unreconciled');
  });

  it('voucher 不存在 → unreconciled', async () => {
    const tx = makeTx([], null);
    expect((await recalcVoucherStatus(tx, 'V1')).status).toBe('unreconciled');
  });

  it('多 invoice 分摊 → totalAllocated 汇总（非单笔）', async () => {
    const tx = makeTx(
      [{ appliedAmount: new Prisma.Decimal(100) }, { appliedAmount: new Prisma.Decimal(150) }],
      { id: 'V1', amount: new Prisma.Decimal(300) },
    );
    const r = await recalcVoucherStatus(tx, 'V1');
    expect(Number(r.totalAllocated)).toBe(250); // 100+150 汇总
    expect(r.status).toBe('partially_reconciled'); // 250 < 300
  });
});

// ============================================================================
// task 阻断3 fix: allocation-aware EntityLink sync（syncAllocationVoucherLinks）
// ============================================================================

describe('task allocation-foundation 阻断3 fix: syncAllocationVoucherLinks（allocation-aware）', () => {
  function makeSyncTx(allocs: any[], existingLinks: any[] = []) {
    const entityRefUpsert = vi.fn().mockResolvedValue({});
    const entityLinkUpsert = vi.fn().mockResolvedValue({});
    const entityLinkFindMany = vi.fn().mockResolvedValue(existingLinks);
    const entityLinkUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      invoiceAllocation: { findMany: vi.fn().mockResolvedValue(allocs) },
      entityReference: { upsert: entityRefUpsert },
      entityLink: { upsert: entityLinkUpsert, findMany: entityLinkFindMany, update: entityLinkUpdate },
    } as any;
    return { tx, entityRefUpsert, entityLinkUpsert, entityLinkFindMany, entityLinkUpdate };
  }

  it('单 allocation → upsert 1 个 active settlesInvoice link', async () => {
    const { tx, entityLinkUpsert } = makeSyncTx([{ invoiceId: 'I1', appliedAmount: new Prisma.Decimal(100) }]);
    await syncAllocationVoucherLinks(tx, 'V1', { source: 'test' });
    // upsert 1 link for I1
    const linkCalls = entityLinkUpsert.mock.calls;
    expect(linkCalls.length).toBe(1);
    expect(linkCalls[0][0].where.id).toContain('settlesInvoice');
    expect(linkCalls[0][0].create.toId).toBe('I1');
    expect(linkCalls[0][0].create.linkKind).toBe('settlesInvoice');
  });

  it('split voucher（2 张 invoice）→ upsert 2 个 active settlesInvoice link', async () => {
    const { tx, entityLinkUpsert } = makeSyncTx([
      { invoiceId: 'I1', appliedAmount: new Prisma.Decimal(100) },
      { invoiceId: 'I2', appliedAmount: new Prisma.Decimal(150) },
    ]);
    await syncAllocationVoucherLinks(tx, 'V1', { source: 'test' });
    expect(entityLinkUpsert.mock.calls.length).toBe(2);
    const toIds = entityLinkUpsert.mock.calls.map((c: any) => c[0].create.toId);
    expect(toIds).toEqual(expect.arrayContaining(['I1', 'I2']));
  });

  it('删除其中一张 invoice allocation → 旧 link 置 inactive（目标集合准确）', async () => {
    // 当前只剩 I1 allocation，但已有 I2 的 active link → I2 link 应置 inactive
    const { tx, entityLinkUpdate } = makeSyncTx(
      [{ invoiceId: 'I1', appliedAmount: new Prisma.Decimal(100) }],
      [
        { id: 'LINK__V1__settlesInvoice__I1', toId: 'I1', status: 'active' },
        { id: 'LINK__V1__settlesInvoice__I2', toId: 'I2', status: 'active' },
      ],
    );
    await syncAllocationVoucherLinks(tx, 'V1', { source: 'test' });
    // I2 link 应被 update 为 inactive
    const updateCalls = entityLinkUpdate.mock.calls;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][0].where.id).toContain('I2');
    expect(updateCalls[0][0].data.status).toBe('inactive');
  });

  it('删除最后一张 allocation（空）→ 所有旧 settlesInvoice link 置 inactive', async () => {
    const { tx, entityLinkUpdate } = makeSyncTx(
      [],
      [
        { id: 'LINK__V1__settlesInvoice__I1', toId: 'I1', status: 'active' },
        { id: 'LINK__V1__settlesInvoice__I2', toId: 'I2', status: 'active' },
      ],
    );
    await syncAllocationVoucherLinks(tx, 'V1', { source: 'test' });
    // 两个 link 都应置 inactive
    expect(entityLinkUpdate.mock.calls.length).toBe(2);
  });

  it('已 inactive 的 link 不重复 update', async () => {
    const { tx, entityLinkUpdate } = makeSyncTx(
      [{ invoiceId: 'I1', appliedAmount: new Prisma.Decimal(100) }],
      [
        { id: 'LINK__V1__settlesInvoice__I1', toId: 'I1', status: 'active' },
        { id: 'LINK__V1__settlesInvoice__I2', toId: 'I2', status: 'inactive' }, // 已 inactive
      ],
    );
    await syncAllocationVoucherLinks(tx, 'V1', { source: 'test' });
    // 只有 I2 需要 update？不——I2 已 inactive，不重复 update；I1 还 active，upsert 即可
    // 实际：I2 已 inactive，跳过 update
    expect(entityLinkUpdate.mock.calls.length).toBe(0);
  });
});
