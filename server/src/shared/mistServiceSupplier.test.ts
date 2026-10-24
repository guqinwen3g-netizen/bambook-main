import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,type MistCommand,type MistContext,type DevelopmentValues} from './mistWorkspace';
import {isServiceSupplier,productionSupplierUnavailableReason,supplierUnavailableReason} from './mistSupplierStatus';

function fixture(){
 let n=0;const ctx:MistContext={id:()=>`service-${++n}`,now:'2026-10-18T02:00:00Z',actorId:'demo-sales',actorName:'业务员'};
 let state=createMistState(ctx,'demo');
 const run=(type:string,payload:Record<string,unknown>)=>{const result=applyMistCommand(state,{type,payload} as MistCommand,ctx);state=result.state;return result.result;};
 const input={code:'LOG-001',name:'浦江物流',type:'服务商',country:'中国',address:'上海',capabilities:'服装、面料出口货运及报关',capacity:999,capacityUnit:'米/月',leadDays:30};
 const supplierId=run('market.supplier.save',{input}).id!;
 return {ctx,input,supplierId,run,get state(){return state;}};
}
describe('service supplier boundaries',()=>{
 it('stores service details without manufacturing capacity and retains identity, contacts and status on edit',()=>{
  const f=fixture(),row=f.state.market.suppliers.find(s=>s.id===f.supplierId)!;
  expect(row).toMatchObject({type:'服务商',address:'上海',capabilities:f.input.capabilities,capacity:0,capacityUnit:'',leadDays:0});
  expect(isServiceSupplier(row)).toBe(true);expect(supplierUnavailableReason(row,'2026-10-18')).toBe('');
  expect(productionSupplierUnavailableReason(row,'2026-10-18')).toContain('服务商');
  f.run('market.contact.save',{kind:'supplier',parentId:row.id,name:'物流联系人',role:'业务',email:'',phone:'',primary:true});
  const before=structuredClone(f.state.market.suppliers.find(s=>s.id===row.id)!);
  f.run('market.supplier.save',{id:row.id,input:{...f.input,name:'浦江货运',capacity:undefined,capacityUnit:undefined,leadDays:undefined}});
  expect(f.state.market.suppliers.find(s=>s.id===row.id)).toMatchObject({contacts:before.contacts,status:before.status,createdAt:before.createdAt,capacity:0,capacityUnit:'',leadDays:0});
  expect(f.state.market.relations.find(r=>r.supplierId===row.id)?.name).toBe('浦江货运');
  const unchanged=structuredClone(f.state);
  expect(()=>f.run('market.supplier.save',{input:{...f.input,code:'EMPTY',capabilities:''}})).toThrow('服务内容');expect(f.state).toEqual(unchanged);
  expect(()=>f.run('market.supplier.save',{input:{...f.input,code:'FACTORY',type:'织造',capacityUnit:''}})).toThrow('产能单位');
 });
 it('accepts service supplier expense payables without adding a second production cost',()=>{
  const f=fixture(),shipment=f.state.fulfillment.shipments[0];
  const id=f.run('cost.expense.register',{category:'freight',vendor:f.input.name,ref:'AIR-001',date:'2026-10-18',currency:'USD',amount:65,scope:'shipment',shipmentId:shipment.id,basis:'value'}).id!;
  const expenses=structuredClone(f.state.orderCosts.expenses),purchases=structuredClone(f.state.fulfillment.purchases);
  const payableId=f.run('cost.expense.payable',{id,supplierId:f.supplierId,due:'2026-10-18',taxAmount:'0'}).id!;
  expect(f.state.payables.bills.find(b=>b.id===payableId)).toMatchObject({supplierId:f.supplierId,amount:65,currency:'USD',expenseId:id,lines:[]});
  expect(f.state.orderCosts.expenses).toHaveLength(expenses.length);expect(f.state.fulfillment.purchases).toEqual(purchases);
 });
 it('rejects service providers in physical procurement, product suppliers and sourcing invitations without mutation',()=>{
  const f=fixture(),order=f.state.orders.find(o=>o.code==='SO-G-2026-018')!,line=f.state.orderLines.find(l=>l.orderId===order.id)!;
  const before=structuredClone(f.state);
  const purchase={orderId:order.id,lineId:line.id,kind:'processing',supplierId:f.supplierId,description:'大衣加工',quantity:1,unit:'件',price:10,currency:'CNY',due:'2026-11-20',terms:'',destination:'上海',note:'',fileIds:[]};
  expect(()=>f.run('fulfillment.procurement.save',purchase)).toThrow('服务商');
  expect(()=>f.run('rfq.save',{input:{...purchase,deadline:'2026-10-22',supplierIds:[f.supplierId,f.state.market.suppliers.find(s=>s.name==='江南成衣')!.id]}})).toThrow('服务商');
  const product=f.state.market.products[0];
  expect(()=>f.run('market.product.save',{input:{...product,sku:'SERVICE-GOODS',supplierId:f.supplierId}})).toThrow('服务商');
  expect(f.state).toEqual(before);
 });
 it('rejects service providers as development factories even when their services mention garments or fabrics',()=>{
  const f=fixture(),before=structuredClone(f.state);
  const values:DevelopmentValues={initiator:'customer',requestType:'replicate',name:'羊毛大衣',customer:f.state.customers[0].id,style:'ST-1',season:'AW',category:'大衣',kind:'new',fabric:'羊毛',color:'灰',target:'',sizeBase:'M',goal:'按来样复刻',factories:[f.supplierId],due:'2026-10-30',collaborators:[],sampleQuantity:1};
  expect(()=>f.run('development.submit',{values,fileIds:[]})).toThrow('服务商');expect(f.state).toEqual(before);
 });
});
