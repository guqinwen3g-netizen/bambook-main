/** Only non-secret connection identities are cached. Credentials stay in this scope and the host's memory. */
import React from 'react';
import {apiService} from '../../../../../services/apiService';
import type {AssistantBridge} from './WorkAssistantPage';
type Readable={type:string;label:string};
type View={scope:string;phase:'idle'|'connecting'|'connected'|'error';readable:Readable[];expiresAt:string|null;error:string};
const empty=(scope:string):View=>({scope,phase:'idle',readable:[],expiresAt:null,error:''});
type Intent={kind:'create';id:string}|{kind:'renew';id:string;version:number;requestId:string};
export function useAssistantDelegation(input:{bridge:AssistantBridge|null;accountKey:string;scope:string;workspaceId?:string;enabled:boolean}){
 const {bridge,accountKey,scope,workspaceId,enabled}=input,current=React.useRef(scope);current.current=scope;
 const manual=React.useRef<(()=>Promise<void>)|null>(null),needed=React.useRef<((reason:string)=>void)|null>(null);
 const [view,setView]=React.useState<View>(()=>empty(scope));
 const renew=React.useCallback(async()=>{await manual.current?.();},[]),handleNeeded=React.useCallback((reason:string)=>needed.current?.(reason),[]);
 React.useEffect(()=>{
  if(!bridge||!accountKey)return;
  let stopped=false,pending:Promise<void>|null=null,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined,intent:Intent|null=null,blocked=false,id:string|null=null,epoch=0;
  const key='bambook.agent.desktop.'+accountKey+'|'+workspaceId;
  try{const saved=JSON.parse(sessionStorage.getItem(key)??'null');if(typeof saved?.id==='string'){id=saved.id;blocked=saved.blocked===true;}}catch{/* Non-secret cache is optional. */}
  const cache=()=>{try{sessionStorage.setItem(key,JSON.stringify({id,blocked}));}catch{/* No credential is persisted. */}};
  const isCurrent=()=>!stopped&&current.current===scope;
  const bind=async(params:unknown)=>{const result=await bridge.request('session.delegation',params);if(!result.ok)throw new Error(result.error?.message??'业务授权没有连接到本机助手');return result.result as {connected:boolean;workspaceId:string|null};};
  const cleared=bind({accountKey,clear:true});void cleared.catch(()=>undefined);
  const api=async(path:string,body?:unknown)=>{const response=await fetch(path,{method:body?'POST':'GET',headers:{...apiService.getAuthHeaders(),...(body?{'Content-Type':'application/json'}:{})},credentials:'include',cache:'no-store',...(body?{body:JSON.stringify(body)}:{}),signal:controller!.signal});const value=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error(value?.error?.message??'业务连接未完成，请重试'),{status:response.status,code:value?.error?.code});return value;};
  const connect=(explicit=false):Promise<void>=>{
   if(pending)return pending;if(!enabled||!workspaceId||!isCurrent())return Promise.resolve();
   if(blocked&&!explicit){setView({...empty(scope),phase:'error',error:'业务连接已失效，请重新连接'});return Promise.resolve();}
   const serial=epoch;clearTimeout(timer);setView(v=>({...v,scope,phase:'connecting',error:''}));
   pending=(async()=>{try{
    await cleared;if(!isCurrent()||serial!==epoch)return;controller=new AbortController();
    const base='/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-connections';
    if(!intent){
     if(id){let metadata:any;try{metadata=await api(base+'/'+encodeURIComponent(id));}catch(error){if(explicit&&(error as any)?.status===404)id=null;else throw error;}if(metadata?.state==='revoked'){if(!explicit)throw Object.assign(new Error('业务连接已撤销，请重新连接'),{status:410});id=null;}else if(metadata)intent={kind:'renew',id:id!,version:metadata.version,requestId:crypto.randomUUID()};}
     if(!id){id=crypto.randomUUID();intent={kind:'create',id};cache();}
    }
    const plan=intent!;
    const result=plan.kind==='create'?await api('/api/mist/agent/delegations',{workspaceId,id:plan.id}):await api(base+'/'+encodeURIComponent(plan.id)+'/renew',{requestId:plan.requestId,version:plan.version});
    const d=result?.delegation;if(typeof d?.token!=='string'||!d.token||typeof d.expiresAt!=='string'||!Number.isFinite(Date.parse(d.expiresAt))||Date.parse(d.expiresAt)<=Date.now()||result.connection?.id!==plan.id||!Array.isArray(result.readable)||result.readable.some((r:any)=>typeof r?.type!=='string'||typeof r?.label!=='string'))throw new Error('业务授权响应无效，请重试');
    if(!isCurrent()||serial!==epoch)return;
    const bound=await bind({accountKey,token:d.token,expiresAt:d.expiresAt,workspaceId,apiBase:location.origin});if(!isCurrent()||serial!==epoch)return;if(!bound.connected||bound.workspaceId!==workspaceId)throw new Error('业务授权的公司不一致，请重新连接');
    intent=null;blocked=false;cache();setView({scope,phase:'connected',readable:result.readable.map((r:Readable)=>({type:r.type,label:r.label.slice(0,40)})),expiresAt:d.expiresAt,error:''});
    timer=setTimeout(()=>void connect(),Math.max(30_000,Date.parse(d.expiresAt)-Date.now()-10*60_000));
   }catch(error){if(!isCurrent()||serial!==epoch)return;const status=(error as any)?.status;if([401,403,404,410].includes(status)){blocked=true;intent=null;cache();void bind({accountKey,clear:true}).catch(()=>undefined);}setView({...empty(scope),phase:'error',error:error instanceof Error?error.message:'业务连接未完成'});if(!blocked)timer=setTimeout(()=>void connect(),60_000);}
   finally{pending=null;controller=null;}})();return pending;
  };
  const reject=()=>{epoch++;controller?.abort();clearTimeout(timer);blocked=true;intent=null;cache();void bind({accountKey,clear:true}).catch(()=>undefined);if(isCurrent())setView({...empty(scope),phase:'error',error:'业务连接已失效，请重新连接'});};
  const onNeeded=(reason:string)=>{if(reason==='rejected')reject();else void connect();};
  const explicit=async()=>{if(blocked){await pending;intent=null;}await connect(true);};manual.current=explicit;needed.current=onNeeded;setView(empty(scope));void connect();
  return()=>{stopped=true;epoch++;controller?.abort();clearTimeout(timer);if(manual.current===explicit)manual.current=null;if(needed.current===onNeeded)needed.current=null;void bind({accountKey,clear:true}).catch(()=>undefined);};
 },[bridge,accountKey,scope,workspaceId,enabled]);
 return{...(view.scope===scope?view:empty(scope)),renew,handleNeeded};
}
