// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getByLabelText,getByText,queryByRole,fireEvent} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),copy:vi.fn(),refresh:vi.fn(),go:vi.fn(),identity:'A',userId:'sales'}));
vi.mock('../runtime/auth',()=>({useMistSession:()=>({sessionKey:seam.identity,user:{id:seam.userId}})}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'workspace'},refresh:seam.refresh}),mistApiRequest:(...args:any[])=>seam.api(...args)}));
vi.mock('../nav',()=>({useNav:()=>({go:seam.go})}));
import {AgentTasks} from './AgentTasks';
let host:HTMLDivElement,root:Root;
const row=()=>({id:'task',identityId:'identity',identityName:'邮件助理',name:'核对邮件',ownerId:'sales',ownerName:'顾言',mode:'operate',instructions:'核对本人来信，移动前交本人确认。',state:'queued',version:3,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-02T00:00:00Z',stepsUsed:0,stepLimit:40,runtimeUsedMs:0,runtimeLimitMs:1800000,lastHeartbeatAt:null,checkpoint:'',result:'',waitingProposalIds:[],canControl:true});
const identity=()=>({id:'identity',name:'邮件助理',mode:'operate',state:'active'});
const paint=()=>root.render(<MistRoot><ToastProvider><AgentTasks onConnections={()=>{}}/></ToastProvider></MistRoot>);
const flush=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve();});};
const click=async(node:HTMLElement)=>{await act(async()=>node.click());await flush();};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();seam.identity='A';seam.userId='sales';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:seam.copy.mockResolvedValue(undefined)}});host=document.createElement('div');document.body.append(host);root=createRoot(host);seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{item:row()}:url.includes('agent-identities')?{items:[identity()],nextCursor:null}:url.includes('/history')?{items:[],nextCursor:null}:url.endsWith('/task')?{item:row()}:{items:[row()],nextCursor:null}));});
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
it('includes active owner connections beyond the first page',async()=>{
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('agent-identities')?url.includes('cursor=next')?{items:[identity()],nextCursor:null}:{items:[],nextCursor:'next'}:{items:[],nextCursor:null}));
 act(paint);await flush();await click(getByRole(host,'button',{name:'新建任务'}));expect(getByRole(document.body,'option',{name:'邮件助理 · 可办理'})).toBeTruthy();
});
