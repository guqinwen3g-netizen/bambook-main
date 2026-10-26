import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { TokenPayload } from '../auth/service';
import { CompanyAccessError } from '../auth/companyAccess';
import { loadUserWithRoles } from '../auth/tokenHelpers';
import { isTokenRevoked } from '../auth/sessionRevocation';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { applyMistCommand, createMistState, MistCommandError, type MistSettings, type MistState } from '../shared/mistWorkspace';

export type CompanySettingsPatch = Pick<Partial<MistSettings>, 'workspaceName' | 'notifications'> & { companyProfile?: Partial<NonNullable<MistSettings['companyProfile']>> };
export type CompanySettingsSnapshot = { companyId: string; workspaceId: string | null; ownerId: string | null; revision: number; settings: Pick<MistSettings, 'workspaceName' | 'companyProfile' | 'notifications'>; events: MistState['events'] };
const fail = (code: string, message: string, status = 400): never => { throw new CompanyAccessError(code, message, status); };
const stable = (value: any): string => value && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(stable).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  : JSON.stringify(value);

/** The platform endpoint projects settings only; it never returns customer orders, mail, files or funds. */
export function createPlatformCompanySettings(prisma: PrismaClient) {
  async function authorize(db: any, prior: TokenPayload, companyId: string) {
    const user = await loadUserWithRoles(db, prior.userId);
    if (!user || user.status !== 'active' || user.deletedAt != null || user.platformRole !== 'platform_admin') return fail('FORBIDDEN', '需要平台管理员身份。', 403);
    if (isTokenRevoked(user.metadata, (prior as any).iat, prior.credentialVersion)) fail('SESSION_REVOKED', '登录已失效，请重新登录。', 401);
    if (prior.platformCompany && prior.platformCompany.companyId !== companyId) fail('PLATFORM_COMPANY_ACCESS_DENIED', '当前管理的公司不一致。', 403);
    const company = await db.company.findFirst({ where: { id: companyId } });
    if (!company) fail('NOT_FOUND', '公司不存在。', 404);
    return { user, company };
  }
  const context = (user: any) => ({ id: randomUUID, now: new Date().toISOString(), actorName: user.displayName || user.id, actorId: user.id, can: () => true });
  async function findWorkspace(db: any, companyId: string) {
    const rows = await db.mistWorkspace.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    return rows.find((row: any) => !row.state?.workspaceArchive) ?? rows.at(-1) ?? null;
  }
  function view(company: any, row: any, user: any): CompanySettingsSnapshot {
    const state = row?.state ?? createMistState(context(user), 'empty');
    return { companyId: company.id, workspaceId: row?.id ?? null, ownerId: row?.ownerId ?? null, revision: row?.revision ?? 0,
      settings: { workspaceName: row ? state.settings.workspaceName : company.name, companyProfile: state.settings.companyProfile, notifications: state.settings.notifications },
      events: row ? state.events.filter((event: MistState['events'][number]) => event.entityType === 'settings').slice(0, 100) : [] };
  }
  return {
    read: (prior: TokenPayload, companyId: string) => prisma.$transaction(async db => {
      const { user, company } = await authorize(db, prior, companyId);
      return view(company, await findWorkspace(db, companyId), user);
    }),
    update: (prior: TokenPayload, companyId: string, input: { requestId: string; expectedRevision: number; patch: CompanySettingsPatch }) => prisma.$transaction(async db => {
      if (!input || Object.keys(input).some(key => !['requestId', 'expectedRevision', 'patch'].includes(key)) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('VALIDATION_FAILED', '保存请求无效。');
      if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch) || Object.keys(input.patch).some(key => !['workspaceName', 'companyProfile', 'notifications'].includes(key))) fail('VALIDATION_FAILED', '公司设置字段无效。');
      if (input.patch.workspaceName !== undefined && (typeof input.patch.workspaceName !== 'string' || !input.patch.workspaceName.trim() || input.patch.workspaceName.trim().length > 120)) fail('VALIDATION_FAILED', '公司显示名称须为1至120字。');
      if (input.patch.notifications !== undefined && (!input.patch.notifications || typeof input.patch.notifications !== 'object' || Array.isArray(input.patch.notifications) || Object.entries(input.patch.notifications).some(([key, value]) => !['qc', 'shipping', 'suggestions', 'digest'].includes(key) || typeof value !== 'boolean'))) fail('VALIDATION_FAILED', '通知设置无效。');
      const { user, company } = await authorize(db, prior, companyId);
      // Lock the company before choosing or initializing its default workspace.
      await db.$queryRawUnsafe('SELECT "id" FROM "Company" WHERE "id" = $1::uuid FOR UPDATE', companyId);
      let row = await findWorkspace(db, companyId);
      const hash = createHash('sha256').update(stable({ actorId: user.id, companyId, revision: input.expectedRevision, patch: input.patch })).digest('hex');
      if (row) {
        await db.$queryRawUnsafe('SELECT "id" FROM "MistWorkspace" WHERE "id" = $1::uuid FOR UPDATE', row.id);
        row = await db.mistWorkspace.findFirst({ where: { id: row.id, companyId } });
        const previous = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: row.id, requestId: input.requestId } } });
        if (previous) {
          if (previous.actorId !== user.id || previous.inputHash !== hash) fail('REQUEST_CONFLICT', '请求编号已用于其他操作。', 409);
          return { snapshot: view(company, row, user), receipt: previous.result, replayed: true };
        }
      }
      if ((row?.revision ?? 0) !== input.expectedRevision) fail('REVISION_CONFLICT', '公司设置已有更新，请重新读取后保存。', 409);
      const state: MistState = row?.state ?? createMistState(context(user), 'empty');
      if (!row) state.settings.workspaceName = company.name;
      let next: MistState;
      try { next = applyMistCommand(state, { type: 'settings.update', payload: input.patch }, context(user)).state; }
      catch (error) { if (error instanceof MistCommandError) fail('VALIDATION_FAILED', error.message); throw error; }
      // Only the settings command's changes are persisted. All unrelated state stays as read.
      if (!row) {
        const owner = await db.companyMember.findFirst({ where: { companyId, status: 'active', user: { status: 'active', deletedAt: null, platformRole: null, roles: { some: { role: { companyId, OR: [{ code: SYSTEM_ROLE_IDS.SUPER_ADMIN }, { id: `${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${companyId}` }] } } } } }, orderBy: { createdAt: 'asc' } });
        if (!owner) return fail('OWNER_REQUIRED', '请先为公司配置负责人。', 409);
        row = await db.mistWorkspace.create({ data: { id: randomUUID(), companyId, ownerId: owner.userId, slug: `default@${companyId}`, name: next.settings.workspaceName, revision: 1, state: next as any } });
      } else {
        row = await db.mistWorkspace.update({ where: { id: row.id }, data: { name: next.settings.workspaceName, state: next as any, revision: row.revision + 1 } });
      }
      const receipt = { requestId: input.requestId, revision: row.revision, result: {} };
      await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId: row.id, requestId: input.requestId, actorId: user.id, inputHash: hash, expectedRevision: input.expectedRevision, result: receipt } });
      await db.auditLog.create({ data: { id: randomUUID(), actorId: user.id, action: 'platform_company_settings_update', targetType: 'Company', targetId: companyId, detail: { fields: Object.keys(input.patch), requestId: input.requestId, revision: row.revision } } });
      return { snapshot: view(company, row, user), receipt, replayed: false };
    }),
  };
}
