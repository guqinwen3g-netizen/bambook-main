import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOrganizationDepartment,updateOrganizationDepartment } from '../organizationService';
import { createHRRouter } from '../route';
import { runWithCompanyContext } from '../../auth/requestCompanyContext';
function database() {
  const tx = {
    department: { findUnique: vi.fn().mockResolvedValue({ id: 'department', parentId: 'company', status: 'active' }), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => data) },
    team: { findUnique: vi.fn().mockResolvedValue({ id: 'team', departmentId: 'department', status: 'active', deletedAt: null }) },
    userAccount: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => data) },
    employeeProfile: { create: vi.fn().mockResolvedValue({}) }, teamMember: { create: vi.fn().mockResolvedValue({}) },
  };
  return { tx, prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) } as any };
}
const person = { displayName: 'New Person', departmentId: 'department', teamId: 'team', hireDate: '2026-10-08' };
describe('organization operations', () => {
  it('rejects second company/root creation', async () => {
    const { prisma } = database();
    await expect(createOrganizationDepartment(prisma, { name: 'Second company' })).rejects.toThrow('仅支持一个公司');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('creates department under company', async () => {
    const { prisma, tx } = database();
    tx.department.findUnique.mockResolvedValue({ id: 'company', parentId: null, status: 'active' });
    expect((await createOrganizationDepartment(prisma, { name: 'Marketing', parentId: 'company' })).parentId).toBe('company');
  });
  it('rejects department beneath noncompany', async () => {
    const { prisma, tx } = database();
    await expect(createOrganizationDepartment(prisma, { name: 'Invalid', parentId: 'department' })).rejects.toThrow('公司节点');
    expect(tx.department.create).not.toHaveBeenCalled();
  });
  it('rejects HR account creation without writing identity', async () => {
    const app = express(); app.use(express.json()); app.use('/hr', createHRRouter({ prisma: {} as any, requireAuth: false }));
    expect((await request(app).post('/hr/personnel').send(person)).status).toBe(410);
  });
  for (const path of ['/projects', '/projects/old', '/assignments', '/assignments/old']) {
    it(`retires ${path}`, async () => {
      const app = express(); app.use('/hr', createHRRouter({ prisma: {} as any, requireAuth: false }));
      expect((await request(app).get(`/hr${path}`)).status).toBe(410);
    });
  }
});

function headDatabase(){
 const current={id:'department',name:'面料部',companyId:'company-a',parentId:'company-root',headId:null as string|null,status:'active',metadata:{businessAttributes:['fabric_business']},updatedAt:new Date('2026-11-15T00:00:00.000Z')};
 const tx={department:{findUnique:vi.fn(async({where}:any)=>where.id==='company-root'?{...current,id:'company-root',parentId:null}:current),findUniqueOrThrow:vi.fn(async()=>current),findFirst:vi.fn(async()=>null),create:vi.fn(async({data}:any)=>data),update:vi.fn(async({data}:any)=>Object.assign(current,data)),updateMany:vi.fn(async({where,data}:any)=>{if(Object.prototype.hasOwnProperty.call(where,'headId')&&where.headId!==current.headId||where.updatedAt&&where.updatedAt.getTime()!==current.updatedAt.getTime())return{count:0};Object.assign(current,data);return{count:1};})},userAccount:{count:vi.fn(async()=>1)},employeeProfile:{findMany:vi.fn(async()=>[] as Array<{employmentStatus:string}>)} };
 const prisma={$transaction:vi.fn(async(work:any)=>work(tx)),department:tx.department} as any;
 const assign=(input:Parameters<typeof updateOrganizationDepartment>[2],allowed=true)=>runWithCompanyContext('company-a',()=>updateOrganizationDepartment(prisma,current.id,{expectedUpdatedAt:current.updatedAt.toISOString(),...input},{canAssignHead:allowed}));return{current,tx,prisma,assign};
}
describe('department head appointments',()=>{
 it('requires account and role administration even when HR editing is allowed',async()=>{
  const{assign,prisma}=headDatabase();await expect(assign({headId:'head',expectedHeadId:null},false)).rejects.toMatchObject({status:403});expect(prisma.$transaction).not.toHaveBeenCalled();
 });
 it('does not allow an unauthenticated HR route to appoint a head when ordinary route auth is disabled',async()=>{
  const{prisma,tx}=headDatabase(),app=express();app.use(express.json());app.use('/hr',createHRRouter({prisma,requireAuth:false}));
  expect((await request(app).patch('/hr/departments/department').send({headId:'head',expectedHeadId:null})).status).toBe(403);expect(tx.department.updateMany).not.toHaveBeenCalled();expect(tx.department.update).not.toHaveBeenCalled();
 });
 it('checks an active current-company account and keeps appointments independent of its primary department',async()=>{
  const{assign,tx,current}=headDatabase();await assign({headId:'head',expectedHeadId:null});expect(current.headId).toBe('head');
  expect(tx.userAccount.count).toHaveBeenCalledWith({where:{id:'head',status:'active',deletedAt:null,companyMembers:{some:{companyId:'company-a',status:'active'}}}});
  expect(tx.employeeProfile.findMany).toHaveBeenCalledWith({where:{companyId:'company-a',userId:'head',deletedAt:null},select:{employmentStatus:true}});
 });
 it('rejects an account excluded by active status, deletion or current-company membership',async()=>{
  const{assign,tx,current}=headDatabase();tx.userAccount.count.mockResolvedValue(0);await expect(assign({headId:'unavailable',expectedHeadId:null})).rejects.toThrow('本公司在职');expect(current.headId).toBeNull();expect(tx.department.updateMany).not.toHaveBeenCalled();
 });
 it.each(['Suspended','Resigned','Terminated'])('rejects a head whose current company employment is %s',async employmentStatus=>{
  const{assign,tx}=headDatabase();tx.employeeProfile.findMany.mockResolvedValue([{employmentStatus}]);await expect(assign({headId:'head',expectedHeadId:null})).rejects.toThrow('本公司在职');expect(tx.department.updateMany).not.toHaveBeenCalled();
 });
 it('accepts an active company employment alongside an ended appointment',async()=>{
  const{assign,tx,current}=headDatabase();tx.employeeProfile.findMany.mockResolvedValue([{employmentStatus:'Resigned'},{employmentStatus:'Regular'}]);await assign({headId:'head',expectedHeadId:null});expect(current.headId).toBe('head');
 });
 it('preserves the current head when a normal HR edit omits head fields',async()=>{
  const{assign,current,tx}=headDatabase();current.headId='head';await assign({name:'新部门名'},false);expect(current.headId).toBe('head');expect(current.name).toBe('新部门名');expect(tx.userAccount.count).not.toHaveBeenCalled();
 });
 it('clears an appointment explicitly without deleting any account or employment',async()=>{
  const{assign,current,tx}=headDatabase();current.headId='head';await assign({headId:null,expectedHeadId:'head'});expect(current.headId).toBeNull();expect(tx.userAccount.count).not.toHaveBeenCalled();expect(tx.employeeProfile.findMany).not.toHaveBeenCalled();
 });
 it('rejects an outdated or missing appointment snapshot before writing any field',async()=>{
  const{assign,current,tx}=headDatabase();current.headId='newer-head';await expect(assign({name:'stale name',headId:'old-editor-head',expectedHeadId:null})).rejects.toMatchObject({status:409});await expect(assign({headId:null})).rejects.toMatchObject({status:409});expect(current.name).toBe('面料部');expect(tx.department.updateMany).not.toHaveBeenCalled();
 });
 it('uses a database compare-and-set so a concurrent appointment cannot be overwritten after validation',async()=>{
  const{assign,tx}=headDatabase();tx.department.updateMany.mockResolvedValue({count:0});await expect(assign({headId:'head',expectedHeadId:null})).rejects.toMatchObject({status:409});expect(tx.department.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'department',headId:null,status:'active',updatedAt:expect.any(Date)})}));expect(tx.department.update).not.toHaveBeenCalled();
 });
 it('requires the selected department to belong to the request company',async()=>{
  const{assign,current,tx}=headDatabase();current.companyId='other-company';await expect(assign({headId:'head',expectedHeadId:null})).rejects.toMatchObject({status:404});expect(tx.userAccount.count).not.toHaveBeenCalled();expect(tx.department.updateMany).not.toHaveBeenCalled();
 });
 it('does not accept a head appointment without an explicit company context',async()=>{
  const{prisma,tx}=headDatabase();await expect(updateOrganizationDepartment(prisma,'department',{headId:'head',expectedHeadId:null},{canAssignHead:true})).rejects.toMatchObject({status:404});expect(tx.department.updateMany).not.toHaveBeenCalled();
 });
 it('validates a new department head before creating the department',async()=>{
  const{prisma,tx}=headDatabase();tx.userAccount.count.mockResolvedValue(0);await expect(runWithCompanyContext('company-a',()=>createOrganizationDepartment(prisma,{name:'新部门',parentId:'company-root',headId:'unavailable'},{canAssignHead:true}))).rejects.toThrow('本公司在职');expect(tx.department.create).not.toHaveBeenCalled();
 });
 it('creates the department with its validated head in the same transaction',async()=>{
  const{prisma,tx}=headDatabase();const d=await runWithCompanyContext('company-a',()=>createOrganizationDepartment(prisma,{name:'新部门',parentId:'company-root',headId:'head'},{canAssignHead:true}));expect(d.headId).toBe('head');expect(tx.department.create).toHaveBeenCalledTimes(1);
 });
 it('rejects a name-only stale editor instead of restoring its old business attributes',async()=>{
  const{assign,current}=headDatabase(),original=current.updatedAt.toISOString();await assign({businessAttributes:['fabric_business','marketing']},false);const latest=structuredClone(current);await expect(assign({name:'旧表单名称',businessAttributes:['fabric_business'],expectedUpdatedAt:original},false)).rejects.toMatchObject({status:409});expect(current).toEqual(latest);
 });
 it('requires a usable department version even for ordinary HR edits',async()=>{
  const{prisma,tx}=headDatabase();for(const expectedUpdatedAt of[undefined,'invalid'])await expect(updateOrganizationDepartment(prisma,'department',{name:'新部门名',expectedUpdatedAt})).rejects.toMatchObject({status:409});expect(tx.department.updateMany).not.toHaveBeenCalled();
 });
 it('advances the version for separate edits even if the wall clock has not advanced a millisecond',async()=>{
  const{assign,current}=headDatabase(),clock=vi.spyOn(Date,'now').mockReturnValue(current.updatedAt.getTime()),initial=current.updatedAt.getTime();try{await assign({name:'第一次'},false);expect(current.updatedAt.getTime()).toBeGreaterThan(initial);const first=current.updatedAt.getTime();await assign({name:'第二次'},false);expect(current.updatedAt.getTime()).toBeGreaterThan(first);}finally{clock.mockRestore();}
 });
});
