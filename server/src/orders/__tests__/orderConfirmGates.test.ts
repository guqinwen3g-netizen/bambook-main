/**
 * orderConfirmGates.test.ts — W-A 走查 P0 死胡同回归
 *
 * P0-1（DE-1）信用门禁接线：
 *   - orderServiceV2.createOrder 对 Frozen/Revoked/Net61+ 逾期客户 fail-closed（403 码族）
 *   - transitionOrderStatus 进入 Confirmed 同样门禁（V1/V2/Agent 全路径单引擎）
 * P0-2（DE-2/DE-4）确认路径统一：
 *   - V1 status-transition 发布 OrderStatusChanged + OrderConfirmed（L1 生产管线 / L6 BOM 联动触发源）
 *   - V2 PATCH 委托同一引擎后同样发事件；V1 补齐 MOQ Confirmed 门禁
 * P0-3（DE-6）信用证门禁码不塌成 INTERNAL_ERROR（服务层）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── mock 平台依赖（与 orderServiceV2.test.ts 同口径） ──
vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../events/businessEventBus', async (importOriginal) => ({
  ...await importOriginal<any>(),
  publishBusinessEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../auth/permissionService', async original => ({
  // Only storage-dependent scope resolution is replaced. The HTTP middleware
  // must keep its actual hasScope implementation and original status probes.
  ...await original<typeof import('../../auth/permissionService')>(),
  createPermissionService: vi.fn(() => ({
    getDataScopeResolver: vi.fn().mockResolvedValue({ rule: { kind: 'all' }, allowedDepartmentIds: [], allowedUserIds: [] }),
  })),
  ROLE_ID_TO_LEGACY_AGENT_ROLE: {},
}));

vi.mock('../../sequence/sequenceService', () => ({
  createSequenceService: vi.fn(() => ({
    nextNumber: vi.fn().mockResolvedValue('SO-202608-001'),
  })),
}));

vi.mock('../../dictionaries/dataDictionaryService', () => ({
  getDataDictionaryService: vi.fn(() => ({
    getEntries: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../config/systemConfigService', () => ({
  getSystemConfigService: vi.fn(() => ({
    getString: vi.fn().mockResolvedValue('USD'),
  })),
}));

vi.mock('../../teams/teamShareService', () => ({
  createTeamShareService: vi.fn(() => ({
    hasRelationWriteAccess: vi.fn().mockResolvedValue(true),
    resolveVisibleRelationIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../approvals/approvalRoutingService', () => ({
  createApprovalRoutingService: vi.fn(() => ({})),
}));

// MOQ 豁免审批单统一经 approvalCreateService（DR-007）；mock 固定回单号验证透传
const MOCK_APPROVAL_ID = 'APR__MOCK__1';
vi.mock('../../approvals/approvalCreateService', () => ({
  createApprovalCreateService: vi.fn(() => ({
    createBusinessApproval: vi.fn().mockResolvedValue({ id: MOCK_APPROVAL_ID }),
  })),
}));

import { transitionOrderStatus } from '../orderLifecycleService';
import { publishBusinessEvent } from '../../events/businessEventBus';

// ── helpers ──
const ACTOR = { userId: 'user_1', departmentIds: ['dept_1'], roles: ['admin'] } as any;

function makeOrder(overrides: any = {}) {
  return {
    id: 'ORD__1',
    code: 'SO-202608-001',
    customer: 'Peerless',
    product: 'Cotton Twill',
    type: 'Fabric',
    businessLine: 'fabric',
    quantity: 1000,
    status: 'Pending',
    dueDate: '2026-09-01',
    quoteAmount: 10000,
    currency: 'USD',
    capsuleExemption: false,
    moqSnapshot: null,
    customerRelationId: null,
    ownerId: 'user_1',
    deletedAt: null,
    createdAt: BigInt(0),
    updatedAt: BigInt(0),
    lines: [],
    ...overrides,
  };
}

function makeCreditLimit(overrides: any = {}) {
  return {
    id: 'CL__1',
    relationId: 'REL__1',
    status: 'Active',
    totalLimit: 100000,
    usedAmount: 0,
    currency: 'USD',
    frozenAt: null,
    frozenBy: null,
    thawedReason: null,
    lastAutoScanDate: null,
    ...overrides,
  };
}

function makePrisma(opts: {
  order?: any;
  creditLimit?: any;
  invoices?: any[];
  approvedMoqExemption?: any;
  exceptions?: any[];
} = {}) {
  const order = 'order' in opts ? opts.order : makeOrder();
  // DE-5：信用例外流程读写 Dr013ExceptionRequest（hasActiveException 查询 / 自动发起落库）
  const dr013ExceptionRequest = {
    findMany: vi.fn().mockResolvedValue(opts.exceptions ?? []),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data })),
    update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
  };
  const tx = {
    agentJob: { create: vi.fn().mockResolvedValue({}) },
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ ...order, ...data, id: where.id })),
    },
    orderStatusTransition: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    dr013ExceptionRequest,
    entityLink: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    entityReference: { upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      findFirst: vi.fn().mockResolvedValue(order),
      findMany: vi.fn().mockResolvedValue(order ? [order] : []),
      count: vi.fn().mockResolvedValue(order ? 1 : 0),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, id: data.id ?? 'ORD__NEW', lines: [] })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    orderStatusTransition: { create: tx.orderStatusTransition.create },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    creditLimit: { findFirst: vi.fn().mockResolvedValue(opts.creditLimit ?? null), findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue(opts.invoices ?? []), count: vi.fn().mockResolvedValue(0) },
    approvalRequest: {
      findFirst: vi.fn().mockResolvedValue(opts.approvedMoqExemption ?? null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    dr013ExceptionRequest,
    // G-4：L/C 门禁要查信用证表。默认给空表（本文件其余用例都是非信用证订单，不会走到这里）。
    //   ⚠️ 不是"缺 delegate"：缺了会被 lcGate 内部的 catch 兜成 LC_QUERY_FAILED，测试会**为错误的原因变绿**。
    letterOfCredit: { findMany: vi.fn().mockResolvedValue([]) },
    entityLink: tx.entityLink,
    entityReference: tx.entityReference,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  } as any;
  return { prisma, tx, order, dr013ExceptionRequest };
}

beforeEach(() => { vi.clearAllMocks(); });

// ═══════════════════════════════════════════════════════════════
// P0-1（DE-1）信用门禁：transitionOrderStatus 进入 Confirmed
// ═══════════════════════════════════════════════════════════════
describe('P0-1 信用门禁：Confirmed 流转 fail-closed', () => {
  it('Frozen 客户确认被阻断（CREDIT_FROZEN_60_DAYS），无状态写入、无事件', async () => {
    const { prisma, tx } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__F' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__F', status: 'Frozen', frozenBy: 'system_credit_scan', frozenAt: new Date() }),
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CREDIT_FROZEN_60_DAYS');
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderStatusTransition.create).not.toHaveBeenCalled();
    expect(publishBusinessEvent).not.toHaveBeenCalled();
  });

  it('Revoked（吊销）客户确认被阻断（CREDIT_REVOKED）', async () => {
    const { prisma } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__R' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__R', status: 'Revoked' }),
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CREDIT_REVOKED');
  });

  it('Active 额度但 Net61+ 逾期未结清 → OVERDUE_60_DAYS（调度遗漏兜底）', async () => {
    const overdueDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { prisma } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__O' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__O', status: 'Active' }),
      // ★ 必须有 amount：「未结清应收」判据含 `amount > 0` 守卫（shared/openReceivable）
      //   → 缺这个字段会让该票被当成「不欠钱」跳过，本用例就永远拿不到 OVERDUE_60_DAYS。
      invoices: [{ id: 'INV__1', amount: '1000', dueDate: overdueDate, issueDate: overdueDate, status: 'Issued', type: 'Receivable', customerRelationId: 'REL__O' }],
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('OVERDUE_60_DAYS');
  });

  it('Active 客户确认放行：状态写入 + OrderStatusChanged/OrderConfirmed 事件发布（P0-2 联动源）', async () => {
    const { prisma, tx } = makePrisma({
      order: makeOrder({ customerRelationId: 'REL__A' }),
      creditLimit: makeCreditLimit({ relationId: 'REL__A', status: 'Active' }),
    });
    const r = await transitionOrderStatus({ prisma, orderId: 'ORD__1', toStatus: 'Confirmed', actorId: 'user_1' });
    expect(r.ok).toBe(true);
    expect(tx.order.update).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusTransition.create).toHaveBeenCalledTimes(1);
    const eventTypes = (publishBusinessEvent as any).mock.calls.map((c: any[]) => c[0]?.type);
    expect(eventTypes).toContain('OrderStatusChanged');
    expect(eventTypes).toContain('OrderConfirmed');
  });
});