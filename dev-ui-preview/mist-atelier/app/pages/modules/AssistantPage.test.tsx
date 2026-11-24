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
it('retains completed task conversations while the worker is offline and requires a new thread for text-only chat', async () => {
  mock.api.mockImplementation(async (url: string) => {
    if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
    if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: false };
    if (url.endsWith('/agent-tasks')) return { items: [{ id: 'retained', identityId: 'personal', executor: 'platform',
      name: '原业务任务', instructions: '核对历史业务任务', conversationId: 'old-conversation', state: 'succeeded',
      result: '原任务真实读回', checkpoint: '', questions: [], waitingProposalIds: [], version: 4, canControl: false,
      createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T01:00:00Z' }], nextCursor: null };
    return { items: [] };
  });
  mock.fetch.mockImplementation(async (url: string) => response(url.endsWith('/status')
    ? { configured: true, models: ['test-model'] }
    : { text: '新的问答结果', mode: 'read_only', revision: 1, sources: [] }));
  await mount();
  expect(button('对话列表')).toBeTruthy();
  await click('核对历史业务任务');
  expect(host.textContent).toContain('原任务真实读回');
  expect(host.textContent).toContain('任务服务暂不可用');
  expect(button('重新提问')).toBeUndefined();
  await question('留到任务服务恢复再问');
  expect(button('发送')!.disabled).toBe(true);
  await click('发送');
  expect(mock.fetch.mock.calls.some(([url])=>String(url).endsWith('/assistant'))).toBe(false);
  await click('新对话');
  await question('新独立问答');
  expect(button('发送')!.disabled).toBe(false);
  await click('发送');
  expect(host.textContent).toContain('新的问答结果');
  expect(mock.workspace.run).not.toHaveBeenCalled();
});

it('shows a task-read failure and preserves the unsent question instead of silently switching to direct model requests',async()=>{
 mock.fetch.mockResolvedValue(response({configured:true,models:['test-model']}));mock.api.mockRejectedValue(new Error('任务列表暂时不可读取'));await mount();await question('保留未发送的问题');expect(host.textContent).toContain('任务列表暂时不可读取');expect(button('重新读取任务')).toBeTruthy();expect(button('发送')!.disabled).toBe(true);await click('发送');expect(mock.fetch.mock.calls.filter(([url])=>!String(url).endsWith('/status'))).toHaveLength(0);expect((host.querySelector('textarea')as HTMLTextAreaElement).value).toBe('保留未发送的问题');
});

it('shows a retry after a stalled opening request and restores the task conversation', async () => {
  vi.useFakeTimers();
  try {
    let capabilityReads = 0;
    mock.fetch.mockResolvedValue(response({ configured: true, models: ['test-model'] }));
    mock.api.mockImplementation(async (url: string) => {
      if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
      if (url.endsWith('/agent-task-capabilities')) {
        if (++capabilityReads === 1) return new Promise(() => {});
        return { platformAvailable: true };
      }
      if (url.endsWith('/agent-tasks')) return { items: [{
        id: 'original', identityId: 'personal', executor: 'platform', conversationId: 'history-recovery',
        instructions: '核对原订单记录', state: 'succeeded', result: '原订单结果已恢复',
        questions: [], waitingProposalIds: [], canControl: false,
        createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T01:00:00Z',
      }] };
      return { items: [] };
    });
    await mount();
    expect(host.querySelector('[aria-label="正在读取对话"]')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(host.querySelector('[aria-label="正在读取对话"]')).toBeNull();
    expect(host.textContent).toContain('对话读取超时');
    await click('重新读取任务');
    await click('核对原订单记录');
    expect(host.textContent).toContain('原订单结果已恢复');
    expect(host.textContent).not.toContain('对话读取超时');
    expect(mock.api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  } finally {
    localStorage.removeItem('mist.xiaozhu.conversation:session-a:workspace');
    vi.useRealTimers();
  }
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
beforeEach(()=>{mock.api.mockReset();mock.api.mockImplementation(async(url:string)=>{if(url.includes('/agent-identities'))return{items:[]};if(url.includes('/agent-task-capabilities'))return{platformAvailable:false};if(url.endsWith('/agent-tasks'))return{items:[],nextCursor:null};throw new Error('unexpected task API');});(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();let i=0;const state=createMistState({id:()=>`assistant-ui-${++i}`,now:'2026-10-13T00:00:00Z',actorName:'Test'},'empty');state.orders.push({id:'order',code:'SO-SELECTED',customer:'Fixture',state:'Open',amount:10,currency:'USD'} as any);mock.workspace={state,workspace:{id:'workspace',name:'Test workspace',revision:1},error:'',loading:false,saving:false,pending:null,refresh:vi.fn(),run:vi.fn()};mock.sessionKey='session-a';mock.readOrders=true;go.mockReset();mock.fetch.mockReset();vi.stubGlobal('fetch',mock.fetch);});
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
    if(init?.method==='POST'){created={id:'t1',identityId:'pa',executor:'platform',name:'q',instructions:JSON.parse(init.body).instructions,conversationId:JSON.parse(init.body).conversationId,state:'queued',version:1,result:'',checkpoint:'',questions:[],waitingProposalIds:[],canControl:true,createdAt:'2026-11-07T00:00:00Z',updatedAt:'2026-11-07T00:00:00Z'};return {item:created};}
    if(url.includes('/agent-identities'))return {items:[idn]};
    if(url.includes('/agent-task-capabilities'))return {platformAvailable:true};
    if(url.endsWith('/agent-tasks'))return {items:created?[created]:[],nextCursor:null};
    if(url.includes('/agent-tasks/t1')){
      polls++;
      if(polls===1)return {item:{...created,state:'running',executionStage:'model',updatedAt:'2026-11-07T00:00:01Z'}};
      return {item:{...created,state:'succeeded',result:'本周有 2 张订单交期临近',version:2,updatedAt:'2026-11-07T00:00:05Z'}};
    }
    throw new Error('unexpected '+url);
  });
  await mount();
  expect(host.textContent).not.toContain('生成模型尚未连接');
  await question('哪些订单交期临近？');await click('发送');
  const post=mock.api.mock.calls.find(([,i])=>i?.method==='POST')!;expect(post[0]).toBe('/api/mist/workspaces/'+mock.workspace.workspace.id+'/personal-agent/tasks');
  expect(JSON.parse(post[1].body).instructions).toBe('哪些订单交期临近？');
  expect(JSON.parse(post[1].body).conversationId).toMatch(/^c_[0-9a-f]{32}$/);
  expect(mock.fetch.mock.calls.some(([u])=>String(u).endsWith('/assistant'))).toBe(false);
  expect(host.textContent).toContain('哪些订单交期临近？');
  expect(host.querySelector('[aria-label="停止生成"]')).not.toBeNull();
  expect(host.textContent).toContain('正在等待模型');
  await act(async()=>{await new Promise(r=>setTimeout(r,3300));});
  expect(host.querySelector('[aria-label="停止生成"]')).toBeNull();
  expect(polls).toBeGreaterThan(0);expect(host.textContent).toContain('本周有 2 张订单交期临近');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
});
function mockTaskStatus(read: (task: Record<string, unknown>) => Promise<unknown>, available=true, terminal=false, activeState = 'paused') {
  const task={id:'existing-task',identityId:'personal',executor:'platform',name:'修改付款条件',instructions:'修改付款条件',
    conversationId:'current-task-conversation',state:terminal?'budget_exhausted':activeState,result:'',checkpoint:'',questions:[],waitingProposalIds:[],
    version:1,canControl:true,createdAt:'2026-11-24T00:00:00Z',updatedAt:'2026-11-24T00:00:00Z'};
  mock.fetch.mockResolvedValue(response({configured:false,models:[]}));
  mock.api.mockImplementation(async(url:string,opts:any)=>{
    if(opts?.method==='POST')throw new Error('task submission captured');
    if(url.includes('/agent-identities'))return {items:[{id:'personal',kind:'personal',state:'active'}]};
    if(url.endsWith('/agent-task-capabilities'))return {platformAvailable:available};
    if(url.endsWith('/agent-tasks'))return {items:terminal?[task,{...task,id:'old-status-echo',name:'完成了没有？',
      instructions:'完成了没有？',state:'succeeded',createdAt:'2026-11-24T00:01:00Z',updatedAt:'2026-11-24T00:01:00Z'}]:[task],nextCursor:null};
    if(url.endsWith('/agent-tasks/existing-task'))return read(task);
    return {items:[]};
  });
}

it('answers a direct status inquiry from the existing task without submitting a new one',async()=>{
  mockTaskStatus(async task=>({item:{...task,state:'waiting_human',waitingProposalIds:['proposal-1'],updatedAt:'2026-11-24T00:00:03Z'}}),false);
  await mount();await click('修改付款条件');
  const field=await question('完成了没有？');await click('发送');
  expect(mock.api.mock.calls.filter(([,opts])=>opts?.method==='POST')).toHaveLength(0);
  expect(mock.api.mock.calls.some(([url])=>url.endsWith('/agent-tasks/existing-task'))).toBe(true);
  expect(host.textContent).toContain('当前任务 · 待我确认');
  expect(field.value).toBe('');
});

it('reads the original task after it reaches the limit, skipping a prior status-only turn',async()=>{
  mockTaskStatus(async task=>({item:task}),true,true);
  await mount();await click('修改付款条件');
  await question('完成了没有？');await click('发送');
  expect(mock.api.mock.calls.filter(([,opts])=>opts?.method==='POST')).toHaveLength(0);
  expect(mock.api.mock.calls.some(([url])=>url.endsWith('/agent-tasks/existing-task'))).toBe(true);
  expect(mock.api.mock.calls.some(([url])=>url.endsWith('/agent-tasks/old-status-echo'))).toBe(false);
  expect(host.textContent).toContain('当前任务 · 达到限额');
});

it('keeps the status question as a draft when the task cannot be read',async()=>{
  mockTaskStatus(async()=>{throw new Error('unavailable');});
  await mount();await click('修改付款条件');
  const field=await question('完成了没有？');await click('发送');
  expect(mock.api.mock.calls.filter(([,opts])=>opts?.method==='POST')).toHaveLength(0);
  expect(host.textContent).toContain('任务暂时无法核对');
  expect(field.value).toBe('完成了没有？');
});

it('leaves a timed out status question ready to retry without creating a task', async () => {
  vi.useFakeTimers();
  let available = false;
  try {
    mockTaskStatus(async task => available ? { item: task } : new Promise(() => {}), false, true);
    await mount();
    await click('修改付款条件');
    const field = await question('完成了没有？');
    await click('发送');

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(host.textContent).toContain('任务暂时无法核对');
    expect(field.value).toBe('完成了没有？');
    expect(button('发送')?.disabled).toBe(false);

    available = true;
    await click('发送');
    expect(field.value).toBe('');
    expect(host.textContent).toContain('当前任务 · 达到限额');
    expect(mock.api.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it('announces a delayed progress read without blocking the composer and shows the recovered result', async () => {
  vi.useFakeTimers();
  let recovered = false;
  try {
    mockTaskStatus(async task => recovered
      ? { item: { ...task, state: 'succeeded', result: '订单核对完成', updatedAt: '2026-11-24T00:00:06Z' } }
      : new Promise(() => {}), true, false, 'running');
    await mount();
    await click('修改付款条件');

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect([...host.querySelectorAll('[role="status"]')].some(status => status.textContent === '进度暂未更新，正在重试')).toBe(true);
    expect(host.textContent).not.toContain('小竹操作未完成');
    const field = await question('另一件独立的业务');
    expect(button('发送')?.disabled).toBe(false);

    recovered = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(host.textContent).toContain('订单核对完成');
    expect(host.textContent).not.toContain('进度暂未更新，正在重试');
    expect(field.value).toBe('另一件独立的业务');
    expect(mock.api.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it('sends a business status question with a source as a new task',async()=>{
  mockTaskStatus(async()=>{throw new Error('unexpected status lookup');});
  await mount();await click('修改付款条件');
  await click('引用业务记录');await click('加入问题');await question('完成了没有？');await click('发送');
  const post=mock.api.mock.calls.find(([,opts])=>opts?.method==='POST');
  expect(post?.[0]).toMatch(/personal-agent\/tasks$/);
  expect(JSON.parse(post?.[1].body).intentRefs).toEqual([{kind:'orders',id:'order'}]);
  expect(mock.api.mock.calls.some(([url])=>url.endsWith('/agent-tasks/existing-task'))).toBe(false);
});

it('sends exact selected identities on the platform path even when two source labels are identical',async()=>{
 mock.fetch.mockResolvedValue(response({configured:true,models:['test-model']}));let posted:any;
 mock.api.mockImplementation(async(url:string,init:any)=>{if(init?.method==='POST'){posted=JSON.parse(init.body);throw new Error('local task capture');}if(url.includes('/agent-identities'))return{items:[{id:'personal',kind:'personal',state:'active'}]};if(url.endsWith('/agent-task-capabilities'))return{platformAvailable:true};return{items:[],nextCursor:null};});
 mock.workspace.state.invoices.push({id:'invoice',code:'SO-SELECTED',customer:'Fixture',amount:10,open:10,currency:'USD'});await mount();await click('引用业务记录');await click('加入问题');const type=document.querySelector<HTMLSelectElement>('select[aria-label="检索对象"]')!;await act(async()=>{type.value='invoices';type.dispatchEvent(new Event('change',{bubbles:true}));});await click('加入问题');await question('核对所选两条资料');await click('发送');expect(posted.intentRefs).toEqual([{kind:'orders',id:'order'},{kind:'invoices',id:'invoice'}]);expect(mock.fetch.mock.calls.some(([url])=>String(url).endsWith('/assistant'))).toBe(false);
});

it('retries a failed automation read and only shows an empty list after success', async () => {
  let unavailable = true;
  mock.api.mockImplementation(async (url: string) => {
    if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: true };
    if (url.endsWith('/agent-automations') && unavailable) throw new Error('规则暂时无法读取');
    return { items: [], nextCursor: null };
  });
  mock.fetch.mockResolvedValue(response({ configured: true, models: ['test-model'] }));
  await mount();
  await click('自动规则');
  expect(document.body.textContent).toContain('规则暂时无法读取');
  expect(document.body.textContent).not.toContain('还没有规则');
  unavailable = false;
  await click('重新读取');
  expect(document.body.textContent).toContain('还没有规则');
  expect(document.body.textContent).not.toContain('规则暂时无法读取');
});
