import { describe, expect, it, vi } from 'vitest';
import { initialGeneralManagerEligibility } from './initialGeneralManager';

function fixture() {
  const member = { companyId: 'company', userId: 'admin', status: 'active', user: { status: 'active', deletedAt: null }, company: { id: 'company', status: 'active', settings: { administratorIds: ['admin'] } as Record<string, unknown> } };
  const db = { companyMember: { findUnique: vi.fn(async () => member) }, userRole: { findFirst: vi.fn(async (): Promise<any> => null) } };
  return { member, db };
}
describe('first general manager eligibility', () => {
  it('requires explicit company administration, never a role, mailbox or display name', async () => {
    const { member, db } = fixture(); member.company.settings = { administratorIds: [] };
    expect(await initialGeneralManagerEligibility(db as any, 'company', 'admin')).toBe('forbidden');
    expect(db.userRole.findFirst).not.toHaveBeenCalled();
  });
  it('rejects inactive memberships, inactive companies and deleted accounts', async () => {
    for (const change of [(m: any) => m.status = 'suspended', (m: any) => m.company.status = 'disabled', (m: any) => m.user.status = 'disabled', (m: any) => m.user.deletedAt = new Date(), (m: any) => m.userId = 'other', (m: any) => m.companyId = 'elsewhere', (m: any) => m.company.id = 'elsewhere']) {
      const { member, db } = fixture(); change(member);
      expect(await initialGeneralManagerEligibility(db as any, 'company', 'admin')).toBe('forbidden');
    }
  });
  it('keeps a previous appointment closed even if its role or account was removed', async () => {
    const { member, db } = fixture(); member.company.settings.generalManagerAppointedAt = '2026-10-28';
    expect(await initialGeneralManagerEligibility(db as any, 'company', 'admin')).toBe('configured');
    expect(db.userRole.findFirst).not.toHaveBeenCalled();
  });
  it('recognizes any existing manager assignment, including an inactive legacy manager', async () => {
    const { db } = fixture(); db.userRole.findFirst.mockResolvedValue({ id: 'old-manager' });
    expect(await initialGeneralManagerEligibility(db as any, 'company', 'admin')).toBe('configured');
    expect(db.userRole.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { role: { companyId: 'company', OR: [{ code: 'role-super-admin' }, { id: 'role-super-admin@company' }] } } }));
  });
  it('allows an active explicit administrator in a company with no manager history', async () => {
    const { db } = fixture();
    expect(await initialGeneralManagerEligibility(db as any, 'company', 'admin')).toBe('allowed');
  });
});
