import React from 'react';
import type { AssistantReply } from './assistantConversation';
import { mistApiRequest } from './workspace';

export function useReadOnlyAssistantHistory(messages: readonly AssistantReply[], scope: string,
  workspaceId: string | undefined, revision: number | undefined, enabled: boolean) {
  const [verified,setVerified] = React.useState<{scope:string;tokens:Set<string>}>();
  const turns = React.useMemo(() => {
    const pairs: Array<[AssistantReply,AssistantReply]> = [];
    for (let i=1;i<messages.length;i++) {
      const user = messages[i-1], assistant = messages[i];
      if (user?.role==='user' && assistant?.role==='assistant' && typeof user.content==='string' && typeof assistant.content==='string') pairs.push([user,assistant]);
    }
    return pairs;
  },[messages]);
  const tokens = React.useMemo(() => [...new Set(turns.map(([,reply])=>reply.contextToken)
    .filter((token):token is string=>typeof token==='string'&&token.length>0&&token.length<=8192))].slice(-20),[turns]);
  React.useEffect(()=>{
    if(!enabled||!workspaceId||!tokens.length)return;
    let request:AbortController|undefined;
    let live=true;
    const check=async()=>{
      if(request||document.visibilityState==='hidden')return;
      const controller=new AbortController();request=controller;
      const timer=window.setTimeout(()=>controller.abort(),5000);
      try {
        const response=await mistApiRequest('/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/assistant/history-access',{
          method:'POST',body:JSON.stringify({tokens}),signal:controller.signal,
        }) as {allowedTokens?:unknown};
        if(live&&!controller.signal.aborted&&Array.isArray(response.allowedTokens))
          setVerified({scope,tokens:new Set(response.allowedTokens.filter((token:unknown):token is string=>typeof token==='string'&&tokens.includes(token)))});
      } catch (cause) {
        if(live&&[401,403,404].includes(Number((cause as {status?:number})?.status)))setVerified({scope,tokens:new Set()});
      } finally {window.clearTimeout(timer);if(request===controller)request=undefined;}
    };
    const refresh=()=>void check();
    refresh();
    const interval=window.setInterval(refresh,10000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{live=false;request?.abort();window.clearInterval(interval);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[enabled,revision,scope,tokens,workspaceId]);
  const visible=turns.flatMap(([user,reply])=>verified?.scope===scope&&reply.contextToken&&verified.tokens.has(reply.contextToken)?[user,reply]:[]);
  const remember=(token:string)=>setVerified(previous=>({scope,tokens:new Set([...(previous?.scope===scope?previous.tokens:[]),token])}));
  return {visible,remember,hidden:turns.length*2>visible.length&&(verified?.scope===scope||!tokens.length)};
}
