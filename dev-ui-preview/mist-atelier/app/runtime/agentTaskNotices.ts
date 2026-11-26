import React from 'react';
import type {AgentTaskNotice} from '../../../../server/src/shared/mistAgentTasks';
import type {MistNotification} from '../../../../server/src/shared/mistWorkspace';
import {canPlayNotificationSound,playNotificationSound} from '../../../../services/uiSoundService';
import {markNoticeSounds} from './notificationSound';
import {withRequestDeadline} from './requestDeadline';
import type {MistWorkspaceContext} from './workspace';

export type AgentTaskNotices={items:AgentTaskNotice[];loading:boolean;reading:boolean;error:string;read:(items:AgentTaskNotice[])=>Promise<void>;refresh:()=>Promise<void>};
type Request=(path:string,init?:RequestInit)=>Promise<any>;
const NOTICE_REQUEST_TIMEOUT=8_000;
export function agentTaskNoticeScope(sessionKey:string,workspaceId:string|undefined,user:{id:string;platformRole?:string|null;platformCompany?:unknown}|null){
 return workspaceId&&user&&user.platformRole!=='platform_admin'&&!user.platformCompany?JSON.stringify([sessionKey,user.id,workspaceId]):'';
}
export function useAgentTaskNotices(scope:string,workspaceId:string|undefined,request:Request,soundScope=scope):AgentTaskNotices{
 const [snapshot,setSnapshot]=React.useState<{scope:string;items:AgentTaskNotice[];error:string}>({scope:'',items:[],error:''}),[loading,setLoading]=React.useState(false),[reading,setReading]=React.useState(false);
 const activeScope=React.useRef(scope);activeScope.current=scope;
 const generation=React.useRef(0),controller=React.useRef<AbortController|null>(null),writeController=React.useRef<AbortController|null>(null),previous=React.useRef<AgentTaskNotice[]|null>(null),inFlight=React.useRef(false),writeBusy=React.useRef(false);
 const base=workspaceId?'/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-task-notices':'';
 const load=React.useCallback(async(force=false)=>{
  if(!scope||!base||inFlight.current&&!force)return;
  const serial=++generation.current,abort=new AbortController();controller.current?.abort();controller.current=abort;inFlight.current=true;setLoading(true);
  let invalidResponse=false;
  try{
   const result=await withRequestDeadline(abort,NOTICE_REQUEST_TIMEOUT,'任务提醒读取超时',signal=>request(base,{signal}));
   if(serial!==generation.current||activeScope.current!==scope)return;
   invalidResponse=!Array.isArray(result?.items)||result.items.length>30||result.items.some((n:AgentTaskNotice)=>!n||typeof n.id!=='string'||typeof n.key!=='string'||typeof n.taskId!=='string'||typeof n.title!=='string'||n.target?.view!=='assistant'||n.target?.section!=='tasks'||n.target?.id!==n.taskId);
   if(invalidResponse)throw Error('任务提醒响应无效');
   const items=result.items as AgentTaskNotice[],seen=previous.current;
   if(seen){const old=new Set(seen.map(n=>n.id)),fresh=items.filter(n=>!n.readAt&&!old.has(n.id)).map(n=>n.id);if(fresh.length&&canPlayNotificationSound()&&markNoticeSounds(soundScope,fresh))playNotificationSound();}
   previous.current=items;setSnapshot({scope,items,error:''});
  }catch(e){
   if(serial!==generation.current||activeScope.current!==scope)return;
   const status=(e as {status?:number})?.status??0;
   const transient=!invalidResponse&&(status===0||status===408||status===429||status>=500);
   if(!transient)previous.current=null;
   setSnapshot({scope,items:previous.current??[],error:e instanceof Error?e.message:'任务提醒读取失败'});
  }
  finally{if(serial===generation.current&&activeScope.current===scope){inFlight.current=false;setLoading(false);}}
 },[scope,base,request,soundScope]);
 React.useEffect(()=>{
  generation.current++;inFlight.current=false;writeBusy.current=false;previous.current=null;setReading(false);setLoading(false);controller.current?.abort();writeController.current?.abort();writeController.current=null;
  if(!scope||!base)return;
  void load();const timer=setInterval(()=>void load(),15_000),focus=()=>void load(),changed=()=>void load(true);
  window.addEventListener('focus',focus);window.addEventListener('bambook:agent-task-update',changed);
  return()=>{generation.current++;inFlight.current=false;controller.current?.abort();writeController.current?.abort();writeController.current=null;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('bambook:agent-task-update',changed);};
 },[scope,base,load]);
 const read=React.useCallback(async(items:AgentTaskNotice[])=>{
  if(!items.length)return;if(!scope||!base||activeScope.current!==scope||writeBusy.current)throw Error('请刷新当前任务提醒');
  const abort=new AbortController();writeController.current=abort;writeBusy.current=true;setReading(true);
  const current=()=>activeScope.current===scope&&writeController.current===abort;
  try{
   const result=await withRequestDeadline(abort,NOTICE_REQUEST_TIMEOUT,'标记已读超时',signal=>request(base+'/read',{
    method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items.map(n=>({taskId:n.taskId,key:n.key}))}),
   }));
   if(!current())throw Error('账号或公司已切换');
   if(result?.read!==true)throw Error('任务提醒响应无效');
   await load(true);
  }
  catch(e){if(!current())throw Error('账号或公司已切换');void load(true);throw e;}
  finally{if(current()){writeController.current=null;writeBusy.current=false;setReading(false);}}
 },[scope,base,request,load]);
 const current=snapshot.scope===scope&&!!scope;
 return{items:current?snapshot.items:[],error:current?snapshot.error:'',loading:!!scope&&loading,reading:!!scope&&reading,read,refresh:()=>load(true)};
}

export function readMistNotice(workspace:MistWorkspaceContext,notice:MistNotification):Promise<unknown>{
 if(notice.readAt)return Promise.resolve();
 if(notice.id.startsWith('agent-task:')){const item=workspace.agentTaskNotices?.items.find(n=>n.id===notice.id);if(!item)return Promise.reject(Error('请刷新当前任务提醒'));return workspace.agentTaskNotices!.read([item]);}
 return workspace.run({type:'notification.read',payload:{id:notice.id}});
}
export function mistNoticeTarget(notice:MistNotification):MistNotification['target']{
 const target=notice.target;
 return opensOriginalAgentTask(notice)
  ? {...target,section:'task-origin'} : target;
}
export function opensOriginalAgentTask(notice:MistNotification) {
 const target=notice.target;
 return notice.id.startsWith('agent-task:')&&target?.view==='assistant'&&target.section==='tasks'&&!!target.id;
}

export async function openMistNotice(workspace:MistWorkspaceContext,notice:MistNotification,open:(target:MistNotification['target'])=>void){
 const target=mistNoticeTarget(notice);
 if(opensOriginalAgentTask(notice)){
  open(target);
  try{await readMistNotice(workspace,notice);}
  catch{throw Error('提醒未标为已读');}
 }else{
  await readMistNotice(workspace,notice);
  if(target)open(target);
 }
}
export async function readAllMistNotices(workspace:MistWorkspaceContext,visible:MistNotification[]):Promise<void>{
 const unread=visible.filter(n=>!n.readAt),ids=new Set(unread.map(n=>n.id)),personal=workspace.agentTaskNotices?.items.filter(n=>ids.has(n.id))??[];
 await Promise.all([...(unread.some(n=>!n.id.startsWith('agent-task:'))?[workspace.run({type:'notification.readAll',payload:{}})]:[]),...(personal.length?[workspace.agentTaskNotices!.read(personal)]:[])]);
}
