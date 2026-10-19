import type { PrismaClient } from '@prisma/client';

export class CompanyAccessError extends Error {
  constructor(public code: string, message: string, public status = 403) { super(message); }
}

/** Validate membership on every reload, including tokens issued before migration. */
export async function validateCompanySession(db: PrismaClient, user: any, companyId?: string | null) {
  const client = db as any;
  // Older isolated adapters have no tenant model. PostgreSQL always has it.
  if (typeof client.companyMember?.findFirst !== 'function') return;
  if (companyId) {
    const membership = await client.companyMember.findFirst({ where: { userId: user.id, companyId, status: 'active' }, include: { company: true } });
    if (!membership || membership.company?.status !== 'active') throw new CompanyAccessError('COMPANY_ACCESS_DENIED', '公司已停用或你已不属于该公司，请重新登录。');
    return;
  }
  if (user.platformRole === 'platform_admin') return; // Explicit platform-only session carries no company business grants.
  const membership = await client.companyMember.findFirst({ where: { userId: user.id } });
  if (membership || user.roles?.some((r: any) => r.role?.companyId)) throw new CompanyAccessError('COMPANY_SELECTION_REQUIRED', '公司归属已更新，请重新登录并选择公司。', 401);
  if (typeof client.company?.count === 'function' && await client.company.count() > 0 && user.platformRole !== 'platform_admin') {
    throw new CompanyAccessError('COMPANY_ACCESS_DENIED', '当前账号尚未获准加入公司。');
  }
}
