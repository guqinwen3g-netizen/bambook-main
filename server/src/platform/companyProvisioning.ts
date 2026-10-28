import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { SYSTEM_ROLE_IDS, SYSTEM_ROLE_META, PERMISSION_SCOPES, getDefaultScopeListForRole, type SystemRoleId } from '../_shared/rolePermissionMatrix';

/** 每家公司初始拥有的系统角色码。 */
export const COMPANY_SYSTEM_ROLE_CODES: string[] = [
  SYSTEM_ROLE_IDS.SUPER_ADMIN,
  SYSTEM_ROLE_IDS.ADMIN,
  SYSTEM_ROLE_IDS.SALES_MANAGER,
  SYSTEM_ROLE_IDS.SALES,
  SYSTEM_ROLE_IDS.FINANCE,
  SYSTEM_ROLE_IDS.QC,
  SYSTEM_ROLE_IDS.LOGISTICS,
];

/**
 * 为一家公司建立自己的系统角色副本。
 * 角色 id 为 `<code>@<companyId>`，权限矩阵按 code 查询（见 rolePermissionMatrix.systemRoleCode）。
 * 新岗位使用当前代码定义的标准权限，不复制可能陈旧或被修改的全局数据库模板。
 * 已存在的公司岗位保持原配置，重复调用不能补回公司有意撤销的权限。
 */
export async function provisionCompanyRoles(tx: Prisma.TransactionClient, companyId: string): Promise<number> {
  const existing = await tx.role.findMany({ where: { id: { in: COMPANY_SYSTEM_ROLE_CODES.map(code => `${code}@${companyId}`) } }, select: { id: true, companyId: true } });
  if (existing.some(role => role.companyId !== companyId)) throw new Error('公司岗位标识冲突。');
  const existingIds = new Set(existing.map(role => role.id));
  const pending = COMPANY_SYSTEM_ROLE_CODES.filter(code => !existingIds.has(`${code}@${companyId}`)).map(code => ({ code: code as SystemRoleId, scopes: getDefaultScopeListForRole(code as SystemRoleId) }));
  if (!pending.length) return 0;
  const scopes = [...new Set(pending.flatMap(role => role.scopes))];
  await tx.permission.createMany({ data: scopes.map(scope => ({ id: randomUUID(), scope, description: PERMISSION_SCOPES[scope as keyof typeof PERMISSION_SCOPES] })), skipDuplicates: true });
  const catalog = new Map((await tx.permission.findMany({ where: { scope: { in: scopes } }, select: { id: true, scope: true } })).map(permission => [permission.scope, permission.id]));
  for (const { code, scopes: grants } of pending) {
    const id = `${code}@${companyId}`, meta = SYSTEM_ROLE_META[code];
    await tx.role.create({ data: { id, companyId, code, name: meta.name, description: meta.description, isSystem: true } });
    await tx.rolePermission.createMany({ data: grants.map(scope => ({ id: randomUUID(), roleId: id, permissionId: catalog.get(scope)! })), skipDuplicates: true });
  }
  return pending.length;
}

/** 公司内某个系统角色的实际 id。 */
export function companyRoleId(code: string, companyId: string): string {
  return `${code}@${companyId}`;
}

export type CreateCompanyInput = {
  slug: string;
  name: string;
  legalName?: string | null;
  englishName?: string | null;
  seatLimit?: number | null;
  plan?: string;
  ownerUserId?: string | null;
  ownerJobTitle?: string | null;
};

/**
 * 创建公司、系统角色、默认部门和管理员成员关系；业务岗位由开通表单独立指定。
 * 不预置经营记录，首次进入时按现有逻辑建立空白公司库。
 */
export async function createCompany(tx: Prisma.TransactionClient, input: CreateCompanyInput) {
  if (input.ownerUserId && (await tx.userAccount.findUnique({ where: { id: input.ownerUserId }, select: { platformRole: true } }))?.platformRole) throw new Error('平台人员账号不能成为公司负责人。');
  const company = await tx.company.create({
    data: {
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      legalName: input.legalName ?? null,
      englishName: input.englishName ?? null,
      plan: input.plan ?? 'standard',
      seatLimit: input.seatLimit ?? null,
      status: 'active',
      ...(input.ownerUserId ? { settings: { administratorIds: [input.ownerUserId] } } : {}),
    },
  });

  const roles = await provisionCompanyRoles(tx, company.id);

  await tx.department.upsert({
    where: { id: `dept-company@${company.id}` },
    update: {},
    create: {
      id: `dept-company@${company.id}`,
      companyId: company.id,
      name: '公司',
      status: 'active',
    },
  });

  if (input.ownerUserId) {
    await tx.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: input.ownerUserId } },
      update: { status: 'active' },
      create: {
        id: randomUUID(),
        companyId: company.id,
        userId: input.ownerUserId,
        status: 'active',
        jobTitle: input.ownerJobTitle ?? null,
        joinedAt: new Date(),
      },
    });
  }

  return { company, roles };
}
