import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createHRRouter} from './route';
import {createAuthService} from '../auth/service';
import {createAuthorizationSnapshotGuard} from '../auth/authorizationSnapshotGuard';
import {tenantSurfaceGuard} from '../auth/tenantSurfaceGuard';

const url=process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('department head appointments on PostgreSQL',()=>{
 const a=randomUUID(),b=randomUUID(),key=randomUUID();
 const id=(name:string)=>'head-'+name+'-'+key;
 const owner=id('owner'),writer=id('hr'),first=id('first'),second=id('second'),foreign=id('foreign'),disabled=id('disabled'),suspended=id('suspended'),left=id('left');
 const people=[owner,writer,first,second,foreign,disabled,suspended,left];
 const rootA=id('root-a'),rootB=id('root-b'),dept=id('dept'),other=id('other'),deptB=id('dept-b');
 const adminRole=id('admin-role'),hrRole=id('hr-role'),staffRole=id('staff-role');
 let db:PrismaClient,app:express.Express,bossToken:string,hrToken:string,originalVersion:string;
 beforeAll(async()=>{
  db=new PrismaClient({datasourceUrl:url});
  for(const companyId of[a,b])await db.company.create({data:{id:companyId,slug:companyId,name:companyId}});
  for(const userId of people)await db.userAccount.create({data:{id:userId,displayName:userId,email:userId+'@example.invalid',passwordHash:'unused-test-hash',status:userId===disabled?'disabled':'active'}});
  for(const[departmentId,companyId,parentId]of[[rootA,a,null],[rootB,b,null],[dept,a,rootA],[other,a,rootA],[deptB,b,rootB]])await db.department.create({data:{id:departmentId!,companyId,name:departmentId!,parentId,status:'active'}});
  for(const[roleId,code]of[[adminRole,'role-super-admin'],[staffRole,'role-sales']])await db.role.create({data:{id:roleId,companyId:a,code,name:roleId,isSystem:true}});
  await db.role.create({data:{id:hrRole,companyId:a,name:hrRole,isSystem:false}});
  for(const scope of['hr:read','hr:write']){const permission=await db.permission.upsert({where:{scope},update:{},create:{id:randomUUID(),scope}});await db.rolePermission.create({data:{id:randomUUID(),roleId:hrRole,permissionId:permission.id}});}
  for(const userId of people){const companyId=userId===foreign?b:a;await db.companyMember.create({data:{id:randomUUID(),companyId,userId,status:userId===left?'suspended':'active'}});if(companyId===a)await db.userRole.create({data:{id:randomUUID(),userId,roleId:userId===owner?adminRole:userId===writer?hrRole:staffRole,departmentId:userId===second?other:dept}});}
  await db.employeeProfile.create({data:{id:randomUUID(),companyId:a,userId:suspended,employeeNo:id('no'),hireDate:'2026-11-01',employmentStatus:'Suspended'}});
  const token=(userId:string,permissions:string[]=[])=>createAuthService().signToken({userId,companyId:a,roles:[],permissions,departmentIds:[]});
  bossToken=token(owner);hrToken=token(writer,['hr:read','hr:write','users:admin']);
  app=express();app.use(express.json());app.use('/api',createAuthorizationSnapshotGuard({prisma:db}),tenantSurfaceGuard);app.use('/api/hr',createHRRouter({prisma:db}));
 });
 beforeEach(async()=>{const row=await db.department.update({where:{id:dept},data:{headId:null,name:'面料一部',metadata:{businessAttributes:['fabric_business']}}});originalVersion=row.updatedAt.toISOString();});
 afterAll(async()=>{
  if(!db)return;
  await db.auditLog.deleteMany({where:{actorId:{in:people}}});await db.employeeProfile.deleteMany({where:{companyId:{in:[a,b]}}});
  await db.userRole.deleteMany({where:{userId:{in:people}}});await db.role.deleteMany({where:{companyId:{in:[a,b]}}});
  await db.department.deleteMany({where:{companyId:{in:[a,b]}}});await db.company.deleteMany({where:{id:{in:[a,b]}}});await db.userAccount.deleteMany({where:{id:{in:people}}});await db.$disconnect();
 });
 const patch=(body:Record<string,unknown>,token=bossToken,target=dept)=>request(app).patch('/api/hr/departments/'+target).set('Authorization','Bearer '+token).send({expectedUpdatedAt:originalVersion,...body});
 const auditFailingApp=()=>{
  const failAudit=(client:any):any=>new Proxy(client,{get(target,key){
   if(key==='$transaction'&&typeof target.$transaction==='function')return(work:any)=>target.$transaction((tx:any)=>work(failAudit(tx)));
   if(key==='auditLog')return new Proxy(target.auditLog,{get(delegate,method){if(method==='create')return async()=>{throw new Error('Injected organization audit failure');};return delegate[method];}});
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const failing=express();failing.use(express.json());failing.use('/api',createAuthorizationSnapshotGuard({prisma:db}),tenantSurfaceGuard);failing.use('/api/hr',createHRRouter({prisma:failAudit(db)}));return failing;
 };
 it('requires current account administration instead of trusting old JWT permissions or HR write permission',async()=>{
  const result=await patch({headId:first,expectedHeadId:null},hrToken);expect(result.status).toBe(403);expect((await db.department.findUniqueOrThrow({where:{id:dept}})).headId).toBeNull();
 });
 it('appoints a same-company head from another department, exposes the appointment, preserves it on an HR rename, and clears it explicitly',async()=>{
  const result=await patch({headId:second,expectedHeadId:null});expect(result.status).toBe(200);expect(result.body.result.headId).toBe(second);
  const directory=await request(app).get('/api/hr/personnel').set('Authorization','Bearer '+bossToken);expect(directory.status).toBe(200);expect(directory.body.departments.find((d:any)=>d.id===dept).headId).toBe(second);
  const logs=await db.auditLog.findMany({where:{actorId:owner,targetId:dept},orderBy:{createdAt:'desc'}});expect(logs[0].companyId).toBe(a);expect(logs[0].detail).toMatchObject({before:{headId:null},after:{headId:second}});
  const renamed=await patch({name:'面料二部',expectedUpdatedAt:directory.body.departments.find((d:any)=>d.id===dept).updatedAt},hrToken);expect(renamed.status).toBe(200);expect((await db.department.findUniqueOrThrow({where:{id:dept}})).headId).toBe(second);
  expect((await patch({headId:null,expectedHeadId:second,expectedUpdatedAt:renamed.body.result.updatedAt})).status).toBe(200);expect((await db.department.findUniqueOrThrow({where:{id:dept}})).headId).toBeNull();
  expect(await db.userAccount.count({where:{id:second,status:'active'}})).toBe(1);
 });
 it.each([['foreign',foreign],['disabled',disabled],['suspended employment',suspended],['suspended membership',left]])('rejects a %s head without changing any department field',async(_label,userId)=>{
  const before=await db.department.findUniqueOrThrow({where:{id:dept}});const result=await patch({name:'must not save',headId:userId,expectedHeadId:null});expect(result.status).toBe(400);expect(await db.department.findUniqueOrThrow({where:{id:dept}})).toEqual(before);
 });
 it('allows only one simultaneous appointment from the same original snapshot and never writes the losing name',async()=>{
  const results=await Promise.all([patch({name:'first choice',headId:first,expectedHeadId:null}),patch({name:'second choice',headId:second,expectedHeadId:null})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);const saved=await db.department.findUniqueOrThrow({where:{id:dept}});expect(saved.name).toBe(saved.headId===first?'first choice':'second choice');
 });
 it('rejects an old appointment snapshot and cannot edit another company department',async()=>{
  expect((await patch({headId:first,expectedHeadId:null})).status).toBe(200);const before=await db.department.findUniqueOrThrow({where:{id:dept}});expect((await patch({name:'stale',headId:second,expectedHeadId:null})).status).toBe(409);expect(await db.department.findUniqueOrThrow({where:{id:dept}})).toEqual(before);
  const foreignBefore=await db.department.findUniqueOrThrow({where:{id:deptB}});const denied=await patch({headId:first,expectedHeadId:null},bossToken,deptB);expect([400,404]).toContain(denied.status);expect(await db.department.findUniqueOrThrow({where:{id:deptB}})).toEqual(foreignBefore);
 });
 it('rejects an old name-only editor instead of restoring its previous business attributes',async()=>{
  const peer=await patch({businessAttributes:['fabric_business','marketing']},hrToken);expect(peer.status).toBe(200);const latest=await db.department.findUniqueOrThrow({where:{id:dept}});const stale=await patch({name:'旧表单名称',businessAttributes:['fabric_business']},hrToken);expect(stale.status).toBe(409);expect(await db.department.findUniqueOrThrow({where:{id:dept}})).toEqual(latest);
  const reopened=await patch({name:'面料二部',businessAttributes:['fabric_business','marketing'],expectedUpdatedAt:peer.body.result.updatedAt},hrToken);expect(reopened.status).toBe(200);expect((await db.department.findUniqueOrThrow({where:{id:dept}})).metadata).toEqual({businessAttributes:['fabric_business','marketing']});
 });
 it('rolls back the appointment and every edited field if its audit cannot be written',async()=>{
  const failing=auditFailingApp();
  const before=await db.department.findUniqueOrThrow({where:{id:dept}});const result=await request(failing).patch('/api/hr/departments/'+dept).set('Authorization','Bearer '+bossToken).send({name:'must roll back',businessAttributes:['marketing'],headId:first,expectedHeadId:null,expectedUpdatedAt:originalVersion});expect(result.status).toBe(500);expect(await db.department.findUniqueOrThrow({where:{id:dept}})).toEqual(before);
 });
 it('does not create a department if its creation audit fails',async()=>{
  const result=await request(auditFailingApp()).post('/api/hr/departments').set('Authorization','Bearer '+bossToken).send({name:'must not exist',parentId:rootA,businessAttributes:['marketing'],headId:first});expect(result.status).toBe(500);expect(await db.department.count({where:{companyId:a,name:'must not exist'}})).toBe(0);
 });
 it('rolls back retirement and all role transfers if the retirement audit fails',async()=>{
  const before=await db.department.findUniqueOrThrow({where:{id:dept}}),roles=await db.userRole.findMany({where:{role:{companyId:a}},orderBy:{id:'asc'}});const result=await request(auditFailingApp()).post('/api/hr/departments/'+dept+'/retire').set('Authorization','Bearer '+bossToken).send({targetDepartmentId:other});expect(result.status).toBe(500);expect(await db.department.findUniqueOrThrow({where:{id:dept}})).toEqual(before);expect(await db.userRole.findMany({where:{role:{companyId:a}},orderBy:{id:'asc'}})).toEqual(roles);
 });
});
