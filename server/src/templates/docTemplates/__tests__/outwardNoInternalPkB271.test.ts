/**
 * outwardNoInternalPkB271.test.ts — 台账 §9 B271：B269 那一族按"落点"数的时候我把落点定成了
 * 「relation 主键」，而真正的落点是**任何内部主键都不许顶替业务编号出现在对外件上**——
 * 同一把尺换个键就扫出来两处（客户发票 PDF 的订单引用行、付款申请单的来源单号），
 * 外加 B269 自己漏的两枚 xlsx 文件名当时**只有人工 curl 证人、没有门禁证人**。
 *
 * 规则仍是 B269 那条（`quotation.ts` / `paymentRequest.ts` 既有形状）：有业务编号就印编号，
 * 没有就**整段不出现**，宁缺格不拿主键顶。
 *
 * ★ 阳性对照：业务编号在时那一格照印（防止"把整行删掉蒙过去"这种假修法）。
 */
import { describe, it, expect, vi } from 'vitest';
import { invoicePdfHtml } from '../financeInvoice';
import { renderPaymentRequestBody } from '../paymentRequest';

const EXPORTER = {
  nameEn: 'B271 Exporter Ltd', addressEn: 'B271 Road 1', beneficiary: '', bankName: '',
  swiftCode: '', bankAddress: '', usdAccountNumber: '',
};

const invoiceDoc = (allocs: any[]) => ({
  invoice: {
    id: 'FIN-B271-1', invoiceNumber: 'INV-B271-1', type: 'Receivable', status: 'Issued',
    currency: 'USD', amount: 1000, issueDate: '2026-09-01', dueDate: '2026-10-01',
    customerName: 'B271 Buyer Co', remark: null,
  },
  allocs,
  exporter: EXPORTER,
  relation: null,
  ordersById: new Map<string, any>(),
  linesByOrder: new Map<string, any[]>(),
  shipment: null,
}) as any;

describe('B271·客户发票 PDF 的订单引用行：没有订单号时不许拿订单主键顶位', () => {
  it('① 缺订单号 ⇒ 内部 orderId 不许出现在发票 HTML 里', () => {
    const html = invoicePdfHtml(invoiceDoc([
      { orderId: 'ORD-B271-PK-9931', orderNumber: null, poNumber: null, allocatedAmount: 1000 },
    ]));
    expect(html, '★ 病灶：`Order ${esc(a.orderNumber ?? a.orderId)}`').not.toContain('ORD-B271-PK-9931');
  });

  it('② 有订单号 ⇒ 照印订单号（阳性对照：不许用"整行删掉"蒙过去）', () => {
    const html = invoicePdfHtml(invoiceDoc([
      { orderId: 'ORD-B271-PK-9931', orderNumber: 'SO-B271-0007', poNumber: 'PO-B271-1', allocatedAmount: 1000 },
    ]));
    expect(html).toContain('SO-B271-0007');
    expect(html).toContain('PO-B271-1');
    expect(html).not.toContain('ORD-B271-PK-9931');
  });

  it('③ 只有 P/O 号、没有订单号 ⇒ 印 P/O 号，仍不许印主键', () => {
    const html = invoicePdfHtml(invoiceDoc([
      { orderId: 'ORD-B271-PK-9931', orderNumber: null, poNumber: 'PO-B271-2', allocatedAmount: 1000 },
    ]));
    expect(html).toContain('PO-B271-2');
    expect(html).not.toContain('ORD-B271-PK-9931');
  });
});

describe('B271·付款申请单的来源单号：同一族（本批引为"既有规则"的那份模板自己也在漏）', () => {
  const prDoc = (pr: any) => ({ pr }) as any;
  const base = {
    id: 'PR-B271-1', requestNumber: 'PREQ-B271-1', status: 'Pending', currency: 'CNY',
    totalAmount: '500', paymentCategory: 'Freight', sourceType: 'Shipment',
    supplierName: 'B271 Mill', supplierCode: 'SUP-B271-9',
  };

  it('④ 缺来源单号 ⇒ 内部 sourceId 不许出现在单子上', () => {
    const html = renderPaymentRequestBody(prDoc({ ...base, sourceNumber: null, sourceId: 'SRC-B271-PK-7712' }), EXPORTER, null);
    expect(html, '★ 病灶：`${pr.sourceNumber || pr.sourceId || "—"}`').not.toContain('SRC-B271-PK-7712');
  });

  it('⑤ 有来源单号 ⇒ 照印（阳性对照）', () => {
    const html = renderPaymentRequestBody(prDoc({ ...base, sourceNumber: 'SHP-B271-0042', sourceId: 'SRC-B271-PK-7712' }), EXPORTER, null);
    expect(html).toContain('SHP-B271-0042');
    expect(html).not.toContain('SRC-B271-PK-7712');
  });
});
