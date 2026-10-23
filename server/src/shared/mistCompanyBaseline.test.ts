import {describe,expect,it} from 'vitest';
import {createMistCompanyBaseline,mistCompanyBaselineMetrics,mistCompanyVisibleTextIssues,MIST_COMPANY_BASELINE_VERSION,MIST_COMPANY_DATASET,MIST_COMPANY_PROFILE,MIST_COMPANY_WORKSPACE_NAME,type MistCompanyRoster} from './mistCompanyBaseline';
import {renderDemoFile} from './mistDemoFiles';
import { completeCompanyProduct } from './mistCompanyCatalog';
import { PRODUCT_SPEC_FIELDS } from './mistMarket';

const roster:MistCompanyRoster={
 owner:{id:'company-owner',name:'沈霁'},fabricManager:{id:'company-fabric-manager',name:'俞宁'},garmentManager:{id:'company-garment-manager',name:'陆衡'},fabricSales:{id:'company-fabric-sales',name:'沈禾'},garmentSales:{id:'company-garment-sales',name:'林澈'},finance:{id:'company-finance',name:'林舒'},fabricQc:{id:'company-fabric-qc',name:'唐岚'},garmentQc:{id:'company-garment-qc',name:'许言'},logistics:{id:'company-logistics',name:'陈晓'},
};
function company(){let seq=0,failures:unknown[]=[];const state=createMistCompanyBaseline({id:()=>`company-${++seq}`,now:'2026-10-19T04:00:00.000Z',actorId:roster.owner.id,actorName:roster.owner.name},roster,rows=>{failures=rows;});return{state,failures};}

describe('持续经营公司基线',()=>{
 it('fills catalog omissions without overwriting edited specifications or business identity',()=>{
  const {state}=company();
  for(const product of state.market.products){
   expect(product.specification).not.toBe('');expect(product.color).not.toBe('');
   for(const field of PRODUCT_SPEC_FIELDS[product.category])expect(product.specs?.[field.key],product.sku+' '+field.key).toBeTruthy();
   expect(completeCompanyProduct(product)).toEqual(product);
  }
  const original={...state.market.products[0],specification:'客户签认规格',cost:'123.45',fileIds:['private-photo']};
  expect(completeCompanyProduct(original)).toMatchObject(original);
 });
 it('历史出运的数量、应收核销、供应商结算和结汇逐单守恒',()=>{
  const {state,failures}=company();expect(failures).toEqual([]);
  const historical=state.orders.filter(order=>order.governance?.contract.poNumber.startsWith('CP-2026'));
  expect(historical).toHaveLength(6);
  for(const order of historical){
   const shipments=state.fulfillment.shipments.filter(s=>s.lines.some(l=>l.orderId===order.id));
   expect(shipments.every(s=>s.state==='departed')).toBe(true);
   expect(shipments.flatMap(s=>s.lines).reduce((n,l)=>n+l.quantity,0)).toBe(order.qty);
   const invoices=state.invoices.filter(i=>i.orderId===order.id);
   expect(invoices.reduce((n,i)=>n+Math.round(i.amount*100),0)).toBe(Math.round(order.amount*100));
   expect(invoices.every(i=>i.open===0)).toBe(true);
   const purchase=state.fulfillment.purchases.find(p=>p.orderId===order.id)!;
   const bill=state.payables!.bills.find(b=>b.lines.some(l=>l.purchaseId===purchase.id))!;
   expect(state.payables!.allocations.filter(a=>a.billId===bill.id).reduce((n,a)=>n+Math.round(a.amount*100),0)).toBe(Math.round(bill.amount*100));
   const fx=state.fxRecords!.find(f=>f.ref==='FX-'+order.code)!;expect(fx.amount).toBe(order.amount);
   expect(order.createdAt<shipments[0].departedAt!).toBe(true);
   const poFile=state.files.find(f=>order.governance!.contract.confirmationFileIds.includes(f.id))!;
   expect(poFile.storageKey).toContain(encodeURIComponent(order.id));
  }
 });
 it('用同一版本覆盖完整经营主档和跨岗位链路',()=>{const{state,failures}=company(),metrics=mistCompanyBaselineMetrics(state);expect(failures).toEqual([]);expect(state.settings).toMatchObject({workspaceName:MIST_COMPANY_WORKSPACE_NAME,companyProfile:MIST_COMPANY_PROFILE,companyBaseline:{version:MIST_COMPANY_BASELINE_VERSION,dataset:MIST_COMPANY_DATASET}});expect(metrics).toMatchObject({customers:9,suppliers:12,products:20,quotations:18,developments:12,orders:22,purchases:11,shipments:7,invoices:11,receipts:20,claims:3,employees:13,bankAccounts:3,files:55});expect(metrics.relations).toBeGreaterThanOrEqual(22);expect(metrics.opportunities).toBeGreaterThanOrEqual(10);expect(metrics.followUps).toBeGreaterThanOrEqual(8);expect(metrics.events).toBeGreaterThan(310);});
 it('把所有业务负责人、审批人与成员映射到公司账号',()=>{const{state}=company(),json=JSON.stringify(state);for(const id of ['demo-sales','demo-buyer','demo-reviewer','demo-finance','demo-qc','demo-warehouse'])expect(json).not.toContain(id);expect(state.memberIds).toHaveLength(8);expect(new Set(state.memberGroups?.flatMap(row=>row.groups))).toEqual(new Set(['fabric','garment']));expect(state.orders.every(row=>Object.values(roster).some(person=>person.id===row.ownerId))).toBe(true);});
 it('界面可见字段和生成单据没有数据造作提示',()=>{const{state}=company();expect(mistCompanyVisibleTextIssues(state)).toEqual([]);for(const file of state.files){const bytes=Buffer.from(renderDemoFile(state,file)),text=bytes.toString('latin1');expect(text.startsWith('%PDF-1.4')).toBe(true);expect(text).toContain('Mistweave Textile');expect(text).not.toMatch(/demo workspace|sample document|not a real|\bDEMO\b/i);expect(file.name).not.toMatch(/模拟|演示|示例|\bDEMO\b/i);}});
 it('保留可处理的不同经营状态，而不是把全部记录做成已完成',()=>{const{state}=company();expect(new Set(state.market.quotations.map(row=>row.status)).size).toBeGreaterThanOrEqual(4);expect(new Set(state.crm.opportunities.map(row=>row.stage)).size).toBeGreaterThanOrEqual(5);expect(new Set(state.orders.map(row=>row.state)).size).toBeGreaterThanOrEqual(3);expect(state.platform.claims.some(row=>row.state==='Registered')).toBe(true);expect(state.platform.claims.some(row=>row.state==='Processing')).toBe(true);expect(state.tasks.some(row=>!row.done)).toBe(true);expect(state.notifications.some(row=>row.readAt===null)).toBe(true);});
});
