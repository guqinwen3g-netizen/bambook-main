import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLE_IDS, systemRoleCode } from '../_shared/rolePermissionMatrix';
import { CompanyAccountError } from './companyAccountLifecycle';
import { invalidateTeamMembershipCache } from '../teams/teamShareService';

export async function saveCompanyAccountAssignment(prisma: PrismaClient, input: {
  companyId: string; userId: string; actorId: string; actorIsOwner: boolean; actorIsPlatform?: boolean;
  roles?: unknown; departmentId?: string | null; displayName?: unknown; email?: unknown;
}) {
  if (input.roles !== undefined && (!Array.isArray(input.roles) || input.roles.some(role => typeof role !== 'string'))) throw new CompanyAccountError('请选择有效角色。', 400, 'INVALID_ROLE');
  if (input.departmentId !== undefined && input.departmentId !== null && (typeof input.departmentId !== 'string' || !input.departmentId.trim())) throw new CompanyAccountError('请选择有效部门。', 400, 'INVALID_DEPARTMENT');
  const suppliedName = input.displayName !== undefined, suppliedEmail = input.email !== undefined;
  if (suppliedName && (typeof input.displayName !== 'string' || !input.displayName.trim())) throw new CompanyAccountError('请填写姓名。', 400, 'VALIDATION_FAILED');
  if (suppliedEmail && (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))) throw new CompanyAccountError('请填写有效邮箱。', 400, 'VALIDATION_FAILED');
  await prisma.$transaction(async tx => {
    const platformActor = input.actorIsPlatform ? await tx.userAccount.findUnique({ where: { id: input.actorId }, select: { platformRole: true, status: true, deletedAt: true } }) : null;
    if (input.actorIsPlatform && (!platformActor || platformActor.platformRole !== 'platform_admin' || platformActor.status !== 'active' || platformActor.deletedAt != null)) throw new CompanyAccountError('平台管理权限已失效。', 403, 'FORBIDDEN');
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${input.companyId}::uuid FOR UPDATE`;
    const target = await tx.userAccount.findUnique({ where: { id: input.userId } });
    const member = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId: input.companyId, userId: input.userId } } });
    if (!target || !member || !['active', 'pending', 'suspended'].includes(member.status)) throw new CompanyAccountError('账号不存在。', 404, 'NOT_FOUND');
    const previous = await tx.userRole.findMany({ where: { userId: input.userId, role: { companyId: input.companyId } } });
    const roleIds = input.roles === undefined ? previous.map(role => role.roleId) : [...new Set(input.roles as string[])];
    const owns = (roles: string[]) => roles.some(role => systemRoleCode(role) === SYSTEM_ROLE_IDS.SUPER_ADMIN);
    if ((owns(previous.map(role => role.roleId)) || owns(roleIds)) && !input.actorIsOwner) throw new CompanyAccountError('总经理账号只能由总经理维护。', 403, 'FORBIDDEN');
    const roles = await tx.role.findMany({ where: { id: { in: roleIds }, companyId: input.companyId } });
    if (roles.length !== roleIds.length) throw new CompanyAccountError('角色不存在。', 400, 'INVALID_ROLE');
    const beforeDepartment = previous.find(role => role.departmentId)?.departmentId ?? null;
    const departmentId = input.departmentId === undefined ? beforeDepartment : input.departmentId;
    if (departmentId && !await tx.department.findFirst({ where: { id: departmentId, companyId: input.companyId, status: 'active', parentId: { not: null } } })) throw new CompanyAccountError('请选择本公司部门。', 400, 'INVALID_DEPARTMENT');
    if (input.userId === input.actorId && owns(previous.map(role => role.roleId)) && !owns(roleIds)) throw new CompanyAccountError('不能移除自己的总经理权限。', 409, 'SELF_OWNER_REQUIRED');
    if (beforeDepartment !== departmentId && await tx.employeeProfile.findFirst({ where: { companyId: input.companyId, userId: input.userId, deletedAt: null } })) throw new CompanyAccountError('请在人事管理中办理调岗。', 409, 'EMPLOYMENT_TRANSFER_REQUIRED');
    const displayName = suppliedName ? (input.displayName as string).trim() : target.displayName;
    const normalizedEmail = suppliedEmail ? (input.email as string).trim().toLowerCase() : target.email;
    const email = normalizedEmail === target.email?.toLowerCase() ? target.email : normalizedEmail;
    if (displayName !== target.displayName || email !== target.email) {
      const companies = await tx.companyMember.count({ where: { userId: input.userId, status: { in: ['active', 'pending', 'suspended'] } } });
      if (companies > 1 && !platformActor) throw new CompanyAccountError('跨公司账号资料由本人或平台管理员维护。', 403, 'PLATFORM_ACCOUNT_REQUIRED');
      await tx.userAccount.update({ where: { id: input.userId }, data: { displayName, email } });
    }
    await tx.userRole.deleteMany({ where: { userId: input.userId, role: { companyId: input.companyId } } });
    for (const role of roles) await tx.userRole.create({ data: { id: randomUUID(), userId: input.userId, roleId: role.id, departmentId } });
    if (departmentId !== beforeDepartment) {
      const elsewhere = { department: { companyId: input.companyId }, ...(departmentId ? { departmentId: { not: departmentId } } : {}) };
      await tx.teamMember.updateMany({ where: { userId: input.userId, leftAt: null, team: elsewhere }, data: { leftAt: new Date() } });
      await tx.team.updateMany({ where: { leaderId: input.userId, ...elsewhere }, data: { leaderId: null } });
    }
    await tx.auditLog.create({ data: { id: randomUUID(), actorId: input.actorId, action: 'update_account_assignment', targetType: 'UserAccount', targetId: input.userId,
      detail: { companyId: input.companyId, departmentId, roleIds, identityChanged: displayName !== target.displayName || email !== target.email } } });
  });
  invalidateTeamMembershipCache();
}
