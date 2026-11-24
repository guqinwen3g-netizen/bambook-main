// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>vi.fn());
vi.mock('./workspace',()=>({mistApiRequest:(...args:any[])=>api(...args)}));
import {useXiaozhuCowork} from './xiaozhuCowork';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,host:HTMLElement,channel:ReturnType<typeof useXiaozhuCowork>;
const task={id:'task',identityId:'identity',executor:'platform',state:'succeeded',instructions:'原业务核对',result:'已完成',createdAt:'2026-11-17T04:00:00Z',updatedAt:'2026-11-17T04:01:00Z'};
const loaded=async(url:string)=>url.includes('/agent-identities')?{items:[{id:'identity',kind:'personal',state:'active'}]}:url.includes('/agent-task-capabilities')?{platformAvailable:true}:{items:[task],nextCursor:null};
function View({workspace='workspace'}:{workspace?:string}){channel=useXiaozhuCowork(workspace,'account:'+workspace,true);return <div>{channel.tasks.length}</div>}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();api.mockReset();});
it('retains the known task channel and history after a failed refresh, blocks a new task, and recovers on a read retry',async()=>{
 api.mockImplementation(loaded);host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<View/>));expect(channel.available).toBe(true);expect(channel.tasks.map(t=>t.id)).toEqual(['task']);
 api.mockRejectedValue(new Error('任务读取失败'));await act(async()=>channel.reload());expect(channel.available).toBe(true);expect(channel.tasks.map(t=>t.id)).toEqual(['task']);expect(channel.error).toBe('任务读取失败');await act(async()=>{expect(await channel.send('不应创建任务')).toBeNull()});expect(api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
 api.mockImplementation(loaded);await act(async()=>channel.reload());expect(channel.error).toBe('');expect(channel.loading).toBe(false);expect(channel.tasks.map(t=>t.id)).toEqual(['task']);expect(api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});

it('times out an older page without blocking composition and ignores a page from the previous workspace', async () => {
  vi.useFakeTimers();
  let sendLate: (value: unknown) => void = () => {};
  const requests: AbortSignal[] = [];
  const other = { ...task, id: 'new-workspace' };
  try {
    api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/other/') && url.endsWith('/agent-tasks')) return { items: [other], nextCursor: null };
      if (url.endsWith('/agent-tasks')) return { items: [task], nextCursor: '2' };
      if (url.endsWith('cursor=2')) return { items: [], nextCursor: '3' };
      if (url.endsWith('cursor=3')) return { items: [], nextCursor: '4' };
      if (url.endsWith('cursor=4')) {
        requests.push(init?.signal!);
        return new Promise(resolve => { sendLate = resolve; });
      }
      return loaded(url);
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<View/>));
    await act(async () => { void channel.loadMore(); void channel.loadMore(); });
    expect(requests).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(requests[0].aborted).toBe(true);
    expect(channel.loadingMore).toBe(false);
    expect(channel.hasMore).toBe(true);
    expect(channel.moreError).toBe('对话读取超时');
    expect(channel.error).toBe('');
    await act(async () => { void channel.loadMore(); });
    await act(async () => root!.render(<View workspace="other"/>));
    expect(requests[1].aborted).toBe(true);
    await act(async () => sendLate({ items: [task], nextCursor: '5' }));
    expect(channel.tasks).toEqual([other]);
    expect(channel.hasMore).toBe(false);
    expect(channel.moreError).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

it('releases a stalled paginated history read and ignores its late response after retry', async () => {
  vi.useFakeTimers();
  let finishStalePage: (value: unknown) => void = () => {};
  const historySignals: AbortSignal[] = [];
  try {
    api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent-tasks')) return { items: [], nextCursor: 'older' };
      if (url.endsWith('?cursor=older')) {
        historySignals.push(init?.signal!);
        return new Promise(resolve => { finishStalePage = resolve; });
      }
      return loaded(url);
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<View/>));
    expect(channel.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(channel.loading).toBe(false);
    expect(channel.error).toBeTruthy();
    expect(historySignals[0]?.aborted).toBe(true);

    api.mockImplementation(loaded);
    await act(async () => channel.reload());
    expect(channel.available).toBe(true);
    expect(channel.error).toBe('');
    expect(channel.tasks).toEqual([task]);
    const callCount = api.mock.calls.length;
    await act(async () => finishStalePage({ items: [{ ...task, id: 'stale' }], nextCursor: 'even-older' }));
    expect(api.mock.calls).toHaveLength(callCount);
    expect(channel.tasks).toEqual([task]);
  } finally {
    vi.useRealTimers();
  }
});
