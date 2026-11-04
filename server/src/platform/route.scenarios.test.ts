import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPlatformRouter } from './route';
import { createAuthService } from '../auth/service';
import { validateCompanySession } from '../auth/companyAccess';
import { isTokenRevoked } from '../auth/sessionRevocation';

// Pure in-memory REST scenarios: no Prisma client or external mail transport is opened.
const COMPANY = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
function fixture() {
  const companies: any[] = [COMPANY, OTHER].map((id, i) => ({ id, name: `模拟公司${i}`, slug: `company-${i}`, status: 'active', plan: 'standard', seatLimit: 2, settings: { administratorIds: ['owner'] }, createdAt: new Date(0), secretBusinessData: 'private-orders' }));
  const users: any[] = [
    { id: 'platform', platformRole: 'platform_admin', roles: [], companyMembers: [] },
    { id: 'owner', roles: [{ role: { companyId: COMPANY, code: 'role-super-admin', name: '总经理' } }] },
    { id: 'member', roles: [] },
    { id: 'outsider', roles: [] },
  ].map(user => ({ status: 'active', deletedAt: null, platformRole: null, displayName: user.id, email: user.id + '@example.invalid', passwordHash: 'unchanged-password-hash', metadata: {}, ...user }));
  const memberships: any[] = [
    { companyId: COMPANY, userId: 'owner', status: 'active' },
    { companyId: COMPANY, userId: 'member', status: 'active' },
    { companyId: OTHER, userId: 'outsider', status: 'active' },
  ];
  const codes = new Map<string, any>(), messages: any[] = [];
  const db: any = {
    $queryRawUnsafe: vi.fn(async () => []), $executeRaw: vi.fn(async () => 0),
    company: {
      findUnique: vi.fn(async ({ where }: any) => companies.find(row => where.id ? row.id === where.id : row.slug === where.slug) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => { const row = companies.find(row => row.id === where.id); if (!row) throw { code: 'P2025' }; return row; }),
      findMany: vi.fn(async () => companies.map(row => ({ ...row, _count: { members: memberships.filter(m => m.companyId === row.id && m.status === 'active').length, workspaces: 1 } }))),
      update: vi.fn(async ({ where, data }: any) => { const row = companies.find(row => row.id === where.id); if (!row) throw { code: 'P2025' }; return Object.assign(row, data); }),
    },
    userAccount: {
      findFirst: vi.fn(async ({ where }: any) => users.find(row => where.id ? row.id === where.id : row.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null),
      findUnique: vi.fn(async ({ where, include }: any) => { const row = users.find(row => row.id === where.id); return row && include ? { ...row, companyMembers: memberships.filter(m => m.userId === row.id).map(m => ({ ...m, company: companies.find(c => c.id === m.companyId) })) } : row; }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => users.find(row => row.id === where.id)),
      update: vi.fn(async ({ where, data }: any) => Object.assign(users.find(row => row.id === where.id), data)),
    },
    companyMember: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = memberships.find(m => m.companyId === where.companyId && m.userId === where.userId && m.status === where.status);
        const company = companies.find(c => c.id === where.companyId);
        return row && (!where.company || company.status === where.company.status) ? { ...row, company } : null;
      }),
      findUnique: vi.fn(async ({ where }: any) => structuredClone(memberships.find(m => m.companyId === where.companyId_userId.companyId && m.userId === where.companyId_userId.userId) ?? null)),
      count: vi.fn(async ({ where }: any) => memberships.filter(m => m.companyId === where.companyId && m.status === 'active' && (!where.userId?.not || m.userId !== where.userId.not)).length),
      upsert: vi.fn(async ({ where, create, update }: any) => { const row = memberships.find(m => m.companyId === where.companyId_userId.companyId && m.userId === where.companyId_userId.userId); if (row) return Object.assign(row, update); memberships.push(create); return create; }),
      update: vi.fn(async ({ where, data }: any) => { const row = memberships.find(m => m.companyId === where.companyId_userId.companyId && m.userId === where.companyId_userId.userId); if (!row) throw { code: 'P2025' }; return Object.assign(row, data); }),
    },
    userRole: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async ({ data }: any) => data) },
    userVerificationCode: { upsert: vi.fn(async ({ where, create, update }: any) => { const key = where.email_purpose.email; const row = codes.has(key) ? { ...codes.get(key), ...update } : create; codes.set(key, row); return row; }) },
  };
  db.$transaction = vi.fn(async (work: any) => work(db));
  const app = express(); app.use(express.json());
  app.use('/api/platform', createPlatformRouter({ prisma: db, publicUrl: 'https://example.invalid', email: { isReal: true, send: vi.fn(async message => { messages.push(message); }) } as any }));
  const auth = createAuthService();
  const token = (id = 'platform') => auth.signToken({ userId: id, companyId: id === 'platform' ? undefined : COMPANY, roles: [], permissions: ['*'], departmentIds: [] });
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, id = 'platform') => request(app)[method]('/api/platform' + path).set('Authorization', 'Bearer ' + token(id));
  return { db, companies, users, memberships, codes, messages, call, token };
}

describe('platform company REST scenarios without a database', () => {
  it.each([
    ['get', '/companies'], ['post', '/companies'], ['patch', `/companies/${COMPANY}`],
    ['get', `/companies/${COMPANY}/members`], ['post', `/companies/${COMPANY}/members`],
    ['delete', `/companies/${COMPANY}/members/member`], ['post', `/companies/${COMPANY}/invitations/member`],
    ['get', `/companies/${COMPANY}/settings`], ['patch', `/companies/${COMPANY}/settings`],
  ] as const)('rejects company administrators at %s %s before touching tenant data', async (method, path) => {
    const f = fixture();
    expect((await f.call(method, path, 'owner').send({ name: 'Denied', plan: 'team', email: 'member@example.invalid' })).status).toBe(403);
    expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.db.company.findMany).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'mixed'])('rejects a %s platform identity even with a signed token', async mode => {
    const f = fixture(), platform = f.users[0];
    if (mode === 'disabled') platform.status = 'disabled';
    else platform.companyMembers = [{ id: 'customer-membership' }];
    expect((await f.call('get', '/companies')).status).toBe(mode === 'disabled' ? 401 : 403);
    expect(f.db.company.findMany).not.toHaveBeenCalled();
  });

  it('does not remove the final configured company administrator', async () => {
    const f = fixture(); f.db.companyMember.count.mockResolvedValue(0);
    const result = await f.call('delete', `/companies/${COMPANY}/members/owner`);
    expect(result.status).toBe(409); expect(result.body.error).toBe('LAST_OWNER');
    expect(f.db.companyMember.update).not.toHaveBeenCalled();
  });

  it('does not serialize business data or credentials in the company list', async () => {
    const f = fixture(), result = await f.call('get', '/companies');
    expect(result.status).toBe(200); expect(result.body.companies).toHaveLength(2);
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.body.companies[0]).toMatchObject({ members: 2, plan: 'standard', seatLimit: 2 });
    expect(JSON.stringify(result.body)).not.toMatch(/secretBusinessData|private-orders|passwordHash|settings/);
  });

  it('rejects capacity reductions below usage and permits exactly the current usage', async () => {
    const f = fixture();
    expect((await f.call('patch', `/companies/${COMPANY}`).send({ seatLimit: 1 })).body.error).toBe('SEAT_LIMIT_BELOW_USAGE');
    expect(f.db.company.update).not.toHaveBeenCalled();
    expect((await f.call('patch', `/companies/${COMPANY}`).send({ seatLimit: 2 })).status).toBe(200);
  });

  it.each(['', '   ', 'x'.repeat(81), 42, null])('rejects invalid service plans (%j) without changing the company', async plan => {
    const f = fixture(), response = await f.call('patch', `/companies/${COMPANY}`).send({ plan, status: 'suspended' });
    expect(response.status).toBe(400); expect(f.db.company.update).not.toHaveBeenCalled();
    expect(f.companies[0].status).toBe('active');
  });

  it('normalizes a valid service plan before persistence', async () => {
    const f = fixture(), result = await f.call('patch', `/companies/${COMPANY}`).send({ plan: ' team ' });
    expect(result.status).toBe(200); expect(result.body.company.plan).toBe('team');
  });

  it('does not duplicate an existing membership even when all seats are occupied', async () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) expect((await f.call('post', `/companies/${COMPANY}/members`).send({ email: ' MEMBER@EXAMPLE.INVALID ' })).status).toBe(200);
    expect(f.memberships.filter(m => m.companyId === COMPANY)).toHaveLength(2);
    expect((await f.call('post', `/companies/${COMPANY}/members`).send({ email: 'outsider@example.invalid' })).body.error).toBe('SEAT_LIMIT_REACHED');
  });

  it('suspends login/session reload and writes, then restores the existing membership', async () => {
    const f = fixture(), member = f.users.find(u => u.id === 'member');
    for (const status of ['suspended', 'closed']) {
      expect((await f.call('patch', `/companies/${COMPANY}`).send({ status })).status).toBe(200);
      await expect(validateCompanySession(f.db, member, COMPANY)).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' });
      expect((await f.call('post', `/companies/${COMPANY}/members`).send({ email: member.email })).body.error).toBe('COMPANY_UNAVAILABLE');
    }
    expect((await f.call('patch', `/companies/${COMPANY}`).send({ status: 'active' })).status).toBe(200);
    await expect(validateCompanySession(f.db, member, COMPANY)).resolves.toBeUndefined();
  });

  it('removal denies the old company session and rejoining cannot resurrect the old credential', async () => {
    const f = fixture(), member = f.users.find(u => u.id === 'member');
    const prior = createAuthService().verifyToken(f.token('member'));
    expect((await f.call('delete', `/companies/${COMPANY}/members/member`)).status).toBe(200);
    await expect(validateCompanySession(f.db, member, COMPANY)).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' });
    expect((await f.call('post', `/companies/${COMPANY}/members`).send({ email: member.email })).status).toBe(200);
    expect(isTokenRevoked(member.metadata, (prior as any).iat, prior.credentialVersion)).toBe(true);
  });

  it('does not remove or invite a user using another company membership id', async () => {
    const f = fixture();
    expect((await f.call('delete', `/companies/${COMPANY}/members/outsider`)).status).toBe(404);
    expect((await f.call('post', `/companies/${COMPANY}/invitations/outsider`)).status).toBe(404);
    expect(f.memberships.find(m => m.userId === 'outsider')?.status).toBe('active');
    expect(f.messages).toEqual([]); expect(f.db.userAccount.update).not.toHaveBeenCalled();
  });

  it('resends setup invitations without changing passwords or exposing tokens, and invalidates the previous link', async () => {
    const f = fixture(), member = f.users.find(u => u.id === 'member');
    member.metadata = { forceChangePassword: true };
    const first = await f.call('post', `/companies/${COMPANY}/invitations/member`);
    expect(first.status).toBe(200); expect(first.body.invitation.status).toBe('sent');
    const oldHash = f.codes.get(member.email).codeHash;
    member.metadata.accountMailWindow.lastAt = Date.now() - 61000;
    const second = await f.call('post', `/companies/${COMPANY}/invitations/member`);
    expect(second.body.invitation.status).toBe('sent'); expect(f.messages).toHaveLength(2);
    expect(f.codes.get(member.email).codeHash).not.toBe(oldHash);
    expect(member.passwordHash).toBe('unchanged-password-hash');
    const rawToken = new URL(f.messages[1].text.match(/https:\/\/example\.invalid\/\S+/)[0]).hash.slice(1);
    expect(rawToken).toHaveLength(43);
    expect(JSON.stringify([first.body, second.body, f.db.auditLog.create.mock.calls])).not.toContain(rawToken);
    expect(JSON.stringify(second.body)).not.toMatch(/passwordHash|codeHash|credentialVersion/);
  });
});
