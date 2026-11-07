// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByLabelText,getByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),go:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({mistApiRequest:(...a:any[])=>seam.api(...a)}));
vi.mock('../../nav',()=>({useNav:()=>({go:seam.go})}));
import {XiaozhuAutomations} from './XiaozhuAutomations';
let host:HTMLDivElement,root:Root;let rules:any[];
const rule=(o:any={})=>({id:'r1',name:'每日汇总',trigger:'daily',time:'09:00',instructions:'汇总待办',enabled:true,version:1,runs:[],...o});
const flush=()=>act(async()=>{for(let i=0;i<5;i++)await Promise.resolve();});
const paint=async()=>{await act(async()=>root.render(<MistRoot><ToastProvider><XiaozhuAutomations open onClose={()=>undefined} workspaceId="ws"/></ToastProvider></MistRoot>));await flush();};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;rules=[];seam.go.mockClear();seam.api.mockReset();seam.api.mockImplementation(async(_u:string,i:any)=>{if(!i)return{items:rules};if(i.method==='POST'){rules=[rule(JSON.parse(i.body))];return{item:rules[0]};}if(i.method==='PUT'){rules=[{...rules[0],...JSON.parse(i.body)}];return{item:rules[0]};}rules=[];return undefined;});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const button=(name:string)=>getByRole(document.body,'button',{name});
it('creates a rule from a template and shows it',async()=>{await paint();expect(document.body.textContent).toContain('还没有规则');await act(async()=>button('新建规则').click());expect((getByLabelText(document.body,'规则名称') as HTMLInputElement).value).toBe('新邮件整理');await act(async()=>button('开启').click());await flush();const post=seam.api.mock.calls.find(([,i])=>i?.method==='POST')!;expect(JSON.parse(post[1].body)).toMatchObject({trigger:'new_mail',enabled:true});expect(document.body.textContent).toContain('收到新邮件');});
it('switches a rule off and removes it',async()=>{rules=[rule()];await paint();await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());await flush();expect(JSON.parse(seam.api.mock.calls.find(([,i])=>i?.method==='PUT')![1].body).enabled).toBe(false);await act(async()=>button('删除 每日汇总').click());await flush();expect(document.body.textContent).toContain('还没有规则');});
it('shows why a rule stopped and opens a run',async()=>{rules=[rule({enabled:false,halted:{message:'权限已变化，请重新启用规则'},runs:[{at:'2026-11-07T01:00:00Z',taskId:'t1',detail:'每日定时'}]})];await paint();expect(document.body.textContent).toContain('权限已变化');await act(async()=>button('查看').click());expect(seam.go).toHaveBeenCalledWith('assistant','t1',{section:'tasks'});});
it('reports a failed save instead of closing the form',async()=>{await paint();seam.api.mockRejectedValueOnce(new Error('每人最多 20 条规则'));await act(async()=>button('新建规则').click());await act(async()=>button('开启').click());await flush();expect(document.body.textContent).toContain('每人最多 20 条规则');expect(button('取消')).toBeTruthy();});
