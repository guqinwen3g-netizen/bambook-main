import type { Prisma } from '@prisma/client';
import { isCompanyAdministrator } from '../auth/companyAdministration';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';

/** Only a company's explicit system administrator may bootstrap its first business manager.
 * Any previous appointment closes this path permanently; recovery uses the existing manager/platform flow.
 * Write callers must hold the Company row lock until the role, marker and audit commit together. */
export async function initialGeneralManagerEligibility(
  db: Pick<Prisma.TransactionClient, 'companyMember' | 'userRole'>, companyId: string, actorId: string,
): Promise<'allowed' | 'forbidden' | 'configured'> {
  const member = await db.companyMember.findUnique({ where: { companyId_userId: { companyId, userId: actorId } },
    include: { company: true, user: { select: { status: true, deletedAt: true } } } });
  if (!isCompanyAdministrator(member, actorId) || member?.companyId !== companyId || member.company.id !== companyId || member.user.status !== 'active' || member.user.deletedAt !== null) return 'forbidden';
  const settings = member.company.settings as Record<string, unknown> | null;
  if (settings?.generalManagerAppointedAt) return 'configured';
  const manager = await db.userRole.findFirst({ where: { role: { companyId,
    OR: [{ code: SYSTEM_ROLE_IDS.SUPER_ADMIN }, { id: `${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${companyId}` }] } }, select: { id: true } });
  return manager ? 'configured' : 'allowed';
}
