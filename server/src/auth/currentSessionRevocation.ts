import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import type {Request,Response,NextFunction} from 'express';
import {createAuthService,type TokenPayload} from './service';
import {pickRequestToken} from './middleware';
import {MAX_SESSION_AGE_SECONDS,sessionOf,legacySessionId} from './sessionLifetime';
import {logger} from '../lib/logger';
import {isPublicSessionPath} from './publicSessionPaths';

type Claims=TokenPayload&{iat?:number;exp?:number};
type Store=Pick<PrismaClient,'authSessionRevocation'>;
type LogoutTarget={id:string;userId:string;expiresAt:Date};
type Signer=ReturnType<typeof createAuthService>;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function currentSessionKey(claims:TokenPayload,token?:string):string|null{
 if(!claims||typeof claims.userId!=='string'||!claims.userId||(claims as any).kind==='customer')return null;
 const family=typeof claims.sessionId==='string'&&claims.sessionId?claims.sessionId:(token?legacySessionId(token):'');
 return family?hash(claims.userId+'\0'+family):null;
}
export function currentLogoutTarget(claims:Claims,token:string):LogoutTarget|null{
 const id=currentSessionKey(claims,token);if(!id)return null;
 const family=sessionOf(claims,token);
 const end=Math.max(claims.exp||0,family.authTime+MAX_SESSION_AGE_SECONDS);
 return{id,userId:claims.userId,expiresAt:new Date(end*1000)};
}
/** A purpose token can only revoke this family. It has no login userId/roles/permissions. */
export function issueLogoutTicket(signer:Signer,claims:Claims,token:string):string|undefined{
 const target=currentLogoutTarget(claims,token);if(!target)return;
 const until=Math.floor(target.expiresAt.getTime()/1000);
 return signer.signPurposeToken('session-logout',JSON.stringify({id:target.id,userId:target.userId,until}),Math.max(1,until-Math.floor(Date.now()/1000)));
}
export function targetFromLogoutTicket(signer:Signer,ticket:string):LogoutTarget{
 if(!ticket||ticket.length>8192)throw Error('invalid logout ticket');
 const claims=signer.verifyLogoutToken(ticket) as any;
 if(claims.kind!=='session-logout'||claims.userId!==undefined||typeof claims.sub!=='string')throw Error('invalid logout ticket');
 const target=JSON.parse(claims.sub);
 if(typeof target.id!=='string'||!(/^[a-f0-9]{64}$/).test(target.id)||typeof target.userId!=='string'||!target.userId||!Number.isSafeInteger(target.until)||target.until<=0||!Number.isFinite(new Date(target.until*1000).getTime()))throw Error('invalid logout target');
 return{id:target.id,userId:target.userId,expiresAt:new Date(target.until*1000)};
}
export async function revokeLogoutTarget(store:Store,target:LogoutTarget):Promise<void>{
 // Native INSERT ... ON CONFLICT avoids read/create races between repeated logout requests.
 await store.authSessionRevocation.createMany({data:[target],skipDuplicates:true});
}
export async function revokeCurrentSession(store:Store,claims:Claims,token:string):Promise<void>{
 const target=currentLogoutTarget(claims,token);if(target)await revokeLogoutTarget(store,target);
}
/** Uncached shared storage makes a logout visible to other processes and after restart. */
export async function isCurrentSessionRevoked(store:Store,claims:TokenPayload,token?:string):Promise<boolean>{
 const id=currentSessionKey(claims,token);if(!id)return false;
 const row=await store.authSessionRevocation.findUnique({where:{id},select:{expiresAt:true}});
 return !!row&&row.expiresAt.getTime()>Date.now();
}

const auth=createAuthService(),checked=new WeakMap<object,string>();
/** Public login/recovery must still work when the browser carries a revoked cookie; logout is idempotent. */
export function createCurrentSessionGuard(store:Store,options:{employeeOnly?:boolean}={}){
 return async(req:Request,res:Response,next:NextFunction)=>{
  const path=(req.originalUrl||req.url).split('?')[0].toLowerCase().replace(/\/{2,}/g,'/');
  if(isPublicSessionPath(path))return next();
  const token=pickRequestToken(req);if(!token)return next();
  let claims:Claims;try{claims=auth.verifyToken(token);}catch{return next();}
  const key=currentSessionKey(claims,token);
  if(!key)return options.employeeOnly?res.status(401).set('Cache-Control','private, no-store').json({ok:false,error:'UNAUTHORIZED',message:'请使用有效员工账号登录。'}):next();
  if(checked.get(req)===key)return next();
  try{
   if(await isCurrentSessionRevoked(store,claims,token))return res.status(401).set('Cache-Control','private, no-store').json({ok:false,error:'SESSION_REVOKED',message:'当前设备已退出，请重新登录。'});
   checked.set(req,key);return next();
  }catch(error){
   logger.warn('[auth] session status unavailable',{error:error instanceof Error?error.message:'unknown'});
   return res.status(503).set('Cache-Control','private, no-store').json({ok:false,error:'SESSION_STATUS_UNAVAILABLE',message:'暂时无法核验登录状态，请稍后重试。'});
  }
 };
}
