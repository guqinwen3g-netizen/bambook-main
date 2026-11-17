import {MistCommandError} from './mistWorkspace';
import type {FulfillmentStock,StockReservation} from './mistFulfillment';

/** A server-created custody obligation; never an ordinary caller-supplied reservation purpose. */
export type StockSampleLoanHold={sampleId:string;loanId:string;unit:string;sourceLocation:string;returned:number;owned:true;ordinaryAllocations?:Array<{reservationId:string;quantity:number;returned:number}>};
/** Only the lending transaction may move an existing same-source reservation into offsite custody. */
export function ordinarySampleLoanReserved(reservation:StockReservation){
 const quantity=(reservation.sampleLoanAllocations||[]).reduce((n,row)=>{if(!Number.isFinite(row.quantity)||!Number.isFinite(row.returned)||row.quantity<=0||row.returned<0||row.returned>row.quantity)throw new MistCommandError('PRECONDITION','原商业借样预留分摊需核对');return n+row.quantity-row.returned;},0);
 return Math.round(quantity*10000)/10000;
}
export const isSampleLoanHold=(reservation:StockReservation)=>reservation.sampleLoan!==undefined;
export function sampleLoanHoldOpen(reservation:StockReservation):number{
 if(!isSampleLoanHold(reservation))return 0;
 const returned=reservation.sampleLoan?.returned??0;
 if(!Number.isFinite(returned)||returned<0||returned>reservation.quantity||reservation.issued)throw new MistCommandError('PRECONDITION','原商业借样占用记录需核对');
 // An unrelated release flag cannot erase an outstanding physical custody obligation.
 return Math.round((reservation.quantity-returned)*10000)/10000;
}
export const stockSampleLoanQuantity=(stock:Pick<FulfillmentStock,'reservations'>)=>Math.round((stock.reservations||[]).reduce((n,r)=>n+sampleLoanHoldOpen(r),0)*10000)/10000;
export const stockCompanyOwned=(stock:Pick<FulfillmentStock,'ownership'|'owner'>)=>stock.ownership==='Owned'||stock.ownership!=='Transferred'&&stock.owner==='公司';
/** Existing available/positions remain physically inside the warehouse; loans are carried separately. */
export const stockCustodyQuantity=(stock:Pick<FulfillmentStock,'available'|'reservations'>)=>Math.round((stock.available+stockSampleLoanQuantity(stock))*10000)/10000;
/** Keep the pre-loan valuation basis and add back only verified company-owned offsite samples. */
export const stockLoanAdjustedValuationQuantity=(stock:FulfillmentStock)=>Math.round((stock.available+(stockCompanyOwned(stock)?stockSampleLoanQuantity(stock):0))*10000)/10000;
