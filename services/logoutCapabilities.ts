/** Persist only logout-purpose capabilities, never a login credential. Active tickets stay tab-local; pending tickets survive reload. */
export type LogoutCapability={ticket:string;userId:string};
const ACTIVE='bambook_logout_active:',PENDING='bambook_logout_pending:';
const scope=(base:string)=>encodeURIComponent(base)+':';
const pendingKey=(base:string,cap:LogoutCapability)=>PENDING+scope(base)+cap.ticket.slice(cap.ticket.lastIndexOf('.')+1);
function parse(value:string|null):LogoutCapability|undefined{try{const row=JSON.parse(value||'null');return row&&typeof row.ticket==='string'&&row.ticket&&row.ticket.length<=8192&&typeof row.userId==='string'?{ticket:row.ticket,userId:row.userId}:undefined;}catch{return;}}
export function activeLogoutCapability(base:string):LogoutCapability|undefined{try{return parse(sessionStorage.getItem(ACTIVE+scope(base)));}catch{return;}}
export function storeLogoutCapability(base:string,ticket:unknown,userId:string):void{if(typeof ticket!=='string'||!ticket||ticket.length>8192)return;try{sessionStorage.setItem(ACTIVE+scope(base),JSON.stringify({ticket,userId}));}catch{}}
export function clearActiveLogoutCapability(base:string):void{try{sessionStorage.removeItem(ACTIVE+scope(base));}catch{}}
export function pendingLogoutCapabilities(base:string):LogoutCapability[]{try{const prefix=PENDING+scope(base),rows:LogoutCapability[]=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix)){const row=parse(localStorage.getItem(key));if(row)rows.push(row);}}return rows;}catch{return[];}}
export function queueLogoutCapability(base:string,userId?:string):LogoutCapability|undefined{const stored=activeLogoutCapability(base),cap=stored&&(!userId||stored.userId===userId)?stored:undefined;if(cap)try{localStorage.setItem(pendingKey(base,cap),JSON.stringify(cap));}catch{}clearActiveLogoutCapability(base);return cap;}
export function confirmLogoutCapability(base:string,cap:LogoutCapability):void{try{localStorage.removeItem(pendingKey(base,cap));}catch{}}
export function confirmUserLogoutCapabilities(base:string,userId:string):void{for(const cap of pendingLogoutCapabilities(base))if(cap.userId===userId)confirmLogoutCapability(base,cap);const active=activeLogoutCapability(base);if(active?.userId===userId)clearActiveLogoutCapability(base);}
