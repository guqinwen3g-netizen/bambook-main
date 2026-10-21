import { getAuthApiBase } from '../../../../services/authService';
export class AccountAccessError extends Error {
 constructor(message:string, public readonly code?:string, public readonly retryAfterSeconds=0){super(message);this.name='AccountAccessError';}
}
function retryAfter(value:unknown){const seconds=Number(value);return Number.isFinite(seconds)?Math.min(3600,Math.max(0,Math.ceil(seconds))):0;}
async function request(path:string,body:unknown){
 let response:Response;
 try{response=await fetch(getAuthApiBase()+'/auth/account-access/'+path,{method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(35000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}catch(e){const timeout=e instanceof Error&&e.name==='TimeoutError';throw new AccountAccessError(timeout?(path==='complete'?'结果尚未确认，请尝试使用新密码登录。':'结果尚未确认，请先检查邮箱。'):'连接失败，请检查网络后重试。',timeout?'REQUEST_UNCONFIRMED':'NETWORK_ERROR',timeout&&path==='request'?60:0);}
 let value:any;try{value=await response.json();}catch{throw new AccountAccessError(response.status===429?'操作频繁，请稍后重试。':'服务暂不可用，请稍后重试。',response.status===429?'RATE_LIMITED':'SERVICE_UNAVAILABLE',retryAfter(response.headers.get('Retry-After')));}
 if(!response.ok||value.ok===false)throw new AccountAccessError(value.message||'操作未完成，请重试。',value.code,Math.max(retryAfter(response.headers.get('Retry-After')),retryAfter(value.retryAfterSeconds)));return value;
}
export const accountAccessApi={requestRecovery:(email:string)=>request('request',{email}),complete:(input:{email:string;kind:'invite'|'recovery';token:string;password:string})=>request('complete',input)};
