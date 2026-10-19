import { apiService } from '../../../../services/apiService';
export type PlatformCompany = { id:string; slug:string; name:string; legalName?:string|null; status:'active'|'suspended'|'closed'; plan:string; seatLimit:number|null; members:number; workspaces:number; createdAt:string };
export type PlatformMember = { userId:string; displayName:string; email:string; accountStatus:string; memberStatus:string; jobTitle:string|null; joinedAt:string|null };
export type CompanyDraft = { name:string; slug:string; ownerName:string; ownerEmail:string; ownerPassword?:string; seatLimit?:number|null };
async function call<T>(path:string, method='GET', body?:unknown, signal?:AbortSignal):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/platform'+path,{method,signal,credentials:'include',cache:'no-store',headers:{...apiService.getAuthHeaders(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new Error('平台服务连接失败，请检查网络后重试。');}
 let data:any;
 try{data=await response.json();}catch{throw new Error(`平台服务返回异常（HTTP ${response.status}），请重新读取或稍后重试。`);}
 if(!response.ok||data?.ok===false)throw new Error(data?.message||'操作未完成，请重试。');return data;
}
export type PlatformDefaults = { plan:string; seatLimit:number|null; version:number };
export type PlatformStaff = { id:string; displayName:string; email:string|null; status:string; lastLoginAt:string|null };
export type PlatformAudit = { id:string; action:string; targetId:string|null; createdAt:string; actor:{displayName:string;email:string|null} };
export const platformAdminApi={
 settings:(signal?:AbortSignal)=>call<{defaults:PlatformDefaults}>('/settings','GET',undefined,signal),
 saveSettings:(defaults:PlatformDefaults)=>call<{defaults:PlatformDefaults}>('/settings','PATCH',defaults),
 createStaff:(draft:{displayName:string;email:string})=>call<{staff:PlatformStaff;initialPassword:string}>('/staff','POST',draft),
 staff:(signal?:AbortSignal)=>call<{staff:PlatformStaff[]}>('/staff','GET',undefined,signal),
 updateStaff:(id:string,status:string)=>call('/staff/'+encodeURIComponent(id),'PATCH',{status}),
 audit:(page:number,signal?:AbortSignal)=>call<{logs:PlatformAudit[];total:number;page:number}>('/audit?page='+page,'GET',undefined,signal),
 list:(signal?:AbortSignal)=>call<{companies:PlatformCompany[]}>('/companies','GET',undefined,signal),
 create:(draft:CompanyDraft)=>call<{company:PlatformCompany;owner:{email:string};initialPassword?:string}>('/companies','POST',draft),
 update:(id:string,draft:{status:string;plan:string;seatLimit:number|null})=>call('/companies/'+encodeURIComponent(id),'PATCH',draft),
 members:(id:string,signal?:AbortSignal)=>call<{members:PlatformMember[]}>('/companies/'+encodeURIComponent(id)+'/members','GET',undefined,signal),
 addMember:(id:string,email:string)=>call('/companies/'+encodeURIComponent(id)+'/members','POST',{email}),
 removeMember:(id:string,userId:string)=>call('/companies/'+encodeURIComponent(id)+'/members/'+encodeURIComponent(userId),'DELETE'),
};
