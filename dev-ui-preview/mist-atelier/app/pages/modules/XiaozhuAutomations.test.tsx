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
const paint=async(scopeKey?:string)=>{await act(async()=>root.render(<MistRoot><ToastProvider><XiaozhuAutomations open onClose={()=>undefined} workspaceId="ws" scopeKey={scopeKey}/></ToastProvider></MistRoot>));await flush();};
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
  expect(seam.go).toHaveBeenCalledWith('assistant','task-4',{section:'tasks',automationId:'r1'});
  await act(async()=>button('收起运行记录').click());
  expect(runButtons()).toHaveLength(3);
});
it('creates a rule from a template and shows it',async()=>{await paint();expect(document.body.textContent).toContain('还没有规则');await act(async()=>button('新建规则').click());expect((getByLabelText(document.body,'规则名称') as HTMLInputElement).value).toBe('新邮件整理');await act(async()=>button('开启').click());await flush();const post=seam.api.mock.calls.find(([,i])=>i?.method==='POST')!;expect(JSON.parse(post[1].body)).toMatchObject({trigger:'new_mail',enabled:true});expect(document.body.textContent).toContain('收到新邮件');});
it('switches a rule off and removes it',async()=>{rules=[rule()];await paint();await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());await flush();expect(JSON.parse(seam.api.mock.calls.find(([,i])=>i?.method==='PATCH')![1].body)).toEqual({enabled:false,expectedVersion:1});await act(async()=>button('删除 每日汇总').click());await flush();expect(seam.api.mock.calls.find(([,i])=>i?.method==='DELETE')?.[0]).toMatch(/expectedVersion=2$/);expect(document.body.textContent).toContain('还没有规则');});
it('shows why a rule stopped and opens a run',async()=>{rules=[rule({enabled:false,halted:{message:'权限已变化，请重新启用规则'},runs:[{at:'2026-11-07T01:00:00Z',taskId:'t1',detail:'每日定时'}]})];await paint();expect(document.body.textContent).toContain('权限已变化');await act(async()=>button('查看').click());expect(seam.go).toHaveBeenCalledWith('assistant','t1',{section:'tasks',automationId:'r1'});});
it('clears an uncertain pause when a recovered list confirms the requested state',async()=>{
  rules=[rule()];
  let interruptNextRead=false;
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      rules=[rule({version:2,enabled:false})];
      interruptNextRead=true;
      throw Object.assign(Error('规则操作结果待核对'),{status:0});
    }
    if(interruptNextRead){interruptNextRead=false;throw Object.assign(Error('连接暂不可用'),{status:0});}
    return {items:rules};
  });
  await paint();
  const toggle=()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}) as HTMLInputElement;
  await act(async()=>toggle().click());
  expect(document.body.textContent).toContain('规则读取失败');
  expect(document.body.textContent).toContain('规则操作结果待核对');
  expect(toggle().checked).toBe(true);
  await act(async()=>button('重新读取').click());
  expect(toggle().checked).toBe(false);
  expect(seam.api.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
  expect(document.body.textContent).not.toContain('规则操作结果待核对');
});
it.each([{version:1,enabled:false},{version:2,enabled:true}])('keeps an uncertain pause after an unverifying list (%o)',async next=>{
  rules=[rule()];
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      rules=[rule(next)];
      throw Object.assign(Error('规则操作结果待核对'),{status:0});
    }
    return {items:rules};
  });
  await paint();
  await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());
  expect(document.body.textContent).toContain('规则操作结果待核对');
  expect((getByRole(document.body,'switch',{name:'开启 每日汇总'}) as HTMLInputElement).checked).toBe(next.enabled);
});
it('uses an authorized list to reconcile only the exact delete target',async()=>{
  rules=[rule(),rule({id:'r2',name:'其他规则'})];
  let denyNextRead=false;
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==='DELETE'){
      rules=rules.filter(item=>item.id!=='r1');denyNextRead=true;
      throw Object.assign(Error('规则操作结果待核对'),{status:0});
    }
    if(denyNextRead){denyNextRead=false;throw Object.assign(Error('暂不可读取规则'),{status:403});}
    return {items:rules};
  });
  await paint();
  await act(async()=>button('删除 每日汇总').click());
  expect(document.body.textContent).toContain('规则读取失败');
  expect(document.body.textContent).toContain('规则操作结果待核对');
  expect(document.body.textContent).not.toContain('每日汇总');
  await act(async()=>button('重新读取').click());
  expect(document.body.textContent).not.toContain('每日汇总');
  expect(document.body.textContent).toContain('其他规则');
  expect(document.body.textContent).not.toContain('规则操作结果待核对');
  const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='DELETE');
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toMatch(/\/r1\?expectedVersion=1$/);
});
it('keeps one rule pending when a different rule is deleted successfully',async()=>{
  rules=[rule(),rule({id:'r2',name:'其他规则'})];
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==='PATCH')throw Object.assign(Error('规则操作结果待核对'),{status:0});
    if(init?.method==='DELETE'){
      rules=rules.filter(item=>item.id!=='r2');
      return {removed:true};
    }
    return {items:rules};
  });
  await paint();
  await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());
  expect(document.body.textContent).toContain('规则操作结果待核对');
  await act(async()=>button('删除 其他规则').click());
  expect(document.body.textContent).not.toContain('其他规则');
  expect(document.body.textContent).toContain('规则操作结果待核对');
  expect(getByRole(document.body,'status').textContent).toContain('每日汇总');
  expect(seam.api.mock.calls.filter(([,init])=>['PATCH','DELETE'].includes(init?.method))).toHaveLength(2);
});
it.each(['disconnected','in flight'])('retains a rule check after remount with a %s request',async(phase)=>{
  rules=[rule({id:'12345678-1234-4234-8234-123456789012',name:'模拟待核对规则'})];
  seam.api.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      if(phase==='in flight')return new Promise(()=>{});
      throw Object.assign(Error('规则操作结果待核对'),{status:0});
    }
    return {items:rules};
  });
  await paint();
  await act(async()=>getByRole(document.body,'switch',{name:'开启 模拟待核对规则'}).click());
  await act(async()=>root.render(null));
  await paint();
  expect(document.body.textContent).toContain('规则操作结果待核对');
  expect(seam.api.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
  expect(Object.values(sessionStorage).join('')).not.toContain('模拟待核对规则');
  await paint('other-account:ws');
  expect(document.body.textContent).not.toContain('规则操作结果待核对');
  await paint();
  expect(document.body.textContent).toContain('规则操作结果待核对');
  rules=[{...rules[0],enabled:false,version:2}];
  await act(async()=>root.render(null));
  await paint();
  expect(document.body.textContent).not.toContain('规则操作结果待核对');
  expect(seam.api.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(1);
});
it('clears only the matching result when two rule changes are awaiting verification',async()=>{
  rules=[rule(),rule({id:'r2',name:'其他规则'})];
  let failNextRead=false;
  seam.api.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      if(url.endsWith('/r2')){
        rules=rules.map(item=>item.id==='r2'?{...item,enabled:false,version:2}:item);
        failNextRead=true;
      }
      throw Object.assign(Error('规则操作结果待核对'),{status:0});
    }
    if(failNextRead){failNextRead=false;throw Object.assign(Error('规则读取暂不可用'),{status:503});}
    return {items:rules};
  });
  await paint();
  await act(async()=>getByRole(document.body,'switch',{name:'开启 每日汇总'}).click());
  await act(async()=>getByRole(document.body,'switch',{name:'开启 其他规则'}).click());
  const notices=()=>getAllByRole(document.body,'status').find(el=>el.textContent?.includes('规则操作结果待核对'))!;
  expect(notices().textContent).toContain('每日汇总、其他规则');
  await act(async()=>button('重新读取').click());
  expect(notices().textContent).toContain('每日汇总');
  expect(notices().textContent).not.toContain('其他规则');
  expect(seam.api.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(2);
});
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
it('restores an existing creation receipt without replaying the write after remount',async()=>{
  const posts:any[]=[];
  seam.api.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url.includes('/receipt/'))return {item:rules[0]};
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
  await act(async()=>button('核对开启结果').click());
  expect(seam.api.mock.calls.some(([url])=>String(url).endsWith('/receipt/'+posts[0].requestId))).toBe(true);
  expect(posts).toHaveLength(1);
  expect(rules).toHaveLength(1);
  expect(sessionStorage.getItem('mist.xiaozhu.rule-submission:ws')).toBeNull();
});

it.each([false,true])('rechecks a missing receipt before an explicit replay (%s)',async arrivedLate=>{
  const posts:any[]=[];
  const reads:string[]=[];
  seam.api.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url.includes('/receipt/')){
      reads.push(url);
      if(rules.length)return {item:rules[0]};
      throw Object.assign(Error('未找到规则开启回执'),{status:404,code:'AGENT_AUTOMATION_RECEIPT_NOT_FOUND'});
    }
    if(init?.method!=='POST')return {items:rules};
    posts.push(JSON.parse(String(init.body)));
    if(posts.length===1)throw Object.assign(Error('模拟断线'),{status:0});
    rules=[rule(posts[0])];return {item:rules[0]};
  });
  await paint();
  await act(async()=>button('新建规则').click());
  await act(async()=>button('开启').click());
  expect(posts).toHaveLength(1);
  await act(async()=>button('核对开启结果').click());
  expect(reads).toHaveLength(1);
  expect(posts).toHaveLength(1);
  if(arrivedLate)rules=[rule(posts[0])];
  await act(async()=>button('用原请求重试').click());
  expect(reads).toHaveLength(2);
  expect(posts).toHaveLength(arrivedLate?1:2);
  if(!arrivedLate)expect(posts[1]).toEqual(posts[0]);
  expect(sessionStorage.getItem('mist.xiaozhu.rule-submission:ws')).toBeNull();
});

it.each([{status:403,code:'FORBIDDEN'},{status:404,code:'NOT_FOUND'},{status:503,code:'UNAVAILABLE'}])
('keeps replay unavailable when the receipt check is inconclusive (%o)',async failure=>{
  const posts:unknown[]=[];
  seam.api.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url.includes('/receipt/'))throw Object.assign(Error('暂时无法核对规则'),failure);
    if(init?.method==='POST'){posts.push(init.body);throw Object.assign(Error('连接中断'),{status:0});}
    return {items:rules};
  });
  await paint();
  await act(async()=>button('新建规则').click());
  await act(async()=>button('开启').click());
  await act(async()=>button('核对开启结果').click());
  expect(button('核对开启结果')).toBeTruthy();
  expect(document.body.textContent).not.toContain('用原请求重试');
  expect(posts).toHaveLength(1);
});
