/**
 * 关系智库「在手业务」（服务端与页面同一口径）：
 * 客户侧——进行中订单、未关闭报价、进行中商机、未收发票（按币种）；供应商侧——未到齐的采购单。
 * 还有在手业务时不能归档关系档案（2026-11：拦截从页面补到服务端 market.relation.status）。
 */
import type { MistState } from './mistWorkspace';
import type { MarketQuotation, MarketRelation } from './mistMarket';
import { customerHandoverScope } from './mistHandover';
import { quotationConversionComplete } from './mistQuotationLineConversion';

/** 未关闭报价：草稿、待审批、已发送、已接受但还没全部转单。 */
export function quotationOpen(q: MarketQuotation) {
  if (quotationConversionComplete(q)) return false;
  return !['Rejected', 'Expired'].includes(q.status);
}
export function supplierOpenPurchases(state: MistState | null, supplierId: string) {
  const f = state?.fulfillment;
  return (f?.purchases || []).filter(p => p.supplierId === supplierId && p.state !== 'rejected' && p.state !== 'cancelled'
    && (f?.receipts || []).filter(r => r.purchaseId === p.id).reduce((n, r) => n + r.quantity + r.rejected, 0) < p.quantity);
}
export function relationBusiness(state: MistState | null, r: MarketRelation) {
  const orders = state && r.customerId ? customerHandoverScope(state, r.customerId).orders : [];
  const quotations = r.customerId ? (state?.market.quotations || []).filter(q => q.customerId === r.customerId && quotationOpen(q)) : [];
  const opportunities = r.customerId ? (state?.crm.opportunities || []).filter(o => o.customerId === r.customerId && o.stage !== 'won' && o.stage !== 'lost') : [];
  const orderIds = new Set((state?.orders || []).filter(o => o.customerId === r.customerId).map(o => o.id));
  const receivable = new Map<string, number>();
  if (r.customerId) for (const inv of state?.invoices || []) if (!inv.voidedAt && orderIds.has(inv.orderId) && inv.open > 0) receivable.set(inv.currency, Math.round(((receivable.get(inv.currency) || 0) + inv.open) * 100) / 100);
  const purchases = r.supplierId ? supplierOpenPurchases(state, r.supplierId) : [];
  return { orders, quotations, opportunities, receivable: [...receivable.entries()], purchases, total: orders.length + quotations.length + opportunities.length + purchases.length };
}
