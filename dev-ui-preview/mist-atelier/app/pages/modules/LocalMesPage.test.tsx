// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import {Nav} from '../../nav';
import {LocalMesPage} from './LocalMesPage';
const state=vi.hoisted(()=>({workspace:null as any}));
vi.mock('../../runtime/auth',()=>{const useMistSession=()=>({canAccessView:()=>true});return{useMistSession,useOptionalMistSession:useMistSession};});
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>state.workspace}));
let host:HTMLElement,root:Root;const go=vi.fn();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{const workspace=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T00:00:00Z',actorName:'业务'},'empty');state.workspace={state:workspace,loading:false,saving:false,pending:null,error:'',refresh:vi.fn()};go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function render(id?:string){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'mes',id},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><LocalMesPage/></Nav.Provider></ToastProvider></MistRoot>));}
it('shows empty local history from workspace without calling legacy services',()=>{render();expect(host.textContent).toContain('暂无加工记录');expect(host.textContent).not.toContain('读取失败');});
it('reads true processing receipts and returns to exact order and production sources',async()=>{state.workspace.state.fulfillment.purchases.push({id:'p',code:'PO-1',orderId:'o',lineId:'l',kind:'processing',supplier:'加工厂',description:'加工内容',quantity:10,received:12,unit:'件',due:'2026-10-13',state:'approved',destination:'实际地点',terms:'真实条款'});state.workspace.state.fulfillment.receipts.push({id:'r',purchaseId:'p',date:'2026-10-13',quantity:12,rejected:1,location:'实际地点',evidence:'实际交付凭据'});state.workspace.state.productions.push({id:'prod',sourcePurchaseId:'p'});state.workspace.state.orders.push({id:'o',code:'SO-1'});render();expect(host.textContent).toContain('数量差异');render('p');expect(host.querySelector('[data-mes-detail="p"]')).not.toBeNull();expect(host.textContent).toContain('12 / 10 件');expect(getByRole(document.body,'table',{name:'加工实际交付'}).textContent).toContain('实收 12 · 拒收 1 件');await act(async()=>getByRole(document.body,'button',{name:'返回来源条目'}).click());expect(go).toHaveBeenCalledWith('orders/detail','o',{orderLineId:'l',productionId:'prod'});await act(async()=>getByRole(document.body,'button',{name:'打开加工合同'}).click());expect(go).toHaveBeenCalledWith('procurement','p');});
it('offers processor and due-year filters once there is more than one value, and filters the list by them',async()=>{
 const p=(id:string,supplier:string,due:string)=>({id,code:'PO-'+id,orderId:'o',lineId:'l',kind:'processing',supplier,description:'加工内容',quantity:10,received:0,unit:'件',due,state:'approved',destination:'实际地点',terms:'真实条款'});
 state.workspace.state.fulfillment.purchases.push(p('a','甲加工厂','2025-11-01'),p('b','乙加工厂','2026-10-20'),p('c','乙加工厂','2025-12-01'));state.workspace.state.orders.push({id:'o',code:'SO-1'});
 render();
 const choose=async(chip:string,option:string)=>{const trigger=[...host.querySelectorAll('button[aria-haspopup="menu"]')].find(b=>b.textContent?.includes(chip)) as HTMLButtonElement;expect(trigger,chip).toBeTruthy();await act(async()=>trigger.click());const item=[...document.querySelectorAll('[role="menuitemradio"]')].find(b=>b.textContent?.trim()===option) as HTMLButtonElement;expect(item,option).toBeTruthy();await act(async()=>item.click());};
 const codes=()=>['PO-a','PO-b','PO-c'].filter(c=>getByRole(host,'table',{name:'历史加工记录'}).textContent?.includes(c));
 expect(codes()).toEqual(['PO-a','PO-b','PO-c']);
 await choose('加工方','乙加工厂');expect(codes()).toEqual(['PO-b','PO-c']);
 await choose('交期年份','2025 年');expect(codes()).toEqual(['PO-c']);
});
it('hides the processor and year filters when there is only one of each',()=>{
 state.workspace.state.fulfillment.purchases.push({id:'a',code:'PO-a',orderId:'o',lineId:'l',kind:'processing',supplier:'甲加工厂',description:'加工内容',quantity:10,received:0,unit:'件',due:'2026-10-20',state:'approved',destination:'实际地点',terms:'真实条款'});
 render();
 const chips=[...host.querySelectorAll('button[aria-haspopup="menu"]')].map(b=>b.textContent||'');
 expect(chips.some(t=>t.includes('加工方'))).toBe(false);expect(chips.some(t=>t.includes('交期年份'))).toBe(false);
});
