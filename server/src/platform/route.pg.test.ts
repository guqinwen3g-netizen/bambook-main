import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';import cookieParser from 'cookie-parser';import request from 'supertest';import { randomUUID } from 'node:crypto';import { PrismaClient } from '@prisma/client';
import { createAuthService } from '../auth/service';import { createPlatformRouter } from './route';import { COMPANY_SYSTEM_ROLE_CODES } from './companyProvisioning';
const url=process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('platform lifecycle on PostgreSQL',()=>{
 const key=randomUUID(),admin='platform-'+key,guest='guest-'+key,mail='owner-'+key+'@example.invalid',slug='lifecycle-'+key;let db:PrismaClient,app:express.Express,token:string,companyId:string,ownerId:string;const templates:string[]=[];
 beforeAll(async()=>{db=new PrismaClient({datasourceUrl:url});for(const id of [admin,guest])await db.userAccount.create({data:{id,email:id+'@example.invalid',displayName:id,passwordHash:'unused',status:'active',...(id===admin?{platformRole:'platform_admin'}:{})}});for(const code of COMPANY_SYSTEM_ROLE_CODES)if(!await db.role.findUnique({where:{id:code}})){await db.role.create({data:{id:code,name:'Template '+code,isSystem:true}});templates.push(code);}token=createAuthService().signToken({userId:admin,roles:[],permissions:[],departmentIds:[]});app=express();app.use(express.json());app.use(cookieParser());app.use('/api/platform',createPlatformRouter({prisma:db}));});
 afterAll(async()=>{if(!db)return;const accounts=[admin,guest,...(ownerId?[ownerId]:[])];await db.auditLog.deleteMany({where:{actorId:{in:accounts}}});if(companyId)await db.company.delete({where:{id:companyId}});await db.userAccount.deleteMany({where:{id:{in:accounts}}});await db.role.deleteMany({where:{id:{in:templates}}});await db.$disconnect();});
 const call=(method:'get'|'post'|'patch'|'delete',p:string)=>request(app)[method]('/api/platform'+p).set('Authorization','Bearer '+token);
 it('creates company, owner and company roles atomically',async()=>{const r=await call('post','/companies').send({name:'霁川服饰',slug,ownerName:'林乔',ownerEmail:mail,seatLimit:1});expect(r.status).toBe(201);companyId=r.body.company.id;ownerId=r.body.owner.id;expect(r.body.initialPassword.length).toBeGreaterThanOrEqual(12);expect(r.headers['cache-control']).toContain('no-store');expect(await db.userRole.count({where:{userId:ownerId,role:{companyId}}})).toBe(1);expect(await db.role.count({where:{companyId}})).toBe(7);});
 it('rejects duplicate company without creating another owner',async()=>{const other='duplicate-'+key+'@example.invalid';expect((await call('post','/companies').send({name:'Duplicate',slug,ownerName:'x',ownerEmail:other})).status).toBe(409);expect(await db.userAccount.count({where:{email:other}})).toBe(0);});
 it('rejects invalid seat limit before creating accounts',async()=>{expect((await call('post','/companies').send({name:'Invalid',slug:'other-'+key,ownerName:'x',ownerEmail:'bad-'+mail,seatLimit:-1})).status).toBe(400);});
 it('enforces seat limit when adding members',async()=>{const r=await call('post',`/companies/${companyId}/members`).send({email:guest+'@example.invalid'});expect(r.status).toBe(409);expect(r.body.error).toBe('SEAT_LIMIT_REACHED');});
 it('updates capacity and adds an existing account',async()=>{expect((await call('patch',`/companies/${companyId}`).send({seatLimit:2})).status).toBe(200);expect((await call('post',`/companies/${companyId}/members`).send({email:guest+'@example.invalid'})).status).toBe(200);});
 it('cannot lower capacity below active membership',async()=>{expect((await call('patch',`/companies/${companyId}`).send({seatLimit:1})).status).toBe(409);});
 it('cannot remove the final company owner',async()=>{expect((await call('delete',`/companies/${companyId}/members/${ownerId}`)).status).toBe(409);});
 it('suspended company cannot add members',async()=>{expect((await call('patch',`/companies/${companyId}`).send({status:'suspended'})).status).toBe(200);expect((await call('post',`/companies/${companyId}/members`).send({email:guest+'@example.invalid'})).status).toBe(409);expect((await call('patch',`/companies/${companyId}`).send({status:'active'})).status).toBe(200);});
 it('removal is reflected in effective member count and can be restored',async()=>{expect((await call('delete',`/companies/${companyId}/members/${guest}`)).status).toBe(200);const list=await call('get','/companies');expect(list.body.companies.find((c:any)=>c.id===companyId).members).toBe(1);expect((await call('post',`/companies/${companyId}/members`).send({email:guest+'@example.invalid'})).status).toBe(200);});
 it('platform staff cannot become a customer owner or member',async()=>{expect((await call('post','/companies').send({name:'Invalid mixed account',slug:'mixed-'+key,ownerEmail:admin+'@example.invalid'})).status).toBe(403);expect((await call('post',`/companies/${companyId}/members`).send({email:admin+'@example.invalid'})).status).toBe(403);});
 it('rejects malformed and non-platform credentials',async()=>{const t=createAuthService().signToken({userId:guest,roles:['owner'],permissions:['*'],departmentIds:[]});expect((await request(app).get('/api/platform/companies').set('Authorization','Bearer '+t)).status).toBe(403);});
 it('protects platform settings, personnel and logs from company accounts',async()=>{
  const t=createAuthService().signToken({userId:guest,roles:['owner'],permissions:['*'],departmentIds:[]});
  expect((await request(app).post('/api/platform/staff').set('Authorization','Bearer '+t).send({displayName:'No',email:'no@example.invalid'})).status).toBe(403);
  for(const path of ['/settings','/staff','/audit'])expect((await request(app).get('/api/platform'+path).set('Authorization','Bearer '+t)).status).toBe(403);
  expect((await request(app).patch('/api/platform/settings').set('Authorization','Bearer '+t).send({plan:'no',seatLimit:null,version:0})).status).toBe(403);
 });
 it('validates settings, guards stale writes, and applies defaults to new companies only',async()=>{
  const original=await db.systemConfig.findUnique({where:{id:'platform::company-defaults'}});let extraId:string|undefined;
  try{
   const before=await call('get','/settings');expect(before.status).toBe(200);
   expect((await call('patch','/settings').send({plan:'',seatLimit:-1,version:before.body.defaults.version})).status).toBe(400);
   const updated=await call('patch','/settings').send({plan:'team',seatLimit:8,version:before.body.defaults.version});expect(updated.status).toBe(200);
   expect((await call('patch','/settings').send({plan:'stale',seatLimit:null,version:before.body.defaults.version})).status).toBe(409);
   const created=await call('post','/companies').send({name:'默认配置验收',slug:'defaults-'+key,ownerEmail:mail});expect(created.status).toBe(201);extraId=created.body.company.id;
   expect(await db.company.findUnique({where:{id:extraId}})).toMatchObject({plan:'team',seatLimit:8});
   expect(await db.company.findUnique({where:{id:companyId}})).toMatchObject({seatLimit:2});
  }finally{if(extraId)await db.company.delete({where:{id:extraId}});if(original)await db.systemConfig.update({where:{id:original.id},data:original});else await db.systemConfig.deleteMany({where:{id:'platform::company-defaults'}});}
 });
 it('limits staff listing and status changes to independent platform accounts',async()=>{
  const list=await call('get','/staff');expect(list.status).toBe(200);expect(list.body.staff.some((s:any)=>s.id===admin)).toBe(true);expect(list.body.staff.some((s:any)=>s.id===guest)).toBe(false);
  expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|metadata/);
  expect((await call('patch',`/staff/${admin}`).send({status:'disabled'})).status).toBe(409);
  expect((await call('patch',`/staff/${guest}`).send({status:'disabled'})).status).toBe(404);
  const second='second-'+key;
  await db.userAccount.create({data:{id:second,email:second+'@example.invalid',displayName:'平台人员',platformRole:'platform_admin',status:'active'}});
  try{expect((await call('patch',`/staff/${second}`).send({status:'disabled'})).status).toBe(200);expect((await call('patch',`/staff/${second}`).send({status:'active'})).status).toBe(200);}finally{await db.userAccount.delete({where:{id:second}});}
 });
 it('paginates platform-only operation records without credential fields',async()=>{
  const list=await call('get','/audit');expect(list.status).toBe(200);expect(list.body.logs.every((r:any)=>r.action.startsWith('platform.'))).toBe(true);expect(list.body.logs.length).toBeLessThanOrEqual(30);
  expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|initialPassword/);expect((await call('get','/audit?page=-1')).status).toBe(400);
 });

 it('creates only a new independent platform identity with a one-time password and forced change',async()=>{
  expect((await call('post','/staff').send({displayName:'Existing company person',email:mail})).status).toBe(409);
  expect((await call('post','/staff').send({displayName:'',email:'bad'})).status).toBe(400);
  const result=await call('post','/staff').send({displayName:'运营同事',email:'operator-'+key+'@example.invalid'});expect(result.status).toBe(201);
  const id=result.body.staff.id;
  try{expect(result.body.initialPassword.length).toBeGreaterThanOrEqual(24);expect(await db.userAccount.findUnique({where:{id}})).toMatchObject({platformRole:'platform_admin',metadata:{forceChangePassword:true}});expect(await db.companyMember.count({where:{userId:id}})).toBe(0);expect(await db.userRole.count({where:{userId:id}})).toBe(0);const list=await call('get','/staff');expect(JSON.stringify(list.body)).not.toContain(result.body.initialPassword);const audit=await db.auditLog.findFirst({where:{action:'platform.staff.create',targetId:id}});expect(JSON.stringify(audit)).not.toContain(result.body.initialPassword);}finally{await db.userAccount.delete({where:{id}});}
 });

});
