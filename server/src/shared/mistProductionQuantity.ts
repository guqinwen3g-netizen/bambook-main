import type {MistState} from './mistWorkspace';
/** Contractual quantity checking is distinct from production allocation and QC size coverage. */
export function productionQuantityBasis(root:MistState,orderId:string){
 const order=root.orders.find(row=>row.id===orderId),g=order?.governance;
 if(!order)return null;
 if(order.type!=='garment')return {scope:'total' as const,note:'',version:g?.effectiveVersion||0};
 const c=g?.approvedSnapshot?.contract;
 if(g?.status!=='approved'||!c?.quantityBasis||!c.quantityBasisNote?.trim())return null;
 return {scope:c.quantityBasis,note:c.quantityBasisNote,version:g.effectiveVersion};
}
