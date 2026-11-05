/**
 * B129 收口（v3.12）· 订单确认书「提交签署」这一站的**活路径档位证据**
 *
 * 为什么要单独一份：`components/ocSigningContract.test.ts` 那站契约测试原先钉的是**实现字面**
 * （`msg.includes('NO_REVIEWER_RESOLVED') ? 409`）⇒ 它只证明"那行字还在"，不证明"用户拿到 409"。
 * 本批改掉的正是那行字，于是它红了 —— 红得对（判据钉错了对象），但**修法不是把它换个字面接着钉**，
 * 而是补上真正缺的那一层：真抛出的错误经注册表认档。旧 v2 订单路由已下线，路由级用例随之移除。
 *
 * ★ 三条纪律（都是前几批复核教出来的，不是我自己发明的）：
 *   ① 不 mock 审批模块：409 必须来自 `approvalRoutingService` 真抛出 + `shared/errorCodes` 真登记
 *      + `statusFromError` 真查表（mock 掉任何一环，这条绿就与产品行为无关了）；
 *   ② 每条断言只认**一个**值（不许 `[409,500]` 那种"哪种实现都过"的软档）；
 *   ③ 配**反面对照**：把 code 拿掉、同样的文案交给真尺，必须答不出 409 ——
 *      否则"409 来自登记"这句话只是我说的，不是量出来的。
 *
 * ⚠️ 本文件**不声称** B131 已修完：默认兜底档仍是 400，那笔账在 §9 B131 里还开着。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { statusFromError } from '../../shared/bizStatus';
import { lookupErrorCode } from '../../shared/errorCodes';
import { NO_REVIEWER_RESOLVED, createApprovalRoutingService } from '../../approvals/approvalRoutingService';
import { getDatabaseSeedScopeListForRole, SYSTEM_ROLE_IDS } from '../../_shared/rolePermissionMatrix';

/** 申请人；scope 由下方当前数据库角色树加载。 */
const OWNER_ID = 'u-sign-owner';

const ORDER = {
  id: 'ORD__1', code: 'SO-202608-001', poNumber: 'PO-1', customer: 'Peerless', ownerId: OWNER_ID,
  customerRelationId: null, deletedAt: null, status: 'confirmed', currency: 'USD', createdAt: 1780000000000,
  lines: [],
};

/** 任意模型任意方法都返回 null ⇒ "记录查不到"。必须两层（`prisma.order` 得是对象，否则抛的是 TypeError） */
const prismaNull: any = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => null }) });
const ROLE_NAME: Record<string, string> = {
  [SYSTEM_ROLE_IDS.SALES_MANAGER]: '销售主管',
  [SYSTEM_ROLE_IDS.QC]: '质检专员',
};
function currentPrisma(options: { roleId?: string; order?: any | null; orderReadError?: Error; permissionReadError?: Error } = {}): any {
  const roleId = options.roleId ?? SYSTEM_ROLE_IDS.SALES_MANAGER;
  const userId = roleId === SYSTEM_ROLE_IDS.QC ? 'u-sign-qc' : OWNER_ID;
  const role = {
    id: roleId,
    name: ROLE_NAME[roleId] ?? roleId,
    permissions: getDatabaseSeedScopeListForRole(roleId as any).map(scope => ({ permission: { scope } })),
  };
  const user = {
    id: userId, displayName: '签署申请人', status: 'active', deletedAt: null, primaryDeptId: null,
    roles: [{ roleId, departmentId: null, role }],
  };
  const orderDelegate = {
    findFirst: async () => {
      if (options.orderReadError) throw options.orderReadError;
      return options.order ?? null;
    },
    findUnique: async () => options.order ?? null,
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
    order: orderDelegate,
    orderLine: { findMany: async () => [], findFirst: async () => null, findUnique: async () => null },
    shipment: { findMany: async () => [] },
    systemConfig: { findUnique: async () => null },
  };
}
const prismaCurrentOrder = currentPrisma({ order: ORDER });

describe('B129 · 签署请求档位出处：NO_REVIEWER_RESOLVED 由错误码注册表给出 409', () => {
  it('⑥ 出处对账：409 是注册表给的，不是文案给的（把 code 拿掉就答不出 409）', async () => {
    expect(lookupErrorCode(NO_REVIEWER_RESOLVED)?.status, '码没登记 ⇒ 本批的收口不成立').toBe(409);
    // 错误取**产品自己抛的那一枚**（不是我手写的字符串），否则"带码→409"可以靠自造文案蒙绿
    const real: any = await createApprovalRoutingService({ prisma: prismaCurrentOrder } as any)
      .resolveReviewerByDepartment(OWNER_ID).catch((x: any) => x);
    expect(real?.code, '抛方没带 code ⇒ 认档只能靠文案，B68 的病灶就还在').toBe(NO_REVIEWER_RESOLVED);
    expect(statusFromError(real), '带码走注册表').toBe(409);
    const codeless = new Error(String(real.message));
    expect(statusFromError(codeless), '同一句文案、没有码 ⇒ 真尺答不出 409（说明档位来自登记这一步）').not.toBe(409);
    // ★ 实测值打印出来（不写进断言当"预期的 400"）：本批量到的是 **404** —— 真文案含"申请人不存在或已停用"，
    //   撞在第 4 档关键词上，而不是落到默认兜底档。这与 B68 在报关那一站量到的完全一致（同一枚错误、同一把尺）。
    console.log(`[B129 实测] 无码同文案 → ${statusFromError(codeless)}（撞关键词，非默认兜底档；默认档仍是 400，见 §9 B131）`);
  });
});
