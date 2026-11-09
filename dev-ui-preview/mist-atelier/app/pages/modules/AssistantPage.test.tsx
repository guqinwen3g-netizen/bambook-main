import { AssistantConversationProvider } from '../../runtime/assistantConversation';
// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import {AssistantPage} from './PlatformPages';
import {Nav} from '../../nav';
const mock=vi.hoisted(()=>({api:vi.fn(),workspace:null as any,fetch:vi.fn(),sessionKey:'session-a',readOrders:true}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>mock.workspace,mistApiRequest:(...a:any[])=>mock.api(...a)}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({sessionKey:mock.sessionKey,user:{id:'actor'},hasPermission:(scope:string)=>scope!=='orders:read'||mock.readOrders}); return { useMistSession, useOptionalMistSession: useMistSession }; });
vi.mock('../../../../../services/apiService',()=>({apiService:{getAuthHeaders:()=>({'X-Test-Auth':'authenticated'})}}));
let root:Root|undefined,host:HTMLDivElement;const go=vi.fn();
const view=(active=true)=> <Nav.Provider value={{route:{view:'assistant'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><AssistantConversationProvider scope={mock.sessionKey+':'+(mock.workspace.workspace?.id??'')}>{active?<AssistantPage/>:<div>Source record</div>}</AssistantConversationProvider></Nav.Provider>;
const response=(body:unknown,ok=true)=>({ok,json:async()=>body});

it('is the single AI page with no sub-page tabs, and without the task channel offers no task entry',async()=>{
  mock.fetch.mockResolvedValue(response({configured:true,models:['test-model']}));
  await mount();
  expect(host.textContent).not.toContain('我的 Agent');expect(host.textContent).not.toContain('工作助手');
  expect(button('任务')).toBeUndefined();
});

it('retains the answer, references and an unfinished question when returning from a source page',async()=>{
  mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'Answer to retain',mode:'read_only',revision:1,sources:[{id:'orders:order',label:'SO-SELECTED',view:'orders/detail',entityId:'order'}]}));
  await mount(); await click('引用业务记录'); await click('加入问题'); await question('First question'); await click('发送');
  await question('Unfinished follow-up');
  await act(async()=>root!.render(view(false)));
  await act(async()=>root!.render(view(true)));
  expect(host.textContent).toContain('Answer to retain');
  expect(host.textContent).toContain('SO-SELECTED');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Unfinished follow-up');
});

it('clears retained conversation when the authenticated session changes outside the assistant page',async()=>{
  mock.fetch.mockResolvedValue(response({configured:true,models:['test-model']}));
  await mount(); await question('Private account-A question');
  await act(async()=>root!.render(view(false))); mock.sessionKey='session-b';
  await act(async()=>root!.render(view(false))); await act(async()=>root!.render(view(true)));
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  expect(host.textContent).not.toContain('Private account-A question');
});
beforeEach(()=>{mock.api.mockReset();mock.api.mockRejectedValue(new Error('no task channel'));(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();let i=0;const state=createMistState({id:()=>`assistant-ui-${++i}`,now:'2026-10-13T00:00:00Z',actorName:'Test'},'empty');state.orders.push({id:'order',code:'SO-SELECTED',customer:'Fixture',state:'Open',amount:10,currency:'USD'} as any);mock.workspace={state,workspace:{id:'workspace',name:'Test workspace',revision:1},error:'',loading:false,saving:false,pending:null,refresh:vi.fn(),run:vi.fn()};mock.sessionKey='session-a';mock.readOrders=true;go.mockReset();mock.fetch.mockReset();vi.stubGlobal('fetch',mock.fetch);});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();vi.unstubAllGlobals();});
async function mount(){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(view()));}
const button=(name:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===name||b.getAttribute('aria-label')===name) as HTMLButtonElement|undefined;
async function click(name:string){const target=button(name);expect(target).toBeTruthy();await act(async()=>target!.click());}
async function question(text:string){const field=host.querySelector('textarea') as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,text);field.dispatchEvent(new Event('input',{bubbles:true}));});return field;}
it('submits selected facts to the configured server model without executing a business command',async()=>{mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'Review this suggested next step.',mode:'read_only',revision:2,sources:[{id:'orders:order',entityId:'order',label:'SO-SELECTED',view:'orders/detail'}],modelConfigured:true}));await mount();await click('引用业务记录');await click('加入问题');await question('What is next?');await click('发送');expect(host.textContent).toContain('Review this suggested next step.');const call=mock.fetch.mock.calls.find(([url])=>!String(url).endsWith('/status'));expect(JSON.parse(call![1].body)).toEqual({message:'What is next?',history:[],sourceIds:['orders:order']});expect(call![1].headers['X-Test-Auth']).toBe('authenticated');expect(mock.workspace.run).not.toHaveBeenCalled();await click('SO-SELECTED');expect(go).toHaveBeenCalledWith('orders/detail','order');});
it('retains a question on provider failure and displays a recoverable error',async()=>{mock.fetch.mockImplementation(async(url:string)=>url.endsWith('/status')?response({configured:true,models:['test-model']}):response({error:{message:'Model unavailable'}},false));await mount();const field=await question('Keep this question.');await click('发送');expect(field.value).toBe('Keep this question.');expect(host.textContent).toContain('Model unavailable');expect(mock.workspace.run).not.toHaveBeenCalled();});
it('discards a late answer after the workspace changes',async()=>{let finish!:(value:any)=>void;mock.fetch.mockImplementation((url:string)=>url.endsWith('/status')?Promise.resolve(response({configured:true,models:['test-model']})):new Promise(resolve=>{finish=resolve;}));await mount();await question('Old workspace question');await click('发送');mock.workspace.workspace={id:'new-workspace',name:'New workspace',revision:0};await act(async()=>root!.render(view()));await act(async()=>finish(response({text:'Old private answer',mode:'read_only',revision:1,sources:[],modelConfigured:true})));expect(host.textContent).not.toContain('Old private answer');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');});
it('shows unconfigured status without sending a model request',async()=>{mock.fetch.mockResolvedValue(response({configured:false,models:[]}));await mount();await question('Local question');expect(button('发送')!.disabled).toBe(true);expect(host.textContent).toContain('生成模型尚未连接');expect(mock.fetch).toHaveBeenCalledTimes(1);});
it('does not expose order records without the order read permission',async()=>{mock.readOrders=false;mock.fetch.mockResolvedValue(response({configured:true,models:['test-model']}));await mount();await click('引用业务记录');expect(document.body.textContent).not.toContain('SO-SELECTED');expect(button('加入问题')).toBeUndefined();expect(document.body.textContent).toContain('无权查看此类记录');});
it('starts only one model request when Send is clicked twice in the same turn',async()=>{let finish!:(result:any)=>void;mock.fetch.mockImplementation((url:string)=>url.endsWith('/status')?Promise.resolve(response({configured:true,models:['test-model']})):new Promise(resolve=>{finish=resolve;}));await mount();await question('One request');const send=button('发送')!;await act(async()=>{send.click();send.click();});expect(mock.fetch.mock.calls.filter(([url])=>!String(url).endsWith('/status'))).toHaveLength(1);await act(async()=>finish(response({text:'One answer',mode:'read_only',revision:1,sources:[]})));expect(host.textContent).toContain('One answer');});
it('rejects model responses with mismatched source identities',async()=>{mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'Untrusted source answer',mode:'read_only',revision:1,sources:[{id:'orders:order',entityId:'another-order',view:'orders/detail',label:'Wrong source'}]}));await mount();await click('引用业务记录');await click('加入问题');await question('Check source');await click('发送');expect(host.textContent).toContain('助手响应格式无效');expect(host.textContent).not.toContain('Untrusted source answer');});
it('saves a reviewed model response only after the user submits the draft form',async()=>{mock.workspace.run.mockResolvedValue({result:{id:'draft'}});mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'Reviewable model draft',mode:'read_only',revision:1,sources:[]}));await mount();await question('Draft a follow up');await click('发送');expect(mock.workspace.run).not.toHaveBeenCalled();await click('保存草稿');const title=document.querySelector('input[aria-label="标题"]') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'审核后的跟进草稿');title.dispatchEvent(new Event('input',{bubbles:true}));});const save=[...document.querySelectorAll('button')].find(b=>b.textContent==='保存')!;await act(async()=>save.click());expect(mock.workspace.run).toHaveBeenCalledWith({type:'platform.assistant.saveDraft',payload:{title:'审核后的跟进草稿',content:'Reviewable model draft',orderId:''}});});
it('cancels a pending model call while retaining the original question',async()=>{let signal:AbortSignal|undefined;mock.fetch.mockImplementation((url:string,options:any)=>url.endsWith('/status')?Promise.resolve(response({configured:true,models:['test-model']})):new Promise((_,reject)=>{signal=options.signal;signal!.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));}));await mount();const field=await question('Keep after cancellation');await click('发送');await click('停止生成');expect(signal?.aborted).toBe(true);expect(field.value).toBe('Keep after cancellation');expect(mock.workspace.run).not.toHaveBeenCalled();});
it('shows the shared platform model without offering personal connection on the business Q&A page',async()=>{mock.fetch.mockImplementation(async()=>response({configured:true,models:['平台 ChatGPT 订阅 · gpt-6-luna'],mode:'read_only',subscription:{provider:'chatgpt',connected:true}}));await mount();expect(host.textContent).toContain('平台模型已连接');expect(host.textContent).not.toContain('gpt-6-luna');expect(host.textContent).not.toContain('连接我的 ChatGPT 账号');expect(mock.fetch).toHaveBeenCalledTimes(1);});
it('sends with Enter, keeps Shift+Enter for a new line, and fills a suggested prompt',async()=>{mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'Enter answer',mode:'read_only',revision:1,sources:[]}));await mount();await click('哪些订单交期临近，需要优先跟进？');const field=host.querySelector('textarea') as HTMLTextAreaElement;expect(field.value).toBe('哪些订单交期临近，需要优先跟进？');await act(async()=>{field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));});expect(mock.fetch.mock.calls.filter(([url])=>!String(url).endsWith('/status'))).toHaveLength(0);await act(async()=>{field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});expect(host.textContent).toContain('Enter answer');expect(mock.fetch.mock.calls.filter(([url])=>!String(url).endsWith('/status'))).toHaveLength(1);});
it('removes a referenced record from the next question',async()=>{mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'No sources used',mode:'read_only',revision:1,sources:[]}));await mount();await click('引用业务记录');await click('加入问题');expect(host.textContent).toContain('SO-SELECTED · Fixture');await click('移除 SO-SELECTED · Fixture');expect(host.textContent).not.toContain('SO-SELECTED · Fixture');await question('Without sources');await click('发送');const call=mock.fetch.mock.calls.find(([url])=>!String(url).endsWith('/status'));expect(JSON.parse(call![1].body).sourceIds).toEqual([]);});

it('carries the device language in a full-page assistant request without persisting settings',async()=>{localStorage.setItem('bambook.device.locale','"en-US"');mock.fetch.mockImplementation(async(url:string)=>response(url.endsWith('/status')?{configured:true,models:['test-model']}:{text:'English answer',mode:'read_only',revision:1,sources:[]}));try{await mount();await question('Question');await click('Send');const call=mock.fetch.mock.calls.find(([url])=>!String(url).endsWith('/status'));expect(call![1].headers['X-Bambook-Locale']).toBe('en-US');expect(JSON.parse(call![1].body)).not.toHaveProperty('locale');expect(mock.workspace.run).not.toHaveBeenCalled();}finally{localStorage.removeItem('bambook.device.locale');}});

it('works with Xiaozhu as a coworker: a request becomes a platform task whose progress and result stay in the conversation',async()=>{
  let created:any=null,polls=0;
  const idn={id:'pa',kind:'personal',state:'active'};
  mock.fetch.mockResolvedValue(response({configured:false,models:[]}));
  mock.api.mockImplementation(async(url:string,init:any)=>{
    if(init?.method==='POST'){created={id:'t1',identityId:'pa',executor:'platform',name:'q',instructions:JSON.parse(init.body).instructions,state:'queued',version:1,result:'',checkpoint:'',questions:[],waitingProposalIds:[],canControl:true,createdAt:'2026-11-07T00:00:00Z',updatedAt:'2026-11-07T00:00:00Z'};return {item:created};}
    if(url.includes('/agent-identities'))return {items:[idn]};
    if(url.includes('/agent-task-capabilities'))return {platformAvailable:true};
    if(url.endsWith('/agent-tasks'))return {items:created?[created]:[],nextCursor:null};
    if(url.includes('/agent-tasks/t1')){polls++;return {item:{...created,state:'succeeded',result:'本周有 2 张订单交期临近',version:2,updatedAt:'2026-11-07T00:00:05Z'}};}
    throw new Error('unexpected '+url);
  });
  await mount();
  expect(host.textContent).not.toContain('生成模型尚未连接');
  await question('哪些订单交期临近？');await click('发送');
  const post=mock.api.mock.calls.find(([,i])=>i?.method==='POST')!;expect(post[0]).toBe('/api/mist/workspaces/'+mock.workspace.workspace.id+'/personal-agent/tasks');
  expect(JSON.parse(post[1].body).instructions).toBe('哪些订单交期临近？');
  expect(mock.fetch.mock.calls.some(([u])=>String(u).endsWith('/assistant'))).toBe(false);
  expect(host.textContent).toContain('哪些订单交期临近？');
  await act(async()=>{await new Promise(r=>setTimeout(r,3300));});
  expect(polls).toBeGreaterThan(0);expect(host.textContent).toContain('本周有 2 张订单交期临近');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
});
