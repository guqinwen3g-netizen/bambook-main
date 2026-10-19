import { Router, type Request, type Response } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { createAuthService } from '../auth/service';
import { randomBytes, randomUUID } from 'node:crypto';
import { invalidateAccountStatusCache } from '../auth/accountStatusGuard';

const CONFIG_ID = 'platform::company-defaults';
export const COMPANY_DEFAULTS = { plan: 'standard', seatLimit: null as number | null };
export async function readCompanyDefaults(db: Pick<Prisma.TransactionClient, 'systemConfig'>) {
  const row = await db.systemConfig.findUnique({ where: { id: CONFIG_ID } });
  const value = row?.value as { plan?: string; seatLimit?: number | null } | null;
  return { plan: value?.plan || COMPANY_DEFAULTS.plan, seatLimit: value?.seatLimit ?? null, version: row?.version ?? 0 };
}
/** All routes share the same live platform-identity guard as company provisioning. */
export function platformSettingsRouter(db: PrismaClient, authorize: (req: Request, res: Response) => Promise<{ userId: string } | null>) {
  const router = Router();
  router.get('/settings', async (req, res, next) => {
    try { if (!await authorize(req, res)) return; res.json({ ok: true, defaults: await readCompanyDefaults(db) }); } catch (e) { next(e); }
  });
  router.patch('/settings', async (req, res, next) => {
    try {
      const actor = await authorize(req, res); if (!actor) return;
      const { plan, seatLimit, version } = req.body ?? {};
      if (typeof plan !== 'string' || !plan.trim() || plan.trim().length > 80 || !(seatLimit === null || Number.isSafeInteger(seatLimit) && seatLimit > 0) || !Number.isSafeInteger(version) || version < 0) {
        res.status(400).json({ ok: false, message: '请填写服务方案、有效席位上限和配置版本。' }); return;
      }
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(190019, 1)`;
        const before = await readCompanyDefaults(tx);
        if (before.version !== version) return null;
        const value = { plan: plan.trim(), seatLimit };
        const row = await tx.systemConfig.upsert({ where: { id: CONFIG_ID }, create: { id: CONFIG_ID, scope: 'platform', key: 'company-defaults', group: 'provisioning', label: '公司开户默认设置', valueType: 'json', value, updatedAt: BigInt(Date.now()), updatedBy: actor.userId }, update: { value, version: { increment: 1 }, updatedAt: BigInt(Date.now()), updatedBy: actor.userId } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorId: actor.userId, action: 'platform.settings.update', targetType: 'SystemConfig', targetId: CONFIG_ID, detail: { before, after: value } } });
        return { ...value, version: row.version };
      });
      if (!result) { res.status(409).json({ ok: false, message: '设置已被其他管理员修改，请重新读取后再保存。' }); return; }
      res.json({ ok: true, defaults: result });
    } catch (e) { next(e); }
  });
  router.get('/staff', async (req, res, next) => {
    try {
      if (!await authorize(req, res)) return;
      const staff = await db.userAccount.findMany({ where: { platformRole: 'platform_admin', deletedAt: null, companyMembers: { none: {} }, roles: { none: {} } }, orderBy: { createdAt: 'asc' }, select: { id: true, displayName: true, email: true, status: true, lastLoginAt: true } });
      res.json({ ok: true, staff });
    } catch (e) { next(e); }
  });
  router.post('/staff', async (req, res, next) => {
    try {
      const actor = await authorize(req, res); if (!actor) return;
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !displayName || displayName.length > 120) { res.status(400).json({ ok: false, message: '请填写姓名和有效的工作邮箱。' }); return; }
      const initialPassword = randomBytes(24).toString('base64url');
      const passwordHash = await createAuthService().hashPassword(initialPassword);
      const staff = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(190019, 2)`;
        if (await tx.userAccount.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })) return null;
        const row = await tx.userAccount.create({ data: { id: 'platform_' + randomUUID(), displayName, email, passwordHash, platformRole: 'platform_admin', status: 'active', metadata: { forceChangePassword: true } }, select: { id: true, displayName: true, email: true, status: true, lastLoginAt: true } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorId: actor.userId, action: 'platform.staff.create', targetType: 'UserAccount', targetId: row.id, detail: { displayName, email } } });
        return row;
      });
      if (!staff) { res.status(409).json({ ok: false, message: '该邮箱已有账号。请使用独立的平台工作邮箱，不能将公司账号转换为平台人员。' }); return; }
      res.status(201).json({ ok: true, staff, initialPassword });
    } catch (e) { if ((e as { code?: string }).code === 'P2002') { res.status(409).json({ ok: false, message: '该邮箱已有账号。' }); return; } next(e); }
  });
  router.patch('/staff/:id', async (req, res, next) => {
    try {
      const actor = await authorize(req, res); if (!actor) return;
      const status = req.body?.status;
      if (!['active', 'disabled'].includes(status)) { res.status(400).json({ ok: false, message: '账号状态无效。' }); return; }
      if (req.params.id === actor.userId && status !== 'active') { res.status(409).json({ ok: false, message: '不能停用当前登录的平台账号。' }); return; }
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(190019, 2)`;
        const where = { platformRole: 'platform_admin', deletedAt: null, companyMembers: { none: {} }, roles: { none: {} } };
        const account = await tx.userAccount.findFirst({ where: { ...where, id: req.params.id } });
        if (!account) return 'missing';
        if (status !== 'active' && await tx.userAccount.count({ where: { ...where, status: 'active' } }) <= 1) return 'last';
        await tx.userAccount.update({ where: { id: account.id }, data: { status } });
        await tx.auditLog.create({ data: { id: randomUUID(), actorId: actor.userId, action: 'platform.staff.update', targetType: 'UserAccount', targetId: account.id, detail: { before: account.status, after: status } } });
        return 'ok';
      });
      if (result === 'missing') { res.status(404).json({ ok: false, message: '平台人员不存在。' }); return; }
      if (result === 'last') { res.status(409).json({ ok: false, message: '至少保留一位启用的平台管理员。' }); return; }
      invalidateAccountStatusCache(req.params.id); res.json({ ok: true });
    } catch (e) { next(e); }
  });
  router.get('/audit', async (req, res, next) => {
    try {
      if (!await authorize(req, res)) return;
      const page = Number(req.query.page ?? 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) { res.status(400).json({ ok: false, message: '页码无效。' }); return; }
      const where = { action: { startsWith: 'platform.' } };
      const [total, logs] = await db.$transaction([db.auditLog.count({ where }), db.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 30, take: 30, select: { id: true, action: true, targetId: true, createdAt: true, actor: { select: { displayName: true, email: true } } } })]);
      res.json({ ok: true, total, page, logs });
    } catch (e) { next(e); }
  });
  return router;
}
