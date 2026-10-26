import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createPlatformCompanySettings } from './companySettings';
import type { TokenPayload } from '../auth/service';

const url = process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('platform company settings transaction', () => {
  const companyId = randomUUID(), userId = 'platform-settings-' + randomUUID(), ownerId = 'settings-owner-' + randomUUID();
  const prior: TokenPayload = { userId, roles: [], permissions: [], departmentIds: [], platformOnly: true };
  let db: PrismaClient;
  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    await db.company.create({ data: { id: companyId, slug: companyId, name: '平台设置验收', status: 'suspended' } });
    await db.userAccount.create({ data: { id: userId, email: userId+'@example.invalid', displayName: '平台管理员', status: 'active', platformRole: 'platform_admin' } });
    await db.userAccount.create({ data: { id: ownerId, email: ownerId+'@example.invalid', displayName: '负责人', status: 'active' } });
    await db.companyMember.create({ data: { id: randomUUID(), companyId, userId: ownerId, status: 'active' } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: userId } });
    await db.company.delete({ where: { id: companyId } });
    await db.userAccount.deleteMany({ where: { id: { in: [userId, ownerId] } } });
    await db.$disconnect();
  });
  it('creates settings under the real company member, without company permissions for the platform account', async () => {
    const service = createPlatformCompanySettings(db), initial = await service.read(prior, companyId);
    expect(initial.workspaceId).toBeNull();
    const saved = await service.update(prior, companyId, { requestId: randomUUID(), expectedRevision: 0, patch: { companyProfile: { legalName: '雾织贸易' } } });
    expect(saved.snapshot.ownerId).toBe(ownerId); expect(saved.snapshot.settings.companyProfile?.legalName).toBe('雾织贸易');
    expect(await db.companyMember.count({ where: { companyId, userId } })).toBe(0);
  });
  it('allows only one of two saves against the same revision', async () => {
    const service = createPlatformCompanySettings(db), initial = await service.read(prior, companyId);
    const result = await Promise.allSettled(['甲公司', '乙公司'].map(workspaceName => service.update(prior, companyId, { requestId: randomUUID(), expectedRevision: initial.revision, patch: { workspaceName } })));
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'REVISION_CONFLICT' } });
  });
  it('rolls back the settings and receipt together when audit storage fails', async () => {
    const before = await db.mistWorkspace.findFirstOrThrow({ where: { companyId } });
    const broken = new Proxy(db, { get(target, name) {
      if (name === '$transaction') return (work: any) => target.$transaction(tx => work(new Proxy(tx, { get(client, member) { return member === 'auditLog' ? { create: async () => { throw Error('audit unavailable'); } } : Reflect.get(client, member); } })));
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(createPlatformCompanySettings(broken).update(prior, companyId, { requestId: randomUUID(), expectedRevision: before.revision, patch: { workspaceName: '不能保存' } })).rejects.toThrow('audit unavailable');
    expect(await db.mistWorkspace.findFirstOrThrow({ where: { companyId } })).toEqual(before);
  });
});
