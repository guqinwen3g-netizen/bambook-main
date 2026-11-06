import { describe, expect, it, vi } from 'vitest';
import { validateStatusTransition, VALID_INVOICE_STATUS, VALID_SHIPMENT_STATUS } from '../statusTransition';

describe('task_mqy459c6: statusTransition 纯函数', () => {
  describe('Invoice 状态枚举', () => {
    it('VALID_INVOICE_STATUS 含 5 值', () => {
      expect(VALID_INVOICE_STATUS).toEqual(['Draft', 'Issued', 'PartiallyPaid', 'Paid', 'Cancelled']);
    });
  });

  describe('Invoice 合法转移', () => {
    it('Draft → Issued 合法', () => expect(validateStatusTransition('Invoice', 'Draft', 'Issued').ok).toBe(true));
    it('Issued → PartiallyPaid 合法', () => expect(validateStatusTransition('Invoice', 'Issued', 'PartiallyPaid').ok).toBe(true));
    it('Issued → Paid 合法', () => expect(validateStatusTransition('Invoice', 'Issued', 'Paid').ok).toBe(true));
    it('PartiallyPaid → Paid 合法', () => expect(validateStatusTransition('Invoice', 'PartiallyPaid', 'Paid').ok).toBe(true));
    it('Draft → Cancelled 合法', () => expect(validateStatusTransition('Invoice', 'Draft', 'Cancelled').ok).toBe(true));
    it('Paid → Cancelled 合法', () => expect(validateStatusTransition('Invoice', 'Paid', 'Cancelled').ok).toBe(true));
    it('相同状态幂等（合法）', () => expect(validateStatusTransition('Invoice', 'Issued', 'Issued').ok).toBe(true));
  });

  describe('Invoice 非法转移', () => {
    it('Draft → Paid 非法（跨态）', () => {
      const r = validateStatusTransition('Invoice', 'Draft', 'Paid');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Paid → Issued 非法（终态不可回退）', () => {
      const r = validateStatusTransition('Invoice', 'Paid', 'Issued');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Cancelled → Draft 非法（终态）', () => {
      const r = validateStatusTransition('Invoice', 'Cancelled', 'Draft');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Paid → PartiallyPaid 非法（不可回退）', () => {
      const r = validateStatusTransition('Invoice', 'Paid', 'PartiallyPaid');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
  });

  describe('Shipment 状态枚举', () => {
    it('VALID_SHIPMENT_STATUS 含 8 值', () => {
      expect(VALID_SHIPMENT_STATUS).toEqual(['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled']);
    });
  });

  describe('Shipment 合法转移', () => {
    it('Draft → Booked 合法', () => expect(validateStatusTransition('Shipment', 'Draft', 'Booked').ok).toBe(true));
    it('Booked → Shipped 合法（跨 Loading）', () => expect(validateStatusTransition('Shipment', 'Booked', 'Shipped').ok).toBe(true));
    it('Shipped 是当前 MVP 终点，历史状态重复保存仍幂等', () => {
      expect(validateStatusTransition('Shipment', 'Shipped', 'Shipped').ok).toBe(true);
      expect(validateStatusTransition('Shipment', 'Arrived', 'Arrived').ok).toBe(true);
    });
    it('任意非终态 → Cancelled 合法', () => {
      expect(validateStatusTransition('Shipment', 'Booked', 'Cancelled').ok).toBe(true);
      expect(validateStatusTransition('Shipment', 'Shipped', 'Cancelled').ok).toBe(true);
    });
    it('相同状态幂等（合法）', () => expect(validateStatusTransition('Shipment', 'Booked', 'Booked').ok).toBe(true));
  });

  describe('Shipment 非法转移', () => {
    it('当前 MVP 不允许从已出运继续写到港/清关/交付', () => {
      for (const next of ['Arrived', 'Cleared', 'Delivered']) {
        const result = validateStatusTransition('Shipment', 'Shipped', next);
        expect(result.ok, next).toBe(false);
        expect(result.error, next).toBe('INVALID_TRANSITION');
      }
    });
    it('Draft → Delivered 非法（跨太多）', () => {
      const r = validateStatusTransition('Shipment', 'Draft', 'Delivered');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Delivered → Shipped 非法（终态）', () => {
      const r = validateStatusTransition('Shipment', 'Delivered', 'Shipped');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('Cancelled → Booked 非法（终态）', () => {
      const r = validateStatusTransition('Shipment', 'Cancelled', 'Booked');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
    it('回退（Shipped → Booked）非法', () => {
      const r = validateStatusTransition('Shipment', 'Shipped', 'Booked');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_TRANSITION');
    });
  });

  describe('非法枚举值（to）', () => {
    it('Invoice 非法 to → INVALID_STATUS', () => {
      const r = validateStatusTransition('Invoice', 'Draft', 'Bogus');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_STATUS');
    });
    it('Shipment 非法 to → INVALID_STATUS', () => {
      const r = validateStatusTransition('Shipment', 'Draft', 'Flying');
      expect(r.ok).toBe(false); expect(r.error).toBe('INVALID_STATUS');
    });
  });

  describe('from 不在枚举（脏数据/旧枚举）→ INVALID_CURRENT_STATUS fail closed', () => {
    it('Invoice from=Unknown → INVALID_CURRENT_STATUS（不静默放过）', () => {
      const r = validateStatusTransition('Invoice', 'Unknown', 'Issued');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('INVALID_CURRENT_STATUS');
      expect(r.message).toContain('Unknown');
    });
    it('Shipment from=Pending → INVALID_CURRENT_STATUS', () => {
      const r = validateStatusTransition('Shipment', 'Pending', 'Booked');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('INVALID_CURRENT_STATUS');
    });
  });
});
