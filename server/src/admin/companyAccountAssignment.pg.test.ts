import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { saveCompanyAccountAssignment } from './companyAccountAssignment';
const url = process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('atomic company account assignment', () => {
  const companyId = randomUUID(), other = randomUUID(), key = randomUUID();
  const owner = 'assignment-owner-' + key, single = 'assignment-single-' + key, shared = 'assignment-shared-' + key;
  const platform = 'assignment-platform-' + key;
  const bossRole = 'role-super-admin@' + companyId, role1 = 'assignment-1-' + key, role2 = 'assignment-2-' + key;
  const root = 'assignment-root-' + key, d1 = 'assignment-d1-' + key, d2 = 'assignment-d2-' + key;
  let db: PrismaClient;
  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    for (const id of [companyId, other]) await db.company.create({ data: { id, slug: id, name: id } });
    await db.department.create({ data: { id: root, name: '公司', companyId } });
    for (const id of [d1, d2]) await db.department.create({ data: { id, companyId, name: id, parentId: root } });
    for (const id of [owner, single, shared]) {
      await db.userAccount.create({ data: { id, displayName: id, email: id + '@example.invalid', status: 'active' } });
      await db.companyMember.create({ data: { id: randomUUID(), companyId, userId: id } });
    }
    await db.userAccount.create({ data: { id: platform, displayName: '平台', email: platform + '@example.invalid', status: 'active', platformRole: 'platform_admin' } });
    await db.companyMember.create({ data: { id: randomUUID(), companyId: other, userId: shared } });
    for (const id of [bossRole, role1, role2]) await db.role.create({ data: { id, companyId, name: id, isSystem: id === bossRole } });
    await db.userRole.create({ data: { id: randomUUID(), userId: owner, roleId: bossRole, departmentId: d1 } });
    for (const userId of [single, shared]) await db.userRole.create({ data: { id: randomUUID(), userId, roleId: role1, departmentId: d1 } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: { in: [owner, platform] } } });
    await db.employeeProfile.deleteMany({ where: { companyId } });
    await db.userRole.deleteMany({ where: { userId: { in: [owner, single, shared] } } });
    await db.role.deleteMany({ where: { companyId } });
    await db.department.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: { in: [companyId, other] } } });
    await db.userAccount.deleteMany({ where: { id: { in: [owner, single, shared, platform] } } });
    await db.$disconnect();
  });
  const save = (userId: string, body: Record<string, unknown>, client = db) => saveCompanyAccountAssignment(client, { companyId, actorId: owner, actorIsOwner: true, userId, roles: [role1], departmentId: d1, ...body });
  const roleIds = async (userId: string) => (await db.userRole.findMany({ where: { userId } })).map(r => r.roleId).sort();
  it('rejects invalid roles before any identity or assignment changes', async () => {
    const before = await db.userAccount.findUniqueOrThrow({ where: { id: single } });
    await expect(save(single, { roles: ['missing'], displayName: 'changed' })).rejects.toMatchObject({ code: 'INVALID_ROLE' });
    expect(await db.userAccount.findUniqueOrThrow({ where: { id: single } })).toEqual(before);
    expect(await roleIds(single)).toEqual([role1]);
  });
  it('saves name, email and roles in one transaction', async () => {
    await save(single, { displayName: '新姓名', email: 'changed-' + key + '@example.invalid', roles: [role2] });
    expect(await db.userAccount.findUniqueOrThrow({ where: { id: single } })).toMatchObject({ displayName: '新姓名', email: 'changed-' + key + '@example.invalid' });
    expect(await roleIds(single)).toEqual([role2]);
  });
  it('does not change shared identity from a company, while allowing company roles to change', async () => {
    await expect(save(shared, { displayName: 'changed', roles: [role2] })).rejects.toMatchObject({ code: 'PLATFORM_ACCOUNT_REQUIRED' });
    expect(await roleIds(shared)).toEqual([role1]);
    await save(shared, { displayName: shared, email: shared + '@example.invalid', roles: [role2] });
    expect(await roleIds(shared)).toEqual([role2]);
  });
  it('prevents self removal of the owner role', async () => {
    await expect(save(owner, { roles: [role1] })).rejects.toMatchObject({ code: 'SELF_OWNER_REQUIRED' });
    expect(await roleIds(owner)).toEqual([bossRole]);
  });
  it('allows a current platform administrator to maintain shared account identity', async () => {
    await save(shared, { actorId: platform, actorIsPlatform: true, displayName: '平台更正姓名' });
    expect((await db.userAccount.findUniqueOrThrow({ where: { id: shared } })).displayName).toBe('平台更正姓名');
    await expect(save(shared, { actorIsPlatform: true, displayName: '不可冒用' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.userAccount.update({ where: { id: platform }, data: { platformRole: null } });
    await expect(save(shared, { actorId: platform, actorIsPlatform: true, displayName: '已撤权' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await db.userAccount.findUniqueOrThrow({ where: { id: shared } })).displayName).toBe('平台更正姓名');
  });
  it('routes department changes for an employee through the employment flow', async () => {
    await db.employeeProfile.create({ data: { id: randomUUID(), companyId, userId: single, employeeNo: 'E1', hireDate: '2026-10-26' } });
    await expect(save(single, { departmentId: d2, roles: [role1] })).rejects.toMatchObject({ code: 'EMPLOYMENT_TRANSFER_REQUIRED' });
    expect(await roleIds(single)).toEqual([role2]);
    expect((await db.userRole.findFirstOrThrow({ where: { userId: single } })).departmentId).toBe(d1);
  });
  it('rolls back identity and role changes if the audit cannot be saved', async () => {
    const before = await db.userAccount.findUniqueOrThrow({ where: { id: single } });
    const failing = new Proxy(db, { get(target, name) {
      if (name === '$transaction') return (fn: any) => target.$transaction(tx => fn(new Proxy(tx, { get(t, n) { return n === 'auditLog' ? { create: async () => { throw Error('audit unavailable'); } } : Reflect.get(t, n); } })));
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(save(single, { displayName: 'must roll back', roles: [role1] }, failing)).rejects.toThrow('audit unavailable');
    expect(await db.userAccount.findUniqueOrThrow({ where: { id: single } })).toEqual(before);
    expect(await roleIds(single)).toEqual([role2]);
  });
});
