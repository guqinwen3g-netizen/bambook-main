import { describe, expect, it } from 'vitest';
import { platformDataIssues } from './PlatformPages';

const base = () => ({
  orders: [{ id: 'o1', code: 'SO-1' }], orderLines: [{ id: 'l1', orderId: 'o1', style: 'A', name: 'A' }],
  invoices: [{ id: 'i1', code: 'CI-1', orderId: 'o1' }], receipts: [{ id: 'r1', code: 'RC-1', accountId: 'acc' }],
  allocations: [{ id: 'a1', invoiceId: 'i1', receiptId: 'r1' }], bankAccounts: [] as unknown[],
  fulfillment: { purchases: [{ id: 'p1', code: 'PO-1', orderId: 'o1', state: 'approved' }], shipments: [{ id: 's1', code: 'SHP-1', state: 'departed' }], documents: [{ shipmentId: 's1', type: 'CI', status: 'issued' }] },
}) as any;

describe('data center integrity checks', () => {
  it('reports nothing on a consistent set', () => expect(platformDataIssues(base())).toEqual([]));

  it('flags each broken relation once, with the object kind and code', () => {
    const s = base();
    s.orderLines.push({ id: 'l2', orderId: 'gone', style: 'B', name: 'B' });
    s.invoices.push({ id: 'i2', code: 'CI-2', orderId: 'gone' });
    s.allocations.push({ id: 'a2', invoiceId: 'missing', receiptId: 'r1' });
    s.fulfillment.purchases.push({ id: 'p2', code: 'PO-2', orderId: 'gone', state: 'approved' }, { id: 'p3', code: 'PO-3', orderId: 'gone', state: 'cancelled' });
    s.fulfillment.shipments.push({ id: 's2', code: 'SHP-2', state: 'departed' }, { id: 's3', code: 'SHP-3', state: 'ready' });
    s.bankAccounts = [{ id: 'acc' }];
    s.receipts.push({ id: 'r2', code: 'RC-2' });
    expect(platformDataIssues(s).map(i => `${i.kind}:${i.code}`)).toEqual(['订单条目:B', '发票:CI-2', '核销明细:a2', '采购合同:PO-2', '出运:SHP-2', '到账流水:RC-2']);
  });

  it('only checks receipt accounts once the company has registered bank accounts', () => {
    const s = base(); s.receipts.push({ id: 'r2', code: 'RC-2' });
    expect(platformDataIssues(s)).toEqual([]);
  });
});
