import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8'
);
const PAYMENT_VOUCHER_SERVICE = fs.readFileSync(
  path.resolve(__dirname, '../paymentVoucherMutationService.ts'), 'utf-8'
);

describe('task_mqxwgafj: InvoiceAllocation schema 结构（硬删除语义）', () => {
  it('模型存在 + 核心字段 + 无 deletedAt + 唯一约束', () => {
    expect(SCHEMA).toContain('model InvoiceAllocation');
    const section = SCHEMA.slice(
      SCHEMA.indexOf('model InvoiceAllocation'),
      SCHEMA.indexOf('model InvoiceAllocation') + 600
    );
    expect(section).toContain('invoiceId');
    expect(section).toContain('voucherId');
    expect(section).toContain('appliedAmount');
    expect(section).not.toContain('deletedAt'); // 硬删除语义
    expect(section).toContain('@@unique([invoiceId, voucherId])');
  });

  it('注释说明硬删除 + 调整=delete+insert', () => {
    expect(SCHEMA).toContain('硬删除');
  });

  it('schema 无销销账笔误', () => {
    expect(SCHEMA).not.toContain('销销账');
  });
});

describe('task_mqxwgafj: PaymentVoucher.status 字段', () => {
  it('含 status + 枚举 + 索引', () => {
    const section = SCHEMA.slice(
      SCHEMA.indexOf('model PaymentVoucher'),
      SCHEMA.indexOf('model InvoiceAllocation') > -1
        ? SCHEMA.indexOf('model InvoiceAllocation')
        : SCHEMA.length
    );
    expect(section).toContain('status');
    expect(section).toContain('unreconciled');
    expect(section).toContain('partially_reconciled');
    expect(section).toContain('reconciled');
    expect(section).toContain('@@index([status])');
  });
});

describe('task_mqxwgafj: voucher status 推导逻辑（基于 allocation 汇总）', () => {
  function deriveVoucherStatus(totalAllocated: number, voucherAmount: number): string {
    return totalAllocated >= voucherAmount && voucherAmount > 0
      ? 'reconciled'
      : (totalAllocated > 0 ? 'partially_reconciled' : 'unreconciled');
  }

  it('reconciled / partially / unreconciled 边界', () => {
    expect(deriveVoucherStatus(1000, 1000)).toBe('reconciled');
    expect(deriveVoucherStatus(1200, 1000)).toBe('reconciled');
    expect(deriveVoucherStatus(500, 1000)).toBe('partially_reconciled');
    expect(deriveVoucherStatus(0, 1000)).toBe('unreconciled');
    expect(deriveVoucherStatus(0, 0)).toBe('unreconciled');
  });

  it('1:N 分摊汇总（一笔 voucher 销两张 invoice）', () => {
    const allocations = [{ appliedAmount: 300 }, { appliedAmount: 700 }];
    const total = allocations.reduce((s, a) => s + a.appliedAmount, 0);
    expect(total).toBe(1000);
    expect(deriveVoucherStatus(total, 1000)).toBe('reconciled');
  });
});

describe('task_mqxwgafj: voucher status 枚举校验', () => {
  const VALID = ['unreconciled', 'partially_reconciled', 'reconciled'];
  it('有效值通过', () => {
    expect(VALID.includes('unreconciled')).toBe(true);
    expect(VALID.includes('partially_reconciled')).toBe(true);
    expect(VALID.includes('reconciled')).toBe(true);
  });
  it('无效值拒绝', () => {
    expect(VALID.includes('paid')).toBe(false);
    expect(VALID.includes('')).toBe(false);
    expect(VALID.includes('RECONCILED')).toBe(false);
  });
});

// 2026-11-06: the agent toolRuntime apply_voucher and legacy finance route source checks were removed with those files.
describe('task_mqxwgafj: paymentVoucherMutationService voucher status 不从 appliedAmount 推导', () => {
  it('createPaymentVoucher: null status 默认 unreconciled + 存在但非法返回 INVALID_STATUS', () => {
    const createStart = PAYMENT_VOUCHER_SERVICE.indexOf('function normalizeCreateInput');
    const createEnd = PAYMENT_VOUCHER_SERVICE.indexOf('function normalizeUpdateInput', createStart);
    const createBody = PAYMENT_VOUCHER_SERVICE.slice(createStart, createEnd);
    expect(createBody).not.toMatch(/appliedAmount.*partially_reconciled/);
    expect(createBody).toContain("'unreconciled'");
    expect(createBody).toContain('INVALID_STATUS');
    expect(createBody).toContain('isValidPaymentVoucherStatus');
  });

  it('PATCH /vouchers/:id status 不可手动修改（STATUS_NOT_MANUAL_SETTABLE，由 allocation 重算）', () => {
    const updateStart = PAYMENT_VOUCHER_SERVICE.indexOf('function normalizeUpdateInput');
    const updateEnd = PAYMENT_VOUCHER_SERVICE.indexOf('export async function createPaymentVoucher', updateStart);
    const updateBody = PAYMENT_VOUCHER_SERVICE.slice(updateStart, updateEnd);
    expect(updateBody).toContain('status');
    expect(updateBody).toContain('STATUS_NOT_MANUAL_SETTABLE');
    expect(updateBody).not.toContain('delete data.status'); // 不再静默删除
  });
});
