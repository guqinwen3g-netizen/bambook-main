import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { createAuthService } from '../auth/service';
import { pickRequestToken } from '../auth/middleware';
import { invalidateAccountStatusCache } from '../auth/accountStatusGuard';
import { createCompany } from './companyProvisioning';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { logger } from '../lib/logger';

type PlatformRouterOptions = {
  prisma: PrismaClient;
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 平台后台：跨公司的运营入口，只有 platformRole = 'platform_admin' 的账号可访问。
 * 公司管理员（持有 users:admin 的公司账号）不在这里，走 /api/admin 且只看本公司。
 */
export function createPlatformRouter(options: PlatformRouterOptions) {
  const router = Router();
  const auth = createAuthService();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

  async function requirePlatformAdmin(req: Request, res: Response): Promise<{ userId: string } | null> {
    const token = pickRequestToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '请先登录。' });
      return null;
    }
    let payload: { userId: string };
    try {
      payload = auth.verifyToken(token);
    } catch {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '登录已失效，请重新登录。' });
      return null;
    }
    if (!payload || typeof payload.userId !== 'string' || !payload.userId) { res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '请使用有效的平台账号。' }); return null; }
    const user = await options.prisma.userAccount.findUnique({
      where: { id: payload.userId },
      select: { id: true, platformRole: true, status: true, deletedAt: true },
    });
    if (!user || user.status !== 'active' || user.deletedAt != null) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '账号不可用。' });
      return null;
    }
    if (user.platformRole !== 'platform_admin') {
      res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '需要平台管理员身份。' });
      return null;
    }
    return { userId: user.id };
  }

  function audit(actorId: string, action: string, targetId: string, detail?: unknown) {
    return options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId,
        action,
        targetId,
        ...(detail === undefined ? {} : { detail: detail as any }),
      },
    }).catch(() => undefined);
  }

  router.get('/companies', async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res);
    if (!admin) return;
    try {
      const rows = await options.prisma.company.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: { where: { status: 'active', user: { status: 'active', deletedAt: null } } }, workspaces: true } } },
      });
      return res.json({
        ok: true,
        companies: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          legalName: row.legalName,
          status: row.status,
          plan: row.plan,
          seatLimit: row.seatLimit,
          members: row._count.members,
          workspaces: row._count.workspaces,
          createdAt: row.createdAt,
        })),
      });
    } catch (error) {
      logger.error('[platform] list companies failed', { error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '读取公司列表失败。' });
    }
  });

  router.post('/companies', async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res);
    if (!admin) return;
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const ownerEmail = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : '';
    const ownerName = typeof body.ownerName === 'string' ? body.ownerName.trim() : '';
    const ownerPassword = typeof body.ownerPassword === 'string' ? body.ownerPassword : '';

    if (!name) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请填写公司名称。' });
    if (!SLUG_PATTERN.test(slug)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '公司标识只能用小写字母、数字和连字符，2–50 位。' });
    }
    if (!EMAIL_PATTERN.test(ownerEmail)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请填写有效的所有者邮箱。' });
    }
    if (ownerPassword && ownerPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: '初始密码至少 8 位。' });
    }

    if (body.seatLimit != null && (!Number.isInteger(body.seatLimit) || body.seatLimit < 1)) return res.status(400).json({ ok: false, error: 'INVALID_SEAT_LIMIT', message: '席位上限须为正整数。' });

    const existingCompany = await options.prisma.company.findUnique({ where: { slug }, select: { id: true } });
    if (existingCompany) {
      return res.status(409).json({ ok: false, error: 'COMPANY_EXISTS', message: '该公司标识已被占用。' });
    }

    let generatedPassword: string | null = null;
    try {
      const owner = await options.prisma.userAccount.findFirst({
        where: { email: { equals: ownerEmail, mode: 'insensitive' }, deletedAt: null },
        select: { id: true, status: true },
      });
      let ownerUserId = owner?.id ?? null;
      if (owner && owner.status !== 'active') {
        return res.status(409).json({ ok: false, error: 'OWNER_ACCOUNT_INACTIVE', message: '该邮箱对应的账号未启用，请先在账号管理里处理。' });
      }
      const password = ownerPassword || randomBytes(18).toString('base64url');
      const passwordHash = ownerUserId ? null : await auth.hashPassword(password);
      if (!ownerUserId && !ownerPassword) generatedPassword = password;
      const result = await options.prisma.$transaction(async (tx) => {
        if (!ownerUserId) {
          const account = await tx.userAccount.create({ data: { id: `usr_${randomUUID()}`, displayName: ownerName || ownerEmail.split('@')[0], email: ownerEmail, passwordHash: passwordHash!, status: 'active' } });
          ownerUserId = account.id;
        }
        const created = await createCompany(tx, {
          slug,
          name,
          legalName: typeof body.legalName === 'string' ? body.legalName.trim() : null,
          englishName: typeof body.englishName === 'string' ? body.englishName.trim() : null,
          plan: typeof body.plan === 'string' ? body.plan : 'standard',
          seatLimit: Number.isInteger(body.seatLimit) ? body.seatLimit : null,
          ownerUserId,
          ownerJobTitle: typeof body.ownerJobTitle === 'string' ? body.ownerJobTitle.trim() : '总经理',
        });
        // 所有者拿到本公司的超级管理员角色。
        await tx.userRole.create({
          data: {
            id: `ur_${ownerUserId}_${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}`,
            userId: ownerUserId!,
            roleId: `${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}`,
            departmentId: `dept-company@${created.company.id}`,
          },
        });
        return created;
      });

      if (ownerUserId) invalidateAccountStatusCache(ownerUserId);
      await audit(admin.userId, 'platform.company.create', result.company.id, { slug, name, ownerEmail });

      return res.status(201).json({
        ok: true,
        company: {
          id: result.company.id,
          slug: result.company.slug,
          name: result.company.name,
          status: result.company.status,
        },
        owner: { id: ownerUserId, email: ownerEmail },
        roles: result.roles,
        ...(generatedPassword ? { initialPassword: generatedPassword } : {}),
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ ok: false, error: 'COMPANY_EXISTS', message: '公司标识或账号已被并发创建，请刷新后重试。' });
      logger.error('[platform] create company failed', { slug, error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '创建公司失败。' });
    }
  });

  router.patch('/companies/:id', async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res);
    if (!admin) return;
    const id = req.params.id;
    const body = req.body || {};
    const data: Record<string, unknown> = {};
    if (typeof body.status === 'string') {
      if (!['active', 'suspended', 'closed'].includes(body.status)) {
        return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '公司状态无效。' });
      }
      data.status = body.status;
    }
    if (typeof body.plan === 'string') data.plan = body.plan;
    if (body.seatLimit !== undefined) {
      if (body.seatLimit !== null && (!Number.isInteger(body.seatLimit) || body.seatLimit < 1)) return res.status(400).json({ ok: false, error: 'INVALID_SEAT_LIMIT', message: '席位上限须为正整数。' });
      data.seatLimit = body.seatLimit;
    }
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (!Object.keys(data).length) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '没有要修改的内容。' });
    }
    try {
      const updated = await options.prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT "id" FROM "Company" WHERE "id"=$1::uuid FOR UPDATE', id);
        if (typeof data.seatLimit === 'number' && data.seatLimit < await tx.companyMember.count({ where: { companyId: id, status: 'active', user: { status: 'active', deletedAt: null } } })) throw Object.assign(new Error('席位上限不能少于当前有效成员数。'), { code: 'SEAT_LIMIT_BELOW_USAGE' });
        return tx.company.update({ where: { id }, data });
      });
      await audit(admin.userId, 'platform.company.update', id, data);
      return res.json({ ok: true, company: { id: updated.id, name: updated.name, status: updated.status, plan: updated.plan, seatLimit: updated.seatLimit } });
    } catch (error: any) {
      if (error?.code === 'P2025') return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '公司不存在。' });
      if (error?.code === 'SEAT_LIMIT_BELOW_USAGE') return res.status(409).json({ ok: false, error: error.code, message: error.message });
      logger.error('[platform] update company failed', { id, error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '更新公司失败。' });
    }
  });

  router.get('/companies/:id/members', async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res);
    if (!admin) return;
    try {
      const rows = await options.prisma.companyMember.findMany({
        where: { companyId: req.params.id },
        include: { user: { select: { id: true, displayName: true, email: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return res.json({
        ok: true,
        members: rows.map((row) => ({
          userId: row.userId,
          displayName: row.user.displayName,
          email: row.user.email,
          accountStatus: row.user.status,
          memberStatus: row.status,
          jobTitle: row.jobTitle,
          joinedAt: row.joinedAt,
        })),
      });
    } catch (error) {
      logger.error('[platform] list members failed', { error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '读取成员失败。' });
    }
  });

  router.post('/companies/:id/members', async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res);
    if (!admin) return;
    const companyId = req.params.id;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请填写有效邮箱。' });
    }
    try {
      const company = await options.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, status: true } });
      if (!company) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '公司不存在。' });
      const user = await options.prisma.userAccount.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
        select: { id: true, displayName: true, status: true },
      });
      if (!user) {
        return res.status(404).json({ ok: false, error: 'ACCOUNT_NOT_FOUND', message: '该邮箱还没有账号，请先创建账号。' });
      }
      if (user.status !== 'active') {
        return res.status(409).json({ ok: false, error: 'ACCOUNT_INACTIVE', message: '该账号未启用。' });
      }
      const joined = await options.prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT "id" FROM "Company" WHERE "id"=$1::uuid FOR UPDATE', companyId);
        const current = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        if (current.status !== 'active') return 'inactive';
        const membership = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId, userId: user.id } } });
        if (membership?.status !== 'active' && current.seatLimit !== null && await tx.companyMember.count({ where: { companyId, status: 'active', user: { status: 'active', deletedAt: null } } }) >= current.seatLimit) return 'full';
        await tx.companyMember.upsert({ where: { companyId_userId: { companyId, userId: user.id } }, update: { status: 'active' }, create: { id: randomUUID(), companyId, userId: user.id, status: 'active', joinedAt: new Date(), invitedBy: admin.userId } });
        return 'joined';
      });
      if (joined !== 'joined') return res.status(409).json({ ok: false, error: joined === 'full' ? 'SEAT_LIMIT_REACHED' : 'COMPANY_UNAVAILABLE', message: joined === 'full' ? '公司席位已用完，请先增加席位。' : '公司未启用，不能添加成员。' });
      await audit(admin.userId, 'platform.company.member.add', companyId, { userId: user.id, email });
      return res.json({ ok: true, member: { userId: user.id, displayName: user.displayName, email } });
    } catch (error) {
      logger.error('[platform] add member failed', { error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '添加成员失败。' });
    }
  });

  router.delete('/companies/:id/members/:userId', async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res);
    if (!admin) return;
    try {
      const { id: companyId, userId } = req.params;
      const removed = await options.prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT "id" FROM "Company" WHERE "id"=$1::uuid FOR UPDATE', companyId);
        const ownerRole = await tx.userRole.findFirst({ where: { userId, role: { companyId, code: SYSTEM_ROLE_IDS.SUPER_ADMIN } } });
        if (ownerRole && await tx.companyMember.count({ where: { companyId, status: 'active', userId: { not: userId }, user: { status: 'active', deletedAt: null, roles: { some: { role: { companyId, code: SYSTEM_ROLE_IDS.SUPER_ADMIN } } } } } }) === 0) return false;
        await tx.companyMember.update({ where: { companyId_userId: { companyId, userId } }, data: { status: 'left' } }); return true;
      });
      if (!removed) return res.status(409).json({ ok: false, error: 'LAST_OWNER', message: '不能移除公司的最后一位负责人，请先安排接替人。' });
      await audit(admin.userId, 'platform.company.member.remove', req.params.id, { userId: req.params.userId });
      return res.json({ ok: true });
    } catch (error: any) {
      if (error?.code === 'P2025') return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '成员关系不存在。' });
      logger.error('[platform] remove member failed', { error: (error as Error).message });
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: '移除成员失败。' });
    }
  });

  return router;
}
