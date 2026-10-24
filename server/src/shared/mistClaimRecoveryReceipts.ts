import {mistMoneyMinor,type MistState} from './mistWorkspace';
export type ClaimRecoverySettlement={
 id:string;kind:'receipt'|'noncash';amount:number;currency:string;date:string;reference:string;
 receiptId?:string;receiptCode?:string;payerBasis?:string;at:string;by:string;byId:string;
 reversed?:{at:string;by:string;byId:string;reason:string};
};
export function recoveryOtherFulfilledMinor(recovery:{id:string;settlements?:ClaimRecoverySettlement[]}){
 return (recovery.settlements??[]).filter(row=>!row.reversed).reduce((sum,row)=>sum+mistMoneyMinor(row.amount),0);
}
/** These allocations consume an existing bank receipt; they never create cash or customer sales. */
export function claimRecoveryReceiptUsedMinor(root:Pick<MistState,'platform'>,receiptId:string){
 return (root.platform?.claims??[]).flatMap(claim=>claim.coordination?.recoveries??[]).flatMap(row=>row.settlements??[])
  .filter(row=>row.kind==='receipt'&&!row.reversed&&row.receiptId===receiptId).reduce((sum,row)=>sum+mistMoneyMinor(row.amount),0);
}
