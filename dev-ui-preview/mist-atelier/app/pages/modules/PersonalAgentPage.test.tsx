// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';import {getByRole,getByLabelText,getByText} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),go:vi.fn(),chat:true}));
vi.mock('../../runtime/auth',()=>({useMistSession:()=>({sessionKey:'A',user:{id:'sales'},hasPermission:(p:string)=>p!=='ai:chat'||seam.chat})}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'ws'}}),mistApiRequest:(...args:any[])=>seam.api(...args)}));
vi.mock('../../nav',()=>({useNav:()=>({go:seam.go,route:{view:'assistant',section:'agent'}})}));
import {PersonalAgentPage} from './PersonalAgentPage';
let host:HTMLDivElement,root:Root;
const flush=async()=>{await act(async()=>{for(let i=0;i<4;i++)await Promise.resolve();});};
const task=(over:any={})=>({id:'t1',identityId:'pa',identityName:'顾言的 Agent',name:'核对待办',ownerId:'sales',ownerName:'顾言',instructions:'',state:'succeeded',version:2,createdAt:new Date().toISOString(),updatedAt:'',expiresAt:'',mode:'operate',stepsUsed:1,stepLimit:40,runtimeUsedMs:0,runtimeLimitMs:1,lastHeartbeatAt:null,checkpoint:'',waitingProposalIds:[],result:'已核对',canControl:true,executor:'platform',...over});
function api(platformAvailable=true){const created:any[]=[];seam.api.mockImplementation((url:string,init:any)=>{
 if(init?.method==='POST'){const item=task({id:'t2',name:'按客户汇报',state:'queued',result:''});created.push(item);return Promise.resolve({item});}
 if(url.includes('/agent-identities'))return Promise.resolve({items:[{id:'pa',kind:'personal',name:'顾言的 Agent',ownerId:'sales',ownerName:'顾言',mode:'operate',version:2,state:'active',createdAt:'',canManage:false,canIssue:true}]});
 if(url.includes('/agent-task-capabilities'))return Promise.resolve({platformAvailable});
 if(url.includes('/personal-agent/usage'))return Promise.resolve({month:'2026-11',scope:'mine',items:[{ownerId:'sales',ownerName:'顾言',tasks:1,modelTurns:3,runtimeMs:0}]});
 return Promise.resolve({items:[...created,task(),task({id:'other',executor:'external'})],nextCursor:null});});}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();seam.chat=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const paint=()=>act(()=>root.render(<MistRoot><ToastProvider><PersonalAgentPage/></ToastProvider></MistRoot>));
it('hands work to the personal Agent through one platform task request and lists only its own platform tasks',async()=>{
 api();paint();await flush();
 expect(host.textContent).toContain('核对待办');expect(host.textContent).not.toContain('other');expect(host.textContent).toContain('模型调用 3 次');
 const box=getByLabelText(host,'要做什么') as HTMLTextAreaElement;
 await act(async()=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;set.call(box,'按客户汇报本周待办');box.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>getByRole(host,'button',{name:'交办'}).click());await flush();
 const post=seam.api.mock.calls.find(([,i])=>i?.method==='POST')!;expect(post[0]).toBe('/api/mist/workspaces/ws/personal-agent/tasks');
 const body=JSON.parse(post[1].body);expect(body).toMatchObject({instructions:'按客户汇报本周待办',name:'按客户汇报本周待办'});expect(body).not.toHaveProperty('identityId');
 expect(host.textContent).toContain('按客户汇报');
});
it('keeps the hand-off disabled while the platform model is unavailable and stops without AI permission',async()=>{
 api(false);paint();await flush();expect(getByText(host,'平台模型暂不可用')).toBeTruthy();expect((getByRole(host,'button',{name:'交办'}) as HTMLButtonElement).disabled).toBe(true);
 act(()=>root.unmount());root=createRoot(host);seam.chat=false;paint();await flush();expect(host.textContent).toContain('无 AI 使用权限');expect(seam.api).toHaveBeenCalledTimes(4);
});
it('retries an uncertain hand-off with the same operation number and leaves the written request intact',async()=>{
 api();const original=seam.api.getMockImplementation()!;let posts=0;
 seam.api.mockImplementation(async(...args:any[])=>{const result=await original(...args);if(args[1]?.method==='POST'&&posts++===0)throw Error('网络中断，请核对原事项');return result;});
 paint();await flush();const box=getByLabelText(host,'要做什么') as HTMLTextAreaElement;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(box,'只读核对订单状态');box.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>getByRole(host,'button',{name:'交办'}).click());await flush();expect(box.value).toBe('只读核对订单状态');
 await act(async()=>getByRole(host,'button',{name:'交办'}).click());await flush();
 const requests=seam.api.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(init.body));
 expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
});
