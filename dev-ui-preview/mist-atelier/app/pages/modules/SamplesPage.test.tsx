// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,getAllByRole,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentSample} from '../../../../../server/src/shared/mistFulfillment';
import {confirmShippingSampleBasis,shippingSampleSourceSnapshot} from '../../../../../server/src/shared/mistShipmentSampleCustody';
import {Nav} from '../../nav';
import {MistPresentedErrorContext} from '../../runtime/errorPresentation';
const store=vi.hoisted(()=>({state:null as MistState|null,workspace:{id:'workspace',revision:1},loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const write=vi.hoisted(()=>({allowed:true}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:'sales',displayName:'业务员'},sessionKey:'s',hasPermission:()=>write.allowed,canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {SamplesPage} from './SamplesPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;let presentedError:string|undefined;const go=vi.fn();
function render(id?:string,context:Record<string,string>={}){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'samples',id,...context},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><MistPresentedErrorContext.Provider value={presentedError}><SamplesPage/></MistPresentedErrorContext.Provider></Nav.Provider></ToastProvider></MistRoot>));}
const version={kind:'version' as const,devId:'dev',versionId:'ver'};
function shippingCustodyFixture(){
 const state=store.state!;state.orders.push({id:'custody-order',type:'garment',ownerId:'sales'}as any);state.orderLines.push({id:'custody-line',orderId:'custody-order',unit:'件'}as any);state.productions.push({id:'custody-production',orderId:'custody-order',lineId:'custody-line'}as any);
 state.fulfillment.shipments.push({id:'custody-ship',code:'SHP-CUSTODY',state:'departed',domain:'garment',departedAt:'2026-11-19T14:00:00Z',departureEvidence:'Original carrier confirmation',fileIds:[],lines:[{orderId:'custody-order',lineId:'custody-line',productionId:'custody-production',quantity:8}]}as any);
 state.fulfillment.packing.push({id:'custody-box',shipmentId:'custody-ship',lineId:'custody-line',productionId:'custody-production',carton:'A01',quantity:8,assortment:[{color:'Blue',size:'M',quantity:8}]}as any);
 const sample:FulfillmentSample={id:'custody-sample',code:'SMP-CUSTODY',name:'Shipping specimen',category:'成衣',form:'船样',unit:'件',quantity:4,available:4,location:'A01',positions:[{location:'A01',available:4}],color:'Blue',size:'M 4',sizeQuantities:[{size:'M',quantity:4}],role:'shipping',shipmentId:'custody-ship',source:{kind:'orderLine',orderId:'custody-order',lineId:'custody-line',productionId:'custody-production'},fileIds:[],note:'Not a machine-readable classification',createdAt:'2026-11-18T04:00:00Z'};state.fulfillment.samples.push(sample);return sample;
}
it('blocks borrowing an undeclared departed specimen and asks for an explicit quantity basis without a default',async()=>{
 const sample=shippingCustodyFixture();render(sample.id);const form=host.querySelector('[data-sample-form="'+sample.id+'"]')as HTMLElement;expect(queryByRole(form,'button',{name:'借出',exact:true})).toBeNull();expect(queryByRole(form,'button',{name:'寄出',exact:true})).toBeNull();expect(form.textContent).toContain('未确认');await act(async()=>getByRole(form,'button',{name:'确认数量口径',exact:true}).click());
 const dialog=getByRole(document.body,'dialog',{name:'补记样品数量口径'}),kind=getByRole(dialog,'combobox',{name:'数量口径'})as HTMLSelectElement;expect(kind.value).toBe('');expect(Array.from(kind.options).map(x=>x.label)).toContain('大货内随本批出运');expect(Array.from(kind.options).map(x=>x.label)).toContain('独立实物（不占本批大货）');
 act(()=>fireEvent.change(kind,{target:{value:'independent'}}));act(()=>fireEvent.change(getByRole(dialog,'textbox',{name:'独立实物来源与保管依据'}),{target:{value:'Factory supplied an extra specimen; physically stored in A01'}}));act(()=>fireEvent.change(getByRole(dialog,'textbox',{name:'确认依据'}),{target:{value:'Actual specimen and original carrier record checked'}}));await act(async()=>getByRole(dialog,'button',{name:'确认并补记'}).click());
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.shippingBasis',payload:expect.objectContaining({id:sample.id,kind:'independent',independentSource:'Factory supplied an extra specimen; physically stored in A01',reconcileDeparted:true,sourceSnapshot:expect.objectContaining({sampleId:sample.id,shipmentId:'custody-ship',quantity:4,unit:'件'})})});
});
it('shows consumed quantity and history without restoring movement or correction actions',()=>{
 const sample=shippingCustodyFixture();const state=store.state!;
 const source={sampleId:sample.id,shipmentId:'custody-ship',orderId:'custody-order',lineId:'custody-line',productionId:'custody-production',quantity:4,unit:'件',color:'Blue',sizeQuantities:[{size:'M',quantity:4}],shipmentQuantity:8,commercialUnit:'件',packing:[{id:'custody-box',carton:'A01',quantity:8,color:'',assortment:[{color:'Blue',size:'M',quantity:8}]}]};
 confirmShippingSampleBasis(state,{id:sample.id,kind:'included',sourceSnapshot:source,evidence:'Original carrier evidence',fileIds:[],reconcileDeparted:true},{id:()=>crypto.randomUUID(),now:'2026-11-19T14:00:00Z',actorName:'Sales'});render(sample.id);const form=host.querySelector('[data-sample-form="'+sample.id+'"]')as HTMLElement;expect(form.textContent).toContain('已随货出运');expect(form.textContent).toContain('补记随货');expect(form.textContent).toContain('0 / 4');expect(queryByRole(form,'button',{name:'借出',exact:true})).toBeNull();expect(queryByRole(form,'button',{name:'更正口径',exact:true})).toBeNull();
});
it.each(['arrived','delivered'])('uses the same post-departure reconciliation UI and payload at %s',async phase=>{
 const sample=shippingCustodyFixture();(store.state!.fulfillment.shipments[0]as any).state=phase;render(sample.id);const form=host.querySelector('[data-sample-form="'+sample.id+'"]')as HTMLElement;expect(queryByRole(form,'button',{name:'借出',exact:true})).toBeNull();await act(async()=>getByRole(form,'button',{name:'确认数量口径',exact:true}).click());
 const dialog=getByRole(document.body,'dialog',{name:'补记样品数量口径'});act(()=>fireEvent.change(getByRole(dialog,'combobox',{name:'数量口径'}),{target:{value:'included'}}));act(()=>fireEvent.change(getByRole(dialog,'textbox',{name:'确认依据'}),{target:{value:'Original ATD and physical members checked'}}));await act(async()=>getByRole(dialog,'button',{name:'确认并补记'}).click());expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.shippingBasis',payload:expect.objectContaining({id:sample.id,kind:'included',reconcileDeparted:true})});
});
it.each(['arrived','delivered'])('keeps the existing %s sample readable without creating a replacement shipping balance',phase=>{
 const sample=shippingCustodyFixture();(store.state!.fulfillment.shipments[0]as any).state=phase;render(sample.id,{section:'shipment:custody-ship',productionId:'custody-production'});expect(queryByRole(host,'button',{name:'新建样品',exact:true})).toBeNull();expect(host.querySelector('[data-sample-form="'+sample.id+'"]')).not.toBeNull();
});
it('requires current commercial source capability before lending an included group and blocks permanent disposition',()=>{
 const sample=shippingCustodyFixture(),state=store.state!,ship=state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;
 confirmShippingSampleBasis(state,{id:sample.id,kind:'included',sourceSnapshot:shippingSampleSourceSnapshot(state,sample),evidence:'Actual4 members are inside commercial8',fileIds:[]},{id:()=>crypto.randomUUID(),now:'2026-11-19T14:00:00Z',actorName:'Sales'});render(sample.id);const form=host.querySelector('[data-sample-form="'+sample.id+'"]')as HTMLElement;getByRole(form,'button',{name:'移位',exact:true});expect((getByRole(form,'button',{name:'借出',exact:true})as HTMLButtonElement).disabled).toBe(true);for(const name of ['寄出','报废','退还工厂'])expect(queryByRole(form,'button',{name,exact:true})).toBeNull();expect(form.textContent).toContain('大货内随本批出运');
});
it('selects the actual bounded commercial source without requiring inventory access or a free-text source',async()=>{
 const sample=shippingCustodyFixture(),state=store.state!,ship=state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;
 confirmShippingSampleBasis(state,{id:sample.id,kind:'included',sourceSnapshot:shippingSampleSourceSnapshot(state,sample),evidence:'Actual original group',fileIds:[]},{id:()=>crypto.randomUUID(),now:'2026-11-19T14:00:00Z',actorName:'Sales'});
 state.members=[{userId:'borrower',name:'借用同事',addedBy:'sales',addedByName:'业务员',addedAt:'2026-11-18T00:00:00Z'}];
 (store.workspace as any).commercialSampleLoanSources={[sample.id]:{status:'available',kind:'warehouse',quantity:4,unit:'件',options:[{stockId:'stock-source',location:'仓内A01',label:'PO-1 · 批次甲 · A01',maxQuantity:4,unit:'件'}]}};
 render(sample.id);await act(async()=>getByRole(host,'button',{name:'借出',exact:true}).click());const dialog=getByRole(document.body,'dialog',{name:'登记借出 · 船样'});
 expect((getByRole(dialog,'spinbutton',{name:/商业来源 · PO-1/})as HTMLInputElement).value).toBe('4');
 act(()=>fireEvent.change(getByRole(dialog,'combobox',{name:'借用人'}),{target:{value:'borrower'}}));await act(async()=>getByRole(dialog,'button',{name:'保存流转'}).click());
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.move',payload:expect.objectContaining({id:sample.id,kind:'lend',quantity:4,borrowerId:'borrower',commercialSources:[{stockId:'stock-source',location:'仓内A01',quantity:4}]})});
 expect(JSON.stringify(store.run.mock.calls)).not.toContain('sampleLoan');
});
it('returns a commercial group through the original visible return facts while inventory identities remain absent',async()=>{
 const sample=shippingCustodyFixture(),state=store.state!,ship=state.fulfillment.shipments[0];ship.state='ready';delete ship.departedAt;sample.available=0;sample.positions![0].available=0;
 state.fulfillment.sampleMovements.push({id:'source-loan',sampleId:sample.id,kind:'lend',quantity:4,person:'借用同事',location:'',note:'原组借出',at:'2026-11-18T04:00:00Z',actor:'业务员',commercialReturn:{location:'A01',quantity:4,unit:'件'}});
 render(sample.id);await act(async()=>getByRole(host,'button',{name:'归还',exact:true}).click());const dialog=getByRole(document.body,'dialog',{name:'登记整组归还 · 船样'});
 expect((getByRole(dialog,'combobox',{name:'原借出'})as HTMLSelectElement).value).toBe('source-loan');expect((getByRole(dialog,'spinbutton',{name:'本次数量（件）'})as HTMLInputElement).value).toBe('4');expect((getByRole(dialog,'textbox',{name:'原归还位置'})as HTMLInputElement).value).toBe('A01');
 await act(async()=>getByRole(dialog,'button',{name:'保存流转'}).click());expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.move',payload:expect.objectContaining({kind:'return',loanId:'source-loan',quantity:4,location:'A01'})});expect(JSON.stringify(store.run.mock.calls)).not.toContain('commercialSources');
});
it('requires quantity classification before generic movement even while the shipment is still preparing',()=>{
 const sample=shippingCustodyFixture(),ship=store.state!.fulfillment.shipments[0];ship.state='preparing';delete ship.departedAt;render(sample.id);const form=host.querySelector('[data-sample-form="'+sample.id+'"]')as HTMLElement;getByRole(form,'button',{name:'确认数量口径',exact:true});for(const name of ['借出','寄出','移位','报废','退还工厂'])expect(queryByRole(form,'button',{name,exact:true})).toBeNull();
});
function fabric(id:string,form:string,unit:string,quantity:number,available:number):FulfillmentSample{return {id,code:id.toUpperCase(),name:'亚麻平纹',category:'面料',form,unit,quantity,available,location:'A-01',size:'',color:'',source:version,fileIds:[],note:'',createdAt:'2026-10-10T08:00:00Z'};}
it('returns an incoming original to its exact development sample and does not offer factory-result QC',async()=>{
 store.state!.devs.push({id:'incoming-dev',code:'DEV-IN',values:{domain:'fabric'}}as any);const sample={...fabric('incoming-piece','米样','米',1,1),source:{kind:'developmentIncoming' as const,devId:'incoming-dev',receiptId:'receipt'}};store.state!.fulfillment.samples.push(sample);render(sample.id);
 await act(async()=>getByRole(host,'button',{name:'开发来样 · DEV-IN',exact:true}).click());expect(go).toHaveBeenCalledWith('development/detail','incoming-dev',{section:'incoming:'+sample.id});expect(queryByRole(host,'button',{name:/发起本样品QC/})).toBeNull();for(const name of ['借出','寄出','归还','退还工厂'])expect(queryByRole(host,'button',{name,exact:true})).toBeNull();expect(getByRole(host,'button',{name:'移位',exact:true})).toBeTruthy();expect(store.run).not.toHaveBeenCalled();
});
beforeEach(()=>{store.workspace={id:'workspace',revision:1};presentedError=undefined;store.error='';write.allowed=true;store.state=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'业务员'},'empty');store.run.mockReset();go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('keeps independent manual fabric records separate and groups only an explicit archive selection',()=>{
 const state=store.state!,base={...fabric('first','色样','份',1,1),source:{kind:'manual' as const,description:'展会来样'}};
 const other={...base,id:'second',code:'SECOND',location:'B'},child={...base,id:'third',code:'THIRD',manualLinks:{archiveId:base.id},form:'米样',unit:'米'};
 state.fulfillment.samples.push(base,other,child);render(other.id);
 expect([...host.querySelectorAll('[data-sample-form]')].map(el=>el.getAttribute('data-sample-form'))).toEqual([other.id]);
 render(child.id);expect([...host.querySelectorAll('[data-sample-form]')].map(el=>el.getAttribute('data-sample-form'))).toEqual([base.id,child.id]);
});
it('keeps server registrar metadata out of the manual specimen editor request',async()=>{
 const sample={...fabric('smp-registered-edit','米样','米',3,3),source:{kind:'manual' as const,description:'供应商目录留样'},registeredById:'sales',note:'登记原说明'};store.state!.fulfillment.samples.push(sample);store.run.mockResolvedValue({result:{id:sample.id},revision:2});render(sample.id);
 await act(async()=>getByRole(host,'button',{name:'编辑资料',exact:true}).click());const registrarField=queryByRole(document.body,'textbox',{name:/登记人|registeredBy/i})as HTMLInputElement|null;expect(!registrarField||registrarField.readOnly||registrarField.disabled).toBe(true);act(()=>fireEvent.change(getByRole(document.body,'textbox',{name:'备注',exact:true}),{target:{value:'登记后补充说明'}}));while(queryByRole(document.body,'button',{name:'下一步',exact:true}))await act(async()=>getByRole(document.body,'button',{name:'下一步',exact:true}).click());await act(async()=>getByRole(document.body,'button',{name:'确认保存',exact:true}).click());
 const command=store.run.mock.calls[0][0];expect(command).toEqual({type:'fulfillment.samples.edit',payload:{id:sample.id,name:sample.name,form:sample.form,size:sample.size,color:sample.color,location:sample.location,note:'登记后补充说明',fileIds:[]}});expect(command.payload).not.toHaveProperty('registeredById');expect(sample.registeredById).toBe('sales');
});

it('does not echo the server registrar when associating an uploaded manual-sample attachment',async()=>{
 const sample={...fabric('smp-registered-file','米样','米',3,3),source:{kind:'manual' as const,description:'供应商目录留样'},registeredById:'sales',fileIds:['registered-old'],note:'登记原说明'};store.state!.fulfillment.samples.push(sample);store.state!.files.push({id:'registered-old',name:'old.txt'}as any,{id:'registered-upload',name:'new.txt'}as any);store.uploadFile.mockResolvedValue({id:'registered-upload',name:'new.txt'});store.run.mockResolvedValue({result:{id:sample.id},revision:2});render(sample.id);
 const group=getByRole(host,'group',{name:'SMP-REGISTERED-FILE · 附件',exact:true}),input=group.querySelector<HTMLInputElement>('input[type=file]')!;await act(async()=>{Object.defineProperty(input,'files',{value:[new File(['source'],'new.txt',{type:'text/plain'})],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.edit',payload:{id:sample.id,location:sample.location,note:sample.note,fileIds:['registered-old','registered-upload']}},{expectedRevision:1});expect(store.run.mock.calls[0][0].payload).not.toHaveProperty('registeredById');expect(sample.registeredById).toBe('sales');
});
it.each([true,false])('does not expose an empty sample ledger or enable operations before its workspace is read (loading %s)',loading=>{
 store.state=null;store.loading=loading;store.error=loading?'':'服务读取失败';try{render();expect((getByRole(host,'button',{name:'新建样品',exact:true})as HTMLButtonElement).disabled).toBe(true);expect((getByRole(host,'button',{name:'同步已返样版本',exact:true})as HTMLButtonElement).disabled).toBe(true);expect(queryByRole(host,'table',{name:'样品台账'})).toBeNull();expect(queryByRole(host,'button',{name:/^全部\s*0$/})).toBeNull();expect(queryByRole(host,'tab',{name:/^面料\s*0$/})).toBeNull();expect(host.textContent).not.toContain('还没有样品档案');expect(store.run).not.toHaveBeenCalled();}finally{store.loading=false;}
});

it('keeps an open sample movement above a responsive detail drawer and retains its location',async()=>{
 const previous=window.matchMedia,listeners=new Set<()=>void>(),media={matches:false,addEventListener:(_type:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_type:string,fn:()=>void)=>listeners.delete(fn)};Object.defineProperty(window,'matchMedia',{configurable:true,writable:true,value:()=>media});
 try{store.state!.fulfillment.samples.push(fabric('smp-layer','A4','张',2,2));render();await act(async()=>getByRole(getByRole(host,'table',{name:'样品台账'}),'row',{name:/SMP-LAYER/}).click());await act(async()=>getByRole(host,'button',{name:'移位',exact:true}).click());const d=getByRole(document.body,'dialog',{name:'登记移位 · A4',exact:true}),location=getByRole(d,'textbox',{name:'新位置',exact:true})as HTMLInputElement;act(()=>fireEvent.change(location,{target:{value:'复核位置'}}));act(()=>{media.matches=true;listeners.forEach(fn=>fn());});expect(getAllByRole(document.body,'dialog')).toHaveLength(1);expect(location.value).toBe('复核位置');await act(async()=>getByRole(d,'button',{name:'取消',exact:true}).click());expect(getByRole(document.body,'dialog',{name:'亚麻平纹',exact:true})).toBeTruthy();expect(store.run).not.toHaveBeenCalled();}finally{Object.defineProperty(window,'matchMedia',{configurable:true,writable:true,value:previous});}
});

it('opens a linked sample on compact screens and opens the next linked sample after closing',async()=>{
  const matchMedia=window.matchMedia;
  window.matchMedia=vi.fn().mockImplementation((query:string)=>({matches:query==='(max-width: 1180px)',media:query,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  try{
    store.state!.fulfillment.samples.push(
      {...fabric('smp-one','开发样','件',1,1),category:'成衣',name:'羊毛短大衣'},
      {...fabric('smp-two','开发样','件',1,1),category:'成衣',name:'棉麻夹克'},
    );
    render('smp-one');
    let drawer=getByRole(document.body,'dialog',{name:'羊毛短大衣'});
    expect(drawer.textContent).toContain('SMP-ONE');
    await act(async()=>getByRole(drawer,'button',{name:'关闭',exact:true}).click());
    expect(queryByRole(document.body,'dialog')).toBeNull();
    render('smp-two');
    drawer=getByRole(document.body,'dialog',{name:'棉麻夹克'});
    expect(drawer.textContent).toContain('SMP-TWO');
    render();
    expect(queryByRole(document.body,'dialog')).toBeNull();
  }finally{window.matchMedia=matchMedia;}
});

it.each([{domain:'fabric',category:'羊毛混纺斜纹'},{domain:'garment',category:'面料拼接夹克'}] as const)('sends a returned sample to its explicit $domain QC domain',async({domain,category})=>{
  store.state!.devs.push({id:'dev',code:'DEV-DOMAIN',values:{domain,category}} as any);
  store.state!.versions.push({id:'ver',devId:'dev',factory:'试样厂',label:'R1-A'} as any);
  store.state!.fulfillment.samples.push(fabric('smp-domain','米样','米',3,3));
  store.run.mockResolvedValue({result:{id:'qc-new'}});
  render('smp-domain');
  await act(async()=>getByRole(host,'button',{name:'查看 / 发起本样品QC'}).click());
  await act(async()=>getByRole(host,'button',{name:'下一步'}).click());
  await act(async()=>getByRole(host,'button',{name:'发起送检'}).click());
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.qc.request',payload:expect.objectContaining({source:version,sampleId:'smp-domain',domain,kind:'sample'})});
});

it('groups fabric forms of one archive into a single row and never sums different units',()=>{
  store.state!.fulfillment.samples.push(fabric('smp-m','米样','米',12.5,12.5),fabric('smp-c','色卡','份',3,3));
  render();
  const table=getByRole(host,'table',{name:'样品台账'});
  expect(getAllByRole(table,'row').filter(row=>row.textContent?.includes('亚麻平纹'))).toHaveLength(1);
  expect(table.textContent).toContain('米样 · 12.5 米 可用');expect(table.textContent).toContain('色卡 · 3 份 可用');
  expect(table.textContent).not.toContain('15.5');
  expect(host.querySelectorAll('[data-sample-form]')).toHaveLength(2);
});

it('identifies each physical fabric specimen and uploads evidence to that specimen',async()=>{
 const old={...fabric('smp-old','米样','米',2.5,2.5),note:'原批次 P1',fileIds:['old-file']},current={...fabric('smp-new','米样','米',2.5,2.5),note:'重送批次 P2'};store.state!.fulfillment.samples.push(old,current);store.state!.files.push({id:'old-file',name:'P1.txt'} as any,{id:'new-upload',name:'P2.txt'} as any);store.uploadFile.mockReset();store.uploadFile.mockResolvedValue({id:'new-upload',name:'P2.txt'});
 render('smp-new');const form=host.querySelector('[data-sample-form="smp-new"]') as HTMLElement;expect(form.textContent).toContain('SMP-NEW');expect(form.textContent).toContain('重送批次 P2');const files=host.querySelector('[data-sample-files="smp-new"]') as HTMLElement;expect(files).toBeTruthy();
 await act(async()=>{const input=files.querySelector('input[type="file"]')!;Object.defineProperty(input,'files',{value:[new File(['P2'],'P2.txt',{type:'text/plain'})],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.edit',payload:{id:'smp-new',location:'A-01',note:'重送批次 P2',fileIds:['new-upload']}},{expectedRevision:1});expect(old.fileIds).toEqual(['old-file']);
});
it('edits the selected specimen and can remove a misassociated attachment without editing its sibling',async()=>{
 store.state!.fulfillment.samples.push({...fabric('smp-old','米样','米',2.5,2.5),note:'原批次 P1',fileIds:['old-file']},{...fabric('smp-new','米样','米',2.5,2.5),note:'重送批次 P2',fileIds:['new-file']});store.state!.files.push({id:'old-file',name:'P1.txt'} as any,{id:'new-file',name:'P2.txt'} as any);render('smp-new');const form=host.querySelector('[data-sample-form="smp-new"]') as HTMLElement;
 await act(async()=>getByRole(form,'button',{name:'编辑资料',exact:true}).click());getByRole(host,'heading',{name:'编辑样品资料'});const d=host;expect((getByRole(d,'textbox',{name:'备注'}) as HTMLInputElement).value).toBe('重送批次 P2');expect(d.textContent).toContain('P2.txt');expect(d.textContent).not.toContain('P1.txt');await act(async()=>getByRole(d,'button',{name:'移除',exact:true}).click());await act(async()=>getByRole(d,'button',{name:'下一步',exact:true}).click());await act(async()=>getByRole(d,'button',{name:'确认保存',exact:true}).click());
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.edit',payload:expect.objectContaining({id:'smp-new',note:'重送批次 P2',fileIds:[]})});
});
it('keeps return available for an open loan and hides it when no loan remains',()=>{
  const sample=fabric('smp-m','米样','米',10,8);store.state!.fulfillment.samples.push(sample);
  store.state!.fulfillment.sampleMovements.push({id:'loan',sampleId:'smp-m',kind:'lend',quantity:2,person:'李工',location:'工厂',note:'',at:'2026-10-01T08:00:00Z',actor:'业务员',expectedReturn:'2026-10-05'});
  render('smp-m');
  expect(host.textContent).toContain('1 笔借出已超过预计归还日');expect(host.textContent).toContain('逾期未还');
  expect((getByRole(host,'button',{name:'归还'}) as HTMLButtonElement).disabled).toBe(false);
  store.state!.fulfillment.sampleMovements=[];render('smp-m');
  expect(queryByRole(host,'button',{name:'归还'})).toBeNull();
  expect(host.textContent).not.toContain('归还：没有未归还的借出');
});

it('keeps the ledger readable and hides unauthorized actions',()=>{
  write.allowed=false;store.state!.fulfillment.samples.push(fabric('smp-m','米样','米',10,10),fabric('smp-new','米样','米',2.5,2.5));render('smp-m');
  expect(getByRole(host,'table',{name:'样品台账'})).toBeTruthy();
  for(const label of ['借出','寄出','归还','移位','查看 / 发起本样品QC'])expect(getAllByRole(host,'button').some(button=>button.textContent===label)).toBe(false);
  expect(host.textContent).not.toContain('新建样品');
  expect(queryByRole(host,'button',{name:'编辑资料'})).toBeNull();expect(host.querySelectorAll('[data-sample-files] input[type=file]')).toHaveLength(0);
});

it('opens a quick movement dialog over the ledger instead of replacing the page',async()=>{
  store.state!.fulfillment.samples.push({...fabric('smp-g','开发样','件',1,1),category:'成衣',size:'M',color:'藏青'});render('smp-g');
  await act(async()=>getByRole(host,'button',{name:'寄出'}).click());
  expect(getByRole(document.body,'dialog',{name:/登记永久寄出/})).toBeTruthy();
  expect(getByRole(host,'table',{name:'样品台账'})).toBeTruthy();
  expect((getByRole(document.body,'textbox',{name:'运单号'}) as HTMLInputElement).value).toBe('');
});

it('keeps a fully dispatched sample readable without inapplicable movement buttons or repeated notes',()=>{
  store.state!.fulfillment.samples.push(fabric('sent','米样','米',1,0));
  store.state!.fulfillment.sampleMovements.push({id:'dispatch',sampleId:'sent',kind:'send',sendPurpose:'confirmation',quantity:1,person:'客户',location:'Paris',note:'',at:'2026-10-10T08:00:00Z',actor:'业务员'});
  render('sent');expect(host.textContent).toContain('已寄出');
  for(const name of ['借出','寄出','归还','移位'])expect(queryByRole(host,'button',{name,exact:true})).toBeNull();
  expect(host.textContent).not.toContain('当前没有可用数量');expect(getByRole(host,'button',{name:'查看 / 发起本样品QC'})).toBeTruthy();
});

it('allows the outstanding borrowed quantity to return even when warehouse availability is zero',()=>{
  store.state!.fulfillment.samples.push(fabric('lent','米样','米',2,0));
  store.state!.fulfillment.sampleMovements.push({id:'loan',sampleId:'lent',kind:'lend',quantity:2,person:'同事',location:'办公室',note:'',at:'2026-10-10T08:00:00Z',actor:'业务员'});
  render('lent');expect((getByRole(host,'button',{name:'归还'}) as HTMLButtonElement).disabled).toBe(false);
  for(const name of ['借出','寄出','移位'])expect(queryByRole(host,'button',{name,exact:true})).toBeNull();
});

it('links a dispatch movement created on the development version back to that development',()=>{
  store.state!.devs.push({id:'dev',code:'DEV-6',name:'亚麻平纹'} as any);
  store.state!.fulfillment.samples.push(fabric('smp-m','米样','米',5,3));
  store.state!.fulfillment.sampleMovements.push({id:'send',sampleId:'smp-m',kind:'send',quantity:2,person:'客户 Anna',location:'',note:'寄样 DEV-6 R1-A-1；运单 SF123',at:'2026-10-13T09:00:00Z',actor:'业务员',trackingNo:'SF123',development:{devId:'dev',versionId:'ver',dispatchId:'d-1'}});
  render('smp-m');
  const link=[...document.body.querySelectorAll('button')].find(button=>button.textContent?.trim()==='查看开发案 DEV-6') as HTMLButtonElement;
  expect(link).toBeTruthy();act(()=>link.click());
  expect(go).toHaveBeenCalledWith('development/detail','dev',{versionId:'ver'});
});

it.each(['fabric','garment'] as const)('follows the linked production domain when the other category already has samples: %s',async domain=>{
  store.state!.orders.push({id:'linked-order',code:'SO-LINKED',type:domain} as any);
  store.state!.orderLines.push({id:'linked-line',orderId:'linked-order',name:'Linked item',style:'LINKED',img:'coat',qty:10,unit:domain==='fabric'?'米':'件',price:1,made:0,qc:0});
  store.state!.productions.push({id:'linked-production',orderId:'linked-order',lineId:'linked-line',order:'SO-LINKED',code:'PO-LINKED',name:'Linked item',factory:'Factory',qty:10,pct:0,col:'cut',img:'coat',due:'2026-12-01'});
  store.state!.fulfillment.samples.push({...fabric('opposite','样衣','件',1,1),category:domain==='fabric'?'成衣':'面料'});
  render(undefined,{productionId:'linked-production'});
  expect(getByRole(host,'tab',{name:domain==='fabric'?/^面料/:/^成衣/}).getAttribute('aria-selected')).toBe('true');
  await act(async()=>getAllByRole(host,'button',{name:'新建样品',exact:true})[0].click());
  expect((getByRole(host,'combobox',{name:'大类'}) as HTMLSelectElement).value).toBe(domain==='fabric'?'面料':'成衣');
  const source=getByRole(host,'combobox',{name:'来源'}) as HTMLSelectElement;
  expect(source.value).toBe('production:linked-production');expect(source.disabled).toBe(true);
  expect([...source.options].filter(option=>option.value).map(option=>option.value)).toEqual(['production:linked-production']);
  expect((getByRole(host,'combobox',{name:'大类'}) as HTMLSelectElement).disabled).toBe(true);
  expect((getByRole(host,'textbox',{name:'名称'}) as HTMLInputElement).value).toBe('Linked item');
  expect((getByRole(host,'combobox',{name:'样品用途'}) as HTMLSelectElement).value).toBe(domain==='fabric'?'pioneer':'pp');
  expect(host.textContent).not.toContain('出运批次');
});

it('scopes the ledger, selection and return to the exact production before grouping',()=>{
  const state=store.state!;state.orders.push({id:'order',code:'SO',type:'fabric'} as any);
  state.productions.push({id:'branch',orderId:'order',lineId:'line',order:'SO',code:'FUL-ONE',factory:'One',qty:20,pct:0} as any);
  const sample=(id:string,orderId:string,lineId:string,productionId:string)=>({...fabric(id,'米样','米',1,1),name:id,source:{kind:'orderLine' as const,orderId,lineId,productionId}});
  state.fulfillment.samples.push(fabric('development','米样','米',1,1),sample('other-branch','order','line','other'),sample('wrong-line','order','else','branch'),sample('wrong-order','else','line','branch'),sample('exact-branch','order','line','branch'));
  render('development',{productionId:'branch'});
  const table=getByRole(host,'table',{name:'样品台账'});
  expect(table.textContent).toContain('exact-branch');
  for(const other of ['DEVELOPMENT','other-branch','wrong-line','wrong-order'])expect(table.textContent).not.toContain(other);
  expect(host.textContent).not.toContain('同步已返样版本');
  act(()=>getByRole(host,'button',{name:'返回生产单'}).click());
  expect(go).toHaveBeenCalledWith('production-board',undefined,{productionId:'branch',orderLineId:'line'});
  expect(store.run).not.toHaveBeenCalled();
});

it.each([false,true])('never falls back to all samples or offers creation for an unavailable branch (closed=%s)',closed=>{
  const state=store.state!;state.fulfillment.samples.push(fabric('development','米样','米',1,1));
  if(closed)state.productions.push({id:'missing',orderId:'order',lineId:'line',code:'FUL-CLOSED',closed:true} as any);
  render('development',{productionId:'missing'});
  expect(getAllByRole(host,'button').some(button=>button.textContent==='新建样品')).toBe(false);
  expect(getByRole(host,'table',{name:'样品台账'}).textContent).not.toContain('DEVELOPMENT');
  expect(host.textContent).toContain(closed?'生产单已关闭':'生产单已不可用');
  expect(store.run).not.toHaveBeenCalled();
});

it('shows a required shipment only for a production shipping sample, keeping manual samples free of order roles',async()=>{
  store.state!.orders.push({id:'order',code:'SO',type:'fabric'} as any);
  store.state!.productions.push({id:'branch',orderId:'order',lineId:'line',order:'SO',code:'FUL',factory:'Factory',qty:20,pct:0} as any);
  render();await act(async()=>getAllByRole(host,'button',{name:'新建样品',exact:true})[0].click());
  expect(host.textContent).not.toContain('样品用途');expect(host.textContent).not.toContain('出运批次');
  const change=async(label:string,value:string)=>{const select=getByRole(host,'combobox',{name:label}) as HTMLSelectElement;await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});};
  await change('来源','production:branch');await change('样品用途','pioneer');
  expect(host.textContent).not.toContain('出运批次');
  await change('样品用途','shipping');expect(getByRole(host,'combobox',{name:'出运批次'})).toBeTruthy();
  const name=getByRole(host,'textbox',{name:'名称'}) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Fabric');name.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>getByRole(host,'button',{name:'下一步'}).click());
  expect(host.textContent).toContain('请填写出运批次');expect(store.run).not.toHaveBeenCalled();
  await change('来源','manual');expect(host.textContent).not.toContain('样品用途');expect(host.textContent).not.toContain('出运批次');
});

it('registers one factory/shipment sample set from actual size counts without copying the bulk allocation',async()=>{
 const state=store.state!;state.orders.push({id:'ship-order',code:'SO-SHIP',type:'garment'} as any);state.orderLines.push({id:'ship-line',orderId:'ship-order',name:'Jacket',style:'JK',qty:600,unit:'件',price:1,img:'coat',made:0,qc:0});state.productions.push({id:'ship-production',orderId:'ship-order',lineId:'ship-line',order:'SO-SHIP',code:'PROD-SHIP',name:'Jacket',factory:'Factory',qty:600,pct:100,col:'done',img:'coat',due:'2026-12-01'});state.fulfillment.shipments.push({id:'ship',code:'SHP-SET',domain:'garment',state:'preparing',customerId:'buyer',lines:[{orderId:'ship-order',lineId:'ship-line',productionId:'ship-production',quantity:600}]} as any);
 render(undefined,{section:'shipment:ship'});await act(async()=>getAllByRole(host,'button',{name:'新建样品',exact:true})[0].click());
 const fill=async(name:RegExp,value:string)=>{const input=getByRole(host,'textbox',{name}) as HTMLInputElement|HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});};
 await fill(/^名称/,'Jacket');await act(async()=>getByRole(host,'button',{name:'下一步'}).click());expect(host.textContent).toContain('尺码与件数');expect(host.textContent).not.toContain('数量 / 长度');await fill(/^尺码与件数/,'S:1\nM:1\nL:1');await act(async()=>getByRole(host,'button',{name:'下一步'}).click());await fill(/^存放位置/,'Sample room');await act(async()=>getByRole(host,'button',{name:'下一步'}).click());await act(async()=>getByRole(host,'button',{name:'登记样品'}).click());
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.create',payload:expect.objectContaining({quantity:3,unit:'件',role:'shipping',shipmentId:'ship',sizeQuantities:[{size:'S',quantity:1},{size:'M',quantity:1},{size:'L',quantity:1}],source:{kind:'orderLine',orderId:'ship-order',lineId:'ship-line',productionId:'ship-production'}})});
});

it('can inspect the second colour in a grouped fabric archive using its own physical sample',async()=>{
  const state=store.state!;state.orders.push({id:'order',code:'SO',type:'fabric'} as any);
  state.productions.push({id:'branch',orderId:'order',lineId:'line',order:'SO',code:'FUL',factory:'Factory',qty:20,pct:0} as any);
  const source={kind:'orderLine' as const,orderId:'order',lineId:'line',productionId:'branch'};
  state.fulfillment.samples.push({...fabric('camel','米样','米',0.5,0.5),source,role:'pioneer',color:'驼色'},{...fabric('charcoal','米样','米',0.5,0.5),source,role:'pioneer',color:'炭灰'});
  store.run.mockResolvedValue({result:{id:'qc-charcoal'}});render(undefined,{productionId:'branch'});
  const second=host.querySelector('[data-sample-form="charcoal"]') as HTMLElement;
  const table=getByRole(host,'table',{name:'样品台账'});
  expect(table.textContent).toContain('2份样品');expect(table.textContent).toContain('驼色');expect(table.textContent).toContain('炭灰');expect(host.textContent).not.toContain('2 种形态');
  expect(second.textContent).toContain('炭灰');
  await act(async()=>getByRole(second,'button',{name:'查看 / 发起本样品QC'}).click());
  await act(async()=>getByRole(host,'button',{name:'下一步'}).click());
  await act(async()=>getByRole(host,'button',{name:'发起送检'}).click());
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.qc.request',payload:expect.objectContaining({source,sampleId:'charcoal',domain:'fabric'})});
});

it('keeps all of a multi-branch shipment selectable while excluding samples outside the shipment',async()=>{
  const state=store.state!;state.orders.push({id:'order',code:'SO',type:'fabric'} as any);
  for(const id of ['first','second','outside'])state.productions.push({id,orderId:'order',lineId:'line',order:'SO',code:id,factory:id,qty:10,pct:0} as any);
  state.fulfillment.shipments.push({id:'ship',code:'SHP',domain:'fabric',state:'preparing',lines:['first','second'].map(productionId=>({productionId,orderId:'order',lineId:'line',quantity:10}))} as any);
  for(const id of ['first','second','outside'])state.fulfillment.samples.push({...fabric(id,'米样','米',1,1),name:id,source:{kind:'orderLine',orderId:'order',lineId:'line',productionId:id},role:'shipping',shipmentId:'ship'});
  render('outside',{section:'shipment:ship',productionId:'outside'});
  expect(getByRole(host,'table',{name:'样品台账'}).textContent).not.toContain('outside');
  await act(async()=>getAllByRole(host,'button',{name:'新建样品',exact:true})[0].click());
  const source=getByRole(host,'combobox',{name:'来源'}) as HTMLSelectElement;
  expect(source.disabled).toBe(false);expect(source.value).toBe('');
  expect([...source.options].filter(option=>option.value).map(option=>option.value)).toEqual(['production:first','production:second']);
});

it('keeps workspace conflicts in their existing presentation without reporting a failed read',()=>{
 store.error='公司已被他人更新，请刷新后重新确认';presentedError=store.error;render();
 expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
 presentedError=undefined;render();expect(host.textContent).toContain('样品操作未完成');
 expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
});
it('appends uploaded evidence using the current specimen location, note and file references',async()=>{
 store.state!.fulfillment.samples.push({...fabric('sample-files','米样','米',2.5,2.5),note:'旧备注',fileIds:['old']});let finish!:(value:unknown)=>void;store.uploadFile.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
 render('sample-files');const input=host.querySelector('[data-sample-files="sample-files"] input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[new File(['new'],'new.txt',{type:'text/plain'})]});await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
 store.state=structuredClone(store.state);Object.assign(store.state!.fulfillment.samples[0],{location:'B-02',note:'另一岗位已复核',fileIds:['old','peer']});store.workspace={id:'workspace',revision:2};render('sample-files');
 await act(async()=>{finish({id:'upload',name:'new.txt',mimeType:'text/plain',size:3,storageKey:'workspace/upload',createdAt:''});});
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.edit',payload:{id:'sample-files',location:'B-02',note:'另一岗位已复核',fileIds:['old','peer','upload']}},{expectedRevision:2});
});

it('requires actual shipping specimen size counts instead of inventing them from the factory plan',async()=>{
 const s=store.state!;s.orders.push({id:'tail-order',code:'SO-TAIL',type:'garment'} as any);
 s.orderLines.push({id:'tail-line',orderId:'tail-order',name:'Shirt',style:'SH',qty:12,unit:'件',price:42,img:'coat',made:12,qc:12});
 s.productions.push({id:'tail-prod',orderId:'tail-order',lineId:'tail-line',order:'SO-TAIL',code:'PROD-TAIL',name:'Shirt',factory:'Factory',qty:12,pct:100,col:'done',img:'coat',due:'2026-12-01'});
 s.fulfillment.productionFacts.push({productionId:'tail-prod',revision:1,sizes:[{size:'S',quantity:2},{size:'M',quantity:4},{size:'L',quantity:4},{size:'XL',quantity:2}]});
 s.fulfillment.shipments.push({id:'tail-ship',code:'SHP-TAIL',domain:'garment',state:'preparing',customerId:'buyer',lines:[{orderId:'tail-order',lineId:'tail-line',productionId:'tail-prod',quantity:4}]} as any);
 s.fulfillment.packing.push({id:'tail-pack',shipmentId:'tail-ship',lineId:'tail-line',productionId:'tail-prod',carton:'B01',quantity:4,netWeight:2,grossWeight:2.4,volume:0.028,note:'',assortment:[{color:'Blue',size:'M',quantity:2},{color:'Blue',size:'L',quantity:2}]});
 render(undefined,{section:'shipment:tail-ship'});await act(async()=>getAllByRole(host,'button',{name:'新建样品',exact:true})[0].click());
 const fill=async(name:RegExp,value:string)=>{const input=getByRole(host,'textbox',{name}) as HTMLInputElement|HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});};
 await fill(/^名称/,'Shirt');await act(async()=>getByRole(host,'button',{name:'下一步'}).click());
 expect((getByRole(host,'textbox',{name:/^尺码与件数/}) as HTMLTextAreaElement).value).toBe('');
 await act(async()=>getByRole(host,'button',{name:'下一步'}).click());expect(host.textContent).toContain('请填写尺码与件数');expect(store.run).not.toHaveBeenCalled();
 await fill(/^尺码与件数/,'M:1\nL:1');await act(async()=>getByRole(host,'button',{name:'下一步'}).click());await fill(/^存放位置/,'Warehouse B01');await act(async()=>getByRole(host,'button',{name:'下一步'}).click());await act(async()=>getByRole(host,'button',{name:'登记样品'}).click());
 expect(store.run).toHaveBeenCalledWith({type:'fulfillment.samples.create',payload:expect.objectContaining({quantity:2,unit:'件',role:'shipping',shipmentId:'tail-ship',sizeQuantities:[{size:'M',quantity:1},{size:'L',quantity:1}],source:{kind:'orderLine',orderId:'tail-order',lineId:'tail-line',productionId:'tail-prod'}})});
});
it('shows actual incoming receipt and custody dates for backdated entry while retaining the recording timestamp',()=>{
 const at='2026-11-18T04:00:00Z',sample={...fabric('incoming-dated','米样','米',3,2.5),createdAt:at,source:{kind:'developmentIncoming' as const,devId:'dated-dev',receiptId:'receipt'},incoming:{receivedAt:'2026-11-14',providerKind:'customer' as const,providerId:'customer',providerName:'客户',contact:'',recordedAt:at,recordedBy:'业务员',recordedById:'sales'}};store.state!.devs.push({id:'dated-dev',code:'DEV-DATE',values:{domain:'fabric'}}as any);store.state!.fulfillment.samples.push(sample);const transfer={dispatchId:'parcel',devId:'dated-dev',taskVersionId:'version',supplierId:'factory',supplierName:'工厂',returnExpected:true,delivery:{kind:'courier' as const,recipient:'工厂收件人',address:'工厂',carrier:'顺丰',trackingNo:'SF-LOCAL',evidence:''}};store.state!.fulfillment.sampleMovements.push({id:'receive-date',sampleId:sample.id,kind:'receive',quantity:3,person:'业务员',location:'A01',note:'',actor:'业务员',at},{id:'loan-date',sampleId:sample.id,kind:'lend',quantity:1,person:'工厂收件人',location:'工厂',note:'',actor:'业务员',at,expectedReturn:'2026-11-16',incomingTransfer:{...transfer,direction:'out',occurredAt:'2026-11-15'}},{id:'return-date',sampleId:sample.id,kind:'return',loanId:'loan-date',quantity:.5,person:'业务员',location:'B02',note:'',actor:'业务员',at,incomingTransfer:{...transfer,direction:'return',occurredAt:'2026-11-17',returnBatchId:'return-batch'}});const before=structuredClone(store.state);render(sample.id);const timeline=[...host.querySelectorAll('.mist-timeline .mist-tl')];expect(timeline.map(row=>row.querySelector('small')?.textContent)).toEqual(['· 2026-11-17','· 2026-11-15','· 2026-11-14']);for(const row of timeline){expect(row.querySelector('.mist-tl-text')?.textContent).toContain('登记');expect(row.querySelector('.mist-tl-text')?.textContent).toContain('2026/11/18');}expect(host.textContent).toContain('实际收样日');expect(host.textContent).toContain('2026-11-14');expect(store.state).toEqual(before);expect(store.run).not.toHaveBeenCalled();
});
it('keeps ordinary specimen timeline and loan choices on their existing recording dates',async()=>{
 const sample=fabric('ordinary-dated','米样','米',3,2);store.state!.fulfillment.samples.push(sample);store.state!.fulfillment.sampleMovements.push({id:'ordinary-loan',sampleId:sample.id,kind:'lend',quantity:1,person:'同事',location:'',note:'原借出',actor:'业务员',at:'2026-11-18T04:00:00Z',incomingTransfer:{occurredAt:'2026-11-15'}as any});render(sample.id);const row=host.querySelector('.mist-timeline .mist-tl')!;expect(row.querySelector('small')?.textContent).toContain('2026/11/18');expect(row.querySelector('.mist-tl-text')?.textContent).not.toContain('登记');await act(async()=>getByRole(host,'button',{name:'归还',exact:true}).click());expect((getByRole(document.body,'combobox',{name:'原借出'})as HTMLSelectElement).options[1].textContent).toContain('2026-11-18');expect(store.run).not.toHaveBeenCalled();
});
it('shows reference custody occurrence days while retaining immutable recording timestamps and the original manual source',()=>{
 const at='2026-11-18T04:00:00Z',sample={...fabric('reference-dated','米样','米',3,3),createdAt:'2026-11-14T04:00:00Z',source:{kind:'manual' as const,description:'公司留样'},registeredById:'sales'},transfer={devId:'reference-dev',taskVersionId:'reference-task',referenceId:'reference-link',snapshotId:'reference-snapshot',dispatchId:'reference-parcel',supplierId:'factory',supplierName:'工厂',direction:'out' as const,occurredAt:'2026-11-15',delivery:{kind:'handover' as const,recipient:'工厂联系人',address:'工厂样品室',carrier:'',trackingNo:'',evidence:'完整参考段交接'}};
 store.state!.fulfillment.samples.push(sample);store.state!.fulfillment.sampleMovements.push({id:'reference-loan',sampleId:sample.id,kind:'lend',quantity:.5,person:'工厂联系人',borrowerId:'',location:'工厂样品室',note:'参考借送',actor:'业务员',at,referenceTransfer:transfer},{id:'reference-return',sampleId:sample.id,kind:'return',loanId:'reference-loan',quantity:.5,person:'业务员',location:'A01',note:'原段归还',actor:'业务员',at,referenceTransfer:{...transfer,direction:'return',occurredAt:'2026-11-17',returnBatchId:'reference-return-batch'}});
 const before=structuredClone(store.state);render(sample.id);const rows=[...host.querySelectorAll('.mist-timeline .mist-tl')];expect(rows.map(row=>row.querySelector('small')?.textContent)).toEqual(['· 2026-11-17','· 2026-11-15']);for(const row of rows){expect(row.querySelector('.mist-tl-text')?.textContent).toContain('登记');expect(row.querySelector('.mist-tl-text')?.textContent).toContain('2026/11/18');}expect(store.state).toEqual(before);expect(store.run).not.toHaveBeenCalled();expect(sample.source.kind).toBe('manual');
});
