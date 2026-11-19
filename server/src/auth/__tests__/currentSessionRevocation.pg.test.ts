import {randomUUID} from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createAuthRouter} from '../route';
import {createAuthService} from '../service';
import {requireAuth} from '../middleware';
import {createAccountStatusGuard} from '../accountStatusGuard';
import {createAuthorizationSnapshotGuard} from '../authorizationSnapshotGuard';
import {freshMistAuthority} from '../../mist/authority';
import {revokeCurrentSession} from '../currentSessionRevocation';
import {createCurrentSessionGuard,currentSessionKey} from '../currentSessionRevocation';

const url=process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('current device logout on PostgreSQL',()=>{
 const id='session-'+randomUUID(),email=id+'@example.invalid',password='Session-local-22!';
 const auth=createAuthService();let db:PrismaClient,second:PrismaClient;
 function app(client=db){const a=express();a.use(cookieParser());a.use(express.json());a.use('/api',createCurrentSessionGuard(client));a.use('/api',createAccountStatusGuard(client));a.use('/api',createAuthorizationSnapshotGuard({prisma:client}));a.use('/api/auth',createAuthRouter({prisma:client,requireEmailVerification:false,loginRateLimit:false}));a.get('/api/private',requireAuth,(_req,res)=>res.json({ok:true}));return a;}
 const loginData=async()=>{const r=await request(app()).post('/api/auth/login').send({email,password,remember:true});expect(r.status).toBe(200);return r.body;};
 const login=async()=>(await loginData()).token as string;
 const bearer=(token:string)=>({Authorization:'Bearer '+token});
 beforeAll(async()=>{db=new PrismaClient({datasourceUrl:url});second=new PrismaClient({datasourceUrl:url});await db.userAccount.create({data:{id,email,displayName:'Session test',status:'active',passwordHash:await auth.hashPassword(password)}});});
 afterAll(async()=>{if(db){await db.authSessionRevocation.deleteMany({where:{userId:id}});await db.auditLog.deleteMany({where:{actorId:id}});await db.userAccount.deleteMany({where:{id}});await db.$disconnect();}await second?.$disconnect();});
 it('revokes only the selected login family across independent runtimes',async()=>{
  const current=await login(),other=await login();expect((await request(app()).post('/api/auth/logout').set(bearer(current))).status).toBe(200);
  for(const a of [app(),app(second)]){expect((await request(a).get('/api/private').set(bearer(current))).status).toBe(401);expect((await request(a).get('/api/auth/me').set(bearer(current))).status).toBe(401);expect((await request(a).get('/api/private').set(bearer(other))).status).toBe(200);}
 });
 it('recovers logout without cookies or a login token using a purpose-scoped capability',async()=>{
  const current=await loginData(),other=await login(),ticket=current.logoutTicket;expect(typeof ticket).toBe('string');for(const endpoint of ['/api/private','/api/auth/me','/api/auth/companies'])expect((await request(app(second)).get(endpoint).set(bearer(ticket))).status).toBe(401);
  const out=await request(app(second)).post('/api/auth/logout').send({logoutTicket:ticket});expect(out.status).toBe(200);expect(out.body.revokedSession).toBe(true);expect((await request(app()).get('/api/private').set(bearer(current.token))).status).toBe(401);expect((await request(app()).get('/api/private').set(bearer(other))).status).toBe(200);const rows=await db.authSessionRevocation.findMany({where:{id:currentSessionKey(auth.verifyToken(current.token),current.token)!}});expect(JSON.stringify(rows)).not.toContain(current.token);expect(JSON.stringify(rows)).not.toContain(ticket);
 });
 it.each(['modern','legacy'])('denies a %s write when logout commits between API entry and the business transaction',async format=>{
  const token=format==='modern'?await login():auth.signToken({userId:id,roles:[],permissions:[],departmentIds:[]}),a=app();
  a.post('/api/queued',async(req,res)=>{try{await revokeCurrentSession(second,auth.verifyToken(token),token);await db.$transaction(async tx=>{await freshMistAuthority(tx,(req as any).actor);await tx.userAccount.update({where:{id},data:{displayName:'Unauthorized queued update'}});});res.json({ok:true});}catch(error:any){res.status(error.status||500).json({error:error.code});}});
  const r=await request(a).post('/api/queued').set(bearer(token));expect(r.status).toBe(401);expect(r.body.error).toBe('SESSION_REVOKED');expect((await db.userAccount.findUniqueOrThrow({where:{id}})).displayName).toBe('Session test');
 });
 it('cannot revive the family through refresh or company selection',async()=>{
  const token=await login(),r=await request(app()).post('/api/auth/refresh').set(bearer(token));expect(r.status).toBe(200);
  expect((await request(app()).post('/api/auth/logout').set(bearer(r.body.token))).status).toBe(200);
  for(const t of [token,r.body.token]){for(const endpoint of ['refresh','switch-company'])expect((await request(app(second)).post('/api/auth/'+endpoint).set(bearer(t)).send({companyId:'unrelated'})).status).toBe(401);expect((await request(app(second)).get('/api/auth/companies').set(bearer(t))).status).toBe(401);}
 });
 it('retains revocation after a refresh races with logout',async()=>{
  const token=await login(),[refresh,logout]=await Promise.all([request(app()).post('/api/auth/refresh').set(bearer(token)),request(app(second)).post('/api/auth/logout').set(bearer(token))]);expect(logout.status).toBe(200);expect([200,401]).toContain(refresh.status);
  for(const t of [token,...(refresh.body.token?[refresh.body.token]:[])])expect((await request(app(second)).get('/api/private').set(bearer(t))).status).toBe(401);
 });
 it('keeps concurrent idempotent logouts and independent session revocations',async()=>{
  const tokens=await Promise.all([login(),login(),login()]),active=await login();const result=await Promise.all([...Array.from({length:6},()=>tokens[0]),tokens[1],tokens[2]].map(t=>request(app()).post('/api/auth/logout').set(bearer(t))));expect(result.map(r=>r.status)).toEqual(Array(8).fill(200));
  for(const token of tokens){const claims=auth.verifyToken(token);expect(await db.authSessionRevocation.count({where:{id:currentSessionKey(claims,token)!}})).toBe(1);expect((await request(app(second)).get('/api/private').set(bearer(token))).status).toBe(401);}
  expect((await request(app()).get('/api/private').set(bearer(active))).status).toBe(200);
 });
 it('stores no bearer or raw session identifier and covers the absolute family lifetime',async()=>{
  const token=await login(),claims=auth.verifyToken(token);await request(app()).post('/api/auth/logout').set(bearer(token));const row=await db.authSessionRevocation.findUniqueOrThrow({where:{id:currentSessionKey(claims,token)!}});expect(row.id).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(row)).not.toContain(token);expect(JSON.stringify(row)).not.toContain(claims.sessionId);expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual((claims.authTime!+90*86400)*1000);
 });
 it('revokes cookie-only and legacy sessions, including already refreshed legacy tokens',async()=>{
  const token=auth.signToken({userId:id,roles:[],permissions:[],departmentIds:[]});const refreshed=await request(app()).post('/api/auth/refresh').set(bearer(token));expect(refreshed.status).toBe(200);expect((await request(app()).post('/api/auth/logout').set('Cookie','bambook_token='+token)).status).toBe(200);
  for(const t of [token,refreshed.body.token])expect((await request(app(second)).get('/api/private').set(bearer(t))).status).toBe(401);
 });
 it('can revoke a live family using its expired original token',async()=>{
  const issued=Math.floor(Date.now()/1000)-13*3600,base={userId:id,roles:[],permissions:[],departmentIds:[],sessionId:randomUUID(),authTime:issued};const original=auth.signToken({...base,iat:issued} as any,{expiresInSec:12*3600}),current=auth.signToken(base);expect((await request(app()).get('/api/private').set(bearer(current))).status).toBe(200);expect((await request(app()).post('/api/auth/logout').set(bearer(original))).status).toBe(200);expect((await request(app(second)).get('/api/private').set(bearer(current))).status).toBe(401);
 });
 it('logout-all invalidates same-second sessions without blocking a fresh login',async()=>{
  vi.useFakeTimers({toFake:['Date']});try{const token=await login();expect((await request(app()).post('/api/auth/logout-all').set(bearer(token))).status).toBe(200);expect((await request(app()).get('/api/private').set(bearer(token))).status).toBe(401);expect((await request(app()).post('/api/auth/refresh').set(bearer(token))).status).toBe(401);const fresh=await login();expect((await request(app(second)).get('/api/private').set(bearer(fresh))).status).toBe(200);}finally{vi.useRealTimers();}
 });
});
