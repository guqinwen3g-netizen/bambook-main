import { getAuthApiBase } from '../../../../services/authService';
async function request(path:string,body:unknown){
 let response:Response;
 try{response=await fetch(getAuthApiBase()+'/auth/account-access/'+path,{method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(35000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}catch(e){throw new Error(e instanceof Error&&e.name==='TimeoutError'?(path==='complete'?'请求结果未确认，可先尝试使用新密码登录。':'请求结果未确认，请检查邮箱后再试。'):'连接失败，请检查网络后重试。');}
 let value:any;try{value=await response.json();}catch{throw new Error('账号服务暂不可用，请稍后重试。');}
 if(!response.ok||value.ok===false)throw new Error(value.message||'操作未完成，请重试。');return value;
}
export const accountAccessApi={requestRecovery:(email:string)=>request('request',{email}),complete:(input:{email:string;kind:'invite'|'recovery';token:string;password:string;mfaCode:string})=>request('complete',input)};
