import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provisioning = vi.hoisted(() => ({ createCompany: vi.fn() }));
vi.mock('../../platform/companyProvisioning', () => ({ createCompany: provisioning.createCompany }));
vi.mock('../../platform/settings', () => ({ readCompanyDefaults: vi.fn(async () => ({ plan: 'standard', seatLimit: 20 })) }));

import { companyCodeBase, passwordProblem, selfRegistrationRouter } from '../selfRegistration';

const STRONG = 'Bamboo2026secure';
let prisma: any;
let verifyCode: ReturnType<typeof vi.fn>;

function app(requireEmailVerification = true) {
  const a = express();
  a.use(express.json());
  a.use('/auth', selfRegistrationRouter({ prisma, verification: { verifyCode, issueCode: vi.fn() } as any, hashPassword: async p => 'hash:' + p, requireEmailVerification }));
  return a;
}

beforeEach(() => {
  verifyCode = vi.fn(async () => ({ ok: true }));
  provisioning.createCompany.mockReset();
  provisioning.createCompany.mockImplementation(async (_tx: any, input: any) => ({ company: { id: 'co-new', slug: input.slug, name: input.name }, roles: 7 }));
  prisma = {
    userAccount: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => data) },
    company: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), update: vi.fn(async ({ data }: any) => data) },
    companyMember: { create: vi.fn(async ({ data }: any) => data) },
    userRole: { create: vi.fn(async ({ data }: any) => data) },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
});

const company = { companyName: '雾织贸易', displayName: '沈霁', email: 'Owner@Example.test', password: STRONG, code: '123456' };
const join = { companyCode: 'wuzhimaoyi', displayName: '林澈', email: 'staff@example.test', password: STRONG, code: '123456' };

describe('self-service company registration', () => {
  it('creates the company administrator without implicitly assigning a general-manager role', async () => {
    const res = await request(app()).post('/auth/register/company').send(company);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, company: { name: '雾织贸易', code: 'wuzhimaoyi' }, email: 'owner@example.test' });
    expect(verifyCode).toHaveBeenCalledWith('owner@example.test', '123456', 'register');
    const user = prisma.userAccount.create.mock.calls[0][0].data;
    expect(user).toMatchObject({ displayName: '沈霁', email: 'owner@example.test', passwordHash: 'hash:' + STRONG, status: 'active' });
    expect(provisioning.createCompany.mock.calls[0][1]).toMatchObject({ slug: 'wuzhimaoyi', name: '雾织贸易', plan: 'standard', seatLimit: 20, ownerUserId: user.id });
    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'platform.company.self_register', targetId: 'co-new' });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(STRONG);
  });

  it('adds a suffix when the generated company code is already taken', async () => {
    prisma.company.findUnique.mockImplementation(async ({ where }: any) => where.slug === 'wuzhimaoyi' ? { id: 'existing' } : null);
    const res = await request(app()).post('/auth/register/company').send(company);
    expect(res.status).toBe(201);
    expect(res.body.company.code).toMatch(/^wuzhimaoyi-[0-9a-f]{4}$/);
  });

  it.each([
    [{ ...company, companyName: '雾' }, '公司名称'],
    [{ ...company, displayName: '' }, '姓名'],
    [{ ...company, email: 'not-an-email' }, '邮箱格式'],
    [{ ...company, password: 'short1' }, '至少 8 个字符'],
    [{ ...company, password: 'onlyletterspassword' }, '字母和数字'],
    [{ ...company, code: '' }, '验证码'],
  ])('rejects invalid input %#', async (body, message) => {
    const res = await request(app()).post('/auth/register/company').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(message);
    expect(prisma.userAccount.create).not.toHaveBeenCalled();
  });

  it('refuses a wrong email code and an email that is already registered', async () => {
    verifyCode.mockResolvedValueOnce({ ok: false, error: 'INVALID_CODE', message: '验证码错误' });
    expect((await request(app()).post('/auth/register/company').send(company)).body.error).toBe('INVALID_CODE');
    prisma.userAccount.findFirst.mockResolvedValueOnce({ id: 'someone' });
    const dup = await request(app()).post('/auth/register/company').send(company);
    expect(dup.status).toBe(409);
    expect(prisma.userAccount.create).not.toHaveBeenCalled();
  });
});

describe('joining an existing company', () => {
  it('creates a pending account and a pending membership for the company admin to approve', async () => {
    prisma.company.findUnique.mockResolvedValue({ id: 'co-1', name: '雾织贸易', status: 'active' });
    const res = await request(app()).post('/auth/register/join').send({ ...join, companyCode: ' WuZhiMaoYi ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, company: { name: '雾织贸易' }, email: 'staff@example.test' });
    expect(prisma.company.findUnique.mock.calls[0][0].where).toEqual({ slug: 'wuzhimaoyi' });
    const user = prisma.userAccount.create.mock.calls[0][0].data;
    expect(user).toMatchObject({ status: 'pending', email: 'staff@example.test' });
    expect(prisma.companyMember.create.mock.calls[0][0].data).toMatchObject({ companyId: 'co-1', userId: user.id, status: 'pending' });
    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('company.member.join_request');
  });

  it.each([[null, 'unknown code'], [{ id: 'co-2', name: '停用公司', status: 'suspended' }, 'suspended company']])('refuses %s (%s)', async found => {
    prisma.company.findUnique.mockResolvedValue(found);
    const res = await request(app()).post('/auth/register/join').send(join);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('COMPANY_NOT_FOUND');
    expect(prisma.userAccount.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed company code before looking anything up', async () => {
    const res = await request(app()).post('/auth/register/join').send({ ...join, companyCode: 'x' });
    expect(res.status).toBe(400);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('derives company codes from Chinese and English names', () => {
    expect(companyCodeBase('雾织贸易')).toBe('wuzhimaoyi');
    expect(companyCodeBase('Mistweave Textile')).toBe('mistweavetextile');
    expect(companyCodeBase('雾')).toBe('company');
  });
  it('uses the same password rule as account invitations', () => {
    expect(passwordProblem(STRONG)).toBeNull();
    expect(passwordProblem('a'.repeat(80) + '1')).toContain('72');
  });
});

describe('company search and the redesigned flow', () => {
  it('suppresses shared prefixes and suffixes, but returns a unique complete name', async () => {
    const rows = [{ id: 'co-1', name: '雾织贸易', status: 'active', settings: { registration: { business: 'both' } } }, { id: 'co-2', name: '雾织纺织', status: 'active', settings: null }, { id: 'co-3', name: '雾织贸易', status: 'closed', settings: null }];
    prisma.company.findMany.mockImplementation(async ({ where, take }: any) => rows.filter(row => row.status === where.status && (where.name.equals !== undefined ? row.name.toLowerCase() === where.name.equals.toLowerCase() : row.name.toLowerCase().startsWith(where.name.startsWith.toLowerCase()))).slice(0, take));
    const server = app();
    for (const q of ['雾织', '贸易', '雾织%', '雾织 贸易']) expect((await request(server).get('/auth/register/companies').query({ q })).body.companies).toEqual([]);
    const res = await request(server).get('/auth/register/companies').query({ q: ' 雾织贸易 ' });
    expect(res.body).toEqual({ ok: true, companies: [{ id: 'co-1', name: '雾织贸易', business: 'both' }] });
    expect(prisma.company.findMany.mock.calls.at(-1)[0]).toMatchObject({ where: { status: 'active', name: { equals: '雾织贸易', mode: 'insensitive' } }, take: 2 });
  });

  it('does not search with fewer than two characters', async () => {
    const res = await request(app()).get('/auth/register/companies').query({ q: '雾' });
    expect(res.body.companies).toEqual([]);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it('does not let pattern operators broaden the database lookup', async () => {
    const res = await request(app()).get('/auth/register/companies').query({ q: 'MIST_%' });
    expect(res.body.companies).toEqual([]);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it('returns one sufficiently specific prefix without requiring the whole name', async () => {
    prisma.company.findMany.mockImplementation(async ({ where }: any) => where.name.equals ? [] : [{ id: 'co-1', name: '雾织贸易', settings: null }]);
    const res = await request(app()).get('/auth/register/companies').query({ q: '雾织' });
    expect(res.body.companies).toEqual([{ id: 'co-1', name: '雾织贸易', business: null }]);
    expect(prisma.company.findMany.mock.calls[1][0]).toMatchObject({ where: { status: 'active', name: { startsWith: '雾织', mode: 'insensitive' } }, take: 2 });
  });

  it('does not truncate an overlong query into another company name', async () => {
    const res = await request(app()).get('/auth/register/companies').query({ q: '司'.repeat(61) });
    expect(res.body.companies).toEqual([]);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it('limits how often one address can search', async () => {
    const server = app();
    for (let i = 0; i < 30; i++) expect((await request(server).get('/auth/register/companies').query({ q: '雾织' })).status).toBe(200);
    const blocked = await request(server).get('/auth/register/companies').query({ q: '雾织' });
    expect(blocked.status).toBe(429);
  });

  it('joins the company picked from search by its id', async () => {
    prisma.company.findUnique.mockResolvedValue({ id: '0e9f6b1c-1d2e-4f3a-8b4c-5d6e7f809a1b', name: '雾织贸易', status: 'active' });
    const res = await request(app()).post('/auth/register/join').send({ companyId: '0e9f6b1c-1d2e-4f3a-8b4c-5d6e7f809a1b', displayName: '林澈', email: 'staff@example.test', password: STRONG, code: '123456' });
    expect(res.status).toBe(201);
    expect(prisma.company.findUnique.mock.calls[0][0].where).toEqual({ id: '0e9f6b1c-1d2e-4f3a-8b4c-5d6e7f809a1b' });
    expect(prisma.companyMember.create.mock.calls[0][0].data.status).toBe('pending');
  });

  it('rejects a malformed company id without looking it up', async () => {
    const res = await request(app()).post('/auth/register/join').send({ companyId: 'not-a-uuid', displayName: '林澈', email: 'staff@example.test', password: STRONG, code: '123456' });
    expect(res.status).toBe(400);
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
  });

  it('saves main business and size with the new company', async () => {
    const res = await request(app()).post('/auth/register/company').send({ ...company, business: 'both', size: '21-100' });
    expect(res.status).toBe(201);
    expect(prisma.company.update.mock.calls[0][0]).toEqual({ where: { id: 'co-new' }, data: { settings: { registration: { business: 'both', size: '21-100' } } } });
  });

  it.each([[{ business: 'shoes' }, '主营业务'], [{ size: 'huge' }, '公司规模']])('rejects unknown company details %#', async (extra, message) => {
    const res = await request(app()).post('/auth/register/company').send({ ...company, ...extra });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(message);
  });
});
