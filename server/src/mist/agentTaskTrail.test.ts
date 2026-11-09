import { expect, it } from 'vitest';
import { platformTrail } from './agentTaskTrail';

const step = (name: string, args: Record<string, unknown>, result?: unknown) => ({ id: 's', at: '', plan: { name, arguments: args }, ...(result === undefined ? {} : { result }) }) as any;

it('names a record read by its number, and never shows an internal id while the read is still in flight', () => {
  const [done, pending, coded] = platformTrail([
    step('bambook_get', { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' }, { label: 'SO-G-2026-017' }),
    step('bambook_get', { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' }),
    step('bambook_get', { type: 'order', id: 'SO-G-2026-018' }),
  ]);
  expect(done.label).toBe('读取订单 SO-G-2026-017');
  expect(pending.label).toBe('读取订单');
  expect(pending.ref?.label).toBe('订单');
  expect(coded.label).toBe('读取订单 SO-G-2026-018');
});

it('links a read to the page the record lives on, including parent pages and sections, and names attachment reads by file', () => {
  const [receipt, bill, failed, file] = platformTrail([
    step('bambook_get', { type: 'receipt', id: 'rc1' }, { label: 'rc1', link: 'bambook://open?view=procurement&id=po1' }),
    step('bambook_get', { type: 'payable_bill', id: 'b1' }, { label: 'AP-1', link: 'bambook://open?view=payment-vouchers&id=b1&section=payables' }),
    step('bambook_get', { type: 'order', id: 'x' }, { error: true, link: 'bambook://open?view=orders%2Fdetail&id=x' }),
    step('bambook_file_text', { fileId: 'f1' }, { file: { id: 'f1', name: '采购合同 PO-12.docx' }, text: '…' }),
  ]);
  expect(receipt.ref).toEqual({ type: 'receipt', id: 'po1', label: 'rc1', view: 'procurement' });
  expect(bill.ref).toEqual({ type: 'payable_bill', id: 'b1', label: 'AP-1', view: 'payment-vouchers', section: 'payables' });
  expect(failed.ref).toBeUndefined();
  expect(file.label).toBe('读取附件 采购合同 PO-12.docx');
});
