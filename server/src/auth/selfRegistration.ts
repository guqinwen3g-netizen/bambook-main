/**
 * 登录页「账户开通」的两条自助路径（2026-10-21 用户定案）：
 *
 * - POST /register/company：创建公司，同时创建该公司的管理员账号（超级管理员、在用）。
 *   公司按平台「开户默认设置」取方案与席位，写平台操作记录 platform.company.self_register，平台人员可见、可停用。
 * - GET /register/companies?q=：名称前缀达到长度 / 覆盖门槛且唯一时返回单个公司；全称唯一匹配优先，按 IP 限频。
 * - POST /register/join：选择精确匹配的公司（companyId）或填写公司代码申请加入。账号与公司成员关系均为 pending，
 *   由该公司管理员在「公司后台 › 账号」审批（指定部门与岗位）后才能登录。
 *
 * 两条路径都要求邮箱验证码（与 /send-code 的 register 用途一致）及全站密码规则（passwordPolicy.ts）。
 * 公司代码即 Company.slug，由公司名生成（中文取拼音），在公司资料里展示给管理员分享。
 */
import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { pinyin } from 'pinyin-pro';
import { createCompany } from '../platform/companyProvisioning';
import { readCompanyDefaults } from '../platform/settings';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { logger } from '../lib/logger';
import type { VerificationStore } from './verification';
import { passwordProblem } from './passwordPolicy';
import { matchingCompany, validCompanyLookupQuery } from '../shared/companyLookup';
export { passwordProblem };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMPANY_BUSINESS = ['fabric', 'garment', 'both'] as const;
export const COMPANY_SIZE = ['1-20', '21-100', '100+'] as const;
const SEARCH_WINDOW_MS = 60_000, SEARCH_MAX = 30;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

type Options = {
  prisma: PrismaClient;
  verification: VerificationStore;
  hashPassword: (password: string) => Promise<string>;
  requireEmailVerification: boolean;
};

const fail = (res: Response, status: number, error: string, message: string) => res.status(status).json({ ok: false, error, message });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';


/** 公司名 → 公司代码基础：中文取全拼，保留字母数字，最长 24 位；过短时用 company。 */
export function companyCodeBase(name: string): string {
  const latin = pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const base = latin.slice(0, 24);
  return base.length >= 3 ? base : 'company';
}

function businessOf(settings: unknown): string | null {
  const value = (settings as { registration?: { business?: unknown } } | null)?.registration?.business;
  return typeof value === 'string' && (COMPANY_BUSINESS as readonly string[]).includes(value) ? value : null;
}

async function uniqueCompanyCode(prisma: PrismaClient, name: string): Promise<string> {
  const base = companyCodeBase(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex').slice(0, 4)}`;
    if (!SLUG_PATTERN.test(code)) continue;
    if (!(await prisma.company.findUnique({ where: { slug: code }, select: { id: true } }))) return code;
  }
  return `company-${randomBytes(4).toString('hex')}`;
}

export function selfRegistrationRouter(options: Options) {
  const router = Router();
  const searches = new Map<string, number[]>();
  const searchAllowed = (key: string) => {
    const now = Date.now(), recent = (searches.get(key) ?? []).filter(at => now - at < SEARCH_WINDOW_MS);
    if (recent.length >= SEARCH_MAX) { searches.set(key, recent); return false; }
    recent.push(now); searches.set(key, recent);
    if (searches.size > 5000) searches.clear();
    return true;
  };

  router.get('/register/companies', async (req: Request, res: Response) => {
    const q = text(req.query.q);
    if (!validCompanyLookupQuery(q)) return res.json({ ok: true, companies: [] });
    if (!searchAllowed(req.ip || 'unknown')) return fail(res, 429, 'TOO_MANY_REQUESTS', '搜索太频繁，请稍后再试。');
    try {
      const select = { id: true, name: true, settings: true } as const;
      const exact = await options.prisma.company.findMany({ where: { status: 'active', name: { equals: q, mode: 'insensitive' } }, select, take: 2 });
      // Read a second prefix candidate solely to detect ambiguity; never expose a candidate list.
      const rows = exact.length ? exact : await options.prisma.company.findMany({ where: { status: 'active', name: { startsWith: q, mode: 'insensitive' } }, select, take: 2 });
      const matches = matchingCompany(q, rows);
      return res.json({ ok: true, companies: matches.map(row => ({ id: row.id, name: row.name, business: businessOf(row.settings) })) });
    } catch (error) {
      logger.error('[register/companies] failed', { error: error instanceof Error ? error.message : String(error) });
      return fail(res, 500, 'SEARCH_FAILED', '暂时无法搜索公司，请稍后重试。');
    }
  });

  /** 共用校验：姓名、邮箱、密码、验证码、邮箱未被占用。返回规范化邮箱，失败时已写响应。 */
  async function checkAccount(req: Request, res: Response): Promise<{ email: string; displayName: string } | null> {
    const body = req.body || {};
    const displayName = text(body.displayName);
    const email = text(body.email).toLowerCase();
    if (!displayName || displayName.length > 40) { fail(res, 400, 'VALIDATION_FAILED', '请填写姓名（不超过 40 个字）。'); return null; }
    if (!EMAIL_PATTERN.test(email)) { fail(res, 400, 'INVALID_EMAIL', '邮箱格式不正确。'); return null; }
    const weak = passwordProblem(body.password);
    if (weak) { fail(res, 400, 'WEAK_PASSWORD', weak); return null; }
    if (options.requireEmailVerification) {
      if (!text(body.code)) { fail(res, 400, 'MISSING_CODE', '请输入邮箱验证码。'); return null; }
      const verified = await options.verification.verifyCode(email, text(body.code), 'register');
      if (verified.ok === false) { fail(res, 400, verified.error, verified.message); return null; }
    }
    const existing = await options.prisma.userAccount.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
    if (existing) { fail(res, 409, 'DUPLICATE', '该邮箱已注册或正在审批中，请直接登录或找回密码。'); return null; }
    return { email, displayName };
  }

  const metadata = (req: Request, extra: Record<string, unknown>) => ({ emailVerified: options.requireEmailVerification, registeredAt: new Date().toISOString(), registeredIp: req.ip || null, ...extra });

  router.post('/register/company', async (req: Request, res: Response) => {
    try {
      const companyName = text(req.body?.companyName);
      if (companyName.length < 2 || companyName.length > 60) return fail(res, 400, 'VALIDATION_FAILED', '请填写公司名称（2–60 个字）。');
      const business = req.body?.business, size = req.body?.size;
      if (business !== undefined && !COMPANY_BUSINESS.includes(business)) return fail(res, 400, 'VALIDATION_FAILED', '主营业务无效。');
      if (size !== undefined && !COMPANY_SIZE.includes(size)) return fail(res, 400, 'VALIDATION_FAILED', '公司规模无效。');
      const account = await checkAccount(req, res);
      if (!account) return;
      const passwordHash = await options.hashPassword(req.body.password);
      const code = await uniqueCompanyCode(options.prisma, companyName);
      const userId = `usr_${randomUUID()}`;
      const company = await options.prisma.$transaction(async tx => {
        await tx.userAccount.create({ data: { id: userId, displayName: account.displayName, email: account.email, passwordHash, status: 'active', metadata: metadata(req, { selfRegistration: 'company' }) } });
        const defaults = await readCompanyDefaults(tx);
        const created = await createCompany(tx, { slug: code, name: companyName, plan: defaults.plan, seatLimit: defaults.seatLimit, ownerUserId: userId, ownerJobTitle: '管理员' });
        if (business || size) await tx.company.update({ where: { id: created.company.id }, data: { settings: { registration: { ...(business ? { business } : {}), ...(size ? { size } : {}) } } } });
        await tx.userRole.create({ data: { id: `ur_${userId}_${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}`, userId, roleId: `${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}`, departmentId: `dept-company@${created.company.id}` } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorId: userId, action: 'platform.company.self_register', targetType: 'Company', targetId: created.company.id, detail: { name: companyName, code, adminEmail: account.email }, ip: req.ip } });
        return created.company;
      });
      return res.status(201).json({ ok: true, company: { name: company.name, code: company.slug }, email: account.email });
    } catch (error: any) {
      if (error?.code === 'P2002') return fail(res, 409, 'DUPLICATE', '该邮箱或公司刚被注册，请刷新后重试。');
      logger.error('[register/company] failed', { error: error instanceof Error ? error.message : String(error) });
      return fail(res, 500, 'REGISTER_FAILED', '创建公司未完成，请稍后重试。');
    }
  });

  router.post('/register/join', async (req: Request, res: Response) => {
    try {
      const companyId = text(req.body?.companyId), companyCode = text(req.body?.companyCode).toLowerCase();
      if (companyId ? !UUID_PATTERN.test(companyId) : !SLUG_PATTERN.test(companyCode)) return fail(res, 400, 'INVALID_COMPANY_CODE', companyId ? '请重新选择公司。' : '公司代码格式不正确，请向公司管理员核对。');
      const company = await options.prisma.company.findUnique({ where: companyId ? { id: companyId } : { slug: companyCode }, select: { id: true, name: true, status: true } });
      if (!company || company.status !== 'active') return fail(res, 404, 'COMPANY_NOT_FOUND', companyId ? '该公司暂不接受申请，请重新选择。' : '没有找到这个公司代码，请向公司管理员核对。');
      const account = await checkAccount(req, res);
      if (!account) return;
      const passwordHash = await options.hashPassword(req.body.password);
      const userId = `usr_${randomUUID()}`;
      await options.prisma.$transaction(async tx => {
        await tx.userAccount.create({ data: { id: userId, displayName: account.displayName, email: account.email, passwordHash, status: 'pending', metadata: metadata(req, { selfRegistration: 'join', joinCompanyId: company.id }) } });
        await tx.companyMember.create({ data: { id: randomUUID(), companyId: company.id, userId, status: 'pending' } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorId: userId, action: 'company.member.join_request', targetType: 'Company', targetId: company.id, detail: { email: account.email, displayName: account.displayName }, ip: req.ip } });
      });
      return res.status(201).json({ ok: true, company: { name: company.name }, email: account.email });
    } catch (error: any) {
      if (error?.code === 'P2002') return fail(res, 409, 'DUPLICATE', '该邮箱刚被注册，请直接登录或找回密码。');
      logger.error('[register/join] failed', { error: error instanceof Error ? error.message : String(error) });
      return fail(res, 500, 'REGISTER_FAILED', '提交申请未完成，请稍后重试。');
    }
  });

  return router;
}
