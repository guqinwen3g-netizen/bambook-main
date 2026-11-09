import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createAdminRouter } from './route';
import { createAuthService } from '../auth/service';
import { createAuthorizationSnapshotGuard } from '../auth/authorizationSnapshotGuard';
import { tenantSurfaceGuard } from '../auth/tenantSurfaceGuard';
import { installAuditCompanyStamp } from '../audit/auditCompanyStamp';
import { createOrderMainApprovalService } from '../orders/orderMainApprovalService';

const url = process.env.MIST_PG_CONFLICT_TEST_URL;
const local = (u: string) => { const c = new URL(u); return ['127.0.0.1', 'localhost'].includes(c.hostname) && /^\/bambook_(account|acceptance|test)/.test(c.pathname); };

describe.skipIf(!url)('company-scoped audit log and approval authority on PostgreSQL', () => {
  const key = randomUUID().slice(0, 8), companies = [randomUUID(), randomUUID()];
  const owners = companies.map((_, i) => `iso-owner-${i}-${key}`), members = companies.map((_, i) => `iso-member-${i}-${key}`), legacy = `iso-legacy-${key}`, platform = `iso-platform-${key}`;
  const users = [...owners, ...members, legacy, platform];
  let db: PrismaClient, app: express.Express, legacyApp: express.Express; const auth = createAuthService();
  const bearer = (i: number | null) => 'Bearer ' + auth.signToken({ userId: i === null ? legacy : owners[i], roles: ['owner'], permissions: i === null ? ['users:admin'] : [], departmentIds: [], ...(i === null ? {} : { companyId: companies[i] }) });

  beforeAll(async () => {
    if (!local(url!)) throw Error('A dedicated local acceptance database is required');
    db = new PrismaClient({ datasourceUrl: url }); installAuditCompanyStamp(db as any);
    for (const id of users) await db.userAccount.create({ data: { id, email: id + '@example.invalid', displayName: id, status: 'active', passwordHash: 'unused', ...(id === platform ? { platformRole: 'platform_admin' } : {}) } });
    await db.role.upsert({ where: { id: 'role-super-admin' }, create: { id: 'role-super-admin', code: 'role-super-admin', name: 'Owner global', isSystem: true }, update: {} });
    await db.userRole.create({ data: { id: randomUUID(), userId: legacy, roleId: 'role-super-admin' } });
    for (let i = 0; i < 2; i++) {
      await db.company.create({ data: { id: companies[i], name: 'Iso ' + i, slug: `iso-${i}-${key}` } });
      await db.role.create({ data: { id: `role-super-admin@${companies[i]}`, companyId: companies[i], code: 'role-super-admin', name: `Owner ${i} ${key}`, isSystem: true } });
      for (const id of [owners[i], members[i]]) await db.companyMember.create({ data: { companyId: companies[i], userId: id } });
      await db.userRole.create({ data: { id: randomUUID(), userId: owners[i], roleId: `role-super-admin@${companies[i]}` } });
      // 订单主审批资格要求订单写入权限：成员按业务岗位持有 orders:write。
      const salesRole = `role-sales-${key}@${companies[i]}`, orderWrite = await db.permission.upsert({ where: { scope: 'orders:write' }, create: { id: 'perm-orders-write', scope: 'orders:write' }, update: {} });
      await db.role.create({ data: { id: salesRole, companyId: companies[i], name: `Sales ${i} ${key}`, isSystem: false } });
      await db.rolePermission.create({ data: { id: randomUUID(), roleId: salesRole, permissionId: orderWrite.id } });
      const root = `dept-root-${key}-${i}`, dept = `dept-sales-${key}-${i}`; await db.department.create({ data: { id: root, companyId: companies[i], name: `Root ${i} ${key}` } });
      await db.department.create({ data: { id: dept, companyId: companies[i], name: `Sales ${i} ${key}`, parentId: root, metadata: { businessAttributes: ['fabric_business', 'garment_business'] } } });
      await db.userRole.create({ data: { id: randomUUID(), userId: members[i], roleId: salesRole, departmentId: dept } });
    }
    app = express(); app.use(express.json());
    app.use('/api', createAuthorizationSnapshotGuard({ prisma: db }), tenantSurfaceGuard);
    app.use('/api/admin', createAdminRouter({ prisma: db }));
    // 无公司的单租户会话（历史全局配置）：只经过 admin 自身的签名令牌校验与 users:admin 判定。
    legacyApp = express(); legacyApp.use(express.json()); legacyApp.use('/api', tenantSurfaceGuard); legacyApp.use('/api/admin', createAdminRouter({ prisma: db }));
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await db.orderApprovalAuthority.deleteMany({ where: { userId: { in: users } } });
    await db.userRole.deleteMany({ where: { userId: { in: users } } });
    await db.role.deleteMany({ where: { companyId: { in: companies } } });
    await db.department.deleteMany({ where: { companyId: { in: companies }, parentId: { not: null } } });
    await db.department.deleteMany({ where: { companyId: { in: companies } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.userAccount.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  it('records the company on audit writes and lists/exports only own-company rows', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await request(app).put('/api/admin/order-approval-authorities/fabric').set('Authorization', bearer(i)).send({ userIds: [members[i]] });
      expect(r.status).toBe(200);
    }
    const rows = await db.auditLog.findMany({ where: { actorId: { in: owners }, action: 'replace_order_approval_authorities' } });
    expect(rows.map(row => [row.actorId, row.companyId]).sort()).toEqual(owners.map((o, i) => [o, companies[i]]).sort());
    await db.auditLog.create({ data: { id: 'iso-platform-' + key, actorId: legacy, action: 'platform.settings.update' } });
    for (let i = 0; i < 2; i++) {
      const list = await request(app).get('/api/admin/audit-logs?limit=200').set('Authorization', bearer(i));
      expect(list.status).toBe(200);
      expect(list.body.logs.length).toBeGreaterThan(0);
      expect(list.body.logs.every((row: any) => row.companyId === companies[i])).toBe(true);
      const exported = await request(app).get('/api/admin/audit-logs/export').set('Authorization', bearer(i));
      expect(exported.status).toBe(200);
      expect(exported.text).toContain(owners[i]); expect(exported.text).not.toContain(owners[1 - i]); expect(exported.text).not.toContain('platform.settings.update');
    }
  });

  it('platform admin who entered a company sees and manages only that company', async () => {
    const entered = 'Bearer ' + auth.signToken({ userId: platform, roles: [], permissions: [], departmentIds: [], companyId: companies[1],
      platformCompany: { companyId: companies[1], companyName: 'Iso 1', startedAt: new Date().toISOString() } } as any);
    const list = await request(app).get('/api/admin/audit-logs?limit=200').set('Authorization', entered);
    expect(list.status).toBe(200);
    expect(list.body.logs.length).toBeGreaterThan(0);
    expect(list.body.logs.every((row: any) => row.companyId === companies[1])).toBe(true);
    const authorities = await request(app).get('/api/admin/order-approval-authorities').set('Authorization', entered);
    expect(authorities.status).toBe(200);
    expect(authorities.body.assignments.map((a: any) => a.userId)).toEqual([members[1]]);
    expect(authorities.body.users.map((u: any) => u.id)).not.toContain(members[0]);
    expect((await request(app).put('/api/admin/order-approval-authorities/garment').set('Authorization', entered).send({ userIds: [members[0]] })).status).toBe(400);
    const saved = await request(app).put('/api/admin/order-approval-authorities/garment').set('Authorization', entered).send({ userIds: [owners[1]] });
    expect(saved.status).toBe(200);
    expect((await db.orderApprovalAuthority.findFirstOrThrow({ where: { userId: owners[1], businessLine: 'garment' } })).companyId).toBe(companies[1]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: platform, action: 'replace_order_approval_authorities' } });
    expect(audit.companyId).toBe(companies[1]);
  });

  it('a no-company session keeps the global audit view', async () => {
    const r = await request(legacyApp).get('/api/admin/audit-logs?limit=200&actorId=' + legacy).set('Authorization', bearer(null));
    expect(r.status).toBe(200); expect(r.body.logs.some((row: any) => row.id === 'iso-platform-' + key)).toBe(true);
  });

  it('authority list shows only own assignments and own members; cross-company assignment is rejected', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await request(app).get('/api/admin/order-approval-authorities').set('Authorization', bearer(i));
      expect(r.status).toBe(200);
      expect(r.body.assignments.filter((a: any) => a.businessLine === 'fabric').map((a: any) => a.userId)).toEqual([members[i]]);
      expect(r.body.assignments.every((a: any) => [owners[i], members[i]].includes(a.userId))).toBe(true);
      const ids = r.body.users.map((u: any) => u.id);
      expect(ids).toEqual(expect.arrayContaining([owners[i], members[i]])); expect(ids).not.toContain(members[1 - i]); expect(ids).not.toContain(legacy);
      expect(r.body.users.find((u: any) => u.id === owners[i]).isOwner).toBe(true);
    }
    const foreign = await request(app).put('/api/admin/order-approval-authorities/fabric').set('Authorization', bearer(0)).send({ userIds: [members[1]] });
    expect(foreign.status).toBe(400);
    expect((await db.orderApprovalAuthority.findMany({ where: { companyId: companies[1], businessLine: 'fabric', active: true } })).map(r => r.userId)).toEqual([members[1]]);
    expect((await db.orderApprovalAuthority.findMany({ where: { companyId: companies[0], businessLine: 'fabric', active: true } })).map(r => r.userId)).toEqual([members[0]]);
  });

  it('resolve uses only the company assignments and owners', async () => {
    const service = createOrderMainApprovalService(db);
    for (let i = 0; i < 2; i++) expect(await service.resolveEligibleReviewerIds(db, 'fabric', companies[i])).toEqual([members[i], owners[i]].sort());
    await expect(service.resolveEligibleReviewerIds(db, 'garment', companies[0])).rejects.toMatchObject({ code: 'ORDER_APPROVAL_AUTHORITY_MISSING' });
  });

  it('unscoped (NULL company) rows stay unique per user and business line; company rows may repeat across companies', async () => {
    await db.orderApprovalAuthority.create({ data: { userId: legacy, businessLine: 'garment', createdBy: legacy } });
    await expect(db.orderApprovalAuthority.create({ data: { userId: legacy, businessLine: 'garment', createdBy: legacy } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.orderApprovalAuthority.create({ data: { companyId: companies[0], userId: members[0], businessLine: 'fabric', createdBy: legacy } })).rejects.toMatchObject({ code: 'P2002' });
    await db.companyMember.create({ data: { companyId: companies[1], userId: members[0] } });
    await db.orderApprovalAuthority.create({ data: { companyId: companies[1], userId: members[0], businessLine: 'fabric', createdBy: legacy, active: false } });
    const r = await request(legacyApp).put('/api/admin/order-approval-authorities/garment').set('Authorization', bearer(null)).send({ userIds: [legacy] });
    expect(r.status).toBe(200);
    expect(await db.orderApprovalAuthority.count({ where: { userId: legacy, businessLine: 'garment', companyId: null } })).toBe(1);
  });
});

const bindir = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout?.trim();
const psql = bindir && path.join(bindir, 'psql');
describe.skipIf(!url || !psql || !existsSync(psql))('company-scoped audit/authority migration backfill', () => {
  it('backfills only unambiguous ownership, is re-runnable and keeps every row', () => {
    const connection = new URL(url!);
    if (!local(url!)) throw Error('A dedicated local acceptance database is required');
    const schema = 'audit_authority_migration_' + randomUUID().replaceAll('-', '');
    const a = randomUUID(), b = randomUUID();
    const env = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGDATABASE: connection.pathname.slice(1), PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password) };
    const ok = (sql: string) => { const r = spawnSync(psql!, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env, input: `SET search_path TO "${schema}";\n` + sql, encoding: 'utf8' }); if (r.status !== 0) throw Error(r.stderr.slice(-1500)); return r.stdout.trim(); };
    const migration = readFileSync(path.resolve(__dirname, '../..', 'prisma/migrations/20261105120000_company_scoped_audit_and_authority/migration.sql'), 'utf8');
    try {
      ok(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
        CREATE TABLE "Company" (id UUID PRIMARY KEY);
        CREATE TABLE "CompanyMember" ("userId" TEXT, "companyId" UUID, status TEXT DEFAULT 'active');
        CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY, "actorId" TEXT, "targetType" TEXT, "targetId" TEXT, detail JSONB, "createdAt" TIMESTAMP DEFAULT now());
        CREATE TABLE "OrderApprovalAuthority" (id TEXT PRIMARY KEY, "userId" TEXT, "businessLine" TEXT, active BOOLEAN DEFAULT true);
        CREATE UNIQUE INDEX "OrderApprovalAuthority_userId_businessLine_key" ON "OrderApprovalAuthority"("userId","businessLine");
        CREATE TABLE "SystemConfig" (id TEXT PRIMARY KEY, scope TEXT, key TEXT, "group" TEXT, label TEXT, "valueType" TEXT, value JSONB, encrypted BOOLEAN, version INT, "updatedBy" TEXT, "auditReason" TEXT, "createdAt" TIMESTAMP, "updatedAt" BIGINT, UNIQUE(scope, key));
        INSERT INTO "Company" VALUES ('${a}'), ('${b}');
        INSERT INTO "CompanyMember" VALUES ('one','${a}','active'),('shared','${a}','active'),('shared','${b}','active'),('left','${a}','left'),('left','${b}','active'),('two','${b}','active');
        INSERT INTO "AuditLog" (id,"actorId","targetType","targetId",detail) VALUES
          ('detail','shared',NULL,NULL,'{"companyId":"${b}"}'),('target','platform','Company','${a}',NULL),('single','one',NULL,NULL,NULL),
          ('ambiguous','shared',NULL,NULL,NULL),('nomember','nobody',NULL,NULL,NULL),('leftmember','left',NULL,NULL,NULL),('baddetail','nobody',NULL,NULL,'{"companyId":"x"}');
        INSERT INTO "OrderApprovalAuthority" VALUES ('r1','one','fabric',true),('r2','shared','fabric',true),('r3','nobody','garment',true);
        INSERT INTO "SystemConfig" VALUES ('global::supplierCommitment.approvers.purchase.fabric','global','supplierCommitment.approvers.purchase.fabric','rbac','x','json','{"schemaVersion":1,"userIds":["one"]}',false,3,'u','r',now(),0),
          ('global::supplierCommitment.approvers.purchase.garment','global','supplierCommitment.approvers.purchase.garment','rbac','x','json','{"schemaVersion":1,"userIds":["one","two"]}',false,1,'u','r',now(),0),
          ('global::supplierCommitment.approvers.processing.fabric','global','supplierCommitment.approvers.processing.fabric','rbac','x','json',to_jsonb('{"schemaVersion":1,"userIds":["one"]}'::text),false,2,'u','r',now(),0),
          ('global::supplierCommitment.approvers.processing.garment','global','supplierCommitment.approvers.processing.garment','rbac','x','json',to_jsonb('{bad'::text),false,1,'u','r',now(),0),
          ('global::supplierCommitment.approvers.mixed.fabric','global','supplierCommitment.approvers.mixed.fabric','rbac','x','json','{"schemaVersion":1,"userIds":["two","one","nobody"]}',false,5,'u','r',now(),0),
          ('global::supplierCommitment.approvers.legacy.fabric','global','supplierCommitment.approvers.legacy.fabric','rbac','x','json','{"userIds":["one"]}',false,1,'u','r',now(),0);`);
      ok(migration); ok(migration);
      const audit = Object.fromEntries(ok('SELECT id || \'=\' || coalesce("companyId"::text, \'\') FROM "AuditLog" ORDER BY id').split('\n').map(line => line.split('=')));
      // 'left' 曾在 A、现在 B：其历史审计不能归给 B（可能是 A 的业务），保持 NULL。
      expect(audit).toEqual({ ambiguous: '', baddetail: '', detail: b, leftmember: '', nomember: '', single: a, target: a });
      expect(ok('SELECT string_agg(id || \'=\' || coalesce("companyId"::text, \'\'), \',\' ORDER BY id) FROM "OrderApprovalAuthority"')).toBe(`r1=${a},r2=,r3=`);
      // 两家公司 id 随机生成，排序先后不固定 ⇒ 按集合比对。
      expect(ok('SELECT string_agg(id || \':\' || version, \',\' ORDER BY id) FROM "SystemConfig"').split(',').sort())
        .toEqual([`company:${a}::supplierCommitment.approvers.mixed.fabric:5`, `company:${a}::supplierCommitment.approvers.processing.fabric:2`, `company:${a}::supplierCommitment.approvers.purchase.fabric:3`, `company:${a}::supplierCommitment.approvers.purchase.garment:1`,
          `company:${b}::supplierCommitment.approvers.mixed.fabric:5`, `company:${b}::supplierCommitment.approvers.purchase.garment:1`,
          'global::supplierCommitment.approvers.legacy.fabric:1', 'global::supplierCommitment.approvers.mixed.fabric:5', 'global::supplierCommitment.approvers.processing.fabric:2', 'global::supplierCommitment.approvers.processing.garment:1', 'global::supplierCommitment.approvers.purchase.fabric:3', 'global::supplierCommitment.approvers.purchase.garment:1'].sort());
      // 每家公司只拿到“全局名单 ∩ 本公司在职成员”（one 在 A，two 在 B，nobody 不在任何公司），无效名单不复制。
      const ids = (company: string, key: string) => ok(`SELECT value->>'userIds' FROM "SystemConfig" WHERE id = 'company:${company}::supplierCommitment.approvers.${key}'`);
      expect(ids(a, 'mixed.fabric')).toBe('["one"]');
      expect(ids(b, 'mixed.fabric')).toBe('["two"]');
      expect(ids(a, 'purchase.garment')).toBe('["one"]');
      expect(ids(b, 'purchase.garment')).toBe('["two"]');
      ok(`INSERT INTO "OrderApprovalAuthority" (id,"userId","businessLine","companyId") VALUES ('r4','shared','fabric','${b}')`);
      expect(() => ok(`INSERT INTO "OrderApprovalAuthority" (id,"userId","businessLine") VALUES ('r5','shared','fabric')`)).toThrow(/unscoped_userId_businessLine/);
      expect(ok('SELECT count(*) FROM "AuditLog"')).toBe('7');
    } finally { ok(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  });
});
