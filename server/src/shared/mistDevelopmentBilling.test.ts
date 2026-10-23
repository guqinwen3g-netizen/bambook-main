import {describe,it,expect} from 'vitest';
import { withTestFactories } from './__tests__/utils/devFactories';
import {applyMistCommand,createMistState,mistCommandPermission,type DevelopmentValues,type MistContext,type MistCommand} from './mistWorkspace';
import {emptyFabricRequirements} from './mistDevelopmentDomain';
import {developmentVersionSamples} from './mistDevelopmentSamples';
import {developmentClosure} from './mistDevelopmentRounds';
import {developmentBillingStage,developmentFeeSummary,unbilledDevelopmentCharges} from './mistDevelopmentBilling';

/** BB-DEV-9 开发费用 → 财务开票 → 收款核销 → 最终结案。 */
function fixture(charged:boolean){
 let n=0;const ctx:MistContext={id:()=>`bl-${++n}`,now:'2026-10-16T09:00:00Z',actorName:'测试业务员',actorId:'test-sales'};let state=withTestFactories(createMistState(ctx,'empty'));
 state.customers.push({id:'c',name:'测试客户',code:'C',country:'',city:'',industry:'',owner:'',grade:'',currency:'EUR',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 state.market.suppliers.push({id:'f',code:'F',name:'测试面料厂',type:'面料工厂',capabilities:'织造',status:'active',country:'',address:'',capacity:0,capacityUnit:'米',leadDays:0,blockReason:'',contacts:[],fileIds:[],note:'',createdAt:ctx.now,updatedAt:ctx.now});
 const values:DevelopmentValues={domain:'fabric',name:'测试斜纹',customer:'c',style:'',season:'AW',category:'斜纹',kind:'new',fabric:'目标',color:'蓝灰',target:'2.50',targetCurrency:'EUR',targetUnit:'米',sizeBase:'',goal:'手感',factories:['测试面料厂'],due:'2026-11-01',collaborators:[],sampleQuantity:3,sampleForm:'色样',sampleUnit:'份',charged,fabricRequirements:{...emptyFabricRequirements(),composition:'羊毛:100'}} as DevelopmentValues;
 const run=(command:MistCommand)=>{const r=applyMistCommand(state,command,ctx);state=r.state;return r.result as any;};
 const ids=run({type:'development.submit',payload:{values,fileIds:[]}}) as {devId:string;versionId:string};
 const at={devId:ids.devId,versionId:ids.versionId};
 run({type:'development.recordSample',payload:{...at,sample:'R1-A-实物',quantity:5,form:'米样',unit:'米',location:'架A',returnedAt:ctx.now}});
 run({type:'development.recordQc',payload:{...at,domain:'fabric',qc:{result:'pass',reviewer:'QC',reviewedAt:ctx.now,report:'QC-1',opinion:'通过'}}});
 const dev=()=>state.devs.find(d=>d.id===at.devId)!;
 const samples=()=>developmentVersionSamples(state,state.versions.find(v=>v.id===at.versionId)!);
 const unchanged=(fn:()=>unknown,pattern:RegExp)=>{const before=JSON.stringify(state);expect(fn).toThrow(pattern);expect(JSON.stringify(state)).toBe(before);};
 return{ctx,run,at,dev,samples,unchanged,get state(){return state;}};
}
const confirm=(f:ReturnType<typeof fixture>)=>f.run({type:'development.confirm',payload:{...f.at,result:'approved',confirmer:'客户',organization:'测试客户',confirmedAt:f.ctx.now,basis:'邮件',originalText:'OK'}});


function charge(f:ReturnType<typeof fixture>,amount=300,currency='USD') {return f.run({type:'development.charge.add',payload:{devId:f.at.devId,versionIds:[f.at.versionId],description:'样品开发费',amount,currency,evidence:'客户确认收费'}}).id as string;}
function file(f:ReturnType<typeof fixture>){if(!f.state.files.some(row=>row.id==='invoice-file'))f.state.files.push({id:'invoice-file',name:'invoice.pdf',mimeType:'application/pdf',size:5,storageKey:'test/invoice',createdAt:f.ctx.now});}
function invoice(f:ReturnType<typeof fixture>,chargeIds:string[],number='DI-TEST-1') {return f.run({type:'development.billing.issue',payload:{devId:f.at.devId,chargeIds,number,due:'2026-10-20',fileIds:['invoice-file']}}).id as string;}
describe('development costs and customer billing',()=>{
 it('records company expenses for free development without creating customer charges',()=>{
  const f=fixture(false),sample=f.samples()[0];
  f.run({type:'development.fee.recordMaking',payload:{devId:f.at.devId,sampleId:sample.id,amount:120,currency:'EUR'}});
  f.run({type:'development.expense.add',payload:{devId:f.at.devId,amount:28.5,currency:'CNY',description:'到付快递',date:'2026-10-16'}});
  expect(developmentFeeSummary(f.state,f.dev()).totals).toEqual([{currency:'CNY',amount:28.5},{currency:'EUR',amount:120}]);
  expect(f.state.invoices).toEqual([]);expect(f.dev().billing?.charges).toBeUndefined();f.unchanged(()=>charge(f),/没有对客收费/);
 });
 it('bills selected charges independently of cost and waits for financial confirmation',()=>{
  const f=fixture(true);confirm(f);const businessState=f.dev().state;file(f);
  f.run({type:'development.fee.recordMaking',payload:{devId:f.at.devId,sampleId:f.samples()[0].id,amount:900,currency:'CNY'}});
  const a=charge(f,200),b=charge(f,100),id=invoice(f,[a,b]);
  expect(f.state.invoices.find(row=>row.id===id)).toMatchObject({amount:300,currency:'USD',financeStatus:'pending',open:0,developmentChargeIds:[a,b],fileIds:['invoice-file']});
  expect(f.dev().billing!.invoices![0].lines.map(row=>row.amount)).toEqual([200,100]);f.unchanged(()=>invoice(f,[a],'DI-2'),/已开票/);
  f.run({type:'finance.importReceipts',payload:{receipts:[{date:'2026-10-16',payer:f.dev().customer,amount:300,currency:'USD',ref:'DEV-PAY'}]}});
  const receiptId=f.state.receipts[0].id;f.unchanged(()=>f.run({type:'finance.reconcile',payload:{receiptId,invoiceId:id}}),/待财务|未确认|有效/);
  f.run({type:'finance.receivable.confirm',payload:{invoiceId:id}});expect(f.state.invoices.find(row=>row.id===id)?.open).toBe(300);
  f.run({type:'finance.reconcile',payload:{receiptId,invoiceId:id}});expect(developmentBillingStage(f.state,f.dev())?.label).toBe('已结清');
  expect(f.dev().state).toBe(businessState);expect(developmentClosure(f.state,f.dev())).toBeNull();
  f.run({type:'finance.allocation.reverse',payload:{allocationId:f.state.allocations[0].id,reason:'误分配'}});expect(f.state.invoices.find(row=>row.id===id)?.open).toBe(300);expect(f.dev().state).toBe(businessState);
 });
 it('preserves unbilled items when only some charges are invoiced',()=>{const f=fixture(true);file(f);const a=charge(f,200),b=charge(f,100);invoice(f,[a]);expect(unbilledDevelopmentCharges(f.state,f.dev()).map(row=>row.id)).toEqual([b]);invoice(f,[b],'DI-2');expect(unbilledDevelopmentCharges(f.state,f.dev())).toEqual([]);});
 it('rejects duplicate, mixed-currency and foreign lines atomically',()=>{const f=fixture(true);file(f);const a=charge(f),b=charge(f,100,'EUR');f.unchanged(()=>invoice(f,[a,a]),/重复/);f.unchanged(()=>invoice(f,[a,b]),/不同币种/);f.unchanged(()=>invoice(f,['foreign']),/不属于|已开票/);f.unchanged(()=>f.run({type:'development.charge.add',payload:{devId:f.at.devId,versionIds:['foreign'],description:'费',amount:1,currency:'USD',evidence:'依据'}}),/本案/);});
 it('keeps a rejected invoice and releases its charges for corrected issuance',()=>{const f=fixture(true);file(f);const a=charge(f),id=invoice(f,[a]);f.run({type:'finance.receivable.reject',payload:{invoiceId:id,reason:'抬头需更正'}});expect(f.state.invoices.find(row=>row.id===id)).toMatchObject({amount:300,financeStatus:'rejected',voidReason:'财务驳回：抬头需更正'});expect(unbilledDevelopmentCharges(f.state,f.dev()).map(row=>row.id)).toEqual([a]);invoice(f,[a],'DI-2');expect(f.state.invoices).toHaveLength(2);});
 it('withdraws the old cost request with history and forbids financial staff creating development invoices',()=>{const f=fixture(true);f.dev().billing={makingFees:[],request:{id:'old',requestedAt:f.ctx.now,requestedBy:'业务',billTo:'客户',lines:[],totals:[{amount:1020,currency:'CNY'}],state:'pending',invoiceIds:[],taskId:'task'}};f.state.tasks.push({id:'task',title:'旧任务',due:'2026-10-16',done:false} as any);f.unchanged(()=>f.run({type:'finance.developmentInvoice.issue',payload:{devId:f.at.devId,requestId:'old',due:'2026-10-20'}}),/业务员/);f.run({type:'development.billing.withdraw',payload:{devId:f.at.devId,reason:'支出不能当客户收费'}});expect(f.dev().billing!.request).toBeUndefined();expect(f.dev().billing!.requestHistory?.[0].totals).toEqual([{amount:1020,currency:'CNY'}]);expect(f.state.tasks.find(row=>row.id==='task')?.done).toBe(true);expect(f.state.invoices).toEqual([]);});
 it('requires an original file and a unique invoice number',()=>{const f=fixture(true),a=charge(f);f.unchanged(()=>invoice(f,[a]),/附件不存在|文件不存在|文件不可用/);file(f);f.unchanged(()=>f.run({type:'development.billing.issue',payload:{devId:f.at.devId,chargeIds:[a],number:'DI-1',due:'2026-10-20',fileIds:[]}}),/原件/);invoice(f,[a]);const b=charge(f);f.unchanged(()=>invoice(f,[b]),/编号已使用/);});
 it('routes customer charges and business issuance to product permissions',()=>{expect(mistCommandPermission({type:'development.charge.add',payload:{} as any})).toBe('products:write');expect(mistCommandPermission({type:'development.billing.issue',payload:{} as any})).toBe('products:write');expect(mistCommandPermission({type:'finance.receivable.confirm',payload:{} as any})).toBe('invoices:write');});
 it('only allows unbilled charges to be voided and retains the reason',()=>{
  const f=fixture(true);file(f);const used=charge(f),open=charge(f,20);invoice(f,[used]);
  f.unchanged(()=>f.run({type:'development.charge.void',payload:{devId:f.at.devId,chargeId:used,reason:'错误'}}),/未开票/);
  f.run({type:'development.charge.void',payload:{devId:f.at.devId,chargeId:open,reason:'重复登记'}});
  expect(unbilledDevelopmentCharges(f.state,f.dev())).toEqual([]);expect(f.dev().billing!.charges!.find(row=>row.id===open)?.voided?.reason).toBe('重复登记');
 });

 it.each([0,-1,0.001])('rejects an invalid customer charge amount %s atomically',amount=>{const f=fixture(true);f.unchanged(()=>charge(f,amount),/金额|小数/);});

});
