// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getByText,getAllByRole,getByLabelText} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({value:null as any,canWrite:true,csv:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store.value}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({hasPermission:()=>store.canWrite}); return { useMistSession, useOptionalMistSession: useMistSession }; });
vi.mock('./ModuleWorkbench',async importOriginal=>({...await importOriginal<typeof import('./ModuleWorkbench')>(),downloadModuleCsv:store.csv}));
import {InvoicePage,invoiceAge,invoiceLedgerRows,invoiceSource,invoiceFinancialFacts} from './InvoicePage';
let host:HTMLElement,root:Root,route:any;const go=vi.fn();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
function render(){act(()=>root.render(<MistRoot><Nav.Provider value={{route,go,theme:'light',toggleTheme:vi.fn(),openAI:vi.fn(),openPalette:vi.fn()}}><InvoicePage/></Nav.Provider></MistRoot>));}
async function click(name:string){await act(async()=>getAllByRole(document.body,'button',{name,exact:true})[0].click());}
function fillForm(label:string,value:string){const input=getByLabelText(document.body,label) as HTMLInputElement|HTMLTextAreaElement;act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function select(label:string,value:string){const e=getByRole(host,'combobox',{name:label}) as HTMLSelectElement;act(()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('change',{bubbles:true}));});}
beforeEach(()=>{const state=createMistState({id:()=>'',now:'2026-10-14T00:00:00Z',actorName:'测试'},'empty');state.orders=[{id:'o',code:'ORDER',customerId:'customer',customer:'客户',currency:'USD'}] as any;state.invoices=[{id:'a',code:'CI-A',orderId:'o',order:'ORDER',customer:'客户',due:'2000-01-01',amount:100,open:70,currency:'USD'},{id:'b',code:'CI-B',orderId:'o',order:'ORDER',customer:'客户',due:'2099-01-01',amount:50,open:50,currency:'EUR'},{id:'void',code:'CI-VOID',orderId:'o',order:'ORDER',customer:'客户',due:'2000-01-01',amount:900,open:0,currency:'USD',voidedAt:'2026-10-01',voidReason:'更正原件'}];state.platform.invoiceDrafts=[{id:'draft',orderId:'o',due:'2026-12-01',amount:2000,note:'旧草稿原说明',state:'Draft',createdAt:'2026-10-01'}];state.receipts=[{id:'r',code:'BANK-R',date:'2026-10-01',payer:'客户',amount:20,remaining:0,currency:'USD',ref:'银行参考',state:'matched'}];state.allocations=[{id:'allocation',receiptId:'r',invoiceId:'a',amount:20,currency:'USD',createdAt:'2026-10-01',actor:'实际财务'}];state.platform.creditApplications=[{id:'apply',creditId:'credit',invoiceId:'a',amount:10,at:'2026-10-01',actor:'实际财务'}];state.platform.claims=[{id:'claim',code:'CLM-A',orderId:'o',invoiceId:'a',problem:'实际客诉',fileIds:[],state:'Processing',createdAt:'2026-10-01',dispositions:[]}];state.platform.credits=[{id:'credit',code:'CN-A',claimId:'claim',dispositionId:'decision',customerId:'customer',currency:'USD',amount:10,createdAt:'2026-10-01'}];state.fulfillment.documents=[{id:'doc',shipmentId:'ship',orderId:'o',invoiceId:'a',type:'CI',number:'CI-A',status:'issued',issuedAt:'2026-10-01',content:'原件正文',fileIds:['file']}] as any;state.fulfillment.shipments=[{id:'ship',code:'SHIP-A'}] as any;state.files=[{id:'file',name:'CI-original.pdf',mimeType:'application/pdf',size:100,storageKey:'test',createdAt:'2026-10-01'}];store.value={state,workspace:{id:'space-a',revision:1},loading:false,saving:false,error:'',refresh:vi.fn(),run:vi.fn(),downloadFile:vi.fn().mockResolvedValue(undefined)};store.canWrite=true;store.csv.mockReset();go.mockReset();route={view:'invoices'};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
it.each([['2026-10-14','not-due',0],['2026-10-13','1-30',1],['2026-09-14','1-30',30],['2026-09-13','31-60',31],['2026-08-15','31-60',60],['2026-08-14','61-90',61],['2026-07-16','61-90',90],['2026-07-15','90+',91],['2026-02-30','unknown',null],['','unknown',null]])('computes a validated original-calendar aging band for %s',(due,group,days)=>{expect(invoiceAge(due as string,'2026-10-14')).toEqual({group,days});});
it('keeps void face values and old drafts while excluding both from current receivables',()=>{const rows=invoiceLedgerRows(store.value.state);expect(rows.find(r=>r.id==='void')).toMatchObject({amount:900,open:0,state:'void'});expect(rows.find(r=>r.id==='draft')).toMatchObject({amount:2000,open:0,draft:true,state:'draft'});render();expect(getByText(host,'未结票据').parentElement?.parentElement?.textContent).toContain('2');expect(host.textContent).toContain('70.00 USD');expect(host.textContent).toContain('50.00 EUR');expect(host.textContent).not.toContain('2,070.00 USD');expect(getAllByRole(host,'button').some(b=>b.textContent==='签发商业发票')).toBe(false);expect(store.value.run).not.toHaveBeenCalled();});
it('separates bank allocation, credit offset and remaining balance instead of calling all reductions cash',()=>{const row=invoiceLedgerRows(store.value.state)[0];expect(invoiceFinancialFacts(store.value.state,row)).toMatchObject({cash:20,credit:10,unexplained:0});route.id='a';render();expect(host.textContent).toContain('实际到账核销');expect(host.textContent).toContain('20.00 USD');expect(host.textContent).toContain('10.00 USD');});
it('filters original currencies and exports only the displayed rows',async()=>{render();select('票据币种','EUR');expect(getByRole(host,'table',{name:'应收票据台账'}).textContent).toContain('CI-B');expect(getByRole(host,'table',{name:'应收票据台账'}).textContent).not.toContain('CI-A');await click('导出当前台账 CSV');expect(store.csv).toHaveBeenCalledWith('应收票据当前台账.csv',expect.any(Array),[expect.arrayContaining(['CI-B','EUR',50])]);});
it.each([true,false])('keeps unread invoices distinct from a real empty ledger and restores the loaded data (loading %s)',loading=>{
 const original=store.value.state;store.value={...store.value,state:null,loading,error:loading?'':'暂时读取失败'};render();expect(host.textContent).toContain(loading?'正在读取票据':'票据未读取');expect(host.textContent).not.toContain('未结票据');expect(host.textContent).not.toContain('暂无应收票据');expect(getAllByRole(host,'button').some(b=>b.textContent==='导出当前台账 CSV'||b.textContent==='导入期初应收')).toBe(false);
 store.value={...store.value,state:original,loading:false,error:''};render();expect(getByRole(host,'table',{name:'应收票据台账'}).textContent).toContain('CI-A');expect(host.textContent).toContain('未结票据');expect(host.textContent).not.toContain('票据未读取');expect(store.csv).not.toHaveBeenCalled();
});
it.each([true,false])('includes the customer development and opening receivables in the scoped ledger and export (explicit customer %s)',async explicit=>{
 const s=store.value.state;s.devs.push({id:'scoped-dev',customerId:'customer'}as any);
 s.invoices.push({id:'dev-scope',code:'DI-SCOPED',orderId:'',order:'',devId:'scoped-dev',...(explicit?{customerId:'customer'}:{}),customer:'客户',amount:25,open:25,currency:'USD',due:'2099-01-01',financeStatus:'confirmed'},
 {id:'opening-scope',code:'OPEN-SCOPED',orderId:'',order:'',customerId:'customer',customer:'客户',amount:15,open:15,currency:'USD',due:'2099-01-01',opening:{originalAmount:15,registeredBy:'财务',registeredAt:'2026-10-01'}},
 {id:'foreign-scope',code:'FOREIGN-SCOPE',orderId:'',order:'',customerId:'another-customer',customer:'其他客户',amount:500,open:500,currency:'GBP',due:'2099-01-01'});
 route.customerId='customer';render();const table=getByRole(host,'table',{name:'应收票据台账'});expect(table.textContent).toContain('DI-SCOPED');expect(table.textContent).toContain('OPEN-SCOPED');expect(table.textContent).not.toContain('FOREIGN-SCOPE');expect(getByRole(host,'combobox',{name:'票据币种'}).textContent).not.toContain('GBP');
 const summary=getByText(host,'未结票据').parentElement?.parentElement?.textContent;expect(summary).toContain('110.00 USD');expect(summary).toContain('50.00 EUR');expect(summary).not.toContain('GBP');await click('导出当前台账 CSV');const exported=store.csv.mock.calls.at(-1)![2];expect(exported.some((row:any[])=>row[0]==='DI-SCOPED')).toBe(true);expect(exported.some((row:any[])=>row[0]==='OPEN-SCOPED')).toBe(true);expect(exported.some((row:any[])=>row[0]==='FOREIGN-SCOPE')).toBe(false);
});
it('keeps a selected invoice outside the customer context out of the scoped detail and restores it outside that context',()=>{
 store.value.state.invoices.push({id:'foreign-detail',code:'CI-FOREIGN',orderId:'',order:'',customerId:'another-customer',customer:'其他客户',amount:500,open:500,currency:'GBP',due:'2099-01-01'});route.customerId='customer';route.id='foreign-detail';render();expect(host.textContent).toContain('未找到指定票据');expect(host.querySelector('[data-module-detail]')).toBeNull();delete route.customerId;render();expect(host.textContent).toContain('CI-FOREIGN');expect(host.querySelector('[data-module-detail]')).not.toBeNull();
});
function explainAdjustments(){
 const a=store.value.state.invoices.find((i:any)=>i.id==='a'),base={currency:'USD',at:'2026-10-02T02:00:00Z',actor:'财务',reason:'已核对依据'};
 a.bankCharges=[{...base,id:'fee-active',receiptId:'r',amount:5},{...base,id:'fee-reversed',receiptId:'r',amount:7,reversed:{...base}}];
 a.writeoffs=[{...base,id:'difference-active',kind:'difference',amount:3},{...base,id:'difference-reversed',kind:'difference',amount:2,reversed:{...base}}];a.open=62;
}
it('explains active writeoffs without counting reversed adjustments or reporting a false discrepancy',()=>{
 explainAdjustments();const row=invoiceLedgerRows(store.value.state).find(r=>r.id==='a')!;
 expect(invoiceFinancialFacts(store.value.state,row)).toMatchObject({cash:20,credit:10,charged:5,writtenOff:3,unexplained:0});
 route.id='a';render();expect(host.textContent).not.toContain('票款明细待核对');expect(store.value.run).not.toHaveBeenCalled();
});
it('exports every balance component in the invoice currency so the ledger reconciles',async()=>{
 explainAdjustments();render();await click('导出当前台账 CSV');const [,headers,rows]=store.csv.mock.calls.at(-1)!;
 const row=rows.find((r:any[])=>r[0]==='CI-A'),values=Object.fromEntries(headers.map((key:string,index:number)=>[key,row[index]]));
 expect(values).toMatchObject({'票面金额':100,'币种':'USD','到账核销':20,'贷项抵扣':10,'银行扣费':5,'核销调整':3,'未收余额':62,'待核对差额':0});
 expect(values['票面金额']).toBe(values['到账核销']+values['贷项抵扣']+values['银行扣费']+values['核销调整']+values['未收余额']+values['待核对差额']);
 expect(store.value.run).not.toHaveBeenCalled();
});
it('keeps a real unexplained balance visible in the exported ledger instead of inventing an adjustment',async()=>{
 store.value.state.invoices.find((i:any)=>i.id==='a').open=50;render();await click('导出当前台账 CSV');const [,headers,rows]=store.csv.mock.calls.at(-1)!;
 const row=rows.find((r:any[])=>r[0]==='CI-A'),values=Object.fromEntries(headers.map((key:string,index:number)=>[key,row[index]]));
 expect(values['待核对差额']).toBe(20);expect(values['银行扣费']).toBe(0);expect(values['核销调整']).toBe(0);expect(values['未收余额']).toBe(50);
 route.id='a';render();expect(host.textContent).toContain('票款明细待核对');
 expect(store.value.run).not.toHaveBeenCalled();
});
it('retains draft history read-only even with invoice write permission',()=>{route.id='draft';render();expect(host.textContent).toContain('历史独立草稿只读');expect(host.textContent).toContain('旧草稿原说明');expect(host.textContent).not.toContain('新建发票草稿');expect(getAllByRole(host,'button').some(b=>b.textContent==='签发商业发票')).toBe(false);expect((getByRole(host,'button',{name:'收款与核销'}) as HTMLButtonElement).disabled).toBe(true);expect(store.value.run).not.toHaveBeenCalled();});
it('links only exact source documents, shipment, receipt and credit application',async()=>{route.id='a';render();await click('来源 CI / 作废回程');expect(go).toHaveBeenLastCalledWith('document-center','doc');await click('来源出运');expect(go).toHaveBeenLastCalledWith('shipments','ship');await click('查看到账流水');expect(go).toHaveBeenLastCalledWith('payment-vouchers','r',{section:'records'});await click('查看贷项来源案件');expect(go).toHaveBeenLastCalledWith('claims','claim',{section:'credit:credit'});expect(store.value.run).not.toHaveBeenCalled();});
it('does not guess a source document from a matching number or ambiguous associations',()=>{const row=invoiceLedgerRows(store.value.state)[0];store.value.state.fulfillment.documents[0].invoiceId='another';expect(invoiceSource(store.value.state,row).document).toBeUndefined();store.value.state.fulfillment.documents[0].invoiceId='a';store.value.state.fulfillment.documents.push({...store.value.state.fulfillment.documents[0],id:'second'});route.id='a';render();expect(host.textContent).toContain('存在多个 CI 关联');expect((getByRole(host,'button',{name:'来源 CI / 作废回程'}) as HTMLButtonElement).disabled).toBe(true);});
it('shows a failed attachment download and permits retry without any financial write',async()=>{store.value.downloadFile.mockRejectedValueOnce(new Error('原件服务拒绝读取'));route.id='a';render();await click('CI-original.pdf');expect(document.querySelector('[data-file-preview]')!.textContent).toContain('CI-original.pdf');expect(store.value.downloadFile).not.toHaveBeenCalled();await act(async()=>(document.querySelector('[data-file-preview] button[aria-label="关闭"]') as HTMLButtonElement).click());expect(document.querySelector('[data-file-preview]')).toBeNull();await click('下载');expect(host.textContent).toContain('原件服务拒绝读取');await click('下载');expect(store.value.downloadFile).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain('原件服务拒绝读取');expect(store.value.run).not.toHaveBeenCalled();});
it('does not show an old attachment error in a new workspace',async()=>{let reject!:(e:Error)=>void;store.value.downloadFile.mockReturnValue(new Promise((_,fail)=>reject=fail));route.id='a';render();await click('下载');store.value={...store.value,workspace:{id:'space-b'}};render();await act(async()=>reject(new Error('旧空间原件失败')));expect(host.textContent).not.toContain('旧空间原件失败');});
it('points the supplier tab to the real payables ledger without manufacturing payable invoices',async()=>{render();await act(async()=>getByRole(host,'tab',{name:'供应商应付'}).click());expect((getByRole(host,'button',{name:'打开应付台账'}) as HTMLButtonElement).disabled).toBe(false);await click('打开应付台账');expect(go).toHaveBeenLastCalledWith('payment-vouchers',undefined,{section:'payables'});expect(host.textContent).not.toContain('CI-A');expect(store.value.run).not.toHaveBeenCalled();});
it('does not auto-open another invoice when an exact deep link is missing',()=>{route.id='missing';render();expect(host.textContent).toContain('未找到指定票据');expect(host.textContent).not.toContain('原件正文');expect(store.value.run).not.toHaveBeenCalled();});
it('keeps voided invoices read-only with original reason and without new reconciliation',()=>{route.id='void';render();expect(host.textContent).toContain('更正原件');expect(host.textContent).toContain('900.00 USD');expect((getByRole(host,'button',{name:'收款与核销'}) as HTMLButtonElement).disabled).toBe(true);});
it('shows unexplained historical balance differences without inventing a bank receipt',()=>{store.value.state.invoices[0].open=60;route.id='a';render();expect(host.textContent).toContain('票款明细待核对');expect(host.textContent).toContain('票款明细相差 10.00 USD');expect(store.value.state.receipts).toHaveLength(1);expect(store.value.run).not.toHaveBeenCalled();});
it('exposes read-only finance results without source creation even to a business account',()=>{store.canWrite=false;render();expect(host.textContent).toContain('财务结果只读');expect(host.textContent).not.toContain('新建发票草稿');expect(store.value.run).not.toHaveBeenCalled();});

it('preserves incoming customer scope and original-currency filters through list-detail return',async()=>{route={view:'invoices',section:'open',customerId:'customer'};render();select('票据币种','EUR');const row=[...host.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find(r=>r.textContent?.includes('CI-B'))!;await act(async()=>row.click());expect(go).toHaveBeenLastCalledWith('invoices','b',{section:'open',customerId:'customer'});await click('返回发票台账');expect(go).toHaveBeenLastCalledWith('invoices',undefined,{section:'open',customerId:'customer'});expect((getByRole(host,'combobox',{name:'票据币种'}) as HTMLSelectElement).value).toBe('EUR');expect(getByRole(host,'table',{name:'应收票据台账'}).textContent).not.toContain('CI-A');});

const pendingCi=()=>{store.value.state.invoices.push({id:'p',code:'CI-P',orderId:'o',order:'ORDER',customer:'客户',due:'2000-01-01',amount:300,open:0,currency:'USD',financeStatus:'pending'});};
it('queues a CI receivable as pending finance confirmation outside open balance, aging and reconciliation',async()=>{
  pendingCi();
  expect(invoiceLedgerRows(store.value.state).find(r=>r.id==='p')).toMatchObject({state:'pending',amount:300,open:0});
  render();
  expect(getByText(host,'待财务确认',{selector:'.mist-stat *'}).closest('.mist-stat')?.textContent).toContain('1');
  expect(getByText(host,'未结票据').parentElement?.parentElement?.textContent).not.toContain('300.00');
  await act(async()=>getByRole(getByRole(host,'group'),'button',{name:'待财务确认'}).click());
  const table=getByRole(host,'table',{name:'应收票据台账'});
  expect(table.textContent).toContain('CI-P');expect(table.textContent).not.toContain('CI-A');
  route.id='p';render();
  expect(host.textContent).not.toContain('票款明细待核对');
  const collect=getByRole(host,'button',{name:'收款与核销'}) as HTMLButtonElement;
  expect(collect.disabled).toBe(true);
  await act(async()=>getAllByRole(document.body,'button',{name:'确认应收',exact:true}).find(b=>!b.closest('[role=dialog]'))!.click());
  expect(store.value.run).not.toHaveBeenCalledWith({type:'finance.receivable.confirm',payload:{invoiceId:'p'}});
  expect(getByRole(document.body,'dialog',{name:'确认应收 · CI-P'})).toBeTruthy();
  await act(async()=>getByRole(getByRole(document.body,'dialog',{name:/确认应收/}),'button',{name:'确认应收'}).click());
  expect(store.value.run).toHaveBeenLastCalledWith({type:'finance.receivable.confirm',payload:{invoiceId:'p'}});
  await click('驳回 CI');
  fillForm('驳回原因','金额与合同不符');
  await act(async()=>getByRole(getByRole(document.body,'dialog',{name:'驳回 CI 应收'}),'button',{name:'驳回并退回更正'}).click());
  expect(store.value.run).toHaveBeenLastCalledWith({type:'finance.receivable.reject',payload:{invoiceId:'p',reason:'金额与合同不符'}});
});
it('does not offer confirm or reject to an account without finance invoice write permission',()=>{
  pendingCi();store.canWrite=false;route.id='p';render();
  expect(getAllByRole(host,'button').some(b=>b.textContent==='确认应收'||b.textContent==='驳回 CI')).toBe(false);
  expect(store.value.run).not.toHaveBeenCalled();
});
it('shows the finance confirmation and rejection facts on the receivable',()=>{
  pendingCi();Object.assign(store.value.state.invoices.at(-1),{financeStatus:'rejected',voidedAt:'2026-10-14T00:00:00Z',voidReason:'财务驳回：金额与合同不符',financeRejectedAt:'2026-10-14T00:00:00Z',financeRejectedBy:'财务',financeRejectReason:'金额与合同不符'});
  route.id='p';render();
  expect(host.textContent).toContain('财务驳回');expect(host.textContent).toContain('金额与合同不符');expect(host.textContent).toContain('已退回后勤更正');
  expect((getByRole(host,'button',{name:'收款与核销'}) as HTMLButtonElement).disabled).toBe(true);
});

it('offers collection-backed bad debt independently of bank fees or cash allocations', () => {
  const state = store.value.state;
  route.id = 'a';
  state.allocations = [];
  state.invoices[0].open = 90; // The remaining reduction is a claim credit.
  state.crm.followUps.push({ id: 'follow-up', at: '2026-10-14T00:00:00Z', method: 'phone', content: '核对未收金额', link: { kind: 'invoice', id: 'a' }, collection: { level: 1, openAtLog: 90, currency: 'USD' } });
  render();
  expect((getByRole(host, 'button', { name: '坏账核销' }) as HTMLButtonElement).disabled).toBe(false);
  expect((getByRole(host, 'button', { name: '红冲更正' }) as HTMLButtonElement).disabled).toBe(true);
  expect(getAllByRole(host, 'button').some(b => b.textContent === '登记银行扣费')).toBe(false);
});

it('keeps the original non-cash adjustment available to reverse after it settles the invoice', async () => {
  route.id = 'a';
  Object.assign(store.value.state.invoices[0], { open: 0, writeoffs: [{ id: 'wo', kind: 'badDebt', amount: 70, currency: 'USD', actor: '财务', reason: '催收结论', at: '2026-10-14T00:00:00Z' }] });
  render();
  await click('冲回');
  const dialog = getByRole(document.body, 'dialog', { name: '冲回核销' });
  fillForm('冲回原因', '收回核销决定');
  await act(async () => getByRole(dialog, 'button', { name: '冲回' }).click());
  expect(store.value.run).toHaveBeenCalledWith({ type: 'finance.receivable.writeoff.reverse', payload: { invoiceId: 'a', writeoffId: 'wo', reason: '收回核销决定' } }, expect.objectContaining({ expectedRevision: 1 }));
});

it('requires a fresh adjustment review if a receipt allocation changes while the form is open', async () => {
  route.id = 'a';
  store.value.state.invoices[0].open = 40;
  render();
  await click('尾差核销');
  const dialog = getByRole(document.body, 'dialog', { name: '尾差核销 · CI-A' });
  fillForm('尾差说明', '对账差额');
  store.value.state.allocations[0].receiptId = 'replacement';
  store.value.workspace.revision = 2;
  render();
  await act(async () => getByRole(dialog, 'button', { name: '核销' }).click());
  expect(dialog.textContent).toContain('应收资料已更新');
  expect(store.value.run).not.toHaveBeenCalled();
});

it('generates a customer statement for a customer with open receivables and lists archived statements',async()=>{
  const s=store.value.state;s.customers=[{id:'customer',name:'客户',code:'C-1'}];s.settings.companyProfile={legalName:'公司'};
  s.files.push({id:'soa-file',name:'客户对账单-SOA-2026-0001-C-1.pdf',mimeType:'application/pdf',size:1,storageKey:'w/soa-file',createdAt:'2026-10-14T00:00:00Z'});
  s.customerStatements=[{id:'st',customerId:'customer',statementNo:'SOA-2026-0001',seq:1,asOf:'2026-10-13',totals:[{currency:'USD',net:'70.00'}],fileId:'soa-file',fileName:'x.pdf',sha256:'',bytes:1,templateVersion:1,snapshotFingerprint:'',snapshot:{} as any,generatedAt:'2026-10-13T02:00:00Z',generatedBy:'财务',generatedById:'f'}];
  render();
  const list=getByRole(host,'list',{name:'已生成的客户对账单'});expect(list.textContent).toContain('SOA-2026-0001');expect(list.textContent).toContain('净欠 70.00 USD');
  await click('生成对账单');expect(store.value.run).toHaveBeenCalledWith({type:'finance.statement.generate',payload:{customerId:'customer'}});
  await click('下载');expect(store.value.downloadFile).toHaveBeenCalledWith(expect.objectContaining({id:'soa-file'}));
});
it('disables statement generation without invoice write permission',()=>{
  store.canWrite=false;store.value.state.customers=[{id:'customer',name:'客户',code:'C-1'}];store.value.state.settings.companyProfile={legalName:'公司'};render();
  const button=getAllByRole(host,'button').find(b=>b.textContent==='生成对账单') as HTMLButtonElement;expect(button.disabled).toBe(true);expect(button.title).toContain('应收写权限');
});


it('hands collection to the exact invoice reconciliation context rather than a preview',async()=>{
 route.id='a';render();await click('收款与核销');expect(go).toHaveBeenCalledWith('payment-vouchers',undefined,{section:'invoice:a'});expect(store.value.run).not.toHaveBeenCalled();
});

it('shows only visible statement lines when the archived statement spans hidden business',()=>{const s=store.value.state;s.customers=[{id:'customer',name:'客户',code:'C-1'}];s.partialStatements=[{id:'st-part',customerId:'customer',statementNo:'SOA-PART',asOf:'2026-10-13',hiddenCount:1,sections:[{currency:'USD',lines:[{invoiceId:'a',code:'CI-A',open:'70.00'}],hiddenCount:1}]}];render();const list=getByRole(host,'list',{name:'已生成的客户对账单'});expect(list.textContent).toContain('SOA-PART');expect(list.textContent).toContain('CI-A');expect(list.textContent).toContain('70.00');expect(list.textContent).toContain('另含其他范围业务');expect(list.textContent).not.toContain('净欠');expect(getAllByRole(list,'listitem')[0].querySelector('button')).toBeNull();});
it('records a remittance bank charge on the receivable detail and explains it in the balance',async()=>{
 const a=store.value.state.invoices.find((i:any)=>i.id==='a');a.open=65;a.bankCharges=[{id:'c1',receiptId:'r',amount:5,currency:'USD',reason:'中转行扣费，见入账通知',at:'2026-10-02T02:00:00.000Z',actor:'实际财务'}];
 const row=invoiceLedgerRows(store.value.state).find(r=>r.id==='a')!;expect(invoiceFinancialFacts(store.value.state,row)).toMatchObject({charged:5,unexplained:0});
 route.id='a';render();const block=[...host.querySelectorAll('[data-bank-charge]')];expect(block).toHaveLength(1);expect(block[0].textContent).toContain('5.00 USD');expect(block[0].textContent).toContain('中转行扣费');
 await click('登记银行扣费');getByRole(document.body,'dialog',{name:'登记银行扣费 · CI-A'});fillForm('扣费依据','金额与合同不符');await click('登记扣费');
 expect(store.value.run).toHaveBeenCalledWith(expect.objectContaining({type:'finance.receivable.bankCharge',payload:expect.objectContaining({invoiceId:'a',reason:'金额与合同不符'})}));
 await click('冲回');const reverse=getByRole(document.body,'dialog',{name:'冲回银行扣费 · CI-A'});fillForm('冲回原因','金额与合同不符');await act(async()=>getAllByRole(reverse,'button',{name:'冲回'})[0].click());
 expect(store.value.run).toHaveBeenCalledWith({type:'finance.receivable.bankCharge.reverse',payload:{invoiceId:'a',chargeId:'c1',reason:'金额与合同不符'}});
});

function pendingAcceptance(){
 const s=store.value.state;s.invoices.push({id:'conditional',code:'CI-CONDITIONAL',orderId:'o',order:'ORDER',customer:'客户',currency:'USD',amount:100,open:0,due:'',financeStatus:'pending',sourceDocumentId:'conditional-ci',receivableDueCondition:{kind:'deliveryAcceptance',days:30,terms:'交付验收后30天付款'}});
 s.fulfillment.documents.push({id:'conditional-ci',type:'CI',status:'issued',orderId:'o',invoiceId:'conditional',shipmentId:'conditional-ship',number:'CI-CONDITIONAL',dueDate:'',content:'交付验收后30天付款',fileIds:[],receivableDueCondition:{kind:'deliveryAcceptance',days:30,terms:'交付验收后30天付款'}});
 s.fulfillment.shipments.push({id:'conditional-ship',code:'SHIP-CONDITIONAL',state:'departed',lines:[{orderId:'o',lineId:'l',quantity:10}]});route.id='conditional';return s.fulfillment.shipments.at(-1);
}
it('keeps amount confirmation available while holding only the unresolved due-date action',()=>{
 pendingAcceptance();render();expect((getByRole(host,'button',{name:'确认应收'}) as HTMLButtonElement).disabled).toBe(false);expect((getByRole(host,'button',{name:'核对账期'}) as HTMLButtonElement).disabled).toBe(true);expect(host.textContent).toContain('验收后30天');expect(store.value.run).not.toHaveBeenCalled();
});
it('asks finance for an actual acceptance date and basis instead of copying the POD date',async()=>{
 const shipment=pendingAcceptance();shipment.delivered={at:'2026-10-20T10:00:00Z',receiver:'Customer',evidence:'POD-1',fileIds:[],recordedBy:'后勤'};render();await click('核对账期');
 const d=getByRole(document.body,'dialog',{name:'核对账期 · CI-CONDITIONAL'}),day=getByLabelText(d,'客户验收日') as HTMLInputElement,basis=getByRole(d,'textbox',{name:'验收依据'}) as HTMLTextAreaElement;
 expect(day.value).toBe('');await act(async()=>getByRole(d,'button',{name:'核对账期'}).click());expect(store.value.run).not.toHaveBeenCalled();
 for(const [input,value]of [[day,'2026-10-21'],[basis,'客户验收确认 AC-1，已核对本票POD']] as const)await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>getByRole(d,'button',{name:'核对账期'}).click());
 expect(store.value.run).toHaveBeenCalledWith({type:'finance.receivable.due',payload:{invoiceId:'conditional',acceptanceDate:'2026-10-21',acceptanceBasis:'客户验收确认 AC-1，已核对本票POD'}},{expectedRevision:1});
});

it('lets an invoice-only finance reader review the minimal payment source without transport access',async()=>{
 pendingAcceptance();const i=store.value.state.invoices.at(-1);i.receivableDueSource={sourceCurrent:true,shipmentId:'conditional-ship',deliveryAt:'2026-10-20T10:00:00Z'};store.value.state.fulfillment.documents=[];store.value.state.fulfillment.shipments=[];render();
 expect((getByRole(host,'button',{name:'核对账期'}) as HTMLButtonElement).disabled).toBe(false);await click('核对账期');expect(getByLabelText(document.body,'客户验收日')).toBeTruthy();
});

it('keeps due corrections distinct from amount confirmation and requires a new correction reason',async()=>{
 const shipment=pendingAcceptance();shipment.delivered={at:'2026-10-20T10:00:00Z',receiver:'Buyer',evidence:'POD',fileIds:[],recordedBy:'Ops'};const i=store.value.state.invoices.at(-1);Object.assign(i,{financeStatus:'confirmed',open:100,due:'2026-11-20',dueConfirmation:{acceptanceDate:'2026-10-21',basis:'AC1',due:'2026-11-20',shipmentId:shipment.id,sourceDocumentId:'conditional-ci',deliveryAt:shipment.delivered.at,at:'2026-10-22T04:00:00Z',actor:'Finance'}});render();await click('更正验收日');
 const d=getByRole(document.body,'dialog',{name:'更正验收日 · CI-CONDITIONAL'});expect((getByLabelText(d,'客户验收日') as HTMLInputElement).value).toBe('2026-10-21');fillForm('客户验收日','2026-10-22');fillForm('验收依据','Corrected AC2');await act(async()=>getByRole(d,'button',{name:'保存更正'}).click());expect(store.value.run).not.toHaveBeenCalled();fillForm('更正原因','Original date was recorded one day early');await act(async()=>getByRole(d,'button',{name:'保存更正'}).click());expect(store.value.run).toHaveBeenCalledWith({type:'finance.receivable.due',payload:{invoiceId:'conditional',acceptanceDate:'2026-10-22',acceptanceBasis:'Corrected AC2',reason:'Original date was recorded one day early'}},{expectedRevision:1});
});
it('retains a stale due-review form after another accountant changed its source',async()=>{
 const shipment=pendingAcceptance();shipment.delivered={at:'2026-10-20T10:00:00Z',receiver:'Buyer',evidence:'POD',fileIds:[],recordedBy:'Ops'};render();await click('核对账期');fillForm('客户验收日','2026-10-21');fillForm('验收依据','My old AC1');const i=store.value.state.invoices.at(-1);i.due='2026-11-21';i.dueConfirmation={acceptanceDate:'2026-10-22',basis:'Other AC2',due:'2026-11-21',shipmentId:shipment.id,sourceDocumentId:'conditional-ci',deliveryAt:shipment.delivered.at,at:'2026-10-22T04:00:00Z',actor:'Other'};store.value.workspace.revision=2;render();const d=getByRole(document.body,'dialog',{name:'核对账期 · CI-CONDITIONAL'});await act(async()=>getByRole(d,'button',{name:'核对账期'}).click());expect(store.value.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('账期来源已更新，请重新打开后核对');expect((getByLabelText(d,'客户验收日') as HTMLInputElement).value).toBe('2026-10-21');
});

it('opens the exact visible customer sample request, with no shipping or CI action', async () => {
  const state = store.value.state;
  const row = state.invoices[0];
  Object.assign(row, { orderId: '', order: 'SR-1', sampleRequestId: 'request', customerId: 'customer', financeStatus: 'pending' });
  state.sampleRequests = [{ id: 'request', customerId: 'customer' }];
  route.id = row.id;
  render();
  expect(host.textContent).toContain('样品费');
  expect(host.textContent).not.toContain('来源 CI / 作废回程');
  expect(host.textContent).not.toContain('驳回 CI');
  await click('来源索样单');
  expect(go).toHaveBeenCalledWith('samples', 'request', { section: 'requests' });
  state.sampleRequests[0].customerId = 'unrelated';
  render();
  expect((getByRole(host, 'button', { name: '来源索样单' }) as HTMLButtonElement).disabled).toBe(true);
  state.sampleRequests = [];
  render();
  expect((getByRole(host, 'button', { name: '来源索样单' }) as HTMLButtonElement).disabled).toBe(true);
});
