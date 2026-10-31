import {randomUUID} from 'node:crypto';
import type {TokenPayload} from '../auth/service';
import {hasScope} from '../auth/permissionService';
import {fail} from './errors';
import type {ManagedAgentPayload} from './agentDelegation';
import type {AgentConnectionView} from '../shared/mistAgentConnections';

/** Kept in the already-private receipt namespace. Old releases reject this namespace and v2
 * credentials, including after rollback. These records never change business revisions. */
export const CONNECTION_PREFIX='mist-revision:agent-connection:';
export const CONNECTION_HASH='mist-agent-connection:v1';
export const CONNECTION_FIELD='__agentConnection';
type Connection={schemaVersion:1;id:string;workspaceId:string;actorId:string;name:string;mode:'read'|'operate';version:number;state:'active'|'revoked';createdAt:string;renewedAt?:string;revokedAt?:string;payload:ManagedAgentPayload;lastRequestId:string;lastAction:'created'|'renewed'|'revoked'};
export type MakeAgentLease=(actor:TokenPayload,id:string,workspaceId:string,mode:'read'|'operate',ceiling?:string[])=>ManagedAgentPayload;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function id(value:unknown):string{if(!uuid(value))fail('INVALID_INPUT','连接编号无效',400);return value as string;}
function request(value:unknown):string{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>116)fail('INVALID_INPUT','操作编号无效',400);return value as string;}
function connection(row:any,workspaceId:string,actorId:string):Connection {
 const c=row?.result?.[CONNECTION_FIELD];
 if(row?.inputHash!==CONNECTION_HASH||row?.workspaceId!==workspaceId||row?.actorId!==actorId||!c||c.schemaVersion!==1||c.workspaceId!==workspaceId||c.actorId!==actorId||row.requestId!==CONNECTION_PREFIX+c.id||!Number.isSafeInteger(c.version)||c.version<1||c.payload?.v!==2||c.payload?.wid!==workspaceId||c.payload?.sub!==actorId||c.payload?.sid!==c.id||!['active','revoked'].includes(c.state))fail('NOT_FOUND','连接不存在或无权访问',404);
 return c;
}
export function connectionView(c:Connection,now:number,actor?:TokenPayload):AgentConnectionView{return{id:c.id,name:c.name,mode:c.mode,version:c.version,state:c.state==='revoked'?'revoked':c.payload.exp<=now?'expired':actor&&(!hasScope(actor,'ai:chat')||c.payload.credentialVersion!==actor.credentialVersion)?'invalid':'active',createdAt:c.createdAt,expiresAt:new Date(c.payload.exp).toISOString(),...(c.renewedAt?{renewedAt:c.renewedAt}:{}),...(c.revokedAt?{revokedAt:c.revokedAt}:{})};}
async function find(db:any,workspaceId:string,actorId:string,connectionId:string){const row=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:CONNECTION_PREFIX+id(connectionId)}}});return{row,value:connection(row,workspaceId,actorId)};}
export async function getConnection(db:any,actor:TokenPayload,workspaceId:string,connectionId:string,now:number){return connectionView((await find(db,workspaceId,actor.userId,connectionId)).value,now,actor);}
export async function listConnections(db:any,actor:TokenPayload,workspaceId:string,cursor:unknown,now:number){
 const where:any={workspaceId,actorId:actor.userId,inputHash:CONNECTION_HASH,requestId:{startsWith:CONNECTION_PREFIX}};
 if(cursor!==undefined){if(typeof cursor!=='string'||cursor.length>300||!/^[A-Za-z0-9_-]+$/.test(cursor))fail('INVALID_INPUT','翻页位置无效',400);let c:any;try{c=JSON.parse(Buffer.from(cursor as string,'base64url').toString());}catch{fail('INVALID_INPUT','翻页位置无效',400);}if(!uuid(c?.id)||typeof c?.at!=='string'||!Number.isFinite(Date.parse(c.at)))fail('INVALID_INPUT','翻页位置无效',400);where.OR=[{createdAt:{lt:new Date(c.at)}},{createdAt:new Date(c.at),id:{lt:c.id}}];}
 const rows=await db.mistCommandReceipt.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:31}),page=rows.slice(0,30),last=page.at(-1);
 return{items:page.map((row:any)=>connectionView(connection(row,workspaceId,actor.userId),now,actor)),canConnect:hasScope(actor,'ai:chat'),nextCursor:rows.length>30&&last?Buffer.from(JSON.stringify({at:new Date(last.createdAt).toISOString(),id:last.id})).toString('base64url'):null};
}
export async function createConnection(db:any,actor:TokenPayload,workspaceId:string,input:Record<string,unknown>,make:MakeAgentLease,now:number){
 if(Object.keys(input).some(k=>!['id','name','mode'].includes(k)))fail('INVALID_INPUT','连接字段无效',400);
 const connectionId=id(input.id),name=typeof input.name==='string'?input.name.trim():'';
 if(!name||name.length>60||/[\u0000-\u001f\u007f]/.test(name)||!['read','operate'].includes(input.mode as string))fail('INVALID_INPUT','请填写连接名称并选择权限',400);
 const existing=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:CONNECTION_PREFIX+connectionId}}});
 if(existing){const c=connection(existing,workspaceId,actor.userId);if(c.name!==name||c.mode!==input.mode||c.version!==1||c.state!=='active'||c.payload.exp<=now||c.payload.credentialVersion!==actor.credentialVersion)fail('CONNECTION_CHANGED','连接已更新，请刷新列表',409);return{connection:connectionView(c,now,actor),payload:c.payload};}
 const mode=input.mode as 'read'|'operate',payload=make(actor,connectionId,workspaceId,mode),value:Connection={schemaVersion:1,id:connectionId,workspaceId,actorId:actor.userId,name,mode,version:1,state:'active',createdAt:new Date(now).toISOString(),payload,lastRequestId:connectionId,lastAction:'created'};
 await db.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId,requestId:CONNECTION_PREFIX+connectionId,actorId:actor.userId,inputHash:CONNECTION_HASH,expectedRevision:0,result:{revision:0,[CONNECTION_FIELD]:value},createdAt:new Date(now)}});
 return{connection:connectionView(value,now,actor),payload};
}
export async function changeConnection(db:any,actor:TokenPayload,workspaceId:string,connectionId:string,action:'renew'|'revoke',input:Record<string,unknown>,make:MakeAgentLease,now:number){
 if(Object.keys(input).some(k=>!['requestId','version'].includes(k)))fail('INVALID_INPUT','连接字段无效',400);const requestId=request(input.requestId);
 const {row,value:c}=await find(db,workspaceId,actor.userId,connectionId);
 if(action==='revoke'&&c.state==='revoked')return{connection:connectionView(c,now,actor)};
 if(c.state==='revoked')fail('CONNECTION_REVOKED','连接已撤销，请重新创建连接',410);
 if(action==='renew'&&c.lastRequestId===requestId&&c.lastAction==='renewed'){if(input.version!==c.version-1||c.payload.exp<=now||c.payload.credentialVersion!==actor.credentialVersion)fail('CONNECTION_CHANGED','连接已更新，请刷新后再续签',409);return{connection:connectionView(c,now,actor),payload:c.payload};}
 if(action==='renew'&&(!Number.isSafeInteger(input.version)||input.version!==c.version))fail('CONNECTION_CHANGED','连接已更新，请刷新后再续签',409);
 const stamp=new Date(now).toISOString(),next:Connection={...c,version:c.version+1,lastRequestId:requestId,lastAction:action==='renew'?'renewed':'revoked',...(action==='renew'?{payload:make(actor,c.id,workspaceId,c.mode,c.payload.ceil),renewedAt:stamp}:{state:'revoked',revokedAt:stamp})};
 const changed=await db.mistCommandReceipt.updateMany({where:{id:row.id,workspaceId,inputHash:CONNECTION_HASH,result:{path:[CONNECTION_FIELD,'version'],equals:c.version}},data:{result:{revision:0,[CONNECTION_FIELD]:next}}});
 if(changed.count!==1)fail('CONNECTION_CHANGED','连接已更新，请刷新后重试',409);
 return{connection:connectionView(next,now,actor),...(action==='renew'?{payload:next.payload}:{})};
}
export async function assertConnection(db:any,actor:TokenPayload,payload:ManagedAgentPayload,now:number){
 const {value:c}=await find(db,payload.wid,actor.userId,payload.sid);
 if(c.state!=='active'||c.payload.generation!==payload.generation||c.payload.iat!==payload.iat||c.payload.exp!==payload.exp||c.payload.exp<=now||c.payload.companyId!==payload.companyId||c.payload.credentialVersion!==payload.credentialVersion||JSON.stringify(c.payload.ceil)!==JSON.stringify(payload.ceil)||c.mode!==(payload.mode==='operate'?'operate':'read'))fail('AGENT_CONNECTION_REVOKED','连接已过期、续签或撤销，请重新连接',401);
}
