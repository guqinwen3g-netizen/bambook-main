/**
 * 权限码「消费点登记」守卫（2026-09-17）
 *
 * ── 病灶类型 ─────────────────────────────────────────────
 * `PERMISSION_SCOPES` 里定义的码会被**分配给角色**（`DEFAULT_ROLE_PERMISSION_MATRIX`），
 * 于是「这个角色有这个能力」看起来成立；但若**代码里没有任何地方强制它**，
 * 这份分配就是**装饰性的** —— 权限矩阵在说谎，而系统不会报任何错。
 *
 * 典型实例：`aftersales:read/write/approve` 三码已定义、已按设计矩阵分配给
 * 业务员 / SM / 总领导 / QC / 单证 / 财务 / 审计，但**售后客诉模块整个不存在**
 * （`server/src` 下无 `aftersales/` 目录）→ **0 路由消费**。
 * 决策材料：`docs/L2-5-客户索赔模型-勘察与口径-2026-09-17.md`。
 *
 * ── 本文件做什么 ─────────────────────────────────────────
 * 把「悬空」从**未知**变成**登记在册**：
 *   1. 计算悬空集合（判据见下），断言 **=== 豁免登记表的键集合**（集合相等 ⇒ **双向**：
 *      新增悬空码红 / 登记了却已被接通也红）；
 *   2. 每条豁免必须有 `reason`（封闭枚举）+ 非空 `note`；
 *   3. ★ **专项断言**：`aftersales:*` 三码必须在册、`reason='module-absent'`、
 *      `note` 指向 L2-5 决策材料 —— 售后模型落地后必须回来改这里（届时本断言会红）；
 *   4. **阳性对照**：已知被强制的码（`orders:read` 等）不得出现在悬空集合，
 *      且悬空数必须 **< 总数**（防止扫描逻辑写错成「全部悬空」或「全部不悬空」而空过）。
 *
 * ── 判据（「消费点」的定义）──────────────────────────────
 * 「消费点」= scope 字面量出现在**会改变运行时行为**的代码里：
 *   · 服务端：`requirePermission('x')` / 路由本地包装器 `requireScope(req, res, 'x')` / 服务层判定
 *   · Agent：`agent/identity.ts`、`agent/toolRegistry` 的 scope 矩阵
 *   · 前端：条件渲染用的 scope 判定
 *
 * **不算**消费点的「登记 / 描述类文件」（只声明 scope 存在或给人看，不改变行为）：
 *   · `server/src/_shared/rolePermissionMatrix.ts` —— 矩阵真源
 *   · `lib/rolePermissionMatrix.ts` —— 矩阵副本（GAP-R2 要求与真源逐字同步）
 *   · `server/src/auth/permissionGuard.ts` —— `WRITE_SCOPE_EXACT` 高危分类集
 *   · `components/AdminPanel.tsx` —— `PERMISSION_LABELS` 展示标签表
 *   · `services/authService.ts` —— `DEFAULT_ROLE_PERMISSIONS` legacy 兜底表
 *   · **测试文件** —— 否则「守卫自己列举这些码」会把自己算成消费点（**空过的验证器**）
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_SCOPES } from '../../_shared/rolePermissionMatrix';
import type { TokenPayload } from '../service';
import { safeRouteError } from '../../shared/routeError';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // server/src/auth/__tests__
const SRC = path.resolve(HERE, '..', '..'); // server/src
const REPO = path.resolve(SRC, '..', '..'); // 仓库根

/** 只声明 scope 存在 / 给人看，**不改变运行时行为**的文件（相对仓库根，posix 分隔） */
const REGISTRY_ONLY_FILES = new Set([
  'server/src/_shared/rolePermissionMatrix.ts',
  'lib/rolePermissionMatrix.ts',
  'server/src/auth/permissionGuard.ts',
  'components/AdminPanel.tsx',
  'services/authService.ts',
  // Grant list for company administrators (4cdadcfb); listing a scope here is not an enforcement point.
  'server/src/auth/companyAdministration.ts',
]);

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'out', 'dist-electron', 'build', '.git',
  'customer-portal', 'docs', 'logs', 'data', 'models', 'design-lab',
]);

/** 悬空原因（封闭枚举 —— 新增取值必须先想清楚它属于哪一类） */
type Reason =
  /** 该域在 `server/src` 下**无模块目录** ⇒ 功能整体未实现（码先于功能存在） */
  | 'module-absent'
  /** 功能存在（或由其它模块承载），但**无 scope 强制点** ⇒ 分配是装饰性的 */
  | 'no-scope-enforcement'
  /**
   * ★ 2026-09-17 新增（口径 B1）：**该码按业务方拍板只作「UI 能力标签」，本就不承担强制门禁**。
   *
   * 与 `no-scope-enforcement` 的区别：
   *   · `no-scope-enforcement` = **本该有门禁但没接上**（是欠账，将来要接）
   *   · `ui-label-only`         = **按口径就不该有门禁**（不是欠账，是设计）
   * ⇒ 归入本类后**不再计入「待接通」欠账**。
   */
  | 'ui-label-only';

const REASONS: readonly Reason[] = ['module-absent', 'no-scope-enforcement', 'ui-label-only'];

/**
 * ★ 豁免登记表 —— 无消费点的权限码必须登记在此。
 * **改代码接通某个码后，必须同步从本表删除**（否则「集合相等」断言会红）。
 */
const EXEMPT: ReadonlyArray<{ scope: string; reason: Reason; note: string }> = [
  // ── 功能整体未实现（无对应模块目录）──
  // Approval UI capability labels may be consumed by conditional rendering;
  // that still does not replace the native approval policy gate.
  { scope: 'settings:account', reason: 'module-absent', note: '公司管理员授权清单含此码（companyAdministration），但无页面或接口按它判定' },

  // ── 功能存在，但无 scope 强制点 ──
  { scope: 'dashboard:read', reason: 'no-scope-enforcement', note: '首页按 cockpit:read 判定；公司管理员授权清单中的 dashboard:read 无判定点' },

  // ── 2026-11-06 删除旧主 API 死代码后失去服务端判定点的码（如实登记，不是已接通）──
  { scope: 'agent:approvals:approve', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'business:delete', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'cockpit:read', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'crm:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'data:export:full', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'data:import', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'emails:maintenance:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'exception:dr013:create', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'hr:salary:read', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'invoices:suggest_match', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'moq:capsule_exemption:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'remit:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'reports:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'risk:admin', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'sample:color_batch:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'sample:early_production:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'sample:shipment:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'sensitive:commission', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'sensitive:profit', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'settings:automation:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },
  { scope: 'settings:tolerance:write', reason: 'no-scope-enforcement', note: '原判定点在已删除的旧主 API 路由/服务（2026-11-06），Mist 仅作岗位授权展示；待 Mist 命令门禁接通后从本表删除' },

  // ── *:admin 系列：只出现在 permissionGuard 的 WRITE_SCOPE_EXACT 高危分类集 ──

  // ── 审批类：设计上走审批策略内核（approvals/），未用 scope 门 ──
  { scope: 'orders:approve:change_delivery', reason: 'ui-label-only', note: '审批走 approvals/ 内核；本码仅 UI 能力标签（口径 B1，2026-09-17 业务方拍板）' },
  { scope: 'orders:approve:change_qty', reason: 'ui-label-only', note: '审批走 approvals/ 内核；本码仅 UI 能力标签（口径 B1，2026-09-17 业务方拍板）' },
  { scope: 'orders:approve:change_price', reason: 'ui-label-only', note: '审批走 approvals/ 内核；本码仅 UI 能力标签（口径 B1，2026-09-17 业务方拍板）' },
  { scope: 'orders:approve:cancel', reason: 'ui-label-only', note: '审批走 approvals/ 内核；本码仅 UI 能力标签（口径 B1，2026-09-17 业务方拍板）' },
  { scope: 'shipments:approve', reason: 'ui-label-only', note: '审批走 approvals/ 内核；本码仅 UI 能力标签（口径 B1，2026-09-17 业务方拍板）' },
  { scope: 'knowledge:approve', reason: 'ui-label-only', note: '审批走 approvals/ 内核；本码仅 UI 能力标签（口径 B1，2026-09-17 业务方拍板）' },
];

/** 已知被强制的码 —— 用于**阳性对照**，防止扫描逻辑退化成恒真/恒假 */
const KNOWN_ENFORCED = [
  'orders:read',
  'orders:write',
  'finance:read',
  'qc:write',
  'credit:freeze:write',
  'hr:read',
  'ai:chat',
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue;
      walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
      out.push(abs);
    }
  }
  return out;
}

/** 计算「有消费点」的 scope 集合 */
function computeConsumedScopes(): Set<string> {
  const scopeSet = new Set(Object.keys(PERMISSION_SCOPES));
  const consumed = new Set<string>();
  const targets = [
    path.join(SRC),
    path.join(REPO, 'components'),
    path.join(REPO, 'lib'),
    path.join(REPO, 'services'),
  ];
  for (const file of targets.flatMap((d) => walk(d))) {
    const rel = path.relative(REPO, file).split(path.sep).join('/');
    if (REGISTRY_ONLY_FILES.has(rel)) continue;
    // 单遍：抽出所有单引号字面量，与 scope 集合取交集（避免 O(码×文件)）
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(':')) continue;
    for (const m of text.matchAll(/'([a-z][a-z0-9_]*(?::[a-z0-9_]+)+)'/g)) {
      if (scopeSet.has(m[1])) consumed.add(m[1]);
    }
  }
  return consumed;
}

/**
 * ★ 惰性缓存：扫描要遍历 server/src + components + lib + services 约 2000 个文件。
 * 放在**模块级**会在 collect 阶段执行（不受 testTimeout 保护）；放这里则算在用例执行内。
 * 且必须**显式放宽超时** —— 本项目实测「全树扫描类用例在 163 文件并发下会超 5s 默认超时假红」
 * （见 components/Dashboard.test.tsx 的同类注释），那是被并发拖慢，不是断言失败。
 */
const SCAN_TIMEOUT_MS = 30_000;
let _consumed: Set<string> | null = null;
function consumedScopes(): Set<string> {
  if (!_consumed) _consumed = computeConsumedScopes();
  return _consumed;
}

const ALL_SCOPES = Object.keys(PERMISSION_SCOPES);
let _dangling: string[] | null = null;
function danglingScopes(): string[] {
  if (!_dangling) {
    const c = consumedScopes();
    _dangling = ALL_SCOPES.filter((s) => !c.has(s)).sort();
  }
  return _dangling;
}

describe('★ 权限码消费点登记守卫', () => {
  it('阳性对照：已知被强制的码确实被扫成「有消费点」（防止扫描退化成恒假）', () => {
    const consumed = consumedScopes();
    for (const s of KNOWN_ENFORCED) {
      expect(ALL_SCOPES, `基线漂移：${s} 已不在 PERMISSION_SCOPES 里`).toContain(s);
      expect(consumed.has(s), `扫描逻辑异常：${s} 明明有路由强制却没扫到`).toBe(true);
    }
  }, SCAN_TIMEOUT_MS);

  it('阳性对照：悬空数 < 总数（防止扫描退化成「全部悬空」）', () => {
    const dangling = danglingScopes();
    expect(dangling.length).toBeGreaterThan(0);
    expect(dangling.length).toBeLessThan(ALL_SCOPES.length / 2);
  }, SCAN_TIMEOUT_MS);

  it('★ 悬空集合 === 豁免登记表键集合（集合相等 ⇒ 双向：新悬空红 / 已接通未删登记也红）', () => {
    const registered = EXEMPT.map((e) => e.scope).sort();
    expect(danglingScopes()).toEqual(registered);
  }, SCAN_TIMEOUT_MS);

  it('每条豁免必须有合法 reason + 非空 note', () => {
    for (const e of EXEMPT) {
      expect(REASONS, `${e.scope} 的 reason 非法`).toContain(e.reason);
      expect(e.note.length, `${e.scope} 缺 note`).toBeGreaterThan(0);
    }
  });

  it('豁免表无重复项', () => {
    const keys = EXEMPT.map((e) => e.scope);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * ★★ 专项：`aftersales:*` 三码 —— **已从「悬空豁免」转为「真实消费」**（2026-09-17 A-2 落地）
 *
 * ── 这是一次**设计好的检查点**（不是意外转红）─────────────────
 * 三码原先登记在豁免表、`reason='module-absent'`（售后模块未建），
 * 且**专项断言钉着「必须在册 + 模块目录不存在」**，注释写明：
 * 「**售后模型落地后必须回来改这里（届时本断言会红）**」。
 * 现在 A 组模块（`server/src/claims/`）已落地、路由真实消费三码 ⇒ **回来按设计更新本断言**。
 *
 * ── 现在钉什么 ───────────────────────────────────────────
 *   1. 三码**不得**再出现在豁免表（模块已建，不再是"无消费点"）
 *   2. 它们**确实有消费点**（源码扫描）—— **反向钉住**，防止有人把路由的门禁删掉
 *   3. 消费点确实在 `claims/claimRoute.ts`（而不是被别处"假装"消费）
 */
describe('★ 专项：aftersales 三码 —— read/write 门禁与 approve 条件渲染分别登记', () => {
  const AFTERSALES = ['aftersales:read', 'aftersales:write', 'aftersales:approve'];
  /** 按口径 B1 不作门禁的两个（read/write 是门禁；approve 是 UI 标签） */
  const CONSUMED = ['aftersales:read', 'aftersales:write'];

  it.each(CONSUMED)('%s 不得再登记在豁免表内（模块已建，不再是"无消费点"）', (scope) => {
    expect(EXEMPT.find((e) => e.scope === scope), `${scope} 仍在豁免表内 —— 模块已建，不该再豁免`).toBeUndefined();
  });

  it.each(CONSUMED)('%s 确实有消费点（源码扫描）', (scope) => {
    expect(consumedScopes().has(scope)).toBe(true);
  }, SCAN_TIMEOUT_MS);

  it('★ 口径 B1：approve 已被 UI 条件渲染消费，正式决策仍走审批内核', () => {
    const entry = EXEMPT.find((e) => e.scope === 'aftersales:approve');
    expect(entry).toBeUndefined();
    expect(consumedScopes().has('aftersales:approve')).toBe(true);
    // The legacy components/ClaimManager.tsx was removed with the old UI; the
    // current consumer is the Mist claim-coordination command gate (waiver).
    const source = fs.readFileSync(path.join(SRC, 'shared/mistClaimCoordination.ts'), 'utf8');
    expect(source).toContain("if (type === 'platform.claim.recovery.waive') return 'aftersales:approve';");
  });

});

/**
 * ★ 专项：审批类权限码 = **UI 能力标签（口径 B1）**（2026-09-17 业务方拍板）
 *
 * ── 口径（原文）───────────────────────────────────────────
 * 业务方 2026-09-17 15:00 选择：**审批走 `approvals/` 内核**（按审批策略自动找人）；
 * **以下审批权限码只作界面上的「能力标签」，不是强制门禁。**
 * 见 `docs/业务口径决策单-2026-09-17.md` **B1**。
 *
 * ── 与 `no-scope-enforcement` 的区别（这是本类存在的理由）──
 *   · `no-scope-enforcement` = **本该有门禁但没接上**（是欠账，将来要接）
 *   · `ui-label-only`        = **按口径就不该有门禁**（不是欠账，是设计）
 * ⇒ 归入本类后**不再计入「待接通」欠账**。
 *
 * ── 本专项钉两件事 ───────────────────────────────────────
 *   1. 这 13 个码必须在册且 `reason='ui-label-only'`（防止被误归回"欠账"）
 *   2. 它们**确实没有强制点**（源码扫描）—— 若将来真接了门禁，本断言会红，
 *      强制回来把口径改掉（**不允许悄悄接上**，因为那会改变业务方确认的行为）
 */
describe('★ 专项：审批权限码 = UI 能力标签（口径 B1）', () => {
  const UI_LABEL_APPROVE_CODES = [
    'orders:approve:change_delivery',
    'orders:approve:change_qty',
    'orders:approve:change_price',
    'orders:approve:cancel',
    'shipments:approve',
    'knowledge:approve',
  ];

  it('清单为 6 个（防漏列/误删）—— ⚠️ 不含 aftersales:approve（它由 A 组模块按其专项单独钉）；procurement:approve / finance:payment_request:approve / vouchers:approve:pay_* 已由 Mist 平台命令门禁消费，见下方专项', () => {
    expect(UI_LABEL_APPROVE_CODES).toHaveLength(6);
    expect(new Set(UI_LABEL_APPROVE_CODES).size).toBe(6);
  });

  it.each(UI_LABEL_APPROVE_CODES)('%s 在册且 reason=ui-label-only', (scope) => {
    const entry = EXEMPT.find((e) => e.scope === scope);
    expect(entry, `${scope} 未登记`).toBeDefined();
    expect(entry!.reason).toBe('ui-label-only');
    expect(entry!.note).toMatch(/口径 B1/);
  });

  it.each(UI_LABEL_APPROVE_CODES)('%s 确实无强制点（源码扫描）', (scope) => {
    expect(consumedScopes().has(scope)).toBe(false);
  }, SCAN_TIMEOUT_MS);

  it('★ 这三类原因互不混淆：ui-label-only 不得混入 no-scope-enforcement 的欠账数', () => {
    const byReason = EXEMPT.reduce<Record<string, number>>((acc, e) => {
      acc[e.reason] = (acc[e.reason] ?? 0) + 1;
      return acc;
    }, {});
    // 13 个审批码全部落在 ui-label-only（不多不少）
    // 售后 approve 已由当前页面与真实 approve 端点消费，不再计入未消费豁免。
    expect(byReason['ui-label-only']).toBe(UI_LABEL_APPROVE_CODES.length);
    // 反向：这 13 个不得再出现在另外两类里
    for (const scope of UI_LABEL_APPROVE_CODES) {
      const entry = EXEMPT.find((e) => e.scope === scope)!;
      expect(['module-absent', 'no-scope-enforcement']).not.toContain(entry.reason);
    }
  });
});

/**
 * ★ 专项：Mist 平台命令门禁已真实消费的码（2026-10 平台模块合入后）
 *
 * 口径 B1 时这两个审批码只作 UI 标签；Mist 平台（#45–#53）把采购复核与付款申请
 * 决策接成了命令门禁（mist/context 按持码人解析复核人），bom:admin 则用于 BOM 状态流转。
 * 这里反向钉住真实消费点：若门禁被删，本断言会红；若要回到 B1，须先改口径再改这里。
 */
describe('★ 专项：Mist 平台命令门禁消费的码', () => {
  const GATES: ReadonlyArray<[string, string, string]> = [
    ['quotations:approve', 'shared/mistMarket.ts', "return 'quotations:approve';"],
    ['procurement:approve', 'shared/mistFulfillment.ts', "return 'procurement:approve';"],
    ['finance:payment_request:approve', 'shared/mistPayables.ts', "approve: 'finance:payment_request:approve'"],
    ['bom:admin', 'shared/mistPlatform.ts', "command.type==='platform.bom.transition'?'bom:admin':'bom:write'"],
    // 2026-11 用户定案：付款审批按金额分档、首笔付款加签，审批人须当前持有对应档位码。
    // 2026-11 用户定案：AI 提议确认按命令风险等级要求 ai:write:low/medium/high，高风险须复验密码。
    ['ai:write:low', 'shared/mistAgentProposals.ts', "low: 'ai:write:low'"],
    ['ai:write:medium', 'shared/mistAgentProposals.ts', "medium: 'ai:write:medium'"],
    ['ai:write:high', 'shared/mistAgentProposals.ts', "high: 'ai:write:high'"],
    // 2026-11 改码：退税命令改用 tax:*，锁汇改用 fx:lock（迁移说明见 docs/权限码迁移-退税与锁汇-2026-11.md）。
    ['tax:read', 'mist/access.ts', "permissions: ['tax:read']"],
    ['tax:write', 'shared/mistExportRebate.ts', "write: 'tax:write'"],
    ['tax:approve', 'shared/mistExportRebate.ts', "approve: 'tax:approve'"],
    // 2026-11 补判定点：后台只读、审计导出、知识库 ACL、报价转单、单证模板与印章、胶囊豁免。
    ['users:read', 'admin/route.ts', "requirePermission(['users:read', 'users:admin'])"],
    // 2026-11 审计日志导出须同时持有 users:admin 与 audit:export（L1）。
    ['audit:export', 'admin/route.ts', "requirePermission('users:admin')(req, res, () => requirePermission('audit:export')(req, res, next))"],
    ['knowledge:admin', 'admin/route.ts', "requirePermission('knowledge:admin')"],
    ['quotations:convert', 'shared/mistMarket.ts', "QUOTATION_CONVERT_SCOPE='quotations:convert'"],
    ['sensitive:tax_base', 'mist/access.ts', "if (!hasScope(actor, 'sensitive:tax_base' as PermissionScope)) maskTaxBase(next);"],
    ['fx:lock', 'shared/mistWorkspace.ts', "command.type==='finance.fx.lock'?'fx:lock'"],
    ['vouchers:approve:pay_lt5', 'shared/mistPayables.ts', "pay_lt5: 'vouchers:approve:pay_lt5'"],
    ['vouchers:approve:pay_gt5', 'shared/mistPayables.ts', "pay_gt5: 'vouchers:approve:pay_gt5'"],
    ['vouchers:approve:pay_new_supplier', 'shared/mistPayables.ts', "pay_new_supplier: 'vouchers:approve:pay_new_supplier'"],
    // 2026-11 P1-6：坏账核销、红冲更正与重开结账月须持有核销审批码。
    ['invoices:approve:writeoff', 'shared/mistWorkspace.ts', "command.payload?.kind==='badDebt'||command.payload?.kind==='correction'?'invoices:approve:writeoff'"],
  ];
  it.each(GATES)('%s 不在豁免表且有真实门禁（%s）', (scope, file, needle) => {
    expect(EXEMPT.find((e) => e.scope === scope)).toBeUndefined();
    expect(consumedScopes().has(scope)).toBe(true);
    expect(fs.readFileSync(path.join(SRC, file), 'utf8')).toContain(needle);
  }, SCAN_TIMEOUT_MS);
});
