import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,type MistContext,type MistState} from './mistWorkspace';
import {createMarketState,applyMarketCommand,type MarketState,type MarketCommand} from './mistMarket';
import {CUSTOMER_PAYMENT_TERMS,paymentTermContract,quotationContract} from './mistTradeTerms';

const setup=()=>{let n=0;const ctx:MistContext={id:()=>`tt-${++n}`,now:'2026-10-27T08:00:00.000Z',actorName:'业务员',actorId:'sales',authority:{supplier:{},businessReviewerId:'leader'}};const s=createMistState(ctx) as MistState&{market:MarketState};s.market=createMarketState(ctx,s);return {ctx,s};};
const run=(s:MistState,c:MarketCommand,ctx:MistContext)=>applyMarketCommand(s,c,ctx);
/** 一个面料产品条目的报价，走到客户已接受。 */
const accepted=(s:MistState&{market:MarketState},ctx:MistContext,terms:{deliveryTerms:string;paymentTerms:string})=>{
  const productId=run(s,{type:'market.product.save',payload:{input:{sku:'P-TT-1',name:'面料1',category:'fabric',season:'AW26',supplierId:'',supplierCode:'',composition:'棉',specification:'150cm',color:'蓝',unit:'米',cost:'1.00',currency:'USD',sourceDevId:'',sourceVersionId:''}}},ctx).id!;
  const lines=[{productId,sourceDevId:'',sourceVersionId:'',name:'面料1',style:'P-TT-1',specification:'150cm',qty:'10',unit:'米',price:'2.50',cost:'1.00'}];
  const id=run(s,{type:'market.quotation.save',payload:{input:{customerId:s.customers[0].id,currency:'USD',season:'AW26',validUntil:'2026-11-30',...terms,lines}}},ctx).id!;
  run(s,{type:'market.quotation.submit',payload:{id}},ctx);if(s.market.quotations.find(q=>q.id===id)!.approval?.status==='pending')run(s,{type:'market.quotation.decide',payload:{id,decision:'approved',note:'ok'}},{...ctx,actorId:'leader'});
  run(s,{type:'market.quotation.status',payload:{id,status:'Sent',evidence:'交付'}},ctx);run(s,{type:'market.quotation.status',payload:{id,status:'Accepted',evidence:'接受'}},ctx);
  return id;
};
const convert=(s:MistState,ctx:MistContext,id:string)=>{const {state,result}=applyMistCommand(s,{type:'market.quotation.convert',payload:{id,type:'fabric',due:'2026-12-15',ownerId:'sales'}} as never,ctx);return state.orders.find(o=>o.id===(result as {orderId:string}).orderId)!;};

describe('报价条款承接到订单合同',()=>{
 it('splits the Incoterm code from the named place and maps preset payment terms',()=>{
  expect(quotationContract({deliveryTerms:'FOB 上海',paymentTerms:'T/T 30% 定金，70% 见提单副本'})).toEqual({incoterm:'FOB',deliveryPlace:'上海',paymentNote:'T/T 30% 定金，70% 见提单副本',paymentMethod:'TT',depositPercent:30,preShipmentPercent:30});
  expect(quotationContract({deliveryTerms:'cif, Hamburg',paymentTerms:'L/C 即期'})).toEqual({incoterm:'CIF',deliveryPlace:'Hamburg',paymentNote:'L/C 即期',paymentMethod:'LC',depositPercent:0,preShipmentPercent:null});
  expect(quotationContract({deliveryTerms:'EXW',paymentTerms:''})).toEqual({incoterm:'EXW',deliveryPlace:''});
 });
 it('keeps unrecognised wording as written instead of guessing a payment method',()=>{
  expect(quotationContract({deliveryTerms:'按合同约定',paymentTerms:'验货后 15 天电汇'})).toEqual({incoterm:'按合同约定',paymentNote:'验货后 15 天电汇'});
  expect(paymentTermContract('客户自定条款')).toEqual({paymentNote:'客户自定条款'});
 });
 it('only maps presets to values the order contract accepts',()=>{
  for(const term of CUSTOMER_PAYMENT_TERMS){const c=paymentTermContract(term.value);expect(['TT','LC','OA','OTHER']).toContain(c.paymentMethod);if(c.paymentMethod==='TT')expect(c.preShipmentPercent).toBeGreaterThanOrEqual(c.depositPercent!);}
 });
 it('fills the converted order contract draft from the accepted quotation',()=>{
  const {ctx,s}=setup(),id=accepted(s,ctx,{deliveryTerms:'FOB 宁波',paymentTerms:'T/T 30% 定金，70% 发货前付清'});
  const order=convert(s,ctx,id);
  expect(order.governance?.status).toBe('draft');
  expect(order.governance?.contract).toMatchObject({kind:'external',incoterm:'FOB',deliveryPlace:'宁波',paymentNote:'T/T 30% 定金，70% 发货前付清',paymentMethod:'TT',depositPercent:30,preShipmentPercent:100});
 });
 it('carries free-text quotation terms over as written',()=>{
  const {ctx,s}=setup(),id=accepted(s,ctx,{deliveryTerms:'CIF Felixstowe',paymentTerms:'OA，发票日起 45 天'});
  expect(convert(s,ctx,id).governance?.contract).toMatchObject({incoterm:'CIF',deliveryPlace:'Felixstowe',paymentNote:'OA，发票日起 45 天',paymentMethod:'TT',depositPercent:null});
 });
});
