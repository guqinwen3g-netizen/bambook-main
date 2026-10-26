import { publicEntryForHost } from '../shared/bambookPublicOrigins';
import { accountAccessRouter } from './accountAccess';
import { CompanyAccessError } from './companyAccess';
import { selfRegistrationRouter } from './selfRegistration';
import { passwordProblem } from './passwordPolicy';
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createAuthService } from './service';
import { AgentRole } from '../agent/types';
import { EmailService, buildVerificationEmail, createEmailService, isDevEmailFallbackAllowed } from './email';
import { VerificationStore, createVerificationStore } from './verification';
import { logger } from '../lib/logger';
import { ROLE_ID_TO_LEGACY_AGENT_ROLE } from './permissionService';
import { buildLoadedAuthTokenPayload, supportActingUser, loadUserWithRoles, serializeAuthUser } from './tokenHelpers';
import { createLoginRateLimiter } from './loginRateLimiter';
import { pickRequestToken } from './middleware';
import { invalidateAccountStatusCache } from './accountStatusGuard';

type AuthRouterOptions = {
  prisma: PrismaClient;
  email?: EmailService;
  verification?: VerificationStore;
  requireEmailVerification?: boolean;
  /**
   * 登录防爆破限流配置（默认：同一 IP+账号 15 分钟内最多 5 次失败）。
   * 传 false 显式关闭（测试场景）；亦可用环境变量 BAMBOOK_LOGIN_RATE_LIMIT_DISABLED=1 关闭，
   * 或用 BAMBOOK_LOGIN_RATE_LIMIT_WINDOW_MS / BAMBOOK_LOGIN_RATE_LIMIT_MAX_FAILURES 调整阈值。
   */
  loginRateLimit?: { windowMs?: number; maxFailures?: number } | false;
};

const COOKIE_NAME = 'bambook_token';
const COOKIE_MAX_AGE = 7 * 24 * 3600 * 1000;
const AVATAR_PRESET_RE = /^dicebear:v1:(blobs|disco|glass|glyphs|squircles|slice|waves|weave|critters|cameo|line-face|thumbs|landscape|croodles-neutral|dylan|fun-emoji|gaze|pixelbot|rings|stripes|planets):([A-Za-z0-9_-]{1,80}):(animated|still)$/;
const AVATAR_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeLoginIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createAuthRouter(options: AuthRouterOptions) {
  const router = Router();
  const auth = createAuthService();
  const email = options.email || createEmailService();
  const verification = options.verification || createVerificationStore();
  router.use('/account-access', accountAccessRouter(options.prisma, { email }));
  router.use(selfRegistrationRouter({ prisma: options.prisma, verification, hashPassword: password => auth.hashPassword(password), requireEmailVerification: options.requireEmailVerification !== false }));

  const envWindowMs = Number(process.env.BAMBOOK_LOGIN_RATE_LIMIT_WINDOW_MS);
  const envMaxFailures = Number(process.env.BAMBOOK_LOGIN_RATE_LIMIT_MAX_FAILURES);
  const loginRateLimiter =
    options.loginRateLimit === false || process.env.BAMBOOK_LOGIN_RATE_LIMIT_DISABLED === '1'
      ? null
      : createLoginRateLimiter({
          windowMs: (options.loginRateLimit && options.loginRateLimit.windowMs) || envWindowMs || undefined,
          maxFailures: (options.loginRateLimit && options.loginRateLimit.maxFailures) || envMaxFailures || undefined,
        });

  /**
   * 读取账号所属的启用中公司。测试替身或未迁移库可能没有 CompanyMember 模型，
   * 此时返回空列表（保持历史单租户行为），不因缺模型直接 500。
   */
  async function loadCompanyMemberships(userId: string) {
    const prisma: any = options.prisma;
    if (typeof prisma?.companyMember?.findMany !== 'function') return [];
    return prisma.companyMember.findMany({
      where: { userId, status: 'active' },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    }) as Promise<Array<{
      companyId: string;
      jobTitle: string | null;
      company: { id: string; name: string; slug: string; status: string };
    }>>;
  }

  router.post('/login', async (req: Request, res: Response) => {
    const { email, identifier, password } = req.body || {};
    const loginIdentifier = normalizeLoginIdentifier(identifier || email);
    if (!loginIdentifier || !password) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Name/email and password are required.' });
    }

    // 防爆破：同一 IP 对同一账号的失败尝试计入滑动窗口，超限直接 429（不查库）
    const rateLimitKey = `${req.ip || 'unknown'}|${loginIdentifier.toLowerCase()}`;
    if (loginRateLimiter) {
      const verdict = loginRateLimiter.check(rateLimitKey);
      if (verdict.blocked) {
        return res.status(429).json({
          ok: false,
          error: 'RATE_LIMITED',
          message: '登录失败次数过多，请稍后重试。',
          retryAfterMs: verdict.retryAfterMs,
        });
      }
    }

    const normalizedEmail = normalizeEmail(loginIdentifier);
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    const user = await options.prisma.userAccount.findFirst({
      where: {
        deletedAt: null,
        OR: looksLikeEmail
          ? [{ email: { equals: normalizedEmail, mode: 'insensitive' } }]
          : [
              { displayName: { equals: loginIdentifier, mode: 'insensitive' } },
              { email: { equals: normalizedEmail, mode: 'insensitive' } },
            ],
      },
      include: { roles: { include: { department: true, role: { include: { permissions: { include: { permission: true } } } } } }, primaryDepartment: true },
    });

    if (!user || !user.passwordHash) {
      loginRateLimiter?.recordFailure(rateLimitKey);
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: '姓名/邮箱或密码不正确。' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ ok: false, error: 'PENDING_APPROVAL', message: '账号待管理员审批，请联系管理员。' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ ok: false, error: 'REJECTED', message: '账号申请已被拒绝。' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ ok: false, error: 'DISABLED', message: '账号已被停用。' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'INACTIVE', message: '账号当前不可用。' });
    }

    const valid = await auth.verifyPassword(password, user.passwordHash);
    if (!valid) {
      loginRateLimiter?.recordFailure(rateLimitKey);
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: '姓名/邮箱或密码不正确。' });
    }

    // 登录成功：清除该 IP+账号的失败计数
    loginRateLimiter?.reset(rateLimitKey);

    // 平台管理入口与公司登录入口分开（2026-10-26 用户定案）：平台账号只能从平台入口登录，公司账号只能从公司入口登录。
    const entryHost = publicEntryForHost(String(req.headers.host ?? ''));
    const entry = entryHost ?? (req.body?.entry === 'platform' ? 'platform' : 'company');
    if (entryHost && req.body?.entry && req.body.entry !== entryHost) return res.status(403).json({ ok: false, error: entryHost === 'platform' ? 'PLATFORM_ENTRY_ONLY' : 'COMPANY_ENTRY_ONLY', message: entryHost === 'platform' ? '请从公司入口登录公司账号。' : '请从平台管理入口登录平台账号。' });
    const platformAccount = (user as any).platformRole === 'platform_admin';
    if (entry === 'platform' && !platformAccount) return res.status(403).json({ ok: false, error: 'PLATFORM_ENTRY_ONLY', message: '该账号不是平台账号，请从公司登录入口登录。' });
    if (entry === 'company' && platformAccount) return res.status(403).json({ ok: false, error: 'COMPANY_ENTRY_ONLY', message: '平台账号请从平台管理入口登录。' });

    // 多租户：确定本次会话进入哪家公司。一个账号可属于多家公司，
    // 多家时先返回公司列表让用户选择；未归属任何公司时保持历史行为（companyId 为空）。
    const companyMemberships = await loadCompanyMemberships(user.id);
    const activeCompanies = companyMemberships.filter((m) => m.company.status === 'active');
    if (!activeCompanies.length && typeof options.prisma.companyMember?.count === 'function'
      && await options.prisma.companyMember.count({ where: { userId: user.id } }) > 0) {
      return res.status(403).json({ ok: false, error: 'COMPANY_ACCESS_DENIED', message: '没有可访问的公司，请联系管理员。' });
    }
    const requestedCompanyId = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
    if (requestedCompanyId && !activeCompanies.some((m) => m.companyId === requestedCompanyId)) {
      return res.status(403).json({ ok: false, error: 'COMPANY_ACCESS_DENIED', message: '当前账号无法访问该公司。' });
    }
    if (!requestedCompanyId && activeCompanies.length > 1) {
      return res.json({
        ok: true,
        needsCompany: true,
        companies: activeCompanies.map((m) => ({
          id: m.company.id,
          name: m.company.name,
          slug: m.company.slug,
          jobTitle: m.jobTitle,
        })),
      });
    }
    const entryCompany = requestedCompanyId
      ? activeCompanies.find((m) => m.companyId === requestedCompanyId)!.company
      : activeCompanies[0]?.company ?? null;
    return issueSession(req, res, user, {}, entryCompany ? { id: entryCompany.id, name: entryCompany.name, slug: entryCompany.slug } : null);
  });

  async function issueSession(req: Request, res: Response, user: any, extra: Record<string, unknown> = {}, company: { id: string; name: string; slug: string } | null = null) {
    let tokenPayload;
    try {
      tokenPayload = await buildLoadedAuthTokenPayload(options.prisma, user, company?.id ?? null);
    } catch (error) {
      if (error instanceof CompanyAccessError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
      logger.error('[auth] current authorization load failed', { userId: user.id, error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'AUTHORIZATION_LOAD_FAILED', message: '账号权限暂时无法加载，请稍后重试。' });
    }
    const { roles, permissions, departmentIds, roleIds: newRoleIds } = tokenPayload;

    const token = auth.signToken(tokenPayload);

    await options.prisma.userAccount.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.ip || null },
    });

    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: user.id, action: 'login', ip: req.ip },
    }).catch(() => undefined);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return res.json({
      ok: true,
      user: serializeAuthUser(user, roles, permissions, departmentIds, { companyId: tokenPayload.companyId, newRoleIds, authorizationLoaded: tokenPayload.authorizationLoaded }),
      token,
      ...(company ? { company } : {}),
      ...extra,
    });
  }

  // Retired authentication endpoints never accept old challenge tokens or create new bindings.
  router.all(['/login/mfa', '/mfa', '/mfa/*'], (_req, res) => {
    res.status(410).json({ ok: false, error: 'AUTH_METHOD_RETIRED', message: '此验证方式已停用，请返回登录页使用账号密码登录。' });
  });

  router.post('/send-code', async (req: Request, res: Response) => {
    try {
      const { email: targetEmail, purpose } = req.body || {};
      if (!targetEmail || typeof targetEmail !== 'string') {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请提供邮箱。' });
      }
      const normalizedEmail = normalizeEmail(targetEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ ok: false, error: 'INVALID_EMAIL', message: '邮箱格式不正确。' });
      }
      const finalPurpose = purpose === 'reset_password' ? 'reset_password' : 'register';

      if (finalPurpose === 'register') {
        const existing = await options.prisma.userAccount.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
        });
        if (existing) {
          return res.status(409).json({ ok: false, error: 'DUPLICATE', message: '该邮箱已注册或正在审批中。' });
        }
      }

      const issued = await verification.issueCode(normalizedEmail, finalPurpose);
      if (issued.ok === false) {
        return res.status(429).json({ ok: false, error: issued.error, message: issued.message, retryAfterMs: issued.retryAfterMs });
      }

      const message = buildVerificationEmail(issued.code, finalPurpose);
      message.to = normalizedEmail;

      // 凭证类邮件（注册验证码 / 重置密码）不允许静默降级：通道没配好时必须显式失败，
      // 不能回「已发送」却永远送不到。本地联调可显式设 AUTH_ALLOW_DEV_EMAIL_FALLBACK=1 放行。
      const devFallback = isDevEmailFallbackAllowed();
      if (!email.isReal && !devFallback) {
        logger.error('[send-code] 邮件通道未配置，验证码无法送达', {
          to: normalizedEmail,
          transport: email.describe(),
        });
        return res.status(503).json({
          ok: false,
          error: 'EMAIL_NOT_CONFIGURED',
          message: '邮件发送通道未配置，验证码无法送达。请联系管理员配置邮件服务后再试。',
          transport: email.describe(),
        });
      }

      try {
        await email.send(message);
      } catch (err) {
        logger.error('[send-code] email send failed', { error: err instanceof Error ? err.message : String(err) });
        if (!devFallback) {
          const detail = err instanceof Error ? err.message : String(err);
          return res.status(502).json({ ok: false, error: 'EMAIL_FAILED', message: `邮件发送失败：${detail}` });
        }
        logger.warn('[send-code] dev fallback 生效：发送失败仍放行', { to: normalizedEmail });
      }

      return res.json({
        ok: true,
        message: `验证码已发送至 ${normalizedEmail}，10 分钟内有效。`,
        expiresAt: issued.expiresAt.toISOString(),
        cooldownMs: issued.cooldownMs,
        transport: email.describe(),
        // 仅显式开启开发降级时回显，便于本地跑通注册流程；真实通道下绝不回显。
        ...(devFallback ? { devCode: issued.code } : {}),
      });
    } catch (err) {
      logger.error('[send-code] unexpected failure', { error: err instanceof Error ? err.message : String(err) });
      const detail = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: 'SEND_CODE_FAILED', message: `验证码发送服务异常：${detail}` });
    }
  });

  router.post('/register', async (req: Request, res: Response) => {
    const { email, password, displayName, requestedDepartment, code } = req.body || {};
    if (!email || !password || !displayName) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '邮箱、密码与姓名为必填项。' });
    }
    const weak = passwordProblem(password);
    if (weak) return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: weak });
    const normalizedEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ ok: false, error: 'INVALID_EMAIL', message: '邮箱格式不正确。' });
    }

    if (options.requireEmailVerification !== false) {
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ ok: false, error: 'MISSING_CODE', message: '请输入邮箱验证码。' });
      }
      const verifyResult = await verification.verifyCode(normalizedEmail, code, 'register');
      if (verifyResult.ok === false) {
        return res.status(400).json({ ok: false, error: verifyResult.error, message: verifyResult.message });
      }
    }

    const existing = await options.prisma.userAccount.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'DUPLICATE', message: '该邮箱已注册或正在审批中。' });
    }

    const passwordHash = await auth.hashPassword(password);
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const user = await options.prisma.userAccount.create({
      data: {
        id,
        displayName,
        email: normalizedEmail,
        passwordHash,
        status: 'pending',
        metadata: {
          requestedDepartment: typeof requestedDepartment === 'string' ? requestedDepartment : null,
          emailVerified: options.requireEmailVerification !== false,
          registeredAt: new Date().toISOString(),
          registeredIp: req.ip || null,
        },
      },
    });

    await options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: user.id,
        action: 'register',
        targetType: 'UserAccount',
        targetId: user.id,
        detail: { requestedDepartment: requestedDepartment || null },
        ip: req.ip,
      },
    }).catch(() => undefined);

    return res.json({
      ok: true,
      message: '注册成功，账号已提交审批，管理员通过后即可登录。',
      user: { id: user.id, email: user.email, displayName: user.displayName, status: user.status },
    });
  });

  router.get('/me', async (req: Request, res: Response) => {
    // 取凭证走全仓唯一那份规则：显式 Bearer 优先。此处曾写作 cookie 优先（与业务路由相反），
    // 于是同一会话里"屏面显示的身份"（这里）和"数据判决的身份"（middleware）可以判给两个人。
    const token = pickRequestToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    }
    try {
      const payload = auth.verifyToken(token);
      const user = await options.prisma.userAccount.findUnique({
        where: { id: payload.userId },
        include: { roles: { include: { department: true, role: { include: { permissions: { include: { permission: true } } } } } }, primaryDepartment: true },
      });
      if (!user || user.status !== 'active' || user.deletedAt != null) {
        res.clearCookie(COOKIE_NAME, { path: '/' });
        return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Account disabled.' });
      }
      const tokenPayload = await buildLoadedAuthTokenPayload(options.prisma, user, payload.companyId ?? null, payload.support);
      const { roles, permissions, departmentIds, roleIds: newRoleIds } = tokenPayload;
      const shownUser = tokenPayload.support ? await supportActingUser(options.prisma, user, tokenPayload.support, tokenPayload.support.companyId) : user;
      let company: { id: string; name: string; slug: string } | null = null;
      if (payload.companyId) {
        const row = await options.prisma.company.findUnique({
          where: { id: payload.companyId },
          select: { id: true, name: true, slug: true, status: true },
        });
        if (!row || row.status !== 'active') {
          res.clearCookie(COOKIE_NAME, { path: '/' });
          return res.status(401).json({ ok: false, error: 'COMPANY_UNAVAILABLE', message: '所属公司已停用，请重新登录。' });
        }
        company = { id: row.id, name: row.name, slug: row.slug };
      }
      return res.json({
        ok: true,
        user: { ...serializeAuthUser(shownUser, roles, permissions, departmentIds, { companyId: tokenPayload.companyId, newRoleIds, authorizationLoaded: tokenPayload.authorizationLoaded, permissionCeiling: payload.permissionCeiling }), ...(tokenPayload.support ? { support: tokenPayload.support } : {}) },
        ...(company ? { company } : {}),
      });
    } catch {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  // 当前账号可进入的公司列表（登录后切换公司用）。
  router.get('/companies', async (req: Request, res: Response) => {
    const token = pickRequestToken(req);
    if (!token) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    let prior: ReturnType<typeof auth.verifyToken>;
    try { prior = auth.verifyToken(token); } catch { return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' }); }
    const rows = await loadCompanyMemberships(prior.userId);
    return res.json({
      ok: true,
      currentCompanyId: prior.companyId ?? null,
      companies: rows.filter((m) => m.company.status === 'active').map((m) => ({
        id: m.company.id, name: m.company.name, slug: m.company.slug, jobTitle: m.jobTitle,
      })),
    });
  });

  // 切换当前公司：换发携带公司上下文的令牌，权限按该公司重新计算。
  router.post('/switch-company', async (req: Request, res: Response) => {
    const token = pickRequestToken(req);
    if (!token) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
    if (!companyId) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请选择公司。' });
    let prior: ReturnType<typeof auth.verifyToken>;
    try { prior = auth.verifyToken(token); } catch { return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' }); }
    const prisma: any = options.prisma;
    const membership = typeof prisma?.companyMember?.findFirst === 'function'
      ? await prisma.companyMember.findFirst({
        where: { userId: prior.userId, companyId, status: 'active' },
        include: { company: true },
      })
      : null;
    if (!membership || membership.company.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'COMPANY_ACCESS_DENIED', message: '当前账号不属于该公司。' });
    }
    const user = await loadUserWithRoles(options.prisma, prior.userId);
    if (!user || user.status !== 'active' || user.deletedAt != null) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Account disabled.' });
    }
    if ((user as any).platformRole) return res.status(403).json({ ok: false, error: 'PLATFORM_IDENTITY_ONLY', message: '平台人员不能切换进入客户公司业务。' });
    const current = await buildLoadedAuthTokenPayload(options.prisma, user, companyId);
    if (prior.permissionCeiling !== undefined) current.permissionCeiling = [...prior.permissionCeiling];
    const next = auth.signToken(current);
    res.cookie(COOKIE_NAME, next, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: COOKIE_MAX_AGE, path: '/' });
    return res.json({
      ok: true,
      token: next,
      user: serializeAuthUser(user, current.roles, current.permissions, current.departmentIds, { companyId: current.companyId, newRoleIds: current.roleIds, authorizationLoaded: true }),
      company: { id: membership.company.id, name: membership.company.name, slug: membership.company.slug },
    });
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ ok: true });
  });

  // 退出所有设备：写入 sessionsRevokedAt，此前签发的令牌（含本次请求所用）全部失效。
  router.post('/logout-all', async (req: Request, res: Response) => {
    const token = pickRequestToken(req);
    if (!token) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    let userId: string;
    try { userId = auth.verifyToken(token).userId; } catch { return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' }); }
    if (!userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    try {
      const user = await options.prisma.userAccount.findUnique({ where: { id: userId }, select: { metadata: true } });
      if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'User not found.' });
      const metadata = (user.metadata && typeof user.metadata === 'object' && !Array.isArray(user.metadata)) ? user.metadata as Record<string, unknown> : {};
      const at = new Date().toISOString();
      await options.prisma.userAccount.update({ where: { id: userId }, data: { metadata: { ...metadata, sessionsRevokedAt: at } as any } });
      invalidateAccountStatusCache(userId);
      await options.prisma.auditLog.create({ data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: userId, action: 'logout_all_sessions', targetType: 'UserAccount', targetId: userId, ip: req.ip } });
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.json({ ok: true, revokedAt: at });
    } catch (err) {
      logger.error('[auth] logout-all failed', { error: (err as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '未能退出所有设备，请重试。' });
    }
  });

  router.patch('/me', async (req: Request, res: Response) => {
    // 取凭证走全仓唯一那份规则：显式 Bearer 优先。此处曾写作 cookie 优先（与业务路由相反），
    // 于是同一会话里"屏面显示的身份"（这里）和"数据判决的身份"（middleware）可以判给两个人。
    const token = pickRequestToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    }

    try {
      const payload = auth.verifyToken(token);
      const data: any = {};
      const { avatarUrl, displayName } = req.body || {};
      if (displayName !== undefined) {
        const nextName = String(displayName).trim();
        if (!nextName) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Display name cannot be empty.' });
        data.displayName = nextName;
      }
      if (avatarUrl !== undefined) {
        if (avatarUrl !== null && typeof avatarUrl !== 'string') {
          return res.status(400).json({ ok: false, error: 'INVALID_AVATAR', message: 'Avatar must be an image, preset identity or null.' });
        }
        if (typeof avatarUrl === 'string') {
          if ((!AVATAR_DATA_URL_RE.test(avatarUrl) && !AVATAR_PRESET_RE.test(avatarUrl)) || avatarUrl.length > 700_000) {
            return res.status(400).json({ ok: false, error: 'INVALID_AVATAR', message: '请选择系统头像或 512KB 以内的图片。' });
          }
        }
        data.avatarUrl = avatarUrl;
      }

      const user = await options.prisma.userAccount.update({
        where: { id: payload.userId },
        data,
        include: { roles: { include: { department: true, role: { include: { permissions: { include: { permission: true } } } } } }, primaryDepartment: true },
      });
      const tokenPayload = await buildLoadedAuthTokenPayload(options.prisma, user);
      const { roles, permissions, departmentIds, roleIds: newRoleIds } = tokenPayload;
      await options.prisma.auditLog.create({
        data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: user.id, action: 'update_profile', targetType: 'UserAccount', targetId: user.id, ip: req.ip },
      }).catch(() => undefined);
      return res.json({ ok: true, user: serializeAuthUser(user, roles, permissions, departmentIds, { companyId: tokenPayload.companyId, newRoleIds, authorizationLoaded: tokenPayload.authorizationLoaded, permissionCeiling: payload.permissionCeiling }) });
    } catch {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const token = pickRequestToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'No token to refresh.' });
    }
    try {
      const prior = auth.verifyToken(token);
      const user = await loadUserWithRoles(options.prisma, prior.userId);
      if (!user || user.status !== 'active' || user.deletedAt != null) {
        res.clearCookie(COOKIE_NAME, { path: '/' });
        return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Account disabled.' });
      }
      // Re-authentication boundary: never re-sign stale role/grant claims from
      // the old JWT, even if every current role permission has been revoked.
      const current = await buildLoadedAuthTokenPayload(options.prisma, user, prior.companyId ?? null, prior.support);
      if (prior.permissionCeiling !== undefined) current.permissionCeiling = [...prior.permissionCeiling];
      const refreshed = auth.signToken(current);
      res.cookie(COOKIE_NAME, refreshed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
      });
      const payload = auth.verifyToken(refreshed);
      return res.json({ ok: true, user: payload });
    } catch {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' });
    }
  });

  router.post('/change-password', async (req: Request, res: Response) => {
    // 取凭证走全仓唯一那份规则：显式 Bearer 优先。此处曾写作 cookie 优先（与业务路由相反），
    // 于是同一会话里"屏面显示的身份"（这里）和"数据判决的身份"（middleware）可以判给两个人。
    const token = pickRequestToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Not logged in.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'Current and new password are required.' });
    }
    const weakNew = passwordProblem(newPassword);
    if (weakNew) return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: weakNew });
    let payload: ReturnType<typeof auth.verifyToken>;
    try { payload = auth.verifyToken(token); } catch { return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Token expired or invalid.' }); }
    try {
      const user = await options.prisma.userAccount.findUnique({ where: { id: payload.userId } });
      if (!user || !user.passwordHash) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'User not found.' });
      }
      const valid = await auth.verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
      }
      const newHash = await auth.hashPassword(newPassword);
      // 管理员重置密码时在 metadata 标了 forceChangePassword；本人改密后清除该标记。
      // 改密同时让其他设备上的旧会话失效（sessionsRevokedAt），当前设备随即换发新令牌继续使用。
      const metadata = (user.metadata && typeof user.metadata === 'object' && !Array.isArray(user.metadata)) ? user.metadata as Record<string, unknown> : {};
      const at = new Date().toISOString();
      await options.prisma.userAccount.update({ where: { id: payload.userId }, data: { passwordHash: newHash, metadata: { ...metadata, ...(metadata.forceChangePassword ? { forceChangePassword: false } : {}), passwordChangedAt: at, sessionsRevokedAt: at } as any } });
      invalidateAccountStatusCache(payload.userId);
      let token: string | undefined;
      try {
        const loaded = await loadUserWithRoles(options.prisma, payload.userId);
        if (loaded) {
          const current = await buildLoadedAuthTokenPayload(options.prisma, loaded, payload.companyId ?? null, payload.support);
          if (payload.permissionCeiling !== undefined) current.permissionCeiling = [...payload.permissionCeiling];
          token = auth.signToken(current);
          res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: COOKIE_MAX_AGE, path: '/' });
        }
      } catch (err) {
        logger.error('[auth] change-password token reissue failed', { userId: payload.userId, error: (err as Error).message });
      }
      if (!token) res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.json({ ok: true, otherSessionsRevoked: true, ...(token ? { token } : { reloginRequired: true }) });
    } catch (err) {
      logger.error('[auth] change-password failed', { userId: payload.userId, error: (err as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '密码未修改，请稍后重试。' });
    }
  });

  return router;
}
