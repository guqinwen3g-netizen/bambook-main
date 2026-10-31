import {expect,it} from 'vitest';
import {materialDeliveryFixture} from '../mist/__tests__/materialDelivery';

function fixture(country='CN'){
 const f=materialDeliveryFixture(20),supplier=f.state.market.suppliers.find(s=>s.id==='mill')!;supplier.country=country;
 const save=(currency:string)=>f.run({type:'fulfillment.procurement.save',payload:{...f.source,kind:'finished',supplierId:supplier.id,supplier:supplier.name,description:'采购币种验收',quantity:1,unit:'米',price:10,currency,due:'2026-11-20',terms:'验收后付款',destination:'本仓',note:'',fileIds:[]}}).id!;
 return{f,supplier,save};
}
it('enforces the same domestic CNY rule on API drafts as the procurement form without mutating failed input',()=>{
 const {f,save}=fixture(),before=structuredClone(f.state);
 expect(()=>save('USD')).toThrow('人民币');expect(f.state).toEqual(before);
 const id=save('cny');expect(f.state.fulfillment.purchases.find(p=>p.id===id)?.currency).toBe('CNY');
});
it.each(['IT','中国香港',''])('does not guess a mainland supplier from country %s',country=>{
 const {f,save}=fixture(country),id=save('USD');expect(f.state.fulfillment.purchases.find(p=>p.id===id)?.currency).toBe('USD');
});
it('rechecks supplier country at submission and approval while allowing a reviewer to return an invalid draft',()=>{
 const {f,save}=fixture('IT'),id=save('USD');f.state.market.suppliers.find(s=>s.id==='mill')!.country='CN';
 expect(()=>f.run({type:'fulfillment.procurement.submit',payload:{id}})).toThrow('人民币');
 f.state.market.suppliers.find(s=>s.id==='mill')!.country='IT';f.run({type:'fulfillment.procurement.submit',payload:{id}});
 f.state.market.suppliers.find(s=>s.id==='mill')!.country='CN';
 expect(()=>f.run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'审批'}} ,'reviewer')).toThrow('人民币');
 f.run({type:'fulfillment.procurement.decide',payload:{id,decision:'rejected',note:'退回核对币种'}},'reviewer');
 expect(f.state.fulfillment.purchases.find(p=>p.id===id)?.state).toBe('rejected');
});
