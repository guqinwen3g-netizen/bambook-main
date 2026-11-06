import { createPublicEntryHostGuard } from './auth/publicEntryHostGuard';
import { samePublicOrigin, publicOriginAllowed } from './shared/bambookPublicOrigins';
import { tenantSurfaceGuard } from './auth/tenantSurfaceGuard';
import { liveApiSurface } from './http/liveApiSurface';
// Load env BEFORE Prisma is initialized.
// Local dev overrides come from .env.local (gitignored); .env is the fallback (e.g. cloud creds).
import dotenv from 'dotenv';
import path from 'path';
const SERVER_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env.local'), override: true });
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });
import { createHealthHandler } from './healthRoute';
import { assertBusinessClockConfiguration } from './shared/businessClock';

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { PrismaClient, Prisma } from '@prisma/client';
import { createAccountStatusGuard } from './auth/accountStatusGuard';
import { createAuthorizationSnapshotGuard } from './auth/authorizationSnapshotGuard';
import { createSupplierApprovalAuthorityRouter } from './procurement/supplierApprovalAuthorityRoute';
import { registerPaymentRequestApprovalHook } from './paymentRequests/paymentRequestApprovalHook';
import { createExceptionService } from './exceptions/exceptionService';
import { logger } from './lib/logger';
import { loadAgentApiKeyActors, setDefaultAgentApiKeyActors } from './auth/agentPrincipal';
import { attachPrismaSlowQueryLogger, createRequestTimingMiddleware } from './lib/requestTiming';
import { globalErrorHandler, registerUnhandledRejectionGuard } from './lib/asyncHandler';
import { prewarmMeloTts, getMeloPrewarmStatus } from './ai/tts';
import { ensureDefaultAgentTools } from './agent/tools';
import { createAuthRouter } from './auth/route';
import { createDevPanelRouter } from './devPanel/route';
import { DEV_COMPANIES } from './devPanel/companies';
import { dbUrlFor, getActiveDb, isDualMode } from './devPanel/activeDb';
import { createAdminRouter } from './admin/route';
import { createPlatformRouter } from './platform/route';
import type { OnApprovalDecided } from './approvals/approvalDecisionService';
import { createApprovalRoutingService } from './approvals/approvalRoutingService';
import { createApprovalCreateService } from './approvals/approvalCreateService';
import { createOrderChangeRequestService } from './orderChanges/orderChangeRequestService';
import { createHRRouter } from './hr/route';
import { TokenPayload } from './auth/service';
import { partitionApiKeys, redactKey } from './auth/apiKeySafety';
import { createEmailService } from './auth/email';
import { createVerificationStore } from './auth/verification';
import { createDbVerificationStore } from './auth/verificationDb';
import { describeRuntimeDataSource } from './dataSource';
// ★★ 删实体时统一清引用（修 2026-09-18 发现的根因：`server/src` 里引用表只 upsert 不 delete ✗）
import { installEntityRefPurge } from './entities/entityRefPurgeMiddleware';
import { installAuditCompanyStamp } from './audit/auditCompanyStamp';

// Prisma (Bambook 数据) — 开启 query 事件以支撑慢查询日志（Phase 1 · 任务 1.2）
// DEV 双库模式：启动期即建立两个演示库的连接池，用 Proxy 把每次 prisma.xxx 调用
// 动态委托给「当前激活库」的客户端，实现切库零重启（翻转 activeDb 指针即可）。
// 非双库模式（生产 / 未开 BAMBOOK_DEV_PANEL）维持原单例行为，零改动。
assertBusinessClockConfiguration();
let prisma: PrismaClient;
if (isDualMode()) {
  const baseUrl = process.env.DATABASE_URL || '';
  const clients = new Map<string, PrismaClient>();
  for (const c of DEV_COMPANIES) {
    const url = dbUrlFor(c.dbName, baseUrl);
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    // ★★ 每个库客户端都装「删实体清引用」中间件（2026-09-18 · 根因修复 ✓）
    installEntityRefPurge(client as unknown as Parameters<typeof installEntityRefPurge>[0]);
    installAuditCompanyStamp(client as any);
    clients.set(c.dbName, client);
  }
  const dualFallback = clients.get(getActiveDb()) ?? clients.values().next().value!;
  prisma = new Proxy(dualFallback, {
    get(_target, prop) {
      const client = clients.get(getActiveDb()) ?? dualFallback;
      // 动态委托到当前激活库客户端（@ts-ignore：属性在运行期才解析到具体子对象）
      return (client as any)[prop];
    },
  }) as unknown as PrismaClient;
} else {
  prisma = new PrismaClient({
    log: [{ emit: 'event', level: 'query' }],
  });
  // ★★ 装「删实体清引用」中间件（2026-09-18 · 根因修复 ✓）
  installEntityRefPurge(prisma as unknown as Parameters<typeof installEntityRefPurge>[0]);
  // 审计日志按请求公司上下文补 companyId（公司后台只看本公司审计）。
  installAuditCompanyStamp(prisma as any);
}
attachPrismaSlowQueryLogger(prisma as unknown as Parameters<typeof attachPrismaSlowQueryLogger>[0]);
const runtimeDataSource = describeRuntimeDataSource();
if (runtimeDataSource.warning) {
    logger.warn(`[data-source] ${runtimeDataSource.warning}`);
}
logger.info(`[data-source] kind=${runtimeDataSource.kind} host=${runtimeDataSource.host} database=${runtimeDataSource.name} businessTruth=${runtimeDataSource.isBusinessTruth}`);
// /api/admin 的工具权限页读取 AgentTool 与系统角色，启动时幂等补齐默认项。
ensureDefaultAgentTools(prisma).catch(error => {
    logger.error('[agent-tools] failed to ensure default tools', { error: error?.message || String(error) });
});
// 主 API 只保留 auth / admin / platform / hr / dev 与供应商审批名单（见 http/liveApiSurface.ts）。
// 旧业务路由、通知事件绑定、业务联动、工作流、PDML 同步、AI 运行时与旧定时任务已于 2026-11-06 删除；
// HR 发布的业务事件只在进程内分发，不再落 AgentJob。Mist 的工作器由 src/mist/standalone.ts 启动。

// ── API Key 卫生自检（完整论证见 auth/apiKeySafety.ts 顶部）────────────────
// VITE_ 前缀变量按 Vite 契约会内联进客户端产物，因此**不再**作为服务端密钥来源。
// 另做一次交叉自检：若某个待接受的密钥同时出现在任意 VITE_* 变量中，说明它已经
// （或即将）被打进前端产物 → 剔除并告警（fail-closed）。
// 这里选择「剔除密钥」而非「进程退出」：一把配错的 key 不该拖垮整个服务，
// 员工 JWT 登录不受影响，仅 API-Key 通道对该 key 立即失效。
const SDK_KEY_PARTITION = partitionApiKeys([
    process.env.BAMBOOK_SDK_KEY,
    process.env.BAMBOOK_API_KEY,
]);
if (SDK_KEY_PARTITION.rejected.length > 0) {
    logger.error(
        `[SECURITY] 已拒绝 ${SDK_KEY_PARTITION.rejected.length} 个「同时出现在 VITE_* 变量中」的 API Key`
        + `（VITE_ 变量会被 Vite 内联进前端产物，等同于公开）：`
        + SDK_KEY_PARTITION.rejected.map(redactKey).join('、')
        + `。请将 BAMBOOK_SDK_KEY / BAMBOOK_API_KEY 轮换为未出现在任何 VITE_ 变量中的新值；`
        + `员工 JWT 登录不受影响，仅 API-Key 通道对该 key 失效。`,
    );
}

const SDK_CONFIG = {
    apiKeys: new Set(SDK_KEY_PARTITION.accepted),
    requireAuth: process.env.BAMBOOK_REQUIRE_AUTH === 'true' || process.env.NODE_ENV === 'production',
};

/**
 * §10.4.1（2026-09-12 定案）：**把 AI 当员工看**——AI 与员工只是入口不同（UI vs MCP/API），
 * 权限一律取决于它自己的账号与身份。因此 API Key 必须绑定到真实 UserAccount，
 * 角色/权限/部门全部从 DB 该账号读取（见 auth/agentPrincipal.ts），不再由环境变量写死。
 *
 * 配置（二选一，均未配 = 不启用 Agent 主体，API-Key 请求 403 AGENT_PRINCIPAL_REQUIRED）：
 * - BAMBOOK_AGENT_API_KEY_MAP="key1=userId1,key2=userId2"  多主体（多个 AI 各自身份）
 * - BAMBOOK_AGENT_API_KEY_ACTOR_ID=userId                  单主体（全部 SDK key 共用）
 *
 * 容器在启动后异步填充（守卫按请求时查表，持有同一 Map 引用即可，无需重启）。
 */
const AGENT_API_KEY_ACTORS: Map<string, TokenPayload> = new Map();

const app = express();
const PORT = process.env.PORT || 8081;

// 进程级 unhandledRejection 兜底（Express 4 async 错误三件套之一）：
// Express 4 不捕获 async handler 的 rejection，任何未包装的 async 路由 reject
// 都会打崩进程（Node 15+ 默认 throw）。此处只记日志不退出——路由层应优先经
// asyncHandler → globalErrorHandler 管道处理，走到这里的是漏网调用点。
registerUnhandledRejectionGuard();

// Middlewares
// CORS 显式白名单（P2 安全收紧）：不再反射任意 Origin——携带凭证请求若来自未知站点
// 会被浏览器拦截（服务端不返回 Allow-Origin）。无 Origin 的请求（curl / Electron
// 原生 fetch / 同源隧道）一律放行，避免误伤非浏览器调用方。
const ALLOWED_ORIGINS = new Set<string>([
    'http://localhost:3000', // 本地 dev 前端（vite）
    'http://127.0.0.1:3000',
    'http://localhost:3001', // 历史 mobile dev 端口（已退役，保留兼容）
    'http://localhost:4173', // vite preview
    'https://jiangsupanda.com', // 生产（Cloudflare Tunnel 同域，含 /bambook/api/app webapp）
    'https://bambook.jiangsupanda.com', // 生产子域名入口
    'http://localhost:3005', // 客户门户 dev（customer-portal）
    'http://localhost:8081', // dev 后端自身
]);
const corsWithCredentials: express.RequestHandler = (req, res, next) => cors({
    origin(origin, cb) {
        const host = String(req.headers.host ?? '');
        cb(null, publicOriginAllowed(host, origin) && (!origin || ALLOWED_ORIGINS.has(origin) || samePublicOrigin(host, origin)));
    },
    credentials: true,
})(req, res, next);
app.use(corsWithCredentials);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
// REQ2-13（DR-056-③）：停用账号即时失效——JWT 只验签不查库的根因缺口在组合根拦截
//（30s TTL 缓存；停用/交接路径调用 invalidateAccountStatusCache 同进程即时失效）
app.use(createAccountStatusGuard(prisma));
// 先归一化隧道前缀，再匹配 /api 的当前授权刷新守卫。
// Cloudflare Tunnel routes /bambook/api/* to this 8081 service (without prefix rewrite).
// Strip the /bambook prefix so existing /api/* handlers stay intact for the Electron
// desktop client, which calls https://jiangsupanda.com/bambook/api/... via the tunnel.
// (Web APP project已下线 — 不再有 /api/app 静态托管，仅保留 API 路由。)
app.use((req, _res, next) => {
    if (req.url === '/bambook/api' || req.url.startsWith('/bambook/api/')) {
        req.url = req.url.slice('/bambook'.length);
    }
    next();
});

// 主 API 只保留在用路径，其余旧接口在鉴权与查库之前直接 404（见 http/liveApiSurface.ts）。
app.use('/api', liveApiSurface);
app.use('/api', createAuthorizationSnapshotGuard({ prisma, apiKeys: SDK_CONFIG.apiKeys, apiKeyActors: AGENT_API_KEY_ACTORS }));
app.use('/api', createPublicEntryHostGuard());
app.use('/api', tenantSurfaceGuard);
// 请求耗时日志：5xx→error / 慢请求→warn / 其余→debug（Phase 1 · 任务 1.2）
app.use(createRequestTimingMiddleware());
app.use((req, res, next) => {
    // 与 corsWithCredentials 同口径：仅白名单 Origin 回显（不反射任意 Origin，
    // 否则带凭证请求可被任意站点读取——P2 双保险，该手写中间件与 cors 包并存）。
    const origin = req.headers.origin;
    if (origin && publicOriginAllowed(String(req.headers.host ?? ''), origin) && (ALLOWED_ORIGINS.has(origin) || samePublicOrigin(String(req.headers.host ?? ''), origin))) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    next();
});

// Serialization helper for BigInt
// @ts-ignore
BigInt.prototype.toJSON = function () {
    return Number(this);
};

// Serialization helper for Prisma.Decimal — ensures JSON output is number, not string
// @ts-ignore
if (Prisma.Decimal.prototype.toJSON === undefined || Prisma.Decimal.prototype.toJSON.name !== 'decimalToNumberJSON') {
    const _origToJSON = Prisma.Decimal.prototype.toJSON;
    // @ts-ignore
    Prisma.Decimal.prototype.toJSON = function decimalToNumberJSON() {
        return Number(this);
    };
}

// Health Check
/**
 * 构建标识 —— 回答「生产跑的到底是哪个提交」。
 *
 * 为什么需要（2026-09-19 实测缺口）：`version` 取的是 `package.json` 的版本号（写死 `1.0.0`），
 * **从外部无法判断生产部署的是哪一版**。当天实测：公开仓停在 09-01、本地 HEAD 是 09-19、
 * 生产健康检查只回 `1.0.0` ⇒ 只能靠**探测某个路由是否存在**来猜版本下界（脆弱且间接）。
 *
 * 优先级：`BUILD_SHA` 环境变量（打包/部署时注入，生产推荐）> 本地 `git rev-parse` > `'unknown'`。
 * ⚠️ 生产是**打包上传**、可能没有 git 仓库 ⇒ 必须 try/catch，
 *    绝不能因为取不到构建号而让 health 变成 500（健康检查比构建号重要）。
 */
function resolveBuildSha(): string {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return sha || 'unknown';
  } catch {
    return 'unknown';
  }
}
const BUILD_SHA = resolveBuildSha();

// 公开健康检查：响应只含状态字段，错误原文只写服务端日志（见 healthRoute.ts）。
app.get('/api/health', createHealthHandler({ prisma, build: BUILD_SHA, authRequired: SDK_CONFIG.requireAuth, tts: getMeloPrewarmStatus }));

const emailService = createEmailService();
// B5-1：验证码持久化——落库版（重启不丢/多实例可用）；测试环境（无 DB 依赖的用例）回退内存版
const verificationStore = process.env.NODE_ENV === 'test'
  ? createVerificationStore()
  : createDbVerificationStore({ prisma });
const requireEmailVerification = process.env.AUTH_REQUIRE_EMAIL_VERIFY
  ? !/^(0|false|no)$/i.test(process.env.AUTH_REQUIRE_EMAIL_VERIFY.trim())
  : true;
logger.info(`[auth] email transport: ${emailService.describe()}; verification ${requireEmailVerification ? 'required' : 'optional'}`);

app.use('/api/auth', createAuthRouter({
  prisma,
  email: emailService,
  verification: verificationStore,
  requireEmailVerification,
}));

// 开发调试面板（公司切换 / 账号一键登录 / 环境信息）。仅当 BAMBOOK_DEV_PANEL=1 且非 production 时生效，否则路由返回 404。
app.use('/api/dev', createDevPanelRouter({ prisma }));

// 审批决策后同步业务单据状态（OrderChangeRequest / DR-013 例外申请），供 /api/admin 审批决策使用。
const orderChangeApprovalSyncService = createOrderChangeRequestService({
    prisma,
    approvalCreateService: createApprovalCreateService({
        prisma,
        routingService: createApprovalRoutingService({ prisma }),
    }),
});
const onApprovalDecided: OnApprovalDecided = async (approval) => {
        const result = approval.targetType === 'Dr013ExceptionRequest'
          ? await createExceptionService({ prisma, approvalCreateService: createApprovalCreateService({
              prisma, routingService: createApprovalRoutingService({ prisma }),
            }) }).syncFromApprovalDecision({ approvalRequestId: approval.id })
          : approval.targetType === 'OrderChangeRequest'
          ? await orderChangeApprovalSyncService.syncFromApprovalDecision({
            approvalRequestId: approval.id,
            decision: approval.status,
            decisionNote: approval.decisionNote,
            actorId: approval.actualDecisionActor,
        }) : null;
        if (result && !result.ok) {
            // The decision is already committed; all entry points expose a
            // retryable sync failure through the same decision service.
            throw new Error(result.error.message);
        }
};
app.use('/api/admin', createAdminRouter({ prisma, email: emailService,
    requireAuth: SDK_CONFIG.requireAuth, apiKeys: SDK_CONFIG.apiKeys, onDecided: onApprovalDecided }));
// 平台后台：跨公司运营入口，仅 platformRole='platform_admin' 可访问。
app.use('/api/platform', createPlatformRouter({ prisma }));

app.use('/api/hr', createHRRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth, apiKeys: SDK_CONFIG.apiKeys }));

// DR-017 审批决议钩子：/api/admin 审批决策发出 approvalEventBus resolved 后回写付款申请状态。
registerPaymentRequestApprovalHook({ prisma });

// 公司「审批资格」页使用的供应商承诺审批名单（旧 /api/v1/procurement 其余接口已删除）。
app.use('/api/v1/procurement/contracts/approval-authority', createSupplierApprovalAuthorityRouter({
    prisma, requireAuth: SDK_CONFIG.requireAuth, apiKeys: SDK_CONFIG.apiKeys,
}));

// ── 全局 4 参错误中间件（Express 4 async 错误三件套之二）────────────
// 挂在全部路由之后：asyncHandler 包装的路由 reject → next(err)
// 统一在此落日志并映射响应（body-parser 4xx 透传 / P2025 404 / 其余 500 不外泄细节）。
// 注意必须在 listen 之前注册，且任何后续新增路由都要插在本中间件之前。
app.use(globalErrorHandler);

// ── Agent 服务主体装载（§10.4.1：AI = 员工账号）────────────────────
// 先解析完主体再开端口，避免启动瞬间 API-Key 请求被误判为未绑定主体。
loadAgentApiKeyActors(prisma, SDK_CONFIG.apiKeys)
    .then((actors) => {
        for (const [key, actor] of actors) AGENT_API_KEY_ACTORS.set(key, actor as any);
        // 同时注入进程级默认：25+ 个模块路由不接 apiKeyActors 入参，统一从这里取主体
        setDefaultAgentApiKeyActors(actors);
        if (actors.size > 0) {
            logger.info(`[agentPrincipal] 已装载 ${actors.size} 个 Agent 主体（API Key → 员工账号）`);
        } else {
            logger.warn('[agentPrincipal] 未配置 Agent 主体（BAMBOOK_AGENT_API_KEY_MAP / ACTOR_ID），API-Key 调用将被 403');
        }
    })
    .catch((error) => {
        logger.warn(`[agentPrincipal] 装载失败：${error?.message || error}（API-Key 调用将被 403）`);
    })
    .finally(() => {
        // BAMBOOK_HOST 显式指定监听地址（开发服务器只监听回环，由 nginx/隧道转入）；未设置时行为不变。
        const listenHost = process.env.BAMBOOK_HOST?.trim() || (process.env.BAMBOOK_ACCEPTANCE_SANDBOX ? '127.0.0.1' : undefined);
        app.listen({ port: Number(PORT), ...(listenHost ? { host: listenHost } : {}) }, () => {
    logger.info(`Sovereign Neural Core Online on port ${PORT}`);
    logger.info('Database Connection: Postgres via Prisma');
    logger.info(`SDK API: ${SDK_CONFIG.requireAuth ? 'Protected (API Key Required)' : 'Open (Local Access)'}`);
        if (process.env.BAMBOOK_MELO_PREWARM_ON_START === 'true') {
            prewarmMeloTts()
                .then(result => {
                    if (!result.skipped) {
                        logger.info(`[tts] Melo prewarmed in ${result.elapsedMs}ms`);
                    }
                })
                .catch(error => {
                    logger.warn(`[tts] Melo prewarm failed: ${error?.message || error}`);
                });
        }
    });
    });
