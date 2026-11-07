// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,getByLabelText} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {XiaozhuThread} from './XiaozhuThread';
let host:HTMLDivElement,root:Root;
const task=(over:any={})=>({id:'t1',instructions:'核对订单',state:'running',version:1,result:'',checkpoint:'',questions:[],waitingProposalIds:[],canControl:true,...over}) as any;
const paint=(tasks:any[],fns:any={})=>act(async()=>root.render(<MistRoot><XiaozhuThread tasks={tasks} onAnswer={fns.answer??vi.fn()} onCancel={fns.cancel??vi.fn()} onConfirm={fns.confirm??vi.fn()}/></MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('shows progress with a stop control while a request is being handled',async()=>{const cancel=vi.fn();await paint([task({checkpoint:'已读取订单'})],{cancel});expect(host.textContent).toContain('核对订单');expect(host.textContent).toContain('已读取订单');await act(async()=>getByRole(host,'button',{name:'停止'}).click());expect(cancel).toHaveBeenCalledOnce();});
it('shows the result of a finished request and no controls',async()=>{await paint([task({state:'succeeded',result:'两张订单交期临近'})]);expect(host.textContent).toContain('两张订单交期临近');expect(host.querySelector('button')).toBeNull();});
it('asks the open question inline and sends the answer for that question',async()=>{const answer=vi.fn();await paint([task({state:'waiting_human',questions:[{id:'q1',question:'核对哪个客户？',askedAt:''}]})],{answer});expect(host.textContent).toContain('核对哪个客户？');const box=getByLabelText(host,'回答小竹') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(box,'客户A');box.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>getByRole(host,'button',{name:'回答'}).click());expect(answer).toHaveBeenCalledWith(expect.objectContaining({id:'t1'}),'q1','客户A');});
it('hands a change that needs confirmation to the person instead of running it',async()=>{const confirm=vi.fn();await paint([task({state:'waiting_human',waitingProposalIds:['p1']})],{confirm});expect(host.textContent).toContain('需要你确认');await act(async()=>getByRole(host,'button',{name:'去确认'}).click());expect(confirm).toHaveBeenCalledOnce();});
it('labels a stopped request instead of leaving it blank',async()=>{await paint([task({state:'budget_exhausted',checkpoint:'已读 20 条'})]);expect(host.textContent).toContain('达到限额');});
