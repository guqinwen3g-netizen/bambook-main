/** Rename the fictional development company in place, preserving business and account IDs. */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import {PrismaClient} from '@prisma/client';
import {renameMistCompanyIdentity,mistCompanySeedFileSource,MIST_COMPANY_IDENTITY} from '../src/shared/mistCompanyIdentity';
import {renderDemoFile,DEMO_FILE_PREFIX} from '../src/shared/mistDemoFiles';
import {assertMistOrderApproved,type MistState} from '../src/shared/mistWorkspace';
import {assertCreditSourceVersions} from '../src/shared/mistCreditDocuments';

dotenv.config({path:path.resolve(__dirname,'../.env.local')});dotenv.config();
const args=process.argv.slice(2),option=(key:string)=>args.find(value=>value.startsWith('--'+key+'='))?.slice(key.length+3),apply=args.includes('--apply');
const workspaceId=option('workspace'),backup=option('backup-confirmed');
if(!workspaceId||!/^[0-9a-f-]{36}$/i.test(workspaceId))throw new Error('明确指定 --workspace=<UUID>');
const database=new URL(process.env.DATABASE_URL||'');
if(!/(?:^|_)(?:dev|local|test|acceptance)(?:_|$)/i.test(database.pathname.slice(1)))throw new Error('只允许开发或隔离验收数据库');
if(apply&&!backup)throw new Error('先备份，再提供 --backup-confirmed=<备份目录>');
const root=path.resolve(process.env.MIST_FILES_DIR||path.resolve(__dirname,'../private/mist-files')),db=new PrismaClient();
const previousFiles:Array<{file:string;bytes:Buffer;mode:number;uid:number;gid:number}>=[];

async function replaceFile(file:string,bytes:Buffer,meta:{mode:number;uid:number;gid:number}){
 const temp=file+'.rename-'+randomUUID();
 try{await fs.writeFile(temp,bytes,{mode:meta.mode&0o777,flag:'wx'});if(process.getuid?.()===0)await fs.chown(temp,meta.uid,meta.gid);await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>undefined);}
}
async function main(){
 const row=await db.mistWorkspace.findUniqueOrThrow({where:{id:workspaceId}}),before=row.state as unknown as MistState;
 if(before.settings.companyBaseline?.dataset!=='claridge-peak-continuous-operations'||before.workspaceArchive)throw new Error('工作区不是当前公司经营基线');
 if(before.market.quotations.some(q=>q.documents?.length)||before.platform.credits.some(c=>c.printVersions?.length))throw new Error('工作区有另行签发的正式 PDF，需按对应文档版本处理后再改名');
 const state=renameMistCompanyIdentity(before),changed=JSON.stringify(state)!==JSON.stringify(before);
 const sources=before.files.map(file=>({file,source:mistCompanySeedFileSource(before,file)}));
 if(sources.some(item=>!item.source))throw new Error('存在不属于经营基线的附件，拒绝覆盖自定义文件');
 for(const order of state.orders.filter(order=>order.governance?.status==='approved'))assertMistOrderApproved(state,order.id);
 for(const credit of state.platform.credits)if(credit.sourceVersions?.length)assertCreditSourceVersions(credit.sourceVersions);
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',workspace:row.id,revision:row.revision,changed,name:MIST_COMPANY_IDENTITY.workspace,orders:state.orders.length,files:state.files.length}));
 if(!apply||!changed)return;
 for(const{file,source}of sources){if(!/^[0-9a-f-]{36}$/i.test(file.id)||file.storageKey!==workspaceId+'/'+file.id)throw new Error('附件路径不属于当前工作区');
  const target=path.join(root,workspaceId!,file.id),stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('附件原文件无效');
  previousFiles.push({file:target,bytes:await fs.readFile(target),mode:stat.mode,uid:stat.uid,gid:stat.gid});
  const updated=state.files.find(item=>item.id===file.id)!;updated.size=renderDemoFile(state,{...updated,storageKey:DEMO_FILE_PREFIX+source!.template+'/'+encodeURIComponent(source!.ref)}).length;
 }
 for(const mail of state.email.messages)for(const attachment of mail.attachments){const file=state.files.find(file=>file.id===attachment.fileId);if(file){attachment.name=file.name;attachment.size=file.size;}}
 try{await db.$transaction(async tx=>{
  await tx.$queryRawUnsafe('SELECT "id" FROM "MistWorkspace" WHERE "id"=$1::uuid FOR UPDATE',workspaceId);
  const current=await tx.mistWorkspace.findUniqueOrThrow({where:{id:workspaceId}});if(current.revision!==row.revision)throw new Error('工作区已被修改，请重新读取再改名');
  const accounts=await tx.userAccount.findMany({where:{id:{startsWith:'claridge-peak-'}}});
  for(const account of accounts){const renamed=renameMistCompanyIdentity({displayName:account.displayName,email:account.email});await tx.userAccount.update({where:{id:account.id},data:renamed});}
  const profiles=await tx.employeeProfile.findMany({where:{userId:{in:accounts.map(account=>account.id)}}});
  for(const profile of profiles)await tx.employeeProfile.update({where:{id:profile.id},data:renameMistCompanyIdentity({notes:profile.notes,emergencyContact:profile.emergencyContact,workLocation:profile.workLocation})});
  for(const department of await tx.department.findMany({where:{id:{startsWith:'simulation-20261019-'}}}))if(department.name!==renameMistCompanyIdentity(department.name))await tx.department.update({where:{id:department.id},data:{name:renameMistCompanyIdentity(department.name)}});
  const config=await tx.systemConfig.findUnique({where:{id:'global::company.exporterProfile'}});
  if(config&&!config.encrypted){const next=renameMistCompanyIdentity(config.value);if(JSON.stringify(next)!==JSON.stringify(config.value)){await tx.systemConfig.update({where:{id:config.id},data:{value:next as any,version:{increment:1},updatedAt:BigInt(Date.now()),updatedBy:row.ownerId,auditReason:'开发公司名称按 Mist 主题统一'}});await tx.systemConfigHistory.create({data:{id:randomUUID(),configId:config.id,versionFrom:config.version,versionTo:config.version+1,valueFrom:config.value as any,valueTo:next as any,actorId:row.ownerId,reason:'开发公司名称按 Mist 主题统一',sensitiveMasked:false}});}}
  for(const{file,source}of sources){const updated=state.files.find(item=>item.id===file.id)!,meta=previousFiles.find(item=>item.file.endsWith('/'+file.id))!;await replaceFile(meta.file,Buffer.from(renderDemoFile(state,{...updated,storageKey:DEMO_FILE_PREFIX+source!.template+'/'+encodeURIComponent(source!.ref)})),meta);}
  state.events.unshift({id:randomUUID(),entityType:'workspace',entityId:workspaceId!,actor:MIST_COMPANY_IDENTITY.owner,at:new Date().toISOString(),text:'公司及人员名称按 Mist 主题统一',fileIds:[]});
  await tx.mistWorkspace.update({where:{id:workspaceId},data:{name:MIST_COMPANY_IDENTITY.workspace,state:state as any,revision:{increment:1}}});
 },{timeout:60000});}catch(error){
  const current=await db.mistWorkspace.findUnique({where:{id:workspaceId}}).catch(()=>undefined);
  if(current&&current.revision===row.revision)for(const previous of previousFiles)await replaceFile(previous.file,previous.bytes,previous);
  throw error;
 }
 console.log(JSON.stringify({renamed:true,workspace:workspaceId,revision:row.revision+1,files:state.files.length,accountIdsPreserved:true,businessIdsPreserved:true}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}).finally(()=>db.$disconnect());
