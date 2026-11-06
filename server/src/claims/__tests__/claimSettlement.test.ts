/**
 * claimCaseService + claimSettlement 单测
 *
 * 口径：`docs/业务口径决策单-2026-09-17.md` **A1 · A1-附 ①②③ · A5 · A7**
 *
 * 承重项：
 *   · A1-附 ③ —— 动货的处置**必须记去向**（不记清 ⇒ 货在账上凭空消失）
 *   · 一期范围 —— Replace/Repair **显式拒绝**（不是静默接受）
 *   · A7 —— **未审批不可执行**
 *   · 收口点 —— Allowance 只开退款单；ReturnRefund **两张单都开**
 *   · A5 —— 有已执行处置的案件**不可撤销**
 */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  addDisposition,
  cancelClaimCase,
  createClaimCase,
  validateDispositionInput,
  approveDisposition,
} from '../claimCaseService';
import { assertClaimDecisionAuthority, buildClaimApprovalPayload, CLAIM_APPROVAL_ACTION, CLAIM_APPROVAL_TARGET } from '../claimApprovalFact';

/** 内存 mock：claimCase / claimDisposition / creditNote / returnReceipt / materialReturn / businessSequence */
function makePrisma() {
  const T: Record<string, any[]> = {
    claimCase: [], claimDisposition: [], creditNote: [], returnReceipt: [], materialReturn: [],
    claimCreditNoteLine: [], creditNoteDocumentVersion: [], creditNoteSettlementEvent: [], creditNoteAllocation: [],
    creditNoteRefundReturn: [], // No actual bank-return fact in these original offset/version fixtures.
    creditNoteRefund: [], // Existing execution/replay fixtures have no cash reservation.
    // ★ A-3 二期：补发复用 Shipment · 返修独立工单
    shipment: [], repairWorkOrder: [], approvalRequest: [], auditLog: [], returnReceiptLine: [],
    warehouse: [{ id: 'WH_1', isActive: true, deletedAt: null }],
    workStation: [{ id: 'WS_1', isActive: true, deletedAt: null }],
    shipmentLine: [], shipmentCarton: [], shipmentCartonItem: [], fabricCustomerCode: [], productAsset: [],
    // Persisted source facts now verified at case creation, independent of names.
    relation: [{ id: 'R1', name: 'ACME', category: 'Customer', deletedAt: null }],
    order: [{ id: 'SO_1', customerRelationId: 'R1', deletedAt: null }],
    invoice: [{ id: 'INV_1', orderId: 'SO_1', customerRelationId: 'R1', type: 'Receivable', deletedAt: null }],
    invoiceOrderAllocation: [],
    // New shipment source/packing reads must observe explicit empty persisted tables.
    shipmentOrderAllocation: [], shipmentProductionAllocation: [], productionBatch: [],
    orderLine: [], releaseScope: [],
  };
  const seqs: Record<string, number> = {};
  /** 极简 where 求值：null 与 undefined 视作相等（否则 `deletedAt: null` 会把行全滤掉） */
  const eq = (a: any, b: any) => (a ?? null) === (b ?? null);
  const matches = (row: any, where: any) => !where || Object.entries(where).every(([k, v]: any) => {
    if (k === 'OR') return v.some((part: any) => matches(row, part));
    if (k === 'detail' && v?.path) return eq(v.path.reduce((current: any, key: string) => current?.[key], row.detail), v.equals);
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'notIn' in v) return !v.notIn.includes(row[k]);
    if (v && typeof v === 'object' && 'not' in v) return !eq(row[k], v.not);
    return eq(row[k], v);
  });
  const table = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => T[name].find(r => matches(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: any) => T[name].find(r => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: any = {}) => T[name].filter(r => matches(r, where))),
    count: vi.fn(async ({ where }: any = {}) => T[name].filter(r => matches(r, where)).length),
    deleteMany: vi.fn(async ({ where }: any) => { const n = T[name].filter(r => matches(r, where)).length; T[name] = T[name].filter(r => !matches(r, where)); return { count: n }; }),
    create: vi.fn(async ({ data }: any) => { T[name].push(data); return data; }),
    update: vi.fn(async ({ where, data }: any) => {
      const i = T[name].findIndex(r => r.id === where.id);
      // 支持 { increment }
      const merged: any = { ...T[name][i] };
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in (v as any)) {
          merged[k] = new Prisma.Decimal(merged[k] ?? 0).plus((v as any).increment);
        } else merged[k] = v;
      }
      T[name][i] = merged;
      return merged;
    }),
  });
  const dispositionTable = table('claimDisposition');
  const prisma: any = {
    claimCase: table('claimCase'),
    claimDisposition: { ...dispositionTable, updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = T.claimDisposition.filter(r => matches(r, where));
      for (const row of rows) await dispositionTable.update({ where: { id: row.id }, data });
      return { count: rows.length };
    }) },
    creditNote: table('creditNote'),
    claimCreditNoteLine: table('claimCreditNoteLine'), creditNoteDocumentVersion: table('creditNoteDocumentVersion'),
    creditNoteSettlementEvent: table('creditNoteSettlementEvent'), creditNoteAllocation: table('creditNoteAllocation'),
    creditNoteRefund: table('creditNoteRefund'),
    creditNoteRefundReturn: table('creditNoteRefundReturn'),
    returnReceipt: table('returnReceipt'),
    returnReceiptLine: table('returnReceiptLine'),
    warehouse: table('warehouse'),
    workStation: table('workStation'),
    materialReturn: table('materialReturn'),
    shipment: table('shipment'),
    shipmentLine: table('shipmentLine'), shipmentCarton: table('shipmentCarton'), shipmentCartonItem: table('shipmentCartonItem'),
    fabricCustomerCode: table('fabricCustomerCode'), productAsset: table('productAsset'),
    repairWorkOrder: table('repairWorkOrder'),
    approvalRequest: table('approvalRequest'),
    auditLog: table('auditLog'),
    relation: table('relation'), order: table('order'), invoice: table('invoice'), invoiceOrderAllocation: table('invoiceOrderAllocation'),
    businessSequence: {
      upsert: vi.fn(async ({ where }: any) => { seqs[where.id] = (seqs[where.id] ?? 0) + 1; return { id: where.id, seq: seqs[where.id] }; }),
      update: vi.fn(async ({ where, data }: any) => { seqs[where.id] = (seqs[where.id] ?? 0) + (data.seq?.increment ?? 0); return { id: where.id, seq: seqs[where.id] }; }),
      findUnique: vi.fn(async ({ where }: any) => (seqs[where.id] != null ? { id: where.id, seq: seqs[where.id] } : null)),
    },
    shipmentOrderAllocation: table('shipmentOrderAllocation'), shipmentProductionAllocation: table('shipmentProductionAllocation'),
    productionBatch: table('productionBatch'), orderLine: table('orderLine'), releaseScope: table('releaseScope'),
    $queryRaw: vi.fn(async (query: any) => {
      const sql = query.strings.join(' ');
      if (!/FROM "Shipment"/.test(sql) || !/FOR UPDATE/.test(sql)) throw new Error('Unexpected tagged source lock in claim fixture');
      return T.shipment.filter(row => row.id === query.values[0]).map(row => ({ id: row.id }));
    }),
    $queryRawUnsafe: vi.fn(async () => []),
    // Storage rollback model only: no real PostgreSQL locking/concurrency proof.
    $transaction: vi.fn(async (fn: any) => {
      const before = Object.fromEntries(Object.entries(T).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
      const sequences = { ...seqs };
      try { return await fn(prisma); } catch (error) {
        for (const name of Object.keys(T)) T[name] = before[name];
        for (const name of Object.keys(seqs)) delete seqs[name];
        Object.assign(seqs, sequences);
        throw error;
      }
    }),
    _t: T,
  };
  return prisma;
}

/** Explicit committed leader decision fixture. This is not a company-account or kernel test. */
function recordApprovedFact(prisma: any, disposition: any) {
  const claimCase = prisma._t.claimCase.find((row: any) => row.id === disposition.claimCaseId);
  const payload = buildClaimApprovalPayload(disposition, claimCase);
  const id = `APR_${disposition.id}`;
  const decidedAt = new Date('2026-10-01T01:00:00Z');
  prisma._t.approvalRequest.push({ id, requesterId: 'u1', reviewerId: 'boss', status: 'approved',
    actionType: CLAIM_APPROVAL_ACTION, targetType: CLAIM_APPROVAL_TARGET, targetId: disposition.id,
    payload, decidedAt, createdAt: new Date('2026-10-01T00:00:00Z') });
  prisma._t.auditLog.push({ id: `AUDIT_${id}`, actorId: 'boss', targetType: 'ApprovalRequest', targetId: id,
    detail: { decisionActorAuthority: { userId: 'boss', roleIds: ['role-admin'], authorizationLoaded: true },
      approvalDecisionFact: { schemaVersion: 1, status: 'approved', actionType: CLAIM_APPROVAL_ACTION,
        targetType: CLAIM_APPROVAL_TARGET, targetId: disposition.id, contentFingerprint: payload.contentFingerprint,
        decisionActorId: 'boss', decidedAt: decidedAt.toISOString() } } });
}

describe('★ 口径 A1：处置输入校验（四种处置 × 动不动钱货）', () => {
  it('Allowance（只动钱）：金额 + 币种必填；**不需要**数量/去向', () => {
    expect(validateDispositionInput({ kind: 'Allowance', amount: 500, currency: 'USD' }).ok).toBe(true);
    expect(validateDispositionInput({ kind: 'Allowance', currency: 'USD' }).error?.code).toBe('VALIDATION_FAILED');
    expect(validateDispositionInput({ kind: 'Allowance', amount: 500 }).error?.code).toBe('VALIDATION_FAILED');
  });

  it('★ 承重 A1-附 ③：ReturnRefund 缺**退货去向** → 拒绝（不记清去向，货会在账上凭空消失）', () => {
    const base = { kind: 'ReturnRefund', amount: 500, currency: 'USD', quantity: 30, unit: 'PCS' };
    const r = validateDispositionInput(base);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_FAILED');
    expect(r.error!.message).toContain('退货去向');

    expect(validateDispositionInput({ ...base, returnDisposition: 'Scrap' }).ok).toBe(true);
    expect(validateDispositionInput({ ...base, returnDisposition: '乱填' }).ok).toBe(false);
  });

  it('★ A-3 二期：**四种全部支持**（原先「一期只支持两种」的限制已解除）', () => {
    // 折让 / 退货退款
    expect(validateDispositionInput({ kind: 'Allowance', amount: 500, currency: 'USD' }).ok).toBe(true);
    expect(validateDispositionInput({ kind: 'ReturnRefund', amount: 500, currency: 'USD', quantity: 30, unit: 'PCS', returnDisposition: 'Scrap' }).ok).toBe(true);
    // ★ 二期新增：换货补发 / 返修 —— 同样「只动货」，故同样要求 数量 + 单位 + 去向
    expect(validateDispositionInput({ kind: 'Replace', quantity: 30, unit: 'PCS', returnDisposition: 'Replace' }).ok).toBe(true);
    expect(validateDispositionInput({ kind: 'Repair', quantity: 30, unit: 'PCS', returnDisposition: 'Repair' }).ok).toBe(true);
    // 但**动货的三项必填**对它们同样成立（缺去向仍拒）
    expect(validateDispositionInput({ kind: 'Repair', quantity: 30, unit: 'PCS' }).error?.code).toBe('VALIDATION_FAILED');
  });

  it('非法 kind → 拒绝', () => {
    expect(validateDispositionInput({ kind: 'Nope' }).error?.code).toBe('VALIDATION_FAILED');
  });

  it('★ 口径 A6：0 元 / 0 数量 → 拒绝', () => {
    expect(validateDispositionInput({ kind: 'Allowance', amount: 0, currency: 'USD' }).ok).toBe(false);
    expect(validateDispositionInput({ kind: 'ReturnRefund', amount: 1, currency: 'USD', quantity: 0, unit: 'PCS', returnDisposition: 'Scrap' }).ok).toBe(false);
  });
});

describe('★ 案件登记与处置追加', () => {
  it('登记案件：取号 CLM + 状态 Registered', async () => {
    const prisma = makePrisma();
    const r = await createClaimCase(prisma, { problemDesc: '色差严重', customerName: 'ACME' }, 'u1');
    expect(r.ok).toBe(true);
    expect(r.data!.claimCase.status).toBe('Registered');
    expect(r.data!.claimCase.caseNumber).toMatch(/^CLM-\d{4}-\d{4}$/);
  });

  it('问题描述必填', async () => {
    const prisma = makePrisma();
    expect((await createClaimCase(prisma, { problemDesc: '  ' }, 'u1')).error?.code).toBe('VALIDATION_FAILED');
  });

  it('加处置后案件进入 Processing；处置初始 Draft', async () => {
    const prisma = makePrisma();
    const c = (await createClaimCase(prisma, { problemDesc: '短装' }, 'u1')).data!.claimCase;
    const r = await addDisposition(prisma, c.id, { kind: 'Allowance', amount: 300, currency: 'USD' }, 'u1');
    expect(r.ok).toBe(true);
    expect(r.data!.disposition.status).toBe('Draft');
    expect(prisma._t.claimCase[0].status).toBe('Processing');
  });

  it('案件不存在 / 已撤销 → 不可加处置', async () => {
    const prisma = makePrisma();
    expect((await addDisposition(prisma, 'nope', { kind: 'Allowance', amount: 1, currency: 'USD' }, 'u1')).error?.code).toBe('NOT_FOUND');
    prisma._t.claimCase.push({ id: 'C1', status: 'Cancelled', deletedAt: null });
    expect((await addDisposition(prisma, 'C1', { kind: 'Allowance', amount: 1, currency: 'USD' }, 'u1')).error?.code).toBe('INVALID_STATE');
  });
});

describe('★ 口径 A5：撤销案件（能撤销 + 留痕）', () => {
  it('★ 承重：未执行的案件可撤销，且处置一并作废 + 留痕', async () => {
    const prisma = makePrisma();
    const c = (await createClaimCase(prisma, { problemDesc: 'x' }, 'u1')).data!.claimCase;
    await addDisposition(prisma, c.id, { kind: 'Allowance', amount: 100, currency: 'USD' }, 'u1');

    const r = await cancelClaimCase(prisma, c.id, '客户撤诉', 'u1');
    expect(r.ok).toBe(true);
    expect(r.data!.cancelledDispositions).toBe(1);
    expect(prisma._t.claimCase[0].status).toBe('Cancelled');
    expect(prisma._t.claimDisposition[0].status).toBe('Cancelled');
    expect(prisma._t.claimDisposition[0].cancelReason).toBe('客户撤诉');
  });

  it('撤销必须填理由', async () => {
    const prisma = makePrisma();
    const c = (await createClaimCase(prisma, { problemDesc: 'x' }, 'u1')).data!.claimCase;
    expect((await cancelClaimCase(prisma, c.id, '  ', 'u1')).error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('索赔批准事实与事务边界（存储替身；真 PG 并发/回滚由独立探针验证）', () => {
  async function setup(input: any = { kind: 'Allowance', amount: 500, currency: 'USD' }) {
    const prisma = makePrisma();
    const c = (await createClaimCase(prisma, { problemDesc: '色差', customerName: 'ACME', sourceInvoiceId: 'INV_1', sourceOrderId: 'SO_1' }, 'u1')).data!.claimCase;
    const d = (await addDisposition(prisma, c.id, { materialCode: 'SKU_1', ...input }, 'u1')).data!.disposition;
    return { prisma, c, d };
  }

  it('无内核事实不能直接把 Draft 批成 Approved', async () => {
    const { prisma, d } = await setup();
    expect((await approveDisposition(prisma, d.id, 'u1')).error?.code).toBe('INVALID_STATE');
    expect(prisma._t.claimDisposition[0].status).toBe('Draft');
    expect(prisma._t.auditLog).toHaveLength(0);
  });

  it('完整快照独立检查金额、数量、单位、物料、币种、去向、来源内容；状态汇总不变更版本', async () => {
    const { c, d } = await setup({ kind: 'ReturnRefund', amount: '500.25', currency: 'USD', quantity: '20.5', unit: 'PCS', materialCode: 'MAT_1', returnDisposition: 'Scrap', notes: '原因' });
    const payload = buildClaimApprovalPayload(d, c);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.content.disposition).toMatchObject({ amount: '500.25', currency: 'USD', quantity: '20.5', unit: 'PCS', materialCode: 'MAT_1', returnDisposition: 'Scrap', notes: '原因' });
    expect(payload.content.claimCase).toMatchObject({ sourceInvoiceId: 'INV_1', sourceOrderId: 'SO_1', problemDesc: '色差', reportedBy: 'u1' });
    expect(buildClaimApprovalPayload({ ...d, status: 'Approved', updatedAt: BigInt(999) }, { ...c, status: 'Handled', totalCreditAmount: 99, updatedAt: BigInt(999) }).contentFingerprint).toBe(payload.contentFingerprint);
    expect(buildClaimApprovalPayload({ ...d, unit: 'M' }, c).contentFingerprint).not.toBe(payload.contentFingerprint);
    expect(buildClaimApprovalPayload(d, { ...c, sourceInvoiceId: 'INV_2' }).contentFingerprint).not.toBe(payload.contentFingerprint);
  });

  it.each(['actionType', 'targetType', 'targetId', 'schemaVersion', 'materialCode', 'unit', 'quantity', 'sourceInvoiceId', 'decisionAudit'])('%s 错配/缺失不能消费批准', async field => {
    const { prisma, d } = await setup({ kind: 'ReturnRefund', amount: 500, currency: 'USD', quantity: 20, unit: 'PCS', materialCode: 'MAT_1', returnDisposition: 'Scrap' });
    recordApprovedFact(prisma, d);
    const approval = prisma._t.approvalRequest[0];
    if (['actionType', 'targetType', 'targetId'].includes(field)) approval[field] = 'wrong';
    else if (field === 'schemaVersion') approval.payload.schemaVersion = 0;
    else if (field === 'sourceInvoiceId') prisma._t.claimCase[0].sourceInvoiceId = 'INV_2';
    else if (field === 'decisionAudit') prisma._t.auditLog = [];
    else prisma._t.claimDisposition[0][field] = field === 'quantity' ? new Prisma.Decimal(21) : 'changed';
    expect((await approveDisposition(prisma, d.id, 'u1')).error?.code).toBe('INVALID_STATE');
    expect(prisma._t.claimDisposition[0].status).toBe('Draft');
    expect(prisma._t.creditNote).toHaveLength(0);
  });

  it('推进者不冒充实际领导；重复 hook 保留同一批准事实', async () => {
    const { prisma, d } = await setup();
    recordApprovedFact(prisma, d);
    const advanced = await approveDisposition(prisma, d.id, 'u1');
    expect(advanced.data!.disposition.approverId).toBe('boss');
    expect(prisma._t.auditLog.find((row: any) => row.action === 'advance-approved')).toMatchObject({ actorId: 'u1', detail: { after: { decisionActorId: 'boss' } } });
    const before = prisma._t.auditLog.length;
    expect((await approveDisposition(prisma, d.id, 'u1')).ok).toBe(true);
    expect(prisma._t.auditLog).toHaveLength(before);
  });

  it('未决更新不能恢复旧已批准内容', async () => {
    const { prisma, d } = await setup();
    recordApprovedFact(prisma, d);
    prisma._t.approvalRequest.push({ ...prisma._t.approvalRequest[0], id: 'PENDING_NEW', status: 'pending', createdAt: new Date('2026-10-02') });
    expect((await approveDisposition(prisma, d.id, 'u1')).error?.code).toBe('INVALID_STATE');
    expect(prisma._t.claimDisposition[0].status).toBe('Draft');
  });

  it('决议授权读取当前真实 ADMIN roleId；JWT/自定义 role name/委派主管不足', async () => {
    const { prisma, d } = await setup();
    const approval = { actionType: CLAIM_APPROVAL_ACTION, targetType: CLAIM_APPROVAL_TARGET, targetId: d.id, payload: buildClaimApprovalPayload(d, prisma._t.claimCase[0]) };
    prisma.userAccount = { findFirst: vi.fn(async () => ({ id: 'manager' })) };
    prisma.userRole = { findMany: vi.fn(async () => [{ roleId: 'role-sales-manager' }]) };
    await expect(assertClaimDecisionAuthority(prisma, approval, { userId: 'manager' }, 'normal')).rejects.toMatchObject({ code: 'CLAIM_LEADER_REQUIRED', statusCode: 403 });
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-admin' }]);
    expect(await assertClaimDecisionAuthority(prisma, approval, { userId: 'leader' }, 'normal')).toMatchObject({ userId: 'leader', roleIds: ['role-admin'], authorizationLoaded: true });
  });
});
