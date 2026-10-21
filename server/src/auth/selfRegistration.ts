/**
 * 登录页「立即注册」的两条自助路径（2026-10-21 用户定案）：
 *
 * - POST /register/company：创建公司，同时创建该公司的管理员账号（超级管理员、在用）。
 *   公司按平台「开户默认设置」取方案与席位，写平台操作记录 platform.company.self_register，平台人员可见、可停用。
 * - POST /register/join：凭公司代码申请加入已有公司。账号与公司成员关系均为 pending，
 *   由该公司管理员在「公司后台 › 账号」审批（指定部门与岗位）后才能登录。
 *
 * 两条路径都要求邮箱验证码（与 /send-code 的 register 用途一致）及与邀请设密相同的密码规则。
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

type Options = {
  prisma: PrismaClient;
  verification: VerificationStore;
  hashPassword: (password: string) => Promise<string>;
  requireEmailVerification: boolean;
};

const fail = (res: Response, status: number, error: string, message: string) => res.status(status).json({ ok: false, error, message });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** 与邀请设密一致：至少 12 个字符、含字母和数字、不超过 72 字节。 */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    return '密码须包含字母和数字，至少 12 个字符且不超过 72 字节。';
  return null;
}

/** 公司名 → 公司代码基础：中文取全拼，保留字母数字，最长 24 位；过短时用 company。 */
export function companyCodeBase(name: string): string {
  const latin = pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const base = latin.slice(0, 24);
  return base.length >= 3 ? base : 'company';
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
      const account = await checkAccount(req, res);
      if (!account) return;
      const passwordHash = await options.hashPassword(req.body.password);
      const code = await uniqueCompanyCode(options.prisma, companyName);
      const userId = `usr_${randomUUID()}`;
      const company = await options.prisma.$transaction(async tx => {
        await tx.userAccount.create({ data: { id: userId, displayName: account.displayName, email: account.email, passwordHash, status: 'active', metadata: metadata(req, { selfRegistration: 'company' }) } });
        const defaults = await readCompanyDefaults(tx);
        const created = await createCompany(tx, { slug: code, name: companyName, plan: defaults.plan, seatLimit: defaults.seatLimit, ownerUserId: userId, ownerJobTitle: '管理员' });
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
      const companyCode = text(req.body?.companyCode).toLowerCase();
      if (!SLUG_PATTERN.test(companyCode)) return fail(res, 400, 'INVALID_COMPANY_CODE', '公司代码格式不正确，请向公司管理员核对。');
      const company = await options.prisma.company.findUnique({ where: { slug: companyCode }, select: { id: true, name: true, status: true } });
      if (!company || company.status !== 'active') return fail(res, 404, 'COMPANY_NOT_FOUND', '没有找到这个公司代码，或该公司暂停使用。请向公司管理员核对。');
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
