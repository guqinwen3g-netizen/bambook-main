import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {createMistServer} from './server';
import {createAuthService} from '../auth/service';
import {buildLoadedAuthTokenPayload,loadUserWithRoles} from '../auth/tokenHelpers';
import {provisionCompanyRoles,companyRoleId} from '../platform/companyProvisioning';
import {SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {createMistState} from '../shared/mistWorkspace';

const url=process.env.MIST_PG_CONFLICT_TEST_URL;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
describe.skipIf(!url)('company configuration files with real account grants',()=>{
 const companyId=randomUUID(),foreignId=randomUUID(),admin='config-admin-'+randomUUID(),issuer='config-issuer-'+randomUUID(),reader='config-reader-'+randomUUID(),dept=randomUUID(),readerRole='config-reader-role-'+randomUUID();
 let db:PrismaClient,app:ReturnType<typeof createMistServer>,directory:string,wid:string,foreignWid:string,adminToken:string,readerToken:string,sealFile:string;
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/bambook_(account|acceptance|test)/.test(target.pathname))throw Error('A dedicated local acceptance database is required');
  directory=await mkdtemp(path.join(tmpdir(),'company-config-files-'));vi.stubEnv('NODE_ENV','test');vi.stubEnv('MIST_LOCAL_WORKSPACE','0');vi.stubEnv('MIST_FILES_DIR',path.join(directory,'files'));vi.stubEnv('MIST_MAIL_CREDENTIAL_DIR',path.join(directory,'mail'));vi.stubEnv('BAMBOOK_AI_SUBSCRIPTION_DIR',path.join(directory,'ai'));vi.stubEnv('BAMBOOK_MARKET_DIR',path.join(directory,'market'));
  db=new PrismaClient({datasourceUrl:url});for(const id of [companyId,foreignId])await db.company.create({data:{id,slug:id,name:'Configuration '+id}});
  const root=randomUUID();await db.department.create({data:{id:root,companyId,name:'Company'}});await db.department.create({data:{id:dept,companyId,name:'Management',parentId:root,metadata:{businessAttributes:['management']}}});await db.$transaction(tx=>provisionCompanyRoles(tx,companyId));
  const readPermission=await db.permission.findFirstOrThrow({where:{scope:'products:read'}});await db.role.create({data:{id:readerRole,companyId,name:readerRole}});await db.rolePermission.create({data:{id:randomUUID(),roleId:readerRole,permissionId:readPermission.id}});
  for(const id of [admin,issuer,reader]){await db.userAccount.create({data:{id,displayName:id,email:id+'@example.invalid',status:'active',primaryDeptId:dept}});await db.companyMember.create({data:{companyId,userId:id}});await db.userRole.create({data:{id:randomUUID(),userId:id,departmentId:dept,roleId:id===admin?companyRoleId(SYSTEM_ROLE_IDS.ADMIN,companyId):id===issuer?companyRoleId(SYSTEM_ROLE_IDS.SALES,companyId):readerRole}});}
  const auth=createAuthService();adminToken=auth.signToken({userId:admin,companyId,roles:['admin'],permissions:['users:admin'],departmentIds:[dept]});readerToken=auth.signToken({userId:reader,companyId,roles:[],permissions:[],departmentIds:[dept]});app=createMistServer(db,{host:'127.0.0.1'});
  wid=(await request(app).get('/api/mist/workspaces/default').set('Authorization','Bearer '+adminToken).expect(200)).body.workspace.id;
  // Company maintenance follows the current administrator grant, not a legacy library owner field.
  await db.mistWorkspace.update({where:{id:wid},data:{ownerId:issuer}});
  foreignWid=randomUUID();await db.mistWorkspace.create({data:{id:foreignWid,companyId:foreignId,ownerId:admin,slug:'company@'+foreignId,name:'Foreign',state:createMistState({id:randomUUID,now:new Date().toISOString(),actorName:'Fixture'},'empty') as any}});
 });
 afterAll(async()=>{if(db){await db.mistCommandReceipt.deleteMany({where:{workspace:{companyId:{in:[companyId,foreignId]}}}});await db.mistWorkspace.deleteMany({where:{companyId:{in:[companyId,foreignId]}}});await db.auditLog.deleteMany({where:{OR:[{companyId:{in:[companyId,foreignId]}},{actorId:{in:[admin,issuer,reader]}}]}});await db.userRole.deleteMany({where:{userId:{in:[admin,issuer,reader]}}});await db.rolePermission.deleteMany({where:{role:{companyId}}});await db.role.deleteMany({where:{companyId}});await db.companyMember.deleteMany({where:{companyId:{in:[companyId,foreignId]}}});await db.userAccount.deleteMany({where:{id:{in:[admin,issuer,reader]}}});await db.department.deleteMany({where:{companyId}});await db.company.deleteMany({where:{id:{in:[companyId,foreignId]}}});await db.$disconnect();}vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});
 const workspace=async(token=adminToken)=>(await request(app).get('/api/mist/workspaces/'+wid).set('Authorization','Bearer '+token).expect(200)).body.workspace;
 const upload=async(token:string,target=wid)=>{const w=await workspace(token);return request(app).post('/api/mist/workspaces/'+target+'/files').set('Authorization','Bearer '+token).field('requestId',randomUUID()).field('expectedRevision',String(w.revision)).attach('file',png,{filename:'contract-seal.png',contentType:'image/png'});};
 const command=async(type:string,payload:unknown)=>{const w=await workspace();return request(app).post('/api/mist/workspaces/'+wid+'/commands').set('Authorization','Bearer '+adminToken).send({requestId:randomUUID(),expectedRevision:w.revision,command:{type,payload}});};
 it('allows a company administrator to upload and register a seal without acquiring business grants',async()=>{
  const actor=await buildLoadedAuthTokenPayload(db,(await loadUserWithRoles(db,admin))!,companyId);expect(actor.permissions).not.toContain('orders:write');expect(actor.permissions).not.toContain('products:write');expect(actor.permissions).not.toContain('vouchers:write');
  const added=await upload(adminToken);expect(added.status).toBe(201);sealFile=added.body.receipt.result.fileId;const saved=await command('seal.save',{name:'Contract seal',kind:'contract',fileId:sealFile,userIds:[issuer]});expect(saved.status).toBe(200);expect(saved.body.workspace.state.seals[0]).toMatchObject({fileId:sealFile,userIds:[issuer],status:'active'});
  expect((await command('development.saveDraft',{values:{name:'Not permitted'},fileIds:[]})).status).toBe(403);expect((await command('order.create',{type:'garment'})).status).toBe(403);expect((await workspace()).state.drafts).toHaveLength(0);expect((await workspace()).state.orders).toHaveLength(0);
 });
 it('keeps readers, other companies and unapproved seal readers excluded',async()=>{
  expect((await upload(readerToken)).status).toBe(403);expect((await upload(adminToken,foreignWid)).status).toBe(404);const shown=await workspace(readerToken);expect(shown.state.files.some((f:any)=>f.id===sealFile)).toBe(false);await request(app).get('/api/mist/workspaces/'+wid+'/files/'+sealFile).set('Authorization','Bearer '+readerToken).expect(404);
 });
 it('rechecks revoked administrative grants instead of using the old token',async()=>{
  await db.userRole.updateMany({where:{userId:admin},data:{roleId:readerRole}});try{expect((await upload(adminToken)).status).toBe(403);await request(app).get('/api/mist/workspaces/'+wid+'/files/'+sealFile).set('Authorization','Bearer '+adminToken).expect(404);}finally{await db.userRole.updateMany({where:{userId:admin},data:{roleId:companyRoleId(SYSTEM_ROLE_IDS.ADMIN,companyId)}});}
 });
});
