// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentShipment,FulfillmentDocument,FulfillmentCustoms} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const session=vi.hoisted(()=>({denied:new Set<string>()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:'ops',displayName:'后勤'},sessionKey:'s',hasPermission:(p:string)=>!session.denied.has(p),canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {CustomsPage,customsFlags,rebateEvidence} from './CustomsPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(id?:string,section?:string){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'customs',id,section},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><CustomsPage/></Nav.Provider></ToastProvider></MistRoot>));}
async function click(node:HTMLElement){await act(async()=>node.click());}

it('shows the unresolved bank discrepancy in both the ledger and detail when the credit is fully occupied',async()=>{
 const st=store.state!;st.orders[0].governance={status:'approved',contract:{paymentMethod:'LC'}} as any;
 st.letterOfCredits=[{id:'lc-alert',code:'LC-ALERT',lcNo:'LC-ALERT',customerId:'c',customer:'Cedar',orderIds:['o'],issuingBank:'Issuing bank',advisingBank:'Advising bank',confirmed:false,availableBy:'sight',usanceDays:0,currency:'USD',amount:100,tolerancePct:0,issueDate:'2026-09-01',latestShipmentDate:'2099-01-31',expiryDate:'2099-02-21',expiryPlace:'上海',presentationDays:21,partialShipment:true,transhipment:false,documentsRequired:'CI, PL, BL',note:'',fileIds:[],amendments:[],presentations:[{id:'p-alert',no:1,shipmentId:'s',shipmentCode:'S',shipmentDate:'2026-10-10',presentedAt:'2026-10-12',deadline:'2026-10-31',amount:100,documents:'CI, PL, BL',autoDiscrepancies:[],discrepancies:'缺一份正本',result:'discrepant',history:[],createdAt:'2026-10-12T01:00:00Z',actor:'单证'}],createdAt:'2026-09-02T01:00:00Z',actor:'单证'}];
 render();await click(getByRole(host,'tab',{name:/信用证/}));const ledger=getByRole(host,'table',{name:'信用证台账'});
 expect(ledger.textContent).toContain('第 1 次交单有不符点');await click(getByRole(ledger,'row',{name:/LC-ALERT/}));
 const detail=host.querySelector('[data-lc-detail="lc-alert"]') as HTMLElement;expect(detail.textContent).toContain('需要关注');expect(detail.textContent).toContain('第 1 次交单有不符点');expect(detail.textContent).not.toContain('待申请人答复');expect(store.run).not.toHaveBeenCalled();
});
function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function choose(select:HTMLSelectElement,value:string){act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});expect(select.value).toBe(value);}
const shipment=(id:string,patch:Partial<FulfillmentShipment>={}):FulfillmentShipment=>({id,code:id.toUpperCase(),customerId:'c',customer:'Cedar',domain:'garment',consignee:'Cedar DC',mode:'sea',portOfLoading:'上海',portOfDischarge:'Felixstowe',incoterm:'FOB',plannedDate:'2099-01-01',booking:'',lines:[{orderId:'o',lineId:'l',productionId:'p',quantity:10,factoryConfirmedAt:'2026-10-09'}],note:'',fileIds:[],state:'preparing',requestedBy:'业务',requesterId:'biz',createdAt:'2026-10-08T08:00:00Z',...patch});
const pack=(shipmentId:string,quantity:number)=>({id:shipmentId+quantity,shipmentId,lineId:'l',productionId:'p',carton:'1',quantity,netWeight:9,grossWeight:10,volume:0.1,note:''});
const customs=(shipmentId:string,status:FulfillmentCustoms['status'],patch:Partial<FulfillmentCustoms>={}):FulfillmentCustoms=>({id:'cus-'+shipmentId,shipmentId,code:'CUS-'+shipmentId.toUpperCase(),status,declarationNo:status==='draft'?'':'D-'+shipmentId,broker:'上港报关',hsCode:'6202.13',origin:'CN',tradeMode:'一般贸易',declaredAt:status==='draft'?'':'2026-10-12',clearedAt:status==='cleared'?'2026-10-13':'',evidence:'',fileIds:[],note:'',...patch});
const ci=(shipmentId:string,invoiceId?:string):FulfillmentDocument=>({id:'ci-'+shipmentId,shipmentId,orderId:'o',type:'CI',number:'CI-'+shipmentId,version:1,title:'CI',dueDate:'2026-11-01',content:'',fileIds:[],status:'issued',createdAt:'2026-10-10T08:00:00Z',actor:'后勤',...(invoiceId?{invoiceId}:{})} as FulfillmentDocument);
beforeEach(()=>{session.denied=new Set();const s=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'后勤'},'empty');
  s.orders.push({id:'o',code:'SO-1',type:'garment',customerId:'c',customer:'Cedar',currency:'USD',due:'2026-11-08'} as any);s.orderLines.push({id:'l',orderId:'o',name:'大衣',style:'COAT-1',img:'coat',qty:10,unit:'件',price:10,made:10,qc:10} as any);
  store.state=s;store.run.mockReset();store.run.mockResolvedValue({result:{}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('shows fabric packing as packages without asserting they are cartons',()=>{
 const f=store.state!.fulfillment;f.shipments.push(shipment('fabric',{domain:'fabric'}));f.packing.push(pack('fabric',10));f.customs.push(customs('fabric','draft'));
 render('cus-fabric');const detail=host.querySelector('[data-customs-detail="cus-fabric"]') as HTMLElement;
 expect(detail.textContent).toContain('包件数');expect(detail.textContent).toContain('1 件');expect(detail.textContent).not.toContain('箱数');
});

it('derives customs reminders and rebate evidence only from recorded shipment, packing and receivable facts',()=>{
  const st=store.state!,f=st.fulfillment;
  f.shipments.push(shipment('a',{state:'ready',documentsSentAt:'2026-10-12T08:00:00Z'}),shipment('b'),shipment('c'),shipment('d',{state:'cancelled'}),shipment('e',{state:'departed'}));
  f.packing.push(pack('a',10),pack('c',4));
  const a=customs('a','submitted'),b=customs('b','draft'),c=customs('c','draft'),d=customs('d','submitted'),e=customs('e','cleared');
  expect(customsFlags(st,a).map(x=>x.key)).toEqual(['awaiting']);
  expect(customsFlags(st,b).map(x=>x.key)).toEqual(['unpacked']);
  expect(customsFlags(st,c).map(x=>x.key)).toEqual(['packing']);
  expect(customsFlags(st,d).map(x=>x.key)).toEqual(['cancelled']);
  expect(customsFlags(st,e)).toEqual([]);
  expect(rebateEvidence(st,e)).toMatchObject({released:true,collected:false,ready:1});
  f.documents.push(ci('e','inv-e'));st.invoices.push({id:'inv-e',code:'CI-e',orderId:'o',order:'SO-1',customer:'Cedar',due:'2026-11-01',amount:100,open:40,currency:'USD'});
  expect(rebateEvidence(st,e)).toMatchObject({collected:false,open:[{currency:'USD',amount:40}],ready:1});
  st.invoices[0].open=0;
  expect(rebateEvidence(st,e)).toMatchObject({collected:true,ready:2});
  st.invoices[0].voidedAt='2026-10-13T00:00:00Z';
  expect(rebateEvidence(st,e).collected).toBe(false);
  // 待财务确认的 CI 应收 open=0 只是尚未入账，不能当作已收汇。
  delete st.invoices[0].voidedAt;st.invoices[0].financeStatus='pending';
  expect(rebateEvidence(st,e)).toMatchObject({collected:false,invoices:[]});
});

it('hides the customs-cleared option without customs:clear and explains that logistics must record it',()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s'));f.packing.push(pack('s',10));f.customs.push(customs('s','submitted'));
  session.denied.add('customs:clear');render('cus-s');
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(queryByRole(detail,'button',{name:'登记海关放行'})).toBeNull();
  expect(queryByRole(detail,'button',{name:'更正申报信息'})).toBeNull();
  expect(detail.textContent).toContain('申报与清关须由后勤/单证登记');
  session.denied.delete('customs:clear');store.state={...store.state!};render('cus-s');
  const allowed=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(getByRole(allowed,'button',{name:'登记海关放行'})).toBeTruthy();
  expect(getByRole(allowed,'button',{name:'更正申报信息'})).toBeTruthy();
  expect(allowed.textContent).not.toContain('申报与清关须由后勤/单证登记');
});

it('hides the declare action on drafts without customs:clear',()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s'));f.packing.push(pack('s',10));f.customs.push(customs('s','draft'));
  session.denied.add('customs:clear');render('cus-s');
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(queryByRole(detail,'button',{name:'登记已申报'})).toBeNull();
  expect(detail.textContent).toContain('申报与清关须由后勤/单证登记');
  session.denied.delete('customs:clear');store.state={...store.state!};render('cus-s');
  expect(getByRole(host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement,'button',{name:'登记已申报'})).toBeTruthy();
});

it('lists shipments still awaiting a customs record and creates the draft from that row',async()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s1'),shipment('s2'),shipment('s3',{state:'departed'}));f.customs.push(customs('s2','draft'));
  render();
  const pending=getByRole(host,'table',{name:'待建报关的出运'});
  expect(pending.textContent).toContain('S1');expect(pending.textContent).not.toContain('S2');expect(pending.textContent).not.toContain('S3');
  expect(getByRole(host,'table',{name:'报关列表'}).textContent).toContain('CUS-S2');
  await click(getByRole(pending,'button',{name:'为 S1 建立报关记录'}));
  const dialog=getByRole(document.body,'dialog');expect(getByRole(host,'table',{name:'报关列表'})).toBeTruthy();
  await click(getByRole(dialog,'button',{name:'建立记录'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.customs.save',payload:expect.objectContaining({shipmentId:'s1',status:'draft',declarationNo:'',fileIds:[]})});
});

it('registers the declaration and then the release in dialogs, and stops edits once released',async()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s'));f.packing.push(pack('s',10));f.customs.push(customs('s','draft'));
  render('cus-s');
  let detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(detail.textContent).toContain('未申报');
  expect(detail.textContent).not.toContain('向海关申报后，登记');
  await click(getByRole(detail,'button',{name:'登记已申报'}));
  let dialog=getByRole(document.body,'dialog');
  typeInto(getByRole(dialog,'textbox',{name:'报关单号'}) as HTMLInputElement,'223320260001');
  await click(getByRole(dialog,'button',{name:'登记已申报'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.customs.save',payload:expect.objectContaining({id:'cus-s',shipmentId:'s',status:'submitted',declarationNo:'223320260001',broker:'上港报关',hsCode:'6202.13'})});
  Object.assign(f.customs[0],{status:'submitted',declarationNo:'223320260001',declaredAt:'2026-10-12'});store.state={...store.state!};render('cus-s');
  detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(queryByRole(detail,'button',{name:'编辑报关资料'})).toBeNull();
  await click(getByRole(detail,'button',{name:'登记海关放行'}));
  dialog=getByRole(document.body,'dialog');
  typeInto(getByRole(dialog,'textbox',{name:'放行依据'}) as HTMLTextAreaElement,'海关放行通知');
  await click(getByRole(dialog,'button',{name:'登记放行'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.customs.save',payload:expect.objectContaining({id:'cus-s',status:'cleared',declarationNo:'223320260001',declaredAt:'2026-10-12',evidence:'海关放行通知'})});
  Object.assign(f.customs[0],{status:'cleared',clearedAt:'2026-10-13',evidence:'海关放行通知'});store.state={...store.state!};render('cus-s');
  detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(queryByRole(detail,'button',{name:'登记海关放行'})).toBeNull();
  expect(detail.textContent).toContain('已放行记录不可覆盖');
  expect(detail.textContent).toContain('增值税专用发票');
});

it('explains why a departed shipment\'s record is locked and keeps users without customs permission read-only',()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s',{state:'departed'}),shipment('t'));f.customs.push(customs('s','submitted'));
  render('cus-s');
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect((getByRole(detail,'button',{name:'登记海关放行'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('出运已离港或已取消，报关记录不能再修改');
  session.denied.add('customs:write');render('cus-s');
  expect(host.textContent).not.toContain('你的账号没有报关单证权限');
  expect(queryByRole(host,'button',{name:'建立报关记录'})).toBeNull();
  expect(queryByRole(host,'button',{name:'为 T 建立报关记录'})).toBeNull();
  expect(queryByRole(host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement,'button',{name:'登记海关放行'})).toBeNull();
});

it('keeps a letter of credit ledger with terms, presentations and bank results, and flags approved LC orders without a registered credit',async()=>{
  const st=store.state!,f=st.fulfillment;
  const gov=(note:string)=>({status:'approved',rounds:[],effectiveVersion:1,contract:{kind:'external',poNumber:'PO',confirmationFileIds:[],internalPurpose:'',receiver:'',paymentMethod:'LC',depositPercent:null,paymentNote:note,incoterm:'FOB',deliveryPlace:'上海'}});
  (st.orders[0] as any).governance=gov('L/C at sight');
  st.orders.push({id:'o2',code:'SO-2',type:'garment',customerId:'c',customer:'Cedar',currency:'USD',due:'2026-12-01',governance:gov('L/C 60 days')} as any);
  f.shipments.push(shipment('s',{state:'departed'}),shipment('t'));
  (st as any).letterOfCredits=[{id:'lc1',code:'LC-2026-0001',lcNo:'LCA2026001',customerId:'c',customer:'Cedar',orderIds:['o'],issuingBank:'Barclays London',advisingBank:'中国银行上海分行',confirmed:false,availableBy:'sight',usanceDays:0,currency:'USD',amount:100,tolerancePct:5,issueDate:'2026-09-01',latestShipmentDate:'2099-01-31',expiryDate:'2099-02-21',expiryPlace:'中国',presentationDays:21,partialShipment:true,transhipment:false,documentsRequired:'商业发票一式三份',note:'',fileIds:[],
    amendments:[{no:1,date:'2026-09-20',changes:[{field:'expiryDate',label:'有效期',from:'2099-01-21',to:'2099-02-21'}],note:'展期',at:'2026-09-20T01:00:00Z',actor:'单证'}],
    presentations:[{id:'p1',no:1,shipmentId:'s',shipmentCode:'S',shipmentDate:'2026-10-10',presentedAt:'2026-10-12',deadline:'2026-10-31',amount:60,documents:'发票',autoDiscrepancies:[],discrepancies:'',result:'pending',history:[],createdAt:'2026-10-12T01:00:00Z',actor:'单证'}],createdAt:'2026-09-02T01:00:00Z',actor:'单证'}];
  render();
  await click(getByRole(host,'tab',{name:/信用证/}));
  expect(host.textContent).toContain('未登记来证 · 1');
  const ledger=getByRole(host,'table',{name:'信用证台账'});
  expect(ledger.textContent).toContain('LCA2026001');expect(ledger.textContent).toContain('可用 45.00 USD');expect(ledger.textContent).toContain('有效');
  const orders=getByRole(host,'table',{name:'信用证付款订单'});
  expect(orders.textContent).toContain('SO-2');expect(orders.textContent).toContain('未登记来证');expect(orders.textContent).toContain('L/C 60 days');
  await click(getByRole(ledger,'row',{name:/LCA2026001/}));
  const detail=host.querySelector('[data-lc-detail="lc1"]') as HTMLElement;
  expect(detail.textContent).toContain('有效期：2099-01-21 → 2099-02-21');expect(detail.textContent).toContain('装运后 21 天内');
  expect((getByRole(detail,'button',{name:'注销信用证'}) as HTMLButtonElement).disabled).toBe(true);
  await click(getByRole(detail,'button',{name:'登记第 1 次交单审单结果'}));
  let dialog=getByRole(document.body,'dialog');
  await click(getByRole(dialog,'button',{name:'登记结果'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'lc.presentation.result',payload:expect.objectContaining({id:'lc1',presentationId:'p1',result:'complying'})});
  await click(getByRole(dialog,'button',{name:'取消'}));
  await click(getByRole(detail,'button',{name:'登记交单'}));
  dialog=getByRole(document.body,'dialog');
  expect(getByRole(dialog,'combobox',{name:'出运'}).textContent).toContain('T');expect(getByRole(dialog,'combobox',{name:'出运'}).textContent).not.toContain('S ·');
  await click(getByRole(dialog,'button',{name:'取消'}));
  await click(getByRole(host,'button',{name:'登记信用证'}));
  expect(queryByRole(document.body,'dialog')).toBeNull();expect(getByRole(host,'heading',{name:'登记信用证'})).toBeTruthy();
  typeInto(host.querySelector('input[aria-label="信用证号"]') as HTMLInputElement,'lcb-2');typeInto(host.querySelector('input[aria-label="开证行"]') as HTMLInputElement,'HSBC');expect(queryByRole(host,'spinbutton',{name:'远期天数'})).toBeNull();
  await click(getByRole(host,'button',{name:'下一步'}));await click(getByRole(host,'checkbox',{name:/SO-2/}));await click(getByRole(host,'button',{name:'下一步'}));
  typeInto(host.querySelector('input[aria-label="信用证金额"]') as HTMLInputElement,'500');typeInto(host.querySelector('input[aria-label="最晚装运日"]') as HTMLInputElement,'2099-01-10');typeInto(host.querySelector('input[aria-label="有效期"]') as HTMLInputElement,'2099-01-31');
  expect(queryByRole(host,'spinbutton',{name:'金额容差 %'})).toBeTruthy();await click(getByRole(host,'button',{name:'下一步'}));await click(getByRole(host,'button',{name:'下一步'}));await click(getByRole(host,'button',{name:'登记信用证'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'lc.save',payload:{input:expect.objectContaining({lcNo:'lcb-2',issuingBank:'HSBC',orderIds:['o2'],currency:'USD',amount:'500',availableBy:'sight',latestShipmentDate:'2099-01-10',expiryDate:'2099-01-31',presentationDays:'21'})}});
});

it('lists rebate evidence without inventing refund amounts',async()=>{
  const st=store.state!,f=st.fulfillment;
  f.shipments.push(shipment('s',{state:'departed'}));f.customs.push(customs('s','cleared'));f.documents.push(ci('s','inv'));
  st.invoices.push({id:'inv',code:'CI-s',orderId:'o',order:'SO-1',customer:'Cedar',due:'2026-11-01',amount:100,open:0,currency:'USD'});
  render();
  await click(getByRole(host,'tab',{name:/退税/}));
  const rebate=getByRole(host,'table',{name:'退税资料核对'});
  expect(rebate.textContent).toContain('已全部收汇');expect(rebate.textContent).toContain('未登记');expect(rebate.textContent).toContain('缺退税率');expect(rebate.textContent).toContain('2 / 3');
  expect(host.textContent).toContain('还没有退税率');
});

it('lets finance match VAT special invoices to a departed declaration and file the rebate claim',async()=>{
  const st=store.state!,f=st.fulfillment;
  f.shipments.push(shipment('s',{state:'departed',departedAt:'2026-10-13T02:00:00Z'} as any));f.customs.push(customs('s','cleared',{hsCode:'6202.1300'}));
  f.purchases.push({id:'po',code:'PC-1',orderId:'o'} as any);
  st.files.push({id:'vat-proof',name:'vat-special.pdf',mimeType:'application/pdf',size:10,storageKey:'test/vat-proof',createdAt:'2026-10-10T00:00:00Z'});
  st.payables!.bills.push({invoiceType:'vat-special',id:'b1',code:'AP-1',supplierId:'sup',supplier:'嘉兴制衣',invoiceNo:'0451001',invoiceDate:'2026-10-10',currency:'CNY',amount:113000,taxAmount:13000,taxRate:'13%',lines:[{purchaseId:'po'}],terms:[],due:'2026-11-10',dueBasis:'',fileIds:['vat-proof'],note:'',state:'open',registeredAt:'2026-10-10T00:00:00Z',registeredBy:'财务'} as any);
  (st as any).exportRebate={rates:[{id:'rt',code:'RR-1',hsCode:'6202.13',rate:'13',effectiveFrom:'2020-03-20',basis:'公告',createdAt:'2026-10-01T00:00:00Z',actor:'财务'}],claims:[]};
  render();
  await click(getByRole(host,'tab',{name:/退税/}));
  const table=getByRole(host,'table',{name:'退税资料核对'});
  expect(table.textContent).toContain('可配 1 张');expect(table.textContent).toContain('预计 13,000.00 CNY');expect(table.textContent).toContain('2 / 3');
  await click(Array.from(table.querySelectorAll('[role="row"]')).find(r=>r.textContent?.includes('D-s')) as HTMLElement);
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(getByRole(detail,'table',{name:'CUS-S 可配专票'}).textContent).toContain('0451001');
  await click(getByRole(detail,'button',{name:'登记退税申报'}));
  const dialog=getByRole(document.body,'dialog');
  typeInto(getByRole(dialog,'textbox',{name:'申报批次号 / 受理回执号'}) as HTMLInputElement,'202610-01');
  await click(getByRole(dialog,'button',{name:'登记申报'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'rebate.claim.file',payload:expect.objectContaining({customsId:'cus-s',billIds:['b1'],batchRef:'202610-01'})});
  session.denied.add('invoices:write');render();
  expect(queryByRole(host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement,'button',{name:'登记退税申报'})).toBeNull();
});

it('distinguishes the published rebate rate from a lower input VAT ceiling',async()=>{
 const st=store.state!,f=st.fulfillment;
 f.shipments.push(shipment('low-rate',{state:'departed',departedAt:'2026-10-13T02:00:00Z'} as any));f.customs.push(customs('low-rate','cleared',{hsCode:'6202200000'}));
 f.purchases.push({id:'low-po',code:'PO-LOW',orderId:'o'} as any);
 st.files.push({id:'low-vat',name:'input-vat.pdf',mimeType:'application/pdf',size:10,storageKey:'test/input-vat',createdAt:'2026-10-10T00:00:00Z'});
 st.payables!.bills.push({invoiceType:'vat-special',id:'low-bill',code:'AP-LOW',supplierId:'sup',supplier:'嘉兴制衣',invoiceNo:'LOW-3',invoiceDate:'2026-10-10',currency:'CNY',amount:10300,taxAmount:300,taxRate:'3%',lines:[{purchaseId:'low-po',amount:10300}],terms:[],due:'2026-11-10',dueBasis:'月结',fileIds:['low-vat'],note:'',state:'open',registeredAt:'2026-10-10T00:00:00Z',registeredBy:'财务'} as any);
 st.exportRebate={rates:[{id:'low-policy',code:'RR-LOW',hsCode:'6202200000',rate:'13',effectiveFrom:'2020-03-20',basis:'文库',createdAt:'2026-10-01T00:00:00Z',actor:'财务'}],claims:[]};
 render();await click(getByRole(host,'tab',{name:/退税/}));const table=getByRole(host,'table',{name:'退税资料核对'});expect(table.textContent).toContain('预计 300.00 CNY');await click(Array.from(table.querySelectorAll('[role="row"]')).find(r=>r.textContent?.includes('D-low-rate')) as HTMLElement);
 const detail=host.querySelector('[data-customs-detail="cus-low-rate"]') as HTMLElement;expect(detail.textContent).toContain('文库退税率');const bills=getByRole(detail,'table',{name:'CUS-LOW-RATE 可配专票'});expect(bills.textContent).toContain('对应进项税额');expect(bills.textContent).toContain('进项封顶');expect(bills.textContent).not.toContain('1,300.00');expect(store.run).not.toHaveBeenCalled();
});

it('computes the rebate per declaration item HS once items exist, and blocks filing until every item has a rate',async()=>{
  const st=store.state!,f=st.fulfillment;
  f.shipments.push(shipment('s',{state:'departed',departedAt:'2026-10-13T02:00:00Z'} as any));
  const item=(no:number,hsCode:string,key:string)=>({no,classificationId:'c'+no,lineKeys:[key],styles:[],hsCode,declaredName:'x',elements:'',quantity:1,unit:'件',legalQty:1,legalUnit:'件',secondQty:null,secondUnit:'',unitPrice:1,amount:1,currency:'USD',origin:'CN',destination:'US'});
  f.customs.push(customs('s','cleared',{hsCode:'6202.1300',items:[item(1,'6203.3100','l1:p'),item(2,'6204.6200','l2:p')]} as any));
  f.purchases.push({id:'po1',code:'PC-1',orderId:'o',lineId:'l1'} as any,{id:'po2',code:'PC-2',orderId:'o',lineId:'l2'} as any);
  st.files.push({id:'vat-proof',name:'vat-special.pdf',mimeType:'application/pdf',size:10,storageKey:'test/vat-proof',createdAt:'2026-10-10T00:00:00Z'});
  st.payables!.bills.push({invoiceType:'vat-special',id:'b1',code:'AP-1',supplierId:'sup',supplier:'嘉兴制衣',invoiceNo:'0451001',invoiceDate:'2026-10-10',currency:'CNY',amount:113000,taxAmount:13000,taxRate:'13%',lines:[{purchaseId:'po1',purchaseCode:'PC-1',amount:56500},{purchaseId:'po2',purchaseCode:'PC-2',amount:56500}],terms:[],due:'2026-11-10',dueBasis:'',fileIds:['vat-proof'],note:'',state:'open',registeredAt:'2026-10-10T00:00:00Z',registeredBy:'财务'} as any);
  (st as any).exportRebate={rates:[{id:'rt',code:'RR-1',hsCode:'6203.31',rate:'13',effectiveFrom:'2020-03-20',basis:'公告',createdAt:'2026-10-01T00:00:00Z',actor:'财务'}],claims:[]};
  render();
  await click(getByRole(host,'tab',{name:/退税/}));
  await click(Array.from(getByRole(host,'table',{name:'退税资料核对'}).querySelectorAll('[role="row"]')).find(r=>r.textContent?.includes('D-s')) as HTMLElement);
  let detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(detail.textContent).toContain('按商品项');
  expect((getByRole(detail,'button',{name:'登记退税申报'}) as HTMLButtonElement).disabled).toBe(true);
  (st as any).exportRebate.rates.push({id:'rt9',code:'RR-2',hsCode:'6204.62',rate:'9',effectiveFrom:'2020-03-20',basis:'公告',createdAt:'2026-10-01T00:00:00Z',actor:'财务'});
  render();
  detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  const table=getByRole(detail,'table',{name:'CUS-S 可配专票'});
  expect(table.textContent).toContain('第 1 项 13%');expect(table.textContent).toContain('第 2 项 9%');
  // 计税 50000 × 13% + 50000 × 9% = 11000
  expect(table.textContent).toContain('11,000.00 CNY');
  expect((getByRole(detail,'button',{name:'登记退税申报'}) as HTMLButtonElement).disabled).toBe(false);
});
it('lists missing classifications instead of guessing, and creates a style classification from the 商品归类 tab',async()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s'));f.packing.push(pack('s',10));f.customs.push(customs('s','draft'));
  render('cus-s');
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(detail.textContent).toContain('款号 COAT-1 · 大衣 尚未建立商品归类');
  expect((getByRole(detail,'button',{name:'生成申报商品项'}) as HTMLButtonElement).disabled).toBe(true);
  await click(getByRole(detail,'button',{name:'维护商品归类'}));
  expect(getByRole(host,'tab',{name:/商品归类/}).getAttribute('aria-selected')).toBe('true');
  await click(getByRole(host,'button',{name:'新建归类'}));
  const dialog=getByRole(document.body,'dialog');
  for(const [name,value] of [['商品编号（10 位）','6202.9300.00'],['申报品名','女式化纤制大衣'],['适用款号','COAT-1'],['成分含量','100%涤纶']]) typeInto(getByRole(dialog,'textbox',{name}) as HTMLInputElement,value);
  for(const [name,value] of [['织造方法','机织'],['种类','大衣'],['类别','女式']]) choose(getByRole(dialog,'combobox',{name}) as HTMLSelectElement,value);
  await click(getByRole(dialog,'button',{name:'建立归类'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.customs.classify.save',payload:expect.objectContaining({family:'garment',hsCode:'6202.9300.00',declaredName:'女式化纤制大衣',styles:['COAT-1'],brandType:'0',preference:'0',elements:['机织','大衣','女式','100%涤纶','无品牌'],secondUnit:'千克'})});
});

it('generates declaration items on the server once every shipped style is classified',async()=>{
  const st=store.state!,f=st.fulfillment;f.shipments.push(shipment('s',{state:'ready'}));f.packing.push(pack('s',10));f.customs.push(customs('s','draft'));
  f.customsClassifications=[{id:'hs1',code:'HSC-0001',family:'garment',hsCode:'6202930000',declaredName:'女式化纤制大衣',brandType:'0',preference:'0',elements:['机织','大衣','女式','100%涤纶','无品牌'],legalUnit:'件',secondUnit:'千克',styles:['COAT-1'],note:'',createdAt:'2026-10-12T08:00:00Z',actor:'后勤'}];
  render('cus-s');
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(detail.textContent).not.toContain('尚未建立商品归类');
  await click(getByRole(detail,'button',{name:'生成申报商品项'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.customs.items',payload:{id:'cus-s'}});
});

it('adjusts a generated declaration item by hand with a reason and shows the adjustment trail',async()=>{
  const st=store.state!,f=st.fulfillment;f.shipments.push(shipment('s',{state:'ready'}));f.packing.push(pack('s',10));
  const item={no:1,classificationId:'hs1',lineKeys:['l1:'],styles:['COAT-1'],hsCode:'6202930000',declaredName:'女式化纤制大衣',elements:'0|0|机织|大衣|女式|100%涤纶|无品牌|货号COAT-1',quantity:10,unit:'件',legalQty:10,legalUnit:'件',secondQty:10,secondUnit:'千克',unitPrice:50,amount:500,currency:'USD',origin:'中国',destination:'瑞典'};
  f.customs.push({...customs('s','draft'),items:[item,{...item,no:2,declaredName:'女式棉制大衣',adjusted:{at:'2026-10-18T02:00:00Z',actor:'后勤',reason:'报关行审单',fields:['declaredName']},generated:{declaredName:'女式化纤制大衣'}}],itemsAt:'2026-10-18T01:00:00Z',itemsBy:'后勤'} as never);
  render('cus-s');
  const detail=host.querySelector('[data-customs-detail="cus-s"]') as HTMLElement;
  expect(detail.querySelector('[data-customs-item-adjusted="2"]')?.textContent).toContain('申报品名 · 后勤 · 报关行审单');
  await click(getByRole(detail,'button',{name:'调整商品项 1'}));
  const dialog=getByRole(document.body,'dialog');
  expect(queryByRole(dialog,'spinbutton',{name:/单价|总价|成交数量/})).toBeNull();
  typeInto(getByRole(dialog,'textbox',{name:'申报品名'}) as HTMLInputElement,'女式涤纶制大衣');
  typeInto(getByRole(dialog,'textbox',{name:'调整原因'}) as HTMLInputElement,'按规范申报目录');
  await click(getByRole(dialog,'button',{name:'保存调整'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.customs.item.adjust',payload:{id:'cus-s',no:1,declaredName:'女式涤纶制大衣',elements:item.elements,legalQty:10,secondQty:10,reason:'按规范申报目录'}});
});


it('opens classification maintenance inside an exact shipment context and returns to that same declaration',async()=>{
 const f=store.state!.fulfillment;f.shipments.push(shipment('scoped'));f.packing.push(pack('scoped',10));f.customs.push(customs('scoped','draft'));render('cus-scoped','scoped');
 const detail=host.querySelector('[data-customs-detail="cus-scoped"]') as HTMLElement;await click(getByRole(detail,'button',{name:'维护商品归类'}));expect(getByRole(host,'button',{name:'新建归类'})).toBeTruthy();expect(getByRole(host,'button',{name:'返回出运'})).toBeTruthy();expect(host.querySelector('[data-customs-detail]')).toBeNull();
 await click(getByRole(host,'button',{name:'返回本票报关'}));expect(host.querySelector('[data-customs-detail="cus-scoped"]')).toBeTruthy();expect(go).not.toHaveBeenCalled();expect(store.run).not.toHaveBeenCalled();
});

it('requires usance days only for a usance credit and closes a page editor when write authority is revoked',async()=>{
 const order=store.state!.orders[0];order.governance={status:'approved',contract:{paymentMethod:'LC'}} as any;render();await click(getByRole(host,'tab',{name:/信用证/}));await click(getByRole(host,'button',{name:'登记信用证'}));expect(queryByRole(host,'spinbutton',{name:'远期天数'})).toBeNull();
 const method=getByRole(host,'combobox',{name:'付款期限'}) as HTMLSelectElement;await act(async()=>{method.value='usance';method.dispatchEvent(new Event('change',{bubbles:true}));});expect(getByRole(host,'spinbutton',{name:'远期天数'})).toBeTruthy();typeInto(host.querySelector('input[aria-label="信用证号"]') as HTMLInputElement,'LC-NEW');typeInto(host.querySelector('input[aria-label="开证行"]') as HTMLInputElement,'Issuing bank');await click(getByRole(host,'button',{name:'下一步'}));expect(host.textContent).toContain('请填写远期天数');
 typeInto(host.querySelector('input[aria-label="远期天数"]') as HTMLInputElement,'30');await click(getByRole(host,'button',{name:'下一步'}));expect(getByRole(host,'checkbox',{name:/SO-1/})).toBeTruthy();session.denied.add('customs:write');render();expect(queryByRole(host,'heading',{name:'登记信用证'})).toBeNull();expect(queryByRole(host,'button',{name:'登记信用证'})).toBeNull();expect(store.run).not.toHaveBeenCalled();
});

it('shows partially visible credit without the full bank amount or original file',async()=>{store.state!.partialLettersOfCredit=[{id:'partial-lc',code:'LC-P',lcNo:'LC-PARTIAL',customerId:'c',customer:'Cedar',currency:'USD',orderIds:['o'],hiddenCount:1,cancelled:false}];render();await click(getByRole(host,'tab',{name:/信用证/}));const list=getByRole(host,'list',{name:'部分可见信用证'});expect(list.textContent).toContain('LC-PARTIAL');expect(list.textContent).toContain('另有 1 笔其他范围业务');expect(list.textContent).not.toContain('1000');});
