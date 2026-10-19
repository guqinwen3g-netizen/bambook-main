/**
 * 把现有工作空间迁移为公司（租户）实例。
 *
 * 做的事：
 *   1. 创建 Company（默认 mistweave-textile / 雾织贸易）
 *   2. 为该企业复制一套系统角色（id 形如 `role-sales@<companyId>`，带 code）
 *   3. 把成员现有 UserRole 指向本公司角色
 *   4. 现有部门归入该公司
 *   5. 把工作空间所有者与已授权账号写成 CompanyMember
 *   6. 工作空间关联 companyId
 *
 * 幂等：公司已存在时复用；角色、成员用 upsert；重复执行不会重复创建。
 * 业务数据、账号 ID、金额一律不改。
 *
 * 用法（在 server/ 下）：
 *   npx tsx scripts/migrate-company-tenancy.ts --dry-run
 *   npx tsx scripts/migrate-company-tenancy.ts
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLE_IDS } from '../src/_shared/rolePermissionMatrix';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const has = (name: string) => args.includes(`--${name}`);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const slug = flag('slug', 'mistweave-textile');
const companyName = flag('name', '雾织贸易');
const legalName = flag('legal-name', '雾织国际贸易（上海）有限公司');
const englishName = flag('english-name', 'Mistweave Textile & Apparel Trading (Shanghai) Co., Ltd.');
const dryRun = has('dry-run');

const SYSTEM_ROLE_CODES: string[] = [
  SYSTEM_ROLE_IDS.SUPER_ADMIN,
  SYSTEM_ROLE_IDS.ADMIN,
  SYSTEM_ROLE_IDS.SALES_MANAGER,
  SYSTEM_ROLE_IDS.SALES,
  SYSTEM_ROLE_IDS.FINANCE,
  SYSTEM_ROLE_IDS.QC,
  SYSTEM_ROLE_IDS.LOGISTICS,
];

function memberIdsOf(state: any): string[] {
  return Array.isArray(state?.memberIds) ? state.memberIds.filter((id: unknown) => typeof id === 'string') : [];
}

async function main() {
  const workspaces = await prisma.mistWorkspace.findMany({
    where: { companyId: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!workspaces.length) {
    console.log('没有待归属公司的工作空间（已迁移或库为空），未做改动。');
    return;
  }

  const ownerIds = Array.from(new Set(workspaces.map((w) => w.ownerId)));
  const invited = Array.from(new Set(workspaces.flatMap((w) => memberIdsOf(w.state))));
  const candidateUserIds = Array.from(new Set([...ownerIds, ...invited]));
  const knownUsers = await prisma.userAccount.findMany({
    where: { id: { in: candidateUserIds } },
    select: { id: true, displayName: true, email: true },
  });
  const knownIds = new Set(knownUsers.map((u) => u.id));

  console.log(`工作空间 ${workspaces.length} 个，候选成员 ${candidateUserIds.length} 个（库内存在 ${knownUsers.length} 个）`);
  for (const w of workspaces) console.log(`  · ${w.name}（${w.id}）owner=${w.ownerId}`);

  if (dryRun) {
    console.log('\n[dry-run] 将创建公司：', { slug, companyName, legalName, englishName });
    console.log('[dry-run] 将复制角色：', SYSTEM_ROLE_CODES.join(', '));
    console.log('[dry-run] 将写入成员：', knownUsers.map((u) => `${u.displayName}<${u.email}>`).join('、'));
    console.log('[dry-run] 未改动任何数据。');
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { slug },
      update: { name: companyName, legalName, englishName },
      create: { id: randomUUID(), slug, name: companyName, legalName, englishName, status: 'active', plan: 'standard' },
    });

    let rolesCreated = 0;
    for (const code of SYSTEM_ROLE_CODES) {
      const template = await tx.role.findFirst({ where: { id: code, companyId: null } });
      if (!template) continue;
      const scopedId = `${code}@${company.id}`;
      await tx.role.upsert({
        where: { id: scopedId },
        update: { code, companyId: company.id },
        create: {
          id: scopedId,
          companyId: company.id,
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
      rolesCreated += 1;
    }

    const departments = await tx.department.updateMany({
      where: { companyId: null },
      data: { companyId: company.id },
    });

    let members = 0;
    let rolesMoved = 0;
    for (const userId of candidateUserIds) {
      if (!knownIds.has(userId)) continue;
      await tx.companyMember.upsert({
        where: { companyId_userId: { companyId: company.id, userId } },
        update: { status: 'active' },
        create: { id: randomUUID(), companyId: company.id, userId, status: 'active', joinedAt: new Date() },
      });
      members += 1;
      const userRoles = await tx.userRole.findMany({ where: { userId } });
      for (const ur of userRoles) {
        if (ur.roleId.includes('@')) continue;
        const scopedId = `${ur.roleId}@${company.id}`;
        const exists = await tx.role.findUnique({ where: { id: scopedId }, select: { id: true } });
        if (!exists) continue;
        await tx.userRole.update({ where: { id: ur.id }, data: { roleId: scopedId } });
        rolesMoved += 1;
      }
    }

    for (const w of workspaces) {
      await tx.mistWorkspace.update({ where: { id: w.id }, data: { companyId: company.id } });
    }

    return { company, rolesCreated, departments: departments.count, members, rolesMoved };
  });

  console.log('\n迁移完成：');
  console.log(`  公司：${result.company.name}（${result.company.slug} / ${result.company.id}）`);
  console.log(`  角色：复制 ${result.rolesCreated} 个`);
  console.log(`  部门：归入 ${result.departments} 个`);
  console.log(`  成员：${result.members} 人，角色改绑 ${result.rolesMoved} 条`);
  console.log(`  工作空间：${workspaces.length} 个已关联公司`);
}

main()
  .catch((error) => {
    console.error('迁移失败：', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
