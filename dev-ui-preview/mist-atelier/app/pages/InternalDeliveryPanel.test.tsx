// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,getByLabelText,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../components/mist';
import {internalDeliveryFixture} from '../../../../server/src/mist/__tests__/internalDelivery';
import {internalDeliverySources} from '../../../../server/src/shared/mistInternalDelivery';
import {applyDataScope} from '../../../../server/src/shared/mistDataScope';
import type {MistState,MistCommand} from '../../../../server/src/shared/mistWorkspace';
import {Nav,type Route} from '../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,workspace:{id:'independent',access:{companyLibrary:true}},loading:false,saving:false,pending:null,pendingCreate:null,commandRecovery:null,error:'',run:vi.fn(),refresh:vi.fn()}));
const auth=vi.hoisted(()=>({user:{id:'garment'},sessionKey:'session',permissions:new Set<string>(),hasPermission:(p:string)=>auth.permissions.has(p)}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../runtime/auth',()=>({useOptionalMistSession:()=>auth}));
import {InternalDeliveryPanel,InternalDeliveryCreate,InternalDeliveryInbox} from './InternalDeliveryPanel';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root,f:ReturnType<typeof internalDeliveryFixture>;
const go=vi.fn(),close=vi.fn();
function render(element:React.ReactNode,route:Route={view:'orders'}){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route,go,openAI:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn()}}>{element}</Nav.Provider></ToastProvider></MistRoot>));}
const click=async(element:HTMLElement)=>act(async()=>element.click());
async function fill(label:string,value:string,within:HTMLElement=host){const input=getByLabelText(within,label,{exact:true}) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;await act(async()=>{if(input instanceof HTMLSelectElement){input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}else{Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}});}
beforeEach(()=>{f=internalDeliveryFixture();store.state=f.state;store.run.mockReset();store.run.mockResolvedValue({result:{}});store.refresh.mockReset();auth.user.id='garment';auth.sessionKey='session';auth.permissions=new Set(['orders:read','orders:write','production:read','procurement:read']);go.mockReset();close.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();localStorage.removeItem('bambook.device.locale');});

it('records a real source and explicit recipient through the two form steps, then returns after the acknowledgement',async()=>{
 const source=internalDeliverySources(f.state,f.target.orderId)[0],order=f.state.orders.find(o=>o.id===f.target.orderId)!;
 store.run.mockImplementation(async(command:MistCommand)=>{f.run(command,'garment');store.state=f.state;render(<InternalDeliveryCreate order={order} onClose={close}/>);return{result:{}};});
 render(<InternalDeliveryCreate order={order} onClose={close}/>);
 await fill('交付来源',source.key);await fill('本次交付数量','10');await fill('本次接收账号','warehouse');
 await click(getByRole(host,'button',{name:'下一步'}));
 await fill('交付地点','Training sample room');await fill('实际交付日期','2026-10-30');await fill('交接依据','Independent handover evidence');
 await click(getByRole(host,'button',{name:'下一步'}));
 expect(store.run).not.toHaveBeenCalled();
 await click(getByRole(host,'button',{name:'确认交付'}));
 expect(store.run).toHaveBeenCalledWith({type:'order.internal.send',payload:{orderId:f.target.orderId,productionId:f.productionId,source:{kind:'receipt',id:'finished-receipt'},quantity:10,receiverId:'warehouse',location:'Training sample room',date:'2026-10-30',evidence:'Independent handover evidence',expectedRevision:0}});
 expect(close).toHaveBeenCalledTimes(1);expect(f.state.orders.find(o=>o.id===f.target.orderId)?.state).toBe('待内部接收');
});

it('lets the exact recipient count a minimal projected handover and preserves inputs when saving fails',async()=>{
 const id=f.send();auth.user.id='warehouse';auth.permissions=new Set(['orders:read','orders:write']);store.state=applyDataScope(f.state,{userIds:['warehouse'],teamIds:[]},'warehouse');
 expect(store.state.orders).toEqual([]);expect(store.state.fulfillment.purchases).toEqual([]);
 render(<InternalDeliveryInbox/>,{view:'orders',id,section:'internal-deliveries'});
 const detail=getByRole(document.body,'dialog',{name:'内部交付'});
 expect(detail.textContent).toContain('Jacket');expect(queryByRole(detail,'button',{name:'打开来源订单'})).toBeNull();
 await click(getByRole(detail,'button',{name:'登记点收'}));
 const dialog=getByRole(document.body,'dialog',{name:'登记内部点收'});
 await fill('接收数量','6',dialog);await fill('拒收数量','4',dialog);await fill('点收依据','Counted with four rejected pieces',dialog);
 store.run.mockRejectedValueOnce(new Error('点收保存失败'));
 await click(getByRole(dialog,'button',{name:'保存点收'}));
 expect(dialog.textContent).toContain('点收保存失败');expect((getByLabelText(dialog,'点收依据') as HTMLTextAreaElement).value).toBe('Counted with four rejected pieces');expect(f.state.internalDeliveries![0].checks).toEqual([]);
 expect(store.run).toHaveBeenCalledWith({type:'order.internal.receive',payload:{id,accepted:6,rejected:4,expectedRevision:0,evidence:'Counted with four rejected pieces'}});
});

it('shows correction, rejected-return and recall actions only for their eligible actors',async()=>{
 const id=f.send(),order=f.state.orders.find(o=>o.id===f.target.orderId)!;store.state=f.state;
 render(<InternalDeliveryPanel order={order}/>);await click(getByRole(host,'row',{name:/Jacket/}));
 let detail=getByRole(document.body,'dialog',{name:'内部交付'});
 expect(queryByRole(detail,'button',{name:'登记点收'})).toBeNull();
 await click(getByRole(detail,'button',{name:'撤回交付'}));
 const recall=getByRole(document.body,'dialog',{name:'撤回内部交付'});await fill('撤回原因与实物去向','Unreceived goods returned',recall);
 const submit=getByRole(recall,'button',{name:'确认撤回'});expect(submit.getAttribute('data-variant')).toBe('danger');await click(submit);
 expect(store.run).toHaveBeenLastCalledWith({type:'order.internal.cancel',payload:{id,expectedRevision:0,reason:'Unreceived goods returned'}});
 f.run({type:'order.internal.receive',payload:{id,accepted:6,rejected:4,expectedRevision:0,evidence:'Actual count'}},'warehouse');store.state=f.state;render(<InternalDeliveryPanel order={order}/>);
 detail=getByRole(document.body,'dialog',{name:'内部交付'});expect(queryByRole(detail,'button',{name:'撤回交付'})).toBeNull();
 await click(getByRole(detail,'button',{name:'登记拒收退回'}));
 const returned=getByRole(document.body,'dialog',{name:'登记拒收退回'});await fill('实际退回数量','4',returned);await fill('实际退回日期','2026-10-30',returned);await fill('实际退回依据','Rejected goods returned',returned);await click(getByRole(returned,'button',{name:'保存退回'}));
 expect(store.run).toHaveBeenLastCalledWith({type:'order.internal.returnRejected',payload:{id,quantity:4,date:'2026-10-30',evidence:'Rejected goods returned',expectedRevision:1}});
});

it('opens the recipient correction with exact revision, and clears it on session changes',async()=>{
 const id=f.send();f.run({type:'order.internal.receive',payload:{id,accepted:10,rejected:0,expectedRevision:0,evidence:'Counted'}},'warehouse');store.state=f.state;auth.user.id='warehouse';auth.permissions=new Set(['orders:read','orders:write']);
 render(<InternalDeliveryInbox/>,{view:'orders',id,section:'internal-deliveries'});
 await click(getByRole(document.body,'button',{name:'更正点收'}));
 const dialog=getByRole(document.body,'dialog',{name:'更正内部点收'});await fill('原点收记录',f.state.internalDeliveries![0].checks[0].id,dialog);await fill('更正原因','Wrong initial count',dialog);await click(getByRole(dialog,'button',{name:'确认更正'}));
 expect(store.run).toHaveBeenLastCalledWith({type:'order.internal.reverseCheck',payload:{id,checkId:f.state.internalDeliveries![0].checks[0].id,expectedRevision:1,reason:'Wrong initial count'}});
 await click(getByRole(document.body,'button',{name:'更正点收'}));auth.user.id='reviewer';auth.sessionKey='another-session';render(<InternalDeliveryInbox/>,{view:'orders',id,section:'internal-deliveries'});
 expect(queryByRole(document.body,'dialog',{name:'更正内部点收'})).toBeNull();expect(host.textContent).toContain('未找到指定的内部交付');
});

it('keeps the source entry unavailable without source read access and translates the recipient page',()=>{
 const order=f.state.orders.find(o=>o.id===f.target.orderId)!;auth.permissions=new Set(['orders:read','orders:write']);render(<InternalDeliveryPanel order={order}/>);expect(queryByRole(host,'button',{name:'登记内部交付'})).toBeNull();
 localStorage.setItem('bambook.device.locale','"en-US"');auth.user.id='warehouse';render(<InternalDeliveryInbox/>,{view:'orders',section:'internal-deliveries'});expect(host.textContent).toContain('Internal receiving');expect(host.textContent).toContain('No internal handovers');
});

it('keeps an assigned handover read-only after the recipient loses receiving write permission',()=>{
 const id=f.send();store.state=f.state;auth.user.id='warehouse';auth.permissions=new Set(['orders:read']);
 render(<InternalDeliveryInbox/>,{view:'orders',id,section:'internal-deliveries'});
 const detail=getByRole(document.body,'dialog',{name:'内部交付'});
 expect(detail.textContent).toContain('Jacket');expect(queryByRole(detail,'button',{name:'登记点收'})).toBeNull();
 expect(queryByRole(detail,'button',{name:'更正点收'})).toBeNull();expect(store.run).not.toHaveBeenCalled();
});
