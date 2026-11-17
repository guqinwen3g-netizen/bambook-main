import type {TokenPayload} from '../auth/service';
import {hasScope} from '../auth/permissionService';
import {scopedVisibility,type MistDataScope} from '../shared/mistDataScope';
import type {MistState} from '../shared/mistWorkspace';
import {commercialSampleLoanSources,type CommercialSampleLoanSources} from '../shared/mistCommercialSampleLoan';

/** Action-scoped source choices do not expose inventory or extend borrower/source reading. */
export function projectCommercialSampleLoanSources(full:MistState,visible:MistState,actor:TokenPayload,scope?:MistDataScope,companyId?:string|null):Record<string,CommercialSampleLoanSources>|undefined{
 if(companyId&&actor.companyId!==companyId||!hasScope(actor,'products:read'))return;
 const writable=scope?scopedVisibility(full,scope,false):undefined,result:Record<string,CommercialSampleLoanSources>={};
 for(const shown of visible.fulfillment.samples){
  if(shown.role!=='shipping'||shown.shippingQuantityBasis?.kind!=='included'||shown.shippingQuantityBasis.consumption)continue;
  const original=full.fulfillment.samples.find(s=>s.id===shown.id);if(!original||original.source.kind!=='orderLine')continue;
  const source=original.source;
  const actionable=!writable||writable.get('fulfillment.samples')?.has(original.id)&&writable.get('orders')?.has(source.orderId)&&writable.get('orderLines')?.has(source.lineId)&&writable.get('productions')?.has(source.productionId||'');
  if(!hasScope(actor,'products:write')||!actionable){result[original.id]={status:'forbidden',reason:'当前岗位不能办理本组商业借样'};continue;}
  const production=full.productions.find(p=>p.id===source.productionId);
  if(!production||writable&&!writable.get('fulfillment.purchases')?.has(production.sourcePurchaseId||'')){result[original.id]={status:'unreadable',reason:'当前商业交接来源不可核对'};continue;}
  const capability=commercialSampleLoanSources(full,original);
  result[original.id]=capability.status==='available'&&writable&&capability.options.some(option=>!writable.get('fulfillment.stock')?.has(option.stockId))?{status:'unreadable',reason:'当前商业交接来源不可核对'}:capability;
 }
 return Object.keys(result).length?result:undefined;
}
