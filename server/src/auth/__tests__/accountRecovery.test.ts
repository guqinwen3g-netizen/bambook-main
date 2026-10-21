import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../service', () => ({ createAuthService: () => ({ hashPassword: async (value:string) => 'hash:' + value }) }));
vi.mock('../accountStatusGuard', () => ({ invalidateAccountStatusCache: vi.fn() }));
import { invalidateAccountStatusCache } from '../accountStatusGuard';
import { accountAccessRouter, createAccountAccessService } from '../accountAccess';

let user:any, db:any, records:Map<string,any>, messages:any[];
const password = 'CorrectPassword42!';
const member = (status='active', companyStatus='active') => ({ status, company:{status:companyStatus} });
const options = () => ({ publicUrl:'https://example.test', email:{isReal:true,send:vi.fn(async (message:any) => { messages.push(message); })} as any });
const key = (where:any) => where.email_purpose.email + ':' + where.email_purpose.purpose;
const link = () => new URL(messages.at(-1).text.match(/https:\/\/example\.test\/\S+/)[0]);
const completeInput = (url=link()) => ({email:url.searchParams.get('email')!,kind:'recovery' as const,token:url.hash.slice(1),password});
const app = () => { const a=express();a.use(express.json());a.use('/access',accountAccessRouter(db,options()));return a; };

beforeEach(() => {
 vi.clearAllMocks();messages=[];records=new Map();
 user={id:'employee',email:'staff@example.test',status:'active',deletedAt:null,platformRole:null,companyMembers:[member()],roles:[{roleId:'staff'}],metadata:{},passwordHash:'old'};
 db={
  $executeRaw:vi.fn(async()=>0),
  userAccount:{
   findUnique:vi.fn(async()=>user),
   findFirst:vi.fn(async({where}:any)=>user?.email===where.email.equals?user:null),
   update:vi.fn(async({data}:any)=>Object.assign(user,data)),
  },
  userVerificationCode:{
   upsert:vi.fn(async({where,create,update}:any)=>{const k=key(where);const r=records.has(k)?{...records.get(k),...update}:{issuedAt:new Date(),attempts:0,consumedAt:null,...create};records.set(k,r);return r;}),
   findUnique:vi.fn(async({where}:any)=>records.get(key(where))??null),
   deleteMany:vi.fn(async({where}:any)=>{for(const[k,r]of records)if(r.email===where.email&&where.purpose.in.includes(r.purpose))records.delete(k);return{count:1};}),
  },
  auditLog:{create:vi.fn(async({data}:any)=>data)},
 };
 db.$transaction=vi.fn(async(fn:any)=>fn(db));
});

describe('company employee password recovery',()=>{
 it('delivers a single-use employee link, changes credentials and revokes sessions without granting membership or roles',async()=>{
  const memberships=structuredClone(user.companyMembers),roles=structuredClone(user.roles);
  const service=createAccountAccessService(db,options());
  expect((await service.deliver(user.id,'recovery')).status).toBe('sent');
  const input=completeInput();
  const record=[...records.values()][0];
  expect(record.codeHash).toBe(createHash('sha256').update(input.token).digest('hex'));
  expect(record).not.toHaveProperty('token');
  expect(record.expiresAt.getTime()-record.issuedAt.getTime()).toBeLessThanOrEqual(30*60000);
  expect(user.passwordHash).toBe('old');
  expect(await service.complete(input)).toMatchObject({ok:true,platform:false});
  expect(user.passwordHash).toBe('hash:'+password);
  expect(user.metadata).toMatchObject({forceChangePassword:false,sessionsRevokedAt:expect.any(String),credentialVersion:expect.any(String)});
  expect(user.companyMembers).toEqual(memberships);expect(user.roles).toEqual(roles);
  expect(invalidateAccountStatusCache).toHaveBeenCalledWith('employee');
  expect(await service.complete(input)).toMatchObject({ok:false});
  expect(db.auditLog.create.mock.calls.map((args:any)=>args[0].data.action)).toEqual(['account.recovery.request','account.recovery.sent','account.recovery.complete']);
  expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(input.token);
 });

 it('preserves isolated platform administrator recovery',async()=>{
  Object.assign(user,{platformRole:'platform_admin',companyMembers:[],roles:[]});
  const service=createAccountAccessService(db,options());await service.deliver(user.id,'recovery');
  expect(await service.complete(completeInput())).toMatchObject({ok:true,platform:true});
  expect(db.auditLog.create.mock.calls.map((args:any)=>args[0].data.action)).toContain('platform.recovery.complete');
 });

 it.each([
  ['pending account',{status:'pending'}],['disabled account',{status:'disabled'}],['deleted account',{deletedAt:new Date()}],
  ['pending membership',{companyMembers:[member('pending')]}],['former member',{companyMembers:[member('left')]}],
  ['suspended company',{companyMembers:[member('active','suspended')]}],['no company',{companyMembers:[]}],
  ['mixed platform identity',{platformRole:'platform_admin'}],
 ])('does not issue a reset link to %s',async(_name,change)=>{
  Object.assign(user,change);const service=createAccountAccessService(db,options());
  expect((await service.deliver(user.id,'recovery')).status).toBe('unavailable');
  expect(messages).toHaveLength(0);expect(records.size).toBe(0);expect(db.userAccount.update).not.toHaveBeenCalled();
 });

 it.each([
  ['disabled account',{status:'disabled'}],['left company',{companyMembers:[member('left')]}],
  ['suspended company',{companyMembers:[member('active','suspended')]}],
 ])('rechecks %s after issuing the link',async(_name,change)=>{
  const service=createAccountAccessService(db,options());await service.deliver(user.id,'recovery');const input=completeInput();Object.assign(user,change);
  expect(await service.complete(input)).toMatchObject({ok:false});expect(user.passwordHash).toBe('old');
 });

 it.each(['expired','wrong token','wrong user binding','consumed','attempt limit','password changed'])('rejects a link that is %s',async(reason)=>{
  const service=createAccountAccessService(db,options());await service.deliver(user.id,'recovery');const input=completeInput(),record=[...records.values()][0];
  if(reason==='expired')record.expiresAt=new Date(0);
  if(reason==='wrong token')input.token='x'.repeat(43);
  if(reason==='wrong user binding')record.id='access:recovery:other';
  if(reason==='consumed')record.consumedAt=new Date();
  if(reason==='attempt limit')record.attempts=5;
  if(reason==='password changed')user.metadata.passwordChangedAt=new Date(record.issuedAt.getTime()+1000).toISOString();
  expect(await service.complete(input)).toMatchObject({ok:false});expect(user.passwordHash).toBe('old');
 });

 it('invalidates earlier links on resend and both purposes on completion',async()=>{
  const service=createAccountAccessService(db,options());await service.deliver(user.id,'recovery');const old=completeInput();
  expect((await service.deliver(user.id,'recovery')).status).toBe('cooldown');
  user.metadata.accountMailWindow.lastAt=Date.now()-61000;await service.deliver(user.id,'recovery');
  expect(await service.complete(old)).toMatchObject({ok:false});
  records.set('invite',{email:user.email,purpose:'account-access-invite'});
  expect(await service.complete(completeInput())).toMatchObject({ok:true});expect(records.size).toBe(0);
 });

 it('returns identical public responses for active, unavailable and unknown employees',async()=>{
  const endpoint=app();
  const active=await request(endpoint).post('/access/request').send({email:user.email});expect(messages).toHaveLength(1);
  user.status='disabled';const disabled=await request(endpoint).post('/access/request').send({email:user.email});
  const unknown=await request(endpoint).post('/access/request').send({email:'unknown@example.test'});
  expect(active.status).toBe(200);expect(disabled.body).toEqual(active.body);expect(unknown.body).toEqual(active.body);
  expect(active.body).toEqual({ok:true,message:'如果该邮箱关联可用账号，重设链接将发送至邮箱。请检查收件箱及垃圾邮件。'});
  expect(messages).toHaveLength(1);
 });
});
