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
const view=(active=true, taskId?:string)=> <Nav.Provider value={{route:{view:'assistant',...(taskId?{section:'tasks',id:taskId}:{})},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><AssistantConversationProvider scope={mock.sessionKey+':'+(mock.workspace.workspace?.id??'')}>{active?<AssistantPage/>:<div>Source record</div>}</AssistantConversationProvider></Nav.Provider>;
const response=(body:unknown,ok=true)=>({ok,json:async()=>body});

it('asks which running task to check before issuing a read-only status request', async () => {
  const conversationId='c_status_choices';
  const a={
    id:'check-a',identityId:'personal',executor:'platform',conversationId,name:'核对订单 A',instructions:'核对订单 A',
    state:'running',version:1,canControl:true,questions:[],waitingProposalIds:[],
    createdAt:'2026-11-24T01:00:00Z',updatedAt:'2026-11-24T01:00:00Z',
  };
  const b={...a,id:'check-b',name:'核对订单 B',instructions:'核对订单 B',createdAt:'2026-11-24T01:01:00Z'};
  let picked=false;
  sessionStorage.setItem('mist.xiaozhu.conversation:session-a:workspace',conversationId);
  mock.fetch.mockResolvedValue(response({configured:true}));
  mock.api.mockImplementation(async (url:string)=>{
    if(url.includes('/agent-identities'))return {items:[{id:'personal',kind:'personal',state:'active'}]};
    if(url.endsWith('/agent-task-capabilities'))return {platformAvailable:true};
    if(url.endsWith('/check-a'))return {item:a};
    if(url.endsWith('/check-b'))return {item:picked?{...b,state:'succeeded',version:2,result:'已核对 B'}:b};
    return {items:url.endsWith('/agent-tasks')?[a,b]:[],nextCursor:null};
  });
  await mount();
  await question('完成了吗？');
  await click('发送');
  expect(document.body.textContent).toContain('选择要核对的任务');
  expect(host.querySelector('textarea')?.value).toBe('完成了吗？');
  await click('关闭');
  expect(host.querySelector('textarea')?.value).toBe('完成了吗？');
  await click('发送');
  const before=mock.api.mock.calls.length;
  picked=true;
  await click('核对状态 核对订单 B');
  expect(mock.api.mock.calls.slice(before).some(([url])=>url.endsWith('/check-b'))).toBe(true);
  expect(mock.api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
  expect(host.textContent).toContain('核对订单 B · 已完成');
  expect(host.querySelector('textarea')?.value).toBe('');
});

it('lets a user stop one of two running tasks without losing the unsent question', async () => {
  const conversationId='c_parallel_stop';
  const first={
    id:'task-a',identityId:'personal',executor:'platform',conversationId,name:'任务 A',instructions:'任务 A',
    state:'running',version:1,canControl:true,questions:[],waitingProposalIds:[],
    createdAt:'2026-11-24T01:00:00Z',updatedAt:'2026-11-24T01:00:00Z',
  };
  const second={...first,id:'task-b',name:'任务 B',instructions:'任务 B',createdAt:'2026-11-24T01:01:00Z'};
  let taskA=first;
  sessionStorage.setItem('mist.xiaozhu.conversation:session-a:workspace',conversationId);
  mock.fetch.mockResolvedValue(response({configured:true}));
  mock.api.mockImplementation(async (url:string,init?:RequestInit)=>{
    if(url.includes('/agent-identities'))return {items:[{id:'personal',kind:'personal',state:'active'}]};
    if(url.endsWith('/agent-task-capabilities'))return {platformAvailable:true};
    if(url.endsWith('/task-a/cancel')&&init?.method==='POST'){
      taskA={...taskA,state:'cancelled',version:2};
      return {item:taskA};
    }
    if(url.endsWith('/task-a'))return {item:taskA};
    if(url.endsWith('/task-b'))return {item:second};
    return {items:url.endsWith('/agent-tasks')?[taskA,second]:[],nextCursor:null};
  });
  await mount();
  expect(button('停止生成')).toBeUndefined();
  expect(button('停止任务 任务 A')).toBeTruthy();
  expect(button('停止任务 任务 B')).toBeTruthy();
  await question('保留这份未提交的草稿');
  await click('停止任务 任务 A');
  expect(host.querySelector('[data-task-state="cancelled"]')?.textContent).toContain('任务 A');
  expect(host.querySelector('[data-task-state="running"]')?.textContent).toContain('任务 B');
  expect(host.querySelector('textarea')?.value).toBe('保留这份未提交的草稿');
  expect(mock.api.mock.calls.filter(([,init])=>init?.method==='POST').map(([url])=>url)).toEqual([
    '/api/mist/workspaces/workspace/agent-tasks/task-a/cancel',
  ]);
  await question('');
  expect(button('停止生成')).toBeTruthy();
  expect(button('停止任务 任务 B')).toBeUndefined();
});

it.each([
  {case:'clears the matching draft for a recovered task',question:'核对原 PDF',found:true,after:''},
  {case:'preserves a different draft when recovering a task',question:'正在写另一条问题',found:true,after:'正在写另一条问题'},
  {case:'blocks a fileless resend while the attachment receipt is unknown',question:'核对原 PDF',found:false,after:'核对原 PDF'},
])('$case', async ({question,found,after}) => {
  const conversationId='c_reload_task';
  const task = {
    id:'recovered-task', identityId:'personal', executor:'platform', conversationId, instructions:'核对原 PDF',
    state:'succeeded', result:'原 PDF 已核对', questions:[], waitingProposalIds:[], canControl:false,
    createdAt:'2026-11-24T00:00:00Z', updatedAt:'2026-11-24T00:01:00Z',
  };
  const requestId='00000000-0000-4000-8000-000000000051';
  sessionStorage.setItem('mist.xiaozhu.conversation:session-a:workspace',conversationId);
  sessionStorage.setItem('mist.assistant.conversation:session-a:workspace',JSON.stringify({question,selected:[],messages:[]}));
  sessionStorage.setItem('mist.xiaozhu.submissions:session-a:workspace',JSON.stringify([['fingerprint',{
    requestId,instructions:task.instructions,locale:'zh-CN',draftKey:JSON.stringify([task.instructions,[]]),
    conversationId,sourceConversationId:conversationId,hasAttachments:true,
  }]]));
  mock.fetch.mockResolvedValue(response({configured:true}));
  mock.api.mockImplementation(async (url: string) => {
    if (url.includes('/agent-identities')) return {items:[{id:'personal',kind:'personal',state:'active'}]};
    if (url.endsWith('/agent-task-capabilities')) return {platformAvailable:true};
    if (url.endsWith('/personal-agent/tasks/receipt/'+requestId)) {
      if (!found) throw Object.assign(new Error('没有原回执'),{status:404});
      return {item:task};
    }
    return {items:[],nextCursor:null};
  });
  await mount();
  if(found){
    expect(host.textContent).toContain('已找回提交的任务');
    expect(host.textContent).toContain('原 PDF 已核对');
    expect(sessionStorage.getItem('mist.xiaozhu.submissions:session-a:workspace')).toBeNull();
  }else{
    expect(host.textContent).toContain('提交结果待核对');
    await click('发送');
    expect(host.textContent).toContain('请恢复原附件后重试');
    expect(sessionStorage.getItem('mist.xiaozhu.submissions:session-a:workspace')).toContain(requestId);
  }
  expect(host.querySelector('textarea')?.value).toBe(after);
  expect(mock.api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});

it('restores the request, order and original attachment of a failed task for review before resending', async () => {
  const failure = {
    id: '00000000-0000-4000-8000-000000000047',
    identityId: 'personal', executor: 'platform', conversationId: 'c_retry_file',
    instructions: '核对原件\n（引用业务记录：SO-SELECTED · Fixture）',
    state: 'failed', result: '读取暂时失败', questions: [], waitingProposalIds: [], canControl: false,
    createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:01:00Z',
    intentRefs: [{ kind: 'orders', id: 'order' }],
    attachments: [{ id: '00000000-0000-4000-8000-000000000048', name: 'delivery.pdf', size: 42 }],
  };
  mock.fetch.mockResolvedValue(response({ configured: true }));
  mock.api.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
    if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: true };
    if (init?.method === 'POST') return { item: { ...failure, id: 'retried', state: 'succeeded', result: '原件已读回' } };
    return { items: url.endsWith('/agent-tasks') ? [failure] : [], nextCursor: null };
  });
  try {
    await mount();
    await click('核对原件');
    await question('另一条尚未提交的问题');
    expect(button('重新提问')?.disabled).toBe(true);
    await question('');
    await click('重新提问');
    expect(host.querySelector('textarea')?.value).toBe('核对原件');
    expect(button('移除 SO-SELECTED · Fixture')).toBeTruthy();
    expect(button('移除附件 delivery.pdf')).toBeTruthy();
    expect(mock.api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await click('发送');
    const [, init] = mock.api.mock.calls.find(([, opts]) => opts?.method === 'POST')!;
    expect(JSON.parse(init.body)).toMatchObject({
      conversationId: failure.conversationId,
      instructions: failure.instructions,
      intentRefs: failure.intentRefs,
      attachmentRefs: [{ taskId: failure.id, fileId: failure.attachments[0].id }],
    });
  } finally {
    localStorage.removeItem('mist.xiaozhu.conversation:session-a:workspace');
  }
});

it.each([true,false])('finds and downloads an attached original with model availability %s', async available => {
  const original = {
    id: '00000000-0000-4000-8000-000000000041',
    identityId: 'personal', executor: 'platform', conversationId: 'c_attachment',
    instructions: '核对最初的附件', state: 'succeeded', result: '资料已读取',
    questions: [], waitingProposalIds: [], canControl: false,
    createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:01:00Z',
    attachments: [{ id: '00000000-0000-4000-8000-000000000042', name: 'quantity.xlsx', size: 42 }],
  };
  mock.fetch.mockResolvedValue(response({ configured: true }));
  mock.api.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
    if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: available };
    if (init?.method === 'POST') return { item: { ...original, id: 'follow-up', instructions: '核对第一行表头' } };
    return { items: url.endsWith('/agent-tasks') ? [original] : [], nextCursor: null };
  });
  try {
    mock.workspace.downloadTaskAttachment=vi.fn(async()=>{});
    mock.workspace.readTaskAttachment=vi.fn(()=>new Promise<Blob>(()=>{}));
    await mount();
    await click('核对最初的附件');
    if(available){
      await click('引用附件 quantity.xlsx');
      await click('引用附件 quantity.xlsx');
      expect(Array.from(host.querySelectorAll('button')).filter(button =>
        button.getAttribute('aria-label') === '移除附件 quantity.xlsx')).toHaveLength(1);
      await click('移除附件 quantity.xlsx');
    }
    await click('引用业务记录');
    const menu = document.querySelector('select[aria-label="检索对象"]') as HTMLSelectElement;
    await act(async () => {
      menu.value = 'attachments';
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const search = document.querySelector('input[aria-label="附件文件名"]') as HTMLInputElement;
    const enterSearch = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await enterSearch('missing');
    expect(document.body.textContent).toContain('没有匹配的附件');
    await enterSearch('QUANTITY');
    const picker=search.closest('[role="dialog"]');
    const preview=picker?.querySelector<HTMLButtonElement>('button[aria-label="预览原附件 quantity.xlsx"]');
    expect(preview).toBeTruthy();
    await act(async()=>preview!.click());
    const viewer=document.querySelector('[data-file-preview="'+original.attachments[0].id+'"]');
    expect(viewer).toBeTruthy();
    expect(mock.workspace.readTaskAttachment).toHaveBeenCalledExactlyOnceWith(original.id,original.attachments[0]);
    expect(mock.workspace.downloadTaskAttachment).not.toHaveBeenCalled();
    await act(async()=>viewer!.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click());
    expect(document.querySelector('[data-file-preview]')).toBeNull();
    expect(search.value).toBe('QUANTITY');
    const download=picker?.querySelector<HTMLButtonElement>('button[aria-label="下载原附件 quantity.xlsx"]');
    expect(download).toBeTruthy();
    await act(async()=>download!.click());
    expect(mock.workspace.downloadTaskAttachment).toHaveBeenCalledExactlyOnceWith(original.id,original.attachments[0]);
    const add = picker?.querySelector<HTMLButtonElement>('button[aria-label="引用附件 quantity.xlsx"]');
    expect(add).toBeTruthy();
    if(!available){
      expect(add!.disabled).toBe(true);
      expect(mock.api.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
      return;
    }
    await act(async () => add!.click());
    await click('关闭');
    await question('核对第一行表头');
    await click('发送');
    const [path, init] = mock.api.mock.calls.find(([, opts]) => opts?.method === 'POST')!;
    expect(path).toMatch(/\/personal-agent\/tasks$/);
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body)).toMatchObject({
      conversationId: original.conversationId,
      attachmentRefs: [{ taskId: original.id, fileId: original.attachments[0].id }],
    });
    expect(button('移除附件 quantity.xlsx')).toBeUndefined();
  } finally {
    localStorage.removeItem('mist.xiaozhu.conversation:session-a:workspace');
  }
});

it('keeps an unsent question, references and files with their own conversation', async () => {
  const first = {
    id: 'first', identityId: 'personal', executor: 'platform', conversationId: 'c_first',
    instructions: '核对第一单', state: 'succeeded', result: '第一单已读取',
    questions: [], waitingProposalIds: [], canControl: false,
    createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:01:00Z',
  };
  const second = { ...first, id: 'second', conversationId: 'c_second', instructions: '核对第二单', result: '第二单已读取' };
  mock.fetch.mockResolvedValue(response({ configured: true }));
  mock.api.mockImplementation(async (url: string) => {
    if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
    if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: true };
    return { items: url.endsWith('/agent-tasks') ? [first, second] : [], nextCursor: null };
  });
  try {
    await mount();
    await click('核对第一单');
    await question('第一单的未发送文字');
    await click('引用业务记录');
    await click('加入问题');
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['first'], 'first.pdf', { type: 'application/pdf' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(button('移除附件 first.pdf')).toBeTruthy();
    await click('核对第二单');
    expect(host.querySelector('textarea')!.value).toBe('');
    expect(button('移除附件 first.pdf')).toBeUndefined();
    expect(button('移除 SO-SELECTED · Fixture')).toBeUndefined();
    await question('第二单的未发送文字');
    await click('核对第一单');
    expect(host.querySelector('textarea')!.value).toBe('第一单的未发送文字');
    expect(button('移除附件 first.pdf')).toBeTruthy();
    expect(host.textContent).toContain('已引用 1 / 12 个来源');
    localStorage.setItem('mist.xiaozhu.conversation:session-a:workspace', second.conversationId);
    await act(async () => root!.render(view(false)));
    await act(async () => root!.render(view()));
    expect(host.querySelector('textarea')!.value).toBe('第一单的未发送文字');
    expect(button('移除附件 first.pdf')).toBeTruthy();
    await click('核对第二单');
    expect(host.querySelector('textarea')!.value).toBe('第二单的未发送文字');
    expect(mock.api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    const read = mock.api.getMockImplementation()!;
    let finish!: (value: { item: typeof second }) => void;
    const acknowledgement = new Promise<{ item: typeof second }>(resolve => { finish = resolve; });
    mock.api.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/personal-agent/tasks') && init?.method === 'POST' ? acknowledgement : read(url, init));
    await click('发送');
    await click('核对第一单');
    await act(async () => finish({ item: { ...second, id: 'submitted', instructions: '第二单的未发送文字' } }));
    expect(host.querySelector('textarea')!.value).toBe('第一单的未发送文字');
    expect(button('移除附件 first.pdf')).toBeTruthy();
    await click('核对第二单');
    expect(host.querySelector('textarea')!.value).toBe('');
  } finally {
    localStorage.removeItem('mist.xiaozhu.conversation:session-a:workspace');
  }
});

it('keeps the same conversation in sync when a paused task is resumed from its drawer', async () => {
  vi.useFakeTimers();
  let acknowledged = false;
  let statusReads = 0;
  const paused = {
    id: 'paused-task', name: '核对模拟订单', instructions: '核对模拟订单', conversationId: 'c_resume',
    identityId: 'personal', identityName: '小竹', executor: 'platform', state: 'paused',
    canControl: true, version: 4, questions: [], waitingProposalIds: [], runtimeUsedMs: 0,
    createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:01:00Z',
  };
  const resumed = { ...paused, state: 'queued', version: 5 };
  const finished = { ...resumed, state: 'succeeded', version: 6, result: '同一订单已核对' };
  try {
    mock.fetch.mockResolvedValue(response({ configured: true }));
    mock.api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/agent-identities')) return { items: [{ id: 'personal', kind: 'personal', state: 'active' }] };
      if (url.endsWith('/agent-task-capabilities')) return { platformAvailable: true };
      if (url.endsWith('/paused-task/resume')) {
        expect(init?.method).toBe('POST');
        acknowledged = true;
        return { item: resumed };
      }
      if (url.endsWith('/paused-task')) {
        if (init?.cache === 'no-store') return { item: ++statusReads > 1 ? finished : paused };
        return { item: acknowledged ? resumed : paused };
      }
      return { items: url.endsWith('/agent-tasks') ? [acknowledged ? resumed : paused] : [], nextCursor: null };
    });
    await mount();
    await click('核对模拟订单');
    expect(host.textContent).toContain('已暂停');
    await act(async () => root!.render(view(true, paused.id)));
    await click('继续任务');
    await click('确认');
    expect(acknowledged).toBe(true);
    await act(async () => root!.render(view()));
    expect(host.textContent).not.toContain('已暂停');
    expect(statusReads).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(host.textContent).toContain('同一订单已核对');
    expect(mock.api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  } finally {
    localStorage.removeItem('mist.xiaozhu.conversation:session-a:workspace');
    vi.useRealTimers();
  }
});

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
