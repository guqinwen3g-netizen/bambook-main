import { randomUUID } from 'node:crypto';
import type { Department,Prisma,PrismaClient } from '@prisma/client';
import { validateDepartmentBusinessAttributes } from './departmentBusinessAttributes';
import { currentCompanyId } from '../auth/requestCompanyContext';

export class OrganizationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type DepartmentWriteOptions={canAssignHead?:boolean;audit?:(tx:Prisma.TransactionClient,before:Department|null,after:Record<string,unknown>)=>Promise<void>};
type DepartmentInput={name?:string;businessAttributes?:unknown;headId?:unknown;expectedHeadId?:unknown;expectedUpdatedAt?:unknown};
const hasHead=(input:DepartmentInput)=>Object.prototype.hasOwnProperty.call(input,'headId');
function headReference(value:unknown):string|null{
  if(value===null||value==='')return null;
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>200)throw new OrganizationError('请选择有效负责人。');
  return value;
}
async function checkedHead(tx:Prisma.TransactionClient,companyId:string|null,headId:unknown){
  const company=currentCompanyId();
  if(!company||companyId!==company)throw new OrganizationError('请选择本公司部门。',404);
  const id=headReference(headId);if(!id)return null;
  const active=await tx.userAccount.count({where:{id,status:'active',deletedAt:null,companyMembers:{some:{companyId:company,status:'active'}}}});
  if(!active)throw new OrganizationError('请选择本公司在职且已启用的负责人。');
  const profiles=await tx.employeeProfile.findMany({where:{companyId:company,userId:id,deletedAt:null},select:{employmentStatus:true}});
  if(profiles.length&&!profiles.some(p=>p.employmentStatus==='Regular'||p.employmentStatus==='Probation'))throw new OrganizationError('请选择本公司在职且已启用的负责人。');
  return id;
}
function requireHeadAuthority(input:DepartmentInput,authority:DepartmentWriteOptions){
  if(hasHead(input)&&!authority.canAssignHead)throw new OrganizationError('设置部门负责人需要账号与岗位管理权限。',403);
}

export async function createOrganizationDepartment(prisma: PrismaClient, input: DepartmentInput&{parentId?:string}, authority:DepartmentWriteOptions={}) {
  requireHeadAuthority(input,authority);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new OrganizationError('请输入部门名称。');
  if (!input.parentId) throw new OrganizationError('当前版本仅支持一个公司，请选择公司新增部门。');
  return prisma.$transaction(async tx => {
    const company = await tx.department.findUnique({ where: { id: input.parentId } });
    if (!company || company.parentId || company.status !== 'active') throw new OrganizationError('请选择有效的公司节点。');
    const duplicate = await tx.department.findFirst({ where: { parentId: company.id, name, status: 'active' } });
    if (duplicate) throw new OrganizationError('该公司已有同名部门。', 409);
    const attributes = checkedAttributes(input.businessAttributes ?? []);
    const head=hasHead(input)?{headId:await checkedHead(tx,company.companyId,input.headId)}:{};
    const created=await tx.department.create({ data: { id: randomUUID(), name, parentId: company.id, status: 'active', metadata: { businessAttributes: attributes },...head } });
    await authority.audit?.(tx,null,created);return created;
  });
}

function checkedAttributes(value: unknown) {
  try { return validateDepartmentBusinessAttributes(value); }
  catch { throw new OrganizationError('请选择有效的部门业务属性。'); }
}
export async function updateOrganizationDepartment(prisma: PrismaClient, id: string, input: DepartmentInput, authority:DepartmentWriteOptions={}) {
  requireHeadAuthority(input,authority);
  return prisma.$transaction(async tx => {
    const current = await tx.department.findUnique({ where: { id } });
    if (!current?.parentId || current.status !== 'active') throw new OrganizationError('请选择有效部门。');
    const name = typeof input.name === 'string' ? input.name.trim() : current.name;
    if (!name) throw new OrganizationError('请输入部门名称。');
    if (await tx.department.findFirst({ where: { parentId: current.parentId, name, status: 'active', id: { not: id } } })) throw new OrganizationError('该公司已有同名部门。', 409);
    const metadata = current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata) ? current.metadata : {};
    let head:{}|{headId:string|null}={};
    if(hasHead(input)){
      if(input.expectedHeadId===undefined)throw new OrganizationError('请重新打开部门后设置负责人。',409);
      const expected=headReference(input.expectedHeadId);
      if((current.headId??null)!==expected)throw new OrganizationError('部门负责人已更新，请重新打开后核对。',409);
      head={headId:await checkedHead(tx,current.companyId,input.headId)};
    }
    const version=typeof input.expectedUpdatedAt==='string'?new Date(input.expectedUpdatedAt):null;
    if(!version||!Number.isFinite(version.getTime()))throw new OrganizationError('部门资料不可用，请重新打开后核对。',409);
    if(current.updatedAt.getTime()!==version.getTime())throw new OrganizationError('部门资料已更新，请重新打开后核对。',409);
    // Every field belongs to the same checked editor snapshot. Advance even within one millisecond.
    const data={name,metadata:{...metadata,businessAttributes:checkedAttributes(input.businessAttributes??(metadata as any).businessAttributes??[])},...head,updatedAt:new Date(Math.max(Date.now(),version.getTime()+1))};
    const changed=await tx.department.updateMany({where:{id,status:'active',updatedAt:version,...(hasHead(input)?{headId:headReference(input.expectedHeadId)}:{})},data});
    if(changed.count!==1)throw new OrganizationError('部门资料已更新，请重新打开后核对。',409);
    const updated=await tx.department.findUniqueOrThrow({where:{id}});await authority.audit?.(tx,current,updated);return updated;
  });
}
export async function retireOrganizationDepartment(prisma: PrismaClient, id: string, input: { targetDepartmentId?: string },options:DepartmentWriteOptions={}) {
  return prisma.$transaction(async tx => {
    const current = await tx.department.findUnique({ where: { id } });
    if (!current?.parentId || current.status !== 'active') throw new OrganizationError('请选择有效部门。');
    const [teams, people, positions] = await Promise.all([
      tx.team.count({ where: { departmentId: id, deletedAt: null } }),
      tx.userAccount.count({ where: { primaryDeptId: id, deletedAt: null } }),
      tx.jobPosition.count({ where: { departmentId: id, deletedAt: null } }),
    ]);
    if (teams || people || positions) {
      const target = input.targetDepartmentId ? await tx.department.findUnique({ where: { id: input.targetDepartmentId } }) : null;
      const sameCompany = currentCompanyId() ? target?.companyId === current.companyId && !!target?.parentId : target?.parentId === current.parentId;
      if (!target || target.id === id || !sameCompany || target.status !== 'active') throw new OrganizationError(`该部门有 ${teams} 个小组、${people} 名人员、${positions} 个岗位，请选择承接部门。`, 409);
      await tx.team.updateMany({ where: { departmentId: id, deletedAt: null }, data: { departmentId: target.id } });
      if (currentCompanyId()) await tx.userRole.updateMany({ where: { departmentId: id }, data: { departmentId: target.id } });
      else await tx.userAccount.updateMany({ where: { primaryDeptId: id, deletedAt: null }, data: { primaryDeptId: target.id } });
      await tx.jobPosition.updateMany({ where: { departmentId: id, deletedAt: null }, data: { departmentId: target.id } });
    }
    await tx.department.update({ where: { id }, data: { status: 'inactive' } });
    const result={ retired: true, transferred: { teams, people, positions }, targetDepartmentId: input.targetDepartmentId || null };
    await options.audit?.(tx,current,result);return result;
  });
}
