// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useXiaozhuCowork} from './xiaozhuCowork';
const api=vi.hoisted(()=>vi.fn());vi.mock('./workspace',()=>({mistApiRequest:(...args:any[])=>api(...args)}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,cowork:any;const posts:any[]=[];
function Probe({conversationId}:{conversationId?:string}){cowork=useXiaozhuCowork('workspace','actor:workspace',true,conversationId);return null;}
beforeEach(async()=>{posts.length=0;api.mockReset();api.mockImplementation(async(url:string,init:any)=>{if(init?.method==='POST'){posts.push(JSON.parse(init.body));throw new Error('create response unavailable');}if(url.includes('/agent-identities'))return{items:[{id:'personal',kind:'personal',state:'active'}]};if(url.endsWith('/agent-task-capabilities'))return{platformAvailable:true};return{items:[],nextCursor:null};});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Probe/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('carries exact typed references separately from the same human-readable question',async()=>{
 await act(async()=>{await cowork.send('核对同名资料',[],'conversation_1',[{kind:'orders',id:'selected-order'},{kind:'invoices',id:'selected-invoice'}]);});
 expect(posts).toHaveLength(1);expect(posts[0].intentRefs).toEqual([{kind:'orders',id:'selected-order'},{kind:'invoices',id:'selected-invoice'}]);expect(posts[0].instructions).toBe('核对同名资料');
});
it('does not reuse an uncertain creation request when the selected identity changes under the same label',async()=>{
 await act(async()=>{await cowork.send('同名资料',[],'conversation_1',[{kind:'orders',id:'order-A'}]);});await act(async()=>{await cowork.reload();});await act(async()=>{await cowork.send('同名资料',[],'conversation_1',[{kind:'orders',id:'order-B'}]);});
 expect(posts).toHaveLength(2);expect(posts[1].requestId).not.toBe(posts[0].requestId);expect(posts[1].intentRefs).toEqual([{kind:'orders',id:'order-B'}]);
});
it('keeps legacy no-reference request bodies unchanged',async()=>{
 await act(async()=>{await cowork.send('旧客户端请求',[],'conversation_1');});expect(posts).toHaveLength(1);expect(posts[0]).not.toHaveProperty('intentRefs');
});

it('releases a hung submission and replays the original request after history has changed', async () => {
  vi.useFakeTimers();
  try {
    let firstSignal: AbortSignal | null | undefined;
    const saved = { id: 'saved', conversationId: 'conversation_1', state: 'succeeded', result: '已核对', instructions: '核对订单' };
    const initial = api.getMockImplementation()!;
    api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return initial(url, init);
      posts.push(JSON.parse(String(init.body)));
      if (posts.length > 1) return { item: saved };
      firstSignal = init.signal;
      return new Promise(() => {});
    });
    const refs = [{kind:'orders',id:'order-A'}];
    const attachments = [{taskId:'previous',fileId:'original'}];
    await act(async () => {
      void cowork.send('核对订单', [], 'conversation_1', refs, [], attachments);
      void cowork.send('核对订单', [], 'conversation_1', refs, [], attachments);
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(firstSignal?.aborted).toBe(true);
    expect(cowork.busy).toBe(false);
    expect(cowork.sendError).toBeTruthy();
    expect(cowork.error).toBe('');
    await act(async () => { await cowork.send('核对订单', [saved], 'conversation_1', refs, [], attachments); });
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(cowork.tasks).toEqual([saved]);
    expect(cowork.sendError).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

it('refreshes the foreground task every second without waiting for a slower background read',async()=>{
 vi.useFakeTimers();
 let releaseBackground:(value:unknown)=>void=()=>{};
 try{
  const current={id:'active-task',identityId:'personal',executor:'platform',conversationId:'current',state:'running',createdAt:'2026-11-23T00:00:00Z',updatedAt:'2026-11-23T00:00:00Z'};
  const other={...current,id:'background-task',conversationId:'other'};
  const calls:string[]=[];
  api.mockImplementation(async(url:string)=>{
   if(url.includes('/agent-identities'))return{items:[{id:'personal',kind:'personal',state:'active'}]};
   if(url.endsWith('/agent-task-capabilities'))return{platformAvailable:true};
   if(url.endsWith('/agent-tasks'))return{items:[current,other],nextCursor:null};
   if(url.endsWith('/agent-tasks/active-task')){calls.push('foreground');return{item:current};}
   if(url.endsWith('/agent-tasks/background-task')){calls.push('background');return new Promise(r=>{releaseBackground=r;});}
   throw Error('unexpected request');
  });
  await act(async()=>{root.render(<Probe conversationId="current"/>);await cowork.reload();});
  expect(calls).toEqual(['foreground','background']);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(calls).toEqual(['foreground','background','foreground','foreground']);
  await act(async()=>{releaseBackground({item:other});});
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(calls.slice(-2)).toEqual(['foreground','background']);
 }finally{releaseBackground({});vi.useRealTimers();}
});

it('recovers the same running task after a hung status read and ignores its late response', async () => {
  vi.useFakeTimers();
  try {
    const running = {
      id: 'task', identityId: 'personal', executor: 'platform', conversationId: 'current', state: 'running',
      createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z',
    };
    const completed = { ...running, state: 'succeeded', result: '完成', updatedAt: '2026-11-23T00:00:10Z' };
    let lateResponse: (value: unknown) => void = () => {};
    const statusSignals: AbortSignal[] = [];
    api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
      if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: true };
      if (url.endsWith('/agent-tasks')) return { items: [running], nextCursor: null };
      if (url.endsWith('/agent-tasks/task')) {
        statusSignals.push(init!.signal!);
        if (statusSignals.length === 1) return new Promise(resolve => { lateResponse = resolve; });
        return { item: completed };
      }
      throw new Error('unexpected request');
    });

    await act(async () => { root.render(<Probe conversationId="current"/>); await cowork.reload(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(statusSignals).toHaveLength(1);
    expect(statusSignals[0].aborted).toBe(true);
    expect(cowork.tasks[0].state).toBe('running');
    expect(cowork.progressStale).toBe(true);
    expect(cowork.error).toBe('');

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(statusSignals).toHaveLength(2);
    expect(cowork.tasks).toEqual([completed]);
    expect(cowork.progressStale).toBe(false);

    await act(async () => {
      lateResponse({ item: { ...running, updatedAt: '2026-11-23T00:00:11Z' } });
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(cowork.tasks).toEqual([completed]);
    expect(statusSignals).toHaveLength(2);
    expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
