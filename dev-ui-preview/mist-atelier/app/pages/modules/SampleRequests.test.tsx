// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({permissions:['products:read','products:write','sample:room:write','invoices:read'],state:null as MistState|null,workspace:{id:'workspace',revision:1},loading:false,saving:false,pending:null,run:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth',()=>{const useMistSession=()=>({user:{id:'sales',displayName:'业务员'},sessionKey:'s',hasPermission:(p:string)=>store.permissions.includes(p)});return{useMistSession,useOptionalMistSession:useMistSession};});
import {SampleRequests} from './SampleRequests';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'samples',section:'requests',id:'request'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><SampleRequests/></Nav.Provider></ToastProvider></MistRoot>));}
beforeEach(()=>{
 store.state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-18T04:00:00Z',actorName:'业务员'},'empty');
 store.state.fulfillment.samples.push({id:'twill',code:'SMP-37',name:'棉斜纹米样',category:'面料',form:'米样',quantity:3,available:2.75,unit:'米',source:{kind:'manual',description:'留样'},location:'多个位置',positions:[{location:'B02',available:2},{location:'C03',available:.75},{location:'EMPTY',available:0}],size:'',color:'军绿',fileIds:[],note:'',createdAt:'2026-11-18T04:00:00Z'});
 (store.state as any).sampleRequests=[{id:'request',code:'SR-1',customerId:'customer',customer:'客户',description:'棉斜纹米样',quantity:.5,unit:'米',recipient:'收件人',address:'样品室',neededBy:'2026-11-20',note:'',state:'open',requesterId:'sales',requester:'业务员',createdAt:'2026-11-18T04:00:00Z',shipments:[]}];
 store.run.mockReset();store.run.mockResolvedValue({result:{id:'request'}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);
 render();
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const change=(label:string,value:string)=>act(()=>fireEvent.change(getByRole(document.body,'combobox',{name:label,exact:true}),{target:{value}}));
const amount=(value:string)=>act(()=>fireEvent.change(getByRole(document.body,'spinbutton',{name:'本次数量（米）',exact:true}),{target:{value}}));
async function open(){await act(async()=>getByRole(host,'button',{name:'据单寄出',exact:true}).click());change('寄出样品','twill');}
async function submit(){await act(async()=>getByRole(document.body,'button',{name:'登记寄出',exact:true}).click());}
it('requires an exact positive stock position, shows its unit and available balance, and sends it with the request',async()=>{
 await open();const location=getByRole(document.body,'combobox',{name:'本次出库位置',exact:true})as HTMLSelectElement;
 expect([...location.options].map(o=>o.textContent)).toEqual(['请选择位置','B02 · 可用 2 米','C03 · 可用 0.75 米']);await submit();expect(store.run).not.toHaveBeenCalled();
 change('本次出库位置','1');amount('0.25');await submit();expect(store.run).toHaveBeenCalledWith({type:'sample.request.fulfill',payload:{id:'request',sampleId:'twill',sourceLocation:'C03',quantity:.25,carrier:'',trackingNo:'',complete:true}});expect(go).toHaveBeenCalledWith('samples','request',{section:'requests'});
});
it('excludes a development incoming original from ordinary customer sample dispatch choices',async()=>{
 store.state!.fulfillment.samples.push({...store.state!.fulfillment.samples[0],id:'incoming-original',code:'SMP-INCOMING',source:{kind:'developmentIncoming',devId:'development',receiptId:'receipt'}});await open();const select=getByRole(document.body,'combobox',{name:'寄出样品',exact:true})as HTMLSelectElement;expect([...select.options].map(option=>option.value)).not.toContain('incoming-original');expect([...select.options].map(option=>option.value)).toContain('twill');expect(store.run).not.toHaveBeenCalled();
});
it('does not reuse an old sample position after changing the selected physical sample',async()=>{
 store.state!.fulfillment.samples.push({...store.state!.fulfillment.samples[0],id:'other',code:'SMP-OTHER',positions:[{location:'D01',available:1},{location:'D02',available:1}],available:2});
 await open();change('本次出库位置','1');change('寄出样品','other');expect((getByRole(document.body,'combobox',{name:'本次出库位置',exact:true})as HTMLSelectElement).value).toBe('');await submit();expect(store.run).not.toHaveBeenCalled();change('本次出库位置','0');amount('0.25');await submit();expect(store.run.mock.calls[0][0].payload).toMatchObject({sampleId:'other',sourceLocation:'D01'});
});
it('blocks a quantity above the chosen location even when total available is sufficient and retains a server failure for recovery',async()=>{
 await open();change('本次出库位置','1');amount('1');await submit();expect(store.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('所选位置的可用数量不足');amount('0.25');store.run.mockRejectedValueOnce(new Error('所选位置的可用数量不足'));await submit();expect(store.run).toHaveBeenCalledTimes(1);expect((getByRole(document.body,'spinbutton',{name:'本次数量（米）',exact:true})as HTMLInputElement).value).toBe('0.25');expect((getByRole(document.body,'combobox',{name:'本次出库位置',exact:true})as HTMLSelectElement).value).toBe('1');expect(queryByRole(document.body,'dialog',{name:'据单寄出 SR-1',exact:true})).not.toBeNull();
});
it('allows a sole unrecorded position without inventing a location or leaking UI selection keys',async()=>{
 store.state!.fulfillment.samples[0].positions=[{location:'',available:2.75}];await open();expect((getByRole(document.body,'combobox',{name:'本次出库位置',exact:true})as HTMLSelectElement).value).toBe('0');await submit();expect(store.run.mock.calls[0][0].payload).toMatchObject({sourceLocation:'',quantity:.5});expect(Object.keys(store.run.mock.calls[0][0].payload).some(k=>k.startsWith('position:'))).toBe(false);
});
it('defers a newly narrow request drawer until the open fulfillment dialog closes',async()=>{
 const previous=window.matchMedia,listeners=new Set<()=>void>(),media={matches:false,addEventListener:(_type:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_type:string,fn:()=>void)=>listeners.delete(fn)};
 window.matchMedia=vi.fn(()=>media)as any;
 try{
  act(()=>root.unmount());root=createRoot(host);render();await act(async()=>getByRole(host,'row',{name:/SR-1/}).click());await open();act(()=>{media.matches=true;listeners.forEach(fn=>fn());});
  expect(queryByRole(document.body,'dialog',{name:'客户',exact:true})).toBeNull();expect(getByRole(document.body,'dialog',{name:'据单寄出 SR-1',exact:true})).toBeTruthy();
  await act(async()=>getByRole(getByRole(document.body,'dialog',{name:'据单寄出 SR-1',exact:true}),'button',{name:'取消',exact:true}).click());expect(getByRole(document.body,'dialog',{name:'客户',exact:true})).toBeTruthy();
 }finally{window.matchMedia=previous;}
});

it('allows the business handler to issue the sent sample fee and reopen its exact receivable', async () => {
  const request = store.state!.sampleRequests![0];
  request.state = 'sent';
  request.fee = { amount: 12, currency: 'USD' };
  render();
  expect((getByRole(host, 'button', { name: '开具样品费' }) as HTMLButtonElement).disabled).toBe(false);
  request.fee.invoiceId = 'fee';
  store.state!.invoices.push({ id: 'fee', sampleRequestId: request.id } as any);
  render();
  await act(async () => getByRole(host, 'button', { name: '查看应收' }).click());
  expect(go).toHaveBeenCalledWith('invoices', 'fee');
  store.state!.invoices[0].sampleRequestId = 'other';
  render();
  expect(queryByRole(host, 'button', { name: '查看应收' })).toBeNull();
});
it('keeps an unavailable request from selecting the first unrelated record', () => {
  store.state!.sampleRequests![0].id = 'unrelated';
  render();
  expect(host.textContent).toContain('未找到指定索样单');
  expect(host.querySelector('[data-sample-request]')).toBeNull();
});
