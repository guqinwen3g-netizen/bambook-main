import { Router } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildAccountAccessEmail, createEmailService, type EmailService } from './email';
import { createAuthService } from './service';
import { invalidateAccountStatusCache } from './accountStatusGuard';
import { createLoginRateLimiter } from './loginRateLimiter';
import { passwordProblem } from './passwordPolicy';

type Kind = 'invite' | 'recovery';
export type Delivery = { status: 'sent' | 'unconfirmed' | 'unavailable' | 'cooldown'; message: string };
export type AccountAccessOptions = { email?: EmailService; publicUrl?: string };
const purpose = (kind:Kind) => `account-access-${kind}`;
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
const meta = (value:unknown):any => value && typeof value==='object' && !Array.isArray(value) ? value : {};
export const invitationSummary = (value:unknown) => {const record=meta(value).accountInvitation;return record?{status:record.status,at:record.at}:null;};
const accountInclude = { companyMembers: { include: { company:true } }, roles:true } as const;
function eligible(user:any, kind:Kind) {
 if(!user || user.status!=='active' || user.deletedAt!=null)return false;
 const platform=user.platformRole==='platform_admin' && user.companyMembers.length===0 && user.roles.length===0;
 return kind==='recovery'?platform:platform || !user.platformRole && user.companyMembers.some((m:any)=>m.status==='active'&&m.company.status==='active');
}
function publicBase(configured?:string) {
 const url=new URL(configured||process.env.BAMBOOK_PUBLIC_URL||'');
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('PUBLIC_URL_INVALID');
 return url.origin;
}
/** Persistent single-use access links. Plain tokens exist only while composing email. */
export function createAccountAccessService(db:PrismaClient, options:AccountAccessOptions={}) {
 const email=options.email??createEmailService(), auth=createAuthService();
 async function deliver(userId:string, kind:Kind, actorId?:string, companyName?:string):Promise<Delivery> {
  let base:string;
  try{base=publicBase(options.publicUrl);}catch{return{status:'unavailable',message:'账号已保留，邮件入口地址未配置，请联系平台管理员后重发。'};}
  if(!email.isReal)return{status:'unavailable',message:'账号已保留，邮件服务未配置，请联系平台管理员后重发。'};
  const token=randomBytes(32).toString('base64url'), tokenHash=hash(token), now=new Date();
  const entry=await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 84))`;
   const user=await tx.userAccount.findUnique({where:{id:userId},include:accountInclude});
   if(!eligible(user,kind)||!user!.email)return null;
   const metadata=meta(user!.metadata),window=metadata.accountMailWindow??{};
   const within=Number.isFinite(window.startedAt)&&now.getTime()-window.startedAt<3600000;
   if(now.getTime()-(window.lastAt||0)<60000||within&&(window.count||0)>=5)return{cooldown:true} as const;
   // Existing activated company owners receive a login notice, never a password reset.
   const setup=kind==='recovery'||metadata.forceChangePassword===true;
   if(setup)await tx.userVerificationCode.upsert({where:{email_purpose:{email:user!.email!.toLowerCase(),purpose:purpose(kind)}},create:{id:`access:${kind}:${userId}`,email:user!.email!.toLowerCase(),purpose:purpose(kind),codeHash:tokenHash,expiresAt:new Date(now.getTime()+(kind==='invite'?48*3600000:30*60000))},update:{id:`access:${kind}:${userId}`,codeHash:tokenHash,issuedAt:now,expiresAt:new Date(now.getTime()+(kind==='invite'?48*3600000:30*60000)),attempts:0,consumedAt:null}});
   await tx.userAccount.update({where:{id:userId},data:{metadata:{...metadata,accountMailWindow:{startedAt:within?window.startedAt:now.getTime(),lastAt:now.getTime(),count:within?(window.count||0)+1:1},...(kind==='invite'?{accountInvitation:{status:'sending',at:now.toISOString(),requestId:tokenHash}}:{})}}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:actorId||userId,action:kind==='invite'?'platform.invitation.request':'platform.recovery.request',targetType:'UserAccount',targetId:userId}});
   return{email:user!.email!,platform:!!user!.platformRole,setup};
  });
  if(!entry)return{status:'unavailable',message:'该账号当前不能接收邀请。'};
  if('cooldown'in entry)return{status:'cooldown',message:'发送过于频繁，请稍后再试（每分钟一次、每小时最多五次）。'};
  const url=new URL(base);url.searchParams.set('view',entry.setup?'account-access':'login');
  if(entry.setup){url.searchParams.set('kind',kind);url.searchParams.set('email',entry.email);url.hash=token;}
  const label=entry.platform?'Sylway Cloud 平台':companyName||'Bambook 公司';
  let status:Delivery['status']='sent';
  try{await email.send(buildAccountAccessEmail({to:entry.email,label,kind,setup:entry.setup,url:url.href}));}
  catch{status='unconfirmed';}
  await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 84))`;
   const user=await tx.userAccount.findUnique({where:{id:userId}});if(!user)return;
   const metadata=meta(user.metadata);
   if(kind==='invite'&&metadata.accountInvitation?.requestId===tokenHash&&metadata.accountInvitation?.status==='sending')await tx.userAccount.update({where:{id:userId},data:{metadata:{...metadata,accountInvitation:{status,at:new Date().toISOString()}}}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:actorId||userId,action:kind==='invite'?`platform.invitation.${status}`:`platform.recovery.${status}`,targetType:'UserAccount',targetId:userId}});
  });
  return{status,message:status==='sent'?'邮件已提交发送，请收件人检查收件箱及垃圾邮件。':'邮件发送结果未确认。账号已保留，请稍后重发；重发后旧链接失效。'};
 }
 async function complete(input:{email:string;kind:Kind;token:string;password:string}) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(input.token))return{ok:false,message:'链接无效或已过期，请重新申请。'};
  const weak=passwordProblem(input.password);if(weak)return{ok:false,message:weak};
  const emailAddress=input.email.trim().toLowerCase(), passwordHash=await auth.hashPassword(input.password);
  const result=await db.$transaction(async tx=>{
   const found=await tx.userAccount.findFirst({where:{email:{equals:emailAddress,mode:'insensitive'}}});if(!found)return{ok:false,message:'链接无效或已过期，请重新申请。'};
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${found.id}, 84))`;
   const user=await tx.userAccount.findUnique({where:{id:found.id},include:accountInclude});
   const record=await tx.userVerificationCode.findUnique({where:{email_purpose:{email:emailAddress,purpose:purpose(input.kind)}}});
   if(!eligible(user,input.kind)||!record||record.id!==`access:${input.kind}:${found.id}`||record.consumedAt||record.expiresAt.getTime()<=Date.now()||record.attempts>=5||record.codeHash!==hash(input.token))return{ok:false,message:'链接无效或已过期，请重新申请。'};
   const metadata=meta(user!.metadata);
   if(input.kind==='invite'&&!metadata.forceChangePassword || Date.parse(metadata.passwordChangedAt||'')>record.issuedAt.getTime())return{ok:false,message:'链接已失效，请重新申请。'};
   const at=new Date().toISOString();
   await tx.userAccount.update({where:{id:found.id},data:{passwordHash,metadata:{...metadata,forceChangePassword:false,credentialVersion:randomUUID(),passwordChangedAt:at,sessionsRevokedAt:at,...(input.kind==='invite'?{accountInvitation:{status:'accepted',at}}:{})}}});
   await tx.userVerificationCode.deleteMany({where:{email:emailAddress,purpose:{in:[purpose('invite'),purpose('recovery')]}}});
   await tx.auditLog.create({data:{id:randomUUID(),actorId:found.id,action:input.kind==='invite'?'account.invitation.accept':'platform.recovery.complete',targetType:'UserAccount',targetId:found.id}});
   return{ok:true,userId:found.id,platform:!!user!.platformRole};
  });
  if(result.ok&&'userId'in result)invalidateAccountStatusCache(result.userId!);
  return result;
 }
 return{deliver,complete,available:()=>{try{publicBase(options.publicUrl);return email.isReal;}catch{return false;}}};
}
export function accountAccessRouter(db:PrismaClient,options:AccountAccessOptions={}) {
 const router=Router(),service=createAccountAccessService(db,options),limiter=createLoginRateLimiter({maxFailures:8,windowMs:15*60000}),traffic=createLoginRateLimiter({maxFailures:60,windowMs:15*60000});
 router.post('/request',async(req,res,next)=>{try{
  const address=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||address.length>254)return res.status(400).json({ok:false,message:'请填写有效的工作邮箱。'});
  if(traffic.recordFailure(req.ip||'unknown').blocked||limiter.recordFailure('request:'+req.ip+':'+address).blocked)return res.status(429).json({ok:false,message:'请求过于频繁，请稍后再试。'});
  if(!service.available())return res.status(503).json({ok:false,message:'找回邮件服务暂不可用，请联系平台管理员。'});
  const user=await db.userAccount.findFirst({where:{email:{equals:address,mode:'insensitive'}},include:accountInclude});
  if(eligible(user,'recovery'))await service.deliver(user!.id,'recovery');
  return res.json({ok:true,message:'申请已处理。如该账号支持邮箱找回，请检查收件箱及垃圾邮件。公司账号请联系本公司管理员重置。'});
 }catch(e){next(e);}});
 router.post('/complete',async(req,res,next)=>{try{
  const b=req.body??{};
  if(!['invite','recovery'].includes(b.kind)||typeof b.email!=='string'||b.email.length>254||typeof b.token!=='string'||typeof b.password!=='string')return res.status(400).json({ok:false,message:'链接内容不完整，请从邮件重新打开。'});
  if(traffic.recordFailure(req.ip||'unknown').blocked||limiter.recordFailure('complete:'+req.ip+':'+b.email.trim().toLowerCase()).blocked)return res.status(429).json({ok:false,message:'请求过于频繁，请稍后再试。'});
  const result=await service.complete({email:b.email,kind:b.kind,token:b.token,password:b.password});
  return res.status(result.ok?200:400).json(result.ok?{ok:true,platform:'platform'in result&&result.platform}:result);
 }catch(e){next(e);}});
 return router;
}
