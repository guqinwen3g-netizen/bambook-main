import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createHRRouter } from './route';
import { createCompanyEmploymentService } from './companyEmploymentService';
import { setCompanyAccountAccess } from '../admin/companyAccountLifecycle';
import { createAuthService } from '../auth/service';
import { createAuthorizationSnapshotGuard } from '../auth/authorizationSnapshotGuard';
import { tenantSurfaceGuard } from '../auth/tenantSurfaceGuard';

const url = process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('company employment lifecycle on PostgreSQL', () => {
  const a = randomUUID(), b = randomUUID(), key = randomUUID();
  const owner = 'hr-owner-' + key, shared = 'hr-shared-' + key, reader = 'hr-reader-' + key, newHire = 'hr-new-' + key;
  const d1 = 'hr-d1-' + key, d2 = 'hr-d2-' + key, dbDept = 'hr-db-' + key;
  const rootA = 'hr-root-a-' + key, rootB = 'hr-root-b-' + key;
  const p1 = 'hr-p1-' + key, p2 = 'hr-p2-' + key, pb = 'hr-pb-' + key;
  const ta = 'hr-ta-' + key, tb = 'hr-tb-' + key;
  let db: PrismaClient, app: express.Express;
  const tokens: Record<string, string> = {};
  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    for (const companyId of [a, b]) await db.company.create({ data: { id: companyId, slug: companyId, name: companyId } });
    for (const id of [owner, shared, reader, newHire]) await db.userAccount.create({ data: { id, displayName: id, email: id + '@example.invalid', passwordHash: 'unused-test-hash', status: 'active' } });
    for (const [id, companyId] of [[rootA, a], [rootB, b]]) await db.department.create({ data: { id, companyId, name: id } });
    for (const [id, companyId] of [[d1, a], [d2, a], [dbDept, b]]) await db.department.create({ data: { id, companyId, name: id, parentId: companyId === a ? rootA : rootB, status: 'active' } });
    for (const [id, departmentId] of [[p1, d1], [p2, d2], [pb, dbDept]]) await db.jobPosition.create({ data: { id, departmentId, title: id } });
    for (const companyId of [a, b]) {
      const roleId = 'role-super-admin@' + companyId;
      await db.role.create({ data: { id: roleId, companyId, code: 'role-super-admin', name: '总经理', isSystem: true } });
      const members = companyId === a ? [owner, shared, reader, newHire] : [owner, shared];
      for (const userId of members) {
        await db.companyMember.create({ data: { id: randomUUID(), companyId, userId, status: 'active' } });
        const memberRole = userId === owner ? roleId : 'role-sales@' + companyId;
        if (userId !== owner) await db.role.upsert({ where: { id: memberRole }, update: {}, create: { id: memberRole, companyId, code: 'role-sales', name: '业务员', isSystem: true } });
        await db.userRole.create({ data: { id: randomUUID(), userId, roleId: memberRole, departmentId: companyId === a ? d1 : dbDept } });
      }
      tokens[companyId] = createAuthService().signToken({ userId: owner, companyId, roles: ['owner'], permissions: ['*'], departmentIds: [] });
    }
    await db.role.create({ data: { id: 'hr-reader-role-' + key, companyId: a, name: '人事查看', isSystem: false } });
    const permission = await db.permission.upsert({ where: { scope: 'hr:read' }, update: {}, create: { id: randomUUID(), scope: 'hr:read' } });
    await db.rolePermission.create({ data: { id: randomUUID(), roleId: 'hr-reader-role-' + key, permissionId: permission.id } });
    await db.userRole.deleteMany({ where: { userId: reader } });
    await db.userRole.create({ data: { id: randomUUID(), userId: reader, roleId: 'hr-reader-role-' + key, departmentId: d1 } });
    tokens.reader = createAuthService().signToken({ userId: reader, companyId: a, roles: [], permissions: ['hr:read'], departmentIds: [d1] });
    for (const [id, departmentId] of [[ta, d1], [tb, dbDept]]) {
      await db.team.create({ data: { id, departmentId, name: id, leaderId: shared } });
      await db.teamMember.create({ data: { id: randomUUID(), teamId: id, userId: shared } });
    }
    app = express(); app.use(express.json()); app.use(cookieParser());
    app.use('/api', createAuthorizationSnapshotGuard({ prisma: db }), tenantSurfaceGuard);
    app.use('/api/hr', createHRRouter({ prisma: db }));
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { actorId: owner } });
    await db.team.deleteMany({ where: { id: { in: [ta, tb] } } });
    await db.employeeProfile.deleteMany({ where: { companyId: { in: [a, b] } } });
    await db.employmentEvent.deleteMany({ where: { companyId: { in: [a, b] } } });
    await db.userRole.deleteMany({ where: { userId: { in: [owner, shared, reader, newHire] } } });
    await db.role.deleteMany({ where: { companyId: { in: [a, b] } } });
    await db.jobPosition.deleteMany({ where: { id: { in: [p1, p2, pb] } } });
    await db.department.deleteMany({ where: { id: { in: [d1, d2, dbDept, rootA, rootB] } } });
    await db.company.deleteMany({ where: { id: { in: [a, b] } } });
    await db.userAccount.deleteMany({ where: { id: { in: [owner, shared, reader, newHire] } } });
    await db.$disconnect();
  });
  const call = (method: 'get' | 'put' | 'post', path: string, company = a) =>
    request(app)[method]('/api/hr' + path).set('Authorization', 'Bearer ' + tokens[company]);
  const change = (type: string, extra = {}) => call('post', '/employment-events').send({ userId: shared, type, effectiveDate: '2026-10-26', ...extra });

  it('returns only the current company team and active company roster for its own member', async () => {
    for (const userId of [owner, reader, newHire]) await db.teamMember.create({data:{id:randomUUID(),teamId:ta,userId}});
    await db.userAccount.update({where:{id:reader},data:{status:'disabled'}});
    await db.companyMember.updateMany({where:{companyId:a,userId:newHire},data:{status:'left'}});
    try {
      const token = (companyId: string) => createAuthService().signToken({userId:shared,companyId,roles:[],permissions:[],departmentIds:[]});
      const result = await request(app).get('/api/hr/teams/mine').set('Authorization', 'Bearer ' + token(a));
      expect(result.status).toBe(200);
      expect(result.body.teams.map((team: any) => team.id)).toEqual([ta]);
      expect(result.body.teams[0].members.map((member: any) => member.id).sort()).toEqual([owner,shared].sort());
      const other = await request(app).get('/api/hr/teams/mine').set('Authorization', 'Bearer ' + token(b));
      expect(other.body.teams.map((team: any) => team.id)).toEqual([tb]);
      expect(other.body.teams[0].members.map((member: any) => member.id)).toEqual([shared]);
    } finally {
      await db.userAccount.update({where:{id:reader},data:{status:'active'}});
      await db.companyMember.updateMany({where:{companyId:a,userId:newHire},data:{status:'active'}});
      await db.teamMember.deleteMany({where:{teamId:ta,userId:{in:[owner,reader,newHire]}}});
    }
  });

  it('supports multi-group company collaboration across departments without cross-company access', async () => {
    const second = 'hr-extra-' + key;
    await db.team.create({data:{id:second,departmentId:d2,name:'Second group'}});
    await db.userRole.updateMany({where:{userId:newHire,role:{companyId:a}},data:{departmentId:d2}});
    const before = await db.userRole.findMany({where:{userId:newHire}});
    try {
      const first = await call('post','/teams/'+ta+'/members').send({userId:newHire});
      expect(first.status).toBe(200);
      expect((await call('post','/teams/'+second+'/members').send({userId:newHire})).status).toBe(200);
      expect((await call('post','/teams/'+ta+'/members').send({userId:newHire})).body.member.id).toBe(first.body.member.id);
      expect((await call('post','/teams/'+tb+'/members').send({userId:newHire})).status).toBeGreaterThanOrEqual(400);
      expect((await call('post','/teams/'+tb+'/members',b).send({userId:newHire})).status).toBeGreaterThanOrEqual(400);
      expect(await db.teamMember.count({where:{userId:newHire,leftAt:null}})).toBe(2);
      expect(await db.userRole.findMany({where:{userId:newHire}})).toEqual(before);
    } finally {
      await db.teamMember.deleteMany({where:{userId:newHire,teamId:{in:[ta,second]}}});
      await db.team.delete({where:{id:second}});
      await db.userRole.updateMany({where:{userId:newHire,role:{companyId:a}},data:{departmentId:d1}});
    }
  });

  it('creates the profile and onboarding record atomically, and retrying does not duplicate onboarding', async () => {
    const body = { hireDate: '2026-10-26' };
    expect((await call('put', '/employees/' + shared).send(body)).status).toBe(200);
    expect((await call('put', '/employees/' + shared).send(body)).status).toBe(200);
    expect(await db.employmentEvent.count({ where: { companyId: a, userId: shared, type: 'Onboard' } })).toBe(1);
    expect((await call('get', '/employees/' + shared)).body.profile).toMatchObject({ positionId: 'role-sales@' + a, position: '业务员', departmentId: d1, employmentStatus: 'Probation' });
  });
  it('gives a shared login separate employment records in its two companies', async () => {
    expect((await call('put', '/employees/' + shared, b).send({ hireDate: '2026-10-25', regularDate: '2026-10-26' })).status).toBe(200);
    expect(await db.employeeProfile.count({ where: { userId: shared } })).toBe(2);
    expect((await call('get', '/employees/' + shared, b)).body.profile).toMatchObject({ positionId: 'role-sales@' + b, employmentStatus: 'Regular' });
    expect((await call('get', '/employment-events')).body.events.every((e: any) => e.companyId === a)).toBe(true);
  });
  it('rejects a 岗位 change outside 调岗 and invalid dates without leaving a partial profile', async () => {
    expect((await call('put', '/employees/' + newHire).send({ hireDate: '2026-02-30' })).status).toBe(400);
    expect((await call('put', '/employees/' + newHire).send({ hireDate: '2999-01-01' })).status).toBe(400);
    expect((await call('put', '/employees/' + newHire).send({ hireDate: '2026-10-26', positionId: 'role-sales@' + b })).status).toBe(409);
    expect(await db.employeeProfile.count({ where: { companyId: a, userId: newHire } })).toBe(0);
    expect(await db.employmentEvent.count({ where: { companyId: a, userId: newHire } })).toBe(0);
  });
  it('moves only this company 岗位, department and team membership', async () => {
    const documents = 'hr-doc-role-' + key;
    await db.role.create({ data: { id: documents, companyId: a, name: '单证报关', isSystem: false } });
    expect((await change('Transfer', { toRoleId: documents, toDeptId: d2, fromDeptId: d1, fromPositionId: 'role-sales@' + a })).status).toBe(200);
    const assignments = await db.userRole.findMany({ where: { userId: shared }, include: { role: true } });
    expect(assignments.filter(r => r.role.companyId === a).map(r => [r.roleId, r.departmentId])).toEqual([[documents, d2]]);
    expect((await db.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: a, userId: shared } } })).jobTitle).toBe('单证报关');
    expect(await db.employmentEvent.findFirst({ where: { companyId: a, userId: shared, type: 'Transfer' } })).toMatchObject({ fromPositionId: 'role-sales@' + a, toPositionId: documents });
    await expect(createCompanyEmploymentService(db, a, owner, { canAssignJobs: false }).recordEmploymentEvent(owner, { userId: shared, type: 'Promote', effectiveDate: '2026-10-26', toRoleId: 'role-sales@' + a })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assignments.find(r => r.role.companyId === b)?.departmentId).toBe(dbDept);
    expect((await db.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: ta, userId: shared } } })).leftAt).not.toBeNull();
    expect((await db.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: tb, userId: shared } } })).leftAt).toBeNull();
    expect((await db.team.findUniqueOrThrow({ where: { id: ta } })).leaderId).toBeNull();
    expect((await db.team.findUniqueOrThrow({ where: { id: tb } })).leaderId).toBe(shared);
    expect((await call('get', '/employees/' + shared, b)).body.profile.positionId).toBe('role-sales@' + b);
  });
  it('suspends this company access and restores the prior probation state', async () => {
    expect((await change('Suspend')).status).toBe(200);
    expect((await db.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: a, userId: shared } } })).status).toBe('suspended');
    expect((await change('Resume')).status).toBe(200);
    expect((await call('get', '/employees/' + shared)).body.profile.employmentStatus).toBe('Probation');
  });
  it('offboards and rehires without changing the shared identity or other company', async () => {
    expect((await change('Resign')).status).toBe(200);
    expect((await db.userAccount.findUniqueOrThrow({ where: { id: shared } })).status).toBe('active');
    expect((await db.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: b, userId: shared } } })).status).toBe('active');
    await expect(setCompanyAccountAccess(db, { companyId: a, userId: shared, actorId: owner, enabled: true })).rejects.toMatchObject({ code: 'EMPLOYMENT_RESTORATION_REQUIRED' });
    expect((await change('Onboard')).status).toBe(200);
    expect((await call('get', '/employees/' + shared)).body.profile.employmentStatus).toBe('Probation');
  });
  it('keeps read-only HR viewers out of writes and other companies', async () => {
    const ro = (method: 'get' | 'put', path: string) => request(app)[method]('/api/hr' + path).set('Authorization', 'Bearer ' + tokens.reader);
    expect((await ro('get', '/employees/' + shared)).status).toBe(200);
    expect((await ro('put', '/employees/' + shared).send({ phone: 'test' })).status).toBe(403);
    expect((await call('get', '/employees/' + newHire, b)).status).toBe(404);
  });
  it('retires a department with its positions and current-company role assignments', async () => {
    expect((await call('post', '/departments/' + d2 + '/retire').send({ targetDepartmentId: d1 })).status).toBe(200);
    expect((await db.userRole.findFirstOrThrow({ where: { userId: shared, role: { companyId: a } } })).departmentId).toBe(d1);
    expect((await db.jobPosition.findUniqueOrThrow({ where: { id: p2 } })).departmentId).toBe(d1);
    expect((await db.userRole.findFirstOrThrow({ where: { userId: shared, role: { companyId: b } } })).departmentId).toBe(dbDept);
  });
  it('uses the current company department when adding an account to a team', async () => {
    expect((await call('post', '/teams/' + ta + '/members').send({ userId: newHire })).status).toBe(200);
    expect((await call('post', '/teams/' + ta + '/members').send({ userId: shared })).status).toBe(200);
    expect((await db.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: tb, userId: shared } } })).leftAt).toBeNull();
  });
  it('rolls back a new profile and event if audit persistence fails', async () => {
    const failing = new Proxy(db, { get(target, name) {
      if (name === '$transaction') return (fn: any) => target.$transaction(tx => fn(new Proxy(tx, { get(t, n) { return n === 'auditLog' ? { create: async () => { throw Error('audit unavailable'); } } : Reflect.get(t, n); } })));
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(createCompanyEmploymentService(failing, a, owner).upsertProfile({ userId: newHire, hireDate: '2026-10-26' })).rejects.toThrow('audit unavailable');
    expect(await db.employeeProfile.count({ where: { companyId: a, userId: newHire } })).toBe(0);
    expect(await db.employmentEvent.count({ where: { companyId: a, userId: newHire } })).toBe(0);
  });
});
