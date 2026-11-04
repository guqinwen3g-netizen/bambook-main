import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminRouter } from '../route';
import { createAuthService } from '../../auth/service';
const token = createAuthService().signToken({ userId:'owner', roles:['owner'], permissions:['users:write'], departmentIds:[] });
function fixture() {
 const tx = { $queryRaw: vi.fn().mockResolvedValue([]), userAccount: { findUnique: vi.fn().mockResolvedValue({ id:'pending',status:'pending' }), create: vi.fn().mockResolvedValue({ id:'new' }), update: vi.fn().mockResolvedValue({id:'pending'}) }, userRole: { deleteMany: vi.fn(), create: vi.fn() } };
 const prisma:any = { userAccount: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue({ id:'pending',status:'pending',email:null }) }, role: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) }, department: { findUnique: vi.fn().mockResolvedValue({id:'dept',parentId:'company',status:'active'}) }, auditLog: { create:vi.fn() }, $transaction:vi.fn(async (fn:any)=>fn(tx)) };
 const app=express(); app.use(express.json());app.use('/admin',createAdminRouter({prisma}));return {app,prisma,tx};
}
function companyFixture() {
 const companyId='11111111-1111-4111-8111-111111111111', ownerRole='role-super-admin@'+companyId, salesRole='role-sales@'+companyId;
 const tx={
  $queryRaw:vi.fn().mockResolvedValue([]),
  companyMember:{findMany:vi.fn().mockResolvedValue([{companyId}]),findUnique:vi.fn().mockResolvedValue({status:'active'}),count:vi.fn().mockResolvedValue(1)},
  userAccount:{findUnique:vi.fn().mockResolvedValue({id:'owner',status:'active',displayName:'Owner',email:'owner@example.invalid'}),update:vi.fn()},
  userRole:{findMany:vi.fn().mockResolvedValue([{roleId:ownerRole,departmentId:'department'}]),deleteMany:vi.fn(),create:vi.fn()},
  role:{findMany:vi.fn().mockResolvedValue([{id:salesRole,name:'业务员'}])},
  department:{findFirst:vi.fn().mockResolvedValue({id:'department'})},
  employeeProfile:{findFirst:vi.fn().mockResolvedValue(null)},
  teamMember:{updateMany:vi.fn()},team:{updateMany:vi.fn()},auditLog:{create:vi.fn()},
 };
 const prisma={...tx,$transaction:vi.fn(async(fn:any)=>fn(tx))};
 const app=express();app.use(express.json());app.use('/admin',createAdminRouter({prisma:prisma as any}));
 const authorization='Bearer '+createAuthService().signToken({userId:'owner',roles:['owner'],permissions:['users:admin'],departmentIds:[],companyId});
 const unchanged=()=>{expect(tx.userRole.deleteMany).not.toHaveBeenCalled();expect(tx.userRole.create).not.toHaveBeenCalled();expect(tx.userAccount.update).not.toHaveBeenCalled();expect(tx.auditLog.create).not.toHaveBeenCalled();};
 return {app,tx,prisma,authorization,ownerRole,salesRole,unchanged};
}

describe('company account assignment and security through REST',()=>{
 it('cannot demote the current general manager through its already-open account editor',async()=>{
  const f=companyFixture();
  const response=await request(f.app).patch('/admin/users/owner/roles').set('Authorization',f.authorization).send({roles:[f.salesRole],departmentId:'department'});
  expect(response.status).toBe(409);expect(response.body.error).toBe('SELF_OWNER_REQUIRED');f.unchanged();
 });
 it.each(['role','department'])('rejects a foreign company %s before clearing any old assignment',async kind=>{
  const f=companyFixture();
  f.tx.userRole.findMany.mockResolvedValue([{roleId:f.salesRole,departmentId:'department'}]);
  if(kind==='role')f.tx.role.findMany.mockResolvedValue([]);else f.tx.department.findFirst.mockResolvedValue(null as any);
  const response=await request(f.app).patch('/admin/users/employee/roles').set('Authorization',f.authorization).send({roles:[kind==='role'?'foreign-role':f.salesRole],departmentId:kind==='department'?'foreign-department':'department'});
  expect(response.status).toBe(400);expect(response.body.error).toBe(kind==='role'?'INVALID_ROLE':'INVALID_DEPARTMENT');f.unchanged();
 });
 it('requires HR transfer instead of overwriting an employee job directly',async()=>{
  const f=companyFixture();f.tx.userRole.findMany.mockResolvedValue([{roleId:'old-job',departmentId:'department'}]);
  f.tx.employeeProfile.findFirst.mockResolvedValue({id:'profile'} as any);
  const response=await request(f.app).patch('/admin/users/employee/roles').set('Authorization',f.authorization).send({roles:[f.salesRole],departmentId:'department'});
  expect(response.status).toBe(409);expect(response.body.error).toBe('EMPLOYMENT_TRANSFER_REQUIRED');f.unchanged();
 });
 it.each(['reset-password','disable-account'])('does not operate on a foreign company account via %s',async action=>{
  const f=companyFixture();f.tx.companyMember.findMany.mockResolvedValue([{companyId:'22222222-2222-4222-8222-222222222222'}]);
  const response=await request(f.app).post('/admin/users/foreign/'+action).set('Authorization',f.authorization).send({password:'Synthetic-only-123'});
  expect(response.status).toBe(404);expect(f.prisma.$transaction).not.toHaveBeenCalled();f.unchanged();
 });
});

describe('account creation and approval atomicity',()=>{
 it.each(['/users','/users/pending/approve'])('invalid role never activates or creates an account at %s',async path=>{
  const f=fixture();const response=await request(f.app).post(`/admin${path}`).set('Authorization',`Bearer ${token}`).send({ displayName:'New',email:'new@example.com',password:'safe-test-only1',roles:['missing-role'],departmentId:'dept' });
  expect(response.status).toBe(400); expect(f.prisma.$transaction).not.toHaveBeenCalled(); expect(f.tx.userAccount.update).not.toHaveBeenCalled(); expect(f.tx.userAccount.create).not.toHaveBeenCalled();
 });
 it('valid creation persists identity and explicit role in the same transaction',async()=>{
  const f=fixture();f.prisma.role.findUnique.mockResolvedValue({id:'role-sales'});
  const response=await request(f.app).post('/admin/users').set('Authorization',`Bearer ${token}`).send({ displayName:'New',email:'new@example.com',password:'safe-test-only1',roles:['role-sales'],departmentId:'dept' });
  expect(response.status).toBe(200);expect(f.prisma.$transaction).toHaveBeenCalledOnce();expect(f.tx.userAccount.create).toHaveBeenCalledOnce();expect(f.tx.userRole.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({ userId:'new',roleId:'role-sales' })}));
 });
 it('company root cannot be assigned as employment department',async()=>{
  const f=fixture();f.prisma.department.findUnique.mockResolvedValue({id:'company',parentId:null,status:'active'});
  expect((await request(f.app).post('/admin/users').set('Authorization',`Bearer ${token}`).send({displayName:'New',email:'new@example.com',password:'safe-test-only1',departmentId:'company'})).status).toBe(400);
 });
});
