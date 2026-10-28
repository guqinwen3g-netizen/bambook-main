import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';

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
 * 幂等：已存在的角色与权限关联不会重复创建。
 */
export async function provisionCompanyRoles(tx: Prisma.TransactionClient, companyId: string): Promise<number> {
  let created = 0;
  for (const code of COMPANY_SYSTEM_ROLE_CODES) {
    const template = await tx.role.findFirst({ where: { id: code, companyId: null } });
    if (!template) continue;
    const scopedId = `${code}@${companyId}`;
    await tx.role.upsert({
      where: { id: scopedId },
      update: { code, companyId },
      create: {
        id: scopedId,
        companyId,
        code,
        name: template.name,
        description: template.description,
        isSystem: true,
      },
    });
    const permissions = await tx.rolePermission.findMany({ where: { roleId: code } });
    for (const row of permissions) {
      await tx.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: scopedId, permissionId: row.permissionId } },
        update: {},
        create: { id: `rp_${scopedId}__${row.permissionId}`, roleId: scopedId, permissionId: row.permissionId },
      });
    }
    created += 1;
  }
  return created;
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
