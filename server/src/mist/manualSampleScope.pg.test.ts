import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
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
describe.skipIf(!url)('manual sample source scope on real PostgreSQL',()=>{
 const companyId=randomUUID(),foreignCompanyId=randomUUID(),rootDept=randomUUID(),foreignRootDept=randomUUID(),dept=randomUUID(),foreignDept=randomUUID(),key=randomUUID();
 const creator='sample-creator-'+key,borrower='sample-borrower-'+key,stranger='sample-stranger-'+key,head='sample-head-'+key,foreign='sample-foreign-'+key;
 const users=[creator,borrower,stranger,head,foreign],borrowerRole='sample-borrower-role-'+key;
 let db:PrismaClient,app:ReturnType<typeof createMistServer>,directory:string,wid:string,foreignWid:string,writePermission:string;
 const tokens:Record<string,string>={},workspaces:string[]=[];
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/bambook_(account|acceptance|test)(?:_|$)/.test(target.pathname))throw Error('Dedicated local validation database required');
  directory=await mkdtemp(path.join(tmpdir(),'mist-manual-sample-'));vi.stubEnv('NODE_ENV','test');vi.stubEnv('MIST_LOCAL_WORKSPACE','0');vi.stubEnv('MIST_FILES_DIR',path.join(directory,'files'));vi.stubEnv('MIST_MAIL_CREDENTIAL_DIR',path.join(directory,'mail'));vi.stubEnv('BAMBOOK_AI_SUBSCRIPTION_DIR',path.join(directory,'ai'));vi.stubEnv('BAMBOOK_MARKET_DIR',path.join(directory,'market'));
  db=new PrismaClient({datasourceUrl:url});
  for(const id of[companyId,foreignCompanyId]){await db.company.create({data:{id,slug:id,name:'Sample scope '+id}});await db.$transaction(tx=>provisionCompanyRoles(tx,id));for(const scope of['products:read','products:write']){const permission=await db.permission.findFirstOrThrow({where:{scope}}),roleId=companyRoleId(SYSTEM_ROLE_IDS.SALES,id);if(!await db.rolePermission.findFirst({where:{roleId,permissionId:permission.id}}))await db.rolePermission.create({data:{id:randomUUID(),roleId,permissionId:permission.id}});}}
  await db.department.create({data:{id:rootDept,companyId,name:'Company'}});await db.department.create({data:{id:foreignRootDept,companyId:foreignCompanyId,name:'Company'}});
  await db.department.create({data:{id:dept,parentId:rootDept,companyId,name:'Business',metadata:{businessAttributes:['fabric_business','garment_business']}}});await db.department.create({data:{id:foreignDept,parentId:foreignRootDept,companyId:foreignCompanyId,name:'Business',metadata:{businessAttributes:['fabric_business','garment_business']}}});
  await db.role.create({data:{id:borrowerRole,companyId,name:'Sample colleague'}});
  for(const scope of['products:read','products:write']){const p=await db.permission.findFirstOrThrow({where:{scope}});await db.rolePermission.create({data:{id:randomUUID(),roleId:borrowerRole,permissionId:p.id}});if(scope==='products:write')writePermission=p.id;}
  for(const id of users){const company=id===foreign?foreignCompanyId:companyId,department=id===foreign?foreignDept:dept;await db.userAccount.create({data:{id,displayName:[creator,stranger].includes(id)?'Same sample handler':id,email:id+'@example.invalid',status:'active',primaryDeptId:department}});await db.companyMember.create({data:{companyId:company,userId:id}});await db.userRole.create({data:{id:randomUUID(),userId:id,departmentId:department,roleId:id===borrower?borrowerRole:companyRoleId(SYSTEM_ROLE_IDS.SALES,company)}});}
  await db.department.update({where:{id:dept},data:{headId:head}});const auth=createAuthService();for(const id of users){const payload=await buildLoadedAuthTokenPayload(db,(await loadUserWithRoles(db,id))!,id===foreign?foreignCompanyId:companyId);expect(payload.permissions).toContain('products:write');tokens[id]=auth.signToken(payload);}app=createMistServer(db,{host:'127.0.0.1'});
 });
 beforeEach(async()=>{
  if(workspaces.length){await db.mistCommandReceipt.deleteMany({where:{workspaceId:{in:workspaces}}});await db.mistWorkspace.deleteMany({where:{id:{in:workspaces}}});workspaces.length=0;}
  wid=randomUUID();foreignWid=randomUUID();
  for(const[id,company,owner]of[[wid,companyId,creator],[foreignWid,foreignCompanyId,foreign]]){const state=createMistState({id:randomUUID,now:'2026-11-18T04:00:00.000Z',actorName:'Fixture'},'empty');state.settings.businessClock={mode:'fixed',at:'2026-11-18T04:00:00.000Z',timezone:'Asia/Shanghai'};state.memberIds=company===companyId?[borrower,stranger,head]:[];await db.mistWorkspace.create({data:{id,companyId:company,ownerId:owner,slug:'manual-scope-'+id,name:'Sample scope',state:state as any}});workspaces.push(id);}
 });
 afterAll(async()=>{if(db){await db.mistCommandReceipt.deleteMany({where:{workspaceId:{in:workspaces}}});await db.mistWorkspace.deleteMany({where:{id:{in:workspaces}}});await db.auditLog.deleteMany({where:{OR:[{companyId:{in:[companyId,foreignCompanyId]}},{actorId:{in:users}}]}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.rolePermission.deleteMany({where:{role:{companyId:{in:[companyId,foreignCompanyId]}}}});await db.role.deleteMany({where:{companyId:{in:[companyId,foreignCompanyId]}}});await db.companyMember.deleteMany({where:{companyId:{in:[companyId,foreignCompanyId]}}});await db.userAccount.deleteMany({where:{id:{in:users}}});await db.department.deleteMany({where:{companyId:{in:[companyId,foreignCompanyId]}}});await db.company.deleteMany({where:{id:{in:[companyId,foreignCompanyId]}}});await db.$disconnect();}vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});
 const raw=()=>db.mistWorkspace.findUniqueOrThrow({where:{id:wid}});
 const receipts=()=>db.mistCommandReceipt.count({where:{workspaceId:wid}});
 const get=(user:string,workspace=wid)=>request(app).get('/api/mist/workspaces/'+workspace).set('Authorization','Bearer '+tokens[user]);
 const command=async(user:string,type:string,payload:unknown)=>request(app).post('/api/mist/workspaces/'+wid+'/commands').set('Authorization','Bearer '+tokens[user]).send({requestId:randomUUID(),expectedRevision:(await raw()).revision,command:{type,payload}});
 const create=async(user=creator,extra:Record<string,unknown>={})=>{const r=await command(user,'fulfillment.samples.create',{name:'Cotton sample',category:'面料',form:'米样',unit:'米',quantity:3,location:'A',size:'150cm',color:'Blue',note:'Supplier sample',fileIds:[],source:{kind:'manual',description:'Supplier sheet'},...extra});expect(r.status,JSON.stringify(r.body.error)).toBe(200);return r.body.receipt.result.id as string;};
 const lend=async(sampleId:string,to=borrower,user=creator)=>{const r=await command(user,'fulfillment.samples.move',{id:sampleId,kind:'lend',quantity:2,borrowerId:to,location:'',person:'',note:'Sample handover',expectedReturn:'2026-11-20'});expect(r.status,JSON.stringify(r.body.error)).toBe(200);return r.body.receipt.result.id as string;};
 const returning=(sampleId:string,loanId:string,quantity=1)=>command(borrower,'fulfillment.samples.move',{id:sampleId,kind:'return',quantity,loanId,person:borrower,location:'B',note:'Checked and returned'});
 it('uses a trusted registration identity and never treats equal names as access',async()=>{
  const id=await create();expect(((await raw()).state as any).fulfillment.samples.find((s:any)=>s.id===id).registeredById).toBe(creator);
  expect((await get(creator)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(true);expect((await get(head)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(true);
  expect((await get(stranger)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(false);expect((await get(borrower)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(false);
 });
 it('permits the exact bound borrower to return twice and retain the genuine handling history',async()=>{
  const id=await create(),loan=await lend(id);expect((await get(borrower)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(true);
  for(let i=0;i<2;i++){const r=await returning(id,loan);expect(r.status,JSON.stringify(r.body.error)).toBe(200);}
  const state=(await raw()).state as any;expect(state.fulfillment.samples.find((s:any)=>s.id===id)).toMatchObject({quantity:3,available:3,registeredById:creator});expect(state.fulfillment.sampleMovements.filter((m:any)=>m.loanId===loan&&m.kind==='return').reduce((n:number,m:any)=>n+m.quantity,0)).toBe(2);expect((await get(borrower)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(true);
 });
 it('keeps foreign-company and unrelated sample identifiers outside the borrower grant',async()=>{
  const id=await create(),loan=await lend(id),hidden=await create(stranger);const before=await raw(),count=await receipts();const rejected=await returning(hidden,loan);expect([403,404,422]).toContain(rejected.status);expect(await raw()).toEqual(before);expect(await receipts()).toBe(count);
  expect((await get(borrower)).body.workspace.state.fulfillment.samples.some((s:any)=>s.id===hidden)).toBe(false);expect([403,404]).toContain((await get(foreign)).status);expect([403,404]).toContain((await get(creator,foreignWid)).status);
 });
 it('rechecks current write permission even when the borrower keeps the old login',async()=>{
  const id=await create(),loan=await lend(id);await db.rolePermission.deleteMany({where:{roleId:borrowerRole,permissionId:writePermission}});try{const before=await raw(),count=await receipts();expect((await returning(id,loan)).status).toBe(403);expect(await raw()).toEqual(before);expect(await receipts()).toBe(count);}finally{await db.rolePermission.create({data:{id:randomUUID(),roleId:borrowerRole,permissionId:writePermission}});}
  expect((await returning(id,loan)).status).toBe(200);
 });
 it('rejects a supplied registration identity without creating a sample or receipt',async()=>{
  const before=await raw(),count=await receipts(),r=await command(creator,'fulfillment.samples.create',{name:'Forged owner',category:'面料',form:'米样',unit:'米',quantity:3,location:'A',size:'',color:'',note:'',fileIds:[],source:{kind:'manual',description:'Supplier sheet'},registeredById:stranger});
  expect(r.status).toBe(422);expect(await raw()).toEqual(before);expect(await receipts()).toBe(count);
 });
 it('allows only the registered and exact borrower scopes to download the manual original',async()=>{
  const bytes=Buffer.from('Supplier sample original\n'),uploaded=await request(app).post('/api/mist/workspaces/'+wid+'/files').set('Authorization','Bearer '+tokens[creator]).field('requestId',randomUUID()).field('expectedRevision',String((await raw()).revision)).attach('file',bytes,{filename:'supplier-sample.txt',contentType:'text/plain'});expect(uploaded.status).toBe(201);
  const fileId=uploaded.body.receipt.result.fileId,id=await create(creator,{fileIds:[fileId]}),loan=await lend(id);expect(loan).toBeTruthy();
  const download=(user:string)=>request(app).get('/api/mist/workspaces/'+wid+'/files/'+fileId).set('Authorization','Bearer '+tokens[user]);for(const user of[creator,borrower]){const original=await download(user);expect(original.status).toBe(200);expect(Buffer.from(original.body)).toEqual(bytes);}expect((await download(stranger)).status).toBe(404);expect([403,404]).toContain((await download(foreign)).status);
  expect((await get(stranger)).body.workspace.state.files.some((f:any)=>f.id===fileId)).toBe(false);
 });
});
