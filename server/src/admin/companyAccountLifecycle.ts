import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export class CompanyAccountError extends Error {
  constructor(message: string, public statusCode: number, public code: string) { super(message); }
}

/** Company access changes must not enable or disable an identity in another company. */
export async function setCompanyAccountAccess(prisma: PrismaClient, input: {
  companyId: string; userId: string; actorId: string; enabled: boolean;
}) {
  if (!input.enabled && input.userId === input.actorId) throw new CompanyAccountError('不能停用自己。', 400, 'SELF_DISABLE');
  return prisma.$transaction(async tx => {
    // Serialize capacity changes with the platform's company-member operations.
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${input.companyId}::uuid FOR UPDATE`;
    const member = await tx.companyMember.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
      include: { company: true, user: true },
    });
    if (!member || !['active', 'suspended'].includes(member.status)) throw new CompanyAccountError('账号不存在。', 404, 'NOT_FOUND');
    if (input.enabled && (member.company.status !== 'active' || member.user.status !== 'active' || member.user.deletedAt !== null)) {
      throw new CompanyAccountError('账号或公司已停用，无法恢复公司访问。', 409, 'ACCOUNT_UNAVAILABLE');
    }
    const status = input.enabled ? 'active' : 'suspended';
    if (member.status === status) return;
    if (input.enabled && member.company.seatLimit !== null) {
      const used = await tx.companyMember.count({ where: { companyId: input.companyId, status: 'active', user: { status: 'active', deletedAt: null } } });
      if (used >= member.company.seatLimit) throw new CompanyAccountError('公司席位已用完。', 409, 'SEAT_LIMIT_REACHED');
    }
    await tx.companyMember.update({ where: { id: member.id }, data: { status } });
    await tx.auditLog.create({ data: {
      id: randomUUID(), actorId: input.actorId, action: input.enabled ? 'enable_company_account' : 'disable_company_account',
      targetType: 'UserAccount', targetId: input.userId, detail: { companyId: input.companyId },
    } });
  });
}
