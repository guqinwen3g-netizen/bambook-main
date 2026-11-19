// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,getAllByRole,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentShipment,FulfillmentDocument} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,workspace:{id:'w',revision:0,shipmentReleaseGates:undefined as Record<string,{held:boolean;unusedAuthorized:boolean}>|undefined},loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const session=vi.hoisted(()=>({id:'biz',denied:new Set<string>()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:session.id,displayName:'经办人'},sessionKey:'s',hasPermission:(p:string)=>!session.denied.has(p),canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {MistPresentedErrorContext} from '../../runtime/errorPresentation';
import {ShipmentsPage,shipmentStage} from './ShipmentsPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;let presentedError:string|undefined;const go=vi.fn();
function render(id?:string,detail:'full'|'list'='full'){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'shipments',id,...(id&&detail==='full'?{detail:'full' as const}:{})},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><MistPresentedErrorContext.Provider value={presentedError}><ShipmentsPage/></MistPresentedErrorContext.Provider></Nav.Provider></ToastProvider></MistRoot>));}
async function click(node:HTMLElement){await act(async()=>node.click());}
it('hands a new shipment request focus to its source without taking focus back during refresh',async()=>{
 render();await click(getAllByRole(host,'button',{name:'新建出运'})[0]);
 const source=getByRole(host,'combobox',{name:'来源条目 1'});expect(document.activeElement).toBe(source);
 const quantity=host.querySelector('input[type="number"]') as HTMLInputElement;quantity.focus();typeInto(quantity,'8');render();
 expect(document.activeElement).toBe(quantity);expect(quantity.value).toBe('8');expect(store.run).not.toHaveBeenCalled();
});
function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
const shipment=(id:string,patch:Partial<FulfillmentShipment>={}):FulfillmentShipment=>({id,code:id.toUpperCase(),customerId:'c',customer:'Cedar',domain:'garment',consignee:'Cedar DC',mode:'sea',portOfLoading:'上海',portOfDischarge:'Felixstowe',incoterm:'FOB',plannedDate:'2099-01-01',booking:'',lines:[{orderId:'o',lineId:'l',productionId:'p',quantity:10,factoryConfirmedAt:'2026-10-09'}],note:'',fileIds:[],state:'preparing',requestedBy:'经办人',requesterId:'biz',createdAt:'2026-10-08T08:00:00Z',...patch});
const doc=(id:string,shipmentId:string,type:FulfillmentDocument['type'],status:FulfillmentDocument['status']='issued'):FulfillmentDocument=>({id,shipmentId,orderId:type==='CI'?'o':'',type,number:type+'-'+id,version:1,title:type,dueDate:'',content:'',fileIds:[],status,createdAt:'2026-10-10T08:00:00Z',actor:'后勤'});
const pack=(shipmentId:string,quantity:number)=>({id:shipmentId+quantity,shipmentId,lineId:'l',productionId:'p',carton:'1',quantity,netWeight:9,grossWeight:10,volume:0.1,note:''});
const customs=(shipmentId:string,status:'draft'|'submitted'|'cleared')=>({id:'cus-'+shipmentId,shipmentId,code:'CUS-'+shipmentId,status,declarationNo:'D1',broker:'报关行',hsCode:'6202',origin:'CN',tradeMode:'一般贸易',declaredAt:'2026-10-13',clearedAt:'',evidence:'',fileIds:[],note:''});
beforeEach(()=>{store.workspace.revision=0;store.workspace.shipmentReleaseGates=undefined;presentedError=undefined;store.error='';session.id='biz';session.denied=new Set();const s=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'经办人'},'empty');
  s.orders.push({id:'o',code:'SO-1',type:'garment',customerId:'c',customer:'Cedar',currency:'USD',amount:100,governance:{contract:{preShipmentPercent:0}}} as any);s.orderLines.push({id:'l',orderId:'o',name:'大衣',style:'COAT-1',img:'coat',qty:10,unit:'件',price:10,made:10,qc:10});
  store.state=s;store.run.mockReset();store.run.mockResolvedValue({result:{}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();store.loading=false;});

it('opens the saved arrival and POD basis and only the current batch’s authorised original',async()=>{
 const s=store.state!;
 const arrivedAt='2026-10-14T09:00:00Z',signedAt='2026-10-14T12:00:00Z';
 s.fulfillment.shipments.push(
  shipment('first',{state:'departed',arrival:{at:arrivedAt,evidence:'首批实际到港通知',actor:'后勤'},delivered:{at:signedAt,receiver:'收货组',evidence:'首批签收回执 A1',actor:'后勤',fileIds:['first-pod']}}),
  shipment('second',{state:'departed',delivered:{at:signedAt,receiver:'收货组',evidence:'尾批签收回执 B1',actor:'后勤',fileIds:['second-pod']}}),
 );
 s.files.push({id:'first-pod',name:'首批签收原件.pdf',size:10,mimeType:'application/pdf',createdAt:signedAt,storageKey:'w/first-pod'});
 render('first');
 await click(getByRole(host,'button',{name:'到港依据',exact:true}));
 await click(getByRole(host,'button',{name:'签收依据',exact:true}));
 expect(host.textContent).toContain('首批实际到港通知');
 expect(host.textContent).toContain('首批签收回执 A1');
 expect(getByRole(host,'button',{name:'首批签收原件.pdf',exact:true})).toBeTruthy();
 expect(host.textContent).not.toContain('尾批签收回执 B1');
 render('second');
 expect(queryByRole(host,'button',{name:'到港依据',exact:true})).toBeNull();
 const details=getByRole(host,'button',{name:'签收依据',exact:true});
 if(details.getAttribute('aria-expanded')!=='true')await click(details);
 expect(host.textContent).toContain('尾批签收回执 B1');
 expect(host.textContent).toContain('1份附件不可读');
 expect(queryByRole(host,'button',{name:'首批签收原件.pdf',exact:true})).toBeNull();
 expect(store.run).not.toHaveBeenCalled();
});

it('removes only the held branch from new shipment sources and blocks an already selected draft',async()=>{
 const state=store.state!;
 for(const id of ['first','second'])state.productions.push({id,code:id,orderId:'o',lineId:'l',order:'SO-1',name:'大衣',factory:'工厂',qty:10,due:'2026-11-01',pct:0,img:'coat',col:'cut'});
 render();await click(getAllByRole(host,'button',{name:'新建出运'})[0]);
 const select=getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement;
 act(()=>{select.value='production:first';select.dispatchEvent(new Event('change',{bubbles:true}));});
 state.fulfillment.productionFacts.push({productionId:'first',sizes:[],revision:1,hold:{actor:'业务员',at:'2026-10-13T10:00:00Z',category:'other',reason:'核对版本'}});
 render();
 expect([...select.options].map(option=>option.value)).toEqual(['','production:second']);
 await click(getByRole(host,'button',{name:'下一步'}));expect(host.textContent).toContain('生产分支已暂停');expect(store.run).not.toHaveBeenCalled();
 delete state.fulfillment.productionFacts[0].hold;render();expect([...select.options].map(option=>option.value)).toContain('production:first');
});

it.each([true,false])('distinguishes unread shipment data from an empty company (loading %s)',loading=>{
 store.state=null;store.loading=loading;store.error=loading?'':'本次读取暂时不可用';presentedError=store.error||undefined;render();
 expect(host.textContent).toContain(loading?'正在读取出运资料':'出运资料未读取');
 expect(host.textContent).not.toContain('还没有成衣出运');expect(host.querySelector('.mist-pipeline')).toBeNull();
 expect(queryByRole(host,'button',{name:'成衣业务 · 0'})).toBeNull();
 expect((getByRole(host,'button',{name:'新建出运'}) as HTMLButtonElement).disabled).toBe(true);
 expect((getByRole(host,'button',{name:'核对合同收货条款'}) as HTMLButtonElement).disabled).toBe(true);
 expect((getByRole(host,'button',{name:'导出'}) as HTMLButtonElement).disabled).toBe(true);
 expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);expect(store.run).not.toHaveBeenCalled();
});

it('keeps a genuine empty company available for a new shipment',()=>{
 render();expect(host.textContent).toContain('还没有成衣出运');expect(host.querySelector('.mist-pipeline')).not.toBeNull();
 expect(getAllByRole(host,'button',{name:'新建出运'}).every(b=>!(b as HTMLButtonElement).disabled)).toBe(true);
 expect((getByRole(host,'button',{name:'核对合同收货条款'}) as HTMLButtonElement).disabled).toBe(false);
});

it('keeps the mobile arrival editor parent until close when the viewport widens',async()=>{
 const previous=window.matchMedia,listeners=new Set<()=>void>(),media={matches:true,addEventListener:(_type:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_type:string,fn:()=>void)=>listeners.delete(fn)};
 Object.defineProperty(window,'matchMedia',{configurable:true,writable:true,value:()=>media});
 try{
  store.state!.fulfillment.shipments.push(shipment('arrival-layer',{state:'departed',departedAt:'2026-10-12T08:00:00Z'}));render('arrival-layer','list');
  await click(getByRole(document.body,'button',{name:'登记到港',exact:true}));
  typeInto(getByRole(document.body,'textbox',{name:'到港依据'}) as HTMLTextAreaElement,'待核对到港通知');
  act(()=>{media.matches=false;listeners.forEach(fn=>fn());});
  expect(getAllByRole(document.body,'dialog')).toHaveLength(2);
  expect((getByRole(document.body,'textbox',{name:'到港依据'}) as HTMLTextAreaElement).value).toBe('待核对到港通知');
  await click(getByRole(getByRole(document.body,'dialog',{name:'登记到港'}),'button',{name:'取消',exact:true}));
  expect(document.activeElement).toBe(host.querySelector('.mist-preview'));expect(store.run).not.toHaveBeenCalled();
 }finally{Object.defineProperty(window,'matchMedia',{configurable:true,writable:true,value:previous});}
});

it('retains contract terms and prevents a command if their workspace becomes unread',async()=>{
 render();await click(getByRole(host,'button',{name:'核对合同收货条款'}));
 act(()=>fireEvent.change(getByRole(host,'combobox',{name:'来源订单'}),{target:{value:'o'}}));
 typeInto(getByRole(host,'textbox',{name:'合同收货方'}) as HTMLInputElement,'Cedar DC');
 typeInto(getByRole(host,'textbox',{name:'合同 / 信用证依据'}) as HTMLTextAreaElement,'已签客户合同');
 await click(getByRole(host,'button',{name:'下一步'}));
 store.state=null;render();await click(getByRole(host,'button',{name:'确认保存'}));
 expect(store.run).not.toHaveBeenCalled();expect(host.textContent).toContain('出运资料未读取');
 await click(getByRole(host,'button',{name:'上一步'}));expect((getByRole(host,'textbox',{name:'合同 / 信用证依据'}) as HTMLTextAreaElement).value).toBe('已签客户合同');
});

async function requestEditorDraft(){
 const state=store.state!;
 state.fulfillment.shippingTerms.push({orderId:'o',consignee:'Cedar DC',partialAllowed:true,mode:'sea',confirmedAt:'2026-10-12',evidence:'已签合同'});
 state.productions.push({id:'p',code:'PR-1',orderId:'o',lineId:'l',order:'SO-1',name:'大衣',factory:'工厂',qty:10,due:'2026-11-01',pct:100,img:'coat',col:'done'});
 state.fulfillment.shipments.push(shipment('request-conflict'));render('request-conflict');
 await click(getByRole(host,'button',{name:'编辑出运请求'}));await click(getByRole(host,'button',{name:'下一步'}));
 typeInto(getByRole(host,'textbox',{name:'后勤要求'}) as HTMLTextAreaElement,'本次尚未提交的包装要求');
 await click(getByRole(host,'button',{name:'下一步'}));
 return state;
}
it('keeps a contract terms draft from replacing terms recorded after it opened',async()=>{
 render();await click(getByRole(host,'button',{name:'核对合同收货条款'}));
 act(()=>fireEvent.change(getByRole(host,'combobox',{name:'来源订单'}),{target:{value:'o'}}));
 typeInto(getByRole(host,'textbox',{name:'合同收货方'}) as HTMLInputElement,'Cedar DC');
 typeInto(getByRole(host,'textbox',{name:'合同 / 信用证依据'}) as HTMLTextAreaElement,'本次待提交的合同核对');
 await click(getByRole(host,'button',{name:'下一步'}));
 store.state=structuredClone(store.state!);store.state.fulfillment.shippingTerms.push({orderId:'o',consignee:'Cedar New DC',partialAllowed:true,mode:'air',confirmedAt:'2026-10-12',evidence:'另一岗位已核对条款'});render();
 await click(getByRole(host,'button',{name:'确认保存'}));
 expect(store.run).not.toHaveBeenCalled();expect(host.textContent).toContain('合同来源已更新，请重新打开后核对');
 await click(getByRole(host,'button',{name:'上一步'}));expect((getByRole(host,'textbox',{name:'合同 / 信用证依据'}) as HTMLTextAreaElement).value).toBe('本次待提交的合同核对');
});
it('allows checked contract terms after unrelated synchronization with the checked revision',async()=>{
 render();await click(getByRole(host,'button',{name:'核对合同收货条款'}));
 act(()=>fireEvent.change(getByRole(host,'combobox',{name:'来源订单'}),{target:{value:'o'}}));
 typeInto(getByRole(host,'textbox',{name:'合同收货方'}) as HTMLInputElement,'Cedar DC');
 typeInto(getByRole(host,'textbox',{name:'合同 / 信用证依据'}) as HTMLTextAreaElement,'已签合同逐项核对');
 await click(getByRole(host,'button',{name:'下一步'}));
 store.state=structuredClone(store.state!);store.state.settings.profileName='新的公司简称';store.workspace.revision=9;render();
 await click(getByRole(host,'button',{name:'确认保存'}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.sourceTerms',payload:expect.objectContaining({orderId:'o',evidence:'已签合同逐项核对'})}),{expectedRevision:9});
});
it.each(['request','terms','branch'] as const)('preserves a shipment request draft when synchronization changes its %s',async source=>{
 const state=await requestEditorDraft();store.state=structuredClone(state);
 if(source==='request')store.state.fulfillment.shipments[0].portOfDischarge='Hamburg';
 else if(source==='terms')store.state.fulfillment.shippingTerms[0].mode='air';
 else store.state.productions[0].qty=11;
 render('request-conflict');
 await click(getByRole(host,'button',{name:'保存出运请求'}));
 expect(store.run).not.toHaveBeenCalled();expect(host.textContent).toContain('出运来源已更新，请重新打开后核对');
 await click(getByRole(host,'button',{name:'上一步'}));expect((getByRole(host,'textbox',{name:'后勤要求'}) as HTMLTextAreaElement).value).toBe('本次尚未提交的包装要求');
});

it('saves a checked shipment request after unrelated synchronization with that exact revision',async()=>{
 const state=await requestEditorDraft();store.state=structuredClone(state);store.state.settings.profileName='新的公司简称';store.workspace.revision=7;render('request-conflict');
 await click(getByRole(host,'button',{name:'保存出运请求'}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.save',payload:expect.objectContaining({id:'request-conflict',note:'本次尚未提交的包装要求'})}),{expectedRevision:7});
});

it('shows actual air departure states without sea-only labels or a duplicate instruction banner',()=>{
 const s=shipment('air',{mode:'air',state:'ready',documentsSentAt:'2026-10-13T08:00:00Z'});store.state!.fulfillment.shipments.push(s);render('air');expect(host.textContent).toContain('待起飞');expect(host.textContent).not.toContain('等待离港');expect(host.textContent).not.toContain('业务已对客发送；出口清关完成后才能登记实际离港。');s.state='departed';s.departedAt='2026-10-13T09:00:00Z';store.state={...store.state!};render('air');expect(host.textContent).toContain('已起飞');expect(host.textContent).not.toContain('已离港');
});

it('uses neutral package labels for fabric while keeping carton labels for garments', async () => {
 const f=store.state!.fulfillment;
 f.shipments.push(shipment('fabric',{domain:'fabric',booking:'BK-F'}),shipment('garment',{booking:'BK-G'}));
 f.packing.push(pack('fabric',10),pack('garment',10));
 render('fabric');
 expect(host.textContent).toContain('包件数');
 expect(host.textContent).toContain('1 件');
 expect(host.textContent).not.toContain('箱数');
 await click(getByRole(host,'button',{name:'分配装箱'}));
 expect(getByRole(host,'textbox',{name:'包件号'})).toBeTruthy();
 render('garment');
 expect(host.textContent).toContain('箱数');
 expect(host.textContent).toContain('1 箱');
});

it('shows the actual unit on each mixed-unit packing input and follows source changes without converting quantities',async()=>{
 const s=store.state!,f=s.fulfillment;s.orders[0].type='fabric';Object.assign(s.orderLines[0],{unit:'米',qty:130.5});
 s.orderLines.push({...s.orderLines[0],id:'yards',name:'塔丝隆',unit:'码',qty:110});
 f.shipments.push(shipment('mixed-units',{domain:'fabric',lines:[{orderId:'o',lineId:'l',productionId:'p',quantity:130.5,factoryConfirmedAt:'2026-10-09'},{orderId:'o',lineId:'yards',productionId:'py',quantity:110,factoryConfirmedAt:'2026-10-09'}]}));
 render('mixed-units');await click(getByRole(host,'button',{name:'分配装箱'}));
 const metres=getByRole(host,'spinbutton',{name:'装箱数量（米）'}) as HTMLInputElement,yards=getByRole(host,'spinbutton',{name:'装箱数量（码）'}) as HTMLInputElement;
 expect(metres.value).toBe('130.5');expect(yards.value).toBe('110');
 expect(metres.closest('.mist-input')?.querySelector('.mist-input-suffix')?.textContent).toBe('米');
 expect(yards.closest('.mist-input')?.querySelector('.mist-input-suffix')?.textContent).toBe('码');
 const source=getAllByRole(host,'combobox',{name:'装箱来源条目'})[0];
 act(()=>fireEvent.change(source,{target:{value:'yards::py'}}));
 expect(getAllByRole(host,'spinbutton',{name:'装箱数量（码）'})).toHaveLength(2);
 expect((getAllByRole(host,'spinbutton',{name:'装箱数量（码）'})[0] as HTMLInputElement).value).toBe('130.5');
 act(()=>fireEvent.change(source,{target:{value:'l::p'}}));
 await click(getByRole(host,'button',{name:'保存装箱分配'}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.pack',payload:expect.objectContaining({lines:expect.arrayContaining([expect.objectContaining({lineId:'l',quantity:130.5}),expect.objectContaining({lineId:'yards',quantity:110})])})}),{expectedRevision:0});
});

it('supplements signed fabric package colours without permitting physical edits',async()=>{
 const st=store.state!,f=st.fulfillment;st.orders[0].type='fabric';Object.assign(st.orderLines[0],{unit:'米',breakdown:{kind:'fabric',composition:'棉',width:150,weight:141,rows:[{color:'本白',quantity:5},{color:'藏蓝',quantity:5}]}});
 f.shipments.push(shipment('fab',{domain:'fabric',booking:'BK',packingDetailVersion:2}));f.packing.push({...pack('fab',5),id:'p1',carton:'R1'},{...pack('fab',5),id:'p2',carton:'R2'});f.documents.push(doc('pl','fab','PL'));
 render('fab');expect(host.textContent).toContain('请先核对每件面料的颜色');expect(host.textContent).toContain('装箱明细待核对');expect(host.textContent).not.toContain('装箱与计划不符');await click(getByRole(host,'button',{name:'补充颜色明细'}));
 expect((getAllByRole(host,'textbox',{name:'包件号'})[0] as HTMLInputElement).disabled).toBe(true);
 const white=getByRole(host,'combobox',{name:'颜色 · R1'}) as HTMLSelectElement,navy=getByRole(host,'combobox',{name:'颜色 · R2'}) as HTMLSelectElement;
 act(()=>{fireEvent.change(white,{target:{value:'本白'}});fireEvent.change(navy,{target:{value:'藏蓝'}});});
 typeInto(getByRole(host,'textbox',{name:'原单核对依据'}) as HTMLTextAreaElement,'按已签装箱单逐件核对');
 await click(getByRole(host,'button',{name:'补充颜色明细'}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.pack',payload:expect.objectContaining({id:'fab',packingColorVersion:1,supplementEvidence:'按已签装箱单逐件核对',lines:expect.arrayContaining([expect.objectContaining({carton:'R1',fabricColor:'本白'}),expect.objectContaining({carton:'R2',fabricColor:'藏蓝'})])})}),{expectedRevision:0});
});

it('preserves a transport draft and blocks saving after live synchronization changes its source',async()=>{
 const f=store.state!.fulfillment;f.shipments.push(shipment('transport-conflict',{booking:'BK'}));render('transport-conflict');
 await click(getByRole(host,'button',{name:'更新运输安排'}));
 const note=getByRole(document.body,'textbox',{name:'运输安排说明'}) as HTMLTextAreaElement;typeInto(note,'尚未提交的说明');
 store.state=structuredClone(store.state!);store.state!.fulfillment.shipments[0].note='另一岗位已核实的说明';render('transport-conflict');
 await click(getByRole(document.body,'button',{name:'保存',exact:true}));
 expect(store.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('运输安排已更新，请重新打开后核对');
 expect((getByRole(document.body,'textbox',{name:'运输安排说明'}) as HTMLTextAreaElement).value).toBe('尚未提交的说明');
});

it('allows transport edits when synchronization only changes unrelated data',async()=>{
 store.state!.fulfillment.shipments.push(shipment('transport-unchanged',{booking:'BK'}));render('transport-unchanged');
 await click(getByRole(host,'button',{name:'更新运输安排'}));typeInto(getByRole(document.body,'textbox',{name:'运输安排说明'}) as HTMLTextAreaElement,'本票核实说明');
 store.state=structuredClone(store.state!);store.workspace.revision=1;store.state!.settings.profileName='新的公司简称';render('transport-unchanged');
 await click(getByRole(document.body,'button',{name:'保存',exact:true}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.updateTransport',payload:expect.objectContaining({note:'本票核实说明'})}),{expectedRevision:1});
});

it('shows flight and cargo-cutoff fields for a new air arrangement without empty sea-only inputs',async()=>{
 store.state!.fulfillment.shipments.push(shipment('air-fields',{mode:'air'}));render('air-fields');
 await click(getByRole(host,'button',{name:'更新运输安排'}));
 expect(getByRole(document.body,'textbox',{name:'航班号'})).toBeTruthy();
 expect(getByRole(document.body,'textbox',{name:'截货时间'})).toBeTruthy();
 expect(queryByRole(document.body,'textbox',{name:'航次'})).toBeNull();
 expect(queryByRole(document.body,'textbox',{name:/柜型 柜号/})).toBeNull();
 typeInto(getByRole(document.body,'textbox',{name:'货代'}) as HTMLInputElement,'远川国际物流');
 await click(getByRole(document.body,'button',{name:'保存',exact:true}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.updateTransport',payload:expect.objectContaining({transport:expect.objectContaining({forwarder:'远川国际物流',voyage:'',containers:[]})})}),{expectedRevision:0});
});

it('keeps sea voyage and container entry while omitting its repeated teaching hint',async()=>{
 store.state!.fulfillment.shipments.push(shipment('sea-fields'));render('sea-fields');
 await click(getByRole(host,'button',{name:'更新运输安排'}));
 expect(getByRole(document.body,'textbox',{name:'航次'})).toBeTruthy();
 expect(getByRole(document.body,'textbox',{name:'柜型 柜号 封条号（每柜一行）'})).toBeTruthy();
 expect(document.body.textContent).not.toContain('如 40HQ CBHU1234567 SL001');
});

it('keeps nonempty historical voyage and container records editable on an air shipment',async()=>{
 const transport={vessel:'OLD-FLIGHT',voyage:'OLD-LEG',containers:[{type:'LD3',number:'ULD-1',seal:'S1'}]};
 store.state!.fulfillment.shipments.push(shipment('air-records',{mode:'air',transport}));render('air-records');
 await click(getByRole(host,'button',{name:'更新运输安排'}));
 expect((getByRole(document.body,'textbox',{name:'航次（已有记录）'}) as HTMLInputElement).value).toBe('OLD-LEG');
 expect((getByRole(document.body,'textbox',{name:'容器资料（已有记录，每柜一行）'}) as HTMLTextAreaElement).value).toBe('LD3 ULD-1 S1');
 typeInto(getByRole(document.body,'textbox',{name:'运输安排说明'}) as HTMLTextAreaElement,'核对当前运输说明');
 await click(getByRole(document.body,'button',{name:'保存',exact:true}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({payload:expect.objectContaining({transport:expect.objectContaining(transport)})}),{expectedRevision:0});
});

it('shows why the requester cannot cancel a booked shipment with issued documents',()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('k',{booking:'BK-9',requesterId:'biz'}));f.documents.push(doc('ci','k','CI'));
  render('k');
  const detail=host.querySelector('[data-shipment-detail="k"]') as HTMLElement;
  expect((getByRole(detail,'button',{name:'取消请求'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('取消请求：已有订舱号 BK-9');
  expect(detail.textContent).toContain('已有已出具的 CI / PL 等单据，请先作废');
});

it('derives the logistics stage only from recorded packing, booking, documents, dispatch and departure',()=>{
  const f=store.state!.fulfillment;
  f.shipments.push(shipment('a'),shipment('b',{booking:'BK'}),shipment('c',{state:'ready'}),shipment('d',{state:'ready',documentsSentAt:'2026-10-12T08:00:00Z'}),shipment('e',{state:'departed',departedAt:'2026-10-13T08:00:00Z'}),shipment('f',{state:'cancelled'}),shipment('g'));
  f.packing.push(pack('g',4));
  expect(f.shipments.map(s=>shipmentStage(store.state!,s))).toEqual(['intake','logistics','business','departure','departed','cancelled','logistics']);
  render();
  const pipeline=getByRole(host,'button',{name:/进行中与已出运/});expect(pipeline.textContent).toContain('6');
  expect(getByRole(host,'button',{name:/已取消/}).textContent).toContain('1');
  const rows=getAllByRole(getByRole(host,'table',{name:'出运列表'}),'row').slice(1);
  expect(rows[0].textContent).toContain('G');expect(rows[0].textContent).toContain('装箱与计划不符');
  expect(getByRole(host,'table',{name:'出运列表'}).textContent).not.toContain('已取消');
});

it('keeps fabric and garment shipments apart and filters to my own requests',async()=>{
  store.state!.fulfillment.shipments.push(shipment('mine'),shipment('other',{requesterId:'someone',requestedBy:'别人'}),shipment('fab',{domain:'fabric',code:'FAB-1'}));
  render();
  expect(getByRole(host,'button',{name:/成衣业务 · 2/})).toBeTruthy();
  const table=()=>getByRole(host,'table',{name:'出运列表'});
  expect(table().textContent).not.toContain('FAB-1');
  await click(getByRole(host,'button',{name:/筛选/}));await click(getByRole(document.body,'menuitemradio',{name:'我发起的'}));
  expect(table().textContent).toContain('MINE');expect(table().textContent).not.toContain('OTHER');
  await click(getByRole(host,'button',{name:/面料业务 · 1/}));
  expect(table().textContent).toContain('FAB-1');
});

it('shows why documents cannot be marked ready and hides request edits once logistics has packed',()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s',{booking:'BK-1'}));f.packing.push(pack('s',10));f.documents.push(doc('pl','s','PL'),doc('ci','s','CI','draft'));
  render('s');
  const detail=host.querySelector('[data-shipment-detail="s"]') as HTMLElement;
  expect(detail.textContent).toContain('物流处理中');
  expect((getByRole(detail,'button',{name:'完成单证准备'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('完成单证准备：请按原订单分别签发 CI');
  expect((getByRole(detail,'button',{name:'分配装箱'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('分配装箱：已有有效 CI 或装箱单');
  expect(queryByRole(detail,'button',{name:'编辑出运请求'})).toBeNull();
  expect(queryByRole(detail,'button',{name:'退回业务确认差异'})).toBeNull();
  expect(getByRole(detail,'table',{name:'S 来源范围'}).textContent).toContain('10 / 10 件');
});

it('gates departure on customer dispatch and export clearance, then records ATD in a dialog over the full detail page',async()=>{
  const f=store.state!.fulfillment;f.shipments.push(shipment('s',{state:'ready',booking:'BK',documentsSentAt:'2026-10-12T08:00:00Z'}));f.customs.push(customs('s','submitted'));
  render('s');
  let detail=host.querySelector('[data-shipment-detail="s"]') as HTMLElement;
  expect((getByRole(detail,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('登记实际离港：出口清关尚未完成');
  f.customs[0].status='cleared';store.state={...store.state!};render('s');
  detail=host.querySelector('[data-shipment-detail="s"]') as HTMLElement;
  await click(getByRole(detail,'button',{name:'登记实际离港'}));
  const dialog=getByRole(document.body,'dialog');expect(host.querySelector('[data-list-detail-page]')).toBeTruthy();
  typeInto(getByRole(dialog,'textbox',{name:'实际离港 / 起飞依据'}) as HTMLTextAreaElement,'船公司离港通知');
  await click(getByRole(dialog,'button',{name:'登记离港'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.depart',payload:expect.objectContaining({id:'s',evidence:'船公司离港通知'})}));
});

it('lets a business-only user record the customer dispatch without logistics actions',async()=>{
  session.denied.add('shipments:write');
  store.state!.fulfillment.shipments.push(shipment('s',{state:'ready',booking:'BK'}));
  render('s');
  const detail=host.querySelector('[data-shipment-detail="s"]') as HTMLElement;
  expect(detail.textContent).toContain('资料已回业务');
  expect(queryByRole(detail,'button',{name:'分配装箱'})).toBeNull();
  expect(queryByRole(detail,'button',{name:'登记实际离港'})).toBeNull();
  await click(getByRole(detail,'button',{name:'登记已向客户发送CI/PL'}));
  await click(getByRole(getByRole(document.body,'dialog'),'button',{name:'登记发送'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.sent',payload:expect.objectContaining({id:'s'})}));
});

it('BB-ORD-6 warns before saving a shipment above the over-ship cap and offers an over-ship request; short shipments are only a hint',async()=>{
  const s=store.state!;s.orderLines[0].qty=1000;(s.orders[0] as any).governance={status:'approved',contract:{overPercent:3,shortPercent:3,incoterm:'FOB'}};
  s.productions.push({id:'p',code:'PR-1',orderId:'o',lineId:'l',order:'SO-1',name:'大衣',factory:'工厂',qty:1050,due:'2026-11-01',pct:100,img:'coat',col:'done'});
  s.fulfillment.shippingTerms.push({orderId:'o',consignee:'Cedar DC',partialAllowed:true,mode:'sea',confirmedAt:'2026-10-12',evidence:'合同'} as any);
  s.fulfillment.shipments.push(shipment('a',{lines:[{orderId:'o',lineId:'l',productionId:'p',quantity:1000,factoryConfirmedAt:'2026-10-09'}]}));
  render();await click(getByRole(host,'button',{name:'新建出运'}));
  const select=getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement;
  act(()=>{select.value='production:p';select.dispatchEvent(new Event('change',{bubbles:true}));});
  const qty=host.querySelector('input[type="number"]') as HTMLInputElement;typeInto(qty,'50');
  const over=host.querySelector('[data-over-ship="l"]')!;expect(host.textContent).toContain('超出允许溢装，须经理审批');expect(over.textContent).toContain('累计出运 1050');expect(over.textContent).toContain('溢装上限 1030');expect(over.textContent).toContain('超出 20');
  expect(host.querySelector('.mist-banner p p, .mist-banner p div')).toBeNull();
  await click(getByRole(host,'button',{name:'下一步'}));expect(host.textContent).not.toContain('Error:');expect(qty.value).toBe('50');
  const request=getByRole(host,'button',{name:'发起超量出运申请'}) as HTMLButtonElement;expect(request.disabled).toBe(true);
  typeInto(getByRole(host,'textbox',{name:'超量原因 COAT-1'}) as HTMLTextAreaElement,'客户要求多发补损');
  await click(request);
  expect(store.run).toHaveBeenCalledWith({type:'order.governance.requestOverShip',payload:{orderId:'o',lineId:'l',quantity:1050,reason:'客户要求多发补损'}});
  expect(host.textContent).toContain('已发起超量出运申请');
  await click(getByRole(host,'button',{name:'下一步'}));expect(host.textContent).toContain('请先发起超量出运申请并等待批准');
  s.fulfillment.shipments[0].lines[0].quantity=900;typeInto(qty,'20');
  expect(host.querySelector('[data-over-ship]')).toBeNull();expect(host.querySelector('[data-short-ship="l"]')!.textContent).toContain('低于短装下限 970');expect(host.textContent).toContain('本条目预计短装');
});

it('keeps an uploaded departure original through a failed save and submits its file id on retry',async()=>{
  const f=store.state!.fulfillment;
  f.shipments.push(shipment('s',{state:'ready',booking:'BK',documentsSentAt:'2026-10-12T08:00:00Z'}));f.customs.push(customs('s','cleared'));
  render('s');await click(getByRole(host,'button',{name:'登记实际离港'}));
  const dialog=getByRole(document.body,'dialog');
  typeInto(getByRole(dialog,'textbox',{name:'实际离港 / 起飞依据'}) as HTMLTextAreaElement,'承运人开航确认');
  let completeUpload!:(file:any)=>void;store.uploadFile.mockReset();store.uploadFile.mockImplementation(()=>new Promise(resolve=>{completeUpload=resolve;}));
  const input=dialog.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async()=>fireEvent.change(input,{target:{files:[new File(['proof'],'departure.pdf',{type:'application/pdf'})]}}));
  expect((getByRole(dialog,'button',{name:'登记离港'}) as HTMLButtonElement).disabled).toBe(true);
  const file={id:'departure-proof',name:'departure.pdf',mimeType:'application/pdf',storageKey:'proof',size:5,createdAt:'2026-10-13T00:00:00Z'};
  store.state!.files.push(file);await act(async()=>completeUpload(file));
  store.run.mockRejectedValueOnce(new Error('保存失败，请重试'));
  await click(getByRole(dialog,'button',{name:'登记离港'}));
  expect(dialog.textContent).toContain('保存失败，请重试');expect(dialog.textContent).toContain('departure.pdf');
  expect((getByRole(dialog,'textbox',{name:'实际离港 / 起飞依据'}) as HTMLTextAreaElement).value).toBe('承运人开航确认');
  await click(getByRole(dialog,'button',{name:'登记离港'}));
  expect(store.uploadFile).toHaveBeenCalledTimes(1);
  expect(store.run).toHaveBeenLastCalledWith({type:'fulfillment.shipments.depart',payload:expect.objectContaining({id:'s',evidence:'承运人开航确认',fileIds:['departure-proof']})});
});

it('allows an L/C shipment without demanding a T/T cash percentage while retaining other departure gates',()=>{
 const state=store.state!,contract=state.orders[0].governance!.contract;contract.paymentMethod='LC';delete contract.preShipmentPercent;
 state.fulfillment.shipments.push(shipment('lc',{state:'ready',documentsSentAt:'2026-10-12T08:00:00Z'}));state.fulfillment.customs.push(customs('lc','cleared'));
 render('lc');expect((getByRole(host,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(false);expect(host.textContent).not.toContain('出运前累计收款比例');
 delete state.fulfillment.shipments[0].documentsSentAt;store.state={...state};render('lc');expect((getByRole(host,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(true);expect(host.textContent).toContain('等待业务登记对客发送 CI / PL');
});

it('shows an unpaid contractual balance and prevents opening departure until the receipt belongs to this order',async()=>{
 const state=store.state!,f=state.fulfillment;state.orders[0].governance!.contract.preShipmentPercent=100;
 f.shipments.push(shipment('s',{state:'ready',documentsSentAt:'2026-10-12T08:00:00Z'}));f.customs.push(customs('s','cleared'));
 state.receipts.push({id:'r',code:'BR',payer:'Cedar',date:'2026-10-13',ref:'balance',amount:100,remaining:100,currency:'USD',state:'unmatched'});
 render('s');expect((getByRole(host,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(true);expect(host.textContent).toContain('尚差 100.00 USD');expect(store.run).not.toHaveBeenCalled();
 state.orderFunding.assignments.push({id:'fund',receiptId:'r',customerId:'c',orderId:'o',amount:100,currency:'USD',state:'active',note:'合同收款',createdAt:'',updatedAt:'',actor:'财务',history:[]});store.state={...state};render('s');
 expect((getByRole(host,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(false);
});


it('keeps departure evidence out of the status banner and makes the original record available on demand',async()=>{const evidence='Carrier reference and complete departure evidence retained';store.state!.fulfillment.shipments.push(shipment('short-status',{state:'departed',departedAt:'2026-10-13T08:00:00Z',departureEvidence:evidence}));render('short-status');const detail=host.querySelector('[data-shipment-detail="short-status"]') as HTMLElement;expect(detail.textContent).toContain('已离港');expect(detail.textContent).not.toContain(evidence);await click(getByRole(detail,'button',{name:'离港依据'}));expect(detail.textContent).toContain(evidence);});

it('keeps standalone packing failures but suppresses the same error already shown by the app',async()=>{
 store.state!.fulfillment.shipments.push(shipment('packing-feedback'));render('packing-feedback');await click(getByRole(host,'button',{name:'分配装箱'}));
 store.run.mockRejectedValueOnce(new Error('逐条目装箱数量必须等于本次计划数量'));await click(getByRole(host,'button',{name:'保存装箱分配'}));expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
 presentedError='另一个错误';render('packing-feedback');expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
 presentedError='逐条目装箱数量必须等于本次计划数量';render('packing-feedback');expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);expect((getByRole(host,'spinbutton',{name:/^装箱数量/}) as HTMLInputElement).value).toBe('10');expect(getByRole(host,'button',{name:'保存装箱分配'}).hasAttribute('disabled')).toBe(false);
});

it.each([
 {name:'only external originals',orders:['o'],pl:false,invoices:[],done:false,note:'未签发'},
 {name:'only PL',orders:['o'],pl:true,invoices:[],done:false,note:'部分签发'},
 {name:'only CI',orders:['o'],pl:false,invoices:['o'],done:false,note:'部分签发'},
 {name:'one complete order',orders:['o'],pl:true,invoices:['o'],done:true,note:'已签发'},
 {name:'one invoice missing from a combined shipment',orders:['o','o2'],pl:true,invoices:['o'],done:false,note:'部分签发'},
 {name:'all combined order invoices',orders:['o','o2'],pl:true,invoices:['o','o2'],done:true,note:'已签发'},
])('shows the CI/PL stage from the required trade documents: $name',scenario=>{
 const state=store.state!,f=state.fulfillment,s=shipment('s');
 if(scenario.orders.length===2){state.orders.push({...state.orders[0],id:'o2',code:'SO-2'});state.orderLines.push({...state.orderLines[0],id:'l2',orderId:'o2'});s.lines.push({...s.lines[0],orderId:'o2',lineId:'l2',productionId:'p2'});}
 f.shipments.push(s);f.documents.push({...doc('factory','s','OTHER'),number:'PK-1'},{...doc('booking','s','OTHER'),number:'BOOK-1'});
 if(scenario.pl)f.documents.push(doc('pl','s','PL'));
 for(const orderId of scenario.invoices)f.documents.push({...doc('ci-'+orderId,'s','CI'),orderId});
 render('s');const checkbox=getByRole(host,'checkbox',{name:'CI / PL 签发'});expect(checkbox.getAttribute('aria-checked')).toBe(String(scenario.done));expect(checkbox.parentElement!.querySelector('small')?.textContent).toBe(scenario.note);
 const documents=getByRole(host,'table',{name:'S 单据'});expect(documents.textContent).toContain('PK-1');expect(documents.textContent).toContain('BOOK-1');
});

it('shows only scoped shipment lines and no full-document actions for a partial shipment',()=>{store.state!.fulfillment.shipments.push(shipment('partial',{hiddenCount:1,lines:[{orderId:'o',lineId:'l',quantity:3}]}));render('partial');const detail=host.querySelector('[data-shipment-detail=partial]') as HTMLElement;expect(detail.textContent).toContain('部分可见');expect(detail.textContent).toContain('另含其他范围业务');expect(detail.textContent).not.toContain('编辑出运请求');expect(detail.textContent).not.toContain('附件');});

it.each(['missing','qc','customer','business','other-shipment','complete'] as const)('shows the exact shipping sample prerequisite before documents-ready: %s',stage=>{
 const state=store.state!,f=state.fulfillment;
 f.shipments.push(shipment('s',{booking:'BK'}));f.packing.push(pack('s',10));f.documents.push(doc('pl','s','PL'),doc('ci','s','CI'));
 state.productions.push({id:'p',orderId:'o',lineId:'l',qty:10,pct:100,col:'qc'} as any);
 if(stage!=='missing'){
  f.samples.push({id:'ss',code:'SHIP-SAMPLE',role:'shipping',shipmentId:stage==='other-shipment'?'other':'s',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'},size:'M',color:'Blue',form:'样衣',qualityRevision:1} as any);
  f.qcTasks.push({id:'sq',kind:'sample',sampleId:'ss',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'},state:stage==='qc'?'working':'reported',reportIds:stage==='qc'?[]:['sr'],...(stage==='business'||stage==='complete'?{businessConfirmation:{result:'approved'}}:{}),...(stage==='complete'?{businessContinued:{reportId:'sr'}}:{})} as any);
  if(stage!=='qc')f.qcReports.push({id:'sr',taskId:'sq',result:'pass',scopeRevision:1} as any);
 }
 render('s');const detail=host.querySelector('[data-shipment-detail="s"]') as HTMLElement;
 const button=getByRole(detail,'button',{name:'完成单证准备'}) as HTMLButtonElement;
 expect(button.disabled).toBe(stage!=='complete');
 if(stage!=='complete')expect(detail.textContent).toContain('船样');
 expect(store.run).not.toHaveBeenCalled();
});

it('waits for the supplier handover before allowing departure of completed factory goods',()=>{
 const state=store.state!,s=shipment('handover',{state:'ready',booking:'BK',documentsSentAt:'2026-10-12T08:00:00Z'});
 state.fulfillment.shipments.push(s);state.fulfillment.customs.push(customs(s.id,'cleared'));
 state.productions.push({id:'p',sourcePurchaseId:'po',orderId:'o',lineId:'l',qty:10,pct:100,col:'qc'} as any);
 state.fulfillment.purchases.push({id:'po',code:'PO-HANDOVER',unit:'件',received:4} as any);
 render(s.id);let detail=host.querySelector('[data-shipment-detail="handover"]') as HTMLElement;
 expect((getByRole(detail,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(true);
 expect(detail.textContent).toContain('货物尚未完成交接');
 state.fulfillment.purchases[0].received=10;store.state={...state};render(s.id);detail=host.querySelector('[data-shipment-detail="handover"]') as HTMLElement;
 expect((getByRole(detail,'button',{name:'登记实际离港'}) as HTMLButtonElement).disabled).toBe(false);
 expect(store.run).not.toHaveBeenCalled();
});

it.each([undefined,'conflict-shipment'])('does not duplicate a workspace conflict in shipment list or detail (%s)',id=>{
 store.state!.fulfillment.shipments.push(shipment('conflict-shipment'));store.error='公司已被他人更新，请刷新后重新确认';presentedError=store.error;render(id);
 expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
 presentedError=undefined;render(id);expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
});

it('records each carton colour and size without inferring the ordered ratio',async()=>{
 const state=store.state!;state.orderLines[0].breakdown={kind:'garment',sizes:['M','L'],rows:[{color:'蓝',quantities:[6,4]}]} as any;
 state.fulfillment.shipments.push(shipment('sku'));
 render('sku');await click(getByRole(host,'button',{name:'分配装箱'}));
 expect((getByRole(host,'button',{name:'保存装箱分配'}) as HTMLButtonElement).disabled).toBe(true);
 await click(getByRole(host,'button',{name:'分色分码 · 1'}));
 const dialog=getByRole(document.body,'dialog',{name:'箱 1 · 分色分码'});
 expect((getByRole(dialog,'spinbutton',{name:'蓝 · M 数量'}) as HTMLInputElement).value).toBe('0');
 typeInto(getByRole(dialog,'spinbutton',{name:'蓝 · M 数量'}) as HTMLInputElement,'6');typeInto(getByRole(dialog,'spinbutton',{name:'蓝 · L 数量'}) as HTMLInputElement,'4');
 await click(getByRole(dialog,'button',{name:'确定'}));await click(getByRole(host,'button',{name:'保存装箱分配'}));
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.shipments.pack',payload:expect.objectContaining({packingDetailVersion:2,lines:[expect.objectContaining({assortment:[{color:'蓝',size:'M',quantity:6},{color:'蓝',size:'L',quantity:4}]})]})},{expectedRevision:0});
});
it('locks signed physical packing fields while supplementing missing colour-size details',async()=>{
 const state=store.state!;state.orderLines[0].breakdown={kind:'garment',sizes:['M'],rows:[{color:'蓝',quantities:[10]}]} as any;
 state.fulfillment.shipments.push(shipment('signed-sku'));state.fulfillment.packing.push(pack('signed-sku',10));state.fulfillment.documents.push(doc('pl','signed-sku','PL'));
 render('signed-sku');await click(getByRole(host,'button',{name:'补充分色分码'}));
 expect((getByRole(host,'textbox',{name:'箱号'}) as HTMLInputElement).disabled).toBe(true);
 expect((getByRole(host,'spinbutton',{name:/^装箱数量/}) as HTMLInputElement).disabled).toBe(true);
 expect((getByRole(host,'button',{name:'增加装箱行'}) as HTMLButtonElement).disabled).toBe(true);
 expect(getByRole(host,'textbox',{name:'原单核对依据'})).toBeTruthy();
 expect((getByRole(host,'button',{name:'补充分色分码'}) as HTMLButtonElement).disabled).toBe(true);
});
it('requires legacy garment detail in the current UI before document handoff',()=>{
 const state=store.state!;state.orderLines[0].breakdown={kind:'garment',sizes:['M'],rows:[{color:'蓝',quantities:[10]}]} as any;
 state.fulfillment.shipments.push(shipment('legacy'));state.fulfillment.packing.push(pack('legacy',10));state.fulfillment.documents.push(doc('pl','legacy','PL'),doc('ci','legacy','CI'));
 render('legacy');expect((getByRole(host,'button',{name:'完成单证准备'}) as HTMLButtonElement).disabled).toBe(true);expect(host.textContent).toContain('请填写每箱分色分码数量');
});
it('keeps signed carton assortment available to read after editing is frozen',async()=>{
 const state=store.state!;state.orderLines[0].breakdown={kind:'garment',sizes:['M'],rows:[{color:'蓝',quantities:[10]}]} as any;
 state.fulfillment.shipments.push(shipment('recorded',{packingDetailVersion:2}));state.fulfillment.packing.push({...pack('recorded',10),assortment:[{color:'蓝',size:'M',quantity:10}]});state.fulfillment.documents.push(doc('pl','recorded','PL'));
 render('recorded');await click(getByRole(host,'button',{name:'逐箱明细'}));expect(host.textContent).toContain('蓝 · M 10');
 expect((getByRole(host,'button',{name:'分配装箱'}) as HTMLButtonElement).disabled).toBe(true);
});

it('registers missing contract terms from the new shipment form, prefilled from the order, and returns to the same source with the contract incoterm',async()=>{
  const s=store.state!;(s.orders[0] as any).governance={status:'approved',contract:{kind:'external',poNumber:'PO-77',incoterm:'CIF 洛杉矶',deliveryPlace:''}};
  s.productions.push({id:'p',code:'PR-1',orderId:'o',lineId:'l',order:'SO-1',name:'大衣',factory:'工厂',qty:10,due:'2026-11-01',pct:100,img:'coat',col:'done'});
  render();await click(host.querySelectorAll<HTMLButtonElement>('button').values().find(b=>b.textContent==='新建出运')!);
  const select=getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement;
  act(()=>{select.value='production:p';select.dispatchEvent(new Event('change',{bubbles:true}));});
  typeInto(host.querySelector('input[type="number"]') as HTMLInputElement,'7');
  expect(host.textContent).toContain('来源订单尚未核对合同收货条款');
  await click(getByRole(host,'button',{name:'核对合同收货条款'}));
  expect(host.textContent).toContain('核对来源合同收货与分批条款');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('客户 PO PO-77');
  s.fulfillment.shippingTerms.push({orderId:'o',consignee:'Cedar DC',partialAllowed:true,mode:'sea',confirmedAt:'2026-10-12',evidence:'客户 PO PO-77'} as any);
  await click(getByRole(host,'button',{name:'返回列表'}));
  expect((getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement).value).toBe('production:p');
  expect((host.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('7');
  expect(host.textContent).toContain('Cedar DC');
  typeInto(host.querySelector('input[type="number"]') as HTMLInputElement,'10');
  await click(getByRole(host,'button',{name:'下一步'}));
  expect([...host.querySelectorAll('select')].map(x=>x.getAttribute('aria-label')+'='+x.value).join(';')).toContain('贸易术语=CIF');
  s.orders.push({...s.orders[0],id:'o2',code:'SO-2',governance:{...(s.orders[0] as any).governance,contract:{...(s.orders[0] as any).governance.contract,incoterm:'FOB 上海'}}} as any);s.orderLines.push({...s.orderLines[0],id:'l2',orderId:'o2'});s.productions.push({...s.productions[0],id:'p2',code:'PR-2',orderId:'o2',lineId:'l2'});s.fulfillment.shippingTerms.push({...s.fulfillment.shippingTerms[0],orderId:'o2'});render();await click(getByRole(host,'button',{name:'上一步'}));const nextSource=getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement;act(()=>{nextSource.value='production:p2';nextSource.dispatchEvent(new Event('change',{bubbles:true}));});await click(getByRole(host,'button',{name:'下一步'}));expect((getByRole(host,'combobox',{name:'贸易术语'}) as HTMLSelectElement).value).toBe('FOB');
});
it('retains all source rows and entered quantities when contract checking is cancelled',async()=>{
 const s=store.state!;(s.orders[0] as any).governance={status:'approved',contract:{kind:'external',poNumber:'PO-77',incoterm:'FOB 上海'}};s.productions.push({id:'p',code:'PR-1',orderId:'o',lineId:'l',order:'SO-1',name:'大衣',factory:'工厂',qty:10,due:'2026-11-01',pct:100,img:'coat',col:'done'});
 render();await click(getAllByRole(host,'button',{name:'新建出运'})[0]);const select=getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement;act(()=>{select.value='production:p';select.dispatchEvent(new Event('change',{bubbles:true}));});typeInto(host.querySelector('input[type="number"]') as HTMLInputElement,'8');await click(getByRole(host,'button',{name:'增加来源条目'}));const quantities=getAllByRole(host,'spinbutton') as HTMLInputElement[];typeInto(quantities[1],'3');await click(getByRole(host,'button',{name:'核对合同收货条款'}));await click(getByRole(host,'button',{name:'返回列表'}));expect((getByRole(host,'combobox',{name:'来源条目 1'}) as HTMLSelectElement).value).toBe('production:p');expect((getByRole(host,'combobox',{name:'来源条目 2'}) as HTMLSelectElement).value).toBe('');expect((getAllByRole(host,'spinbutton') as HTMLInputElement[]).map(x=>x.value)).toEqual(['8','3']);expect(store.run).not.toHaveBeenCalled();
});

async function packingEditorDraft(){
 const state=store.state!;state.fulfillment.shipments.push(shipment('packing-source'));
 state.fulfillment.packing.push(pack('packing-source',10));render('packing-source');
 await click(getByRole(host,'button',{name:'分配装箱'}));
 typeInto(getByRole(host,'spinbutton',{name:'毛重'}) as HTMLInputElement,'11');
 return state;
}
it('retains the old packing input and refuses to overwrite a colleague packing update after sync',async()=>{
 const state=await packingEditorDraft();
 store.state={...state,fulfillment:{...state.fulfillment,packing:state.fulfillment.packing.map(row=>({...row,netWeight:7,grossWeight:8}))}};
 store.workspace.revision=7;render('packing-source');await click(getByRole(host,'button',{name:'保存装箱分配'}));
 expect(store.run).not.toHaveBeenCalled();expect(host.textContent).toContain('装箱来源已更新，请重新打开后核对');
 expect((getByRole(host,'spinbutton',{name:'毛重'}) as HTMLInputElement).value).toBe('11');
});
it('refuses an old packing plan when the shipment source quantity changed',async()=>{
 const state=await packingEditorDraft();
 store.state={...state,fulfillment:{...state.fulfillment,shipments:state.fulfillment.shipments.map(row=>({...row,lines:row.lines.map(line=>({...line,quantity:8}))}))}};
 store.workspace.revision=7;render('packing-source');await click(getByRole(host,'button',{name:'保存装箱分配'}));
 expect(store.run).not.toHaveBeenCalled();expect(host.textContent).toContain('装箱来源已更新，请重新打开后核对');
 expect((getByRole(host,'spinbutton',{name:'装箱数量（件）'}) as HTMLInputElement).value).toBe('10');
});
it('binds packing to the checked revision while allowing an unrelated task event',async()=>{
 const state=await packingEditorDraft();
 store.state={...state,events:[...state.events,{id:'other-event',entityType:'task',entityId:'other-task',actor:'同事',at:'2026-10-13T10:01:00Z',text:'新增个人待办',fileIds:[]}]};
 store.workspace.revision=7;render('packing-source');await click(getByRole(host,'button',{name:'保存装箱分配'}));
 expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.shipments.pack',payload:expect.objectContaining({lines:[expect.objectContaining({grossWeight:11})]})}),{expectedRevision:7});
});
it('keeps an unread packing source from submitting while retaining entered weights',async()=>{
 await packingEditorDraft();store.state=null;render('packing-source');await click(getByRole(host,'button',{name:'保存装箱分配'}));
 expect(store.run).not.toHaveBeenCalled();expect(host.textContent).toContain('装箱资料未读取，请重新打开后核对');
 expect((getByRole(host,'spinbutton',{name:'毛重'}) as HTMLInputElement).value).toBe('11');
});

it.each([true,false])('lets the logistics reader consume only current release metadata (authorized %s)',authorized=>{
 session.denied.add('risk:read');session.denied.add('orders:write');session.id='warehouse';const f=store.state!.fulfillment;
 f.shipments.push(shipment('s',{state:'ready',booking:'BK',documentsSentAt:'2026-10-12T08:00:00Z'}));f.customs.push(customs('s','cleared'));
 store.state!.market.relations=[{id:'relation',customerId:'c',supplierId:'',name:'Cedar',hold:{at:'2026-10-12T08:00:00Z',actor:'财务',reason:'经营复核'}}]as any;store.state!.platform.risks=[];
 store.workspace.shipmentReleaseGates={s:{held:true,unusedAuthorized:authorized}};render('s');
 const detail=host.querySelector('[data-shipment-detail="s"]') as HTMLElement;expect((getByRole(detail,'button',{name:'登记实际离港'})as HTMLButtonElement).disabled).toBe(!authorized);expect(store.state!.platform.risks).toEqual([]);expect(store.run).not.toHaveBeenCalled();
});
it('keeps export clearance blocking even with an unused credit release',()=>{
 const f=store.state!.fulfillment;f.shipments.push(shipment('s',{state:'ready',documentsSentAt:'2026-10-12T08:00:00Z'}));f.customs.push(customs('s','submitted'));store.workspace.shipmentReleaseGates={s:{held:true,unusedAuthorized:true}};render('s');const detail=host.querySelector('[data-shipment-detail="s"]')as HTMLElement;expect((getByRole(detail,'button',{name:'登记实际离港'})as HTMLButtonElement).disabled).toBe(true);expect(detail.textContent).toContain('出口清关尚未完成');
});

it('keeps customer document dispatch blocking even with an unused credit release',()=>{
 const f=store.state!.fulfillment;f.shipments.push(shipment('s',{state:'ready'}));f.customs.push(customs('s','cleared'));store.workspace.shipmentReleaseGates={s:{held:true,unusedAuthorized:true}};render('s');const detail=host.querySelector('[data-shipment-detail="s"]')as HTMLElement;expect((getByRole(detail,'button',{name:'登记实际离港'})as HTMLButtonElement).disabled).toBe(true);expect(detail.textContent).toContain('等待业务登记对客发送 CI / PL');
});
