import type {MistState} from './mistWorkspace';
import {convertLength} from '../lib/unitConversion';
import {normalizeOrderQuantityUnit} from './orderQuantitySummary';

type ProgressBranch={id:string;lineId?:string;qty:number;pct:number;unit?:string};
/** Lengths are comparable in metres. Incompatible quantities count by order line,
 * with split sources weighted within their line; contractual quantities stay intact. */
export function aggregateProductionProgress(branches:readonly ProgressBranch[]):number|undefined{
 const rows=branches.filter(row=>Number.isFinite(row.qty)&&row.qty>0&&Number.isFinite(row.pct)).map(row=>{
  const metres=convertLength(row.qty,row.unit,'M'),unit=normalizeOrderQuantityUnit(row.unit);
  return {...row,weight:metres??row.qty,basis:metres!==null?'M':unit||row.unit?.trim().toLowerCase()||`unknown:${row.id}`};
 });
 if(!rows.length)return undefined;
 const average=(items:typeof rows):number=>new Set(items.map(row=>row.basis)).size===1
  ?items.reduce((sum,row)=>sum+row.weight*row.pct,0)/items.reduce((sum,row)=>sum+row.weight,0)
  :items.reduce((sum,row)=>sum+row.pct,0)/items.length;
 if(new Set(rows.map(row=>row.basis)).size===1)return Math.round(average(rows));
 const lines=new Map<string,typeof rows>();
 for(const row of rows){const key=row.lineId||row.id;lines.set(key,[...(lines.get(key)||[]),row]);}
 return Math.round([...lines.values()].reduce((sum,line)=>sum+average(line),0)/lines.size);
}
/** Contractual quantity checking is distinct from production allocation and QC size coverage. */
export function productionQuantityBasis(root:MistState,orderId:string){
 const order=root.orders.find(row=>row.id===orderId),g=order?.governance;
 if(!order)return null;
 if(order.type!=='garment')return {scope:'total' as const,note:'',version:g?.effectiveVersion||0};
 const c=g?.approvedSnapshot?.contract;
 if(g?.status!=='approved'||!c?.quantityBasis||!c.quantityBasisNote?.trim())return null;
 return {scope:c.quantityBasis,note:c.quantityBasisNote,version:g.effectiveVersion};
}
