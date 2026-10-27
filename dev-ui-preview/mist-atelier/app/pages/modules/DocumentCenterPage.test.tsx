// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,getAllByRole,getByRole,queryByRole,getByLabelText,queryByLabelText} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentShipment,FulfillmentDocument} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const session=vi.hoisted(()=>({denied:new Set<string>()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:'ops',displayName:'后勤'},sessionKey:'s',hasPermission:(p:string)=>!session.denied.has(p),canAccessView:(view:string)=>view!=='system-settings'||!session.denied.has('settings:system:read')}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {DocumentCenterPage,issueBlocker} from './DocumentCenterPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(id?:string,section?:string){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'document-center',id,section},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DocumentCenterPage/></Nav.Provider></ToastProvider></MistRoot>));}
async function click(node:HTMLElement){await act(async()=>node.click());}
function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
const shipment=(id:string,patch:Partial<FulfillmentShipment>={}):FulfillmentShipment=>({id,code:id.toUpperCase(),customerId:'c',customer:'Cedar',domain:'garment',consignee:'Cedar DC',mode:'sea',portOfLoading:'上海',portOfDischarge:'Felixstowe',incoterm:'FOB',plannedDate:'2099-01-01',booking:'',lines:[{orderId:'o',lineId:'l',productionId:'p',quantity:10,factoryConfirmedAt:'2026-10-09'}],note:'',fileIds:[],state:'preparing',requestedBy:'业务',requesterId:'biz',createdAt:'2026-10-08T08:00:00Z',...patch});
const doc=(id:string,type:FulfillmentDocument['type'],patch:Partial<FulfillmentDocument>={}):FulfillmentDocument=>({id,shipmentId:'s',orderId:type==='CI'?'o':'',type,number:type+'-'+id,version:1,title:type+' 标题',dueDate:type==='CI'?'2026-11-01':'',content:'正文',fileIds:['file'],status:'draft',createdAt:'2026-10-10T08:00:00Z',actor:'后勤',...patch});
const pack=(quantity:number)=>({id:'pk'+quantity,shipmentId:'s',lineId:'l',productionId:'p',carton:'1',quantity,netWeight:9,grossWeight:10,volume:0.1,note:''});
beforeEach(()=>{session.denied=new Set();const s=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'后勤'},'empty');
  s.orders.push({id:'o',code:'SO-1',type:'garment',customerId:'c',customer:'Cedar',currency:'USD'} as any);s.orderLines.push({id:'l',orderId:'o',name:'大衣',style:'COAT-1',img:'coat',qty:10,unit:'件',price:10,made:10,qc:10} as any);
  s.fulfillment.shipments.push(shipment('s'));
  store.state=s;store.run.mockReset();store.run.mockResolvedValue({result:{}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('explains every issue precondition the backend enforces before a draft can be issued',()=>{
  const st=store.state!,f=st.fulfillment;
  const pl=doc('pl','PL',{fileIds:[]});
  expect(issueBlocker(st,pl)).toBe('请先上传核对后的正式单据文件');
  pl.fileIds=['file'];expect(issueBlocker(st,pl)).toBe('装箱分配与计划数量不一致');
  f.packing.push(pack(10));expect(issueBlocker(st,pl)).toBe('');
  f.documents.push(doc('pl0','PL',{status:'issued'}));expect(issueBlocker(st,pl)).toBe('相同来源已有有效版本，请先作废');
  f.shipments[0].state='departed';expect(issueBlocker(st,doc('ci','CI'))).toBe('出运已离港或已取消');
  expect(issueBlocker(st,doc('bl','BL'))).toBe('');
  expect(issueBlocker(st,doc('bl2','BL',{fileIds:[]}))).toBe('请先上传外部机构签发的原件');
});

it('keeps voided versions out of the current list and lets the user walk the version history',async()=>{
  const f=store.state!.fulfillment;f.documents.push(doc('v1','PL',{status:'void',number:'PL-OLD'}),doc('v2','PL',{version:2,status:'issued',number:'PL-NEW',issuedAt:'2026-10-12T08:00:00Z'}));
  render();
  const table=getByRole(host,'table',{name:'单据列表'});
  expect(table.textContent).toContain('PL-NEW');expect(table.textContent).not.toContain('PL-OLD');expect(table.textContent).toContain('共 2 版');
  await click(getByRole(host,'button',{name:/已作废/}));
  expect(getByRole(host,'table',{name:'单据列表'}).textContent).toContain('PL-OLD');
  render('v2');
  const detail=host.querySelector('[data-document-detail="v2"]') as HTMLElement;
  const versions=getByRole(detail,'table',{name:'PL-NEW 版本'});
  expect(versions.textContent).toContain('V1');expect(versions.textContent).toContain('已作废');
  expect(getByRole(detail,'button',{name:'作废当前版本'})).toBeTruthy();
  expect(getByRole(detail,'button',{name:'建立新版本'})).toBeTruthy();
});

it('issues a CI after confirmation and offers a new version only from the latest one',async()=>{
  const f=store.state!.fulfillment;f.documents.push(doc('ci','CI'));
  render('ci');
  let detail=host.querySelector('[data-document-detail="ci"]') as HTMLElement;
  expect(detail.textContent).toContain('待签发');
  await click(getByRole(detail,'button',{name:'签发'}));
  const dialog=getByRole(document.body,'dialog');expect(getByRole(host,'table',{name:'单据列表'})).toBeTruthy();
  await click(getByRole(dialog,'button',{name:'确认签发'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.documents.issue',payload:{id:'ci'}});
  Object.assign(f.documents[0],{status:'issued',issuedAt:'2026-10-13T08:00:00Z',invoiceId:'inv'});store.state!.invoices.push({id:'inv',code:'CI-ci',orderId:'o',order:'SO-1',customer:'Cedar',due:'2026-11-01',amount:100,open:60,currency:'USD'});
  store.state={...store.state!};render('ci');
  detail=host.querySelector('[data-document-detail="ci"]') as HTMLElement;
  expect(detail.textContent).toContain('USD 100.00');
  expect((getByRole(detail,'button',{name:'作废当前版本'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('CI 已有收款，请先走财务更正');
  await click(getByRole(detail,'button',{name:'建立新版本'}));
  const versionDialog=getByRole(document.body,'dialog');
  typeInto(getByRole(versionDialog,'textbox',{name:'实际单据编号'}) as HTMLInputElement,'CI-ci-2');
  await click(getByRole(versionDialog,'button',{name:'保存为草稿'}));
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.documents.save',payload:expect.objectContaining({shipmentId:'s',orderId:'o',type:'CI',number:'CI-ci-2',fileIds:[],baseDocumentId:'ci'})});
  expect(store.run.mock.calls.at(-1)![0].payload.id).toBeUndefined();
});

it('archives an external BL original instead of offering company issue',async()=>{
  store.state!.fulfillment.documents.push(doc('bl','BL',{number:'EXT-BL'}));
  render('bl');
  const detail=host.querySelector('[data-document-detail="bl"]') as HTMLElement;
  expect(queryByRole(detail,'button',{name:'签发'})).toBeNull();
  await click(getByRole(detail,'button',{name:'归档外部签发原件'}));
  const dialog=getByRole(document.body,'dialog',{name:'归档外部机构原件'});
  act(()=>fireEvent.change(getByRole(dialog,'combobox',{name:'外部签发机构'}),{target:{value:'__custom__'}}));
  typeInto(getByRole(dialog,'textbox',{name:'外部签发机构（手动填写）'}) as HTMLInputElement,'COSCO');
  typeInto(getByRole(dialog,'textbox',{name:'原件来源依据'}) as HTMLTextAreaElement,'船公司电放');
  await click(getByRole(dialog,'button',{name:'归档原件'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.documents.archiveExternal',payload:expect.objectContaining({id:'bl',issuer:'COSCO',evidence:'船公司电放'})});
});

it('keeps users without document permission read-only and shows the letterhead source',async()=>{
  session.denied.add('customs:write');store.state!.fulfillment.documents.push(doc('pl','PL'));
  store.state!.settings.companyProfile={legalName:'竹衍服饰',englishName:'Bambook Apparel',address:'上海',englishAddress:'',phone:'',email:'',taxId:'TAX1',customsCode:'',bankName:'',bankAccount:'',swift:'',defaultCurrency:'USD'};
  render('pl');
  expect(host.textContent).not.toContain('只读查看');
  expect(queryByRole(host,'button',{name:'新建单据'})).toBeNull();
  expect(queryByRole(host.querySelector('[data-document-detail="pl"]') as HTMLElement,'button',{name:'签发'})).toBeNull();
  await click(getByRole(host,'tab',{name:/抬头与模板/}));
  expect(host.textContent).toContain('竹衍服饰');expect(host.textContent).not.toContain('印章图样、编号规则预览与打印打包尚未接入');
});

it('shows a pending CI as awaiting finance rather than paid and permits correction before any receipts',()=>{
  store.state!.fulfillment.documents.push(doc('pending-ci','CI',{status:'issued',invoiceId:'pending-invoice'}));
  store.state!.invoices.push({id:'pending-invoice',code:'CI-pending',orderId:'o',order:'SO-1',customer:'Cedar',amount:100,open:0,currency:'USD',due:'2026-11-01',financeStatus:'pending'});
  render('pending-ci');
  const detail=host.querySelector('[data-document-detail="pending-ci"]') as HTMLElement;
  expect(detail.textContent).toContain('待财务确认');
  expect(detail.textContent).not.toContain('CI 已有收款');
  expect((getByRole(detail,'button',{name:'作废当前版本'}) as HTMLButtonElement).disabled).toBe(false);
});

it('shows a replacement CI customs amount without claiming a customer receivable or payment',()=>{
 const s=store.state!;s.orders[0].replacementSource={schemaVersion:1,claimId:'case'} as any;s.fulfillment.documents.push(doc('replacement','CI',{status:'issued',replacementDeclaredAmount:90}));render('replacement');const detail=host.querySelector('[data-document-detail="replacement"]') as HTMLElement;expect(detail.textContent).toContain('无需收款');expect(detail.textContent).toContain('USD 90.00');expect(detail.textContent).not.toContain('已生成财务应收');expect(detail.textContent).not.toContain('未找到对应应收');expect(detail.textContent).not.toContain('CI 合同应收日');
});

it('asks for a collection date only on a billable CI and never submits hidden collection fields',async()=>{
 store.state!.orders.push({...store.state!.orders[0],id:'free',code:'SO-FREE',replacementSource:{schemaVersion:1,claimId:'claim'}} as any);store.state!.fulfillment.shipments[0].lines.push({orderId:'free',lineId:'free-line',quantity:1} as any);render(undefined,'s');await click(getAllByRole(host,'button',{name:'新建单据'})[0]);const dialog=getByRole(document.body,'dialog');
 const choose=(label:string,value:string)=>act(()=>fireEvent.change(getByRole(dialog,'combobox',{name:label}),{target:{value}}));
 expect(queryByRole(dialog,'combobox',{name:'对应订单'})).toBeNull();expect(queryByLabelText(dialog,'应收到期日')).toBeNull();choose('单据类型','CI');choose('对应订单','o');expect(getByLabelText(dialog,'应收到期日')).toBeTruthy();fireEvent.change(getByLabelText(dialog,'应收到期日'),{target:{value:'2026-11-01'}});choose('单据类型','PL');expect(queryByLabelText(dialog,'应收到期日')).toBeNull();choose('单据类型','CI');choose('对应订单','free');expect(queryByLabelText(dialog,'应收到期日')).toBeNull();
 typeInto(getByRole(dialog,'textbox',{name:'实际单据编号'}) as HTMLInputElement,'CI-FREE');typeInto(getByRole(dialog,'textbox',{name:'标题'}) as HTMLInputElement,'商业发票');typeInto(getByRole(dialog,'textbox',{name:'单据正文'}) as HTMLTextAreaElement,'Replacement, no charge.');await click(getByRole(dialog,'button',{name:'保存为草稿'}));expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.documents.save',payload:expect.objectContaining({type:'CI',orderId:'free',dueDate:''})});
});

it('shows company maintenance only to accounts that can read company settings',async()=>{
 session.denied.add('settings:system:read');render();await click(getByRole(host,'tab',{name:'抬头与模板'}));expect(queryByRole(host,'button',{name:'公司资料'})).toBeNull();session.denied.clear();render();await click(getByRole(host,'button',{name:'公司资料'}));expect(go).toHaveBeenLastCalledWith('system-settings',undefined,{section:'company'});
});

it('keeps unrelated factory and booking originals visible as separate current documents',()=>{
 const f=store.state!.fulfillment;f.documents.push(doc('factory','OTHER',{number:'PK-1',title:'工厂装箱单',status:'issued'}),doc('booking','OTHER',{number:'BOOK-1',title:'订舱确认',status:'issued'}));render();const table=getByRole(host,'table',{name:'单据列表'});expect(table.textContent).toContain('PK-1');expect(table.textContent).toContain('BOOK-1');expect(getAllByRole(table,'row')).toHaveLength(3);expect(table.textContent).not.toContain('共 2 版');
});
it('shows only the explicit external document family in its version history',()=>{
 const f=store.state!.fulfillment;f.documents.push(doc('factory-v1','OTHER',{number:'PK-1',status:'void',familyId:'factory-v1'}),doc('factory-v2','OTHER',{number:'PK-2',status:'issued',version:2,familyId:'factory-v1'}),doc('booking','OTHER',{number:'BOOK-1',status:'issued',familyId:'booking'}));render('factory-v2');const list=getByRole(host,'table',{name:'单据列表'});expect(list.textContent).toContain('BOOK-1');expect(list.textContent).toContain('PK-2');const history=getByRole(host,'table',{name:'PK-2 版本'});expect(history.textContent).toContain('PK-1');expect(history.textContent).toContain('PK-2');expect(history.textContent).not.toContain('BOOK-1');
});
