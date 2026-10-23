import {MistCommandError} from './mistWorkspace';
import type {FulfillmentSizeQuantity} from './mistFulfillment';
/** The shipment sample is one factory/batch submission with explicitly counted physical garments. */
export function parseShippingSampleSizes(value:string):FulfillmentSizeQuantity[]{
 if(!value.trim())throw new MistCommandError('VALIDATION','请登记船样实际尺码与件数');
 const rows=value.split(/\n+/).map(line=>{const m=line.trim().match(/^(.+?)[:：]\s*(\d+)$/);if(!m)throw new MistCommandError('VALIDATION','尺码与件数请逐行填写，如 M:1');return {size:m[1].trim(),quantity:Number(m[2])};});
 return normalizeShippingSampleSizes(rows,rows.reduce((sum,row)=>sum+row.quantity,0));
}
export function normalizeShippingSampleSizes(value:unknown,total:number){
 if(!Number.isSafeInteger(total)||total<=0||!Array.isArray(value)||!value.length||value.length>100)throw new MistCommandError('VALIDATION','请登记船样实际尺码与件数');
 const rows=value.map(row=>({size:typeof row?.size==='string'?row.size.trim():'',quantity:row?.quantity}));
 if(rows.some(row=>!row.size||row.size.length>80||!Number.isSafeInteger(row.quantity)||row.quantity<=0)||new Set(rows.map(row=>row.size.toLowerCase())).size!==rows.length)throw new MistCommandError('VALIDATION','船样尺码与件数无效或重复');
 if(rows.reduce((s,row)=>s+row.quantity,0)!==total)throw new MistCommandError('VALIDATION','船样各码件数合计必须等于总件数');
 return rows as FulfillmentSizeQuantity[];
}
