import { apiService } from '../../../../services/apiService';
export type PlatformCompany = { id:string; slug:string; name:string; legalName?:string|null; status:'active'|'suspended'|'closed'; plan:string; seatLimit:number|null; members:number; workspaces:number; createdAt:string };
export type PlatformMember = { userId:string; displayName:string; email:string; accountStatus:string; memberStatus:string; jobTitle:string|null; joinedAt:string|null };
export type CompanyDraft = { name:string; slug:string; ownerName:string; ownerEmail:string; ownerPassword?:string; seatLimit?:number|null };
async function call<T>(path:string, method='GET', body?:unknown, signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/platform'+path,{method,signal,credentials:'include',cache:'no-store',headers:{...apiService.getAuthHeaders(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();if(!response.ok||data?.ok===false)throw new Error(data?.message||'操作未完成，请重试。');return data;
}
export const platformAdminApi={
 list:(signal?:AbortSignal)=>call<{companies:PlatformCompany[]}>('/companies','GET',undefined,signal),
 create:(draft:CompanyDraft)=>call<{company:PlatformCompany;owner:{email:string};initialPassword?:string}>('/companies','POST',draft),
 update:(id:string,draft:{status:string;plan:string;seatLimit:number|null})=>call('/companies/'+encodeURIComponent(id),'PATCH',draft),
 members:(id:string,signal?:AbortSignal)=>call<{members:PlatformMember[]}>('/companies/'+encodeURIComponent(id)+'/members','GET',undefined,signal),
 addMember:(id:string,email:string)=>call('/companies/'+encodeURIComponent(id)+'/members','POST',{email}),
 removeMember:(id:string,userId:string)=>call('/companies/'+encodeURIComponent(id)+'/members/'+encodeURIComponent(userId),'DELETE'),
};
