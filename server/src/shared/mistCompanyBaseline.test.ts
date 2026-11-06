import {describe,expect,it,vi} from 'vitest';
import {getDefaultScopeListForRole,SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {PAYMENT_APPROVAL_SCOPES} from './mistPayables';
import {mistApprovalAuthority} from '../mist/context';
import {MIST_COMPANY_PAYMENT_GRANTS,MIST_COMPANY_PAYMENT_SIGNER_SCOPES,type MistCompanyRosterKey} from './mistCompanyBaseline';
import {createMistCompanyBaseline,mistCompanyBaselineMetrics,mistCompanyVisibleTextIssues,MIST_COMPANY_BASELINE_VERSION,MIST_COMPANY_DATASET,MIST_COMPANY_PROFILE,MIST_COMPANY_WORKSPACE_NAME,type MistCompanyRoster} from './mistCompanyBaseline';
import {renderDemoFile} from './mistDemoFiles';
import { completeCompanyProduct } from './mistCompanyCatalog';
import { PRODUCT_SPEC_FIELDS } from './mistMarket';

// 服务端重建审批人：账号权限 = 岗位默认权限 + 种子写入的个人授权；部门路由同种子脚本（业务员 → 所在事业部经理，总领导 → 总经理）。
const auth=vi.hoisted(()=>({permissions:new Map<string,string[]>(),head:new Map<string,string>(),leader:''}));
vi.mock('../approvals/approvalRoutingService',()=>({createApprovalRoutingService:()=>({
 resolveReviewerByDepartment:async(id:string)=>{const reviewerId=auth.head.get(id);if(!reviewerId)throw Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'});return{reviewerId};},
 resolveClaimLeader:async(id:string)=>{if(!auth.leader||auth.leader===id)throw Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'});return{reviewerId:auth.leader};},
})}));
vi.mock('../auth/tokenHelpers',()=>({
 loadUserWithRoles:async(_db:unknown,id:string)=>auth.permissions.has(id)?{id,status:'active',deletedAt:null}:null,
 buildLoadedAuthTokenPayload:async(_db:unknown,user:{id:string})=>({userId:user.id,roles:[],departmentIds:[],permissions:[...auth.permissions.get(user.id)!],authorizationLoaded:true}),
}));
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
 it('历史付款按分档由对应的人分别签：金额档由事业部经理，首笔付款加签由总经理',()=>{const{state,failures}=company();expect(failures).toEqual([]);const requests=state.payables!.requests!;expect(requests.length).toBe(6);for(const r of requests){const head=r.requesterId===roster.fabricSales.id?roster.fabricManager.id:roster.garmentManager.id;expect(r.state).toBe('paid');expect(r.approvals!.find(a=>a.level==='pay_gt5')!.actorId).toBe(head);if(r.tier!.firstPayment)expect(r.approvals!.find(a=>a.level==='pay_new_supplier')!.actorId).toBe(roster.owner.id);expect(new Set(r.approvals!.map(a=>a.actorId)).size).toBe(r.approvals!.length);}expect(requests.filter(r=>r.tier!.firstPayment)).toHaveLength(2);});
 it('历史付款每一级签字人都持有该级档位，并与服务端按真实权限重建的审批人一致',async()=>{
  // 种子账号岗位：总经理为公司管理员，事业部经理为业务主管岗，其余按业务 / 财务 / QC / 后勤岗。
  const roles:Record<MistCompanyRosterKey,string>={owner:SYSTEM_ROLE_IDS.ADMIN,fabricManager:SYSTEM_ROLE_IDS.SALES_MANAGER,garmentManager:SYSTEM_ROLE_IDS.SALES_MANAGER,fabricSales:SYSTEM_ROLE_IDS.SALES,garmentSales:SYSTEM_ROLE_IDS.SALES,finance:SYSTEM_ROLE_IDS.FINANCE,fabricQc:SYSTEM_ROLE_IDS.QC,garmentQc:SYSTEM_ROLE_IDS.QC,logistics:SYSTEM_ROLE_IDS.LOGISTICS};
  const keys=Object.keys(roles) as MistCompanyRosterKey[],keyOf=(id:string)=>keys.find(k=>roster[k].id===id)!;
  const load=(grants:typeof MIST_COMPANY_PAYMENT_GRANTS)=>{auth.permissions.clear();for(const k of keys)auth.permissions.set(roster[k].id,[...getDefaultScopeListForRole(roles[k] as any),...(grants[k]||[])]);};
  auth.head.clear();auth.head.set(roster.fabricSales.id,roster.fabricManager.id);auth.head.set(roster.garmentSales.id,roster.garmentManager.id);auth.leader=roster.owner.id;
  load(MIST_COMPANY_PAYMENT_GRANTS);
  // 种子脚本写入前核对的签字人权限，在岗位 + 个人授权下确实成立。
  for(const k of Object.keys(MIST_COMPANY_PAYMENT_SIGNER_SCOPES) as MistCompanyRosterKey[])for(const scope of MIST_COMPANY_PAYMENT_SIGNER_SCOPES[k]!)expect(auth.permissions.get(roster[k].id),`${k} ${scope}`).toContain(scope);
  const{state,failures}=company();expect(failures).toEqual([]);
  const members=keys.map(k=>roster[k].id);
  for(const r of state.payables!.requests!){
   for(const a of r.approvals!){expect(auth.permissions.get(a.actorId),`${r.code} ${a.level} ${keyOf(a.actorId)}`).toEqual(expect.arrayContaining(['finance:payment_request:approve',PAYMENT_APPROVAL_SCOPES[a.level]]));}
   const rebuilt=(await mistApprovalAuthority({}, {userId:r.requesterId,roles:[],permissions:[],departmentIds:[]} as any,'payable.request.decide',members)) as any;
   for(const l of r.tier!.levels)expect([...rebuilt.paymentTierReviewerIds[l.level],...(rebuilt.paymentTierAlternateIds?.[l.level]||[])],`${r.code} ${l.level}`).toEqual(l.reviewerIds);
   for(const a of r.approvals!)expect(rebuilt.paymentTierReviewerIds[a.level]).toContain(a.actorId);
  }
  // 没有个人授权时，事业部经理按岗位不持 >5 万档：服务端会把金额档上抬给总经理，与种子签字对不上——授权是必需的。
  load({});
  const r=state.payables!.requests!.find(x=>x.tier!.firstPayment)!;
  expect(((await mistApprovalAuthority({}, {userId:r.requesterId,roles:[],permissions:[],departmentIds:[]} as any,'payable.request.decide',members)) as any).paymentTierReviewerIds.pay_gt5).toEqual([roster.owner.id]);
 });
 it('把所有业务负责人、审批人与成员映射到公司账号',()=>{const{state}=company(),json=JSON.stringify(state);for(const id of ['demo-sales','demo-buyer','demo-reviewer','demo-finance','demo-qc','demo-warehouse'])expect(json).not.toContain(id);expect(state.memberIds).toHaveLength(8);expect(new Set(state.memberGroups?.flatMap(row=>row.groups))).toEqual(new Set(['fabric','garment']));expect(state.orders.every(row=>Object.values(roster).some(person=>person.id===row.ownerId))).toBe(true);});
 it('界面可见字段和生成单据没有数据造作提示',()=>{const{state}=company();expect(mistCompanyVisibleTextIssues(state)).toEqual([]);for(const file of state.files){const bytes=Buffer.from(renderDemoFile(state,file)),text=bytes.toString('latin1');expect(text.startsWith('%PDF-1.4')).toBe(true);expect(text).toContain('Mistweave Textile');expect(text).not.toMatch(/demo workspace|sample document|not a real|\bDEMO\b/i);expect(file.name).not.toMatch(/模拟|演示|示例|\bDEMO\b/i);}});
 it('保留可处理的不同经营状态，而不是把全部记录做成已完成',()=>{const{state}=company();expect(new Set(state.market.quotations.map(row=>row.status)).size).toBeGreaterThanOrEqual(4);expect(new Set(state.crm.opportunities.map(row=>row.stage)).size).toBeGreaterThanOrEqual(5);expect(new Set(state.orders.map(row=>row.state)).size).toBeGreaterThanOrEqual(3);expect(state.platform.claims.some(row=>row.state==='Registered')).toBe(true);expect(state.platform.claims.some(row=>row.state==='Processing')).toBe(true);expect(state.tasks.some(row=>!row.done)).toBe(true);expect(state.notifications.some(row=>row.readAt===null)).toBe(true);});
});
