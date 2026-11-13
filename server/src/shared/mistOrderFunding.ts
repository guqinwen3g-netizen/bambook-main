import {claimRecoveryReceiptUsedMinor} from './mistClaimRecoveryReceipts';
import {rebateReceiptUsedMinor} from './mistExportRebate';
import { MIST_FINANCE_SCOPES } from './mistFinancePermissions';
import { MistCommandError, isRecognizedMistInvoice, mistAllocationReceiptMinor, mistMoneyMinor, type MistState, type MistContext, type MistCommandResult } from './mistWorkspace';

export type OrderFundingAssignment = {
  id:string; receiptId:string; customerId:string; orderId:string|null; amount:number; currency:string;
  note:string; state:'active'|'released'; createdAt:string; updatedAt:string; actor:string;
  history:Array<{at:string;actor:string;orderId:string|null;amount:number;note:string;state:'active'|'released'}>;
};
export type OrderFundingState={assignments:OrderFundingAssignment[]};
export type OrderFundingCommand=
 | {type:'funding.assign';payload:{id?:string;receiptId:string;customerId:string;orderId?:string|null;amount:number;note:string}}
 | {type:'funding.release';payload:{id:string;note:string}};
type Root=MistState&{orderFunding?:OrderFundingState};
function fail(message:string,code='VALIDATION'):never{throw new MistCommandError(code,message);}
const text=(value:unknown,label:string)=>typeof value==='string'&&value.trim()&&value.length<=4000?value.trim():fail(label+'未填写或格式无效');
const cents=(value:number)=>{const result=mistMoneyMinor(value);if(result<=0)fail('归属金额必须大于零');return result;};
const active=(root:Root)=>(root.orderFunding?.assignments||[]).filter(row=>row.state==='active');
export const createOrderFundingState=(_context?:MistContext,_root?:unknown):OrderFundingState=>({assignments:[]});
export function orderFundingCommandPermission(command:OrderFundingCommand){if(command.type==='funding.assign'||command.type==='funding.release')return MIST_FINANCE_SCOPES.reconcile;return fail('未知资金归属操作');}

/** Customer balances can fund that customer's invoices; order deposits cannot be spent on another order. */
function receiptFundingUse(root:Root,receipt:Root['receipts'][number]){
  const customers=new Map<string,{unassigned:number;orders:Map<string,{assigned:number;allocated:number}>}>();
  const group=(id:string)=>{if(!customers.has(id))customers.set(id,{unassigned:0,orders:new Map()});return customers.get(id)!;};
  const orderBucket=(customerId:string,orderId:string)=>{const customer=group(customerId);if(!customer.orders.has(orderId))customer.orders.set(orderId,{assigned:0,allocated:0});return customer.orders.get(orderId)!;};
  for(const row of active(root).filter(row=>row.receiptId===receipt.id)){
   if(row.currency!==receipt.currency||!root.customers.some(c=>c.id===row.customerId))fail('资金归属客户或币种与到账来源不一致');
   const amount=cents(row.amount);if(row.orderId){const order=root.orders.find(o=>o.id===row.orderId);if(!order||order.customerId!==row.customerId||order.currency!==row.currency)fail('资金归属订单、客户或币种不一致');orderBucket(row.customerId,row.orderId).assigned+=amount;}else group(row.customerId).unassigned+=amount;
  }
  let development=0;
  for(const allocation of root.allocations.filter(a=>a.receiptId===receipt.id)){
   const invoice=root.invoices.find(i=>i.id===allocation.invoiceId);
   const crossCurrency=allocation.receiptAmount!==undefined&&allocation.receiptCurrency===receipt.currency;
   if(invoice&&((invoice as {devId?:string}).devId||(invoice as {sampleRequestId?:string}).sampleRequestId||(invoice as {opening?:unknown}).opening||crossCurrency)){if(invoice.currency!==allocation.currency||!crossCurrency&&allocation.currency!==receipt.currency)fail('核销来源或币种不一致');development+=mistAllocationReceiptMinor(allocation);continue;}
   const order=root.orders.find(o=>o.id===invoice?.orderId);
   if(!invoice||!order||invoice.currency!==receipt.currency||allocation.currency!==receipt.currency)fail('核销来源或币种不一致');
   orderBucket(order.customerId,order.id).allocated+=mistMoneyMinor(allocation.amount);
  }
  // Development-fee invoices have no order; their allocations still consume this receipt.
  let reserved=development+rebateReceiptUsedMinor(root,receipt.id)+claimRecoveryReceiptUsedMinor(root,receipt.id);for(const customer of customers.values()){
   const orders=[...customer.orders.values()],assigned=orders.reduce((n,o)=>n+o.assigned,0),used=orders.reduce((n,o)=>n+Math.max(o.assigned,o.allocated),0);
   reserved+=Math.max(assigned+customer.unassigned,used);
  }
  return {customers,reserved};
}
/** Unapplied ownership in receipt currency. Named-payer fallback may use only genuinely unreserved cash. */
export function customerReceiptUnappliedMinor(root:Root,receiptId:string,customerId:string,includeUnassigned=false):number{
 const receipt=root.receipts.find(row=>row.id===receiptId);if(!receipt||receipt.remaining<=0)return 0;
 const {customers,reserved}=receiptFundingUse(root,receipt),amount=mistMoneyMinor(receipt.amount);
 if(reserved>amount)fail('到账资金归属与核销不一致，不能计算客户余额','PRECONDITION');
 const customer=customers.get(customerId),orders=[...(customer?.orders.values()??[])];
 const assigned=(customer?.unassigned??0)+orders.reduce((n,row)=>n+row.assigned,0);
 const held=orders.reduce((n,row)=>n+Math.max(row.assigned,row.allocated),0);
 const allocated=orders.reduce((n,row)=>n+row.allocated,0);
 const owned=Math.max(assigned,held)-allocated,free=includeUnassigned?amount-reserved:0;
 return Math.max(0,Math.min(mistMoneyMinor(receipt.remaining),owned+free));
}
/**
 * 订单可收款上限：合同金额；溢装 / 已批准超量出运按实际开出更高的销售发票时，以财务已确认的发票合计为准。
 * 待确认、已驳回或已作废的 CI 不抬高上限（与核销口径 isRecognizedMistInvoice 一致）。except 用于预判作废 / 驳回某张发票之后的上限。
 */
function orderCollectibleMinor(root:Root,order:Root['orders'][number],except?:string){
 return Math.max(mistMoneyMinor(order.amount),root.invoices.filter(i=>i.orderId===order.id&&i.id!==except&&i.currency===order.currency&&isRecognizedMistInvoice(i)).reduce((n,i)=>n+mistMoneyMinor(i.amount),0));
}
const moneyText=(minor:number,currency:string)=>(minor/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+currency;
export function assertOrderFundingIntegrity(root:Root){
 for(const receipt of root.receipts){
  const {reserved}=receiptFundingUse(root,receipt);
  if(reserved>mistMoneyMinor(receipt.amount)){const money=(n:number)=>moneyText(n,receipt.currency);fail(`此到账金额 ${money(mistMoneyMinor(receipt.amount))}，归属与核销合计将达 ${money(reserved)}，超出到账金额，不能重复计入；请核对本次金额或该到账已有的归属`,'PRECONDITION');}
 }

 for(const row of active(root))if(!root.receipts.some(r=>r.id===row.receiptId))fail('归属的到账来源不存在');
 // 报错指明订单：残留的超额状态会卡住所有资金命令，必须能定位到具体订单。
 for(const order of root.orders){const covered=mistMoneyMinor(orderFundingCoveredAmount(root,order.id)),contract=mistMoneyMinor(order.amount);if(covered<=contract)continue;const cap=orderCollectibleMinor(root,order);if(covered>cap)fail(`订单 ${order.code} 已归属与核销 ${moneyText(covered,order.currency)}，超过合同金额${cap>contract?'及已确认发票合计':''} ${moneyText(cap,order.currency)}，请先把超出的 ${moneyText(covered-cap,order.currency)} 改登为客户余额`,'PRECONDITION');}
}
/** 作废或驳回销售发票前调用：发票撤出后若本订单有效归属超过新的可收上限，须先释放或改登客户余额。 */
export function assertOrderFundingAfterInvoiceRemoval(root:Root,invoiceId:string){
 const invoice=root.invoices.find(i=>i.id===invoiceId),order=invoice?root.orders.find(o=>o.id===invoice.orderId):undefined;if(!order)return;
 const before=orderCollectibleMinor(root,order),after=orderCollectibleMinor(root,order,invoiceId);if(after>=before)return;
 const covered=mistMoneyMinor(orderFundingCoveredAmount(root,order.id));
 if(covered>after)fail(`订单 ${order.code} 已归属与核销 ${moneyText(covered,order.currency)}，作废后可收上限 ${moneyText(after,order.currency)}，请先把超出的 ${moneyText(covered-after,order.currency)} 改登为客户余额`,'PRECONDITION');
}
/** Read-only headroom for the reconciliation picker. Earmarks and allocations overlap only within their existing customer/order buckets. */
export function orderFundingReconciliationLimit(root:Root,receiptId:string,invoiceId:string):number{
 const receipt=root.receipts.find(r=>r.id===receiptId),invoice=root.invoices.find(i=>i.id===invoiceId);
 if(!receipt||!invoice||receipt.currency!==invoice.currency||receipt.remaining<=0||invoice.open<=0)return 0;
 const {customers,reserved}=receiptFundingUse(root,receipt);
 const free=mistMoneyMinor(receipt.amount)-reserved;
 let allowed=free;
 if(!(invoice as {devId?:string;opening?:unknown}).devId&&!(invoice as {sampleRequestId?:string}).sampleRequestId&&!(invoice as {opening?:unknown}).opening){
  const order=root.orders.find(o=>o.id===invoice.orderId);if(!order)return 0;
  const customer=customers.get(order.customerId),bucket=customer?.orders.get(order.id);
  const assignedRoom=Math.max(0,(bucket?.assigned??0)-(bucket?.allocated??0));
  const buckets=[...(customer?.orders.values()??[])];
  const customerAssigned=buckets.reduce((n,b)=>n+b.assigned,0)+(customer?.unassigned??0);
  const customerUsed=buckets.reduce((n,b)=>n+Math.max(b.assigned,b.allocated),0);
  allowed=Math.min(free+Math.max(0,customerAssigned-customerUsed)+assignedRoom,orderCollectibleMinor(root,order)-mistMoneyMinor(orderFundingCoveredAmount(root,order.id))+assignedRoom);
 }
 return Math.max(0,Math.min(mistMoneyMinor(receipt.remaining),mistMoneyMinor(invoice.open),allowed))/100;
}
/** Money already reserved for customers cannot be spent on a supplier or tax receipt. */
export function orderFundingNonCustomerReceiptLimit(root:Root,receiptId:string){
 const receipt=root.receipts.find(row=>row.id===receiptId);if(!receipt)return 0;
 return Math.max(0,Math.min(mistMoneyMinor(receipt.remaining),mistMoneyMinor(receipt.amount)-receiptFundingUse(root,receipt).reserved))/100;
}
export function orderFundingCoveredAmount(root:Root,orderId:string){
 let covered=0;for(const receipt of [...root.receipts,...(root.partialReceipts??[]).filter(partial=>!root.receipts.some(row=>row.id===partial.id))]){
  const assigned=active(root).filter(row=>row.receiptId===receipt.id&&row.orderId===orderId).reduce((n,row)=>n+mistMoneyMinor(row.amount),0);
  const allocated=root.allocations.filter(a=>a.receiptId===receipt.id&&root.invoices.some(i=>i.id===a.invoiceId&&i.orderId===orderId)).reduce((n,a)=>n+mistMoneyMinor(a.amount),0);
  covered+=Math.max(assigned,allocated);
 }return covered/100;
}
export function orderDepositCoverage(root:Root,orderId:string){
 const order=root.orders.find(o=>o.id===orderId);if(!order)return fail('来源订单不存在','NOT_FOUND');
 const contract=(order as typeof order&{governance?:{contract?:{paymentMethod?:string;depositPercent?:number|null}}}).governance?.contract;
 const received=orderFundingCoveredAmount(root,orderId),percent=contract?.depositPercent;
 if(!contract?.paymentMethod)return {status:'unconfigured' as const,required:null,received,percent:null};
 if(contract.paymentMethod!=='TT')return {status:'not_required' as const,required:0,received,percent:null};
 let rateMinor:number;try{if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100)throw new Error('rate');rateMinor=mistMoneyMinor(percent);}catch{return {status:'unconfigured' as const,required:null,received,percent:null};}
 const required=Number((BigInt(mistMoneyMinor(order.amount))*BigInt(rateMinor)+BigInt(5000))/BigInt(10000))/100;
 return {status:received>=required?'covered' as const:'insufficient' as const,required,received,percent};
}
/** Read-only coverage also works with scoped receipt summaries; writes still validate the complete ledger below. */
export function orderDepositBlocker(root:Root,orderId:string):string|undefined{
 const coverage=orderDepositCoverage(root,orderId);
 if(coverage.status==='unconfigured')return '请先明确合同付款方式及T/T定金比例，不能按未配置视为已收定金';
 if(coverage.status==='insufficient')return `订单定金尚不足：要求 ${coverage.required}，已确认归属 ${coverage.received}`;
}
export function assertOrderDepositCovered(root:Root,orderId:string){const blocker=orderDepositBlocker(root,orderId);if(blocker)fail(blocker,'PRECONDITION');assertOrderFundingIntegrity(root);return orderDepositCoverage(root,orderId);}

/** Explicit T/T cumulative order percentage; other settlement methods do not impose a cash percentage. */
export function orderShipmentPaymentCoverage(root:Root,orderId:string){
 const order=root.orders.find(o=>o.id===orderId);if(!order)return fail('来源订单不存在','NOT_FOUND');
 const contract=order.governance?.contract,received=orderFundingCoveredAmount(root,orderId);
 // The contract editor exposes this percentage only for T/T. A previous T/T
 // value must not turn L/C presentation or agreed credit into advance cash.
 if(contract&&['LC','OA','OTHER'].includes(contract.paymentMethod))return {status:'not_required' as const,required:0,received,percent:null,shortage:0};
 const percent=contract?.preShipmentPercent;
 if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100)return {status:'unconfigured' as const,required:null,received,percent:null,shortage:null};
 let rate:number;try{rate=mistMoneyMinor(percent);}catch{return {status:'unconfigured' as const,required:null,received,percent:null,shortage:null};}
 const requiredMinor=Number((BigInt(mistMoneyMinor(order.amount))*BigInt(rate)+BigInt(5000))/BigInt(10000));
 const shortage=Math.max(0,requiredMinor-mistMoneyMinor(received))/100;
 return {status:shortage?'insufficient' as const:'covered' as const,required:requiredMinor/100,received,percent,shortage};
}
export function orderShipmentPaymentBlocker(root:Root,orderId:string):string|undefined{
 const order=root.orders.find(o=>o.id===orderId);if(!order)return '来源订单不存在';
 const coverage=orderShipmentPaymentCoverage(root,orderId);
 if(coverage.status==='unconfigured')return `${order.code}：请确认合同出运前累计收款比例`;
 if(coverage.status==='insufficient')return `${order.code}：出运前收款不足，尚差 ${coverage.shortage!.toFixed(2)} ${order.currency}`;
}
export function assertOrderShipmentPaymentCovered(root:Root,orderId:string){
 const blocker=orderShipmentPaymentBlocker(root,orderId);if(blocker)fail(blocker,'PRECONDITION');
 assertOrderFundingIntegrity(root);return orderShipmentPaymentCoverage(root,orderId);
}

export function applyOrderFundingCommand(root:Root,command:OrderFundingCommand,context:MistContext):MistCommandResult{
 orderFundingCommandPermission(command);if(!context.actorId)fail('资金归属需要真实操作账号','FORBIDDEN');
 const assignments=structuredClone(root.orderFunding?.assignments||[]);let row:OrderFundingAssignment;
 if(command.type==='funding.assign'){
  const p=command.payload,receipt=root.receipts.find(r=>r.id===p.receiptId);if(!receipt)fail('到账来源不存在','NOT_FOUND');
  // 已勾稽到退税申报的国库到账：金额即退税到账额。不持计税依据时返回不带金额的通用错误，不能借超额提示取数。
  if(!context.can?.('sensitive:tax_base')&&rebateReceiptUsedMinor(root,receipt!.id)>0)fail('该到账不能用于客户资金归属','PRECONDITION');
  if(!root.customers.some(c=>c.id===p.customerId))fail('归属客户不存在','NOT_FOUND');cents(p.amount);const note=text(p.note,'资金归属依据');
  const orderId=p.orderId||null,order=orderId?root.orders.find(o=>o.id===orderId):null;if(orderId&&(!order||order.customerId!==p.customerId||order.currency!==receipt!.currency))fail('请选择同客户同币种订单');
  const old=p.id?assignments.find(r=>r.id===p.id):undefined;if(p.id&&!old)fail('资金归属记录不存在','NOT_FOUND');if(old?.state==='released')fail('已释放的归属不能覆盖，请另建记录');if(old&&old.receiptId!==p.receiptId)fail('不能更换原到账来源');
  if(assignments.some(row=>row.state==='active'&&row.id!==old?.id&&row.receiptId===p.receiptId&&row.customerId===p.customerId&&row.orderId===orderId))fail('此到账已存在相同归属，请调整原记录，不能重复登记');
  row={id:old?.id||context.id(),receiptId:receipt!.id,customerId:p.customerId,orderId,amount:p.amount,currency:receipt!.currency,note,state:'active',createdAt:old?.createdAt||context.now,updatedAt:context.now,actor:context.actorName,history:[...(old?.history||[]),{at:context.now,actor:context.actorName,orderId,amount:p.amount,note,state:'active'}]};
  if(old)assignments[assignments.indexOf(old)]=row;else assignments.push(row);
 }else{const old=assignments.find(r=>r.id===command.payload.id);if(!old)fail('资金归属记录不存在','NOT_FOUND');if(old!.state==='released')return{id:old!.id};const note=text(command.payload.note,'释放依据');row={...old!,state:'released',note,updatedAt:context.now,actor:context.actorName,history:[...old!.history,{at:context.now,actor:context.actorName,orderId:old!.orderId,amount:old!.amount,note,state:'released'}]};assignments[assignments.indexOf(old!)]=row;}
 const next={...root,orderFunding:{assignments}};assertOrderFundingIntegrity(next);root.orderFunding=next.orderFunding;
 root.events.unshift({id:context.id(),entityType:'orderFunding',entityId:row.id,actor:context.actorName,at:context.now,text:row.state==='released'?'释放资金归属：'+row.note:'登记资金归属：'+row.note,fileIds:[]});
 return{id:row.id,orderId:row.orderId??undefined};
}

/**
 * Advance (预收) ledger: money earmarked to a customer or order that has not yet been applied to its invoices.
 * remaining = earmarked − already allocated to that order's invoices from the same receipt. Read-only; applying goes through
 * finance.reconcile (finance.advance.apply picks the order's oldest open invoices).
 */
export type AdvanceBalance = { assignmentId: string; receiptId: string; receiptCode: string; customerId: string; orderId: string | null; currency: string; earmarked: number; applied: number; remaining: number };
export function advanceBalances(root: Root): AdvanceBalance[] {
 return active(root).map(row => {
  const receipt = root.receipts.find(r => r.id === row.receiptId);
  const applied = row.orderId ? root.allocations.filter(a => a.receiptId === row.receiptId && root.invoices.some(i => i.id === a.invoiceId && i.orderId === row.orderId)).reduce((n, a) => n + mistAllocationReceiptMinor(a), 0) : 0;
  const earmarked = mistMoneyMinor(row.amount);
  return { assignmentId: row.id, receiptId: row.receiptId, receiptCode: receipt?.code || '', customerId: row.customerId, orderId: row.orderId, currency: row.currency, earmarked: earmarked / 100, applied: Math.min(applied, earmarked) / 100, remaining: Math.max(0, earmarked - applied) / 100 };
 }).filter(b => b.remaining > 0);
}
