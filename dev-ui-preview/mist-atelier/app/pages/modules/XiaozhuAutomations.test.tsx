// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByLabelText,getByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),go:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({mistApiRequest:(...a:any[])=>seam.api(...a)}));
vi.mock('../../nav',()=>({useNav:()=>({go:seam.go})}));
import {XiaozhuAutomations} from './XiaozhuAutomations';
let host:HTMLDivElement,root:Root;let rules:any[];
const rule=(o:any={})=>({id:'r1',name:'每日汇总',trigger:'daily',time:'09:00',instructions:'汇总待办',enabled:true,version:1,runs:[],...o});
const flush=()=>act(async()=>{for(let i=0;i<5;i++)await Promise.resolve();});
const paint=async()=>{await act(async()=>root.render(<MistRoot><ToastProvider><XiaozhuAutomations open onClose={()=>undefined} workspaceId="ws"/></ToastProvider></MistRoot>));await flush();};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();rules=[];seam.go.mockClear();seam.api.mockReset();seam.api.mockImplementation(async(_u:string,i:any)=>{if(!i?.method||i.method==='GET')return{items:rules};if(i.method==='POST'){rules=[rule(JSON.parse(i.body))];return{item:rules[0]};}if(i.method==='PATCH'){rules=[{...rules[0],enabled:JSON.parse(i.body).enabled,version:rules[0].version+1}];return{item:rules[0]};}rules=[];return {removed:true};});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const button=(name:string)=>getByRole(document.body,'button',{name});
it('expands retained runs per rule and opens the exact older task', async () => {
  rules = [rule({runs:Array.from({length:5},(_,i)=>({at:'2026-11-07T01:00:00Z',taskId:'task-'+i,detail:'每日定时'}))})];
  await paint();
  const runButtons = () => getAllByRole(document.body,'button',{name:'查看'});
  expect(runButtons()).toHaveLength(3);
  await act(async()=>button('查看全部运行记录').click());
  expect(button('收起运行记录').getAttribute('aria-expanded')).toBe('true');
  expect(runButtons()).toHaveLength(5);
  await act(async()=>runButtons()[4].click());
  expect(seam.go).toHaveBeenCalledWith('assistant','task-4',{section:'tasks'});
  await act(async()=>button('收起运行记录').click());
  expect(runButtons()).toHaveLength(3);
});
it('creates a rule from a template and shows it',async()=>{await paint();expect(document.body.textContent).toContain('还没有规则');await act(async()=>button('新建规则').click());expect((getByLabelText(document.body,'规则名称') as HTMLInputElement).value).toBe('新邮件整理');await act(async()=>button('开启').click());await flush();const post=seam.api.mock.calls.find(([,i])=>i?.method==='POST')!;expect(JSON.parse(post[1].body)).toMatchObject({trigger:'new_mail',enabled:true});expect(document.body.textContent).toContain('收到新邮件');});
it('switches a rule off and removes it',async()=>{rules=[rule()];await paint();await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());await flush();expect(JSON.parse(seam.api.mock.calls.find(([,i])=>i?.method==='PATCH')![1].body)).toEqual({enabled:false,expectedVersion:1});await act(async()=>button('删除 每日汇总').click());await flush();expect(seam.api.mock.calls.find(([,i])=>i?.method==='DELETE')?.[0]).toMatch(/expectedVersion=2$/);expect(document.body.textContent).toContain('还没有规则');});
it('shows why a rule stopped and opens a run',async()=>{rules=[rule({enabled:false,halted:{message:'权限已变化，请重新启用规则'},runs:[{at:'2026-11-07T01:00:00Z',taskId:'t1',detail:'每日定时'}]})];await paint();expect(document.body.textContent).toContain('权限已变化');await act(async()=>button('查看').click());expect(seam.go).toHaveBeenCalledWith('assistant','t1',{section:'tasks'});});
it('refreshes the newer rule after a stale pause or delete instead of applying either change', async()=>{
  rules=[rule()];
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      rules=[rule({version:2,time:'21:12'})];
      throw Object.assign(Error('规则已变化'),{status:409});
    }
    if(init?.method==='DELETE'){
      rules=[rule({version:3,time:'22:13'})];
      throw Object.assign(Error('规则已变化'),{status:409});
    }
    return {items:rules};
  });
  await paint();
  await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());
  expect(document.body.textContent).toContain('规则已更新，请核对后重试');
  expect(document.body.textContent).toContain('21:12');
  expect((getByRole(document.body,'switch',{name:'开启 每日汇总'}) as HTMLInputElement).checked).toBe(true);
  await act(async()=>button('删除 每日汇总').click());
  expect(seam.api.mock.calls.find(([,i])=>i?.method==='DELETE')?.[0]).toMatch(/expectedVersion=2$/);
  expect(document.body.textContent).toContain('22:13');
  expect((getByRole(document.body,'switch',{name:'开启 每日汇总'}) as HTMLInputElement).checked).toBe(true);
});
it('reports a failed save instead of closing the form',async()=>{await paint();seam.api.mockRejectedValueOnce(new Error('每人最多 20 条规则'));await act(async()=>button('新建规则').click());await act(async()=>button('开启').click());await flush();expect(document.body.textContent).toContain('每人最多 20 条规则');expect(button('取消')).toBeTruthy();});
it('restores a lost creation receipt and replays the identical request after remount',async()=>{
  const posts:any[]=[];
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method!=='POST')return {items:rules};
    posts.push(JSON.parse(String(init.body)));
    if(posts.length===1){rules=[rule(posts[0])];throw Object.assign(Error('连接中断'),{status:0});}
    return {item:rules[0]};
  });
  await paint();
  await act(async()=>button('新建规则').click());
  const trigger=getByLabelText(document.body,'触发条件') as HTMLSelectElement;
  await act(async()=>{
    trigger.value='daily';
    trigger.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await act(async()=>button('选择时间').click());
  const timePicker=getByRole(document.body,'dialog',{name:'选择时间'});
  const timeEntry=getByLabelText(timePicker,'时间') as HTMLInputElement;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(timeEntry,'1735');
    timeEntry.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await act(async()=>getByRole(timePicker,'button',{name:'确定'}).click());
  expect((getByLabelText(document.body,'每天几点') as HTMLInputElement).value).toBe('17:35');
  await act(async()=>button('开启').click());
  expect(posts[0].time).toBe('17:35');
  expect(document.body.textContent).toContain('规则开启结果待核对');
  expect((getByLabelText(document.body,'规则名称') as HTMLInputElement).disabled).toBe(true);
  act(()=>root.unmount());root=createRoot(host);
  await paint();
  expect(posts).toHaveLength(1);
  expect((getByLabelText(document.body,'规则名称') as HTMLInputElement).value).toBe(posts[0].name);
  expect((getByLabelText(document.body,'每天几点') as HTMLInputElement).value).toBe('17:35');
  await act(async()=>button('用原请求重试').click());
  expect(posts[1]).toEqual(posts[0]);
  expect(rules).toHaveLength(1);
  expect(sessionStorage.getItem('mist.xiaozhu.rule-submission:ws')).toBeNull();
});
