import { describe, expect, it, vi } from 'vitest';
vi.mock('../middleware', async (orig) => ({ ...(await orig() as object), extractActorFromRequest: (req: any) => req.__actor }));
import { createModuleAuthGuard } from '../moduleGuard';
import { currentCompanyId, currentPlatformCompanyContext } from '../requestCompanyContext';

const run = (actor: any) => new Promise<{ companyId: unknown; platform: unknown }>(resolve => {
  const guard = createModuleAuthGuard({ requireAuth: true, apiKeys: new Set() } as any);
  guard({ __actor: actor, headers: {}, query: {} } as any, {} as any, () => resolve({ companyId: currentCompanyId(), platform: currentPlatformCompanyContext() }));
});

describe('module auth guard company context', () => {
  it('keeps the company a platform admin entered', async () => {
    const platformCompany = { companyId: 'c-entered', companyName: 'A', startedAt: '2026-11-05T00:00:00Z' };
    expect(await run({ userId: 'p', roles: [], permissions: [], departmentIds: [], companyId: 'c-entered', platformCompany })).toEqual({ companyId: 'c-entered', platform: platformCompany });
  });
  it('falls back to the entered company when the token carries no companyId', async () => {
    const platformCompany = { companyId: 'c-entered', companyName: 'A', startedAt: '2026-11-05T00:00:00Z' };
    expect((await run({ userId: 'p', roles: [], permissions: [], departmentIds: [], platformCompany })).companyId).toBe('c-entered');
  });
  it('company accounts keep their own company and no platform context', async () => {
    expect(await run({ userId: 'u', roles: [], permissions: [], departmentIds: [], companyId: 'c1' })).toEqual({ companyId: 'c1', platform: undefined });
  });
});

describe('ambient platform company context only applies to the platform admin', () => {
  it('reloading another account under an entered company does not take the platform path', async () => {
    const { buildLoadedAuthTokenPayload } = await import('../tokenHelpers');
    const { runWithCompanyContext } = await import('../requestCompanyContext');
    const prisma: any = {
      company: { findFirst: async () => { throw new Error('platform path must not run for a member'); } },
      userPermissionGrant: { findMany: async () => [] }, personalPermissionGrant: { findMany: async () => [] },
    };
    const member = { id: 'm', status: 'active', deletedAt: null, platformRole: null, roles: [], companyMembers: [{ companyId: 'c-entered', status: 'active' }] };
    const platformCompany = { companyId: 'c-entered', companyName: 'A', startedAt: '2026-11-05T00:00:00Z' };
    const result = await runWithCompanyContext('c-entered', () => buildLoadedAuthTokenPayload(prisma, member, 'c-entered').then(p => p, e => e), platformCompany);
    expect(String((result as any)?.message ?? '')).not.toMatch(/platform path|请从平台管理选择公司/);
  });
});
