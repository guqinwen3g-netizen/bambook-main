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
function View({workspace='workspace',conversationId}:{workspace?:string;conversationId?:string}){channel=useXiaozhuCowork(workspace,'account:'+workspace,true,conversationId);return <div>{channel.tasks.length}</div>}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();api.mockReset();});

it('rechecks opened completed reports on focus and restores access from a fresh report',async()=>{
 const conversationId='conversation_current';
 const report={...task,conversationId,result:'已核对原件',attachments:[{id:'file',name:'原件.pdf'}]};
 const another={...task,id:'another',conversationId:'conversation_other'};
 let restricted=false;
 api.mockImplementation(async(url:string)=>{
  if(url.includes('/personal-agent/task-access?'))return {restrictedIds:restricted?['task']:[]};
  if(url.endsWith('/agent-tasks/task'))return {item:{...report,result:'已重新读取原件'}};
  if(url.endsWith('/agent-tasks'))return {items:[report,another],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId={conversationId}/>));
 expect(channel.tasks.find(item=>item.id==='task')?.result).toBe('已核对原件');
 restricted=true;
 await act(async()=>window.dispatchEvent(new Event('focus')));
 const masked=channel.tasks.find(item=>item.id==='task');
 expect(masked).toMatchObject({state:'succeeded',contentRestricted:true,result:'',instructions:''});
 expect(masked?.attachments).toBeUndefined();
 expect(channel.tasks.find(item=>item.id==='another')).toEqual(another);
 expect(api.mock.calls.filter(([url])=>url.includes('/personal-agent/task-access?')).every(([url])=>url.endsWith('?taskIds=task'))).toBe(true);
 restricted=false;
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(channel.tasks.find(item=>item.id==='task')?.result).toBe('已重新读取原件');
});

it('recovers a lost stop receipt from the one task without rereading history',async()=>{
 const waiting={...task,state:'waiting_time',version:2},stopped={...waiting,state:'cancelled',version:3};
 let committed=false;
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/task/cancel')){committed=true;throw Error('回执断开');}
  if(url.endsWith('/task'))return {item:committed?stopped:waiting};
  if(url.endsWith('/agent-tasks')){
   if(committed)throw Error('历史暂不可读');
   return {items:[waiting],nextCursor:null};
  }
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 await act(async()=>{await channel.cancel(channel.tasks[0]);});
 expect(channel.tasks).toEqual([stopped]);
 expect(channel.error).toBe('');
 expect(api.mock.calls.filter(([url])=>url.endsWith('/agent-tasks'))).toHaveLength(1);
});

it('does not keep an unconfirmed answer warning on a newer task question',async()=>{
 const asking={...task,state:'waiting_human',version:2,canControl:true,questions:[{id:'q1',question:'请给出交期'}]};
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/task/answer'))throw Object.assign(new Error('连接断开'),{status:0});
  if(url.endsWith('/task'))return {item:asking};
  if(url.endsWith('/agent-tasks'))return {items:[asking],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 await act(async()=>{await channel.answer(channel.tasks[0],'q1','1 月 18 日');});
 expect(channel.controls.task.error).toBe('回答未确认，可重试');
 await act(async()=>channel.track({...asking,version:3,questions:[{id:'q2',question:'请给出出运港'}]} as any));
 expect(channel.controls.task?.error).toBeFalsy();
});

it('retries an unconfirmed answer with the same operation ID and keeps the rest of the channel usable',async()=>{
 const asking={...task,state:'waiting_human',version:2,questions:[{id:'q1',question:'请给出交期'}]};
 const resumed={...asking,state:'queued',version:3,questions:[{...asking.questions[0],answer:'1 月 18 日',answeredAt:task.updatedAt}]};
 const sent:unknown[]=[];
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/task/answer')){
   sent.push(JSON.parse(String(init?.body)));
   if(sent.length===1)throw Object.assign(new Error('连接断开'),{status:0});
   return {item:resumed};
  }
  if(url.endsWith('/task'))return {item:sent.length>1?resumed:asking};
  if(url.endsWith('/agent-tasks'))return {items:[asking],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 await act(async()=>{await channel.answer(channel.tasks[0],'q1','1 月 18 日');});
 expect(channel.tasks[0].state).toBe('waiting_human');
 expect(channel.controls.task.error).toBe('回答未确认，可重试');
 expect(channel.error).toBe('');
 await act(async()=>{await channel.answer(channel.tasks[0],'q1','1 月 18 日');});
 expect(sent).toHaveLength(2);
 expect(sent[1]).toEqual(sent[0]);
 expect(channel.tasks[0].questions?.[0]?.answer).toBe('1 月 18 日');
 expect(channel.controls.task.error).toBe('');
});
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
