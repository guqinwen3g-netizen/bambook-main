/** Storage/decision fixtures exercise production services; they do not prove
 * real PostgreSQL concurrency, audit FKs or actual leader-account configuration. */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createClaimCase, addDisposition, approveDisposition } from '../claimCaseService';
import { appendClaimCreditNoteInTx, getClaimCreditNote, getCreditNoteVersions, issueClaimCreditNoteVersion } from '../claimCreditNoteVersionService';
import { buildClaimApprovalPayload, CLAIM_APPROVAL_ACTION, CLAIM_APPROVAL_TARGET, ClaimTransactionError, lockClaimRows, readClaimApprovedFact } from '../claimApprovalFact';
vi.mock('../../credit/creditService', () => ({ notifyCustomerCreditRecalc: vi.fn(async () => undefined) }));
vi.mock('../../finance/orderAutoSettlement', () => ({ syncOrderAutoSettlementByInvoice: vi.fn(async () => undefined) }));

function makePrisma() {
  const T: Record<string, any[]> = {
    relation: [{ id: 'R1', name: 'ACME', category: 'Customer', deletedAt: null }],
    claimCase: [], claimDisposition: [], creditNote: [], returnReceipt: [], materialReturn: [],
    claimCreditNoteLine: [], creditNoteDocumentVersion: [], creditNoteSettlementEvent: [], creditNoteAllocation: [], invoice: [], invoiceAllocation: [],
    creditNoteRefundReturn: [], // No actual bank-return fact in these original offset/version fixtures.
    creditNoteRefund: [], // No cash reservation in these original CN version/offset scenarios.
    // ★ A-3 二期：补发复用 Shipment · 返修独立工单
    shipment: [], repairWorkOrder: [], approvalRequest: [], auditLog: [], returnReceiptLine: [],
    warehouse: [{ id: 'WH_1', isActive: true, deletedAt: null }],
    workStation: [{ id: 'WS_1', isActive: true, deletedAt: null }],
    shipmentLine: [], shipmentCarton: [], shipmentCartonItem: [], fabricCustomerCode: [], productAsset: [],
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
    findUnique: vi.fn(async ({ where }: any) => T[name].find(r => matches(r, Object.values(where)[0] && typeof Object.values(where)[0] === 'object' ? Object.values(where)[0] : where)) ?? null),
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
    auditLog: table('auditLog'), invoice: table('invoice'), invoiceAllocation: table('invoiceAllocation'),
    relation: table('relation'),
    businessSequence: {
      upsert: vi.fn(async ({ where }: any) => { seqs[where.id] = (seqs[where.id] ?? 0) + 1; return { id: where.id, seq: seqs[where.id] }; }),
      update: vi.fn(async ({ where, data }: any) => { seqs[where.id] = (seqs[where.id] ?? 0) + (data.seq?.increment ?? 0); return { id: where.id, seq: seqs[where.id] }; }),
      findUnique: vi.fn(async ({ where }: any) => (seqs[where.id] != null ? { id: where.id, seq: seqs[where.id] } : null)),
    },
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
  prisma.creditNoteAllocation.upsert = vi.fn(async ({ where, update, create }: any) => {
    const row = await prisma.creditNoteAllocation.findUnique({ where });
    return row ? prisma.creditNoteAllocation.update({ where: { id: row.id }, data: update }) : prisma.creditNoteAllocation.create({ data: create });
  });
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


async function setup() {
  const prisma = makePrisma();
  const claimCase = (await createClaimCase(prisma, { problemDesc: '真实金额处置', customerRelationId: 'R1', customerName: 'ACME' }, 'u1')).data!.claimCase;
  prisma._t.invoice.push({ id: 'INV_1', type: 'Receivable', status: 'Issued', customerRelationId: 'R1', currency: 'USD', amount: new Prisma.Decimal(1000), deletedAt: null });
  return { prisma, claimCase };
}
/** 2026-11-06: the legacy claimSettlement.executeDisposition / creditNoteService producers were deleted with the
 * main API. This drives the live append producer they called, under the same row locks and exact approval fact;
 * only the execution facts the live account check reads are recorded (no return/replacement/repair outputs or audit). */
async function appendApproved(prisma: any, dispositionId: string, requestId: string) {
  try {
    const creditNote = await prisma.$transaction(async (tx: any) => {
      const { disposition, claimCase } = await lockClaimRows(tx, dispositionId);
      const fact = await readClaimApprovedFact(tx, disposition, claimCase);
      const note = await appendClaimCreditNoteInTx(tx, { disposition, claimCase, fact }, 'u1', requestId, async () => tx.creditNote.create({ data: {
        id: `CN_${disposition.id}`, creditNoteNumber: `CLM-${disposition.id}`, customerRelationId: claimCase.customerRelationId ?? null,
        customerName: claimCase.customerName ?? null, claimCaseId: claimCase.id, sourceInvoiceId: claimCase.sourceInvoiceId ?? null,
        currency: disposition.currency, amount: new Prisma.Decimal(disposition.amount), openAmount: new Prisma.Decimal(disposition.amount),
        status: 'Open', createdAt: BigInt(Date.now()), updatedAt: BigInt(Date.now()) } }));
      // Minimal execution facts the live account check reads (formerly written by executeDisposition in the same tx).
      await tx.claimDisposition.update({ where: { id: disposition.id }, data: { status: 'Executed', creditNoteId: note.id } });
      await tx.claimCase.update({ where: { id: claimCase.id }, data: { totalCreditAmount: { increment: new Prisma.Decimal(disposition.amount) },
        creditCurrency: disposition.currency ?? claimCase.creditCurrency } });
      return note;
    });
    return { ok: true as const, data: { creditNote }, error: undefined };
  } catch (error) {
    if (error instanceof ClaimTransactionError) return { ok: false as const, data: undefined, error: error.claimError };
    throw error;
  }
}
async function executeMoney(prisma: any, caseId: string, amount = 500, currency = 'USD') {
  const d = (await addDisposition(prisma, caseId, { kind: 'Allowance', amount, currency }, 'u1')).data!.disposition;
  recordApprovedFact(prisma, d);
  expect((await approveDisposition(prisma, d.id, 'boss')).ok).toBe(true);
  const result = await appendApproved(prisma, d.id, `EXEC_${d.id}`);
  return { d, result };
}

describe('一案一逻辑 CN、不可变正式文档及真实抵扣事件', () => {
  it('不同批准处置汇入一账户；每条明细准确保留批准/决定审计/内容指纹', async () => {
    const { prisma, claimCase } = await setup();
    const first = await executeMoney(prisma, claimCase.id);
    const second = await executeMoney(prisma, claimCase.id, 200);
    expect(first.result.ok).toBe(true); expect(second.result.ok).toBe(true);
    expect(second.result.data!.creditNote.id).toBe(first.result.data!.creditNote.id);
    expect(prisma._t.creditNote).toHaveLength(1);
    expect(prisma._t.claimCreditNoteLine).toHaveLength(2);
    expect(prisma._t.creditNoteDocumentVersion.map((v: any) => v.version)).toEqual([1, 2]);
    for (const { d } of [first, second]) {
      expect(prisma._t.claimCreditNoteLine.find((line: any) => line.claimDispositionId === d.id)).toMatchObject({
        approvalRequestId: `APR_${d.id}`, decisionAuditId: `AUDIT_APR_${d.id}`,
        contentFingerprint: prisma._t.approvalRequest.find((a: any) => a.id === `APR_${d.id}`).payload.contentFingerprint,
      });
    }
    expect(String(prisma._t.creditNote[0].amount)).toBe('500');
    expect(String(prisma._t.creditNote[0].currentAmount)).toBe('700');
    expect(String(prisma._t.creditNote[0].openAmount)).toBe('700');
    expect(String(prisma._t.claimCase[0].totalCreditAmount)).toBe('700');
    expect((await getClaimCreditNote(prisma, claimCase.id)).data!.versions).toHaveLength(2);
  });

  it('已发行文档原样保存；追加只增加新版本和当前余额，打印必须 exact issued versionId', async () => {
    const { prisma, claimCase } = await setup();
    const first = await executeMoney(prisma, claimCase.id);
    const id = first.result.data!.creditNote.id;
    const issue = await issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'ISSUE_1', expectedVersion: 1 }, 'finance');
    expect(issue.ok).toBe(true);
    const frozen = JSON.stringify(issue.data!.version, (_key, value) => typeof value === 'bigint' ? String(value) : value);
    expect((await executeMoney(prisma, claimCase.id, 100)).result.ok).toBe(true);
    expect(JSON.stringify(prisma._t.creditNoteDocumentVersion[0], (_key, value) => typeof value === 'bigint' ? String(value) : value)).toBe(frozen);
    expect(String(prisma._t.creditNote[0].currentAmount)).toBe('600');
    expect(String(prisma._t.creditNote[0].openAmount)).toBe('600');
    expect(prisma._t.creditNote[0].status).toBe('Open');
    const print = await getCreditNoteVersions(prisma, id, { versionId: issue.data!.version.id });
    expect(String(print.data!.printVersion.amount)).toBe('500');
    expect(print.data!.printVersion.linesSnapshot.lines).toHaveLength(1);
    expect((await getCreditNoteVersions(prisma, id, { versionId: prisma._t.creditNoteDocumentVersion[1].id })).error?.code).toBe('INVALID_STATE');
    expect((await getCreditNoteVersions(prisma, id, { versionId: 'FOREIGN_VERSION' })).error?.code).toBe('INVALID_STATE');
  });

  it('发行原请求可在追加后只读重放；主体、版本或请求标识不匹配均拒绝', async () => {
    const { prisma, claimCase } = await setup();
    const first = await executeMoney(prisma, claimCase.id), id = first.result.data!.creditNote.id;
    const original = await issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'ISSUE_1', expectedVersion: 1 }, 'finance');
    await executeMoney(prisma, claimCase.id, 100);
    const auditCount = prisma._t.auditLog.length;
    const replay = await issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'ISSUE_1', expectedVersion: 1 }, 'finance');
    expect(replay.data!.version.id).toBe(original.data!.version.id); expect(replay.data!.replayed).toBe(true);
    expect(prisma._t.auditLog).toHaveLength(auditCount);
    expect((await issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'ISSUE_1', expectedVersion: 2 }, 'finance')).error?.code).toBe('INVALID_STATE');
    expect((await issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'ISSUE_1', expectedVersion: 1 }, 'other')).error?.code).toBe('INVALID_STATE');
    expect((await issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'NEW', expectedVersion: 1 }, 'finance')).error?.code).toBe('INVALID_STATE');
  });

  it('同币种以外不能隐式换汇；缺完整历史或多个旧 CN 不能自动合并', async () => {
    const { prisma, claimCase } = await setup();
    await executeMoney(prisma, claimCase.id);
    expect((await executeMoney(prisma, claimCase.id, 100, 'EUR')).result.error?.code).toBe('INVALID_STATE');
    expect(prisma._t.creditNote).toHaveLength(1); expect(prisma._t.claimCreditNoteLine).toHaveLength(1);
    expect(String(prisma._t.claimCase[0].totalCreditAmount)).toBe('500');
    prisma._t.creditNote.push({ ...prisma._t.creditNote[0], id: 'LEGACY_DUP', logicalClaimCaseId: null });
    expect((await getClaimCreditNote(prisma, claimCase.id)).error?.code).toBe('INVALID_STATE');
    expect(prisma._t.creditNote).toHaveLength(2);
    const other = await setup();
    other.prisma._t.creditNote.push({ id: 'OLD', claimCaseId: other.claimCase.id, currency: 'USD', amount: new Prisma.Decimal(20), openAmount: new Prisma.Decimal(20), status: 'Open' });
    expect((await executeMoney(other.prisma, other.claimCase.id)).result.error?.code).toBe('INVALID_STATE');
    expect(other.prisma._t.creditNote).toHaveLength(1); expect(other.prisma._t.claimCreditNoteLine).toHaveLength(0);
  });

  it.each(['claimCreditNoteLine', 'creditNoteDocumentVersion', 'auditLog'])('必需 %s 写入失败，同事务不遗留账户/明细/版本/执行或案件汇总', async (model) => {
    const { prisma, claimCase } = await setup();
    const d = (await addDisposition(prisma, claimCase.id, { kind: 'Allowance', amount: 500, currency: 'USD' }, 'u1')).data!.disposition;
    recordApprovedFact(prisma, d); await approveDisposition(prisma, d.id, 'boss');
    const fault = Object.assign(new Error('required-fact-write-failed'), { code: 'P2003' });
    prisma[model].create.mockRejectedValueOnce(fault);
    await expect(appendApproved(prisma, d.id, 'CREATE')).rejects.toBe(fault);
    for (const name of ['creditNote', 'claimCreditNoteLine', 'creditNoteDocumentVersion', 'creditNoteSettlementEvent', 'creditNoteAllocation']) expect(prisma._t[name]).toHaveLength(0);
    expect(prisma._t.claimDisposition[0].status).toBe('Approved');
    expect(prisma._t.claimCase[0].totalCreditAmount).toBeUndefined();
  });

  it('发行必需审计失败不能留下 issued 状态', async () => {
    const { prisma, claimCase } = await setup();
    const first = await executeMoney(prisma, claimCase.id), id = first.result.data!.creditNote.id;
    const fault = new Error('issue-audit-failed'); prisma.auditLog.create.mockRejectedValueOnce(fault);
    await expect(issueClaimCreditNoteVersion(prisma, id, { clientRequestId: 'ISSUE', expectedVersion: 1 }, 'finance')).rejects.toBe(fault);
    expect(prisma._t.creditNoteDocumentVersion[0].issuedAt).toBeUndefined();
    expect(prisma._t.creditNote[0].status).toBe('Open');
  });
  // 2026-11-06: offset/cancel cases (settle, tamper-then-settle, foreign-invoice, closed-then-reopen) needed the deleted
  // creditNoteService.applyCreditNote/cancelCreditNote and were removed with it.
});
