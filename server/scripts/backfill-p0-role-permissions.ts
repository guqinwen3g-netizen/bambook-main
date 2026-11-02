/**
 * backfill-p0-role-permissions.ts — 2026-11 P0 权限码补授（已存在公司的系统岗位副本）
 *
 * 背景：公司系统岗位（`<code>@<companyId>`）在开通时按当时的默认矩阵建立，之后不随矩阵更新。
 *   P0 改用新码（customs:admin、tax:read、ai:write:*）后，老公司岗位会丢原有能力。
 *   本脚本只补 P0 明确清单（server/src/platform/p0PermissionBackfill.ts 的 P0_ROLE_GRANTS），
 *   不按默认矩阵整体同步；不删除任何权限，不改自定义岗位，只列出自定义岗位的人工核对项。
 *
 * 用法（在 server/ 下；先备份数据库）：
 *   npx tsx scripts/backfill-p0-role-permissions.ts                       # 预演，只打印计划
 *   npx tsx scripts/backfill-p0-role-permissions.ts --company <slug>      # 只看指定公司，可重复
 *   npx tsx scripts/backfill-p0-role-permissions.ts --apply               # 写入；每家公司一个事务
 * 幂等：已补齐的公司计划为空，重复执行不重复写。输出只含公司标识、岗位码和权限码。
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_SCOPES } from '../src/_shared/rolePermissionMatrix';
import { formatP0Plan, planP0Backfill, type BackfillCompany } from '../src/platform/p0PermissionBackfill';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const slugs = args.flatMap((arg, i) => arg === '--company' && args[i + 1] ? [args[i + 1]] : []);
if (args.includes('--company') && !slugs.length) throw new Error('--company 需要公司标识（slug）');

async function loadCompany(prisma: Pick<PrismaClient, 'role'>, company: { id: string; slug: string }): Promise<BackfillCompany> {
  const roles = await prisma.role.findMany({ where: { companyId: company.id }, select: { id: true, code: true, isSystem: true, permissions: { select: { permission: { select: { scope: true } } } } } });
  return { ...company, roles: roles.map(role => ({ id: role.id, code: role.code, isSystem: role.isSystem, scopes: role.permissions.map(p => p.permission.scope) })) };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const companies = await prisma.company.findMany({ where: slugs.length ? { slug: { in: slugs } } : {}, select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
    const missing = slugs.filter(slug => !companies.some(c => c.slug === slug));
    if (missing.length) throw new Error(`找不到公司：${missing.join(', ')}`);
    console.log(`[backfill-p0-role-permissions] ${apply ? '写入' : '预演（加 --apply 才写入）'}，公司 ${companies.length} 家`);
    let written = 0;
    for (const company of companies) {
      if (!apply) { formatP0Plan(planP0Backfill(await loadCompany(prisma, company))).forEach(line => console.log(line)); continue; }
      // 事务内重新读取并计划，避免与并发修改错位；同一公司的补授一次提交。
      const plan = await prisma.$transaction(async tx => {
        const plan = planP0Backfill(await loadCompany(tx, company));
        if (!plan.grants.length) return plan;
        const scopes = [...new Set(plan.grants.map(g => g.scope))];
        await tx.permission.createMany({ data: scopes.map(scope => ({ id: randomUUID(), scope, description: PERMISSION_SCOPES[scope as keyof typeof PERMISSION_SCOPES] })), skipDuplicates: true });
        const catalog = new Map((await tx.permission.findMany({ where: { scope: { in: scopes } }, select: { id: true, scope: true } })).map(p => [p.scope, p.id]));
        await tx.rolePermission.createMany({ data: plan.grants.map(g => ({ id: randomUUID(), roleId: g.roleId, permissionId: catalog.get(g.scope)! })), skipDuplicates: true });
        return plan;
      });
      formatP0Plan(plan).forEach(line => console.log(line));
      written += plan.grants.length;
    }
    if (apply) console.log(`[backfill-p0-role-permissions] 完成，写入 ${written} 项`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[backfill-p0-role-permissions] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
