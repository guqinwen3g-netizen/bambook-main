/**
 * 将开发 / 验收环境收口到一套版本化 Mist 公司经营基线。
 *
 * 只能在用户指定的测试租户上运行；不得用于正式环境、真实公司或未经用户指定的租户。
 *
 * 默认只做 dry-run（输出将写入的目标公司 id / slug / 名称）。实际写入必须同时满足：
 *   1. 数据库名明确是 dev/local/test/acceptance；
 *   2. --apply；
 *   3. --backup-confirmed=<本次备份标识>；
 *   4. --source-prefix=<旧开发账号共同前缀>；
 *   5. --company-id=<目标公司 uuid>，须与按源账号推断出的目标公司一致（核对 dry-run 输出），不一致或缺少时不写入任何数据。
 *
 * 旧工作区只归档并改成中性留档名，旧账号停用并清除外显邮箱；不会删除历史证据。
 */
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import {PrismaClient} from '@prisma/client';
import {MistPrivateFiles} from '../src/mist/files';
import {prepareMistBusinessNumbers} from '../src/mist/businessNumbers';
import {isDemoFile,renderDemoFile} from '../src/shared/mistDemoFiles';
import {assertCompanyBaselineApplyTarget,companyBaselinePaymentSignerGaps,companyBaselineTargetCompany,writeCompanyBaselinePaymentGrants} from '../src/mist/companyBaselineGrants';
import {createMistCompanyBaseline,mistCompanyBaselineMetrics,mistCompanyVisibleTextIssues,MIST_COMPANY_BASELINE_VERSION,MIST_COMPANY_BASELINE_AS_OF,MIST_COMPANY_DATASET,MIST_COMPANY_WORKSPACE_NAME,type MistCompanyRoster,type MistCompanyRosterKey} from '../src/shared/mistCompanyBaseline';

const SERVER_ROOT=path.resolve(__dirname,'..');
dotenv.config({path:path.join(SERVER_ROOT,'.env.local')});dotenv.config({path:path.join(SERVER_ROOT,'.env')});

const rawArgs=process.argv.slice(2),apply=rawArgs.includes('--apply');
const option=(name:string)=>rawArgs.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)||process.env[`MIST_COMPANY_${name.replace(/-/g,'_').toUpperCase()}`]||'';
const sourcePrefix=option('source-prefix'),backupConfirmed=option('backup-confirmed'),confirmedCompanyId=option('company-id');
const databaseUrl=process.env.DATABASE_URL||'';
const databaseName=(()=>{try{return new URL(databaseUrl).pathname.replace(/^\//,'').split('?')[0];}catch{return'';}})();
const allowedDatabase=/(?:^|_)(?:dev|local|test|acceptance)(?:_|$)/i.test(databaseName);
if(!databaseUrl)throw new Error('DATABASE_URL 未配置');
if(!allowedDatabase)throw new Error(`拒绝写入数据库 ${databaseName||'(unknown)'}：只允许明确的开发 / 本地 / 测试 / 验收库`);
if(!sourcePrefix)throw new Error('请提供 --source-prefix，脚本不会猜测要迁移的账号集合');
if(apply&&!backupConfirmed)throw new Error('--apply 前须提供 --backup-confirmed=<本次服务器备份标识>');

const ACCOUNT_SPECS:Array<{key:MistCompanyRosterKey;suffix:string;id:string;name:string;email:string;employeeNo:string}>=[
 {key:'owner',suffix:'owner',id:'claridge-peak-owner',name:'沈霁',email:'shen.ji@mistweave-textile.com',employeeNo:'CP2026001'},
 {key:'fabricManager',suffix:'fabric-manager',id:'claridge-peak-fabric-manager',name:'俞宁',email:'yu.ning@mistweave-textile.com',employeeNo:'CP2026002'},
 {key:'garmentManager',suffix:'garment-manager',id:'claridge-peak-garment-manager',name:'陆衡',email:'lu.heng@mistweave-textile.com',employeeNo:'CP2026003'},
 {key:'fabricSales',suffix:'fabric-sales',id:'claridge-peak-fabric-sales',name:'沈禾',email:'shen.he@mistweave-textile.com',employeeNo:'CP2026004'},
 {key:'garmentSales',suffix:'garment-sales',id:'claridge-peak-garment-sales',name:'林澈',email:'lin.che@mistweave-textile.com',employeeNo:'CP2026005'},
 {key:'finance',suffix:'finance',id:'claridge-peak-finance',name:'林舒',email:'lin.shu@mistweave-textile.com',employeeNo:'CP2026006'},
 {key:'fabricQc',suffix:'fabric-qc',id:'claridge-peak-fabric-qc',name:'唐岚',email:'tang.lan@mistweave-textile.com',employeeNo:'CP2026007'},
 {key:'garmentQc',suffix:'garment-qc',id:'claridge-peak-garment-qc',name:'许言',email:'xu.yan@mistweave-textile.com',employeeNo:'CP2026008'},
 {key:'logistics',suffix:'logistics',id:'claridge-peak-logistics',name:'陈晓',email:'chen.xiao@mistweave-textile.com',employeeNo:'CP2026009'},
];

const prisma=new PrismaClient();
const filesRoot=path.resolve(process.env.MIST_FILES_DIR||path.join(SERVER_ROOT,'private/mist-files'));
const slug=`claridge-peak-company-v${MIST_COMPANY_BASELINE_VERSION}`;

async function main(){
 const sources=await prisma.userAccount.findMany({where:{id:{in:ACCOUNT_SPECS.map(row=>sourcePrefix+row.suffix)},deletedAt:null},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}},employeeProfiles:{where:{companyId:null}}}});
 const sourceById=new Map(sources.map(row=>[row.id,row]));
 const missing=ACCOUNT_SPECS.filter(row=>!sourceById.has(sourcePrefix+row.suffix)).map(row=>row.suffix);
 if(missing.length)throw new Error('缺少源开发账号：'+missing.join('、'));
 const roster=Object.fromEntries(ACCOUNT_SPECS.map(row=>[row.key,{id:row.id,name:row.name}])) as MistCompanyRoster;
 // 目标公司：源账号角色所属公司；没有公司（旧库）时为 null。个人授权与公司成员资格都写到这家公司。
 const companyId=companyBaselineTargetCompany(sources);
 const targetCompany=companyId?await prisma.company.findUnique({where:{id:companyId},select:{id:true,slug:true,name:true,status:true}}):null;
 if(companyId&&!targetCompany)throw new Error(`源账号角色所属公司 ${companyId} 不存在`);
 const claimReviewerId=roster.owner.id;
 let failures:Array<{step:string;message:string}>=[];
 const now=new Date().toISOString();let state=createMistCompanyBaseline({id:()=>randomUUID(),now:MIST_COMPANY_BASELINE_AS_OF,actorId:roster.owner.id,actorName:roster.owner.name},roster,rows=>{failures=rows;},{claimReviewerId});
 const metrics=mistCompanyBaselineMetrics(state),visibleIssues=mistCompanyVisibleTextIssues(state);
 const existing=await prisma.mistWorkspace.findUnique({where:{ownerId_slug:{ownerId:roster.owner.id,slug}}});
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',database:databaseName,targetCompany:targetCompany??null,workspace:MIST_COMPANY_WORKSPACE_NAME,baselineVersion:MIST_COMPANY_BASELINE_VERSION,dataset:MIST_COMPANY_DATASET,sourceAccounts:sources.length,targetAccounts:ACCOUNT_SPECS.length,metrics,seedFailures:failures,visibleIssues,existingBaseline:existing?{id:existing.id,revision:existing.revision,archived:!!(existing.state as any)?.workspaceArchive}:null},null,2));
 if(failures.length||visibleIssues.length)throw new Error('公司基线未通过完整性或外显内容检查，拒绝写入');
 if(!apply){console.log('dry-run 完成；没有写入账号、工作区或附件。');return;}
 // 显式公司确认：在下面任何写入（编号、附件、事务）之前。
 assertCompanyBaselineApplyTarget(confirmedCompanyId,companyId);
 if(existing&&!(existing.state as any)?.workspaceArchive&&(existing.state as any)?.settings?.companyBaseline?.version===MIST_COMPANY_BASELINE_VERSION){console.log(`基线已存在：${existing.id}；幂等退出。`);return;}
 if(existing)throw new Error(`工作区标识 ${slug} 已存在但不是当前有效基线；请人工核对，脚本不会覆盖`);

 const numbers=await prisma.$transaction(tx=>prepareMistBusinessNumbers(tx,{},Array.from({length:4},()=>({kind:'newCase' as const,prefix:'CLM' as const})),MIST_COMPANY_BASELINE_AS_OF));
 failures=[];
 state=createMistCompanyBaseline({id:()=>randomUUID(),now:MIST_COMPANY_BASELINE_AS_OF,actorId:roster.owner.id,actorName:roster.owner.name,consumeBusinessNumber:numbers.consume},roster,rows=>{failures=rows;},{claimReviewerId});
 numbers.assertConsumed();if(failures.length)throw new Error('正式编号基线生成失败：'+failures.map(row=>row.step+': '+row.message).join('; '));

 const workspaceId=randomUUID(),files=new MistPrivateFiles(filesRoot),workspaceDirectory=path.join(filesRoot,workspaceId);
 try{
  for(const file of state.files){if(!isDemoFile(file))continue;const stored=await files.writeWithId(workspaceId,file.id,{bytes:Buffer.from(renderDemoFile(state,file)),name:file.name,mimeType:file.mimeType},file.createdAt);file.size=stored.size;file.storageKey=stored.storageKey;}
  // Root-operated provisioning must leave private artifacts readable by the existing service owner.
  if(process.getuid?.()===0){const owner=await fs.stat(filesRoot);if(owner.uid!==0){for(const file of state.files)await fs.chown(path.join(workspaceDirectory,file.id),owner.uid,owner.gid);await fs.chown(workspaceDirectory,owner.uid,owner.gid);}}
  await prisma.$transaction(async tx=>{
   for(const spec of ACCOUNT_SPECS){const source=sourceById.get(sourcePrefix+spec.suffix)!;
    await tx.userAccount.upsert({where:{id:spec.id},create:{id:spec.id,displayName:spec.name,email:spec.email,passwordHash:source.passwordHash,status:'active',primaryDeptId:source.primaryDeptId,metadata:{companyBaseline:MIST_COMPANY_DATASET,roleKey:spec.key}},update:{displayName:spec.name,email:spec.email,passwordHash:source.passwordHash,status:'active',primaryDeptId:source.primaryDeptId,deletedAt:null,metadata:{companyBaseline:MIST_COMPANY_DATASET,roleKey:spec.key}}});
    await tx.userRole.deleteMany({where:{userId:spec.id}});if(source.roles.length)await tx.userRole.createMany({data:source.roles.map(role=>({id:randomUUID(),userId:spec.id,roleId:role.roleId,departmentId:role.departmentId})),skipDuplicates:true});
    if(source.employeeProfiles[0]){const profile=source.employeeProfiles[0];const previous=await tx.employeeProfile.findFirst({where:{userId:spec.id,companyId:null}});await tx.employeeProfile.upsert({where:{id:previous?.id??randomUUID()},create:{id:randomUUID(),userId:spec.id,employeeNo:spec.employeeNo,positionId:profile.positionId,hireDate:profile.hireDate,regularDate:profile.regularDate,contractType:profile.contractType,contractEnd:profile.contractEnd,employmentStatus:'Regular',phone:profile.phone,emergencyContact:profile.emergencyContact,workLocation:profile.workLocation,notes:'雾织贸易经营基线人员档案'},update:{employeeNo:spec.employeeNo,positionId:profile.positionId,hireDate:profile.hireDate,regularDate:profile.regularDate,contractType:profile.contractType,contractEnd:profile.contractEnd,employmentStatus:'Regular',phone:profile.phone,emergencyContact:profile.emergencyContact,workLocation:profile.workLocation,notes:'雾织贸易经营基线人员档案',deletedAt:null}});}
   }
   // 公司会话要求账号是该公司的在职成员：新账号沿用源账号的成员状态加入目标公司。
   if(companyId)for(const spec of ACCOUNT_SPECS)await tx.companyMember.upsert({where:{companyId_userId:{companyId,userId:spec.id}},create:{id:randomUUID(),companyId,userId:spec.id,status:'active',joinedAt:new Date(now)},update:{status:'active'}});
   // 两位事业部经理的 >5 万档个人授权（总监级审批人），由总经理授予，写成目标公司的 companyId。
   await writeCompanyBaselinePaymentGrants(tx,roster,companyId);
   // The company owner also performs the configured general-leader duty for claims (company-scoped admin role id in a company).
   const adminRoleId=companyId?`role-admin@${companyId}`:'role-admin';
   if(!await tx.userRole.findFirst({where:{userId:roster.owner.id,roleId:adminRoleId}}))await tx.userRole.create({data:{id:randomUUID(),userId:roster.owner.id,roleId:adminRoleId,departmentId:sourceById.get(sourcePrefix+'owner')!.primaryDeptId}});
   // 历史付款的每一级签字人须在“该公司会话”实际加载出的权限下持有该级档位，否则回滚整个事务。
   const signerGaps=await companyBaselinePaymentSignerGaps(tx as any,roster,companyId);
   if(signerGaps.length)throw new Error('付款审批签字人在公司会话下缺少档位权限，已回滚：'+signerGaps.join('；'));
   await tx.userAccount.updateMany({where:{id:{startsWith:'usr_demo_'},status:'active'},data:{status:'inactive'}});
   // Runtime authorization follows departments, teams and configured approvals, not display names.
   for(const spec of ACCOUNT_SPECS){const oldId=sourcePrefix+spec.suffix;
    await tx.department.updateMany({where:{headId:oldId},data:{headId:spec.id}});
    await tx.team.updateMany({where:{leaderId:oldId},data:{leaderId:spec.id}});
    const memberships=await tx.teamMember.findMany({where:{userId:oldId,leftAt:null}});
    for(const member of memberships)await tx.teamMember.upsert({where:{teamId_userId:{teamId:member.teamId,userId:spec.id}},create:{id:randomUUID(),teamId:member.teamId,userId:spec.id,role:member.role,joinedAt:member.joinedAt},update:{role:member.role,leftAt:null}});
    await tx.teamMember.updateMany({where:{userId:oldId,leftAt:null},data:{leftAt:new Date(now)}});
    // 审批资格按公司归属：新账号继承旧账号同一归属（公司或无公司）下的授权。
    const approvals=await tx.orderApprovalAuthority.findMany({where:{userId:oldId,active:true}});
    for(const approval of approvals){const scope={companyId:approval.companyId??companyId??null,userId:spec.id,businessLine:approval.businessLine};const found=await tx.orderApprovalAuthority.findFirst({where:scope,select:{id:true}});
     if(found)await tx.orderApprovalAuthority.update({where:{id:found.id},data:{active:true}});else await tx.orderApprovalAuthority.create({data:{...scope,createdBy:roster.owner.id}});}
    await tx.orderApprovalAuthority.updateMany({where:{userId:oldId},data:{active:false}});
   }
   const replacements=new Map(ACCOUNT_SPECS.map(row=>[sourcePrefix+row.suffix,row.id]));
   const departments=await tx.department.findMany({where:{id:{startsWith:sourcePrefix}}});
   for(const department of departments){const suffix=department.id.slice(sourcePrefix.length),names:Record<string,string>={company:'澄岳贸易',business:'业务中心',management:'总经办',owner:'总经办','fabric-business':'面料事业部','garment-business':'成衣事业部','fabric-qc':'面料品质组','garment-qc':'成衣品质组',finance:'财务部',logistics:'物流单证部'};const name=names[suffix];if(name)await tx.department.update({where:{id:department.id},data:{name}});}
   const customRoleIds=[...new Set(sources.flatMap(source=>source.roles.map(role=>role.roleId)))];
   for(const role of await tx.role.findMany({where:{id:{in:customRoleIds},isSystem:false}}))if(/模拟|演示/.test(role.name))await tx.role.update({where:{id:role.id},data:{name:role.name.replace(/模拟[·\s]*|演示[·\s]*/g,''),description:'按岗位标准配置的业务操作权限'}});
   const configs=await tx.systemConfig.findMany({where:{scope:'global',key:{startsWith:'supplierCommitment.approvers.'}}});
   for(const config of configs){const value=typeof config.value==='string'?JSON.parse(config.value):config.value as any;if(!Array.isArray(value?.userIds))throw new Error('审批配置格式无效：'+config.key);const userIds=value.userIds.map((id:string)=>replacements.get(id)||id);if(JSON.stringify(userIds)!==JSON.stringify(value.userIds))await tx.systemConfig.update({where:{id:config.id},data:{value:{...value,userIds},version:{increment:1},updatedAt:BigInt(Date.now()),updatedBy:roster.owner.id,auditReason:'经营基线账号接替，保留原审批职责'}});}
   const oldIds=[...ACCOUNT_SPECS.map(row=>sourcePrefix+row.suffix),...ACCOUNT_SPECS.map(row=>row.id)],oldWorkspaces=await tx.mistWorkspace.findMany({where:{ownerId:{in:oldIds}}});let archiveIndex=0;
   for(const workspace of oldWorkspaces){const previous=workspace.state as any;if(previous?.workspaceArchive)continue;const archived={...previous,workspaceArchive:{at:now,actorId:roster.owner.id},settings:{...previous?.settings,workspaceName:`验收留档 · 2026-10-19 · ${String(++archiveIndex).padStart(2,'0')}`}};await tx.mistWorkspace.update({where:{id:workspace.id},data:{name:archived.settings.workspaceName,state:archived}});}
   for(const[index,spec]of ACCOUNT_SPECS.entries())await tx.userAccount.update({where:{id:sourcePrefix+spec.suffix},data:{displayName:`历史验收账号 ${String(index+1).padStart(2,'0')}`,email:null,status:'inactive',metadata:{archivedFor:MIST_COMPANY_DATASET,archivedAt:now}}});
   await tx.mistWorkspace.create({data:{id:workspaceId,ownerId:roster.owner.id,slug,name:MIST_COMPANY_WORKSPACE_NAME,revision:0,state:state as any}});
  },{timeout:60000});
 }catch(error){await fs.rm(workspaceDirectory,{recursive:true,force:true}).catch(()=>undefined);throw error;}
 console.log(JSON.stringify({applied:true,workspaceId,backupConfirmed,filesRoot,metrics,targetAccounts:ACCOUNT_SPECS.map(row=>({key:row.key,id:row.id,name:row.name,email:row.email}))},null,2));
}

main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
