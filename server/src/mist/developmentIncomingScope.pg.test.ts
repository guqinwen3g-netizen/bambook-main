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
import {createMistState,type DevelopmentValues} from '../shared/mistWorkspace';
import {withTestFactories} from '../shared/__tests__/utils/devFactories';

const url=process.env.MIST_PG_CONFLICT_TEST_URL;
/** Dedicated validation DB only. All identities/workspaces are random; cleanup targets only this fixture. */
describe.skipIf(!url)('development incoming originals on real PostgreSQL',()=>{
 const companyId=randomUUID(),foreignCompanyId=randomUUID(),rootDept=randomUUID(),childDept=randomUUID(),foreignDept=randomUUID(),key=randomUUID();
 const owner='incoming-owner-'+key,stranger='incoming-stranger-'+key,reader='incoming-reader-'+key,head='incoming-head-'+key,foreign='incoming-foreign-'+key,ownerRole='incoming-owner-role-'+key;
 const users=[owner,stranger,reader,head,foreign],customerId=randomUUID(),tokens:Record<string,string>={},workspaces:string[]=[];
 let db:PrismaClient,app:ReturnType<typeof createMistServer>,directory:string,wid:string,foreignWid:string,devId:string,versionId:string;
 const now='2026-11-18T04:00:00.000Z',bytes=Buffer.from('%PDF-1.4\nIncoming original fixture, local only.\n');
 const raw=()=>db.mistWorkspace.findUniqueOrThrow({where:{id:wid}}),receiptCount=()=>db.mistCommandReceipt.count({where:{workspaceId:wid}});
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/bambook_test(?:_|$)/.test(target.pathname))throw Error('Dedicated local test database required');
  directory=await mkdtemp(path.join(tmpdir(),'mist-development-incoming-pg-'));vi.stubEnv('NODE_ENV','test');vi.stubEnv('MIST_LOCAL_WORKSPACE','0');for(const[name,sub]of[['MIST_FILES_DIR','files'],['MIST_MAIL_CREDENTIAL_DIR','mail'],['BAMBOOK_AI_SUBSCRIPTION_DIR','ai'],['BAMBOOK_MARKET_DIR','market']])vi.stubEnv(name,path.join(directory,sub));
  db=new PrismaClient({datasourceUrl:url});const identity=await db.$queryRawUnsafe<Array<{db:string;port:number}>>('SELECT current_database() AS db, inet_server_port() AS port');expect(identity).toEqual([{db:decodeURIComponent(target.pathname.slice(1)),port:Number(target.port||5432)}]);
  for(const id of[companyId,foreignCompanyId]){await db.company.create({data:{id,slug:id,name:'Incoming scope '+id}});await db.$transaction(tx=>provisionCompanyRoles(tx,id));for(const scope of['products:read','products:write','suppliers:read','orders:read']){const p=await db.permission.findFirstOrThrow({where:{scope}}),roleId=companyRoleId(SYSTEM_ROLE_IDS.SALES,id);if(!await db.rolePermission.findFirst({where:{roleId,permissionId:p.id}}))await db.rolePermission.create({data:{id:randomUUID(),roleId,permissionId:p.id}});}}
  await db.department.create({data:{id:rootDept,companyId,name:'Company'}});await db.department.create({data:{id:childDept,parentId:rootDept,companyId,name:'Business',metadata:{businessAttributes:['fabric_business','garment_business']}}});await db.department.create({data:{id:foreignDept,companyId:foreignCompanyId,name:'Foreign business',metadata:{businessAttributes:['fabric_business','garment_business']}}});
  await db.role.create({data:{id:ownerRole,companyId,name:'Incoming sales'}});for(const scope of['products:read','products:write','suppliers:read','orders:read']){const p=await db.permission.findFirstOrThrow({where:{scope}});await db.rolePermission.create({data:{id:randomUUID(),roleId:ownerRole,permissionId:p.id}});}
  const readerRole='incoming-reader-role-'+key;await db.role.create({data:{id:readerRole,companyId,name:'Incoming reader'}});for(const scope of['products:read','suppliers:read']){const p=await db.permission.findFirstOrThrow({where:{scope}});await db.rolePermission.create({data:{id:randomUUID(),roleId:readerRole,permissionId:p.id}});}
  for(const id of users){const company=id===foreign?foreignCompanyId:companyId,department=id===foreign?foreignDept:id===head?rootDept:childDept;await db.userAccount.create({data:{id,displayName:id===stranger?'工厂收件人':id===owner?'业务员':id,email:id+'@example.invalid',status:'active',primaryDeptId:department}});await db.companyMember.create({data:{companyId:company,userId:id}});await db.userRole.create({data:{id:randomUUID(),userId:id,departmentId:department,roleId:id===owner?ownerRole:id===reader?readerRole:companyRoleId(SYSTEM_ROLE_IDS.SALES,company)}});}
  await db.department.update({where:{id:rootDept},data:{headId:head}});const auth=createAuthService();for(const id of users)tokens[id]=auth.signToken(await buildLoadedAuthTokenPayload(db,(await loadUserWithRoles(db,id))!,id===foreign?foreignCompanyId:companyId));app=createMistServer(db,{host:'127.0.0.1'});
 });
 beforeEach(async()=>{
  if(workspaces.length){await db.mistCommandReceipt.deleteMany({where:{workspaceId:{in:workspaces}}});await db.mistWorkspace.deleteMany({where:{id:{in:workspaces}}});workspaces.length=0;}
  wid=randomUUID();foreignWid=randomUUID();for(const[id,company,user]of[[wid,companyId,owner],[foreignWid,foreignCompanyId,foreign]]){const state=withTestFactories(createMistState({id:randomUUID,now,actorName:'Fixture'},'empty'));state.settings.businessClock={mode:'fixed',at:now,timezone:'Asia/Shanghai'};state.memberIds=company===companyId?[stranger,reader,head]:[];state.customers.push({id:customerId,name:'客户',code:'INCOMING-C',country:'',city:'',industry:'',owner:'业务员',ownerId:user,grade:'',currency:'CNY',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});await db.mistWorkspace.create({data:{id,companyId:company,ownerId:user,slug:'incoming-'+id,name:'Incoming scope',state:state as any}});workspaces.push(id);}
  const values:DevelopmentValues={domain:'fabric',name:'棉斜纹',customer:customerId,style:'IN-COT',season:'SS27',category:'梭织',kind:'new',requestType:'replicate',fabric:'客户原样',color:'军绿',target:'',sizeBase:'',goal:'按原样核对',factories:['测试面料厂','实际测试面料厂'],due:'2026-11-22',collaborators:[],sampleQuantity:1,sampleForm:'米样',sampleUnit:'米',targetUnit:'米',targetCurrency:'CNY'};
  const created=await command(owner,'development.submit',{values,fileIds:[]});expect(created.status,JSON.stringify(created.body.error)).toBe(200);devId=created.body.receipt.result.devId;versionId=(created.body.workspace.state.versions as any[]).find(v=>v.devId===devId).id;
 });
 afterAll(async()=>{if(db){await db.mistCommandReceipt.deleteMany({where:{workspaceId:{in:workspaces}}});await db.mistWorkspace.deleteMany({where:{id:{in:workspaces}}});await db.auditLog.deleteMany({where:{OR:[{companyId:{in:[companyId,foreignCompanyId]}},{actorId:{in:users}}]}});await db.userRole.deleteMany({where:{userId:{in:users}}});await db.rolePermission.deleteMany({where:{role:{companyId:{in:[companyId,foreignCompanyId]}}}});await db.role.deleteMany({where:{companyId:{in:[companyId,foreignCompanyId]}}});await db.companyMember.deleteMany({where:{companyId:{in:[companyId,foreignCompanyId]}}});await db.userAccount.deleteMany({where:{id:{in:users}}});await db.department.deleteMany({where:{companyId:{in:[companyId,foreignCompanyId]}}});await db.company.deleteMany({where:{id:{in:[companyId,foreignCompanyId]}}});await db.$disconnect();}vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});
 const get=(user:string,workspace=wid)=>request(app).get('/api/mist/workspaces/'+workspace).set('Authorization','Bearer '+tokens[user]);
 async function command(user:string,type:string,payload:unknown,requestId=randomUUID(),expectedRevision?:number){return request(app).post('/api/mist/workspaces/'+wid+'/commands').set('Authorization','Bearer '+tokens[user]).send({requestId,expectedRevision:expectedRevision??(await raw()).revision,command:{type,payload}});}
 const intake=(fileIds:string[]=[])=>({devId,receivedAt:'2026-11-14',name:'客户棉斜纹',form:'米样',quantity:3,unit:'米',size:'150cm',color:'军绿',location:'A01',contact:'客户联系人',fileIds,note:'原样对照'});
 const outgoing=(sampleId:string)=>({devId,taskVersionId:versionId,items:[{sampleId,quantity:1,sourceLocation:'A01'}],sentAt:'2026-11-15',returnExpected:true,expectedReturn:'2026-11-17',delivery:{kind:'courier',recipient:'工厂收件人',address:'工厂样品室',carrier:'顺丰',trackingNo:'LOCAL-INCOMING',evidence:''},postage:{amount:12,currency:'CNY',zeroReason:''},note:'按原样核对'});
 const returning=(dispatchId:string,loanId:string)=>({devId,dispatchId,items:[{loanId,quantity:.5,location:'B02'}],receivedAt:'2026-11-17',delivery:{kind:'courier',recipient:'业务员',address:'公司样品室',carrier:'顺丰',trackingNo:'LOCAL-RETURN',evidence:''},note:'原件退回'});
 async function receive(fileIds:string[]=[]){const r=await command(owner,'development.incoming.receive',intake(fileIds));expect(r.status,JSON.stringify(r.body.error)).toBe(200);return r.body.receipt.result.id as string;}
 async function dispatch(sampleId:string){const r=await command(owner,'development.incoming.dispatch',outgoing(sampleId));expect(r.status,JSON.stringify(r.body.error)).toBe(200);return r.body.receipt.result as {dispatchId:string;movementIds:string[]};}
 async function upload(){const r=await request(app).post('/api/mist/workspaces/'+wid+'/files').set('Authorization','Bearer '+tokens[owner]).field('requestId',randomUUID()).field('expectedRevision',String((await raw()).revision)).attach('file',bytes,{filename:'incoming-original.pdf',contentType:'application/pdf'});expect(r.status,JSON.stringify(r.body.error)).toBe(201);return r.body.receipt.result.fileId as string;}
 const download=(user:string,fileId:string)=>request(app).get('/api/mist/workspaces/'+wid+'/files/'+fileId).set('Authorization','Bearer '+tokens[user]);
 async function denied(user:string,type:string,payload:unknown,status:number[]){const before=await raw(),count=await receiptCount(),r=await command(user,type,payload);expect(status,JSON.stringify(r.body.error)).toContain(r.status);expect(await raw()).toEqual(before);expect(await receiptCount()).toBe(count);}
 it('keeps a supplier task scoped to its garment case and rejects a stale request edit without receipts',async()=>{
  const garment=await command(owner,'development.submit',{values:{name:'带帽夹克',customer:customerId,style:'DRAWSTRING',season:'AW',category:'夹克',kind:'new',fabric:'棉斜纹',color:'绿',target:'',sizeBase:'M',goal:'抽绳活动顺畅',factories:['A厂'],due:'2026-11-25',collaborators:[],sampleQuantity:1},fileIds:[]});
  expect(garment.status,JSON.stringify(garment.body.error)).toBe(200);
  const caseId=garment.body.receipt.result.devId;
  const supplier=garment.body.workspace.state.market.suppliers.find((row:{name:string})=>row.name==='A厂');
  const input={devId:caseId,supplierId:supplier.id,contact:'工厂收件人',requirements:'线绳直径4毫米',quantity:'2',unit:'米',dueDate:'2026-11-24',fileIds:[]};
  await denied(stranger,'development.trimTask.save',input,[403,404]);
  await denied(reader,'development.trimTask.save',input,[403,404]);
  await denied(owner,'development.trimTask.save',{...input,devId},[422]);
  const created=await command(owner,'development.trimTask.save',input);
  expect(created.status,JSON.stringify(created.body.error)).toBe(200);
  const taskId=created.body.receipt.result.id,oldRevision=(await raw()).revision;
  const updated=await command(owner,'development.trimTask.save',{...input,taskId,quantity:'3'});
  expect(updated.status,JSON.stringify(updated.body.error)).toBe(200);
  const previous=await raw(),count=await receiptCount();
  const stale=await command(owner,'development.trimTask.save',{...input,taskId,requirements:'旧窗口'},randomUUID(),oldRevision);
  expect(stale.status,JSON.stringify(stale.body.error)).toBe(409);
  expect(await raw()).toEqual(previous);expect(await receiptCount()).toBe(count);
  await denied(owner,'development.trimTask.confirm',{devId:caseId,taskId,name:'抽绳',specification:'4毫米',color:'绿',fileIds:[]},[422]);
  await denied(foreign,'development.trimTask.notice',{devId:caseId,taskId},[403,404]);
 });
 it('requires a fresh supplier offer and exact case scope when freezing a garment material',async()=>{
  const garment=await command(owner,'development.submit',{values:{name:'夹克',customer:customerId,style:'TRIM-STYLE',season:'AW',category:'夹克',kind:'new',fabric:'棉斜纹',color:'绿',target:'',sizeBase:'M',goal:'对照扣位',factories:['A厂'],due:'2026-11-25',collaborators:[],sampleQuantity:1},fileIds:[]});
  expect(garment.status,JSON.stringify(garment.body.error)).toBe(200);
  const {devId:caseId,versionId:ver}=garment.body.receipt.result;
  const product=await command(owner,'market.product.save',{input:{sku:'TR-TEST',name:'扣子',category:'trimming',season:'',supplierId:'',supplierCode:'',composition:'树脂',specification:'18 mm',color:'绿',unit:'个',cost:'0',currency:'CNY',sourceDevId:'',sourceVersionId:''}});
  expect(product.status,JSON.stringify(product.body.error)).toBe(200);
  const productId=product.body.receipt.result.id,source=(garment.body.workspace.state.market.suppliers as {id:string;name:string}[]).find(r=>r.name==='A厂')!;
  const basis={productId,supplierId:source.id,price:'3.60',currency:'CNY',quoteTerms:{date:'2026-11-10',unit:'打',fileIds:[]}};
  const first=await command(owner,'market.product.source.save',basis);expect(first.status,JSON.stringify(first.body.error)).toBe(200);
  const revision=(await raw()).revision;
  expect((await command(owner,'market.product.source.save',{...basis,price:'4.20'})).status).toBe(200);
  const payload={devId:caseId,versionId:ver,productId,offerSupplierId:source.id,position:'门襟',color:'绿',specification:'18 mm',perPiece:'5',unit:'个',provider:'company',colorMode:'specified',colorReference:'',nature:'existing'};
  const before=await raw(),n=await receiptCount(),requestId=randomUUID();
  const stale=await command(owner,'development.material.add',payload,requestId,revision);
  expect(stale.status,JSON.stringify(stale.body.error)).toBe(409);
  const outsider=await command(stranger,'development.material.add',payload);
  expect([403,404]).toContain(outsider.status);expect(await receiptCount()).toBe(n);expect((await raw()).state).toEqual(before.state);
  const ok=await command(owner,'development.material.add',payload);expect(ok.status,JSON.stringify(ok.body.error)).toBe(200);
  const row=ok.body.workspace.state.versions.find((v:{id:string})=>v.id===ver).materialUses[0];
  expect(row.offer.price).toBe('4.20');expect(row.perPiece).toBe('5');
 });
 it('performs HTTP intake, exact factory custody, partial return and original request replay without duplicating inventory or postage',async()=>{
  const id=await receive(),expectedRevision=(await raw()).revision,requestId=randomUUID(),first=await command(owner,'development.incoming.dispatch',outgoing(id),requestId,expectedRevision);expect(first.status,JSON.stringify(first.body.error)).toBe(200);const result=first.body.receipt.result;const r=await command(owner,'development.incoming.return',returning(result.dispatchId,result.movementIds[0]));expect(r.status,JSON.stringify(r.body.error)).toBe(200);
  const before=await raw(),count=await receiptCount(),replay=await command(owner,'development.incoming.dispatch',outgoing(id),requestId,expectedRevision);expect(replay.status).toBe(200);expect(replay.body.replayed).toBe(true);expect(replay.body.receipt).toEqual(first.body.receipt);expect(await raw()).toEqual(before);expect(await receiptCount()).toBe(count);const s=before.state as any,sample=s.fulfillment.samples.find((x:any)=>x.id===id),loan=s.fulfillment.sampleMovements.find((x:any)=>x.id===result.movementIds[0]);expect(sample).toMatchObject({quantity:3,available:2.5,source:{kind:'developmentIncoming',devId},incoming:{receivedAt:'2026-11-14',recordedById:owner}});expect(loan).toMatchObject({borrowerId:'',incomingTransfer:{occurredAt:'2026-11-15',taskVersionId:versionId,supplierId:s.versions.find((v:any)=>v.id===versionId).factoryId}});expect(s.fulfillment.sampleMovements.find((x:any)=>x.loanId===loan.id)).toMatchObject({quantity:.5,incomingTransfer:{occurredAt:'2026-11-17'}});expect(s.devs.find((d:any)=>d.id===devId).billing.expenses).toHaveLength(1);expect(s.devs.find((d:any)=>d.id===devId).billing.expenses[0]).toMatchObject({amount:12,sourceDispatchId:result.dispatchId,sourceMovementIds:[loan.id]});expect(s.fulfillment.qcTasks).toEqual([]);expect(s.invoices).toEqual([]);expect(s.payments).toEqual([]);
 });
 it('keeps a same-name external recipient unbound and grants originals only to the actual case scope including the parent department head',async()=>{
  const fileId=await upload(),id=await receive([fileId]),out=await dispatch(id),state=(await raw()).state as any;expect(state.members.find((m:any)=>m.userId===stranger).name).toBe('工厂收件人');expect(state.fulfillment.sampleMovements.find((m:any)=>m.id===out.movementIds[0]).borrowerId).toBe('');for(const user of[owner,head]){const view=await get(user);expect(view.status).toBe(200);expect(view.body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(true);const original=await download(user,fileId);expect(original.status).toBe(200);expect(Buffer.from(original.body)).toEqual(bytes);}const hidden=await get(stranger);expect(hidden.body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(false);expect(hidden.body.workspace.state.files.some((f:any)=>f.id===fileId)).toBe(false);expect((await download(stranger,fileId)).status).toBe(404);await denied(stranger,'development.incoming.return',returning(out.dispatchId,out.movementIds[0]),[404]);
 });
 it('rechecks current read/write grants with old tokens and refuses foreign-company and read-only callers without receipts',async()=>{
  const id=await receive(),out=await dispatch(id);await denied(reader,'development.incoming.receive',intake(),[403]);await denied(foreign,'development.incoming.receive',intake(),[403,404]);expect([403,404]).toContain((await get(owner,foreignWid)).status);for(const scope of['products:read','products:write']){const p=await db.permission.findFirstOrThrow({where:{scope}});await db.rolePermission.deleteMany({where:{roleId:ownerRole,permissionId:p.id}});try{await denied(owner,'development.incoming.return',returning(out.dispatchId,out.movementIds[0]),[403]);}finally{await db.rolePermission.create({data:{id:randomUUID(),roleId:ownerRole,permissionId:p.id}});}}
 });
 it('does not reveal incoming originals through a merely upstream development reached from the caller-owned order',async()=>{
  const fileId=await upload(),id=await receive([fileId]),out=await dispatch(id),stored=await raw(),state=stored.state as any,orderId=randomUUID(),lineId=randomUUID();state.orders.push({id:orderId,code:'SO-INCOMING-UPSTREAM',type:'fabric',customerId,customer:'客户',ownerId:stranger,owner:'工厂收件人',season:'SS27',currency:'CNY',due:'2026-11-22',name:'棉斜纹',style:'IN-COT',lines:1,qty:1,amount:10,stage:0,state:'待办',tone:'neutral',createdAt:now});state.orderLines.push({id:lineId,orderId,name:'棉斜纹',style:'IN-COT',qty:1,price:10,amount:10,unit:'米',sourceDevId:devId,sourceVersionId:versionId});await db.mistWorkspace.update({where:{id:wid},data:{state}});
  const r=await get(stranger);expect(r.status,JSON.stringify(r.body.error)).toBe(200);expect(r.body.workspace.state.orders.some((o:any)=>o.id===orderId)).toBe(true);expect(r.body.workspace.state.devs.some((d:any)=>d.id===devId)).toBe(true);expect(r.body.workspace.state.fulfillment.samples.some((s:any)=>s.id===id)).toBe(false);expect(r.body.workspace.state.fulfillment.sampleMovements.some((m:any)=>m.id===out.movementIds[0])).toBe(false);expect(r.body.workspace.developmentIncomingAccess.readableDevIds).not.toContain(devId);expect((await download(stranger,fileId)).status).toBe(404);await denied(stranger,'development.incoming.receive',intake(),[404]);
 });
 it('rejects forged incoming identity and generic custody/QC bypasses atomically at the real API',async()=>{
  await denied(owner,'development.incoming.receive',{...intake(),registeredById:stranger},[422]);const id=await receive();await denied(owner,'fulfillment.samples.move',{id,kind:'lend',quantity:1,person:'工厂收件人',location:'工厂',note:'试图旁路',externalBorrower:true,developmentIncomingCustody:true},[422]);const source=((await raw()).state as any).fulfillment.samples.find((s:any)=>s.id===id).source;await denied(owner,'fulfillment.qc.request',{source,sampleId:id,domain:'fabric',kind:'sample',factory:'测试面料厂',location:'A01',contact:'',due:'2026-11-22'},[403,422]);
 });
});
