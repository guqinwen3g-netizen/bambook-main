// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {AgentTaskNotice} from '../../../../server/src/shared/mistAgentTasks';
const sounds=vi.hoisted(()=>({play:vi.fn(),mark:vi.fn((_scope:string,_ids:string[])=>true)}));
vi.mock('../../../../services/uiSoundService',()=>({canPlayNotificationSound:()=>true,playNotificationSound:sounds.play}));
vi.mock('./notificationSound',()=>({markNoticeSounds:sounds.mark}));
import {agentTaskNoticeScope,readAllMistNotices,readMistNotice,useAgentTaskNotices,type AgentTaskNotices} from './agentTaskNotices';
let host:HTMLDivElement,root:Root,current:AgentTaskNotices;
const notice=(id='one'):AgentTaskNotice=>({id:'agent-task:'+id+':key',taskId:id,key:'a'.repeat(64),title:'Agent待补充资料',detail:'核对交期',at:'2026-11-01T00:00:00Z',readAt:null,category:'general',target:{view:'account',id,section:'agents'}});
function Probe({scope,request,soundScope}:{scope:string;request:any;soundScope?:string}){current=useAgentTaskNotices(scope,scope?'workspace':undefined,request,soundScope);return <div>{current.items.map(n=><span key={n.id}>{n.detail}</span>)}{current.error}</div>;}
const paint=async(scope:string,request:any,soundScope?:string)=>act(async()=>{root.render(<Probe scope={scope} request={request} soundScope={soundScope}/>);await Promise.resolve();await Promise.resolve();});
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
it('enables ordinary company users whose platform role is none and excludes platform company support',()=>{
 expect(agentTaskNoticeScope('session','workspace',{id:'sales',platformRole:'none'})).not.toBe('');expect(agentTaskNoticeScope('session','workspace',{id:'sales',platformRole:null})).not.toBe('');expect(agentTaskNoticeScope('session','workspace',{id:'platform',platformRole:'platform_admin'})).toBe('');expect(agentTaskNoticeScope('session','workspace',{id:'platform',platformCompany:{id:'company'}})).toBe('');
});
it('loads silently, sounds only for new unread work and does not replay on heartbeat-like refreshes',async()=>{
 let rows=[notice()];const request=vi.fn(async()=>({items:rows}));await paint('sales:workspace',request);expect(current.items).toHaveLength(1);expect(sounds.play).not.toHaveBeenCalled();
 rows=[notice(),notice('two')];await act(async()=>current.refresh());expect(sounds.play).toHaveBeenCalledTimes(1);expect(sounds.mark).toHaveBeenLastCalledWith('sales:workspace',['agent-task:two:key']);await act(async()=>current.refresh());expect(sounds.play).toHaveBeenCalledTimes(1);
 rows=[...rows,{...notice('read'),readAt:'2026-11-01T00:00:00Z'}];await act(async()=>current.refresh());expect(sounds.play).toHaveBeenCalledTimes(1);
});
it('drops old account content and late responses immediately on a scope switch',async()=>{
 let resolve!:(value:any)=>void;const request=vi.fn(()=>new Promise(done=>{resolve=done;}));await paint('sales:workspace',request);await paint('',request);expect(current.items).toEqual([]);
 await act(async()=>resolve({items:[notice()]}));expect(current.items).toEqual([]);expect(host.textContent).not.toContain('核对交期');
});
it('deduplicates sounds by stable owner and workspace rather than the changing request session',async()=>{
 let rows:AgentTaskNotice[]=[];const request=vi.fn(async()=>({items:rows}));await paint('request-1',request,'sales:company');rows=[notice()];await act(async()=>current.refresh());await paint('request-2',request,'sales:company');expect(sounds.play).toHaveBeenCalledTimes(1);rows=[notice(),notice('two')];await act(async()=>current.refresh());expect(sounds.mark.mock.calls.map(args=>args[0])).toEqual(['sales:company','sales:company']);
});
it('reads task reminders through personal metadata and keeps ordinary notification commands separate',async()=>{
 const item=notice(),read=vi.fn(async()=>{}),run=vi.fn(async()=>({})),workspace:any={agentTaskNotices:{items:[item],read},run};
 await readMistNotice(workspace,item);expect(read).toHaveBeenCalledWith([item]);expect(run).not.toHaveBeenCalled();
 const business={...item,id:'business'};await readAllMistNotices(workspace,[item,business]);expect(run).toHaveBeenCalledWith({type:'notification.readAll',payload:{}});expect(read).toHaveBeenCalledTimes(2);
 await expect(readMistNotice(workspace,{...item,id:'agent-task:missing:key'})).rejects.toThrow('请刷新');
});
it('does not clear a changed reminder on a stale acknowledgment, and rejects an unconfirmed success response',async()=>{
 let result:any={read:true};const request=vi.fn(async(_path:string,init?:RequestInit)=>{if(init?.method==='POST'){if(result instanceof Error)throw result;return result;}return{items:[notice()]};});await paint('sales:workspace',request);
 result=Object.assign(Error('任务已更新'),{status:409});await act(async()=>{await expect(current.read(current.items)).rejects.toThrow('任务已更新');});await flush();expect(current.items[0].readAt).toBeNull();
 result={read:false};await act(async()=>{await expect(current.read(current.items)).rejects.toThrow('任务提醒响应无效');});expect(current.items[0].readAt).toBeNull();
});
it('clears stale content on a permission failure and does not expose a second account to a late read result',async()=>{
 let fail=false,resolve!:(value:any)=>void;const request=vi.fn(async(_path:string,init?:RequestInit)=>{if(init?.method==='POST')return new Promise(done=>{resolve=done;});if(fail)throw Object.assign(Error('无权查看'),{status:403});return{items:[notice()]};});await paint('sales:workspace',request);fail=true;await act(async()=>current.refresh());expect(current.items).toEqual([]);expect(current.error).toBe('无权查看');fail=false;await act(async()=>current.refresh());
 const source=current;let pending:Promise<void>;act(()=>{pending=source.read(source.items);});await paint('',request);await act(async()=>{resolve({read:true});await expect(pending!).rejects.toThrow('账号或公司已切换');});expect(current.items).toEqual([]);
});
