// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,queryByRole,getByLabelText} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {platformTrail} from '../../../../../server/src/mist/agentTaskTrail';
import {XiaozhuThread,dayLabel,type ThreadActions} from './XiaozhuThread';
let host:HTMLDivElement,root:Root;
const task=(over:any={})=>({id:'t1',instructions:'核对订单',state:'running',version:1,result:'',checkpoint:'',questions:[],waitingProposalIds:[],canControl:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...over}) as any;
const index=[{text:'SO-1001',view:'orders/detail',id:'o1'}];
const proposal=(over:any={})=>({id:'p1',state:'pending',command:{type:'email.move',payload:{}},summary:['归档邮件 PO 确认'],...over}) as any;
const fns=()=>({onAnswer:vi.fn(),onCancel:vi.fn(),onRetry:vi.fn(),onCopy:vi.fn(),onDraft:vi.fn(),onAutomate:vi.fn(),onOpenRecord:vi.fn(),onProposal:vi.fn()});
const paint=(tasks:any[],f:ReturnType<typeof fns>&Partial<ThreadActions>=fns(),proposals:any[]=[])=>act(async()=>root.render(<MistRoot><XiaozhuThread tasks={tasks} index={index} proposals={proposals} {...f}/></MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('offers explicit voice continuation only on eligible tasks and passes the selected task', async () => {
 const onVoiceTask=vi.fn();
 const first=task({id:'first',name:'核对交期',executor:'platform',conversationId:'c_order_review',state:'waiting_human',
  questions:[{id:'delivery-question',question:'请给交期',askedAt:'2026-11-26T01:00:00Z'}]});
 const second=task({id:'second',name:'核对数量',executor:'platform',conversationId:'c_order_review',state:'paused'});
 const done=task({id:'done',name:'已办完',executor:'platform',conversationId:'c_order_review',state:'succeeded'});
 const legacy=task({id:'legacy',name:'旧任务',executor:'platform'});
 await paint([first,second,done,legacy],{...fns(),onVoiceTask});
 expect(queryByRole(host,'button',{name:'语音接续 已办完'})).toBeNull();
 expect(queryByRole(host,'button',{name:'语音接续 旧任务'})).toBeNull();
 await act(async()=>getByRole(host,'button',{name:'语音接续 核对数量'}).click());
 expect(onVoiceTask).toHaveBeenCalledExactlyOnceWith(second,undefined);
 await act(async()=>getByRole(host,'button',{name:'语音接续 核对交期'}).click());
 expect(onVoiceTask).toHaveBeenLastCalledWith(first,'delivery-question');
});
it('keeps an unreceived confirmation in its original task and offers a read-only refresh',async()=>{
 const refresh=vi.fn();
 const f={...fns(),onRefreshProposals:refresh};
 const waiting=task({state:'waiting_human',waitingProposalIds:['p1']});
 await paint([waiting],f);
 expect(getByRole(host,'status').textContent).toBe('待我确认');
 expect(host.querySelector('.mist-xz-shimmer')).toBeNull();
 expect(queryByRole(host,'button',{name:'确认执行'})).toBeNull();
 await act(async()=>getByRole(host,'button',{name:'刷新待确认事项'}).click());
 expect(refresh).toHaveBeenCalledTimes(1);
 await paint([waiting],{...f,refreshingProposals:true});
 expect((getByRole(host,'button',{name:'刷新待确认事项'}) as HTMLButtonElement).disabled).toBe(true);
 await paint([waiting],f,[proposal()]);
 expect(queryByRole(host,'button',{name:'刷新待确认事项'})).toBeNull();
 await act(async()=>getByRole(host,'button',{name:'查看并确认'}).click());
 expect(f.onProposal).toHaveBeenCalledExactlyOnceWith('p1');
 await paint([task({state:'cancelled',waitingProposalIds:[]})],f);
 expect(queryByRole(host,'button',{name:'刷新待确认事项'})).toBeNull();
 expect(host.textContent).toContain('已停止');
});

it('summarizes confirmed sources while the model waits without counting repeated or failed reads',async()=>{
 const record={type:'order',id:'o1',label:'SO-1'};
 const completed={at:'',kind:'read' as const,label:'读取订单 SO-1',completed:true,ref:record};
 const file={...completed,label:'读取附件 报价.pdf',ref:undefined,taskAttachmentId:'pdf'};
 const waiting=task({executionStage:'model',trail:[
  completed,{...completed,ref:undefined,refs:[record,{type:'order',id:'o2',label:'SO-2'}]},
  file,{...file,detail:'读取第 21 至 23 页'},{...file,taskAttachmentId:'unavailable',failed:true},
  {...file,taskAttachmentId:'pending',completed:false},
 ]});
 await paint([waiting],{...fns(),workLog:{expanded:new Map([['t1',false]]),setExpanded:vi.fn()}});
 expect(getByRole(host,'status').textContent).toBe('正在等待模型');
 expect(host.textContent).toContain('已读取 2 条业务记录 · 已摘录 1 份附件');
 expect(host.querySelector('.mist-xz-steps')).toBeNull();
 await paint([waiting],{...fns(),staleProgressIds:new Set(['t1'])});
 expect(host.textContent).not.toContain('已读取 2 条业务记录');
 await paint([task({...waiting,state:'succeeded'})]);
 expect(host.textContent).not.toContain('已摘录 1 份附件');
});

it('offers a stop status check on the same task without invoking stop again',async()=>{
 const waiting=task({name:'原任务',state:'waiting_time'});
 const onCheckStop=vi.fn(),f=fns();
 await paint([waiting],{...f,onCheckStop,controls:{t1:{busy:false,canCheckStop:true,error:'停止结果未确认，可重试'}}});
 await act(async()=>getByRole(host,'button',{name:'核对停止结果',exact:true}).click());
 expect(onCheckStop).toHaveBeenCalledExactlyOnceWith(waiting);
 expect(f.onCancel).not.toHaveBeenCalled();
 await paint([task({name:'原任务',state:'cancelled'})],{...f,onCheckStop});
 expect(queryByRole(host,'button',{name:'核对停止结果'})).toBeNull();
});

it('checks the unanswered question without sending or clearing the current draft',async()=>{
 const waiting=task({state:'waiting_human',questions:[{id:'q1',question:'请给交期'}]});
 const onCheckAnswer=vi.fn(),f=fns(),write=vi.fn();
 await paint([waiting],{...f,onCheckAnswer,answerDraft:{read:()=> '尚未提交的编辑',write},
  controls:{t1:{busy:false,error:'回答未确认，可重试',answerQuestionToCheck:'q1'}}});
 await act(async()=>getByRole(host,'button',{name:'核对回答结果',exact:true}).click());
 expect(onCheckAnswer).toHaveBeenCalledExactlyOnceWith(waiting,'q1');
 expect(f.onAnswer).not.toHaveBeenCalled();
 expect(write).not.toHaveBeenCalled();
 expect((getByLabelText(host,'回答小竹') as HTMLInputElement).value).toBe('尚未提交的编辑');
});

it('requires detailed review for medium risk and routes a pending receipt to its original proposal',async()=>{
 const onDecide=vi.fn(async()=>{}),onRecoverProposal=vi.fn(async()=>{});
 const f={...fns(),onDecide,onRecoverProposal};
 const medium=proposal();
 const low=proposal({id:'p2',command:{type:'task.complete',payload:{id:'a'}}});
 const pendingTask=task({state:'waiting_human',waitingProposalIds:['p1','p2']});
 await paint([pendingTask],f,[medium,{...low,taskBlocked:'原任务已停止'}]);
 expect(queryByRole(host,'button',{name:'确认执行'})).toBeNull();
 expect(host.textContent).toContain('原任务已停止');
 await act(async()=>getByRole(host,'button',{name:'查看并确认'}).click());
 expect(f.onProposal).toHaveBeenCalledWith('p1');

 await paint([pendingTask],{...f,proposalsBlocked:true,pendingProposalId:'p1'},[medium,low]);
 expect((getByRole(host,'button',{name:'确认执行'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>getByRole(host,'button',{name:'核对原请求'}).click());
 expect(onRecoverProposal).toHaveBeenCalledExactlyOnceWith('p1');
 expect(onDecide).not.toHaveBeenCalled();
});
it('downloads the original from its own task and disables repeat requests while pending',async()=>{
 const file={id:'attachment',name:'delivery.pdf',size:43,mimeType:'application/pdf'};
 let finish!:()=>void;
 const onDownloadAttachment=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const original=task({state:'succeeded',attachments:[file]});
 await paint([original],{...fns(),onDownloadAttachment});
 await act(async()=>getByRole(host,'button',{name:'下载原附件 delivery.pdf'}).click());
 const waiting=getByRole(host,'button',{name:'正在下载附件 delivery.pdf'}) as HTMLButtonElement;
 expect(waiting.disabled).toBe(true);
 expect(onDownloadAttachment).toHaveBeenCalledExactlyOnceWith(original,file);
 await act(async()=>finish());
 expect(getByRole(host,'button',{name:'下载原附件 delivery.pdf'})).toBeTruthy();
});
it('opens the exact PDF and Excel originals from the completed report work trail',async()=>{
 const files=[{id:'pdf-file',name:'交期.pdf',size:43,mimeType:'application/pdf'},{id:'sheet-file',name:'核对表.xlsx',size:71,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}];
 const trail=platformTrail(files.map((file,i)=>({id:'read-'+i,at:new Date().toISOString(),plan:{name:'bambook_file_text',arguments:{fileId:file.id}},result:{kind:i?'sheet':'pdf',file,text:'仅用于测试',...(i?{}:{range:{pageFrom:21,pageTo:23},pagesWithoutText:[22]})}})),files);
 trail.push({...trail[0],label:'已经撤回的原件',taskAttachmentId:'missing'});
 const complete=task({state:'succeeded',attachments:files,trail,result:'已完成附件核对。'});
 const onPreviewAttachment=vi.fn();
 await paint([complete],{...fns(),onPreviewAttachment});
 await act(async()=>getByRole(host,'button',{name:'办理过程'}).click());
 const steps=host.querySelector<HTMLOListElement>('.mist-xz-steps')!;
 for(const file of files)await act(async()=>getByRole(steps,'button',{name:'读取附件 '+file.name}).click());
 expect(onPreviewAttachment.mock.calls).toEqual([[complete,files[0],22],[complete,files[1]]]);
 expect(queryByRole(steps,'button',{name:'已经撤回的原件'})).toBeNull();
});
it('shows the latest step while it works, leaving stop to the composer; a waiting request can be stopped in place',async()=>{const f=fns();await paint([task({trail:[{at:'',kind:'read',label:'查询订单 · 8 条'}]})],{...f,composerStopTaskId:'t1'});expect(host.textContent).toContain('核对订单');expect(host.textContent).toContain('查询订单 · 8 条');expect(queryByRole(host,'button',{name:/^停止/})).toBeNull();
  await paint([task({state:'waiting_time'})],f);await act(async()=>getByRole(host,'button',{name:/^停止/}).click());expect(f.onCancel).toHaveBeenCalledOnce();});
it('renders a finished answer as formatted content with openable record numbers',async()=>{const f=fns();await paint([task({state:'succeeded',result:'## 结论\n\n- 先跟进 SO-1001\n\n| 订单 | 交期 |\n| --- | --- |\n| SO-1001 | 11-08 |'})],f);expect(host.querySelector('h2')?.textContent).toBe('结论');expect(host.querySelector('table')).toBeTruthy();const chips=[...host.querySelectorAll('button.mist-xz-ref')];expect(chips.length).toBe(2);await act(async()=>(chips[0] as HTMLButtonElement).click());expect(f.onOpenRecord).toHaveBeenCalledWith('orders/detail','o1');});
it('never renders raw html from a model answer',async()=>{await paint([task({state:'succeeded',result:'<img src=x onerror="window.__xss=1"> 正文 <script>window.__xss=2</script>'})]);expect(host.querySelector('img')).toBeNull();expect(host.querySelector('script')).toBeNull();expect((window as any).__xss).toBeUndefined();});
it('offers copy, draft, retry and make-rule only once the request is finished',async()=>{const f=fns();await paint([task({state:'succeeded',result:'答复正文'})],f);for(const name of ['复制','保存草稿','重新提问','设为自动规则'])await act(async()=>getByRole(host,'button',{name}).click());expect(f.onCopy).toHaveBeenCalledWith('答复正文');expect(f.onDraft).toHaveBeenCalledWith('答复正文');expect(f.onRetry).toHaveBeenCalledWith(expect.objectContaining({id:'t1',instructions:'核对订单'}));expect(f.onAutomate).toHaveBeenCalledWith('核对订单');});
it('opens a trail record on the page and section the server linked, including types without a fixed page',async()=>{const f=fns();await paint([task({state:'succeeded',result:'好了',trail:[{at:'',kind:'read',label:'读取应付票据 AP-1',ref:{type:'payable_bill',id:'b1',label:'AP-1',view:'payment-vouchers',section:'payables'}},{at:'',kind:'read',label:'读取样品 SP-1',ref:{type:'sample',id:'s1',label:'SP-1'}}]})],f);await act(async()=>(host.querySelector('.mist-xz-trail-h') as HTMLButtonElement).click());const links=[...host.querySelectorAll('.mist-xz-steps button.mist-xz-ref')];expect(links.length).toBe(1);await act(async()=>(links[0] as HTMLButtonElement).click());expect(f.onOpenRecord).toHaveBeenCalledWith('payment-vouchers','b1',{section:'payables'});});
it('shows the file a confirmed proposal produced under its own turn and opens it',async()=>{const f={...fns(),onOpenFile:vi.fn()};const made={id:'p1',ownerId:'u',owner:'',command:{type:'order.document.generate',payload:{}},summary:[],createdAt:'',state:'confirmed',taskId:'t1',produced:{fileId:'f1',fileName:'PI-SO-1001.pdf'}} as any;const other={...made,id:'p2',taskId:'elsewhere',produced:{fileId:'f2',fileName:'别的.pdf'}};await paint([task({id:'t1',state:'succeeded',result:'已生成 PI'})],f,[made,other]);const files=[...host.querySelectorAll('.mist-xz-file')];expect(files.map(b=>b.textContent)).toEqual(['PI-SO-1001.pdf']);await act(async()=>(files[0] as HTMLButtonElement).click());expect(f.onOpenFile).toHaveBeenCalledWith('f1');});
it('keeps the work trail collapsed after the request is done, and expands it on demand',async()=>{await paint([task({state:'succeeded',result:'好了',trail:[{at:'',kind:'read',label:'读取订单 SO-1001',ref:{type:'order',id:'o1',label:'SO-1001'}},{at:'',kind:'write',label:'预演 email.move'}]})]);expect(getByRole(host,'button',{name:'办理过程'}).getAttribute('aria-expanded')).toBe('false');expect(host.querySelector('.mist-xz-steps')).toBeNull();await act(async()=>(host.querySelector('.mist-xz-trail-h') as HTMLButtonElement).click());expect(host.querySelector('.mist-xz-steps')!.textContent).toContain('预演 email.move');});
it('asks the open question inline and sends the answer for that question',async()=>{const f=fns();await paint([task({state:'waiting_human',questions:[{id:'q1',question:'核对哪个客户？',askedAt:''}]})],f);expect(host.textContent).toContain('核对哪个客户？');const box=getByLabelText(host,'回答小竹') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(box,'客户A');box.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>getByRole(host,'button',{name:'回答'}).click());expect(f.onAnswer).toHaveBeenCalledWith(expect.objectContaining({id:'t1'}),'q1','客户A');expect(box.value).toBe('客户A');});
it('shows what will change and opens the confirmation without leaving the conversation',async()=>{const f=fns();await paint([task({state:'waiting_human',waitingProposalIds:['p1']})],f,[proposal()]);expect(host.textContent).toContain('需要你确认');expect(host.textContent).toContain('归档邮件 PO 确认');expect(host.textContent).toContain('中风险');await act(async()=>getByRole(host,'button',{name:'查看并确认'}).click());expect(f.onProposal).toHaveBeenCalledWith('p1');});
it('labels a stopped request instead of leaving it blank',async()=>{await paint([task({state:'budget_exhausted',checkpoint:'已读 20 条'})]);expect(host.textContent).toContain('达到限额');});
it('shows the confirmed answer beside its original question, without reopening it',async()=>{
  const f=fns();
  const questions=[{id:'q1',question:'客人确认了哪天交货？',askedAt:'2026-11-27T02:00:00Z',answeredAt:'2026-11-27T02:03:00Z',answer:'模拟交期 1 月 22 日'},
    {id:'q2',question:'请提供模拟出运港。',askedAt:'2026-11-27T02:04:00Z'}];
  const asking=task({state:'waiting_human',questions});
  await paint([asking],f);
  expect(host.textContent).toContain('客人确认了哪天交货？');
  expect(host.textContent).toContain('模拟交期 1 月 22 日');
  expect(host.textContent).toContain('请提供模拟出运港。');
  expect(host.querySelectorAll('[aria-label="回答小竹"]')).toHaveLength(1);
  await paint([{...asking,contentRestricted:true}],f);
  expect(host.textContent).not.toContain('模拟交期 1 月 22 日');
  expect(f.onAnswer).not.toHaveBeenCalled();
});
it('groups requests by day',()=>{const now=new Date('2026-11-09T10:00:00+08:00');expect(dayLabel('2026-11-09T01:00:00+08:00',now)).toBe('今天');expect(dayLabel('2026-11-08T17:30:00Z',now)).toBe('今天');expect(dayLabel('2026-11-08T23:00:00+08:00',now)).toBe('昨天');});


it('shows the active model and retry phases instead of the last completed read', async () => {
  const trail = [{ at: '', kind: 'read', label: '读取订单 SO-1001' }];
  await paint([task({ trail, executionStage: 'tool' })]);
  expect(host.querySelector('.mist-xz-steps')?.textContent).toContain('读取订单 SO-1001');
  await paint([task({ trail, executionStage: 'model' })]);
  expect(host.querySelector('.mist-xz-shimmer')?.textContent).toBe('正在等待模型');
  await paint([task({ trail, state: 'queued', executionIssue: { code: 'model_unavailable', retryAt: new Date().toISOString() } })]);
  expect(host.querySelector('.mist-xz-shimmer')?.textContent).toBe('等待模型重试');
});

it('shows the scheduled retry delay until it elapses without implying a model is running',async()=>{
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-27T04:00:00Z'));
    const retryAt = new Date(Date.now()+5_000).toISOString();
    await paint([task({state:'queued',executionIssue:{code:'model_unavailable',retryAt},executionStageSince:new Date(Date.now()-40_000).toISOString()})]);
    expect(host.textContent).toContain('等待模型重试');
    expect(host.querySelector('[role="timer"]')?.textContent).toContain('最早 5 秒后重试');
    await act(async()=>vi.advanceTimersByTimeAsync(3_000));
    expect(host.querySelector('[role="timer"]')?.textContent).toContain('最早 2 秒后重试');
    await act(async()=>vi.advanceTimersByTimeAsync(2_000));
    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect(host.textContent).toContain('等待模型重试');
    await paint([task({state:'running',executionStage:'model',executionStageSince:new Date().toISOString()})]);
    expect(host.textContent).toContain('正在等待模型');
    expect(host.querySelector('[role="timer"]')?.textContent).toContain('0 秒');
  } finally {vi.useRealTimers();}
});


it('starts the backup model timer at failover and gives recovery states priority', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-27T04:00:00Z'));
    const model = task({
      executionStage:'model',
      executionStageSince:new Date(Date.now()-47_000).toISOString(),
      modelFallbackSince:new Date(Date.now()-2_000).toISOString(),
    });
    await paint([model]);
    expect(getByRole(host,'status').textContent).toBe('正在等待备用模型');
    expect(getByRole(host,'timer').textContent).toBe('· 2 秒');
    await act(async()=>vi.advanceTimersByTimeAsync(1000));
    expect(getByRole(host,'timer').textContent).toBe('· 3 秒');

    await paint([model], {...fns(),staleProgressIds:new Set([model.id])});
    expect(getByRole(host,'status').textContent).toBe('执行进度暂未更新');
    expect(queryByRole(host,'timer')).toBeNull();

    await paint([{...model,runnerStatus:'heartbeat_stale',lastHeartbeatAt:new Date(Date.now()-20_000).toISOString()}]);
    expect(getByRole(host,'status').textContent).toBe('执行进度暂未更新');
    expect(getByRole(host,'timer').textContent).toBe('· 20 秒');

    const retryAt = new Date(Date.now()+5000).toISOString();
    await paint([{...model,state:'queued',executionIssue:{code:'model_unavailable',retryAt}}]);
    expect(getByRole(host,'status').textContent).toBe('等待模型重试');
    expect(getByRole(host,'timer').textContent).toBe('· 最早 5 秒后重试');

    await paint([{...model,modelFallbackSince:'unparseable'}]);
    expect(getByRole(host,'status').textContent).toBe('正在等待模型');
    expect(getByRole(host,'timer').textContent).toBe('· 48 秒');

    await paint([{...model,executionStage:'tool',executionStageSince:new Date().toISOString()}]);
    expect(getByRole(host,'status').textContent).toBe('正在办理');
    expect(getByRole(host,'timer').textContent).toBe('· 0 秒');
  } finally { vi.useRealTimers(); }
});

it('shows actual step details as they arrive while the model wait counts up', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-23T06:00:00Z'));
    const executionStageSince = new Date(Date.now() - 2000).toISOString();
    const trail = [{ at: '', kind: 'read', label: '读取订单 SO-1001', completed: true }];
    await paint([task({ executionStage:'model', executionStageSince, trail })]);
    expect(getByRole(host,'status').textContent).toBe('正在等待模型');
    expect(getByRole(host,'timer').textContent).toBe('· 2 秒');
    expect(host.querySelector('.mist-xz-steps')?.textContent).toContain('读取订单 SO-1001');
    expect(host.querySelector('.mist-xz-steps')?.textContent).not.toContain('交期相差三天');
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(getByRole(host,'timer').textContent).toBe('· 9 秒');
    await paint([task({ executionStage:'model', executionStageSince, trail: [...trail, {
      at:'',kind:'read',label:'读取附件 交期.pdf',completed:true,
      detail:'已提取可读取正文',progress:'订单与附件的交期相差三天，下一步核对最新版本。',
    }] })]);
    expect(host.querySelector('.mist-xz-steps')?.textContent).toContain('已提取可读取正文');
    expect(host.querySelector('.mist-xz-steps')?.textContent).toContain('交期相差三天');
    expect(getByRole(host,'timer').textContent).toBe('· 9 秒');
  } finally { vi.useRealTimers(); }
});

it('opens source records from the work log while the model is running', async () => {
  const actions=fns();
  await paint([task({executionStage:'model',trail:[{
    at:'', kind:'read', label:'读取订单 SO-1001', completed:true, ref:{type:'order',id:'o1',label:'SO-1001'},
  }]})],actions);
  const toggle=getByRole(host,'button',{name:'办理过程'});
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await act(async()=>toggle.click());
  expect(queryByRole(host,'button',{name:'读取订单 SO-1001'})).toBeNull();
  await act(async()=>toggle.click());
  await act(async()=>getByRole(host,'button',{name:'读取订单 SO-1001'}).click());
  expect(actions.onOpenRecord).toHaveBeenCalledWith('orders/detail','o1',undefined);
  expect(getByRole(host,'status').textContent).toContain('正在等待模型');
});

it('opens every order source from a single batch step even when the report does not repeat the order numbers', async () => {
  const actions = fns();
  await paint([task({ state:'succeeded', result:'已核对交期。', trail:[
    { at:'',kind:'read',label:'读取报价 Q-01',ref:{type:'quotation',id:'q1',label:'Q-01',view:'quotations'} },
    { at:'',kind:'read',label:'读取 2 张订单',completed:true,refs:[
      {type:'order',id:'o1',label:'SO-1001',view:'orders/detail'},
      {type:'order',id:'o2',label:'SO-1002',view:'orders/detail'},
    ] },
    { at:'',kind:'read',label:'读取订单详情',completed:true,failed:true },
  ] })], actions);
  await act(async()=>getByRole(host,'button',{name:'办理过程'}).click());
  const trail = host.querySelector<HTMLOListElement>('.mist-xz-steps')!;
  expect(trail.querySelectorAll('li')).toHaveLength(3);
  for (const label of ['读取报价 Q-01','SO-1001','SO-1002']) {
    await act(async()=>getByRole(trail,'button',{name:label,exact:true}).click());
  }
  expect(actions.onOpenRecord.mock.calls).toEqual([
    ['quotations','q1',undefined],['orders/detail','o1',undefined],['orders/detail','o2',undefined],
  ]);
  expect(queryByRole(trail,'button',{name:'读取订单详情'})).toBeNull();
});


it('shows recovery independently of the model stage and returns to live model waiting',async()=>{
 await paint([task({runnerStatus:'heartbeat_stale',executionStage:'model',lastHeartbeatAt:new Date(Date.now()-20_000).toISOString()})]);
 expect(getByRole(host,'status').textContent).toBe('执行进度暂未更新');
 await paint([task({state:'queued',runnerStatus:'awaiting_reclaim'})]);
 expect(getByRole(host,'status').textContent).toBe('待重新领取');
 await paint([task({executionStage:'model'})]);
 expect(getByRole(host,'status').textContent).toBe('正在等待模型');
});

it('replaces unverified live phases per task while keeping previously read sources', async () => {
  const executionStageSince = new Date(Date.now()-3000).toISOString();
  const trail = [{ at:'', kind:'read', label:'读取订单 SO-1001', completed:true }];
  const running = task({ id:'model', executionStage:'model', executionStageSince, trail });
  const queued = task({ id:'retry', state:'queued', executionIssue:{code:'model_unavailable',retryAt:new Date(Date.now()+60_000).toISOString()} });
  const renderedTask = (id: string) => host.querySelector<HTMLElement>('[data-task-id="'+id+'"]')!;
  const staleProgressIds = new Set(['model']);
  await paint([running, queued], { ...fns(), staleProgressIds });
  const model = renderedTask('model'), retry = renderedTask('retry');
  expect(getByRole(model,'status').textContent).toBe('执行进度暂未更新');
  expect(queryByRole(model,'timer')).toBeNull();
  expect(model.querySelector('.mist-xz-shimmer')).toBeNull();
  expect(model.querySelector('.mist-xz-steps')?.textContent).toContain('读取订单 SO-1001');
  expect(getByRole(retry,'timer').textContent).toContain('秒后重试');

  await paint([running, queued], { ...fns(), staleProgressIds:new Set(['retry']) });
  expect(getByRole(model,'status').textContent).toBe('正在等待模型');
  expect(getByRole(model,'timer')).toBeTruthy();
  expect(getByRole(retry,'status').textContent).toBe('执行进度暂未更新');
  expect(queryByRole(retry,'timer')).toBeNull();
});
