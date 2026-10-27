/**
 * check-company-single-library.ts —— “一家公司一个业务库”迁移前核对（只读，不写库）
 *
 * 迁移 20261028120000_company_single_library 要求每家公司最多一个 MistWorkspace。
 * 本脚本列出每家公司名下的全部业务库（创建人、名称、版本、更新时间、是否标记回收站、业务记录粗略数量），
 * 供运营人员决定保留哪一个。脚本不猜测、不合并、不删除；解除其余库的公司归属须人工确认后另行处理。
 *
 * 用法：cd server && npx tsx scripts/check-company-single-library.ts
 * 退出码：0 = 全部公司至多一个库，可直接迁移；2 = 存在需人工处理的公司。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient() as any;
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;

async function main() {
  const rows = await prisma.mistWorkspace.findMany({
    where: { companyId: { not: null } },
    select: { id: true, companyId: true, ownerId: true, name: true, revision: true, updatedAt: true, state: true },
    orderBy: [{ companyId: 'asc' }, { updatedAt: 'desc' }],
  });
  const byCompany = new Map<string, any[]>();
  for (const row of rows) byCompany.set(row.companyId, [...(byCompany.get(row.companyId) ?? []), row]);
  const duplicated = [...byCompany.entries()].filter(([, list]) => list.length > 1);
  console.log(`公司业务库：${rows.length} 个，涉及 ${byCompany.size} 家公司；需人工处理 ${duplicated.length} 家。`);
  for (const [companyId, list] of duplicated) {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    console.log(`\n公司 ${company?.name ?? '(未知)'} ${companyId}：${list.length} 个业务库`);
    for (const row of list) {
      const s = row.state ?? {};
      console.log(`  - ${row.id} 「${row.name}」 创建人=${row.ownerId} 版本=${row.revision} 更新=${row.updatedAt.toISOString()}`
        + `${s.workspaceArchive ? ' [回收站]' : ''} 客户=${count(s.customers ?? s.market?.customers)} 订单=${count(s.orders)} 附件=${count(s.files)}`);
    }
  }
  process.exitCode = duplicated.length ? 2 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
