// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentSample} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const write=vi.hoisted(()=>({allowed:true}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:'sales',displayName:'业务员'},sessionKey:'s',hasPermission:()=>write.allowed,canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {SamplesPage} from './SamplesPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(id?:string,context:Record<string,string>={}){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'samples',id,...context},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><SamplesPage/></Nav.Provider></ToastProvider></MistRoot>));}
const version={kind:'version' as const,devId:'dev',versionId:'ver'};
function fabric(id:string,form:string,unit:string,quantity:number,available:number):FulfillmentSample{return {id,code:id.toUpperCase(),name:'亚麻平纹',category:'面料',form,unit,quantity,available,location:'A-01',size:'',color:'',source:version,fileIds:[],note:'',createdAt:'2026-10-10T08:00:00Z'};}
beforeEach(()=>{write.allowed=true;store.state=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'业务员'},'empty');store.run.mockReset();go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

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

it('flags overdue loans and explains why return is unavailable',()=>{
  const sample=fabric('smp-m','米样','米',10,8);store.state!.fulfillment.samples.push(sample);
  store.state!.fulfillment.sampleMovements.push({id:'loan',sampleId:'smp-m',kind:'lend',quantity:2,person:'李工',location:'工厂',note:'',at:'2026-10-01T08:00:00Z',actor:'业务员',expectedReturn:'2026-10-05'});
  render('smp-m');
  expect(host.textContent).toContain('1 笔借出已超过预计归还日');expect(host.textContent).toContain('逾期未还');
  expect((getByRole(host,'button',{name:'归还'}) as HTMLButtonElement).disabled).toBe(false);
  store.state!.fulfillment.sampleMovements=[];render('smp-m');
  expect((getByRole(host,'button',{name:'归还'}) as HTMLButtonElement).disabled).toBe(true);
  expect(host.textContent).toContain('归还：没有未归还的借出');
});

it('keeps the ledger readable and hides unauthorized actions',()=>{
  write.allowed=false;store.state!.fulfillment.samples.push(fabric('smp-m','米样','米',10,10));render('smp-m');
  expect(getByRole(host,'table',{name:'样品台账'})).toBeTruthy();
  for(const label of ['借出','寄出','归还','移位','查看 / 发起本样品QC'])expect(getAllByRole(host,'button').some(button=>button.textContent===label)).toBe(false);
  expect(host.textContent).not.toContain('新建样品');
});

it('opens a quick movement dialog over the ledger instead of replacing the page',async()=>{
  store.state!.fulfillment.samples.push({...fabric('smp-g','开发样','件',1,1),category:'成衣',size:'M',color:'藏青'});render('smp-g');
  await act(async()=>getByRole(host,'button',{name:'寄出'}).click());
  expect(getByRole(document.body,'dialog',{name:/登记永久寄出/})).toBeTruthy();
  expect(getByRole(host,'table',{name:'样品台账'})).toBeTruthy();
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
