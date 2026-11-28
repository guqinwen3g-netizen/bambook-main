// @vitest-environment jsdom
import React,{act} from 'react';
import {webcrypto} from 'node:crypto';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getByLabelText,getByText,queryByRole,fireEvent,waitFor} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../components/mist';
import type { Route } from '../nav';
const seam=vi.hoisted(()=>({api:vi.fn(),readAttachment:vi.fn(),copy:vi.fn(),refresh:vi.fn(),go:vi.fn(),identity:'A',userId:'sales',routeId:'',automationId:'',sourcePosition:undefined as Route['sourcePosition']}));
vi.mock('../runtime/auth',()=>({useMistSession:()=>({sessionKey:seam.identity,user:{id:seam.userId}})}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'workspace'},refresh:seam.refresh,readTaskAttachment:seam.readAttachment}),mistApiRequest:(...args:any[])=>seam.api(...args)}));
vi.mock('../nav',async importOriginal=>({
 ...await importOriginal<typeof import('../nav')>(),
 useNav:()=>({go:seam.go,route:{view:'assistant',section:'tasks',id:seam.routeId||undefined,
  automationId:seam.automationId||undefined,sourcePosition:seam.sourcePosition}}),
}));
import {AgentTasks} from './AgentTasks';
import {AssistantConversationProvider} from '../runtime/assistantConversation';
import {readTaskControls} from '../runtime/xiaozhuControlRequests';
let host:HTMLDivElement,root:Root;
const row=()=>({id:'task',identityId:'identity',identityName:'邮件助理',name:'核对邮件',ownerId:'sales',ownerName:'顾言',mode:'operate',instructions:'核对本人来信，移动前交本人确认。',state:'queued',version:3,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-02T00:00:00Z',stepsUsed:0,stepLimit:40,runtimeUsedMs:0,runtimeLimitMs:1800000,lastHeartbeatAt:null,checkpoint:'',result:'',waitingProposalIds:[],canControl:true});
const identity=()=>({id:'identity',name:'邮件助理',mode:'operate',state:'active'});
const paint=()=>root.render(<MistRoot><ToastProvider><AgentTasks onConnections={()=>{}}/></ToastProvider></MistRoot>);
const flush=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve();});};
const click=async(node:HTMLElement)=>{await act(async()=>node.click());await flush();};
it('refreshes the opened platform task as it switches models without reloading connection data', async () => {
 vi.useFakeTimers();
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const executionStageSince=new Date(Date.now()-5_000).toISOString();
 let current={...row(),executor:'platform',state:'running',executionStage:'model',executionStageSince,
  modelFallbackSince:undefined as string|undefined};
 const count=(suffix:string)=>seam.api.mock.calls.filter(([url])=>String(url).endsWith(suffix)).length;
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:current}
  :url.includes('agent-identities')?{items:[identity()]}:url.endsWith('/history')?{items:[],nextCursor:null}:{items:[current],nextCursor:null}));
 try{
  act(paint);await flush();
  expect(getByText(host,'正在等待模型')).toBeTruthy();
  await click(getByText(host,'核对邮件'));
  const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
  expect(getByRole(dialog,'timer').textContent).toBe('· 5 秒');
  const connections=count('agent-identities?scope=mine');
  current={...current,modelFallbackSince:new Date(Date.now()+2_500).toISOString()};
  await act(async()=>vi.advanceTimersByTimeAsync(2_500));
  expect(getByText(dialog,'正在等待备用模型')).toBeTruthy();
  expect(getByText(getByRole(host,'table',{hidden:true}),'正在等待备用模型')).toBeTruthy();
  expect(getByRole(dialog,'timer').textContent).toBe('· 0 秒');
  expect(count('agent-identities?scope=mine')).toBe(connections);
  expect(count('/task')).toBe(2);

  const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
  await act(async()=>window.dispatchEvent(new Event('offline')));
  expect(getByText(dialog,'执行进度暂未更新')).toBeTruthy();
  expect(queryByRole(dialog,'timer')).toBeNull();
  await act(async()=>vi.advanceTimersByTimeAsync(2_500));
  expect(count('/task')).toBe(2);
  online.mockReturnValue(true);
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(count('/task')).toBe(3);
  expect(getByText(dialog,'正在等待备用模型')).toBeTruthy();
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});

it('refreshes the visible task list without requerying stable connection settings on every poll',async()=>{
 vi.useFakeTimers();
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 const count=(suffix:string)=>seam.api.mock.calls.filter(([url])=>String(url).endsWith(suffix)).length;
 const api=seam.api.getMockImplementation()!;
 seam.api.mockImplementation((url:string,init?:RequestInit)=>url.endsWith('/agent-task-capabilities')
  ? Promise.resolve({platformAvailable:true}) : api(url,init));
 try{
  act(paint);await flush();
  expect(count('/agent-tasks')).toBe(1);
  expect(count('/agent-identities?scope=mine')).toBe(1);
  expect(count('/agent-task-capabilities')).toBe(1);
  await act(async()=>vi.advanceTimersByTimeAsync(20_000));
  expect(count('/agent-tasks')).toBe(3);
  expect(count('/agent-identities?scope=mine')).toBe(1);
  expect(count('/agent-task-capabilities')).toBe(1);

  hidden.mockReturnValue(true);
  await act(async()=>vi.advanceTimersByTimeAsync(20_000));
  expect(count('/agent-tasks')).toBe(3);
  hidden.mockReturnValue(false);
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(count('/agent-tasks')).toBe(4);
  expect(count('/agent-identities?scope=mine')).toBe(2);
  await click(getByRole(host,'button',{name:'刷新'}));
  expect(count('/agent-task-capabilities')).toBe(3);
  online.mockReturnValue(false);
  await act(async()=>vi.advanceTimersByTimeAsync(10_000));
  expect(count('/agent-tasks')).toBe(5);
  online.mockReturnValue(true);
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(count('/agent-tasks')).toBe(6);
  expect(count('/agent-identities?scope=mine')).toBe(4);
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});

it('keeps cached task states accurate while the task list is offline or its refresh fails',async()=>{
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 const running={...row(),executor:'platform',state:'running',executionStage:'model'};
 const finished={...running,id:'finished',name:'已核对邮件',state:'succeeded'};
 let current=running;
 let failRefresh=false;
 const api=seam.api.getMockImplementation()!;
 seam.api.mockImplementation((url:string,init?:RequestInit)=>url.endsWith('/agent-tasks')
  ? failRefresh?Promise.reject(new Error('临时读取失败')):Promise.resolve({items:[current,finished],nextCursor:null})
  : api(url,init));
 act(paint);await flush();
 expect(getByText(host,'正在等待模型')).toBeTruthy();
 const listReads=()=>seam.api.mock.calls.filter(([url])=>String(url).endsWith('/agent-tasks')).length;
 const beforeOffline=listReads();
 online.mockReturnValue(false);
 await act(async()=>window.dispatchEvent(new Event('offline')));
 expect(listReads()).toBe(beforeOffline);
 expect(getByText(host,'执行进度暂未更新')).toBeTruthy();
 expect(getByText(host,'执行结束')).toBeTruthy();
 failRefresh=true;
 online.mockReturnValue(true);
 await act(async()=>window.dispatchEvent(new Event('online')));
 expect(listReads()).toBe(beforeOffline+1);
 expect(getByText(host,'执行进度暂未更新')).toBeTruthy();
 expect(getByText(host,'任务读取失败')).toBeTruthy();
 failRefresh=false;
 current={...running,state:'succeeded'};
 await click(getByRole(host,'button',{name:'刷新'}));
 expect(host.textContent).not.toContain('执行进度暂未更新');
 expect(getByText(host,'核对邮件').closest('[role="row"]')?.textContent).toContain('执行结束');
 online.mockRestore();
});

it('hides the cached retry time in task details until its own read recovers',async()=>{
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 const queued={...row(),executor:'platform',executionIssue:{code:'model_timeout',retryAt:'2026-11-01T00:05:00Z'}};
 let detailFails=false;
 const api=seam.api.getMockImplementation()!;
 seam.api.mockImplementation((url:string,init?:RequestInit)=>url.endsWith('/task')
  ? detailFails?Promise.reject(new Error('临时详情读取失败')):Promise.resolve({item:queued})
  : url.endsWith('/agent-tasks')?Promise.resolve({items:[queued],nextCursor:null}):api(url,init));
 act(paint);await flush();
 await click(getByText(host,'核对邮件'));
 const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
 expect(getByText(dialog,/下次重试/)).toBeTruthy();
 online.mockReturnValue(false);
 await act(async()=>window.dispatchEvent(new Event('offline')));
 expect(getByText(dialog,'执行进度暂未更新')).toBeTruthy();
 expect(dialog.textContent).not.toContain('下次重试');
 detailFails=true;
 online.mockReturnValue(true);
 await act(async()=>window.dispatchEvent(new Event('online')));
 expect(getByText(dialog,'执行进度暂未更新')).toBeTruthy();
 expect(dialog.textContent).not.toContain('下次重试');
 detailFails=false;
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(dialog.textContent).not.toContain('执行进度暂未更新');
 expect(getByText(dialog,/下次重试/)).toBeTruthy();
 online.mockRestore();
});

it('checks connection metadata on the next visible poll after a transient failure',async()=>{
 vi.useFakeTimers();
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const api=seam.api.getMockImplementation()!;
 let attempts=0;
 seam.api.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/agent-task-capabilities'))return Promise.resolve({platformAvailable:true});
  if(url.includes('agent-identities')&&++attempts===1)return Promise.reject(new Error('临时连接失败'));
  return api(url,init);
 });
 try{
  act(paint);await flush();
  expect(getByText(host,'Agent连接读取失败')).toBeTruthy();
  await act(async()=>vi.advanceTimersByTimeAsync(10_000));
  expect(attempts).toBe(2);
  expect(host.textContent).not.toContain('Agent连接读取失败');
  await act(async()=>vi.advanceTimersByTimeAsync(10_000));
  expect(attempts).toBe(2);
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});

it('keeps the loaded task pages through refresh and rechecks access to older rows',async()=>{
 vi.useFakeTimers();
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const api=seam.api.getMockImplementation()!;
 const recent={...row(),name:'当前一页的任务'};
 const older={...row(),id:'second-task',name:'旧一页的报告'};
 let refreshed=false;
 const cursors:string[]=[];
 seam.api.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/agent-tasks'))return Promise.resolve({items:[recent],nextCursor:refreshed?'fresh-cursor':'earlier-cursor'});
  const cursor=new URL(url,'http://local.test').searchParams.get('cursor');
  if(cursor){
   cursors.push(cursor);
   return Promise.resolve({items:[refreshed?{...older,name:'Agent任务',state:'access_changed',contentRestricted:true}:older],nextCursor:null});
  }
  return api(url,init);
 });
 try{
  act(paint);await flush();
  await click(getByRole(host,'button',{name:'加载更多'}));
  expect(getByText(host,older.name)).toBeTruthy();
  refreshed=true;
  await act(async()=>vi.advanceTimersByTimeAsync(10_000));
  expect(cursors).toEqual(['earlier-cursor','fresh-cursor']);
  expect(getByText(host,'当前一页的任务')).toBeTruthy();
  expect(getByText(host,'Agent任务')).toBeTruthy();
  expect(host.textContent).not.toContain(older.name);
  expect(queryByRole(host,'button',{name:'加载更多'})).toBeNull();
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});

it('lets a pending older page finish without the automatic refresh aborting it',async()=>{
 vi.useFakeTimers();
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const api=seam.api.getMockImplementation()!;
 let reply:(value:unknown)=>void=()=>{};
 let signal:AbortSignal|undefined,firstPageReads=0;
 seam.api.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/agent-tasks')){
   firstPageReads++;return Promise.resolve({items:[row()],nextCursor:'older'});
  }
  if(url.endsWith('?cursor=older')){
   signal=init?.signal??undefined;
   return new Promise(resolve=>{reply=resolve;});
  }
  return api(url,init);
 });
 try{
  act(paint);await flush();
  await act(async()=>vi.advanceTimersByTimeAsync(7_000));
  await click(getByRole(host,'button',{name:'加载更多'}));
  await act(async()=>vi.advanceTimersByTimeAsync(3_000));
  expect(signal?.aborted).toBe(false);
  expect(firstPageReads).toBe(1);
  await act(async()=>reply({items:[{...row(),id:'second',name:'已加载旧任务'}],nextCursor:null}));
  expect(getByText(host,'已加载旧任务')).toBeTruthy();
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});

it.each([
 ['personal', {executor:'platform',conversationId:'c_original_report'}, '打开原对话', ['assistant','task',{section:'task-origin'}]],
 ['automation', {executor:'platform',automationId:'rule-original'}, '打开原规则', ['assistant','task',{section:'automations',automationId:'rule-original'}]],
 ['external', {executor:'external',conversationId:'c_external_report'}, undefined, []],
 ['restricted', {executor:'platform',conversationId:'c_restricted_report',contentRestricted:true}, undefined, []],
] as const)('offers an exact origin only for a readable task with an origin (%s)',async(_kind,metadata,label,route)=>{
 const report={...row(),...metadata,state:'succeeded',result:'模拟订单已核对',canControl:false};
 const api=seam.api.getMockImplementation()!;
 seam.api.mockImplementation((url:string,init?:RequestInit)=>url.endsWith('/agent-tasks')
  ? Promise.resolve({items:[report],nextCursor:null}) : url.endsWith('/task') ? Promise.resolve({item:report}) : api(url,init));
 act(paint);await flush();await click(getByText(host,report.name));
 const dialog=getByRole(document.body,'dialog',{name:report.name});
 if(label){
  await click(getByRole(dialog,'button',{name:label}));
  expect(seam.go).toHaveBeenCalledExactlyOnceWith(...route);
 }else{
  expect(queryByRole(dialog,'button',{name:'打开原对话'})).toBeNull();
  expect(queryByRole(dialog,'button',{name:'打开原规则'})).toBeNull();
 }
 expect(seam.api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});

it('returns the task detail to its original automation rule when closed',async()=>{
 seam.routeId='task';seam.automationId='rule-a';
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:{...row(),automationId:'rule-a'}}:url.includes('agent-identities')?{items:[identity()]}:{items:[],nextCursor:null}));
 act(paint);await flush();
 await click(getByRole(getByRole(document.body,'dialog',{name:'核对邮件'}),'button',{name:'关闭'}));
 expect(seam.go).toHaveBeenCalledExactlyOnceWith('assistant','task',{section:'automations',automationId:'rule-a'});
});
it('opens the exact notification task even when it is absent from the first list page',async()=>{
 seam.routeId='older-task';seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/older-task')?{item:{...row(),id:'older-task',name:'核对旧交接',state:'waiting_human',questions:[{id:'q',question:'请提供书面交期。',askedAt:'2026-11-01T00:00:00Z'}]}}:url.includes('/history')?{items:[],nextCursor:null}:url.includes('agent-identities')?{items:[identity()]}:{items:[],nextCursor:null}));
 act(paint);await flush();const dialog=getByRole(document.body,'dialog',{name:'核对旧交接'});expect(dialog.textContent).toContain('请提供书面交期。');expect(getByRole(dialog,'button',{name:'补充资料'})).toBeTruthy();expect(seam.api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});
it('does not show list-cached instructions while checking fresh detail access',async()=>{
 let receive!: (value:unknown)=>void;
 const fresh=new Promise(resolve=>{receive=resolve;});
 seam.api.mockImplementation((url:string)=>url.endsWith('/task')?fresh:Promise.resolve(url.includes('agent-identities')?{items:[identity()]}:url.includes('/history')?{items:[]}:{items:[row()],nextCursor:null}));
 act(paint);await flush();await click(getByText(host,'核对邮件'));
 expect(getByRole(document.body,'dialog').textContent).not.toContain(row().instructions);
 await act(async()=>receive({item:{...row(),name:'Agent任务',state:'access_changed',instructions:''}}));await flush();
 expect(getByRole(document.body,'dialog',{name:'Agent任务'}).textContent).toContain('权限已变化');
});
it('opens the exact notified task while its history has yet to respond',async()=>{
 seam.routeId='task';
 seam.api.mockImplementation((url:string)=>url.includes('/history')?new Promise(()=>{}):Promise.resolve(url.endsWith('/task')?{item:row()}:url.includes('agent-identities')?{items:[identity()]}:{items:[],nextCursor:null}));
 act(paint);await flush();
 expect(getByRole(document.body,'dialog',{name:'核对邮件'}).textContent).toContain(row().instructions);
});
it('makes the task list usable before connections or capabilities respond',async()=>{
 seam.api.mockImplementation((url:string)=>{
  if(url.includes('agent-identities')||url.endsWith('/agent-task-capabilities'))return new Promise(()=>{});
  return Promise.resolve(url.endsWith('/task')?{item:row()}:url.includes('/history')?{items:[]}:{items:[row()],nextCursor:null});
 });
 act(paint);await flush();
 expect((getByRole(host,'button',{name:'刷新'}) as HTMLButtonElement).disabled).toBe(false);
 expect((getByRole(host,'button',{name:'新建任务'}) as HTMLButtonElement).disabled).toBe(true);
 await click(getByText(host,'核对邮件'));
 expect(getByRole(document.body,'dialog',{name:'核对邮件'}).textContent).toContain(row().instructions);
});
it('releases a stalled list at its deadline and retries it from the same page',async()=>{
 vi.useFakeTimers();
 try{
  let reads=0,signal:AbortSignal|undefined;
  seam.api.mockImplementation((url:string,init:any)=>{
   if(url.endsWith('/agent-tasks')&&++reads===1){signal=init.signal;return new Promise(()=>{});}
   return Promise.resolve(url.includes('agent-identities')?{items:[identity()]}:{items:[row()],nextCursor:null});
  });
  act(paint);await flush();await act(async()=>vi.advanceTimersByTimeAsync(8_000));
  expect(signal?.aborted).toBe(true);
  expect(host.textContent).toContain('任务列表读取超时');
  await click(getByRole(host,'button',{name:'刷新'}));
  expect(reads).toBe(2);expect(getByText(host,'核对邮件')).toBeTruthy();
 }finally{vi.useRealTimers();}
});
it('retries the exact task after a detail timeout without showing list-cached content',async()=>{
 vi.useFakeTimers();
 try {
  seam.routeId='task';
  let attempts=0,firstSignal:AbortSignal|undefined;
  seam.api.mockImplementation((url:string,init:any)=>{
   if(url.endsWith('/task')&&++attempts===1){firstSignal=init.signal;return new Promise(()=>{});}
   return Promise.resolve(url.endsWith('/task')?{item:row()}:url.includes('agent-identities')?{items:[identity()]}:url.includes('/history')?{items:[]}:{items:[row()],nextCursor:null});
  });
  act(paint);await flush();
  await act(async()=>vi.advanceTimersByTimeAsync(8_000));
  const timeout=getByRole(document.body,'dialog',{name:'任务'});
  expect(timeout.textContent).toContain('任务详情读取超时');
  expect(firstSignal?.aborted).toBe(true);
  expect(timeout.textContent).not.toContain(row().instructions);
  await click(getByRole(timeout,'button',{name:'重试'}));
  expect(attempts).toBe(2);
  expect(getByRole(document.body,'dialog',{name:'核对邮件'}).textContent).toContain(row().instructions);
 } finally {vi.useRealTimers();}
});
it('shows a scheduled continuation with pause and stop controls without presenting a waiting task as running',async()=>{
 const waiting={...row(),state:'waiting_time',resumeAt:'2026-11-01T08:00:00Z'};seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:waiting}:url.includes('/history')?{items:[],nextCursor:null}:url.includes('agent-identities')?{items:[identity()]}:{items:[waiting],nextCursor:null}));act(paint);await flush();await click(getByText(host,'核对邮件'));const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});expect(dialog.textContent).toContain('计划继续');expect(dialog.textContent).toContain('等待继续');expect(dialog.textContent).not.toContain('执行中');expect(getByRole(dialog,'button',{name:'暂停任务'})).toBeTruthy();expect(getByRole(dialog,'button',{name:'停止任务'})).toBeTruthy();expect(queryByRole(dialog,'button',{name:'继续任务'})).toBeNull();
});
it('shows the watched original and maximum deadline, keeps stop controls and opens the exact source',async()=>{
 const waiting={...row(),state:'waiting_condition',resumeAt:'2026-11-01T08:00:00Z',waitingFor:{type:'email',id:'original',label:'PO-1042',link:'bambook://open?view=emails&id=original'},nextCheckAt:'2026-11-01T00:00:30Z'};
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:waiting}:url.includes('/history')?{items:[],nextCursor:null}:url.includes('agent-identities')?{items:[identity()]}:{items:[waiting],nextCursor:null}));act(paint);await flush();await click(getByText(host,'核对邮件'));const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
 expect(dialog.textContent).toContain('等待资料变化');expect(dialog.textContent).toContain('PO-1042');expect(dialog.textContent).toContain('等待截止');expect(dialog.textContent).not.toContain('计划继续');expect(queryByRole(dialog,'button',{name:'继续任务'})).toBeNull();expect(getByRole(dialog,'button',{name:'暂停任务'})).toBeTruthy();expect(getByRole(dialog,'button',{name:'停止任务'})).toBeTruthy();await click(getByRole(dialog,'button',{name:'查看原资料'}));expect(seam.go).toHaveBeenCalledWith('emails','original',undefined);
});
it('labels a condition timeout without claiming that the business condition has been satisfied',async()=>{
 const ready={...row(),wakeReason:'deadline',requiredRead:{type:'email',id:'original'}};
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:ready}:url.includes('/history')?{items:[],nextCursor:null}:url.includes('agent-identities')?{items:[identity()]}:{items:[ready],nextCursor:null}));act(paint);await flush();await click(getByText(host,'核对邮件'));const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
 expect(dialog.textContent).toContain('继续原因');expect(dialog.textContent).toContain('到达最晚时间');expect(dialog.textContent).not.toContain('条件已满足');expect(queryByRole(dialog,'button',{name:'查看原资料'})).toBeNull();
});
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();seam.identity='A';seam.userId='sales';seam.routeId='';seam.automationId='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:seam.copy.mockResolvedValue(undefined)}});host=document.createElement('div');document.body.append(host);root=createRoot(host);seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{item:row()}:url.includes('agent-identities')?{items:[identity()],nextCursor:null}:url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:row()}:{items:[row()],nextCursor:null}));});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('shows idle tasks honestly and creates only a queued task without claiming or issuing a connection',async()=>{
 act(paint);await flush();expect(getByText(host,'待领取')).toBeTruthy();expect(host.textContent).not.toContain('执行中');
 await click(getByRole(host,'button',{name:'新建任务'}));
 await act(async()=>{fireEvent.change(getByLabelText(document.body,/Agent连接/,{selector:'select'}),{target:{value:'identity'}});fireEvent.input(getByLabelText(document.body,/任务名称/,{selector:'input'}),{target:{value:'核对新来信'}});fireEvent.input(getByLabelText(document.body,/任务内容/,{selector:'textarea'}),{target:{value:'核对当前授权来信，并保留原文依据。'}});});
 await click(getByRole(document.body,'button',{name:'安排任务',exact:true}));
 const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);expect(writes[0][0]).toMatch(/\/agent-tasks$/);expect(JSON.parse(writes[0][1].body)).toMatchObject({identityId:'identity',name:'核对新来信'});expect(JSON.stringify(writes)).not.toContain('/claim');
});
it('copies only a task-specific credential, conceals it in the page, and discards it after an account switch',async()=>{
 seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{item:row(),token:'private-task-control'}:url.includes('agent-identities')?{items:[identity()]}:url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:row()}:{items:[row()],nextCursor:null}));
 act(paint);await flush();await click(getByText(host,'核对邮件'));await click(getByRole(document.body,'button',{name:'连接Agent',exact:true}));await click(getByRole(document.body,'button',{name:'生成任务连接'}));
 const token=getByLabelText(document.body,'连接凭据',{selector:'input'}) as HTMLInputElement;expect(token.type).toBe('password');expect(document.body.textContent).not.toContain('private-task-control');
 await click(getByRole(document.body,'button',{name:'复制配置'}));const config=JSON.parse(seam.copy.mock.calls[0][0]);expect(config.mcpServers['bambook-task'].headers).toEqual({'x-bambook-task-control':'private-task-control'});expect(JSON.stringify(config)).not.toContain('x-bambook-agent-key');
 seam.identity='B';seam.userId='other';act(paint);await flush();expect(document.body.innerHTML).not.toContain('private-task-control');
});
it('retries an uncertain original arrangement with the same request id and immutable fields',async()=>{
 let first:any;seam.api.mockImplementation((url:string,init:any)=>{if(init?.method==='POST'){if(!first){first=JSON.parse(init.body);return Promise.reject(new Error('网络中断'));}return Promise.resolve({item:row()});}return Promise.resolve(url.includes('agent-identities')?{items:[identity()]}:{items:[row()],nextCursor:null});});
 act(paint);await flush();await click(getByRole(host,'button',{name:'新建任务'}));
 await act(async()=>{fireEvent.change(getByLabelText(document.body,/Agent连接/,{selector:'select'}),{target:{value:'identity'}});fireEvent.input(getByLabelText(document.body,/任务名称/,{selector:'input'}),{target:{value:'核对新来信'}});fireEvent.input(getByLabelText(document.body,/任务内容/,{selector:'textarea'}),{target:{value:'核对授权来信'}});});
 await click(getByRole(document.body,'button',{name:'安排任务',exact:true}));expect((getByLabelText(document.body,/任务名称/,{selector:'input'}) as HTMLInputElement).disabled).toBe(true);
 await click(getByRole(document.body,'button',{name:'核对原操作'}));const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(JSON.parse(writes[1][1].body)).toEqual(first);expect(queryByRole(document.body,'dialog',{name:'新建任务'})).toBeNull();
});

it('refreshes the open task and its history even after it leaves the first page',async()=>{
 let advanced=false;
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('agent-identities')?{items:[identity()],nextCursor:null}:url.includes('/history')?{items:advanced?[{action:'checkpoint',version:5,at:'2026-11-01T00:01:00Z',actorName:'邮件助理',actorId:'sales',state:'running'}]:[],nextCursor:null}:url.endsWith('/task')?{item:{...row(),state:advanced?'running':'queued',checkpoint:advanced?'当前检查点':''}}:{items:advanced?[]:[row()],nextCursor:null}));
 act(paint);await flush();await click(getByText(host,'核对邮件'));advanced=true;await click(getByRole(host,'button',{name:'刷新'}));
 expect(getByText(document.body,'当前检查点')).toBeTruthy();expect(getByText(document.body,'保存检查点')).toBeTruthy();expect(getByText(document.body,'执行中')).toBeTruthy();
});
it('refreshes the open history even when the selected detail request hangs',async()=>{
 const paused={...row(),state:'paused'};
 let refreshing=false;
 seam.api.mockImplementation((url:string)=>{
  if(url.endsWith('/task'))return refreshing?new Promise(()=>{}):Promise.resolve({item:paused});
  if(url.endsWith('/history'))return Promise.resolve({items:refreshing?[{action:'resume',version:4,at:'2026-11-01T00:01:00Z',actorName:'顾言'}]:[],nextCursor:null});
  return Promise.resolve(url.includes('agent-identities')?{items:[identity()]}:{items:[paused],nextCursor:null});
 });
 act(paint);await flush();await click(getByText(host,'核对邮件'));
 refreshing=true;
 await click(getByRole(host,'button',{name:'刷新'}));
 const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
 expect(dialog.querySelector('.mist-drawer-body')?.textContent).toContain('继续任务');
 expect(getByText(dialog,'已暂停')).toBeTruthy();
});

it('rechecks history if the current read started before a task state transition',async()=>{
 let update=false,releaseHistory:((value:unknown)=>void)|undefined;
 const running={...row(),executor:'platform',state:'running'};
 const finished={action:'finished',version:4,at:'2026-11-01T00:01:00Z',actorName:'顾言'};
 seam.api.mockImplementation((url:string)=>{
  if(url.endsWith('/task'))return Promise.resolve({item:update?{...running,state:'succeeded',version:4,result:'核对报告'}:running});
  if(url.endsWith('/history')){
   if(!update)return Promise.resolve({items:[],nextCursor:null});
   if(!releaseHistory)return new Promise(resolve=>{releaseHistory=resolve;});
   return Promise.resolve({items:[finished],nextCursor:null});
  }
  return Promise.resolve(url.includes('agent-identities')?{items:[identity()]}:{items:[running],nextCursor:null});
 });
 act(paint);await flush();await click(getByText(host,'核对邮件'));
 update=true;
 await click(getByRole(host,'button',{name:'刷新'}));
 const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
 expect(getByText(dialog,'核对报告')).toBeTruthy();
 expect(releaseHistory).toBeTypeOf('function');
 await act(async()=>releaseHistory?.({items:[],nextCursor:null}));
 await flush();
 expect(dialog.textContent?.match(/执行结束/g)).toHaveLength(2);
});

it('loads the finish event as the active task reaches its report, before the list poll',async()=>{
 vi.useFakeTimers();
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const running={...row(),executor:'platform',state:'running'};
 let selected=running;
 const events=[{action:'claimed',version:3,at:'2026-11-01T00:01:00Z',actorName:'邮件助理'}];
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:selected}
  :url.endsWith('/history')?{items:[...events],nextCursor:null}
  :url.includes('agent-identities')?{items:[identity()]}:{items:[running],nextCursor:null}));
 try{
  act(paint);await flush();await click(getByText(host,'核对邮件'));
  const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
  expect(getByText(dialog,'执行器领取')).toBeTruthy();
  selected={...running,state:'succeeded',version:4,result:'核对报告'};
  events.unshift({action:'finished',version:4,at:'2026-11-01T00:02:00Z',actorName:'邮件助理'});
  await act(async()=>vi.advanceTimersByTimeAsync(2_500));
  expect(getByText(dialog,'核对报告')).toBeTruthy();
  expect(getByText(dialog,'执行器领取')).toBeTruthy();
  expect(dialog.textContent?.match(/执行结束/g)).toHaveLength(2);
  expect(seam.api.mock.calls.filter(([url])=>String(url).endsWith('/agent-tasks'))).toHaveLength(1);
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});
it('retries the failed newest history page without jumping to the older cursor',async()=>{
 vi.useFakeTimers();
 vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const running={...row(),executor:'platform',state:'running'};
 let selected=running,historyFails=false;
 seam.api.mockImplementation((url:string)=>{
  if(url.endsWith('/history')&&historyFails)return Promise.reject(new Error('记录刷新失败'));
  return Promise.resolve(url.endsWith('/task')?{item:selected}
   :url.endsWith('/history')?{items:[],nextCursor:'older-history'}
   :url.includes('agent-identities')?{items:[identity()]}:{items:[running],nextCursor:null});
 });
 try{
  act(paint);await flush();await click(getByText(host,'核对邮件'));
  const dialog=getByRole(document.body,'dialog',{name:'核对邮件'});
  expect(getByRole(dialog,'button',{name:'更多记录'})).toBeTruthy();
  selected={...running,state:'succeeded',version:4};
  historyFails=true;
  await act(async()=>vi.advanceTimersByTimeAsync(2_500));
  expect(getByText(dialog,'任务记录读取失败')).toBeTruthy();
  historyFails=false;
  await click(getByRole(dialog,'button',{name:'重试'}));
  expect(String(seam.api.mock.lastCall?.[0])).toMatch(/\/task\/history$/);
  expect(dialog.textContent).not.toContain('任务记录读取失败');
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});
it('includes active owner connections beyond the first page',async()=>{
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('agent-identities')?url.includes('cursor=next')?{items:[identity()],nextCursor:null}:{items:[],nextCursor:'next'}:{items:[],nextCursor:null}));
 act(paint);await flush();await click(getByRole(host,'button',{name:'新建任务'}));expect(getByRole(document.body,'option',{name:'邮件助理 · 可办理'})).toBeTruthy();
});
it('keeps the owner stop action reachable for a masked task without offering new execution',async()=>{
 const masked={...row(),name:'Agent任务',state:'access_changed',instructions:'',canControl:true};
 let current=masked;
 seam.api.mockImplementation((url:string,init:any)=>{
  if(init?.method==='POST')current={...masked,state:'cancelled',canControl:false};
  return Promise.resolve(init?.method==='POST'||url.endsWith('/task')?{item:current}:url.includes('agent-identities')?{items:[{...identity(),state:'invalid',canIssue:false,canRevoke:true}],nextCursor:null}:url.includes('/history')?{items:[],nextCursor:null}:{items:[current],nextCursor:null});
 });
 act(paint);await flush();expect((getByRole(host,'button',{name:'新建任务'}) as HTMLButtonElement).disabled).toBe(true);expect(getByRole(host,'button',{name:'新建任务'}).title).toBe('当前无AI使用权限');await click(getByText(host,'Agent任务'));expect(queryByRole(document.body,'button',{name:'连接Agent',exact:true})).toBeNull();expect(queryByRole(document.body,'button',{name:'继续任务'})).toBeNull();
 const dialog=getByRole(document.body,'dialog',{name:'Agent任务'});
 expect(dialog.textContent).toContain('权限已变化');
 expect(dialog.textContent).not.toContain('可办理');
 expect(queryByRole(dialog,'button',{name:'暂停任务'})).toBeNull();
 await click(getByRole(document.body,'button',{name:'停止任务',exact:true}));await click(getByRole(document.body,'button',{name:'确认',exact:true}));const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);expect(writes[0][0]).toMatch(/\/task\/cancel$/);expect(JSON.parse(writes[0][1].body).version).toBe(masked.version);
 expect(dialog.textContent).toContain('已停止');
 expect(dialog.textContent).not.toContain('可办理');
});
it('applies the detail permission change even when refreshing connections fails',async()=>{
 let current={...row(),executor:'platform'},connectionsUnavailable=false;
 seam.api.mockImplementation((url:string)=>{
  if(url.includes('agent-identities'))return connectionsUnavailable?Promise.reject(new Error('连接暂不可用')):Promise.resolve({items:[identity()]});
  return Promise.resolve(url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:current}:{items:[current],nextCursor:null});
 });
 act(paint);await flush();await click(getByText(host,'核对邮件'));
 expect(getByRole(document.body,'dialog',{name:'核对邮件'}).textContent).toContain('可办理');
 current={...current,state:'access_changed',name:'Agent任务',instructions:''};
 connectionsUnavailable=true;
 await click(getByRole(host,'button',{name:'刷新'}));
 const dialog=getByRole(document.body,'dialog',{name:'Agent任务'});
 expect(dialog.textContent).toContain('权限已变化');
 expect(dialog.textContent).not.toContain('可办理');
 expect(dialog.textContent).not.toContain(row().instructions);
 expect(host.textContent).not.toContain(row().name);
 expect(getByRole(dialog,'button',{name:'停止任务'})).toBeTruthy();
});
it('rechecks an open report on focus and visibility, withholds it after confirmed restriction, and restores it after access returns',async()=>{
 const report={...row(),executor:'platform',state:'succeeded',result:'原件中的经营事实',canControl:false};
 const masked={...report,contentRestricted:true,name:'Agent任务',instructions:'',result:''};
 let current=report,fail=false,detailRequests=0;
 seam.api.mockImplementation((url:string,init:any)=>{
  if(url.endsWith('/task')){
   detailRequests++;
   if(fail)return Promise.reject(new Error('网络中断'));
   if(detailRequests>1)expect(init.cache).toBe('no-store');
   return Promise.resolve({item:current});
  }
  return Promise.resolve(url.includes('agent-identities')?{items:[identity()]}:url.includes('/history')?{items:[],nextCursor:null}:{items:[current],nextCursor:null});
 });
 act(paint);await flush();await click(getByText(host,'核对邮件'));
 expect(getByText(document.body,report.result)).toBeTruthy();
 fail=true;
 await act(async()=>window.dispatchEvent(new Event('focus')));await flush();
 expect(detailRequests).toBe(2);
 expect(getByText(document.body,report.result)).toBeTruthy();
 expect(getByText(document.body,'任务详情读取失败')).toBeTruthy();
 fail=false;current=masked;
 await act(async()=>{
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
 });await flush();
 expect(detailRequests).toBe(3);
 const restricted=getByRole(document.body,'dialog',{name:'Agent任务'});
 expect(restricted.textContent).toContain('权限已变化');
 expect(restricted.textContent).toContain('执行结束');
 expect(restricted.textContent).not.toContain(report.instructions);
 expect(document.body.textContent).not.toContain(report.result);
 expect(host.textContent).not.toContain(report.name);
 current=report;
 await act(async()=>window.dispatchEvent(new Event('focus')));await flush();
 expect(detailRequests).toBe(4);
 expect(getByRole(document.body,'dialog',{name:'核对邮件'}).textContent).toContain(report.result);
});
it.each(['queued','running'] as const)('shows the model timeout in task details during %s',async state=>{
 const detail={...row(),state,executor:'platform',executionStage:state==='running'?'model':undefined,
  executionIssue:{code:'model_timeout',retryAt:new Date(Date.now()+5000).toISOString()}};
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:detail}
  :url.includes('agent-identities')?{items:[identity()]}:url.endsWith('/history')?{items:[],nextCursor:null}:{items:[detail],nextCursor:null}));
 act(paint);
 await flush();
 await click(getByText(host,detail.name));
 const dialog=getByRole(document.body,'dialog',{name:detail.name});
 expect(dialog.textContent).toContain('模型响应超时');
 expect(dialog.textContent).toContain(state==='queued'?'模型响应超时，等待重试':'正在重试模型');
 expect(dialog.textContent?.includes('下次重试')).toBe(state==='queued');
});

it('opens a report attachment from the task drawer and removes its preview on restriction', async () => {
 const pdf={id:'pdf-a',name:'发票.pdf',mimeType:'application/pdf',size:30};
 const sibling={...pdf,id:'pdf-b'};
 const label='发票.pdf（2）';
 const report={...row(),state:'succeeded',executor:'platform',result:'请核对 '+label+' 第 23 页。',canControl:false,contentRestricted:false,
  attachments:[sibling,pdf],trail:[{at:'',kind:'read',label:'已读',taskAttachmentId:pdf.id,taskAttachmentObservedPages:[23]}]};
 let current=report;
 seam.readAttachment.mockRejectedValue(new Error('暂时无法读取'));
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:current}
  :url.includes('agent-identities')?{items:[identity()]}:url.endsWith('/history')?{items:[],nextCursor:null}:{items:[current],nextCursor:null}));
 act(paint);await flush();await click(getByText(host,report.name));
 expect(seam.readAttachment).not.toHaveBeenCalled();
 const dialog=getByRole(document.body,'dialog',{name:report.name});
 const citation=getByRole(dialog,'button',{name:label});
 expect(citation.title).toBe('第 23 页');
 citation.focus();await click(citation);
 expect(getByRole(document.body,'dialog',{name:label})).toBeTruthy();
 expect(seam.readAttachment).toHaveBeenLastCalledWith(report.id,pdf);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await flush();
 expect(document.activeElement).toBe(citation);
 await click(citation);
 current={...report,name:'Agent任务',result:'',attachments:[],trail:[],contentRestricted:true};
 await act(async()=>window.dispatchEvent(new Event('focus')));await flush();
 expect(queryByRole(document.body,'dialog',{name:label})).toBeNull();
 expect(getByRole(document.body,'dialog',{name:'Agent任务'})).toBeTruthy();
 expect(queryByRole(document.body,'button',{name:label})).toBeNull();
 current=report;
 await act(async()=>window.dispatchEvent(new Event('focus')));await flush();
 expect(getByRole(document.body,'button',{name:label})).toBeTruthy();
 expect(queryByRole(document.body,'dialog',{name:label})).toBeNull();
 expect(seam.readAttachment).toHaveBeenCalledTimes(2);
 expect(seam.api.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});

it('does not replace a committed task control receipt with an older focus read',async()=>{
 const active={...row(),executor:'platform',state:'running'};
 const stopped={...active,state:'cancelled',version:active.version+1,canControl:false};
 let current=active,delayNext=false,focusSignal:AbortSignal|undefined,deliver:((value:unknown)=>void)|undefined;
 seam.api.mockImplementation((url:string,init:any)=>{
  if(init?.method==='POST'){current=stopped;return Promise.resolve({item:current});}
  if(url.endsWith('/task')&&delayNext){
   delayNext=false;focusSignal=init.signal;return new Promise(resolve=>{deliver=resolve;});
  }
  return Promise.resolve(url.endsWith('/task')?{item:current}:url.includes('agent-identities')?{items:[identity()]}:url.includes('/history')?{items:[],nextCursor:null}:{items:[current],nextCursor:null});
 });
 act(paint);await flush();await click(getByText(host,active.name));
 delayNext=true;
 await act(async()=>window.dispatchEvent(new Event('focus')));await flush();
 expect(focusSignal?.aborted).toBe(false);
 const dialog=getByRole(document.body,'dialog',{name:active.name});
 await click(getByRole(dialog,'button',{name:'停止任务'}));
 await click(getByRole(document.body,'button',{name:'确认',exact:true}));
 expect(focusSignal?.aborted).toBe(true);
 await act(async()=>deliver?.({item:active}));await flush();
 expect(dialog.textContent).toContain('已停止');
 expect(dialog.textContent).not.toContain('执行中');
});
it('shows missing facts distinctly and submits an owner answer without confirming business',async()=>{
 const question={id:'question',question:'请提供准确工厂交期及书面依据。',askedAt:'2026-11-01T00:10:00Z'},waiting={...row(),state:'waiting_human',questions:[question]};
 let answered=false;const current=()=>answered?{...waiting,state:'queued',questions:[{...question,answer:'请按11月25日核对原件。',answeredAt:'2026-11-01T00:20:00Z'}]}:waiting;
 seam.api.mockImplementation((url:string,init:any)=>{if(init?.method==='POST')answered=true;return Promise.resolve(init?.method==='POST'?{item:current()}:url.includes('agent-identities')?{items:[identity()],nextCursor:null}:url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:current()}:{items:[current()],nextCursor:null});});
 act(paint);await flush();expect(getByText(host,'待补充资料')).toBeTruthy();await click(getByText(host,'核对邮件'));expect(queryByRole(document.body,'button',{name:'查看待确认事项'})).toBeNull();await click(getByRole(document.body,'button',{name:'补充资料',exact:true}));
 await act(async()=>fireEvent.input(getByLabelText(document.body,/答复/,{selector:'textarea'}),{target:{value:'请按11月25日核对原件。'}}));await click(getByRole(document.body,'button',{name:'提交答复'}));
 const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);expect(writes[0][0]).toMatch(/\/task\/answer$/);expect(JSON.parse(writes[0][1].body)).toMatchObject({version:3,questionId:'question',answer:'请按11月25日核对原件。'});expect(queryByRole(document.body,'dialog',{name:'补充资料'})).toBeNull();expect(getByText(document.body,'请按11月25日核对原件。')).toBeTruthy();
});
it.each(['xlsx','pdf'])('submits the numbered %s selected in task details', async extension => {
 const filename='报价.'+extension;
 const choice=filename+'（2）';
 const question = {id:'question',question:extension==='pdf'?'请回复要核对的 PDF 完整文件名，包括名称后显示的编号。':'请回复要核对的工作簿完整文件名，包括名称后显示的编号。',attachmentChoiceIds:['a1','a2'],askedAt:'2026-11-01T00:10:00Z'};
 const waiting = {...row(),state:'waiting_human',questions:[question],attachments:[
  {id:'a1',name:filename,mimeType:'application/octet-stream',size:10},
  {id:'a2',name:filename,mimeType:'application/octet-stream',size:10},
 ]};
 seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{item:{...waiting,state:'queued',questions:[]}}:
  url.includes('agent-identities')?{items:[identity()],nextCursor:null}:url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:waiting}:{items:[waiting],nextCursor:null}));
 act(paint);
 await flush();
 await click(getByText(host,'核对邮件'));
 await click(getByRole(document.body,'button',{name:'补充资料',exact:true}));
 const dialog=getByRole(document.body,'dialog',{name:'补充资料'});
 expect(queryByRole(dialog,'textbox')).toBeNull();
 const submit=getByRole(dialog,'button',{name:'提交答复'}) as HTMLButtonElement;
 expect(submit.disabled).toBe(true);
 await click(getByRole(dialog,'button',{name:choice,exact:true}));
 expect(seam.api.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 await click(submit);
 const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');
 expect(writes).toHaveLength(1);
 expect(JSON.parse(writes[0][1].body)).toMatchObject({version:3,questionId:'question',answer:choice});
});

it('freezes an uncertain owner answer and retries the same question and request',async()=>{
 const question={id:'question',question:'请补充书面确认依据。',askedAt:'2026-11-01T00:10:00Z'},waiting={...row(),state:'waiting_human',questions:[question]};let first:any=null;
 seam.api.mockImplementation((url:string,init:any)=>{if(init?.method==='POST'){if(!first){first=JSON.parse(init.body);return Promise.reject(new Error('网络中断'));}return Promise.resolve({item:{...waiting,state:'queued'}});}return Promise.resolve(url.includes('agent-identities')?{items:[identity()],nextCursor:null}:url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:waiting}:{items:[waiting],nextCursor:null});});
 act(paint);await flush();await click(getByText(host,'核对邮件'));await click(getByRole(document.body,'button',{name:'补充资料',exact:true}));await act(async()=>fireEvent.input(getByLabelText(document.body,/答复/,{selector:'textarea'}),{target:{value:'保留原值，等待书面依据。'}}));await click(getByRole(document.body,'button',{name:'提交答复'}));
 expect((getByLabelText(document.body,/答复/,{selector:'textarea'}) as HTMLTextAreaElement).disabled).toBe(true);await click(getByRole(document.body,'button',{name:'核对原操作'}));const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(2);expect(JSON.parse(writes[1][1].body)).toEqual(first);
});
it.each([false,true])('checks the exact receipt for an attachment answer and retries only an absent receipt (%s)',async missing=>{
 const question={id:'question',question:'请补交书面确认依据。',askedAt:'2026-11-01T00:10:00Z'};
 const stored={id:'attachment',name:'确认.txt',mimeType:'text/plain',size:9};
 const waiting={...row(),state:'waiting_human',questions:[question],canSupplementAttachments:true};
 const answered={...waiting,state:'queued',version:4,attachments:[stored],questions:[{...question,answeredAt:'2026-11-01T00:20:00Z',attachmentIds:[stored.id]}]};
 let current=waiting,requestId='',posts=0;
 seam.api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.includes('/answer/receipt/')){
   expect(url).toMatch(new RegExp('/task/answer/receipt/'+requestId+'$'));
   if(missing)throw Object.assign(new Error('Not found'),{status:404});
   current=answered;
   return {item:answered,attachmentIds:[stored.id]};
  }
  if(init?.method==='POST'){
   expect(url).toMatch(/\/task\/answer$/);
   expect(init.body).toBeInstanceOf(FormData);
   const body=init.body as FormData;
   const answer=JSON.parse(String(body.get('answer')));
   expect(answer).toMatchObject({version:3,questionId:'question',answer:''});
   expect((body.get('attachments') as File).name).toBe(stored.name);
   if(++posts===1){requestId=answer.requestId;throw new Error('网络中断');}
   expect(answer.requestId).toBe(requestId);
   current=answered;
   return {item:answered};
  }
  if(url.includes('agent-identities'))return {items:[identity()],nextCursor:null};
  if(url.includes('/history'))return {items:[],nextCursor:null};
  if(url.endsWith('/task'))return {item:current};
  return {items:[current],nextCursor:null};
 });
 act(paint);await flush();
 await click(getByText(host,'核对邮件'));
 await click(getByRole(document.body,'button',{name:'补充资料',exact:true}));
 const dialog=getByRole(document.body,'dialog',{name:'补充资料'});
 expect(getByRole(dialog,'button',{name:'添加附件'})).toBeTruthy();
 await act(async()=>fireEvent.change(dialog.querySelector('input[type="file"]')!,{target:{files:[new File(['synthetic'],stored.name,{type:stored.mimeType})]}}));
 await click(getByRole(dialog,'button',{name:'提交答复'}));
 expect((getByRole(dialog,'button',{name:'添加附件'}) as HTMLButtonElement).disabled).toBe(true);
 await click(getByRole(dialog,'button',{name:'核对原操作'}));
 expect(posts).toBe(1);
 if(missing){
  expect(getByRole(dialog,'button',{name:'移除附件 确认.txt'})).toBeTruthy();
  await click(getByRole(dialog,'button',{name:'提交答复'}));
  expect(posts).toBe(2);
 }
 expect(queryByRole(document.body,'dialog',{name:'补充资料'})).toBeNull();
 expect(getByRole(document.body,'button',{name:'确认.txt'})).toBeTruthy();
});
it.each([false,true])('reopens an unconfirmed attachment receipt without file bytes (%s)',async missing=>{
 const scope='supplement-reload';
 const question={id:'question',question:'请补交书面确认依据。',askedAt:'2026-11-01T00:10:00Z'};
 const stored={id:'attachment',name:'确认.txt',mimeType:'text/plain',size:9};
 const waiting={...row(),state:'waiting_human',questions:[question],canSupplementAttachments:true};
 const answered={...waiting,state:'queued',version:4,attachments:[stored],questions:[{...question,answeredAt:'2026-11-01T00:20:00Z',attachmentIds:[stored.id]}]};
 const mount=()=>root.render(<MistRoot><ToastProvider><AssistantConversationProvider scope="A:workspace" controlStorageScope={scope}><AgentTasks onConnections={()=>{}}/></AssistantConversationProvider></ToastProvider></MistRoot>);
 const openAnswer=async()=>{
  await click(getByText(host,'核对邮件'));
  await click(getByRole(document.body,'button',{name:'补充资料',exact:true}));
  return getByRole(document.body,'dialog',{name:'补充资料'});
 };
 const select=async(dialog:HTMLElement)=>{
  const file=Object.assign(new File(['synthetic'],stored.name,{type:stored.mimeType}),{
   arrayBuffer:async()=>new TextEncoder().encode('synthetic').buffer,
  });
  await act(async()=>fireEvent.change(dialog.querySelector('input[type="file"]')!,{target:{files:[file]}}));
 };
 let current=waiting,requestId='',posts=0,checks=0;
 vi.stubGlobal('crypto',webcrypto);
 try{
  seam.api.mockImplementation(async(url:string,init?:RequestInit)=>{
   if(url.includes('/answer/receipt/')){
    checks++;
    expect(url).toBe('/api/mist/workspaces/workspace/agent-tasks/task/answer/receipt/'+requestId);
    if(missing)throw Object.assign(new Error('Not found'),{status:404});
    current=answered;
    return {item:answered,attachmentIds:[stored.id]};
   }
   if(init?.method==='POST'){
    const answer=JSON.parse(String((init.body as FormData).get('answer')));
    expect(readTaskControls(scope).get('task')).toEqual(expect.objectContaining({
     action:'answer',requestId:answer.requestId,version:3,questionId:question.id,hasAttachments:true,fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(sessionStorage.getItem('mist.xiaozhu.controls:'+scope)).not.toMatch(/synthetic|确认.txt|"answer":/);
    if(++posts===1){requestId=answer.requestId;throw new Error('网络中断');}
    expect(answer.requestId).toBe(requestId);
    current=answered;
    return {item:answered};
   }
   if(url.includes('agent-identities'))return {items:[identity()],nextCursor:null};
   if(url.includes('/history'))return {items:[],nextCursor:null};
   if(url.endsWith('/task'))return {item:current};
   return {items:[current],nextCursor:null};
  });
  act(mount);await flush();
  const first=await openAnswer();
  await select(first);
  await click(getByRole(first,'button',{name:'提交答复'}));
  await act(async()=>waitFor(()=>expect(posts).toBe(1)));
  act(()=>root.render(null));act(mount);await flush();
  const reopened=await openAnswer();
  expect((getByRole(reopened,'button',{name:'添加附件'}) as HTMLButtonElement).disabled).toBe(true);
  await click(getByRole(reopened,'button',{name:'核对原操作'}));
  expect(posts).toBe(1);
  expect(checks).toBe(1);
  if(missing){
   expect(readTaskControls(scope).get('task')?.requestId).toBe(requestId);
   expect((getByRole(reopened,'button',{name:'提交答复'}) as HTMLButtonElement).disabled).toBe(true);
   await select(reopened);
   await click(getByRole(reopened,'button',{name:'提交答复'}));
   await act(async()=>waitFor(()=>expect(posts).toBe(2)));
  }
  expect(readTaskControls(scope).has('task')).toBe(false);
  expect(queryByRole(document.body,'dialog',{name:'补充资料'})).toBeNull();
  expect(getByRole(document.body,'button',{name:'确认.txt'})).toBeTruthy();
 }finally{
  vi.unstubAllGlobals();
  sessionStorage.removeItem('mist.xiaozhu.controls:'+scope);
 }
});
it('creates an explicit platform task without issuing any external credential',async()=>{
 seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(url.endsWith('/agent-task-capabilities')?{platformAvailable:true}:init?.method==='POST'?{item:{...row(),executor:'platform'}}:url.includes('agent-identities')?{items:[identity()],nextCursor:null}:{items:[],nextCursor:null}));
 act(paint);await flush();await click(getByRole(host,'button',{name:'新建任务'}));await act(async()=>{fireEvent.change(getByLabelText(document.body,/执行方式/,{selector:'select'}),{target:{value:'platform'}});fireEvent.change(getByLabelText(document.body,/Agent连接/,{selector:'select'}),{target:{value:'identity'}});fireEvent.input(getByLabelText(document.body,/任务名称/,{selector:'input'}),{target:{value:'核对来信'}});fireEvent.input(getByLabelText(document.body,/任务内容/,{selector:'textarea'}),{target:{value:'核对原来信，缺资料先问本人。'}});});
 await click(getByRole(document.body,'button',{name:'安排任务',exact:true}));const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);expect(JSON.parse(writes[0][1].body)).toMatchObject({executor:'platform',locale:'zh-CN'});expect(writes[0][0]).toMatch(/\/agent-tasks$/);
});
it('does not offer a platform task as ready when the runtime is unavailable, while retaining external creation',async()=>{
 act(paint);await flush();await click(getByRole(host,'button',{name:'新建任务'}));await act(async()=>fireEvent.change(getByLabelText(document.body,/执行方式/,{selector:'select'}),{target:{value:'platform'}}));expect(getByText(document.body,'平台执行暂不可用')).toBeTruthy();expect((getByRole(document.body,'button',{name:'安排任务',exact:true}) as HTMLButtonElement).disabled).toBe(true);
});
it('links verified report references and records the drawer route before leaving a task opened from the list', async () => {
 const report={...row(),state:'succeeded',result:'核对 SO-1200、PO-1200、SO-8888、重复编号。',canControl:false,
  trail:[
   {kind:'read',ref:{type:'order',id:'order-id',label:'SO-1200',view:'orders/detail'}},
   {kind:'read',refs:[
    {type:'purchase',id:'purchase-id',label:'PO-1200',view:'procurement',section:'supplies'},
    {type:'order',id:'a',label:'重复编号',view:'orders/detail'},
    {type:'order',id:'b',label:'重复编号',view:'orders/detail'},
   ]},
   {kind:'read',failed:true,ref:{type:'order',id:'failed',label:'SO-8888',view:'orders/detail'}},
  ]};
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:report}
  :url.includes('agent-identities')?{items:[identity()]}:url.includes('/history')?{items:[],nextCursor:null}:{items:[report],nextCursor:null}));
 act(paint);await flush();await click(getByText(host,report.name));
 const dialog=getByRole(document.body,'dialog',{name:report.name});
 expect(queryByRole(dialog,'button',{name:'重复编号'})).toBeNull();
 expect(queryByRole(dialog,'button',{name:'SO-8888'})).toBeNull();
 expect(getByRole(dialog,'button',{name:'SO-1200'})).toBeTruthy();
 await click(getByRole(dialog,'button',{name:'PO-1200'}));
 expect(seam.go.mock.calls).toEqual([
  ['assistant','task',{section:'tasks'}],
  ['procurement','purchase-id',{section:'supplies'}],
 ]);
});

it('closes a routed report when browser history returns to the task list', async () => {
 const report={...row(),state:'succeeded',result:'已核对',canControl:false};
 seam.routeId=report.id;
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:report}
  :url.includes('agent-identities')?{items:[identity()]}:url.endsWith('/history')?{items:[],nextCursor:null}:{items:[report],nextCursor:null}));
 act(paint);await flush();
 expect(getByRole(document.body,'dialog',{name:report.name})).toBeTruthy();
 seam.routeId='';
 act(paint);await flush();
 expect(queryByRole(document.body,'dialog',{name:report.name})).toBeNull();
 expect(seam.go).not.toHaveBeenCalled();
});

it('restores the exact repeated report citation only for the same session and report version', async () => {
 const report={...row(),state:'succeeded',result:'起始 SO-1200。末段 SO-1200。',canControl:false,
  trail:[{kind:'read',ref:{type:'order',id:'order-id',label:'SO-1200',view:'orders/detail'}}]};
 const saved={view:'assistant' as const,scope:seam.identity+':workspace',taskId:report.id,
  version:report.version,updatedAt:report.updatedAt,citation:1,offset:30};
 seam.routeId=report.id;
 seam.sourcePosition={...saved,scope:'other-session:workspace'};
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:report}
  :url.includes('agent-identities')?{items:[identity()]}:url.endsWith('/history')?{items:[],nextCursor:null}:{items:[report],nextCursor:null}));
 const nextFrame=()=>act(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));});
 try {
  act(paint);await flush();await nextFrame();
  const dialog=getByRole(document.body,'dialog',{name:report.name});
  const citations=[...dialog.querySelectorAll('button.mist-xz-ref')];
  expect(citations).toHaveLength(2);
  expect(citations).not.toContain(document.activeElement);
  seam.sourcePosition={...saved,version:report.version-1};
  act(paint);await nextFrame();
  expect(citations).not.toContain(document.activeElement);
  seam.sourcePosition=saved;
  act(paint);await nextFrame();
  expect(document.activeElement).toBe(citations[1]);
 } finally {
  seam.sourcePosition=undefined;
 }
});

it('opens the exact attachment source version from a formatted task report',async()=>{
 const finished={...row(),state:'succeeded',result:'[来源版本](bambook://open?view=development/detail&id=dev&versionId=old)\n\n| 规格 | 数量 |\n| --- | --- |\n| A | 1200 |',canControl:false};
 seam.routeId='task';seam.api.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/task')?{item:finished}:url.includes('/history')?{items:[],nextCursor:null}:url.includes('agent-identities')?{items:[identity()]}:{items:[finished],nextCursor:null}));
 act(paint);await flush();expect(document.querySelector('p table')).toBeNull();await click(getByRole(document.body,'button',{name:'来源版本'}));expect(seam.go).toHaveBeenCalledWith('development/detail','dev',{versionId:'old'});
});

it('reports an unread task list and shows an empty state only after a successful refresh', async () => {
  let inaccessible = true;
  seam.api.mockImplementation(async (url: string) => {
    if (url.endsWith('/agent-tasks') && inaccessible) throw new Error('暂时无法读取');
    return { items: [], nextCursor: null };
  });
  act(paint);
  await flush();
  expect(getByText(host, '任务读取失败')).toBeTruthy();
  expect(host.textContent).not.toContain('暂无可用的Agent连接');
  inaccessible = false;
  await click(getByRole(host, 'button', { name: '刷新' }));
  expect(getByText(host, '暂无可用的Agent连接')).toBeTruthy();
  expect(host.textContent).not.toContain('任务读取失败');
});
