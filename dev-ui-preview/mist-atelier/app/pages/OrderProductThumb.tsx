import React from 'react';
import type {MistOrderLine, MistState} from '../../../../server/src/shared/mistWorkspace';
import type {MarketProduct} from '../../../../server/src/shared/mistMarket';
import {useMistWorkspace} from '../runtime/workspace';
import {ProductThumb,PRODUCT_CATEGORY_LABEL} from './modules/ProductParts';

/** Exact business source wins. SKU fallback is allowed only for one product in the same category. */
export function orderLineProduct(state: MistState, line: MistOrderLine, category: 'fabric'|'garment'): MarketProduct|undefined {
 const source=line as MistOrderLine & {sourceProductId?:string;sourceDevId?:string;sourceVersionId?:string};
 const products=(state.market?.products??[]).filter(p=>p.category===category);
 if(source.sourceProductId)return products.find(p=>p.id===source.sourceProductId);
 if(source.sourceVersionId){const matches=products.filter(p=>p.sourceVersionId===source.sourceVersionId);if(matches.length===1)return matches[0];}
 const matches=products.filter(p=>p.sku.trim().toLowerCase()===line.style.trim().toLowerCase());
 return matches.length===1?matches[0]:undefined;
}
export function OrderProductThumb({line,orderId,category}:{line?:MistOrderLine;orderId?:string;category:'fabric'|'garment'}) {
 const {state}=useMistWorkspace();
 const lines=line?[line]:(state?.orderLines.filter(item=>item.orderId===orderId)??[]);
 const product=state?lines.map(item=>orderLineProduct(state,item,category)).find(Boolean):undefined;
 return product?<ProductThumb product={product}/>:<span className="mist-product-thumb" data-category={category} aria-label={PRODUCT_CATEGORY_LABEL[category]+'暂无图片'}>{PRODUCT_CATEGORY_LABEL[category]}</span>;
}
