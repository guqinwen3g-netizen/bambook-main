import {createContext,useCallback,useContext,useLayoutEffect,useRef} from 'react';

type PageNavigationGuard=(proceed:()=>void)=>void;
type RegisterGuard=(guard:PageNavigationGuard)=>()=>void;
export const PageNavigationGuardContext=createContext<RegisterGuard|undefined>(undefined);

/** Pages explicitly opt into guarding exits; completed writes and other pages keep normal navigation. */
export function usePageNavigationController(){
  const guards=useRef<Array<{guard:PageNavigationGuard;active:boolean}>>([]);
  const register=useCallback<RegisterGuard>(guard=>{
    const entry={guard,active:true};guards.current.push(entry);
    return()=>{entry.active=false;guards.current=guards.current.filter(item=>item!==entry);};
  },[]);
  const hasGuard=useCallback(()=>guards.current.length>0,[]);
  const attempt=useCallback((navigate:()=>void)=>{
    const entry=guards.current[guards.current.length-1];
    if(!entry){navigate();return;}
    entry.guard(()=>{if(entry.active)navigate();});
  },[]);
  return{register,attempt,hasGuard};
}

export function usePageNavigationGuard(guard:PageNavigationGuard,enabled:boolean){
  const register=useContext(PageNavigationGuardContext),current=useRef(guard);
  useLayoutEffect(()=>{current.current=guard;},[guard]);
  const invoke=useCallback((proceed:()=>void)=>current.current(proceed),[]);
  useLayoutEffect(()=>enabled?register?.(invoke):undefined,[register,invoke,enabled]);
}
