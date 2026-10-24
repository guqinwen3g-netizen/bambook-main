import { MIST_FINANCE_SCOPES } from './mistFinancePermissions';
import { MistCommandError, mistMoneyMinor, type MistState, type MistContext, type MistCommandResult } from './mistWorkspace';

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
   if(invoice&&((invoice as {devId?:string}).devId||(invoice as {opening?:unknown}).opening)){if(invoice.currency!==receipt.currency||allocation.currency!==receipt.currency)fail('核销来源或币种不一致');development+=mistMoneyMinor(allocation.amount);continue;}
   const order=root.orders.find(o=>o.id===invoice?.orderId);
   if(!invoice||!order||invoice.currency!==receipt.currency||allocation.currency!==receipt.currency)fail('核销来源或币种不一致');
   orderBucket(order.customerId,order.id).allocated+=mistMoneyMinor(allocation.amount);
  }
  // Development-fee invoices have no order; their allocations still consume this receipt.
  let reserved=development;for(const customer of customers.values()){
   const orders=[...customer.orders.values()],assigned=orders.reduce((n,o)=>n+o.assigned,0),used=orders.reduce((n,o)=>n+Math.max(o.assigned,o.allocated),0);
   reserved+=Math.max(assigned+customer.unassigned,used);
  }
  return {customers,reserved};
}
export function assertOrderFundingIntegrity(root:Root){
 for(const receipt of root.receipts){
  const {reserved}=receiptFundingUse(root,receipt);
  if(reserved>mistMoneyMinor(receipt.amount)){const money=(n:number)=>(n/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+receipt.currency;fail(`此到账金额 ${money(mistMoneyMinor(receipt.amount))}，归属与核销合计将达 ${money(reserved)}，超出到账金额，不能重复计入；请核对本次金额或该到账已有的归属`,'PRECONDITION');}
 }

 for(const row of active(root))if(!root.receipts.some(r=>r.id===row.receiptId))fail('归属的到账来源不存在');
 for(const order of root.orders)if(mistMoneyMinor(orderFundingCoveredAmount(root,order.id))>mistMoneyMinor(order.amount))fail('订单已归属与核销金额超过合同金额，超额部分请登记为客户余额','PRECONDITION');
}
/** Read-only headroom for the reconciliation picker. Earmarks and allocations overlap only within their existing customer/order buckets. */
export function orderFundingReconciliationLimit(root:Root,receiptId:string,invoiceId:string):number{
 const receipt=root.receipts.find(r=>r.id===receiptId),invoice=root.invoices.find(i=>i.id===invoiceId);
 if(!receipt||!invoice||receipt.currency!==invoice.currency||receipt.remaining<=0||invoice.open<=0)return 0;
 const {customers,reserved}=receiptFundingUse(root,receipt);
 const free=mistMoneyMinor(receipt.amount)-reserved;
 let allowed=free;
 if(!(invoice as {devId?:string;opening?:unknown}).devId&&!(invoice as {opening?:unknown}).opening){
  const order=root.orders.find(o=>o.id===invoice.orderId);if(!order)return 0;
  const customer=customers.get(order.customerId),bucket=customer?.orders.get(order.id);
  const assignedRoom=Math.max(0,(bucket?.assigned??0)-(bucket?.allocated??0));
  const buckets=[...(customer?.orders.values()??[])];
  const customerAssigned=buckets.reduce((n,b)=>n+b.assigned,0)+(customer?.unassigned??0);
  const customerUsed=buckets.reduce((n,b)=>n+Math.max(b.assigned,b.allocated),0);
  allowed=Math.min(free+Math.max(0,customerAssigned-customerUsed)+assignedRoom,mistMoneyMinor(order.amount)-mistMoneyMinor(orderFundingCoveredAmount(root,order.id))+assignedRoom);
 }
 return Math.max(0,Math.min(mistMoneyMinor(receipt.remaining),mistMoneyMinor(invoice.open),allowed))/100;
}
export function orderFundingCoveredAmount(root:Root,orderId:string){
 let covered=0;for(const receipt of root.receipts){
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
export function assertOrderDepositCovered(root:Root,orderId:string){const coverage=orderDepositCoverage(root,orderId);if(coverage.status==='unconfigured')fail('请先明确合同付款方式及T/T定金比例，不能按未配置视为已收定金','PRECONDITION');if(coverage.status==='insufficient')fail(`订单定金尚不足：要求 ${coverage.required}，已确认归属 ${coverage.received}`,'PRECONDITION');assertOrderFundingIntegrity(root);return coverage;}

/** Explicit cumulative order percentage, approved with the contract; never inferred from prose. */
export function orderShipmentPaymentCoverage(root:Root,orderId:string){
 const order=root.orders.find(o=>o.id===orderId);if(!order)return fail('来源订单不存在','NOT_FOUND');
 const percent=order.governance?.contract.preShipmentPercent,received=orderFundingCoveredAmount(root,orderId);
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
