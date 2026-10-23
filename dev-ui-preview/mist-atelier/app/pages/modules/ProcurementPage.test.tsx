// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentPurchase} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const session=vi.hoisted(()=>({id:'buyer',denied:new Set<string>()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:session.id,displayName:'经办人'},sessionKey:'s',hasPermission:(p:string)=>!session.denied.has(p),canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {ProcurementPage} from './ProcurementPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(id?:string,mode:'full'|'list'=id?'full':'list'){const detail=mode==='full'?mode:undefined;act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'procurement',id,detail},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><ProcurementPage/></Nav.Provider></ToastProvider></MistRoot>));}
async function click(node:HTMLElement){await act(async()=>node.click());}
function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function purchase(id:string,patch:Partial<FulfillmentPurchase>={}):FulfillmentPurchase{return {id,code:id.toUpperCase(),orderId:'o',lineId:'l',kind:'material',domain:'garment',supplierId:'s',supplier:'青禾辅料',description:'主唛与洗标',quantity:100,unit:'个',price:0.3,currency:'CNY',due:'2026-10-30',terms:'月结30天',destination:'江南成衣',note:'',fileIds:[],state:'draft',requesterId:'buyer',createdBy:'经办人',createdAt:'2026-10-01T08:00:00Z',reviewerIds:['boss'],configVersions:{},received:0,...patch};}
const approved=(patch:Partial<FulfillmentPurchase>={})=>({state:'approved' as const,submittedAt:'2026-10-02T08:00:00Z',decision:{actorId:'boss',actor:'审批人',at:'2026-10-03T08:00:00Z',decision:'approved' as const,note:'同意'},...patch});
it('generates supplier PDFs through the server and keeps archived files available',async()=>{
  store.state!.fulfillment.purchases.push(purchase('pdf',approved({documents:[{id:'doc',fileId:'pdf-file',fileName:'PO-V1-01.pdf'} as any]})));
  store.state!.files.push({id:'pdf-file',name:'PO-V1-01.pdf',mimeType:'application/pdf',size:100,storageKey:'private',createdAt:''});
  render('pdf');await click(getByRole(host,'button',{name:'生成采购单'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.procurement.document',payload:{id:'pdf'}});
  expect(host.textContent).toContain('合同文件');expect(host.textContent).toContain('PO-V1-01.pdf');
  expect(queryByRole(host,'button',{name:'下载批准单据'})).toBeNull();
});
it('keeps generation disabled for read-only procurement access',()=>{
  session.denied.add('procurement:write');store.state!.fulfillment.purchases.push(purchase('readonly',approved({kind:'processing'})));
  render('readonly');expect((getByRole(host,'button',{name:'生成加工合同'}) as HTMLButtonElement).disabled).toBe(true);
});
beforeEach(()=>{session.id='buyer';session.denied=new Set();store.state=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'经办人'},'empty');store.state.orders.push({id:'o',code:'SO-1',type:'garment',customerId:'c',currency:'USD'} as any);store.state.orderLines.push({id:'l',orderId:'o',name:'风衣',style:'TR-1',img:'coat',qty:100,unit:'件',price:10,made:0,qc:0});store.run.mockReset();store.run.mockResolvedValue({result:{}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});

it('offers garment supplies and processing without a fabric purchase shortcut',async()=>{
  store.state!.orders.push({id:'fabric-order',code:'SO-F',type:'fabric',currency:'CNY'} as any);
  store.state!.orderLines.push({id:'fabric-line',orderId:'fabric-order',name:'斜纹',style:'FB',qty:100,unit:'米',price:10} as any);
  render();await click(getAllByRole(host,'button',{name:'新建采购订单'})[0]);
  const content=getByRole(host,'combobox',{name:'采购内容'}) as HTMLSelectElement;
  expect([...content.options].map(option=>option.value)).toEqual(['','material:trims','material:packaging','processing']);
  const source=getByRole(host,'combobox',{name:'来源条目'}) as HTMLSelectElement;
  expect([...source.options].map(option=>option.value)).toEqual(['','line:l']);
  expect(content.value).toBe('');
});

it('preserves the material category when editing and sends it with the purchase kind',async()=>{
  store.state!.market.suppliers=[{id:'s',name:'青禾辅料',status:'active'} as any];
  store.state!.fulfillment.purchases.push(purchase('trims',{materialKind:'trims'}));
  render('trims');await click(getByRole(host,'button',{name:'编辑草稿'}));
  expect((getByRole(host,'combobox',{name:'采购内容'}) as HTMLSelectElement).value).toBe('material:trims');
  for(let i=0;i<3;i++)await click(getByRole(host,'button',{name:'下一步'}));
  await click(getByRole(host,'button',{name:'保存草稿'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.procurement.save',payload:expect.objectContaining({id:'trims',kind:'material',materialKind:'trims',orderId:'o',lineId:'l'})}));
});

it('keeps future supplier suspensions selectable and excludes suppliers unavailable on the Shanghai business day',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-13T16:30:00Z'));
  const base={type:'面料贸易',country:'CN',address:'',capabilities:'面料',capacity:100,capacityUnit:'米',leadDays:7,blockReason:'待核实',contacts:[],fileIds:[],note:'',createdAt:'',updatedAt:''};
  store.state!.market.suppliers=[
    {...base,id:'active',code:'A',name:'正常供应商',status:'active'},
    {...base,id:'future-paused',code:'FP',name:'明天暂停',status:'paused',statusFrom:'2026-10-15'},
    {...base,id:'future-blocked',code:'FB',name:'明天停用',status:'blocked',statusFrom:'2026-10-15'},
    {...base,id:'paused',code:'P',name:'今天已暂停',status:'paused',statusFrom:'2026-10-14'},
    {...base,id:'blocked',code:'B',name:'已停用',status:'blocked',statusFrom:'2026-10-13'},
  ];
  render();await click(getAllByRole(host,'button',{name:'新建采购订单'})[0]);
  const supplier=getByRole(host,'combobox',{name:'供应商'}) as HTMLSelectElement;
  expect([...supplier.options].map(option=>option.value)).toEqual(['','active','future-paused','future-blocked']);
  expect(store.run).not.toHaveBeenCalled();
});

it('preserves an existing draft supplier with its unavailable reason instead of clearing the reference',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-13T16:30:00Z'));
  store.state!.market.suppliers=[{id:'s',code:'S',name:'青禾辅料',type:'辅料',country:'CN',address:'',capabilities:'辅料',capacity:100,capacityUnit:'个',leadDays:7,status:'paused',statusFrom:'2026-10-14',blockReason:'交付整改',contacts:[],fileIds:[],note:'',createdAt:'',updatedAt:''}];
  store.state!.fulfillment.purchases.push(purchase('existing'));
  render('existing');await click(getByRole(host,'button',{name:'编辑草稿'}));
  const supplier=getByRole(host,'combobox',{name:'供应商'}) as HTMLSelectElement;
  expect(supplier.value).toBe('s');expect(supplier.selectedOptions[0].textContent).toContain('已暂停合作');
  expect(host.textContent).toContain('交付整改');expect(store.run).not.toHaveBeenCalled();
});

it('keeps purchase orders and outsourced processing as separate entries inside each business group',async()=>{
  store.state!.fulfillment.purchases.push(purchase('po-1'),purchase('wo-1',{kind:'processing',description:'水洗加工'}),purchase('fb-1',{domain:'fabric',description:'面料染色'}));
  render();
  expect(getByRole(host,'tab',{name:/^采购订单/}).getAttribute('aria-selected')).toBe('true');
  expect(getByRole(host,'tab',{name:/^采购订单/}).textContent).toContain('1');
  const table=getByRole(host,'table',{name:'采购订单列表'});
  expect(table.textContent).toContain('PO-1');expect(table.textContent).not.toContain('WO-1');expect(table.textContent).not.toContain('FB-1');
  await click(getByRole(host,'tab',{name:/^委外加工单/}));
  expect(getByRole(host,'table',{name:'委外加工单列表'}).textContent).toContain('WO-1');
  expect(getByRole(host,'button',{name:'新建委外加工单'})).toBeTruthy();
  await click(getByRole(host,'button',{name:/^面料业务/}));
  expect(getByRole(host,'table',{name:'采购订单列表'}).textContent).toContain('FB-1');
});

it('derives stages only from recorded facts and puts exceptions first',()=>{
  store.state!.fulfillment.purchases.push(
    purchase('a-draft'),purchase('b-pending',{state:'pending',submittedAt:'2026-10-02T08:00:00Z'}),
    purchase('c-unsent',approved({due:'2026-11-20'})),
    purchase('d-late',approved({due:'2026-10-01',offlineSend:{at:'2026-10-04T08:00:00Z',actor:'经办人',evidence:'邮件',fileIds:[],revision:1}})),
    purchase('e-over',approved({received:120,offlineSend:{at:'2026-10-04T08:00:00Z',actor:'经办人',evidence:'邮件',fileIds:[],revision:1},supplierConfirmation:{at:'2026-10-05T08:00:00Z',actor:'经办人',evidence:'回签',confirmedDue:'2026-10-30',fileIds:[],revision:1}})),
  );
  render();
  const pipeline=(label:string)=>getAllByRole(host,'button').find(button=>button.textContent?.startsWith(label))!;
  expect(pipeline('需求草稿').textContent).toBe('需求草稿1');
  expect(pipeline('待审批').textContent).toBe('待审批1');
  expect(pipeline('待供应商确认').textContent).toBe('待供应商确认2');
  expect(pipeline('已完成').textContent).toBe('已完成0');
  expect(pipeline('供应履约中').textContent).toBe('供应履约中1');
  const rows=getAllByRole(getByRole(host,'table',{name:'采购订单列表'}),'row').slice(1).map(row=>row.textContent?.match(/[A-E]-[A-Z]+/)?.[0]);
  expect(rows.slice(0,2).sort()).toEqual(['D-LATE','E-OVER']);
  expect(getByRole(host,'row',{name:/E-OVER/}).textContent).toContain('超收 20 个');
});

it('explains why delivery cannot be recorded before the supplier confirms and opens confirmation over the list',async()=>{
  store.state!.fulfillment.purchases.push(purchase('sent',approved({offlineSend:{at:'2026-10-04T08:00:00Z',actor:'经办人',evidence:'邮件',fileIds:[],revision:1}})));
  render('sent');
  const detail=host.querySelector('[data-purchase-detail="sent"]') as HTMLElement;
  expect(detail.textContent).toContain('合同已发出 · 待供应商确认');
  expect((getByRole(detail,'button',{name:'登记本次交付'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('登记本次交付：请先登记合同线下发出和供应商确认');
  expect(queryByRole(detail,'button',{name:'登记合同线下发出'})).toBeNull();
  await click(getByRole(detail,'button',{name:'登记供应商确认'}));
  const dialog=getByRole(document.body,'dialog');
  expect(host.querySelector('[data-list-detail-page]')).not.toBeNull();
  typeInto(getByRole(dialog,'textbox',{name:'供应商确认依据'}) as HTMLTextAreaElement,'盖章回签件');
  await click(getByRole(dialog,'button',{name:'登记确认'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.procurement.confirm',payload:expect.objectContaining({id:'sent',confirmedDue:'2026-10-30',evidence:'盖章回签件'})}));
});

it('shows a summary preview in the list and the complete purchase on its own page',()=>{
  store.state!.fulfillment.purchases.push(purchase('p1'));
  render('p1','list');
  const preview=host.querySelector('aside.mist-preview') as HTMLElement;
  expect(preview.textContent).toContain('P1');expect(preview.querySelector('[data-purchase-detail]')).toBeNull();
  act(()=>(getByRole(preview,'button',{name:/^打开/}) as HTMLButtonElement).click());
  expect(go).toHaveBeenLastCalledWith('procurement','p1',{detail:'full'});
  render('p1');
  expect(host.querySelector('[data-list-detail-page] [data-purchase-detail="p1"]')).not.toBeNull();expect(host.querySelector('[role="row"]')).toBeNull();
  act(()=>(getByRole(host,'button',{name:/返回采购管理/}) as HTMLButtonElement).click());
  expect(go).toHaveBeenLastCalledWith('procurement','p1',{},{keepScroll:true});
});
it('shows approval reasons, returned notes and processing-only track steps',()=>{
  store.state!.fulfillment.purchases.push(purchase('wait',{state:'pending',submittedAt:'2026-10-02T08:00:00Z',kind:'processing'}),purchase('back',{state:'rejected',decision:{actorId:'boss',actor:'审批人',at:'2026-10-03T08:00:00Z',decision:'rejected',note:'单价高于报价'}}));
  render('wait');
  let detail=host.querySelector('[data-purchase-detail="wait"]') as HTMLElement;
  expect((getByRole(detail,'button',{name:'批准承诺'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('你不在本单提交时的审批名单中');
  expect(detail.textContent).toContain('原料交接');
  render('back');
  detail=host.querySelector('[data-purchase-detail="back"]') as HTMLElement;
  expect(detail.textContent).toContain('审批人：单价高于报价');
  expect((getByRole(detail,'button',{name:'提交审批'}) as HTMLButtonElement).disabled).toBe(true);
  expect((getByRole(detail,'button',{name:'编辑草稿'}) as HTMLButtonElement).disabled).toBe(false);
  expect(detail.textContent).not.toContain('原料交接');
});

it('keeps the ledger readable without write permission',()=>{
  session.denied=new Set(['procurement:write']);
  store.state!.fulfillment.purchases.push(purchase('ro'));
  render('ro');
  expect(host.textContent).toContain('只读查看');
  expect(queryByRole(host,'button',{name:'新建采购订单'})).toBeNull();
  expect((getByRole(host,'button',{name:'提交审批'}) as HTMLButtonElement).disabled).toBe(true);
  expect(host.textContent).toContain('提交审批：需要采购写权限');
  render('ro','list');
  expect(queryByRole(host,'button',{name:'新建采购订单'})).toBeNull();
  expect(host.textContent).toContain('只读查看');
});

it('records rejected goods returned to the supplier per receipt and shows replace / no-replace in the track',async()=>{
  store.state!.fulfillment.purchases.push(purchase('recv',approved({offlineSend:{at:'2026-10-04T08:00:00Z',actor:'经办人',evidence:'邮件',fileIds:[],revision:1},supplierConfirmation:{at:'2026-10-05T08:00:00Z',actor:'经办人',evidence:'回签',confirmedDue:'2026-10-30',fileIds:[],revision:1} as any,received:90})));
  store.state!.fulfillment.receipts.push({id:'r1',purchaseId:'recv',quantity:90,rejected:10,destination:'warehouse',location:'上海仓',date:'2026-10-12',evidence:'收货单',fileIds:[],actor:'仓库',createdAt:'2026-10-12T02:00:00Z',returns:[{id:'ret-1',quantity:4,disposition:'noReplace',date:'2026-10-12',evidence:'退货单',actor:'经办人',at:'2026-10-12T03:00:00Z'}]});
  render('recv');
  const detail=host.querySelector('[data-purchase-detail="recv"]') as HTMLElement;
  expect(detail.textContent).toContain('已拒收 10 个 · 不再补发 4 · 6 待登记退换');
  await click(getByRole(detail,'button',{name:'登记退货 / 换货'}));
  const dialog=getByRole(document.body,'dialog');
  expect((getByRole(dialog,'spinbutton',{name:'退回数量（个）'}) as HTMLInputElement).value).toBe('6');
  typeInto(getByRole(dialog,'textbox',{name:'退货单 / 供应商确认依据'}) as HTMLTextAreaElement,'退货单 RT-9');
  await click(getByRole(dialog,'button',{name:'登记退换'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.procurement.return',payload:expect.objectContaining({receiptId:'r1',quantity:6,disposition:'replace',evidence:'退货单 RT-9'})}));
});

it('cancels an approved contract without receipts, blocks it once goods arrived, and shows the cancelled banner',async()=>{
  store.state!.fulfillment.purchases.push(purchase('open',approved()),purchase('got',approved({received:20})),purchase('gone',{state:'cancelled',cancellation:{at:'2026-10-12T02:00:00Z',actor:'经办人',actorId:'buyer',reason:'客户取消订单',prepaid:0}} as any));
  store.state!.fulfillment.receipts.push({id:'rg',purchaseId:'got',quantity:20,rejected:0,destination:'warehouse',location:'上海仓',date:'2026-10-12',evidence:'收货单',fileIds:[],actor:'仓库',createdAt:'2026-10-12T02:00:00Z'} as any);
  render('open');
  let detail=host.querySelector('[data-purchase-detail="open"]') as HTMLElement;
  await click(getByRole(detail,'button',{name:'取消合同'}));
  const dialog=getByRole(document.body,'dialog');
  expect(dialog.textContent).toContain('取消后不恢复');
  typeInto(getByRole(dialog,'textbox',{name:'取消原因与工厂确认依据'}) as HTMLTextAreaElement,'客户取消，工厂邮件确认');
  await click(getByRole(dialog,'button',{name:'确认取消'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'payable.purchase.cancel',payload:expect.objectContaining({purchaseId:'open',reason:'客户取消，工厂邮件确认'})}));
  act(()=>root.unmount());host.remove();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  render('got');
  detail=host.querySelector('[data-purchase-detail="got"]') as HTMLElement;
  expect(queryByRole(detail,'button',{name:'取消合同'})).toBeNull();
  act(()=>root.unmount());host.remove();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  render('gone');
  detail=host.querySelector('[data-purchase-detail="gone"]') as HTMLElement;
  expect(detail.textContent).toContain('合同已取消');expect(detail.textContent).toContain('客户取消订单');
  expect(queryByRole(detail,'button',{name:'取消合同'})).toBeNull();
});

it('transfers an approved contract without receipts to another active supplier and links both contracts',async()=>{
  const base={type:'辅料',country:'CN',address:'',capabilities:'辅料',capacity:100,capacityUnit:'个',leadDays:7,blockReason:'',contacts:[],fileIds:[],note:'',createdAt:'',updatedAt:''};
  store.state!.market.suppliers=[{...base,id:'s',code:'S',name:'青禾辅料',status:'active'},{...base,id:'n',code:'N',name:'宝泰辅料',status:'active'},{...base,id:'x',code:'X',name:'已停用',status:'blocked',statusFrom:'2026-10-01',blockReason:'质量'}] as any;
  store.state!.fulfillment.purchases.push(purchase('open',approved()),purchase('moved',{state:'cancelled',cancellation:{at:'2026-10-12T02:00:00Z',actor:'经办人',reason:'转给 宝泰辅料：产能不足',prepaid:0},transferredTo:{purchaseId:'new',purchaseCode:'NEW',supplierId:'n',supplier:'宝泰辅料',reason:'产能不足',at:'2026-10-12T02:00:00Z',actor:'经办人'}} as any),purchase('new',{supplierId:'n',supplier:'宝泰辅料',transferredFrom:{purchaseId:'moved',purchaseCode:'MOVED',supplierId:'s',supplier:'青禾辅料',reason:'产能不足'}} as any));
  store.run.mockResolvedValue({result:{id:'new'}});
  render('open');
  let detail=host.querySelector('[data-purchase-detail="open"]') as HTMLElement;
  await click(getByRole(detail,'button',{name:'转给其他供应商'}));
  const dialog=getByRole(document.body,'dialog');
  expect(dialog.textContent).toContain('须重新提交审批');
  const supplier=getByRole(dialog,'combobox',{name:'新供应商'}) as HTMLSelectElement;
  expect([...supplier.options].map(o=>o.value)).toEqual(['','n']);
  act(()=>{supplier.value='n';supplier.dispatchEvent(new Event('change',{bubbles:true}));});
  typeInto(getByRole(dialog,'spinbutton',{name:/新单价/}) as HTMLInputElement,'0.32');
  typeInto(getByRole(dialog,'textbox',{name:'转移原因与原供应商确认依据'}) as HTMLTextAreaElement,'青禾产能不足，邮件同意取消');
  await click(getByRole(dialog,'button',{name:'确认转移'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'sourcing.purchase.transfer',payload:expect.objectContaining({purchaseId:'open',supplierId:'n',price:0.32,currency:'CNY',due:'2026-10-30',terms:'月结30天',reason:'青禾产能不足，邮件同意取消'})}));
  expect(go).toHaveBeenCalledWith('procurement','new');
  act(()=>root.unmount());host.remove();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  render('moved');
  detail=host.querySelector('[data-purchase-detail="moved"]') as HTMLElement;
  expect(detail.textContent).toContain('已转给 宝泰辅料（NEW）');
  expect(queryByRole(detail,'button',{name:'转给其他供应商'})).toBeNull();
  act(()=>root.unmount());host.remove();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  render('new');
  detail=host.querySelector('[data-purchase-detail="new"]') as HTMLElement;
  expect(detail.textContent).toContain('由 MOVED（青禾辅料）转入');
  await click(getByRole(detail,'button',{name:'查看原合同'}));
  expect(go).toHaveBeenCalledWith('procurement','moved');
});

it('compares RFQ quotes in CNY, requires a reason to award a non-lowest quote, and preselects the supplier the user came from',async()=>{
  const st=store.state!,base={type:'成衣加工',country:'CN',address:'',capabilities:'',capacity:100,capacityUnit:'件',leadDays:7,blockReason:'',contacts:[],fileIds:[],note:'',createdAt:'',updatedAt:'',status:'active' as const};
  st.market.suppliers=[{...base,id:'a',code:'A',name:'江南成衣',ratings:[{id:'r',grade:'A',period:'2026 Q3',note:'',at:'',actor:''}]},{...base,id:'b',code:'B',name:'远山服装'},{...base,id:'c',code:'C',name:'恒彩印花',status:'paused',statusFrom:'2026-10-01'}] as any;
  (st as any).fxPeriodRates=[{id:'fx',currency:'USD',month:'2026-09',rate:'7.1180'}];
  const q=(id:string,supplierId:string,supplier:string,price:number,currency:string,promisedDue:string)=>({id,supplierId,supplier,declined:false,declineReason:'',price,currency,moq:0,promisedDue,terms:'月结 30 天',validUntil:'2099-12-31',note:'',fileIds:[],at:'2026-10-12T01:00:00Z',actor:'经办人'});
  (st as any).rfqs=[{id:'rfq1',code:'RFQ-2026-0001',orderId:'o',lineId:'l',kind:'processing',domain:'garment',description:'风衣 CMT',quantity:100,unit:'件',currency:'CNY',due:'2099-01-31',destination:'嘉兴仓',deadline:'2099-01-10',supplierIds:['a','b'],quotes:[q('qa','a','江南成衣',80,'CNY','2099-01-20'),q('qb','b','远山服装',12,'USD','2099-01-25')],note:'',state:'open',createdAt:'2026-10-11T01:00:00Z',actor:'经办人'}];
  act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'procurement',section:'rfq:a'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><ProcurementPage/></Nav.Provider></ToastProvider></MistRoot>));
  expect(host.textContent).toContain('发起询价时已默认勾选 江南成衣');
  const list=getByRole(host,'table',{name:'询价单列表'});
  expect(list.textContent).toContain('RFQ-2026-0001');expect(list.textContent).toContain('80.00 CNY');expect(list.textContent).toContain('2 / 2 家');
  await click(getByRole(list,'row',{name:/RFQ-2026-0001/}));
  const detail=host.querySelector('[data-rfq-detail="rfq1"]') as HTMLElement;
  const cmp=getByRole(detail,'table',{name:'RFQ-2026-0001 比价'});
  expect(cmp.textContent).toContain('最低价');expect(cmp.textContent).toContain('≈ 85.416 CNY');expect(cmp.textContent).toContain('评级 A');
  await click(getByRole(detail,'button',{name:'定标 远山服装'}));
  let dialog=getByRole(document.body,'dialog');
  expect(dialog.textContent).toContain('非最低价（排名第 2）');
  await click(getByRole(dialog,'button',{name:'定标并生成采购草稿'}));
  expect(store.run).not.toHaveBeenCalled();
  typeInto(getByRole(dialog,'textbox',{name:'定标理由'}) as HTMLTextAreaElement,'交期更稳');
  await click(getByRole(dialog,'button',{name:'定标并生成采购草稿'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'rfq.award',payload:{id:'rfq1',quoteId:'qb',reason:'交期更稳'}});
  await click(getByRole(host,'button',{name:'发起询价'}));
  dialog=getByRole(document.body,'dialog');
  expect((getByRole(dialog,'checkbox',{name:/江南成衣/}) as HTMLInputElement).checked).toBe(true);
  expect((getByRole(dialog,'checkbox',{name:/远山服装/}) as HTMLInputElement).checked).toBe(false);
  expect(queryByRole(dialog,'checkbox',{name:/恒彩印花/})).toBeNull();
});

function postReceiptFixture(){
  store.state!.fulfillment.purchases.push(purchase('post',approved({received:110})));
  store.state!.fulfillment.receipts.push({id:'r-post',purchaseId:'post',quantity:110,rejected:0,destination:'warehouse',location:'上海仓',date:'2026-10-12',evidence:'原收货单',fileIds:[],actor:'仓库',createdAt:'2026-10-12T02:00:00Z'});
  store.state!.fulfillment.stock.push({id:'stock-post',receiptId:'r-post',purchaseId:'post',quantity:110,available:110,location:'上海仓'} as any);
}
it('submits a post-receipt rejection for the exact receipt and defaults to its over-delivery',async()=>{
  postReceiptFixture();render('post');await click(getByRole(host,'button',{name:'转为拒收'}));
  const dialog=getByRole(document.body,'dialog');
  expect((getByRole(dialog,'spinbutton',{name:'转拒收数量（个）'}) as HTMLInputElement).value).toBe('10');
  typeInto(getByRole(dialog,'textbox',{name:'拒收货物位置'}) as HTMLInputElement,'拒收区');
  typeInto(getByRole(dialog,'textbox',{name:'拒收依据'}) as HTMLTextAreaElement,'多交货物不予接受');
  await click(getByRole(dialog,'button',{name:'确认拒收'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.procurement.rejectReceived',payload:{receiptId:'r-post',quantity:10,location:'拒收区',evidence:'多交货物不予接受'}});
});
it('hides receipt rejection for read-only users and blocks settled receipts',()=>{
  postReceiptFixture();session.denied.add('procurement:write');render('post');
  expect(queryByRole(host,'button',{name:'转为拒收'})).toBeNull();
  session.denied.clear();store.state!.payables!.settlements!.push({id:'settled',purchaseId:'post',receiptIds:['r-post'],state:'confirmed',quantity:110,amount:33,submittedAt:'2026-10-12T02:00:00Z'} as any);render('post');
  const button=getByRole(host,'button',{name:'转为拒收'}) as HTMLButtonElement;expect(button.disabled).toBe(true);expect(button.title).toContain('结算');
});

it('uses the source product name and keeps full contract wording available on request',async()=>{
  store.state!.orderLines[0].style='FAB-1';
  store.state!.market.products.push({id:'product',sku:'FAB-1',name:'羊毛混纺斜纹'} as any);
  store.state!.fulfillment.purchases.push(purchase('brief',approved({kind:'finished',description:'羊毛70%，再生涤纶30%，300g，幅宽148cm，按确认样生产',note:'深藏青、浅石色各1500米'})));
  render('brief');
  const detail=host.querySelector('[data-purchase-detail="brief"]') as HTMLElement;
  expect(detail.querySelector('.mist-h2')?.textContent).toBe('羊毛混纺斜纹');
  expect(detail.textContent).not.toContain('羊毛70%');
  await click(getByRole(detail,'button',{name:'规格与约定'}));
  expect(detail.textContent).toContain('羊毛70%，再生涤纶30%，300g，幅宽148cm，按确认样生产');
  expect(store.state!.fulfillment.purchases[0].description).toContain('羊毛70%');
});
