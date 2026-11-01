import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import type {TokenPayload} from '../auth/service';
import {hasScope} from '../auth/permissionService';
import type {AgentIdentityView,AgentIdentityEvent} from '../shared/mistAgentIdentities';
import type {AgentActor} from './agentDelegation';
import {AGENT_OPERATE_CEILING,WORK_ASSISTANT_CEILING} from './agentDelegation';
import {fail} from './errors';

export const SERVICE_PREFIX='mist-revision:agent-identity:';
export const SERVICE_HASH='mist-agent-identity:v1';
export const SERVICE_FIELD='__agentIdentity';
const EVENT_PREFIX='mist-revision:agent-identity-event:';
const EVENT_HASH='mist-agent-identity-event:v1';
export const SERVICE_KEY_HEADER='x-bambook-agent-key';
export const SERVICE_KEY_TTL_MS=90*24*60*60*1000;
type Key={generation:string;hash:string;issuedAt:number;expiresAt:number;mode:'read'|'operate';ceiling:string[];credentialVersion?:string;revokedAt?:string};
export type AgentServiceLease={id:string;workspaceId:string;hash:string;ownerId:string;issuedAt:number;expiresAt:number};
export type AgentIdentity={schemaVersion:1;id:string;workspaceId:string;companyId?:string;name:string;ownerId:string;ownerName:string;mode:'read'|'operate';version:number;enabled:boolean;createdAt:string;createdBy:string;key?:Key;lastRequestId:string;lastExpectedVersion?:number;lastAction:string};
export type MakeServiceCredential=(workspaceId:string,id:string,generation:string)=>string;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function identifier(v:unknown):string{if(!uuid(v))fail('INVALID_INPUT','Agent身份编号无效',400);return v;}
function requestId(v:unknown):string{if(typeof v!=='string'||!v||v.trim()!==v||v.length>116)fail('INVALID_INPUT','操作编号无效',400);return v;}
const eventRequest=(id:string,rid:string)=>EVENT_PREFIX+id+':'+hash(rid).slice(0,32);
async function unusedOperation(db:any,c:AgentIdentity,rid:string){if(await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId:c.workspaceId,requestId:eventRequest(c.id,rid)}}}))fail('CONFLICT','操作编号已使用，请刷新后重试',409);}
async function appendEvent(db:any,c:AgentIdentity,actor:TokenPayload,action:AgentIdentityEvent['action'],rid:string,now:number){
 const event:AgentIdentityEvent={action,actor:{id:actor.userId,name:actor.displayName||actor.userId},at:new Date(now).toISOString(),version:c.version,ownerId:c.ownerId,ownerName:c.ownerName,mode:c.mode,enabled:c.enabled};
 await db.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId:c.workspaceId,requestId:eventRequest(c.id,rid),actorId:actor.userId,inputHash:EVENT_HASH,expectedRevision:0,result:{revision:0,identityId:c.id,event},createdAt:new Date(now)}});
}
export function serviceCanManage(actor:TokenPayload){return (actor as any).serviceIdentityAdmin===true||hasScope(actor,'users:write');}
function read(row:any,workspaceId:string):AgentIdentity{
  const c=row?.result?.[SERVICE_FIELD];
  if(!c||row.inputHash!==SERVICE_HASH||row.workspaceId!==workspaceId||c.workspaceId!==workspaceId||c.schemaVersion!==1||row.requestId!==SERVICE_PREFIX+c.id||row.actorId!==c.ownerId||!Number.isSafeInteger(c.version)||c.version<1)fail('NOT_FOUND','Agent身份不存在或无权访问',404);
  return c;
}
export async function identityRecord(db:any,workspaceId:string,id:string){const row=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:SERVICE_PREFIX+identifier(id)}}});return{row,value:read(row,workspaceId)};}
export function identityView(c:AgentIdentity,actor:TokenPayload,now:number,ownerActive=true,ownerName=c.ownerName):AgentIdentityView{
  const key=c.key,own=c.ownerId===actor.userId;
  const state=!c.enabled?'disabled':!ownerActive?'invalid':!key?'pending':key.revokedAt?'revoked':key.expiresAt<=now?'expired':own&&(!hasScope(actor,'ai:chat')||key.credentialVersion!==actor.credentialVersion)?'invalid':'active';
  return{id:c.id,name:c.name,ownerId:c.ownerId,ownerName,mode:c.mode,version:c.version,state,createdAt:c.createdAt,...(key?{expiresAt:new Date(key.expiresAt).toISOString(),activatedAt:new Date(key.issuedAt).toISOString()}:{}),canManage:serviceCanManage(actor),canIssue:own&&c.enabled&&hasScope(actor,'ai:chat'),canRevoke:(own||serviceCanManage(actor))&&!!key&&!key.revokedAt};
}
async function save(db:any,row:any,c:AgentIdentity,next:AgentIdentity){
  const updated=await db.mistCommandReceipt.updateMany({where:{id:row.id,workspaceId:c.workspaceId,inputHash:SERVICE_HASH,result:{path:[SERVICE_FIELD,'version'],equals:c.version}},data:{actorId:next.ownerId,result:{revision:0,[SERVICE_FIELD]:next}}});
  if(updated.count!==1)fail('AGENT_IDENTITY_CHANGED','Agent身份已更新，请刷新重试',409);
}
export async function listIdentities(db:any,actor:TokenPayload,workspaceId:string,now:number,directory:Array<{id:string;name:string;active:boolean}>,scope:unknown='mine',cursor?:unknown){
  const manager=serviceCanManage(actor);if(!['mine','company'].includes(scope as string))fail('INVALID_INPUT','查询范围无效',400);if(scope==='company'&&!manager)fail('FORBIDDEN','没有Agent身份管理权限',403);
  const where:any={workspaceId,inputHash:SERVICE_HASH,requestId:{startsWith:SERVICE_PREFIX},...(scope!=='company'?{actorId:actor.userId}:{})};
  if(cursor!==undefined){if(typeof cursor!=='string'||cursor.length>300||!/^[A-Za-z0-9_-]+$/.test(cursor))fail('INVALID_INPUT','翻页位置无效',400);let p:any;try{p=JSON.parse(Buffer.from(cursor as string,'base64url').toString());}catch{fail('INVALID_INPUT','翻页位置无效',400);}if(!uuid(p?.id)||typeof p?.at!=='string'||!Number.isFinite(Date.parse(p.at)))fail('INVALID_INPUT','翻页位置无效',400);where.OR=[{createdAt:{lt:new Date(p.at)}},{createdAt:new Date(p.at),id:{lt:p.id}}];}
  const rows=await db.mistCommandReceipt.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:31}),page=rows.slice(0,30),last=page.at(-1);
  return{items:page.map((row:any)=>{const c=read(row,workspaceId),owner=directory.find(m=>m.id===c.ownerId);return identityView(c,actor,now,owner?.active===true,owner?.name??c.ownerName);}),canManage:manager,owners:manager&&scope==='company'?directory.filter(m=>m.active).map(({id,name})=>({id,name})):[],nextCursor:rows.length>30&&last?Buffer.from(JSON.stringify({at:new Date(last.createdAt).toISOString(),id:last.id})).toString('base64url'):null};
}
export async function createIdentity(db:any,actor:TokenPayload,workspaceId:string,input:Record<string,unknown>,owner:{id:string;name:string},now:number,companyId?:string){
  if(!serviceCanManage(actor))fail('FORBIDDEN','没有Agent身份管理权限',403);
  const id=identifier(input.id),name=typeof input.name==='string'?input.name.trim():'';
  if(Object.keys(input).some(k=>!['id','name','ownerId','mode'].includes(k))||!name||name.length>60||/[\u0000-\u001f\u007f]/.test(name)||!['read','operate'].includes(input.mode as string))fail('INVALID_INPUT','请填写Agent名称、责任人和权限',400);
  const existing=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:SERVICE_PREFIX+id}}});
  if(existing){const c=read(existing,workspaceId);if(c.version!==1||c.name!==name||c.ownerId!==owner.id||c.mode!==input.mode||c.createdBy!==actor.userId)fail('AGENT_IDENTITY_CHANGED','Agent身份已更新，请刷新重试',409);return identityView(c,actor,now);}
  const c:AgentIdentity={schemaVersion:1,id,workspaceId,...(companyId?{companyId}:{}),name,ownerId:owner.id,ownerName:owner.name,mode:input.mode as 'read'|'operate',version:1,enabled:true,createdAt:new Date(now).toISOString(),createdBy:actor.userId,lastRequestId:id,lastAction:'created'};
  await db.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId,requestId:SERVICE_PREFIX+id,actorId:owner.id,inputHash:SERVICE_HASH,expectedRevision:0,result:{revision:0,[SERVICE_FIELD]:c},createdAt:new Date(now)}});
  await appendEvent(db,c,actor,'created',id,now);
  return identityView(c,actor,now);
}
export async function configureIdentity(db:any,actor:TokenPayload,workspaceId:string,id:string,input:Record<string,unknown>,owner:{id:string;name:string},now:number){
  if(!serviceCanManage(actor))fail('FORBIDDEN','没有Agent身份管理权限',403);
  if(Object.keys(input).some(k=>!['requestId','version','name','ownerId','mode','enabled'].includes(k)))fail('INVALID_INPUT','Agent身份字段无效',400);
  const rid=requestId(input.requestId),{row,value:c}=await identityRecord(db,workspaceId,id);
  const name=typeof input.name==='string'?input.name.trim():'';
  if(!name||name.length>60||/[\u0000-\u001f\u007f]/.test(name)||!['read','operate'].includes(input.mode as string)||typeof input.enabled!=='boolean')fail('INVALID_INPUT','Agent身份字段无效',400);
  if(c.lastRequestId===rid&&c.lastAction==='configured'){if(input.version!==c.lastExpectedVersion||name!==c.name||owner.id!==c.ownerId||input.mode!==c.mode||input.enabled!==c.enabled)fail('CONFLICT','操作编号已用于其他内容',409);return identityView(c,actor,now);}
  if(input.version!==c.version)fail('AGENT_IDENTITY_CHANGED','Agent身份已更新，请刷新重试',409);
  await unusedOperation(db,c,rid);
  const next:AgentIdentity={...c,name,ownerId:owner.id,ownerName:owner.name,mode:input.mode as 'read'|'operate',enabled:input.enabled,version:c.version+1,lastRequestId:rid,lastExpectedVersion:c.version,lastAction:'configured'};
  // Reassignment, mode changes and disabling never reactivate a previously delivered key.
  if(c.ownerId!==next.ownerId||c.mode!==next.mode||!next.enabled)next.key=undefined;
  await save(db,row,c,next);await appendEvent(db,next,actor,'configured',rid,now);return identityView(next,actor,now);
}
export async function issueServiceKey(db:any,actor:TokenPayload,workspaceId:string,id:string,input:Record<string,unknown>,make:MakeServiceCredential,now:number){
  if(Object.keys(input).some(k=>!['requestId','version'].includes(k)))fail('INVALID_INPUT','密钥字段无效',400);
  const rid=requestId(input.requestId),{row,value:c}=await identityRecord(db,workspaceId,id);
  if(c.ownerId!==actor.userId)fail('FORBIDDEN','长期凭据须由责任人本人启用',403);
  if(!c.enabled||!hasScope(actor,'ai:chat'))fail('FORBIDDEN','Agent身份或责任人权限已停用',403);
  if(c.lastRequestId===rid&&c.lastAction==='issued'&&c.key){
    if(input.version!==c.lastExpectedVersion||c.key.revokedAt||c.key.expiresAt<=now||c.key.credentialVersion!==actor.credentialVersion||now-c.key.issuedAt>5*60_000)fail('AGENT_IDENTITY_CHANGED','密钥已更新，请重新轮换',409);
    const token=make(workspaceId,c.id,c.key.generation);if(!equal(hash(token),c.key.hash))fail('AGENT_IDENTITY_CHANGED','签发环境已更新，请重新轮换密钥',409);
    return{identity:identityView(c,actor,now),token};
  }
  if(input.version!==c.version)fail('AGENT_IDENTITY_CHANGED','Agent身份已更新，请刷新重试',409);
  await unusedOperation(db,c,rid);
  const generation=randomUUID(),token=make(workspaceId,c.id,generation),allowed=c.mode==='operate'?AGENT_OPERATE_CEILING:WORK_ASSISTANT_CEILING;
  const ceiling=allowed.filter(scope=>hasScope(actor,scope as any));
  const key:Key={generation,hash:hash(token),issuedAt:now,expiresAt:now+SERVICE_KEY_TTL_MS,mode:c.mode,ceiling,...(actor.credentialVersion?{credentialVersion:actor.credentialVersion}:{})};
  const next:AgentIdentity={...c,key,version:c.version+1,lastRequestId:rid,lastExpectedVersion:c.version,lastAction:'issued'};await save(db,row,c,next);await appendEvent(db,next,actor,'issued',rid,now);
  return{identity:identityView(next,actor,now),token};
}
export async function revokeServiceKey(db:any,actor:TokenPayload,workspaceId:string,id:string,input:Record<string,unknown>,now:number){
  if(Object.keys(input).some(k=>k!=='requestId'))fail('INVALID_INPUT','密钥字段无效',400);const rid=requestId(input.requestId),{row,value:c}=await identityRecord(db,workspaceId,id);
  if(c.ownerId!==actor.userId&&!serviceCanManage(actor))fail('FORBIDDEN','没有Agent身份管理权限',403);
  if(!c.key||c.key.revokedAt)return identityView(c,actor,now);
  await unusedOperation(db,c,rid);
  const next:AgentIdentity={...c,key:{...c.key,revokedAt:new Date(now).toISOString()},version:c.version+1,lastRequestId:rid,lastExpectedVersion:c.version,lastAction:'revoked'};await save(db,row,c,next);await appendEvent(db,next,actor,'revoked',rid,now);return identityView(next,actor,now);
}
export async function identityHistory(db:any,actor:TokenPayload,workspaceId:string,id:string,cursor?:unknown){
 const {value:c}=await identityRecord(db,workspaceId,id);if(c.ownerId!==actor.userId&&!serviceCanManage(actor))fail('NOT_FOUND','Agent身份不存在或无权访问',404);
 const where:any={workspaceId,inputHash:EVENT_HASH,requestId:{startsWith:EVENT_PREFIX+c.id+':'}};
 if(cursor!==undefined){if(typeof cursor!=='string'||cursor.length>300||!/^[A-Za-z0-9_-]+$/.test(cursor))fail('INVALID_INPUT','翻页位置无效',400);let p:any;try{p=JSON.parse(Buffer.from(cursor as string,'base64url').toString());}catch{fail('INVALID_INPUT','翻页位置无效',400);}if(!uuid(p?.id)||typeof p?.at!=='string'||!Number.isFinite(Date.parse(p.at)))fail('INVALID_INPUT','翻页位置无效',400);where.OR=[{createdAt:{lt:new Date(p.at)}},{createdAt:new Date(p.at),id:{lt:p.id}}];}
 const rows=await db.mistCommandReceipt.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:31}),page=rows.slice(0,30),last=page.at(-1);
 return{items:page.map((row:any)=>row.result.event as AgentIdentityEvent),nextCursor:rows.length>30&&last?Buffer.from(JSON.stringify({at:new Date(last.createdAt).toISOString(),id:last.id})).toString('base64url'):null};
}
export function parseServiceCredential(token:unknown){
  if(typeof token!=='string'||token.length>300)fail('AGENT_KEY_INVALID','Agent密钥无效或已失效',401);
  const match=/^bma1_([0-9a-f-]{36})_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/.exec(token as string);
  if(!match||!uuid(match[1])||!uuid(match[2]))fail('AGENT_KEY_INVALID','Agent密钥无效或已失效',401);
  return{workspaceId:match![1],id:match![2],hash:hash(token as string)};
}
export async function resolveServiceCredential(db:any,token:unknown){
  const parsed=parseServiceCredential(token);let c:AgentIdentity;
  try{c=(await identityRecord(db,parsed.workspaceId,parsed.id)).value;}catch(error){if((error as any)?.status!==404)throw error;fail('AGENT_KEY_INVALID','Agent密钥无效或已失效',401);}
  if(!c!.enabled||!c!.key||c!.key.revokedAt||c!.key.expiresAt<=Date.now()||!equal(c!.key.hash,parsed.hash))fail('AGENT_KEY_INVALID','Agent密钥无效或已失效',401);
  return serviceActorFromIdentity(c!,parsed.hash);
}
/** Caller must validate the protected identity/key first; never accepts client-supplied identity data. */
export function serviceActorFromIdentity(c: AgentIdentity, keyHash: string): AgentActor {
  const key = c.key!;
  return { userId:c.ownerId,companyId:c.companyId,roles:[],permissions:[],departmentIds:[],authorizationLoaded:true,permissionCeiling:[...key.ceiling],credentialVersion:key.credentialVersion,iat:Math.floor(key.issuedAt/1000),actorKind:'agent',agentMode:key.mode,agentSessionId:c.id,agentWorkspaceId:c.workspaceId,agentIdentity:{id:c.id,name:c.name},agentServiceLease:{id:c.id,workspaceId:c.workspaceId,hash:keyHash,ownerId:c.ownerId,issuedAt:key.issuedAt,expiresAt:key.expiresAt} } as AgentActor;
}
export async function assertServiceLease(db:any,actor:TokenPayload,lease:AgentServiceLease,now:number){
  const {value:c}=await identityRecord(db,lease.workspaceId,lease.id),key=c.key;
  if(!c.enabled||c.ownerId!==actor.userId||!key||key.revokedAt||key.expiresAt<=now||key.issuedAt!==lease.issuedAt||key.expiresAt!==lease.expiresAt||!equal(key.hash,lease.hash))fail('AGENT_KEY_INVALID','Agent密钥已失效',401);
}
