// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {XiaozhuRail} from './XiaozhuRail';
let host:HTMLDivElement,root:Root;
const rule=(o:any={})=>({id:'r1',name:'每日汇总',trigger:'daily',time:'09:00',instructions:'x',enabled:true,version:1,runs:[{at:'',taskId:'t',detail:'每日定时'}],...o});
const props=(o:any={})=>({proposals:[],active:[],rules:[],onProposal:vi.fn(),onOpenTasks:vi.fn(),onOpenAutomations:vi.fn(),onNewRule:vi.fn(),onToggle:vi.fn(),onOpenTask:vi.fn(),...o});
const paint=(p:any)=>act(async()=>root.render(<MistRoot><XiaozhuRail {...p}/></MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('says so when nothing needs attention and offers the first rule',async()=>{const p=props();await paint(p);expect(host.textContent).toContain('没有待确认事项');expect(host.textContent).toContain('暂时没有在办的事项');expect(host.textContent).toContain('还没有自动规则');await act(async()=>getByRole(host,'button',{name:'新建'}).click());expect(p.onNewRule).toHaveBeenCalled();});
it('lists pending confirmations with their risk and opens one',async()=>{const p=props({proposals:[{id:'p1',state:'pending',command:{type:'finance.payment.save',payload:{}},summary:['登记付款 100 USD']}]});await paint(p);expect(host.textContent).toContain('登记付款 100 USD');expect(host.textContent).toContain('高风险');await act(async()=>(host.querySelector('.mist-xz-item') as HTMLButtonElement).click());expect(p.onProposal).toHaveBeenCalledWith('p1');});
it('shows running requests but not ones that wait for the person',async()=>{await paint(props({active:[{id:'a',name:'核对来信',state:'running'},{id:'b',name:'等你确认',state:'waiting_human'},{id:'c',name:'已完成',state:'succeeded'}]}));expect(host.textContent).toContain('核对来信');expect(host.textContent).not.toContain('等你确认');expect(host.textContent).not.toContain('已完成');});
it('switches a rule and shows why one stopped',async()=>{const p=props({rules:[rule(),rule({id:'r2',name:'新邮件',trigger:'new_mail',enabled:false,halted:{message:'权限已变化'},runs:[]})]});await paint(p);expect(host.textContent).toContain('每日定时');expect(host.textContent).toContain('权限已变化');await act(async()=>getByRole(host,'switch',{name:'开启 每日汇总'}).click());expect(p.onToggle).toHaveBeenCalledWith(expect.objectContaining({id:'r1'}),false);});
