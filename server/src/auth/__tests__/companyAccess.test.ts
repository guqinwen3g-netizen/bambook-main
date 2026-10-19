import { describe, expect, it, vi } from 'vitest';
import { validateCompanySession } from '../companyAccess';
import { createAuthorizationSnapshotGuard } from '../authorizationSnapshotGuard';
import { createAuthService } from '../service';
import { currentCompanyId } from '../requestCompanyContext';
const user = { id: 'u', status: 'active', roles: [] };
const db = (membership: any) => ({ companyMember: { findFirst: vi.fn(async () => membership) }, company: { count: vi.fn(async () => 2) } }) as any;
describe('live company boundary', () => {
  it('requires fresh active membership', async () => { await expect(validateCompanySession(db(null), user, 'a')).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' }); });
  it('rejects suspended companies', async () => { await expect(validateCompanySession(db({ company: { status: 'suspended' } }), user, 'a')).rejects.toMatchObject({ status: 403 }); });
  it('accepts active membership', async () => { await expect(validateCompanySession(db({ company: { status: 'active' } }), user, 'a')).resolves.toBeUndefined(); });
  it('rejects old unscoped tokens after migration', async () => { await expect(validateCompanySession(db({ companyId: 'a' }), user, null)).rejects.toMatchObject({ code: 'COMPANY_SELECTION_REQUIRED' }); });
  it('denies unassigned accounts on a SaaS database', async () => { await expect(validateCompanySession(db(null), user, null)).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' }); });
  it('allows a platform-only identity without company grants', async () => { await expect(validateCompanySession(db(null), { ...user, platformRole: 'platform_admin' }, null)).resolves.toBeUndefined(); });
  it('retains tenant context through the real global authorization guard', async () => {
    const prisma = db({ company: { status: 'active' } });
    prisma.userAccount = { findFirst: vi.fn(async () => user) };
    prisma.userPermissionOverrides = { findMany: vi.fn(async () => []) };
    const token = createAuthService().signToken({ userId: 'u', companyId: 'a', roles: [], permissions: [], departmentIds: [] });
    const req: any = { query: {}, headers: { authorization: `Bearer ${token}` } }; const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn(), clearCookie: vi.fn() };
    let context: any; await createAuthorizationSnapshotGuard({ prisma })(req, res, () => { context = currentCompanyId(); });
    expect(context).toBe('a'); expect(req.actor.companyId).toBe('a');
  });
});
