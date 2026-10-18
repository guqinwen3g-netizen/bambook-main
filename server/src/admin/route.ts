import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { createAuthService } from '../auth/service';
import { requirePermission } from '../auth/permissionGuard';
import { invalidateAccountStatusCache } from '../auth/accountStatusGuard';
import { createModuleAuthGuard } from '../auth/moduleGuard';
import { buildAuditLogQuery } from '../audit/entityQuery';
import { AgentRole } from '../agent/types';
import { EmailService, buildApprovalApprovedEmail, createEmailService } from '../auth/email';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { logger } from '../lib/logger';
import { safeRouteError } from '../shared/routeError';
import { createApprovalDecisionService, type OnApprovalDecided } from '../approvals/approvalDecisionService';
import { createOrderMainApprovalService, OrderMainApprovalError } from '../orders/orderMainApprovalService';

type AdminRouterOptions = {
  prisma: PrismaClient;
  email?: EmailService;
  onDecided?: OnApprovalDecided;
  /** 是否启用认证（默认 true，与历史行为一致：admin 路由始终要求 owner/admin JWT）。 */
  requireAuth?: boolean;
  /** 允许的 API-Key 集合（默认空集——admin 不接受 API-Key，仅 JWT）。 */
  apiKeys?: Set<string>;
};

function auditId(): string {
  return `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function deletionStamp(): bigint {
  return BigInt(Date.now());
}

/**
 * async 路由统一错误兜底（P1 DoS 面修复）：
 * Express 4 不捕获 async handler 的 rejected promise，Prisma 异常（如假 ID 触发 P2025）
 * 会成为 unhandledRejection 直接打崩进程。包装后：
 *   - P2025（记录不存在）→ 404 NOT_FOUND
 *   - 其余异常 → 500 INTERNAL_ERROR（明细进日志，不外泄）
 * 只补错误兜底，不改任何业务逻辑。
 */
function withRouteErrorGuard(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      logger.error('[admin] route error guarded', { path: req.path, error: err?.message || String(err), code: err?.code });
      if (res.headersSent) return;
      if (err?.code === 'P2025') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '目标记录不存在或已被删除。' });
      }
      const safe = safeRouteError(err, {fallbackCode:'INTERNAL_ERROR'});
      return res.status(safe.status).json({ ok: false, error: safe.code, message: safe.message });
    }
  };
}

async function generateUserAccountId(prisma: PrismaClient, email: string, displayName: string): Promise<string> {
  const source = (email?.split('@')[0] || displayName || 'user').toLowerCase();
  const slug = source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'user';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const id = `user_${slug}_${suffix}`;
    const existing = await prisma.userAccount.findUnique({ where: { id } });
    if (!existing) return id;
  }
  return `user_${slug}_${Date.now().toString(36)}`;
}

/**
 * 角色解析：id 优先（DR-041 容器角色如 role-sales），name 兜底（中文角色名/旧枚举名）。
 * 前端角色选择器以 Role.id 为值下发；兼容历史调用方按 name 传参。
 */
async function resolveRoleByNameOrId(prisma: PrismaClient, nameOrId: string) {
  const byId = await (prisma.role.findUnique?.({ where: { id: nameOrId } }) ?? Promise.resolve(null)).catch(() => null);
  if (byId) return byId;
  return prisma.role.findFirst({ where: { name: nameOrId } });
}

/**
 * 部门存在性校验：primaryDeptId 是真实外键（UserAccount.primaryDeptId → Department.id），
 * 且 DR-007 审批人解析与 userRole 部门作用域 RBAC 均依赖部门可达。
 * 部门填错会导致审批人兜底与部门隔离静默失效，因此在所有写路径 fail-closed。
 */
async function departmentExists(prisma: PrismaClient, departmentId: string | null | undefined): Promise<boolean> {
  if (!departmentId) return true; // 未分配是合法状态
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  return Boolean(dept?.parentId && dept.status === 'active');
}

// ── SuperAdmin 防线（安全修复：admin 不得经角色写端点自我提权）──
// 本路由族要求 owner/admin JWT，但 admin 一旦能改 role-super-admin 的权限集合、
// 或把 SuperAdmin 角色授予任何用户，即可静默接管系统（矩阵「SuperAdmin 不可删除」
// 不变量的运行时延伸）。两类写操作仅 owner（SuperAdmin）可执行。
// 名字仅作兜底（id 是唯一真源）：角色改名（§10.4.1 系统管理员→领导、超级管理员→老板）
// 不得削弱本防线，故新名与旧名一并保留。
const SUPER_ADMIN_ROLE_NAMES = new Set(['老板', '超级管理员', 'SuperAdmin', 'super-admin']);
function isSuperAdminRole(role: { id: string; name: string }): boolean {
  return role.id === SYSTEM_ROLE_IDS.SUPER_ADMIN || SUPER_ADMIN_ROLE_NAMES.has(role.name);
}
function actorIsOwner(req: Request): boolean {
  const roles: unknown[] = (req as any).actor?.roles ?? [];
  return roles.includes('owner') || roles.includes(SYSTEM_ROLE_IDS.SUPER_ADMIN);
}

/** 系统角色：矩阵内置 ID 或库中标记 isSystem（只能调整权限，不能改名、删除）。 */
const SYSTEM_ROLE_ID_SET = new Set<string>(Object.values(SYSTEM_ROLE_IDS));
const SYSTEM_RANK = Object.values(SYSTEM_ROLE_IDS);
function isSystemRole(role: { id: string; isSystem?: boolean | null }): boolean {
  return SYSTEM_ROLE_ID_SET.has(role.id) || role.isSystem === true;
}
function systemRank(id: string): number {
  const index = SYSTEM_RANK.indexOf(id as (typeof SYSTEM_RANK)[number]);
  return index < 0 ? SYSTEM_RANK.length : index;
}
/** 自定义角色名称 1–40 字、说明至多 200 字。 */
function parseRoleText(body: any): { ok: true; name: string; description: string | null } | { ok: false; message: string } {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, message: '请填写角色名称。' };
  if (name.length > 40) return { ok: false, message: '角色名称不超过 40 个字。' };
  if (body?.description !== undefined && body.description !== null && typeof body.description !== 'string') return { ok: false, message: '角色说明须为文字。' };
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (description.length > 200) return { ok: false, message: '角色说明不超过 200 个字。' };
  return { ok: true, name, description: description || null };
}

/** 角色写路径的业务性拒绝（在事务内抛出以回滚；handler 捕获后按 statusCode 返回） */
class RoleWriteRejectedError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
  }
}


/** 账号列表只回显业务元数据：两步验证密钥/恢复码哈希不出服务器（另以 mfaEnabled 布尔值表示）。 */
function publicAccountMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata ?? null;
  const { mfa: _mfa, ...rest } = metadata as Record<string, unknown>;
  return rest;
}

export function createAdminRouter(options: AdminRouterOptions) {
  const router = Router();
  const auth = createAuthService();
  const decisions = createApprovalDecisionService(options.prisma, { onDecided: options.onDecided });
  const orderMainApprovals = createOrderMainApprovalService(options.prisma);
  const email = options.email || createEmailService();

  /**
   * 老板账号防线：管理员（非老板）不得修改、停用老板账号，也不得重置其密码或两步验证——
   * 否则可借「重置密码 → 用临时密码登录」接管老板账号，等同绕过 SuperAdmin 授予防线。
   */
  async function rejectIfSuperAdminTarget(req: Request, res: Response, userId: string): Promise<boolean> {
    if (actorIsOwner(req)) return false;
    let links: any[] = [];
    try { links = await options.prisma.userRole.findMany({ where: { userId }, include: { role: true } }); }
    catch { res.status(503).json({ ok: false, error: 'ROLE_CHECK_FAILED', message: '暂时无法核对目标账号的角色，请稍后重试。' }); return true; }
    if (links.some(link => link.role && isSuperAdminRole(link.role))) {
      res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '老板账号只能由老板本人维护。' });
      return true;
    }
    return false;
  }

  /** 角色名唯一（去首尾空格、忽略大小写）；“老板”等保留名不可占用。返回冲突角色名。 */
  async function roleNameConflict(name: string, exceptId?: string): Promise<string | null> {
    const key = name.toLowerCase();
    if (SUPER_ADMIN_ROLE_NAMES.has(name)) return name;
    const roles = await options.prisma.role.findMany({ select: { id: true, name: true } });
    return roles.find(r => r.id !== exceptId && r.name.trim().toLowerCase() === key)?.name ?? null;
  }

  const requireAuth = options.requireAuth ?? true;
  const apiKeys = options.apiKeys ?? new Set<string>();

  // 统一认证守卫：JWT（走 jwt.verify 验签）优先，API-Key 次之
  router.use(createModuleAuthGuard({ requireAuth, apiKeys }));

  // 所有 admin 路由要求 users:admin 权限点（原 owner/admin 角色组；写类 scope，API-Key 不足以通过；
  // API-Key 即使通过 moduleGuard 也会因无 actor 在此处被挡 → 401）
  if (requireAuth) {
    router.use(requirePermission('users:admin'));
  }

  // Explicit main-order approval authorities; never infer fabric/garment scope
  // from the shared sales-manager role or the generic department-head fallback.
  router.get('/order-approval-authorities', withRouteErrorGuard(async (_req, res) => {
    res.json({ ok: true, ...(await orderMainApprovals.listAuthorityConfig()) });
  }));
  router.put('/order-approval-authorities/:businessLine', withRouteErrorGuard(async (req, res) => {
    const businessLine = req.params.businessLine;
    if (businessLine !== 'fabric' && businessLine !== 'garment') return res.status(400).json({ ok: false, error: 'INVALID_BUSINESS_LINE', message: 'businessLine 须为 fabric 或 garment。' });
    const userIds = req.body?.userIds;
    if (!Array.isArray(userIds) || userIds.some((id: unknown) => typeof id !== 'string' || !id.trim())) return res.status(400).json({ ok: false, error: 'INVALID_USER_IDS', message: 'userIds 必须是账号 ID 数组。' });
    const actorId = (req as any).actor?.userId;
    if (!actorId) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: '需要管理员登录。' });
    const assignments = await orderMainApprovals.replaceAuthorityConfig({ businessLine, userIds, actorId });
    res.json({ ok: true, businessLine, assignments });
  }));

  // ---- Users ----
  router.get('/users', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { status } = req.query as { status?: string };
    const where: any = status ? { status } : { OR: [{ deletedAt: null }, { status: 'disabled' }] };
    const usersRaw = await options.prisma.userAccount.findMany({
      where,
      include: { roles: { include: { role: true } }, primaryDepartment: true },
      orderBy: { createdAt: 'desc' },
    });
    const users = usersRaw.filter(u => {
      const metadata = (u.metadata || {}) as any;
      return !metadata.erased && metadata.deletionMode !== 'erase-personal-data';
    });
    // 部门选项随用户列表下发（与 knowledge-acl 返回 departments 同一模式），
    // 前端用户表单的部门字段用下拉选择，杜绝手填原始 ID。
    // parentId 一并下发：前端下拉按树序展开 + 层级缩进渲染（根/支线可辨）。
    const departments = await options.prisma.department.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    });
    res.json({ ok: true, departments, users: users.map(u => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      avatarUrl: (u as any).avatarUrl || null,
      status: u.status,
      roles: u.roles.map(ur => ur.role.name),
      roleIds: u.roles.map(ur => ur.roleId),
      departmentId: u.primaryDeptId,
      department: u.primaryDepartment?.name || null,
      metadata: publicAccountMetadata(u.metadata),
      mfaEnabled: (u.metadata as any)?.mfa?.enabled === true,
      lastLoginAt: u.lastLoginAt,
      lastLoginIp: u.lastLoginIp,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    })) });
  }));

  router.post('/users', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { displayName, email, password, roles, departmentId } = req.body || {};
    if (!displayName || !email || !password) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'displayName, email, password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 6 characters.' });
    }
    if (!(await departmentExists(options.prisma, departmentId))) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEPARTMENT', message: `部门不存在或已停用：${departmentId}` });
    }
    const existing = await options.prisma.userAccount.findFirst({ where: { email } });
    if (existing && existing.status !== 'disabled' && existing.deletedAt === null) {
      return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'Email already in use.' });
    }
    const requestedRoles = [...new Set<string>(Array.isArray(roles) ? roles : (typeof roles === 'string' && roles ? [roles] : []))];
    const resolvedRoles: Array<{ id: string }> = [];
    for (const roleNameOrId of requestedRoles) {
        const role = await resolveRoleByNameOrId(options.prisma, roleNameOrId);
        if (!role) {
          return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: `角色不存在：${roleNameOrId}` });
        }
        if (isSuperAdminRole(role) && !actorIsOwner(req)) {
          return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'SuperAdmin 角色仅 SuperAdmin(owner) 可授予。' });
        }
        resolvedRoles.push(role);
      }

    const passwordHash = await auth.hashPassword(password);

    const reactivatedMetadata = existing ? { ...((existing.metadata as any) || {}) } : {};
    delete reactivatedMetadata.deletedAt;
    delete reactivatedMetadata.deletedBy;
    delete reactivatedMetadata.deletionMode;
    delete reactivatedMetadata.personnelOnly;
    const user = await options.prisma.$transaction(async tx => {
      const created = existing
      ? await tx.userAccount.update({
        where: { id: existing.id },
        data: {
          displayName,
          email,
          passwordHash,
          status: 'active',
          primaryDeptId: departmentId || null,
          deletedAt: null,
          metadata: {
            ...reactivatedMetadata,
            reactivatedAt: new Date().toISOString(),
          },
        },
      })
      : await tx.userAccount.create({
        data: { id: await generateUserAccountId(options.prisma, email, displayName), displayName, email, passwordHash, primaryDeptId: departmentId || null },
      });
      await tx.userRole.deleteMany({ where: { userId: created.id } });
      for (const role of resolvedRoles) await tx.userRole.create({ data: { id: `ur_${created.id}_${role.id}`, userId: created.id, roleId: role.id, departmentId: departmentId || null } });
      return created;
    });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: existing ? 'reactivate_user' : 'create_user', targetType: 'UserAccount', targetId: user.id, ip: req.ip },
    });
    res.json({ ok: true, userId: user.id, reactivated: Boolean(existing) });
  }));

  router.patch('/users/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    if (await rejectIfSuperAdminTarget(req, res, req.params.id)) return;
    const { id } = req.params;
    const { displayName, email, status, departmentId } = req.body || {};
    if (departmentId !== undefined && !(await departmentExists(options.prisma, departmentId))) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEPARTMENT', message: `部门不存在或已停用：${departmentId}` });
    }
    const data: any = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (email !== undefined) data.email = email;
    if (status !== undefined) data.status = status;
    if (departmentId !== undefined) data.primaryDeptId = departmentId;
    if (status === 'active') data.deletedAt = null;
    await options.prisma.userAccount.update({ where: { id }, data });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'update_user', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  router.post('/users/:id/reset-password', withRouteErrorGuard(async (req: Request, res: Response) => {
    if (await rejectIfSuperAdminTarget(req, res, req.params.id)) return;
    const { id } = req.params;
    const { newPassword } = req.body || {};
    // 弱口令治理（运维冲刺）：管理员未显式提供新密码时，由服务端生成随机一次性密码，
    // 仅在本响应中返回一次展示，并在 metadata 标记 forceChangePassword 提示前端引导改密。
    // 禁止回退到 'bambook2026' 之类的固定弱口令。
    const generated = !newPassword;
    const finalPassword = generated ? crypto.randomBytes(8).toString('hex') : String(newPassword);
    if (finalPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'WEAK_PASSWORD', message: 'New password must be at least 6 characters.' });
    }
    const passwordHash = await auth.hashPassword(finalPassword);
    const target = await options.prisma.userAccount.findUnique({ where: { id }, select: { metadata: true } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }
    await options.prisma.userAccount.update({
      where: { id },
      data: {
        passwordHash,
        metadata: {
          ...(target.metadata as any || {}),
          forceChangePassword: true,
          passwordResetAt: new Date().toISOString(),
          // 重置即视为账号可能外泄：该账号已登录的所有会话随之失效。
          sessionsRevokedAt: new Date().toISOString(),
        },
      },
    });
    invalidateAccountStatusCache(id);
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'reset_password', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({
      ok: true,
      forceChangePassword: true,
      ...(generated ? { temporaryPassword: finalPassword } : {}),
    });
  }));

  // 两步验证重置：用户丢失验证器且恢复码用尽时由管理员关闭，之后本人可重新绑定。
  router.post('/users/:id/reset-mfa', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (await rejectIfSuperAdminTarget(req, res, id)) return;
    const target = await options.prisma.userAccount.findUnique({ where: { id }, select: { metadata: true } });
    if (!target) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    const metadata = (target.metadata as any) || {};
    await options.prisma.userAccount.update({ where: { id }, data: { metadata: { ...metadata, mfa: { enabled: false, resetAt: new Date().toISOString() } } } });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'reset_mfa', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  const disableUserAccount = withRouteErrorGuard(async (req: Request, res: Response) => {
    if (await rejectIfSuperAdminTarget(req, res, req.params.id)) return;
    const { id } = req.params;
    const actor = (req as any).actor;
    if (actor?.userId === id) {
      return res.status(400).json({ ok: false, error: 'SELF_DISABLE_FORBIDDEN', message: '不能停用当前登录账号。' });
    }

    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }

    await options.prisma.userAccount.update({
      where: { id },
      data: {
        status: 'disabled',
        metadata: {
          ...(target.metadata as any || {}),
          disabledAt: new Date().toISOString(),
          disabledBy: actor?.userId || 'system',
        },
      },
    });

    // REQ2-13（DR-056-③）：停用即时失效——组合根状态守卫缓存同步失效
    invalidateAccountStatusCache(id);

    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'disable_account', targetType: 'UserAccount', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  });

  router.post('/users/:id/disable-account', disableUserAccount);
  // [B4 冗余收敛 2026-09-15] 移除 /users/:id/delete-account 别名：
  // 「删除账号」措辞已被产品与测试明确弃用（AdminPanel.test.tsx 断言不含「删除账号」），
  // 前端只调正名 disable-account（AdminPanel.tsx），别名零调用方。

  router.post('/users/:id/erase-personal-data', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const actor = (req as any).actor;
    if (actor?.userId === id) {
      return res.status(400).json({ ok: false, error: 'SELF_ERASE_FORBIDDEN', message: '不能抹除当前登录账号。' });
    }

    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }

    await options.prisma.$transaction([
      options.prisma.agentToolRun.deleteMany({ where: { userId: id } }),
      options.prisma.agentMemory.deleteMany({ where: { userId: id } }),
      options.prisma.agentMessage.deleteMany({ where: { userId: id } }),
      options.prisma.agentSession.deleteMany({ where: { userId: id } }),
      options.prisma.userRole.deleteMany({ where: { userId: id } }),
      options.prisma.userAccount.update({
        where: { id },
        data: {
          displayName: `已抹除用户 ${id.slice(-6)}`,
          email: null,
          passwordHash: '',
          status: 'disabled',
          primaryDeptId: null,
          metadata: {
            erased: true,
            erasedAt: new Date().toISOString(),
            erasedBy: actor?.userId || 'system',
            deletionMode: 'erase-personal-data',
          },
          lastLoginAt: null,
          lastLoginIp: null,
          deletedAt: deletionStamp(),
        },
      }),
    ]);

    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'erase_personal_data', targetType: 'UserAccount', targetId: id, detail: { scope: 'personal-only' }, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  router.post('/users/:id/approve', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { roles, departmentId } = req.body || {};
    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }
    if (target.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS', message: '该用户不在待审批状态。' });
    }

    const requestedRole = (target.metadata as any)?.requestedRole as string | undefined;
    const finalRoles: string[] = Array.isArray(roles) && roles.length
      ? roles
      : (requestedRole ? [requestedRole] : ['role-sales']);

    const finalDeptId = departmentId || target.primaryDeptId || null;
    if (!(await departmentExists(options.prisma, finalDeptId))) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEPARTMENT', message: `部门不存在或已停用：${finalDeptId}` });
    }
    const resolvedApproveRoles: Array<{ id: string }> = [];
    for (const roleNameOrId of finalRoles) {
      const role = await resolveRoleByNameOrId(options.prisma, roleNameOrId);
      if (!role) {
        return res.status(400).json({ ok: false, error: 'INVALID_ROLE', message: `角色不存在：${roleNameOrId}` });
      }
      if (isSuperAdminRole(role) && !actorIsOwner(req)) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'SuperAdmin 角色仅 SuperAdmin(owner) 可授予。' });
      }
      resolvedApproveRoles.push(role);
    }
    await options.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "UserAccount" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.userAccount.findUnique({ where: { id } });
      if (current?.status !== 'pending') throw Object.assign(new Error('该用户不在待审批状态。'), { status: 409, code: 'INVALID_STATUS' });
    await tx.userAccount.update({
      where: { id },
      data: {
        status: 'active',
        primaryDeptId: finalDeptId,
      },
    });

    await tx.userRole.deleteMany({ where: { userId: id } });
    for (const role of resolvedApproveRoles) {
      await tx.userRole.create({
        data: {
          id: `ur_${id}_${role.id}_${Date.now()}`,
          userId: id,
          roleId: role.id,
          departmentId: finalDeptId,
        },
      });
    }

    });

    let department: { id: string; name: string } | null = null;
    if (finalDeptId) {
      department = await options.prisma.department.findUnique({
        where: { id: finalDeptId },
        select: { id: true, name: true },
      });
    }

    let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    let emailError: string | null = null;
    if (target.email) {
      try {
        const message = buildApprovalApprovedEmail({
          displayName: target.displayName,
          roles: finalRoles,
          department: department?.name || null,
        });
        message.to = target.email;
        await email.send(message);
        emailStatus = 'sent';
      } catch (err: any) {
        emailStatus = 'failed';
        emailError = err?.message || String(err);
        logger.warn('[admin/approve] failed to send approval email', { error: emailError });
      }
    }

    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: actor?.userId || 'system',
        action: 'approve_register',
        targetType: 'UserAccount',
        targetId: id,
        detail: { roles: finalRoles, departmentId: finalDeptId, emailStatus, emailError },
        ip: req.ip,
      },
    });

    res.json({ ok: true, emailStatus, emailError });
  }));

  router.post('/users/:id/reject', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }
    if (target.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS', message: '该用户不在待审批状态。' });
    }

    await options.prisma.userAccount.update({
      where: { id },
      data: {
        status: 'rejected',
        metadata: {
          ...(target.metadata as any || {}),
          rejectedAt: new Date().toISOString(),
          rejectReason: typeof reason === 'string' ? reason : null,
        },
      },
    });

    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: {
        id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        actorId: actor?.userId || 'system',
        action: 'reject_register',
        targetType: 'UserAccount',
        targetId: id,
        detail: { reason: reason || null },
        ip: req.ip,
      },
    });

    res.json({ ok: true });
  }));

  router.patch('/users/:id/roles', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { roles, departmentId } = req.body || {};
    // 存在性前置：对不存在用户返 200 会静默吞掉前端/调用方的 ID 错误（与 disable/approve/reject 同标准 404）
    const target = await options.prisma.userAccount.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '用户不存在。' });
    }
    // 安全修复：清空+重建角色必须原子——此前 deleteMany 与逐个 create 之间遇非法角色 400
    // 会留下「角色已清空、新角色未建」的半失败态（用户瞬间失去全部权限）。
    // 业务性拒绝在事务内抛出（RoleWriteRejectedError）整体回滚，校验全部前置到写入之前。
    try {
      await options.prisma.$transaction(async (tx) => {
        // 先整体解析+校验（不写库），再原子写入——非法角色/SuperAdmin 授予在写任何行之前拒绝
        const resolved: Array<{ id: string; name: string }> = [];
        if (Array.isArray(roles)) {
          for (const roleNameOrId of roles) {
            const role = await resolveRoleByNameOrId(options.prisma, roleNameOrId);
            if (!role) {
              throw new RoleWriteRejectedError(`角色不存在：${roleNameOrId}`, 400, 'INVALID_ROLE');
            }
            if (isSuperAdminRole(role) && !actorIsOwner(req)) {
              throw new RoleWriteRejectedError('SuperAdmin 角色仅 SuperAdmin(owner) 可授予。', 403, 'FORBIDDEN');
            }
            resolved.push(role);
          }
        }
        await tx.userRole.deleteMany({ where: { userId: id } });
        for (const role of resolved) {
          await tx.userRole.create({ data: { id: `ur_${id}_${role.id}_${Date.now()}`, userId: id, roleId: role.id, departmentId: departmentId || null } });
        }
      });
    } catch (e: any) {
      if (e instanceof RoleWriteRejectedError) {
        const safe = safeRouteError(e, {fallbackCode:'INTERNAL_ERROR'});
        return res.status(safe.status).json({ ok: false, error: safe.code, message: safe.message });
      }
      throw e; // 其余异常交 withRouteErrorGuard 兜底（P2025→404 / 其他→500）
    }
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: actor?.userId || 'system', action: 'update_roles', targetType: 'UserAccount', targetId: id, detail: { roles }, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  // ---- Roles ----
  router.get('/roles', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const roles = await options.prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
    const rows = roles.map(r => ({
      id: r.id, name: r.name, description: r.description, isSystem: isSystemRole(r),
      permissions: r.permissions.map(p => p.permission.scope).sort(),
    }));
    // 系统角色在前（按矩阵等级），自定义角色随后按名称排序。
    rows.sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || systemRank(a.id) - systemRank(b.id) || a.name.localeCompare(b.name, 'zh-CN'));
    res.json({ ok: true, roles: rows });
  }));

  // ---- Custom roles（公司按实际岗位新建 / 改名 / 删除；与“角色权限仅老板调整”同口径，仅老板可办理）----
  router.post('/roles', withRouteErrorGuard(async (req: Request, res: Response) => {
    if (!actorIsOwner(req)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '自定义角色仅老板可新建、修改或删除。' });
    const input = parseRoleText(req.body);
    if (!input.ok) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: input.message });
    const requested: unknown = req.body?.permissions;
    if (!Array.isArray(requested) || requested.some(scope => typeof scope !== 'string' || !scope.trim())) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'permissions 必须是权限代码数组。' });
    const scopes = [...new Set((requested as string[]).map(scope => scope.trim()))];
    if (!scopes.length) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: '请至少选择一项权限。' });
    if (scopes.includes('*')) return res.status(400).json({ ok: false, error: 'INVALID_PERMISSION', message: '全部权限只属于“老板”角色，自定义角色须逐项组合权限。' });
    const conflict = await roleNameConflict(input.name);
    if (conflict) return res.status(409).json({ ok: false, error: 'DUPLICATE_ROLE_NAME', message: `已有同名角色「${conflict}」，请换一个名称。` });
    const permissions = await options.prisma.permission.findMany({ where: { scope: { in: scopes } } });
    const unknown = scopes.filter(scope => !permissions.some(p => p.scope === scope));
    if (unknown.length) return res.status(400).json({ ok: false, error: 'INVALID_PERMISSION', message: `权限目录中没有：${unknown.join('、')}` });
    const id = `role-custom-${crypto.randomBytes(6).toString('hex')}`;
    const actor = (req as any).actor;
    await options.prisma.$transaction(async tx => {
      await tx.role.create({ data: { id, name: input.name, description: input.description, isSystem: false } });
      for (const perm of permissions) await tx.rolePermission.create({ data: { id: `rp_${id}_${perm.id}`, roleId: id, permissionId: perm.id } });
      await tx.auditLog.create({ data: { id: auditId(), actorId: actor?.userId || 'system', action: 'create_role', targetType: 'Role', targetId: id, detail: { name: input.name, description: input.description, permissions: permissions.map(p => p.scope).sort() }, ip: req.ip } });
    });
    res.status(201).json({ ok: true, role: { id, name: input.name, description: input.description, isSystem: false, permissions: permissions.map(p => p.scope).sort() } });
  }));

  router.patch('/roles/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    if (!actorIsOwner(req)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '自定义角色仅老板可新建、修改或删除。' });
    const role = await options.prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '角色不存在。' });
    if (isSystemRole(role)) return res.status(409).json({ ok: false, error: 'SYSTEM_ROLE', message: '系统角色不能改名或删除，只能调整权限。' });
    const input = parseRoleText(req.body);
    if (!input.ok) return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: input.message });
    const conflict = await roleNameConflict(input.name, role.id);
    if (conflict) return res.status(409).json({ ok: false, error: 'DUPLICATE_ROLE_NAME', message: `已有同名角色「${conflict}」，请换一个名称。` });
    const actor = (req as any).actor;
    await options.prisma.$transaction(async tx => {
      await tx.role.update({ where: { id: role.id }, data: { name: input.name, description: input.description } });
      await tx.auditLog.create({ data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_role', targetType: 'Role', targetId: role.id, detail: { before: { name: role.name, description: role.description }, after: { name: input.name, description: input.description } }, ip: req.ip } });
    });
    res.json({ ok: true });
  }));

  router.delete('/roles/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    if (!actorIsOwner(req)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: '自定义角色仅老板可新建、修改或删除。' });
    const role = await options.prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '角色不存在。' });
    if (isSystemRole(role)) return res.status(409).json({ ok: false, error: 'SYSTEM_ROLE', message: '系统角色不能改名或删除，只能调整权限。' });
    // 仍有在用 / 待审批账号持有该角色时不得删除：先在“账号”中改派角色，避免账号静默失去权限。
    const holders = await options.prisma.userRole.findMany({ where: { roleId: role.id, user: { deletedAt: null, status: { in: ['active', 'pending'] } } }, include: { user: { select: { displayName: true } } } });
    if (holders.length) {
      const names = [...new Set(holders.map((h: any) => h.user?.displayName).filter(Boolean))];
      return res.status(409).json({ ok: false, error: 'ROLE_IN_USE', message: `还有 ${names.length || holders.length} 个账号使用此角色（${names.slice(0, 5).join('、')}${names.length > 5 ? ' 等' : ''}），请先在“账号”中改派角色。` });
    }
    const actor = (req as any).actor;
    await options.prisma.$transaction(async tx => {
      // 角色专属的知识库授权与助手策略随角色一并失效；角色权限、工具权限与停用账号的角色关联由外键级联清除。
      await tx.knowledgeAcl.deleteMany({ where: { roleId: role.id } });
      await tx.agentPolicy.deleteMany({ where: { roleId: role.id } });
      await tx.role.delete({ where: { id: role.id } });
      await tx.auditLog.create({ data: { id: auditId(), actorId: actor?.userId || 'system', action: 'delete_role', targetType: 'Role', targetId: role.id, detail: { name: role.name, description: role.description }, ip: req.ip } });
    });
    res.json({ ok: true });
  }));

  // ---- Approvals ----
  router.get('/approvals', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const approvals = await options.prisma.approvalRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, approvals });
  }));

  router.patch('/approvals/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, decisionNote } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
    }
    const actor = (req as any).actor;
    if (!actor?.userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    const note = typeof decisionNote === 'string' ? decisionNote.trim() : undefined;
    const { sync, eventDelivery } = await decisions.decide({ id, actor, decision: status, decisionNote: note,
      source: 'api:admin', ip: req.ip });
    res.json({ ok: true, ...(sync ? { sync } : {}), ...(eventDelivery ? { eventDelivery } : {}) });
  }));

  // ---- Suggestions ----
  router.get('/suggestions', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const suggestions = await options.prisma.agentSuggestion.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ ok: true, suggestions });
  }));

  router.patch('/suggestions/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, decidedBy } = req.body || {};
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'INVALID_STATUS' });
    }
    const actor = (req as any).actor;
    await options.prisma.agentSuggestion.update({
      where: { id },
      data: { status, decidedBy: actor?.userId || decidedBy, decidedAt: new Date() },
    });
    res.json({ ok: true });
  }));

  // ---- Audit Logs ----
  // task ERP-P1: target/time filters + 参数校验 fail closed
  // 阶段 D / D6：where 构造抽取至 audit/entityQuery.ts（与 /api/v1/audit/entity 共享）
  router.get('/audit-logs', withRouteErrorGuard(async (req: Request, res: Response) => {
    const built = buildAuditLogQuery(req.query as any);
    if (!built.ok) {
      return res.status(built.status).json({ ok: false, error: built.error, message: built.message });
    }

    const [logs, total] = await Promise.all([
      options.prisma.auditLog.findMany({
        where: built.where,
        orderBy: { createdAt: 'desc' },
        take: built.limit,
        skip: built.offset,
      }),
      options.prisma.auditLog.count({ where: built.where }),
    ]);
    res.json({ ok: true, logs, total });
  }));

  // ---- Knowledge ACL ----
  router.get('/knowledge-acl', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const [acls, documents, roles, departments] = await Promise.all([
      options.prisma.knowledgeAcl.findMany({
        include: { role: true, department: true, document: true },
        take: 200,
      }),
      options.prisma.knowledgeDocument.findMany({ where: { deletedAt: null }, select: { id: true, title: true } }),
      options.prisma.role.findMany({ select: { id: true, name: true } }),
      options.prisma.department.findMany({ where: { status: 'active' }, select: { id: true, name: true, parentId: true } }),
    ]);
    res.json({
      ok: true,
      acls: acls.map(a => ({
        id: a.id,
        documentId: a.documentId,
        documentTitle: a.document?.title || null,
        roleId: a.roleId,
        roleName: a.role?.name || null,
        departmentId: a.departmentId,
        departmentName: a.department?.name || null,
        scope: a.scope,
        access: a.access,
      })),
      documents,
      roles,
      departments,
    });
  }));

  router.post('/knowledge-acl', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { documentId, roleId, departmentId, scope, access } = req.body || {};
    if (!documentId || !scope) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'documentId and scope are required.' });
    }
    const validAccess = ['read', 'write', 'admin', 'none'];
    const finalAccess = validAccess.includes(access) ? access : 'read';
    const id = `kacl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await options.prisma.knowledgeAcl.create({
      data: { id, documentId, roleId: roleId || null, departmentId: departmentId || null, scope, access: finalAccess },
    });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'create_knowledge_acl', targetType: 'KnowledgeAcl', targetId: id, detail: { documentId, roleId, departmentId, scope, access: finalAccess }, ip: req.ip },
    });
    res.json({ ok: true, id });
  }));

  router.patch('/knowledge-acl/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { roleId, departmentId, scope, access } = req.body || {};
    const data: any = {};
    if (roleId !== undefined) data.roleId = roleId || null;
    if (departmentId !== undefined) data.departmentId = departmentId || null;
    if (scope !== undefined) data.scope = scope;
    if (access !== undefined) {
      const validAccess = ['read', 'write', 'admin', 'none'];
      data.access = validAccess.includes(access) ? access : 'read';
    }
    await options.prisma.knowledgeAcl.update({ where: { id }, data });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_knowledge_acl', targetType: 'KnowledgeAcl', targetId: id, detail: data, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  router.delete('/knowledge-acl/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    await options.prisma.knowledgeAcl.delete({ where: { id } });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'delete_knowledge_acl', targetType: 'KnowledgeAcl', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  // ---- Role Permissions ----
  router.get('/permissions', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const permissions = await options.prisma.permission.findMany({ orderBy: { scope: 'asc' } });
    res.json({ ok: true, permissions });
  }));

  router.post('/permissions', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { scope, description } = req.body || {};
    if (!scope) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'scope is required.' });
    }
    const existing = await options.prisma.permission.findUnique({ where: { scope } });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'Permission scope already exists.' });
    }
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await options.prisma.permission.create({ data: { id, scope, description: description || null } });
    res.json({ ok: true, id });
  }));

  router.patch('/roles/:id/permissions', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { addPermissions, removePermissions } = req.body || {};
    const role = await options.prisma.role.findUnique({ where: { id } });
    if (!role) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '角色不存在。' });
    }
    // SuperAdmin 防线（安全修复）：admin 修改 role-super-admin 权限集合 = 静默自我提权，
    // 与矩阵「SuperAdmin 最高权限、不可删除」不变量冲突——仅 owner（SuperAdmin）可改。
    if (isSuperAdminRole(role) && !actorIsOwner(req)) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'SuperAdmin 角色权限仅 SuperAdmin(owner) 可修改。' });
    }
    if (Array.isArray(addPermissions) && addPermissions.includes('*') && !isSuperAdminRole(role)) {
      return res.status(400).json({ ok: false, error: 'INVALID_PERMISSION', message: '全部权限只属于“老板”角色，其他角色须逐项组合权限。' });
    }
    if (Array.isArray(addPermissions)) {
      for (const scope of addPermissions) {
        const perm = await options.prisma.permission.findUnique({ where: { scope } });
        if (perm) {
          await options.prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: id, permissionId: perm.id } },
            create: { id: `rp_${id}_${perm.id}`, roleId: id, permissionId: perm.id },
            update: {},
          });
        }
      }
    }
    if (Array.isArray(removePermissions)) {
      for (const scope of removePermissions) {
        const perm = await options.prisma.permission.findUnique({ where: { scope } });
        if (perm) {
          await options.prisma.rolePermission.deleteMany({ where: { roleId: id, permissionId: perm.id } });
        }
      }
    }
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_role_permissions', targetType: 'Role', targetId: id, detail: { addPermissions, removePermissions }, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  // ---- Tool Permissions ----
  router.get('/tool-permissions', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const [tools, roles] = await Promise.all([
      options.prisma.agentTool.findMany({
        where: { status: 'active' },
        include: { permissions: { include: { role: true } } },
      }),
      options.prisma.role.findMany({ select: { id: true, name: true } }),
    ]);
    res.json({
      ok: true,
      tools: tools.map(t => ({
        id: t.id, name: t.name, scope: t.scope, risk: t.risk, description: t.description,
        permissions: t.permissions.map(p => ({ id: p.id, roleId: p.roleId, roleName: p.role.name, access: p.access, riskMode: p.riskMode })),
      })),
      roles,
    });
  }));

  router.post('/tool-permissions', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { toolId, roleId, access, riskMode } = req.body || {};
    if (!toolId || !roleId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION_FAILED', message: 'toolId and roleId are required.' });
    }
    const validAccess = ['execute', 'read', 'admin', 'none'];
    const validRiskMode = ['direct', 'approval', 'disabled'];
    const finalAccess = validAccess.includes(access) ? access : 'execute';
    const finalRiskMode = validRiskMode.includes(riskMode) ? riskMode : 'direct';
    const id = `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await options.prisma.agentToolPermission.upsert({
      where: { toolId_roleId: { toolId, roleId } },
      create: { id, toolId, roleId, access: finalAccess, riskMode: finalRiskMode },
      update: { access: finalAccess, riskMode: finalRiskMode },
    });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'upsert_tool_permission', targetType: 'AgentToolPermission', targetId: id, detail: { toolId, roleId, access: finalAccess, riskMode: finalRiskMode }, ip: req.ip },
    });
    res.json({ ok: true, id });
  }));

  router.patch('/tool-permissions/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { access, riskMode } = req.body || {};
    const data: any = {};
    const validAccess = ['execute', 'read', 'admin', 'none'];
    const validRiskMode = ['direct', 'approval', 'disabled'];
    if (access !== undefined) data.access = validAccess.includes(access) ? access : 'execute';
    if (riskMode !== undefined) data.riskMode = validRiskMode.includes(riskMode) ? riskMode : 'direct';
    await options.prisma.agentToolPermission.update({ where: { id }, data });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'update_tool_permission', targetType: 'AgentToolPermission', targetId: id, detail: data, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  router.delete('/tool-permissions/:id', withRouteErrorGuard(async (req: Request, res: Response) => {
    const { id } = req.params;
    await options.prisma.agentToolPermission.delete({ where: { id } });
    const actor = (req as any).actor;
    await options.prisma.auditLog.create({
      data: { id: auditId(), actorId: actor?.userId || 'system', action: 'delete_tool_permission', targetType: 'AgentToolPermission', targetId: id, ip: req.ip },
    });
    res.json({ ok: true });
  }));

  // ---- Knowledge Documents (for ACL dropdown) ----
  router.get('/knowledge-documents', withRouteErrorGuard(async (_req: Request, res: Response) => {
    const documents = await options.prisma.knowledgeDocument.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, sourceType: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, documents });
  }));

  return router;
}
