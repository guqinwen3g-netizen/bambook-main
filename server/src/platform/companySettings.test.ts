import { describe, expect, it, vi } from 'vitest';
import { createMistState } from '../shared/mistWorkspace';
import { createPlatformCompanySettings } from './companySettings';
import type { TokenPayload } from '../auth/service';

const prior: TokenPayload = { userId: 'platform', roles: [], permissions: [], departmentIds: [], platformOnly: true };
function fixture() {
  const ctx = { id: () => crypto.randomUUID(), now: '2026-10-26T00:00:00Z', actorId: 'owner', actorName: '负责人', can: () => true };
  let row: any = { id: 'workspace', ownerId: 'owner', companyId: 'c1', revision: 3, state: createMistState(ctx, 'demo') };
  const user: any = { id: 'platform', displayName: '平台人员', status: 'active', platformRole: 'platform_admin', deletedAt: null, roles: [], metadata: {} };
  const receipts = new Map<string, any>();
  const db: any = {
    $queryRawUnsafe: vi.fn(async () => []),
    userAccount: { findFirst: vi.fn(async () => user) },
    company: { findFirst: vi.fn(async ({ where }: any) => where.id === 'c1' ? { id: 'c1', name: '雾织', status: 'suspended' } : null) },
    companyMember: { findFirst: vi.fn(async () => ({ userId: 'owner' })) },
    mistWorkspace: {
      findMany: vi.fn(async () => row ? [row] : []), findFirst: vi.fn(async () => row),
      update: vi.fn(async ({ data }: any) => row = { ...row, ...data }),
      create: vi.fn(async ({ data }: any) => row = data),
    },
    mistCommandReceipt: { findUnique: vi.fn(async ({ where }: any) => receipts.get(where.workspaceId_requestId.requestId) ?? null), create: vi.fn(async ({ data }: any) => { receipts.set(data.requestId, data); return data; }) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  db.$transaction = async (work: any) => { const old = structuredClone(row), saved = new Map(receipts); try { return await work(db); } catch (e) { row = old; receipts.clear(); for (const [key, value] of saved) receipts.set(key, value); throw e; } };
  return { db, user, get row() { return row; }, clear: () => { row = null; }, service: createPlatformCompanySettings(db) };
}
const input = { requestId: 'settings-request-001', expectedRevision: 3, patch: { workspaceName: '雾织贸易' } };

describe('platform company settings', () => {
  it('reads a suspended company without membership and returns no business state', async () => {
    const f = fixture(), snapshot = await f.service.read(prior, 'c1');
    expect(snapshot.settings.workspaceName).toBeTruthy();
    expect(snapshot).not.toHaveProperty('state'); expect(snapshot).not.toHaveProperty('orders');
    expect(snapshot.events.every(event => event.entityType === 'settings')).toBe(true);
    expect(f.db.companyMember.findFirst).not.toHaveBeenCalled();
  });
  it('saves only settings with the platform actor and replays the same request once', async () => {
    const f = fixture(), before = structuredClone(f.row.state);
    const first = await f.service.update(prior, 'c1', input), again = await f.service.update(prior, 'c1', input);
    expect(first.snapshot.revision).toBe(4); expect(again.replayed).toBe(true);
    expect(f.db.mistWorkspace.update).toHaveBeenCalledTimes(1);
    for (const key of Object.keys(before).filter(key => !['settings', 'events'].includes(key))) expect(f.row.state[key]).toEqual(before[key]);
    expect(f.row.ownerId).toBe('owner');
    expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'platform', targetId: 'c1', action: 'platform_company_settings_update' }) }));
  });
  it('rejects stale versions, reused requests and fields outside company configuration', async () => {
    const f = fixture();
    await expect(f.service.update(prior, 'c1', { ...input, expectedRevision: 1 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(f.service.update(prior, 'c1', { ...input, patch: { businessClock: {} } as any })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await f.service.update(prior, 'c1', input);
    await expect(f.service.update(prior, 'c1', { ...input, patch: { workspaceName: '另一名称' } })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  });
  it('rejects company users, withdrawn platform access and a different selected company', async () => {
    const f = fixture(); f.user.platformRole = null;
    await expect(f.service.read(prior, 'c1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.user.platformRole = 'platform_admin';
    await expect(f.service.read({ ...prior, platformCompany: { companyId: 'c2', companyName: '另一公司', startedAt: '2026-10-26' } }, 'c1')).rejects.toMatchObject({ code: 'PLATFORM_COMPANY_ACCESS_DENIED' });
    f.user.status = 'disabled'; await expect(f.service.update(prior, 'c1', input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rolls back a write if its platform audit cannot be stored', async () => {
    const f = fixture(), before = structuredClone(f.row);
    f.db.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.update(prior, 'c1', input)).rejects.toThrow('audit unavailable');
    expect(f.row).toEqual(before);
  });
  it('reads an unopened company without creating data, then initializes under its real member', async () => {
    const f = fixture(); f.clear();
    expect((await f.service.read(prior, 'c1')).workspaceId).toBeNull(); expect(f.row).toBeNull();
    await f.service.update(prior, 'c1', { ...input, expectedRevision: 0 });
    expect(f.row.ownerId).toBe('owner'); expect(f.row.companyId).toBe('c1'); expect(f.row.slug).toBe('default@c1');
  });
  it('maintains settings for an archived workspace without restoring or duplicating it', async () => {
    const f = fixture(); f.row.state.workspaceArchive = { at: '2026-10-01', actorId: 'owner', actorName: '负责人' };
    await f.service.update(prior, 'c1', input);
    expect(f.row.state.workspaceArchive.at).toBe('2026-10-01'); expect(f.db.mistWorkspace.create).not.toHaveBeenCalled();
  });
  it('does not grant workspace ownership to an arbitrary company member', async () => {
    const f = fixture(); f.clear(); f.db.companyMember.findFirst.mockResolvedValue(null);
    await expect(f.service.update(prior, 'c1', { ...input, expectedRevision: 0 })).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
    expect(f.db.companyMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ user: expect.objectContaining({ roles: expect.anything() }) }) }));
    expect(f.db.mistWorkspace.create).not.toHaveBeenCalled();
  });
});
