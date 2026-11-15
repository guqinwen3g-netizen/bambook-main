import {createContext,useCallback,useRef} from 'react';

type RegisterPageBack=(action:()=>void)=>()=>void;
export const PageBackRegistrationContext=createContext<RegisterPageBack|undefined>(undefined);

/** Topbar and page backlinks share the page's own guard/return action. */
export function usePageBackAction(fallback:()=>void){
  const actions=useRef<Array<{action:()=>void}>>([]);
  const register=useCallback<RegisterPageBack>(action=>{
    const entry={action};actions.current.push(entry);
    return()=>{actions.current=actions.current.filter(current=>current!==entry);};
  },[]);
  const back=useCallback(()=>{
    const current=actions.current[actions.current.length-1];
    if(current)current.action();else fallback();
  },[fallback]);
  return{register,back};
}
