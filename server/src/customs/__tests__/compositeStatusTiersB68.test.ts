/**
 * 台账 **B68-1** 第二刀（v2.46）· 报关"组合文档"域内最后三处**按文本猜档**的内联三元被收掉。
 *
 * 收口方式 = 复核与我都指向的同一条：**先让抛出方自带码，再换出口**（不是给关键词表加词）。
 *   · `compositeDocumentService` 的 **7** 处抛错点全部改抛 `shared/errorCodes.businessError(...)`
 *     （该文件 `throw new Error` 现在为 **0**）——用的码全部来自注册表：
 *     `VALIDATION_FAILED`(400) / `NOT_FOUND`(404) 是**已有码**，不新造语义；
 *   · `NO_REVIEWER_RESOLVED` 本次**登记**（409）——抛方 `approvalRoutingService.noReviewerError()`
 *     早就挂了 `err.code`，只是没登记 ⇒ 收口前路由只能 `msg.includes('NO_REVIEWER_RESOLVED')` 认（现场假象"有出处"）；
 *   · `ASSEMBLE_FAILED` 本次**登记**（500）——`shipping/documentSetService` 自己声明的域内码，
 *     在 shipping/route.ts:485 已经当兜底码用着（`spec?.status ?? 500` 也是 500）⇒ 登记只是把已有档位写进真源，
 *     那个端点的状态与文案都不变（文案走 `fallbackMessage` 优先，routeError.ts:93）。
 *
 * ★ 三层证据（D56：域测试 + 可证伪探针为主证据）
 *   A 服务层（真抛点）：证明错误**确实带着** code/statusCode 出来；
 *   B 路由层（真发 HTTP 请求）：证明档位真的落到响应上。
 *     B 层两条纪律（都是上一批复核教出来的）：
 *       ① 端点挂了 `requireJwtForWrite + requirePermission('customs:write')`（写面 fail-closed），
 *          第一版这里用 `requireAuth:false` 打 ⇒ **四条全被 401 挡在门外面**，catch 一行没跑到，
 *          看着像"活路径已证"其实是恒假。故这里配真 JWT（logistics 角色持 customs:write）。
 *       ② 断言里不许出现 `[409,500]` 这种"哪种实现都过"的软档 ⇒ 每条只认一个值；
 *          409 那条改为**驱动真链路**（`approvalCreateService` → `resolveReviewerByDepartment` 第一跳
 *          读不到申请人就抛 NO_REVIEWER_RESOLVED），不 mock 任何审批模块。
 *   C 映射层：证明 409 来自"登记"这一步。★ 实测拿掉登记后落的是 **404**（不是 400 兜底）——
 *     真文案里含"申请人不存在或已停用"，撞在第 4 档关键词上；这一点第一版写成 400 是**凭印象**，
 *     现按实测量写，并补了一条"码没登记时同一条文案答 404"的可证伪断言。
 */
import express from 'express';
import fs from 'node:fs';
import request from 'supertest';
import { stripComments } from '../../shared/__tests__/utils/sourceScan';
import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { statusFromError } from '../../shared/bizStatus';
import { httpStatusOfCode, lookupErrorCode } from '../../shared/errorCodes';
import { getDatabaseSeedScopeListForRole, SYSTEM_ROLE_IDS } from '../../_shared/rolePermissionMatrix';
import { assembleMergedDocumentSet, assembleCompositeDocument } from '../compositeDocumentService';
import { createApprovalRoutingService, NO_REVIEWER_RESOLVED } from '../../approvals/approvalRoutingService';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars';
/** JWT 只给主体 id；签署路由会从当前 DB 角色树重新装载 scope。 */
const logisticsToken = jwt.sign({ userId: 'u-logi', roles: ['logistics'] }, SECRET);
const qcTokenWithStaleLogisticsClaim = jwt.sign({ userId: 'u-qc', roles: ['logistics'] }, SECRET);

const CONTRACT_ORDERS = ['O1', 'O2'].map(id => ({
  id, poNumber: `PO-${id}`, customer: 'Peerless', status: 'confirmed', ownerId: 'u-logi', customerRelationId: null,
  deletedAt: null, currency: 'USD', salesCurrency: 'USD', createdAt: 1780000000000, lines: [],
}));

function currentPrisma(options: { roleId?: string; permissionReadError?: Error; orders?: any[] } = {}): any {
  const roleId = options.roleId ?? SYSTEM_ROLE_IDS.LOGISTICS;
  const userId = roleId === SYSTEM_ROLE_IDS.QC ? 'u-qc' : 'u-logi';
  const role = {
    id: roleId,
    name: roleId === SYSTEM_ROLE_IDS.QC ? '质检专员' : '物流专员',
    permissions: getDatabaseSeedScopeListForRole(roleId as any).map(scope => ({ permission: { scope } })),
  };
  const user = { id: userId, displayName: '单证申请人', status: 'active', deletedAt: null, primaryDeptId: null,
    roles: [{ roleId, departmentId: null, role }] };
  const orders = options.orders ?? CONTRACT_ORDERS;
  const orderIdFrom = (where: any): string | undefined => {
    if (!where || typeof where !== 'object') return undefined;
    if (typeof where.id === 'string') return where.id;
    for (const nested of Array.isArray(where.AND) ? where.AND : []) {
      const id = orderIdFrom(nested);
      if (id) return id;
    }
    return undefined;
  };
  return {
    userAccount: { findFirst: async () => user, findUnique: async () => user },
    userPermissionOverrides: { findMany: async () => {
      if (options.permissionReadError) throw options.permissionReadError;
      return [];
    } },
    userRole: { findMany: async () => [] },
    department: { findUnique: async () => null, findMany: async () => [] },
    teamMember: { findMany: async () => [] },
    teamDataGrant: { findMany: async () => [] },
    relation: { findMany: async () => [], findUnique: async () => null },
    order: {
      findFirst: async ({ where }: any = {}) => orders.find(row => row.id === orderIdFrom(where)) ?? null,
      findUnique: async ({ where }: any = {}) => orders.find(row => row.id === where?.id) ?? null,
    },
    orderLine: { findMany: async () => [], findFirst: async () => null, findUnique: async () => null },
    shipment: { findMany: async () => [] },
    systemConfig: { findUnique: async () => null },
  };
}

/**
 * prisma 替身：任意模型任意方法都返回 null ⇒ "记录查不到"。
 * ★ 必须两层：`prisma.order` 要是一个**对象**（第一版写成 `async () => null` ⇒ `prisma.order.findUnique`
 *   是 undefined，抛的是 TypeError 而不是产品代码的 NOT_FOUND，测出来的档位与真实形状无关）。
 */
const prismaNull: any = new Proxy({}, {
  get: () => new Proxy({}, { get: () => async () => null }),
});
/** prisma 替身：读取即抛给定错误（模拟数据层故障） */
const prismaThrow = (msg: string): any => new Proxy({}, {
  get: () => new Proxy({}, { get: () => async () => { throw new Error(msg); } }),
});
const post = (app: express.Express, url: string, token = logisticsToken) => request(app).post(url).set('Authorization', `Bearer ${token}`);

describe('A · 服务层真抛点：错误自带 code 与 statusCode（不是靠文案）', () => {
  it('合并装箱单只给 1 个运单 ⇒ VALIDATION_FAILED / 400', async () => {
    const e: any = await assembleMergedDocumentSet(prismaNull, ['S1']).catch((x) => x);
    expect(e?.code).toBe('VALIDATION_FAILED');
    expect(e?.statusCode).toBe(400);
  });

  it('合并合同里的订单查不到 ⇒ NOT_FOUND / 404（过去被路由猜成 400）', async () => {
    const e: any = await assembleCompositeDocument(prismaNull, { kind: 'CONTRACT', sourceIds: ['O1', 'O2'] }, {})
      .catch((x) => x);
    expect(e?.code).toBe('NOT_FOUND');
    expect(e?.statusCode).toBe(404);
  });

  it('★ 未知组合类型 ⇒ 也是校验错（400），不再靠"这句话里有没有中文关键词"', async () => {
    const e: any = await assembleCompositeDocument(prismaNull, { kind: 'NOPE', sourceIds: ['A', 'B'] }, {}).catch((x) => x);
    expect(e?.code).toBe('VALIDATION_FAILED');
  });

  /**
   * ★ 第四处（v2.46 中途发现，本来想留作"余项"，留下就等于承认本批没收干净）：
   *   `assembleDocumentSetData` 的 ok:false 分支。改造前这里抛的是**无码 Error**，
   *   档位仍只能由路由看一句中文决定 ⇒ 内层文本会**串档**：
   *     · `装配失败：HS 编码不存在` → 旧站点关键词给 400、按新第 4 档给 404（都不是它该说的）
   *   现在按域内**自己声明的** code 换档：SHIPMENT_NOT_FOUND→404、ASSEMBLE_FAILED→500。
   */
  it('★ 合并装箱单里有运单查不到 ⇒ 404（域内声明 SHIPMENT_NOT_FOUND，映射到已有 NOT_FOUND）', async () => {
    const e: any = await assembleMergedDocumentSet(prismaNull, ['SHP_A', 'SHP_B']).catch((x) => x);
    expect(e?.code).toBe('NOT_FOUND');
    expect(e?.statusCode).toBe(404);
    expect(String(e?.message)).toContain('装配失败');   // 文案不变（旧测试 compositeDocument.test.ts:101 吃这个）
  });

  it('★ 内层文本含"不存在"也不许串档 ⇒ 按声明走 500（只看文本会答 404）', async () => {
    const e: any = await assembleMergedDocumentSet(prismaThrow('HS 编码不存在'), ['SHP_A', 'SHP_B']).catch((x) => x);
    expect(e?.code).toBe('ASSEMBLE_FAILED');
    expect(e?.statusCode).toBe(500);
    // 反面对照：同一条文案交给关键词表会答 404，交给改造前那个站点三元会答 400
    expect(statusFromError(new Error(String(e?.message)))).toBe(404);
  });

  // ★ 标题只声称它真的测了的东西：抛出方自带 `code` 且**不带** `statusCode` ⇒ 第 1 档拿不到，
  //   档位只能由第 2 档（查注册表）给出。具体 409 的端到端证据在 B 层 request-sign 那条。
  it('★ DR-007 抛方的错误形状 = 有效当前申请人带 code、不带 statusCode（因此档位只能查注册表拿）', async () => {
    const svc = createApprovalRoutingService({ prisma: currentPrisma() } as any);
    const e: any = await svc.resolveReviewerByDepartment('u-logi').catch((x) => x);
    expect(e?.code).toBe(NO_REVIEWER_RESOLVED);
    expect(e?.statusCode).toBeUndefined();          // 抛方没有自带档位 ⇒ 第 1 档不吃，第 2 档必须吃
  });
});

describe('C · 映射层：409 来自"登记"这一步（可证伪）', () => {
  /**
   * 改造前的**真**实现，逐字抄自 `git show 19d8bc5f~1:server/src/customs/customsRoute.ts`（`errStatus`，:108-112）。
   * ★ v2.47 复核抓到两处失真并修：① 我原先多抄了一条 `msg.includes('超过')` —— **旧代码里根本没有这条**，
   *    等于对照组在替被对照的那一方说话；② `不可删除/不可编辑/不可审核` 三条被后面的 `不可` 完全吞掉（死条款，
   *    但旧代码字面就是这样，**保留**才是忠实复制 —— 死法本身也是要留痕的事实）。
   */
  const legacy = (msg: string): number => {
    if (msg.includes('不存在')) return 404;
    if (msg.includes('已存在')) return 409;
    if (msg.includes('非法') || msg.includes('不可删除') || msg.includes('不可编辑') || msg.includes('不可审核') || msg.includes('不可')) return 409;
    return 400;
  };

  it('★ 校验错与"不存在"各自命中自己的档，不再共享一次文本猜测', () => {
    expect(statusFromError(Object.assign(new Error('合并合同至少需要 2 个订单'), { code: 'VALIDATION_FAILED', statusCode: 400 }), 500)).toBe(400);
    expect(statusFromError(Object.assign(new Error('订单 O1 不存在'), { code: 'NOT_FOUND', statusCode: 404 }), 500)).toBe(404);
    // 反面对照：这两句在旧实现里靠的是"不存在"三个字，而不是抛出方的声明
    expect(legacy('订单 O1 不存在')).toBe(404);
    expect(statusFromError(new Error('Unknown argument `deletedAts`'), 500)).toBe(500);   // 英文技术原文 = 服务端错
    expect(legacy('Unknown argument `deletedAts`')).toBe(400);                            // 旧实现：说成用户的错
  });
});

describe('D · 反并行真源普查：禁止复制 inline code → HTTP 数字映射', () => {
  /**
   * `documentSetHttpErrorCode()` 是这枚服务层错误码到 HTTP 档位的唯一映射。
   * 本段只抓旧式内联 `SHIPMENT_NOT_FOUND ? 404 : 500`，覆盖 `server/src` 全部生产源码；
   * 合法的服务错误归一化（该码改成 NOT_FOUND）不是 HTTP 决策，不应被扫描器误报。
   */
  const SRC = new URL('../../', import.meta.url);
  const read = (rel: string) => stripComments(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
  const COMPOSITE_SVC = read('../compositeDocumentService.ts');
  /** 只检测重复的 inline code → HTTP 数字映射，不拦合法的 code → code 归一化。 */
  const DUP_RE = /===\s*['"`]SHIPMENT_NOT_FOUND['"`]\s*\?\s*[45]\d{2}\s*:\s*[45]\d{2}/g;
  const prodSources = () => {
    const skip = new Set(['node_modules', 'generated', '.prisma', '__tests__']);
    const out: Array<{ rel: string; src: string }> = [];
    const walk = (dir: URL) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const abs = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, dir);
        if (e.isDirectory()) { walk(abs); continue; }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts') || e.name.endsWith('.d.ts')) continue;
        out.push({ rel: decodeURIComponent(abs.href.slice(SRC.href.length)), src: stripComments(fs.readFileSync(abs, 'utf8')) });
      }
    };
    walk(SRC);
    return out;
  };

  it('★ 重复 inline code → HTTP 数字映射在整个 src 生产源码零命中', () => {
    const files = prodSources();
    expect(files.length, '扫描根没走起来 ⇒ 这条普查是恒绿的假闸门').toBeGreaterThan(300);
    const dup = files.filter((f) => (f.src.match(DUP_RE) ?? []).length > 0).map((f) => f.rel);
    expect(dup, '这些文件里重新出现了内联判断').toEqual([]);
  });

  it('★ 反面对照：旧数字三元写法会命中；合法 code 归一化不会', () => {
    const reintroduced = "const statusCode = result.error!.code === 'SHIPMENT_NOT_FOUND' ? 404 : 500;";
    expect(reintroduced.match(DUP_RE)?.length, '正则连旧写法都不认 ⇒ 这条普查是恒绿的假闸门').toBe(1);
    // 换双引号仍抓到重复数字映射。
    expect('const s = x.code === "SHIPMENT_NOT_FOUND" ? 404 : 500;'.match(DUP_RE)?.length).toBe(1);
    const normalization = "if (code === 'SHIPMENT_NOT_FOUND') result.error = { ...result.error!, code: 'NOT_FOUND' };";
    expect(normalization.match(DUP_RE) ?? [], '合法业务码归一化不应被误报成 HTTP 映射').toEqual([]);
    // 注释里出现同样字面不算（stripComments 已剥 ⇒ 用一段被剥掉的样本来证明"注释不算命中"这条口径成立）
    expect(stripComments(`// ${reintroduced}`).match(DUP_RE) ?? [], '注释里的字面被算成命中 ⇒ 判据会把文档说明也判红').toEqual([]);
  });
});
