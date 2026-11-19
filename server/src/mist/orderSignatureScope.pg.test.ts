import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {PrismaClient} from '@prisma/client';
import {createMistServer} from './server';
import {MistPrivateFiles} from './files';
import {createAuthService} from '../auth/service';
import {buildLoadedAuthTokenPayload,loadUserWithRoles} from '../auth/tokenHelpers';
import {provisionCompanyRoles,companyRoleId} from '../platform/companyProvisioning';
import {SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {createMistState} from '../shared/mistWorkspace';
import {TEST_SIGNATURE_SVG} from './__tests__/signature';

const url=process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('composite order signature files on real PostgreSQL',()=>{
 const company=randomUUID(),foreignCompany=randomUUID(),rootDept=randomUUID(),dept=randomUUID(),foreignRoot=randomUUID(),foreignDept=randomUUID(),wid=randomUUID();
 const key=randomUUID(),owner='signature-owner-'+key,other='signature-other-'+key,signer='signature-signer-'+key,foreign='signature-foreign-'+key,users=[owner,other,signer,foreign];
 const tokens:Record<string,string>={},orderId=randomUUID(),cancelId=randomUUID(),fileId=randomUUID();
 let db:PrismaClient,app:ReturnType<typeof createMistServer>,directory:string,readPermission:string;
 const at='2026-11-18T04:00:00.000Z',bytes=Buffer.from(TEST_SIGNATURE_SVG);
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/bambook_(account|acceptance|test)(?:_|$)/.test(target.pathname))throw Error('Dedicated local validation database required');
  directory=await mkdtemp(path.join(tmpdir(),'mist-order-signature-'));
  vi.stubEnv('NODE_ENV','test');vi.stubEnv('MIST_LOCAL_WORKSPACE','0');vi.stubEnv('MIST_FILES_DIR',path.join(directory,'files'));vi.stubEnv('MIST_MAIL_CREDENTIAL_DIR',path.join(directory,'mail'));vi.stubEnv('BAMBOOK_AI_SUBSCRIPTION_DIR',path.join(directory,'ai'));vi.stubEnv('BAMBOOK_MARKET_DIR',path.join(directory,'market'));
  db=new PrismaClient({datasourceUrl:url});
  for(const id of[company,foreignCompany]){await db.company.create({data:{id,slug:id,name:'Signature scope'}});await db.$transaction(tx=>provisionCompanyRoles(tx,id));}
  for(const [id,companyId,parentId]of[[rootDept,company,undefined],[dept,company,rootDept],[foreignRoot,foreignCompany,undefined],[foreignDept,foreignCompany,foreignRoot]])await db.department.create({data:{id,companyId,parentId,name:'Business',...(parentId?{metadata:{businessAttributes:['garment_business','fabric_business']}}:{})}});
  for(const id of users){const companyId=id===foreign?foreignCompany:company,departmentId=id===foreign?foreignDept:dept;await db.userAccount.create({data:{id,displayName:'Same handler',email:id+'@example.invalid',status:'active',primaryDeptId:departmentId}});await db.companyMember.create({data:{companyId,userId:id}});await db.userRole.create({data:{id:randomUUID(),userId:id,departmentId,roleId:companyRoleId(SYSTEM_ROLE_IDS.SALES,companyId)}});}
  readPermission=(await db.permission.findFirstOrThrow({where:{scope:'orders:read'}})).id;
  const auth=createAuthService();for(const id of users){const payload=await buildLoadedAuthTokenPayload(db,(await loadUserWithRoles(db,id))!,id===foreign?foreignCompany:company);expect(payload.permissions).toContain('orders:read');tokens[id]=auth.signToken(payload);}
  const state=createMistState({id:randomUUID,now:at,actorName:'Fixture'},'empty');state.memberIds=[other,signer];
  state.orders.push({id:orderId,code:'SO-SIGNATURE',type:'garment',customerId:'customer',customer:'Customer',ownerId:owner,season:'AW27',currency:'USD',amount:84,due:'2026-12-18',progress:0,state:'已取消',tone:'neutral',createdAt:at,governance:{contract:{kind:'external',poNumber:'PO-SIGNATURE',confirmationFileIds:[],internalPurpose:'',receiver:'',paymentMethod:'OA',depositPercent:0,paymentNote:'Acceptance +30 days',incoterm:'FCA',deliveryPlace:'Shanghai'},status:'cancelled',rounds:[],effectiveVersion:1,cancellation:{id:cancelId,status:'approved',reason:'Customer withdrew',requesterId:owner,requesterName:'Same handler',requestedAt:at,reviewerIds:[signer],decidedBy:signer,decidedAt:at}}}as any);
  const stored=await new MistPrivateFiles(path.join(directory,'files')).writeWithId(wid,fileId,{bytes,name:'cancellation-signature.svg',mimeType:'image/svg+xml'},at);state.files.push({...stored,uploadedBy:signer});
  state.decisionSignatures=[{id:randomUUID(),commandType:'order.governance.decide',entityId:orderId+'#cancel:'+cancelId,fileId,actorId:signer,actor:'Same handler',at,requestId:randomUUID(),decision:'approved'}];
  await db.mistWorkspace.create({data:{id:wid,companyId:company,ownerId:owner,slug:'signature-scope-'+wid,name:'Signature scope',state:state as any}});app=createMistServer(db,{host:'127.0.0.1'});
 });
 afterAll(async()=>{if(db){await db.mistCommandReceipt.deleteMany({where:{workspaceId:wid}});await db.mistWorkspace.deleteMany({where:{id:wid}});await db.auditLog.deleteMany({where:{OR:[{companyId:{in:[company,foreignCompany]}},{actorId:{in:users}}]}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.rolePermission.deleteMany({where:{role:{companyId:{in:[company,foreignCompany]}}}});await db.role.deleteMany({where:{companyId:{in:[company,foreignCompany]}}});await db.companyMember.deleteMany({where:{companyId:{in:[company,foreignCompany]}}});await db.userAccount.deleteMany({where:{id:{in:users}}});await db.department.deleteMany({where:{companyId:{in:[company,foreignCompany]}}});await db.company.deleteMany({where:{id:{in:[company,foreignCompany]}}});await db.$disconnect();}vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});
 const get=(user:string,suffix='')=>request(app).get('/api/mist/workspaces/'+wid+suffix).set('Authorization','Bearer '+tokens[user]);
 it('lets the order owner read the exact archived cancellation signature bytes',async()=>{
  const before=await db.mistWorkspace.findUniqueOrThrow({where:{id:wid}}),count=await db.mistCommandReceipt.count({where:{workspaceId:wid}}),view=await get(owner);expect(view.status,JSON.stringify(view.body.error)).toBe(200);expect(view.body.workspace.state.decisionSignatures).toHaveLength(1);
  const file=await get(owner,'/files/'+fileId);expect(file.status,JSON.stringify(file.body.error)).toBe(200);expect(Buffer.from(file.body)).toEqual(bytes);expect(await db.mistWorkspace.findUniqueOrThrow({where:{id:wid}})).toEqual(before);expect(await db.mistCommandReceipt.count({where:{workspaceId:wid}})).toBe(count);
 });
 it('does not grant the same-name colleague or a foreign company access',async()=>{
  const view=await get(other);expect(view.status).toBe(200);expect(view.body.workspace.state.orders).toEqual([]);expect(view.body.workspace.state.decisionSignatures).toEqual([]);expect((await get(other,'/files/'+fileId)).status).toBe(404);expect([403,404]).toContain((await get(foreign,'/files/'+fileId)).status);
 });
 it('rechecks module revocation for an existing owner token',async()=>{
  const roleId=companyRoleId(SYSTEM_ROLE_IDS.SALES,company);await db.rolePermission.deleteMany({where:{roleId,permissionId:readPermission}});
  try{const view=await get(owner);expect(view.status).toBe(200);expect(view.body.workspace.state.orders).toEqual([]);expect(view.body.workspace.state.decisionSignatures).toEqual([]);expect((await get(owner,'/files/'+fileId)).status).toBe(404);}finally{await db.rolePermission.create({data:{id:randomUUID(),roleId,permissionId:readPermission}});}
  expect((await get(owner,'/files/'+fileId)).status).toBe(200);
 });
});
