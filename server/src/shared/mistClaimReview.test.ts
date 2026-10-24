import {it,expect} from 'vitest';
import {claimReviewDisplay} from './mistClaimReview';
it('presents a submitted return as business facts without exposing internal identifiers or changing the frozen source',()=>{
 const frozen=JSON.stringify({case:'CLM-EXAMPLE-1',claimId:'private-claim-id',kind:'ReturnRefund',customerName:'客户',order:'SO-1',orderId:'private-order-id',invoice:'CI-1',invoiceId:'private-invoice-id',problem:'两件侧缝开线',amount:25,currency:'USD',quantity:2,unit:'件',destination:'Scrap',basis:'按原票价退款',goodsSource:{style:'ST-01',name:'外套',unitPrice:12.5,productionId:'private-production-id',sourceQuantity:100}});
 const display=claimReviewDisplay(frozen);expect(display.title).toBe('CLM-EXAMPLE-1 · 退货退款');
 expect(display.details).toEqual(expect.arrayContaining([{label:'商品',value:'ST-01 · 外套'},{label:'原票单价',value:'12.50 USD'},{label:'数量',value:'2 件'},{label:'金额',value:'25.00 USD'},{label:'退回去向',value:'报废'},{label:'来源订单',value:'SO-1'},{label:'来源发票',value:'CI-1'},{label:'处置依据',value:'按原票价退款'}]));
 expect(JSON.stringify(display)).not.toMatch(/private-|schemaVersion|ReturnRefund|Scrap/);expect(JSON.parse(frozen).goodsSource.productionId).toBe('private-production-id');
});
it('keeps an allowance monetary and a repair physical, without suggesting a direct repair refund',()=>{
 const allowance=claimReviewDisplay(JSON.stringify({case:'C',kind:'Allowance',amount:20,currency:'EUR',quantity:0,destination:'',basis:'确认折让'}));expect(allowance.details.find(d=>d.label==='金额')?.value).toBe('20.00 EUR');expect(allowance.details.some(d=>d.label==='数量')).toBe(false);
 const repair=claimReviewDisplay(JSON.stringify({case:'C',kind:'Repair',amount:0,currency:'EUR',quantity:1,unit:'件',destination:'Repair'}));expect(repair.title).toBe('C · 返修');expect(repair.details.some(d=>d.label==='金额')).toBe(false);expect(repair.details.find(d=>d.label==='退回去向')?.value).toBe('返修');
});
it.each(['not JSON','null','[]','{"kind":"unknown"}'])('shows an actionable unavailable state without raw serialization: %s',snapshot=>{const view=claimReviewDisplay(snapshot);expect(view.details).toEqual([{label:'审批内容',value:'资料无法读取，请打开原业务核对'}]);});
