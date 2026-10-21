import React from 'react';

const STORAGE_KEY='bambook.account-recovery.retry-at';
function storedDeadline(){
 try{const value=Number(sessionStorage.getItem(STORAGE_KEY));return Number.isFinite(value)&&value>Date.now()&&value<=Date.now()+3600000?value:0;}catch{return 0;}
}
/** Persist only a deadline, never an email or token. Delivery limits remain server-enforced. */
export function useRecoveryCooldown(enabled=true){
 const [deadline,setDeadline]=React.useState(storedDeadline),[now,setNow]=React.useState(Date.now);
 React.useEffect(()=>{
  if(!enabled||deadline<=Date.now())return;
  const update=()=>{const at=Date.now();setNow(at);if(at>=deadline)clearInterval(timer);};
  const timer=setInterval(update,1000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[deadline,enabled]);
 const start=React.useCallback((seconds=60)=>{
  const at=Date.now(),value=at+Math.min(3600,Math.max(1,Number.isFinite(seconds)?Math.ceil(seconds):60))*1000;
  setDeadline(value);setNow(at);try{sessionStorage.setItem(STORAGE_KEY,String(value));}catch{/* In-memory countdown still works when storage is unavailable. */}
 },[]);
 return{remaining:Math.max(0,Math.ceil((deadline-now)/1000)),start};
}
