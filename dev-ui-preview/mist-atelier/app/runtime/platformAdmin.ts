import type { CompanySettingsSnapshot, CompanySettingsPatch } from '../../../../server/src/platform/companySettings';
import { apiService } from '../../../../services/apiService';
import { adoptIssuedSession, type AuthUser } from '../../../../services/authService';
export type Invitation = {status:'sent'|'unconfirmed'|'unavailable'|'cooldown'|'accepted'|'sending';message?:string;at?:string};
export type PlatformCompany = { id:string; slug:string; name:string; legalName?:string|null; status:'active'|'suspended'|'closed'; plan:string; seatLimit:number|null; members:number; workspaces:number; createdAt:string };
export type PlatformMember = { userId:string; displayName:string; email:string; accountStatus:string; memberStatus:string; jobTitle:string|null; joinedAt:string|null; invitation?:Invitation|null };
export type CompanyDraft = { name:string; slug:string; ownerName:string; ownerEmail:string;  seatLimit?:number|null };
async function call<T>(path:string, method='GET', body?:unknown, signal?:AbortSignal):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/platform'+path,{method,signal,credentials:'include',cache:'no-store',headers:{...apiService.getAuthHeaders(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new Error('平台服务连接失败，请检查网络后重试。');}
 let data:any;
 try{data=await response.json();}catch{throw new Error(`平台服务返回异常（HTTP ${response.status}），请重新读取或稍后重试。`);}
 if(!response.ok||data?.ok===false)throw new Error(data?.message||'操作未完成，请重试。');return data;
}
export type PlatformDefaults = { plan:string; seatLimit:number|null; version:number };
export type PlatformStaff = { id:string; displayName:string; email:string|null; status:string; lastLoginAt:string|null; invitation?:Invitation|null };
export type PlatformAudit = { id:string; action:string; targetId:string|null; createdAt:string; actor:{displayName:string;email:string|null} };
export const platformAdminApi={
 companySettings:(id:string,signal?:AbortSignal)=>call<{snapshot:CompanySettingsSnapshot}>('/companies/'+encodeURIComponent(id)+'/settings','GET',undefined,signal),
 saveCompanySettings:(id:string,input:{requestId:string;expectedRevision:number;patch:CompanySettingsPatch})=>call<{snapshot:CompanySettingsSnapshot;receipt:import('../../../../server/src/shared/mistWorkspace').MistRunReceipt}>('/companies/'+encodeURIComponent(id)+'/settings','PATCH',input),
 resendStaff:(id:string)=>call<{invitation:Invitation}>('/staff/'+encodeURIComponent(id)+'/invitation','POST',{}),
 resendMember:(companyId:string,userId:string)=>call<{invitation:Invitation}>('/companies/'+encodeURIComponent(companyId)+'/invitations/'+encodeURIComponent(userId),'POST',{}),
 settings:(signal?:AbortSignal)=>call<{defaults:PlatformDefaults}>('/settings','GET',undefined,signal),
 saveSettings:(defaults:PlatformDefaults)=>call<{defaults:PlatformDefaults}>('/settings','PATCH',defaults),
 createStaff:(draft:{displayName:string;email:string})=>call<{staff:PlatformStaff;invitation:Invitation}>('/staff','POST',draft),
 staff:(signal?:AbortSignal)=>call<{staff:PlatformStaff[]}>('/staff','GET',undefined,signal),
 updateStaff:(id:string,status:string)=>call('/staff/'+encodeURIComponent(id),'PATCH',{status}),
 audit:(page:number,signal?:AbortSignal)=>call<{logs:PlatformAudit[];total:number;page:number}>('/audit?page='+page,'GET',undefined,signal),
 list:(signal?:AbortSignal)=>call<{companies:PlatformCompany[]}>('/companies','GET',undefined,signal),
 create:(draft:CompanyDraft)=>call<{company:PlatformCompany;owner:{email:string};invitation:Invitation}>('/companies','POST',draft),
 update:(id:string,draft:{status:string;plan:string;seatLimit:number|null})=>call('/companies/'+encodeURIComponent(id),'PATCH',draft),
 members:(id:string,signal?:AbortSignal)=>call<{members:PlatformMember[]}>('/companies/'+encodeURIComponent(id)+'/members','GET',undefined,signal),
 addMember:(id:string,email:string)=>call('/companies/'+encodeURIComponent(id)+'/members','POST',{email}),
 enterCompany:(id:string)=>call<{token:string;user:AuthUser}>('/companies/'+encodeURIComponent(id)+'/management-session','POST',{}),
 exitCompany:()=>call<{token:string;user:AuthUser}>('/management-session/exit','POST',{}),
 removeMember:(id:string,userId:string)=>call('/companies/'+encodeURIComponent(id)+'/members/'+encodeURIComponent(userId),'DELETE'),
};

/** 平台切换公司范围后使用服务端签发的会话，保持真实平台身份。 */
export async function enterCompanyManagement(companyId:string){const result=await platformAdminApi.enterCompany(companyId);return adoptIssuedSession(result.token,result.user);}
export async function exitCompanyManagement(){const result=await platformAdminApi.exitCompany();return adoptIssuedSession(result.token,result.user);}
