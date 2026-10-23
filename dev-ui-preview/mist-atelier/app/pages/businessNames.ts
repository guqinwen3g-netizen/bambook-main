import type { MistState, MistProduction } from '../../../../server/src/shared/mistWorkspace';
import type { FulfillmentPurchase, FulfillmentStock } from '../../../../server/src/shared/mistFulfillment';

/** Identity comes from the source item; contract descriptions remain complete in the record. */
function itemName(state: MistState, orderId: string, lineId: string): string | undefined {
  const line = state.orderLines.find(row => row.id === lineId && row.orderId === orderId);
  if (!line) return undefined;
  return state.market.products.find(row => row.sku === line.style)?.name || line.name;
}
export function purchaseName(state: MistState, purchase: FulfillmentPurchase): string {
  return purchase.kind === 'finished' ? itemName(state, purchase.orderId, purchase.lineId) || purchase.description : purchase.description;
}
export function productionName(state: MistState, production: MistProduction): string {
  const purchase = state.fulfillment.purchases.find(row => row.id === production.sourcePurchaseId);
  return (purchase && purchaseName(state, purchase)) || production.name;
}
export function stockName(state: MistState, stock: FulfillmentStock): string {
  const purchase = state.fulfillment.purchases.find(row => row.id === stock.purchaseId);
  return (purchase && purchaseName(state, purchase)) || stock.name;
}
