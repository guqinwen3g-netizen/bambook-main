// @vitest-environment jsdom
import React,{act} from 'react';
import {webcrypto} from 'node:crypto';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>vi.fn());
vi.mock('./workspace',()=>({mistApiRequest:(...args:any[])=>api(...args)}));
import {useXiaozhuCowork} from './xiaozhuCowork';
import {readTaskControls,saveTaskControls} from './xiaozhuControlRequests';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,host:HTMLElement,channel:ReturnType<typeof useXiaozhuCowork>;
const task={id:'task',identityId:'identity',executor:'platform',state:'succeeded',instructions:'原业务核对',result:'已完成',createdAt:'2026-11-17T04:00:00Z',updatedAt:'2026-11-17T04:01:00Z'};
const loaded=async(url:string)=>url.includes('/agent-identities')?{items:[{id:'identity',kind:'personal',state:'active'}]}:url.includes('/agent-task-capabilities')?{platformAvailable:true}:{items:[task],nextCursor:null};
function View({workspace='workspace',conversationId}:{workspace?:string;conversationId?:string}){channel=useXiaozhuCowork(workspace,'account:'+workspace,true,conversationId);return <div>{channel.tasks.length}</div>}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();api.mockReset();});

it('looks up the visible paused task on focus even when the model is unavailable',async()=>{
 const paused={...task,id:'visible-paused',state:'paused',conversationId:'c_focus',version:5,result:''};
 const offscreen={...paused,id:'offscreen-paused',conversationId:'c_other'};
 let complete:(value:unknown)=>void=()=>{};
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/agent-tasks'))return {items:[paused,offscreen],nextCursor:null};
  if(url.endsWith('/agent-task-capabilities'))return {platformAvailable:false};
  if(url.endsWith('/agent-tasks/visible-paused'))return new Promise(resolve=>{complete=resolve;});
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId="c_focus"/>));
 expect(api.mock.calls.filter(([url])=>url.endsWith('/agent-tasks/visible-paused'))).toHaveLength(0);
 await act(async()=>{
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('focus'));
 });
 expect(api.mock.calls.filter(([url])=>url.endsWith('/agent-tasks/visible-paused'))).toHaveLength(1);
 expect(api.mock.calls.some(([url])=>url.endsWith('/agent-tasks/offscreen-paused'))).toBe(false);
 await act(async()=>complete({item:{...paused,state:'succeeded',version:6,result:'另一窗口续办后的报告'}}));
 expect(channel.tasks.find(item=>item.id===paused.id)).toMatchObject({state:'succeeded',result:'另一窗口续办后的报告'});
});

it('keeps the other progress read in flight when a concurrent task finishes',async()=>{
 const first={...task,id:'first',conversationId:'c_first',state:'running',version:2,executionStage:'model'};
 const second={...first,id:'second',conversationId:'c_second'};
 const reads=new Map<string,{resolve:(value:unknown)=>void;signal:AbortSignal}[]>();
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/agent-tasks'))return {items:[first,second],nextCursor:null};
  const id=url.split('/').at(-1)!;
  if(id==='first'||id==='second'){
   return new Promise(resolve=>{
    const calls=reads.get(id)??[];
    calls.push({resolve,signal:init!.signal!});
    reads.set(id,calls);
   });
  }
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId="c_first"/>));
 const waiting=reads.get('second')![0];
 await act(async()=>reads.get('first')![0].resolve({item:{...first,version:3,state:'succeeded',result:'第一份报告'}}));
 expect(channel.tasks.find(item=>item.id==='first')?.result).toBe('第一份报告');
 expect(waiting.signal.aborted).toBe(false);
 expect(reads.get('second')).toHaveLength(1);
 await act(async()=>waiting.resolve({item:{...second,version:3,state:'succeeded',result:'第二份报告'}}));
 expect(channel.tasks.find(item=>item.id==='second')?.result).toBe('第二份报告');
 expect(channel.staleProgressIds?.has('second')).toBeFalsy();
});

it('gives the visible task a read while background tasks fill a bounded, fair queue',async()=>{
 const first={...task,id:'visible',conversationId:'c_visible',state:'running',version:2,executionStage:'model'};
 const background=Array.from({length:6},(_,index)=>({...first,id:'background-'+index,conversationId:'c_background_'+index}));
 const all=[first,...background], reads=new Map<string,(result:unknown)=>void>(),order:string[]=[];
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/agent-tasks'))return {items:all,nextCursor:null};
  const id=url.split('/').at(-1)!;
  if(all.some(item=>item.id===id))return new Promise(resolve=>{order.push(id);reads.set(id,resolve);});
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId="c_visible"/>));
 expect(order).toEqual(['visible','background-0','background-1','background-2']);
 for(let index=0;index<3;index++){
  const current=background[index];
  await act(async()=>reads.get(current.id)!({item:{...current,version:3}}));
  expect(order.at(-1)).toBe(background[index+3].id);
 }
 expect(order.filter(id=>id==='visible')).toHaveLength(1);
 expect(order.slice(1)).toEqual(background.map(item=>item.id));
});

it('shares an active progress request with origin navigation and preserves it if navigation cancels',async()=>{
 const pending={...task,state:'running',version:2,conversationId:'c_origin'};
 const reads:{resolve:(result:unknown)=>void;signal:AbortSignal}[]=[];
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/agent-tasks'))return{items:[pending],nextCursor:null};
  if(url.endsWith('/agent-tasks/task'))return new Promise(resolve=>reads.push({resolve,signal:init!.signal!}));
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 const original=reads[0],cancelled=new AbortController(),attached=new AbortController();
 const first=channel.refreshTask('task',cancelled.signal,{retainOrigin:true}).catch(error=>error);
 const remaining=channel.refreshTask('task',attached.signal,{retainOrigin:true});
 expect(reads).toHaveLength(1);
 cancelled.abort();
 expect((await first).name).toBe('AbortError');
 expect(original.signal.aborted).toBe(false);
 const done={...pending,state:'succeeded',version:3,result:'同一请求返回报告'};
 await act(async()=>{
  original.resolve({item:done});
  expect(await remaining).toMatchObject({id:task.id,result:done.result});
 });
 expect(channel.tasks[0]).toMatchObject({state:'succeeded',result:done.result});
 expect(reads).toHaveLength(1);
});

it('rechecks a stale task directly and coalesces concurrent progress reads',async()=>{
 const waiting={...task,state:'running',executionStage:'model',version:2,canControl:true};
 const finished={...waiting,state:'succeeded',version:3,result:'已恢复原报告'};
 let resolveRead:(item:unknown)=>void=()=>{};
 let available=false;
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/agent-tasks/task')){
   if(!available)throw Error('进度读取暂不可用');
   return new Promise(resolve=>{resolveRead=resolve;});
  }
  if(url.endsWith('/agent-tasks'))return {items:[waiting],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 expect(channel.staleProgressIds?.has('task')).toBe(true);
 api.mockClear();available=true;
 await act(async()=>{
  const first=channel.recheckProgress('task'),second=channel.recheckProgress('task');
  resolveRead({item:finished});
  await Promise.all([first,second]);
 });
 expect(channel.tasks[0]).toMatchObject({state:'succeeded',version:3,result:'已恢复原报告'});
 expect(channel.staleProgressIds?.has('task')).toBeFalsy();
 expect(api.mock.calls.map(([url])=>url)).toEqual(['/api/mist/workspaces/workspace/agent-tasks/task']);
});

it('allows a direct progress read while model execution is unavailable',async()=>{
 const running={...task,state:'running',executionStage:'model',version:2,canControl:true};
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/agent-task-capabilities'))return {platformAvailable:false};
  if(url.endsWith('/agent-tasks/task'))return {item:{...running,state:'succeeded',version:3,result:'已读回原报告'}};
  if(url.endsWith('/agent-tasks'))return {items:[running],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 expect(channel.available).toBe(false);
 expect(channel.tasks[0].state).toBe('running');
 expect(api.mock.calls.some(([url])=>url.endsWith('/agent-tasks/task'))).toBe(false);
 api.mockClear();
 await act(async()=>{await channel.recheckProgress('task');});
 expect(api.mock.calls.map(([url])=>url)).toEqual(['/api/mist/workspaces/workspace/agent-tasks/task']);
 expect(channel.tasks[0]).toMatchObject({state:'succeeded',result:'已读回原报告'});
});

it('resumes the same paused task and recovers its lost receipt by reading that task',async()=>{
 const paused={...task,state:'paused',version:5,canControl:true};
 const resumed={...paused,state:'queued',version:6};
 let resumedOnServer=false;
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/task/resume')){resumedOnServer=true;throw Object.assign(new Error('回执未收到'),{status:0});}
  if(url.endsWith('/agent-tasks/task'))return {item:resumedOnServer?resumed:paused};
  if(url.endsWith('/agent-tasks'))return {items:[paused],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 await act(async()=>{await channel.resume(channel.tasks[0]);});
 expect(channel.tasks[0]).toMatchObject({id:'task',state:'queued',version:6});
 expect(channel.controls.task?.error).toBeFalsy();
 const writes=api.mock.calls.filter(([,init])=>init?.method==='POST');
 expect(writes).toHaveLength(1);
 expect(writes[0][0]).toMatch(/\/agent-tasks\/task\/resume$/);
 expect(JSON.parse(writes[0][1].body)).toMatchObject({version:5,requestId:expect.any(String)});
});

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

it('abandons a report permission check on disconnect and rechecks immediately after reconnect',async()=>{
 const conversationId='c_reconnected_access';
 const report={...task,conversationId,result:'原报告内容'};
 const pending=Promise.withResolvers<{restrictedIds:string[]}>();
 let online=true,checks=0;
 const signals:AbortSignal[]=[];
 const connectivity=vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.includes('/personal-agent/task-access?')){
   signals.push(init!.signal!);
   return ++checks===1?pending.promise:{restrictedIds:[report.id]};
  }
  if(url.endsWith('/agent-tasks'))return {items:[report],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 try{
  await act(async()=>root!.render(<View conversationId={conversationId}/>));
  expect(checks).toBe(1);
  online=false;
  await act(async()=>window.dispatchEvent(new Event('offline')));
  expect(signals[0].aborted).toBe(true);
  await act(async()=>window.dispatchEvent(new Event('focus')));
  expect(checks).toBe(1);
  online=true;
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(checks).toBe(2);
  expect(channel.tasks[0]).toMatchObject({contentRestricted:true,result:''});
  await act(async()=>pending.resolve({restrictedIds:[]}));
  expect(channel.tasks[0]).toMatchObject({contentRestricted:true,result:''});
 } finally { connectivity.mockRestore(); }
});

it('applies a completed permission batch while another batch is still pending',async()=>{
 const conversationId='c_long_access';
 const reports=Array.from({length:31},(_,index)=>({...task,id:'long-report-'+index,conversationId,result:'报告 '+index}));
 const denied=reports.at(-1)!;
 const slow=Promise.withResolvers<{restrictedIds:string[]}>();
 const requests:string[][]=[];
 api.mockImplementation(async(url:string)=>{
  if(url.includes('/personal-agent/task-access?')){
   const ids=new URL(url,'https://example.test').searchParams.get('taskIds')!.split(',');
   requests.push(ids);
   return ids.includes(denied.id)?{restrictedIds:[denied.id]}:slow.promise;
  }
  if(url.endsWith('/agent-tasks'))return {items:reports,nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId={conversationId}/>));
 expect(requests.map(ids=>ids.length)).toEqual([30,1]);
 expect(channel.tasks.find(item=>item.id===denied.id)).toMatchObject({contentRestricted:true,result:''});
 expect(channel.tasks.find(item=>item.id===reports[0].id)?.result).toBe(reports[0].result);
 await act(async()=>slow.resolve({restrictedIds:[]}));
 expect(channel.tasks.find(item=>item.id===denied.id)).toMatchObject({contentRestricted:true,result:''});
});

it('does not restore reports after another permission batch denies the workspace',async()=>{
 const conversationId='c_access_denied';
 const reports=Array.from({length:31},(_,index)=>({...task,id:'denied-'+index,conversationId}));
 const denied=Promise.withResolvers<{restrictedIds:string[]}>();
 let mask=true,fullReads=0;
 api.mockImplementation(async(url:string)=>{
  if(url.includes('/personal-agent/task-access?')){
   const ids=new URL(url,'https://example.test').searchParams.get('taskIds')!.split(',');
   if(mask)return {restrictedIds:ids};
   return ids.length===30?{restrictedIds:[]}:denied.promise;
  }
  if(url.endsWith('/agent-tasks'))return {items:reports,nextCursor:null};
  if(url.includes('/agent-tasks/'))fullReads++;
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId={conversationId}/>));
 expect(channel.tasks.every(item=>item.contentRestricted)).toBe(true);
 mask=false;
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(fullReads).toBe(0);
 await act(async()=>denied.reject(Object.assign(new Error('Denied'),{status:403})));
 expect(channel.tasks.every(item=>item.contentRestricted&&!item.result)).toBe(true);
 expect(fullReads).toBe(0);
});

it('restores each authorized report immediately and rotates reports not yet rechecked',async()=>{
 const conversationId='c_restore_many';
 const reports=Array.from({length:6},(_,index)=>({...task,id:'report-'+index,conversationId,result:'原报告 '+index}));
 const requests=new Map<string,(value:unknown)=>void>(),order:string[]=[];
 let restricted=true;
 api.mockImplementation(async(url:string)=>{
  if(url.includes('/personal-agent/task-access?'))return {restrictedIds:restricted?reports.map(item=>item.id):[]};
  if(url.endsWith('/agent-tasks'))return {items:reports,nextCursor:null};
  const id=url.split('/').at(-1)!;
  if(reports.some(item=>item.id===id))return new Promise(resolve=>{order.push(id);requests.set(id,resolve);});
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId={conversationId}/>));
 expect(channel.tasks.every(item=>item.contentRestricted)).toBe(true);
 restricted=false;
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(order).toEqual(reports.slice(0,4).map(item=>item.id));
 await act(async()=>requests.get(reports[0].id)!({item:reports[0]}));
 expect(channel.tasks.find(item=>item.id===reports[0].id)?.result).toBe(reports[0].result);
 expect(channel.tasks.find(item=>item.id===reports[1].id)?.contentRestricted).toBe(true);
 await act(async()=>{
  for(const item of reports.slice(1,4))requests.get(item.id)!({item:{...item,contentRestricted:true,result:''}});
 });
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(order.slice(4,6)).toEqual(reports.slice(4).map(item=>item.id));
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

it('checks an unconfirmed stop by reading the same task without sending another stop',async()=>{
 const waiting={...task,state:'waiting_time',version:2,canControl:true};
 const stopped={...waiting,state:'cancelled',version:3,canControl:false};
 let stopSent=false,readable=false,settled=false;
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/task/cancel')){
   stopSent=true;
   throw Object.assign(new Error('停止回执未送达'),{status:0});
  }
  if(url.endsWith('/task')){
   if(stopSent&&!readable)throw new Error('任务读取暂不可用');
   return {item:settled?stopped:waiting};
  }
  if(url.endsWith('/agent-tasks'))return {items:[waiting],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 await act(async()=>{await channel.cancel(channel.tasks[0]);});
 expect(channel.controls.task).toMatchObject({canCheckStop:true,error:'停止结果未确认，可重试'});
 readable=true;
 await act(async()=>{await channel.checkStop(channel.tasks[0]);});
 expect(channel.tasks[0]).toMatchObject({state:'waiting_time',version:2});
 expect(channel.controls.task).toMatchObject({canCheckStop:true,error:'停止结果未确认，可重试'});
 settled=true;
 await act(async()=>{await channel.checkStop(channel.tasks[0]);});
 expect(channel.tasks[0]).toMatchObject({state:'cancelled',version:3});
 expect(channel.controls.task?.canCheckStop).toBeFalsy();
 expect(channel.controls.task?.error).toBeFalsy();
 expect(api.mock.calls.filter(([url])=>url.endsWith('/task/cancel'))).toHaveLength(1);
 expect(api.mock.calls.filter(([url])=>url.endsWith('/agent-tasks'))).toHaveLength(1);
});

it('reads the original submitted answer after a lost receipt without sending a new answer',async()=>{
 const asking={...task,state:'waiting_human',version:2,canControl:true,questions:[{id:'q1',question:'请给出交期'}]};
 const answered={...asking,state:'queued',version:3,questions:[{...asking.questions[0],answer:'1 月 18 日',answeredAt:task.updatedAt}]};
 let sent=false,readable=false;
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/task/answer')){sent=true;throw Object.assign(new Error('回执断开'),{status:0});}
  if(url.endsWith('/task')){
   if(sent&&!readable)throw new Error('任务暂不可读');
   return {item:sent?answered:asking};
  }
  if(url.endsWith('/agent-tasks'))return {items:[asking],nextCursor:null};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View/>));
 await act(async()=>{await channel.answer(channel.tasks[0],'q1','1 月 18 日');});
 expect(channel.controls.task).toMatchObject({answerQuestionToCheck:'q1',error:'回答未确认，可重试'});
 const before=api.mock.calls.length;
 await act(async()=>{await channel.checkAnswer(channel.tasks[0],'q-other');});
 expect(api.mock.calls).toHaveLength(before);
 readable=true;
 await act(async()=>{await channel.checkAnswer(channel.tasks[0],'q1');});
 expect(channel.tasks[0].questions).toEqual(answered.questions);
 expect(channel.controls.task?.answerQuestionToCheck).toBeUndefined();
 expect(channel.controls.task?.error).toBeFalsy();
 expect(api.mock.calls.filter(([url])=>url.endsWith('/task/answer'))).toHaveLength(1);
});

it.each([true,false])('checks the exact uploaded answer receipt after a lost response (%s)',async committed=>{
 const original={...task,id:'task',conversationId:'c_attachment_answer',state:'waiting_human',version:2,canControl:true,
  questions:[{id:'q1',question:'请补充原件。'}]};
 const supplied={id:'file-supplement',name:'quote.txt',mimeType:'text/plain',size:3};
 const other={...supplied,id:'file-other'};
 const answered={...original,state:'succeeded',version:3,attachments:[committed?supplied:other],
  questions:[{id:'q1',question:'请补充原件。',answer:'附件见本轮。',answeredAt:'2026-11-17T04:02:00Z'}]};
 let submitted='';
 const file=new File(['abc'],'quote.txt',{type:'text/plain'});
 Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode('abc').buffer});
 const notified=vi.fn();
 window.addEventListener('bambook:agent-task-update',notified);
 vi.stubGlobal('crypto',webcrypto);
 try{
  api.mockImplementation(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('/agent-tasks'))return {items:[original],nextCursor:null};
   if(url.endsWith('/answer')&&init?.method==='POST'){
    expect(init.body).toBeInstanceOf(FormData);
    const form=init.body as FormData;
    expect((form.get('attachments') as File).name).toBe(supplied.name);
    const payload=JSON.parse(String(form.get('answer')));
    expect(payload).toMatchObject({questionId:'q1',answer:'附件见本轮。'});
    submitted=payload.requestId;
    throw Object.assign(new Error('连接中断'),{status:0});
   }
   if(url.includes('/answer/receipt/')){
    expect(url.endsWith(submitted)).toBe(true);
    if(!committed)throw Object.assign(new Error('无原始回执'),{status:404});
    return {item:answered,attachmentIds:[supplied.id]};
   }
   if(url.endsWith('/agent-tasks/task'))return {item:submitted?answered:original};
   if(url.includes('/personal-agent/task-access?'))return {restrictedIds:[]};
   return loaded(url);
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<View conversationId={original.conversationId}/>));
  await act(async()=>{await channel.answer(channel.tasks[0], 'q1','附件见本轮。',[file]);});
  expect(api.mock.calls.filter(([url])=>url.includes('/answer/receipt/'))).toHaveLength(1);
  expect(api.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  expect(channel.tasks[0].attachments).toEqual([committed?supplied:other]);
  expect(notified).toHaveBeenCalledTimes(committed?1:0);
 }finally{
  window.removeEventListener('bambook:agent-task-update',notified);
  vi.unstubAllGlobals();
 }
});

it('keeps the same upload request id on a byte-identical retry and changes it for a different file',async()=>{
 const waiting={...task,state:'waiting_human',version:2,canControl:true,questions:[{id:'q1',question:'请补交文件。'}]};
 const requests:string[]=[];
 const attachment=(bytes:string)=>{
  const file=new File([bytes],'quote.txt',{type:'text/plain'});
  Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(bytes).buffer});
  return file;
 };
 vi.stubGlobal('crypto',webcrypto);
 try{
  api.mockImplementation(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('/agent-tasks'))return {items:[waiting],nextCursor:null};
   if(url.endsWith('/answer')&&init?.method==='POST'){
    requests.push(JSON.parse(String((init.body as FormData).get('answer'))).requestId);
    throw Object.assign(new Error('连接中断'),{status:0});
   }
   if(url.includes('/answer/receipt/'))throw Object.assign(new Error('没有回执'),{status:404});
   if(url.endsWith('/agent-tasks/task'))return {item:waiting};
   return loaded(url);
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<View/>));
  for(const content of ['abc','abc','abd'])
   await act(async()=>{await channel.answer(channel.tasks[0],'q1','',[attachment(content)]);});
  expect(requests).toHaveLength(3);
  expect(requests[0]).toBe(requests[1]);
  expect(requests[2]).not.toBe(requests[0]);
 }finally{vi.unstubAllGlobals();}
});

it.each([true,false])('recovers a settled uploaded answer by its saved request after reload (%s)',async committed=>{
 const store='restored-attached-answer',requestId='00000000-0000-4000-8000-000000000052';
 saveTaskControls(store,new Map([['task',{action:'answer',questionId:'q1',version:2,requestId,
  fingerprint:'abc123'.padEnd(64,'0'),hasAttachments:true}]]));
 const saved=readTaskControls(store);
 const attachment={id:committed?'mine':'theirs',name:'quote.txt',mimeType:'text/plain',size:3};
 const latest={...task,version:3,canControl:false,attachments:[attachment],questions:[
  {id:'q1',question:'请补交原件。',answer:'附件见本轮。',answeredAt:'2026-11-17T04:02:00Z',attachmentIds:[attachment.id]},
 ]};
 function Restored(){
  channel=useXiaozhuCowork('workspace','account:workspace',true,undefined,undefined,saved,store);
  return <div/>;
 }
 api.mockImplementation(async(url:string)=>{
  if(url.endsWith('/agent-tasks'))return {items:[latest],nextCursor:null};
  if(url.includes('/answer/receipt/')){
   expect(url.endsWith(requestId)).toBe(true);
   if(!committed)throw Object.assign(new Error('没有原始回执'),{status:404});
   return {item:latest,attachmentIds:[attachment.id]};
  }
  return loaded(url);
 });
 try{
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<Restored/>));
  expect(api.mock.calls.filter(([url])=>url.includes('/answer/receipt/'))).toHaveLength(1);
  expect(api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
  expect(readTaskControls(store).size).toBe(0);
  expect(!!channel.controls.task?.attachmentAnswerRecovered).toBe(committed);
  expect(channel.tasks[0].attachments).toEqual([attachment]);
 }finally{saveTaskControls(store,new Map());}
});

it('keeps the exact answer request after a fresh page without storing the answer',async()=>{
 const storageScope='["test-operator","workspace"]';
 const asking={...task,state:'waiting_human',version:2,canControl:true,questions:[{id:'q1',question:'请给交期'}]};
 const answer='只在本轮提交的模拟答复';
 const resolved={...asking,state:'queued',version:3,questions:[{...asking.questions[0],answer,answeredAt:task.updatedAt}]};
 const posted:unknown[]=[];
 function DurableView({session}:{session:string}){
  const saved=React.useMemo(()=>readTaskControls(storageScope),[session]);
  channel=useXiaozhuCowork('workspace',session,true,undefined,undefined,saved,storageScope);
  return <div/>;
 }
 vi.stubGlobal('crypto',webcrypto);
 try{
  api.mockImplementation(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('/task/answer')){
    posted.push(JSON.parse(String(init?.body)));
    if(posted.length===1)throw Object.assign(new Error('回执断开'),{status:0});
    return {item:resolved};
   }
   if(url.endsWith('/task'))return {item:asking};
   if(url.endsWith('/agent-tasks'))return {items:[asking],nextCursor:null};
   return loaded(url);
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<DurableView key="first" session="first"/>));
  await act(async()=>{await channel.answer(channel.tasks[0],'q1',answer);});
  expect(readTaskControls(storageScope).get('task')).toMatchObject({action:'answer',questionId:'q1',fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(sessionStorage.getItem('mist.xiaozhu.controls:'+storageScope)).not.toContain(answer);
  expect(readTaskControls('["another-operator","workspace"]').size).toBe(0);
  await act(async()=>root!.render(<DurableView key="second" session="second"/>));
  expect(channel.controls.task?.answerQuestionToCheck).toBe('q1');
  await act(async()=>{await channel.answer(channel.tasks[0],'q1',answer);});
  expect(posted).toHaveLength(2);
  expect(posted[1]).toEqual(posted[0]);
  expect(readTaskControls(storageScope).size).toBe(0);
 }finally{
  sessionStorage.removeItem('mist.xiaozhu.controls:'+storageScope);
  vi.unstubAllGlobals();
 }
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
it('keeps an original task recovered while an older task-list request is pending',async()=>{
 const conversationId='c_recovered_during_list';
 const recovered={...task,id:'recovered',conversationId,version:2,result:'原报告已找回'};
 let requestId='',holdList=false,omitOld=false,releaseList:((value:unknown)=>void)|undefined;
 api.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST'&&url.endsWith('/personal-agent/tasks')){
   requestId=JSON.parse(String(init.body)).requestId;
   throw new Error('回执连接断开');
  }
  if(url.includes('/personal-agent/tasks/receipt/')){
   expect(url.endsWith(requestId)).toBe(true);
   return {item:recovered};
  }
  if(url.endsWith('/agent-tasks')){
   if(holdList)return new Promise(resolve=>{releaseList=resolve;});
   return {items:omitOld?[]:[task],nextCursor:null};
  }
  if(url.includes('/personal-agent/task-access?'))return {restrictedIds:[]};
  return loaded(url);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root!.render(<View conversationId={conversationId}/>));
 await act(async()=>{await channel.send('核对原问题',[],conversationId);});
 expect(channel.hasPendingSubmission).toBe(true);
 holdList=true;
 let loading:Promise<void>|undefined;
 await act(async()=>{loading=channel.reload();});
 expect(releaseList).toBeTypeOf('function');
 await act(async()=>window.dispatchEvent(new Event('online')));
 expect(channel.tasks.map(item=>item.id)).toContain(recovered.id);
 await act(async()=>{releaseList?.({items:[],nextCursor:null});await loading;});
 expect(channel.tasks.map(item=>item.id)).toEqual([recovered.id]);
 expect(channel.hasPendingSubmission).toBe(false);
 expect(api.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 holdList=false;omitOld=true;
 await act(async()=>channel.reload());
 expect(channel.tasks).toEqual([]);
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

it('checks the original task immediately when the browser reconnects during progress backoff', async () => {
  vi.useFakeTimers();
  const conversationId = 'conversation_reconnect';
  const running = { ...task, conversationId, state: 'running', version: 2, result: '' };
  const finished = { ...task, conversationId, version: 3 };
  let connected = false;
  const attempted = () => api.mock.calls.filter(([url]) => url.endsWith('/agent-tasks/task')).length;
  try {
    api.mockImplementation(async (url: string) => {
      if (url.includes('/personal-agent/task-access?')) return { restrictedIds: [] };
      if (url.endsWith('/agent-tasks')) return { items: [running], nextCursor: null };
      if (url.endsWith('/agent-tasks/task')) {
        if (!connected) throw new TypeError('Failed to fetch');
        return { item: finished };
      }
      return loaded(url);
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<View conversationId={conversationId} />));
    await act(async () => vi.advanceTimersByTimeAsync(7000));
    expect(attempted()).toBe(4);
    expect(channel.staleProgressIds?.has('task')).toBe(true);

    connected = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(attempted()).toBe(5);
    expect(channel.tasks[0]).toEqual(finished);
    expect(channel.staleProgressIds?.has('task') ?? false).toBe(false);
    expect(api.mock.calls.filter(([url]) => url.endsWith('/agent-tasks'))).toHaveLength(1);
    expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
