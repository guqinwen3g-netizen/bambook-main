import { describe, expect, it } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { purchaseName, productionName, stockName } from './businessNames';

describe('business identity is separate from contractual requirements', () => {
  function fixture() {
    const state = createMistState({id:()=> 'x',now:'2026-10-23T00:00:00Z',actorName:'经办人'},'empty');
    state.orderLines.push({id:'line',orderId:'order',style:'FAB-1',name:'订单品名'} as any);
    state.market.products.push({sku:'FAB-1',name:'羊毛混纺斜纹'} as any);
    const purchase = {id:'purchase',orderId:'order',lineId:'line',kind:'finished',description:'完整规格与交付约定'} as any;
    state.fulfillment.purchases.push(purchase);
    return {state,purchase};
  }
  it('uses the linked item across purchase, production and inventory without modifying contract text', () => {
    const {state,purchase}=fixture();
    expect(purchaseName(state,purchase)).toBe('羊毛混纺斜纹');
    expect(productionName(state,{sourcePurchaseId:'purchase',name:'原长说明'} as any)).toBe('羊毛混纺斜纹');
    expect(stockName(state,{purchaseId:'purchase',name:'原长说明'} as any)).toBe('羊毛混纺斜纹');
    expect(purchase.description).toBe('完整规格与交付约定');
  });
  it('preserves independent material and return-stock names', () => {
    const {state,purchase}=fixture(); purchase.kind='material'; purchase.description='洗标';
    expect(purchaseName(state,purchase)).toBe('洗标');
    expect(stockName(state,{name:'退回成衣',orderId:'order',lineId:'line'} as any)).toBe('退回成衣');
  });
  it('uses the order item when the product catalogue is not in the readable projection', () => {
    const {state,purchase}=fixture(); state.market.products=[];
    expect(purchaseName(state,purchase)).toBe('订单品名');
  });
});
