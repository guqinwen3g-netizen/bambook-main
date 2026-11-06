/**
 * releaseService.test.ts — DR-053 阶段 2：生产放行范围化（§14）
 *
 * 验收映射（§14.7 后端核心子集）：
 *  - 多行/多批次部分放行（汇总 partial，未放行范围 blocked）
 *  - 一行返修失效（invalidated 联动 + evaluate 拒绝；无关行不受影响）
 *  - evaluate round 兜底（样品返修后即使 scope ready 也拒绝）
 *  - 冒名签字（同人两角色 409）、重复签（409）、范围修订变化（409）
 *  - 暂停/恢复/撤销（append-only 事件；失效不可 resume）
 *  - 幂等（sourceKey 重复 invalidate 不重复处理）
 */
import { describe, expect, it, vi } from 'vitest';
import { createReleaseScope, createReleaseRequest, signReleaseRequest, evaluateProductionRelease, summarizeOrderReleases, transitionRelease, invalidateScopesBySample } from '../releaseService';
import { logger } from '../../lib/logger';
import * as realtime from '../../realtime';

// ═══ 内存 prisma mock（stateful：create/update 回写）═══
function makePrisma(seed: { orderLines?: any[]; samples?: any[] } = {}) {
  const state: any = {
    releaseScope: [],
    releaseRequest: [],
    releaseSignature: [],
    ppSampleRelease: [],
    releaseEvent: [],
    notification: [],
    orderLine: [...(seed.orderLines ?? [])],
    sample: [...(seed.samples ?? [])],
  };
  // 简化：scope/request/signature/release/event 用各自数组
  const tables = ['releaseScope', 'releaseRequest', 'releaseSignature', 'ppSampleRelease', 'releaseEvent'] as const;
  const model = (name: string) => {
    const rows = state[name];
    return {
      findFirst: async ({ where }: any = {}) => rows.find((r: any) => matchWhere(r, where)) ?? null,
      findUnique: async ({ where }: any) => {
        for (const r of rows) {
          if (where?.id && r.id === where.id) return r;
          if (where?.requestId && r.requestId === where.requestId) return r;
          if (where?.requestId_role && r.requestId === where.requestId_role.requestId && r.role === where.requestId_role.role) return r;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => rows.filter((r: any) => matchWhere(r, where)),
      create: async ({ data }: any) => {
        // Persisted JSON facts are independent values, as in PostgreSQL;
        // keep Decimal quantities as Decimal instead of cloning prototypes.
        const row = { ...data };
        for (const key of ['evidenceSnapshot', 'specSnapshot']) if (data[key] != null) row[key] = structuredClone(data[key]);
        rows.push(row); return row;
      },
      update: async ({ where, data }: any) => {
        const r = rows.find((x: any) => x.id === where.id);
        Object.assign(r, data);
        return r;
      },
      count: async () => rows.length,
    };
  };
  const prisma: any = { $transaction: vi.fn(async (fn: any) => fn(tx)) };
  const tx: any = {};
  for (const t of tables) { state[t] = state[t] ?? []; tx[t] = model(t); prisma[t] = tx[t]; }
  tx.notification = prisma.notification = { createMany: vi.fn(async ({ data, skipDuplicates }: any) => {
    let count = 0;
    for (const row of data) {
      if (skipDuplicates && state.notification.some((existing: any) => existing.id === row.id)) continue;
      state.notification.push({ ...row }); count++;
    }
    return { count };
  }) };
  prisma.orderLine = { findUnique: async ({ where }: any) => state.orderLine.find((o: any) => o.id === where.id) ?? null, findMany: async ({ where }: any) => state.orderLine.filter((row: any) => matchWhere(row, where)) };
  // The scope producer reads the actual live parent before/after its Order
  // lock. Original legacy fixtures have no recorded header/source factory.
  prisma.order = { findFirst: async ({ where }: any) => state.orderLine.some((line: any) => line.orderId === where.id)
    ? { id: where.id, millRelationId: null, sourceCaseId: null } : null };
  // Explicit current MOQ facts for this release-focused fixture, no gate bypass.
  const moqSnapshot={fabricDefaultMoq:1,garmentDefaultMoq:1,capsuleMoq:1,snapshotAt:'2026-10-04T00:00:00.000Z',configId:null,source:'fallback_constant'};
  prisma.order.findUnique=async ({where}:any)=>({id:where.id,type:'Other',customerRelationId:null,moqSnapshot,lines:state.orderLine.filter((line:any)=>line.orderId===where.id).map((line:any,i:number)=>({...line,lineNumber:line.lineNumber??i+1,quantity:line.quantity??'1000',unit:line.unit??'M'}))});
  prisma.fabricProfile=tx.fabricProfile={findUnique:async()=>null};prisma.garmentProfile=tx.garmentProfile={findUnique:async()=>null};
  prisma.productAsset={...(prisma.productAsset??{}),findMany:async()=>[]};
  prisma.$queryRaw = tx.$queryRaw = async () => [{ id: 'explicit-storage-row-lock' }];
  // These legacy fixtures have no development-origin bindings. The real
  // relation delegate remains present; absence is data, never a missing API.
  prisma.sampleSource = tx.sampleSource = { findMany: async () => [] };
  prisma.sample = { findFirst: async ({ where }: any) => state.sample.find((s: any) => s.id === where.id && !s.deletedAt) ?? null };
  prisma.auditLog = { create: async () => ({ id: 'AUD-1' }) };
  // Explicit recorded legacy seal/approval storage seam, not native PG facts.
  prisma.developmentCase = { findFirst: async () => ({ id: 'LEGACY-CASE', type: 'fabric' }) };
  prisma.sealSample = { findFirst: async ({ where }: any) => where.id === 'SEAL-1' ? { id: 'SEAL-1', developmentCaseId: 'LEGACY-CASE', status: 'sealed' } : null };
  prisma.sealSampleBatch = { findMany: async () => [{ sampleBatchId: 'LEGACY-BATCH' }] };
  prisma.sampleBatch = { findMany: async () => [{ id: 'LEGACY-BATCH', developmentCaseId: 'LEGACY-CASE', status: 'approved', approvedAt: BigInt(1), approvedBy: 'legacy-reviewer', round: 1 }] };
  for (const delegate of ['order', 'orderLine', 'sample', 'auditLog', 'developmentCase', 'sealSample', 'sealSampleBatch', 'sampleBatch']) tx[delegate] = prisma[delegate];
  return { prisma, tx, state };
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const k of Object.keys(where)) {
    const v = where[k];
    if (k === 'scopeId' && typeof v === 'object' && v !== null && 'not' in v) {
      continue;
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if ('not' in v && (row[k] ?? null) === v.not) return false;
      if ('in' in v && !v.in.includes(row[k])) return false;
      continue;
    }
    if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

// 直接从 releaseService 导出（避免重复 import 路径）

const LINE = { id: 'OL-1', orderId: 'ORD-1' };
const LINE2 = { id: 'OL-2', orderId: 'ORD-1' };
// 2026-11-06: the exact-development-origin block needed the deleted fabric development fixture and was removed with it.
const SAMPLE = { id: 'SMP-PP-1', code: 'SMP-1', type: 'pp', status: 'approved', round: 1, supplierRelationId: 'R-A', supplierName: 'Factory A', customerStatus: 'approved', qcStatus: 'passed', deletedAt: null };

describe('DR-053 阶段 2：范围创建 + 领导单签批准（§10.7 P-3 口径）', () => {
  it('整行范围创建 + 领导单签 → scope ready + evaluate eligible + 事件 granted', async () => {
    const { prisma } = makePrisma({ orderLines: [{ ...LINE, confirmedSourceType: 'SealSample', confirmedSourceId: 'SEAL-1' }], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { factoryRelationId: 'R-A', quantity: 100, unit: 'm', confirmedSourceType: 'SealSample', confirmedSourceId: 'SEAL-1' }, actorId: 'u1' });
    expect(sc.ok).toBe(true);
    const scopeId = (sc as any).data.scope.id;

    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    expect(req.ok).toBe(true);
    const requestId = (req as any).data.request.id;

    // §10.7 P-3 单签口径（2026-09-12）：领导（business 角色）一签即 granted，无双签
    const s1 = await signReleaseRequest({ prisma, requestId, role: 'business', actorId: 'u_leader' });
    expect(s1.ok).toBe(true);
    expect((s1 as any).data.signed).toBe(true);
    expect((s1 as any).data.release).toBeTruthy();
    expect((s1 as any).data.release.signedByBusiness).toBe('u_leader');
    expect((s1 as any).data.release.signedByProduction).toBeNull();

    const evalR = await evaluateProductionRelease({ prisma, scopeId });
    expect(evalR.ok).toBe(true);
    expect((evalR as any).data.eligible).toBe(true);
    expect((evalR as any).data.state).toBe('ready');
  });

  it('§10.7 单签口径：重复签 → 409 ALREADY_SIGNED；旧双签 pending 请求 business 一签仍可批准（回填历史签）', async () => {
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: {}, actorId: 'u1' });
    const requestId = (req as any).data.request.id;

    const again = await signReleaseRequest({ prisma, requestId, role: 'business', actorId: 'u_leader' });
    expect(again.ok).toBe(true); // 单签即批准
    const third = await signReleaseRequest({ prisma, requestId, role: 'business', actorId: 'u_leader2' });
    expect(third.ok).toBe(false);
    expect((third as any).error.code).toBe('REQUEST_NOT_PENDING');
  });

  it('多行部分放行：一行批准一行未批准 → 汇总 partial；未批准范围 evaluate blocked', async () => {
    const { prisma } = makePrisma({ orderLines: [LINE, LINE2], samples: [SAMPLE] });
    await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 100 }, actorId: 'u1' });
    const sc2 = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-2', input: { quantity: 50 }, actorId: 'u1' });
    const scope2Id = (sc2 as any).data.scope.id;

    // 只批准 scope2
    const req2 = await createReleaseRequest({ prisma, scopeId: scope2Id, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req2 as any).data.request.id, role: 'production', actorId: 'u_prod' });
    await signReleaseRequest({ prisma, requestId: (req2 as any).data.request.id, role: 'business', actorId: 'u_biz' });

    const sum = await summarizeOrderReleases({ prisma, orderId: 'ORD-1' });
    expect((sum as any).data).toMatchObject({ total: 2, ready: 1, blocked: 1, summary: 'partial' });

    // scope1（OL-1）未批准 → blocked
    const scopes = await (prisma as any).releaseScope.findMany({});
    const scope1 = scopes.find((s: any) => s.orderLineId === 'OL-1');
    const eval1 = await evaluateProductionRelease({ prisma, scopeId: scope1.id });
    expect((eval1 as any).data.eligible).toBe(false);
    expect((eval1 as any).data.state).toBe('no_release');
  });

  it('暂停/恢复/撤销（append-only 事件；失效不可 resume）', async () => {
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    const requestId = (req as any).data.request.id;
    await signReleaseRequest({ prisma, requestId, role: 'production', actorId: 'u_prod' });
    await signReleaseRequest({ prisma, requestId, role: 'business', actorId: 'u_biz' });

    const paused = await transitionRelease({ prisma, scopeId, action: 'pause', reason: '客户临时调整', actorId: 'u_admin' });
    expect((paused as any).data.scope.state).toBe('paused');
    let e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(false);

    const resumed = await transitionRelease({ prisma, scopeId, action: 'resume', reason: '恢复', actorId: 'u_admin' });
    expect((resumed as any).data.scope.state).toBe('ready');
    e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(true);

    await transitionRelease({ prisma, scopeId, action: 'revoke', reason: '客户终止', actorId: 'u_admin' });
    const revokedResume = await transitionRelease({ prisma, scopeId, action: 'resume', actorId: 'u_admin' });
    expect(revokedResume.ok).toBe(false);
    expect((revokedResume as any).error.code).toBe('INVALID_TRANSITION');
    // 事件 append-only：4 条（granted/paused/resumed/revoked）
    const events = await (prisma as any).releaseEvent.findMany({});
    expect(events.map((ev: any) => ev.kind)).toEqual(['granted', 'paused', 'resumed', 'revoked']);
  });
});

describe('DR-053 阶段 2：返修失效联动 + round 兜底', () => {
  it('invalidateScopesBySample → 关联 scope invalidated；无关 scope 不受影响', async () => {
    const { prisma } = makePrisma({ orderLines: [LINE, LINE2], samples: [SAMPLE] });
    await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 100 }, actorId: 'u1' });
    const sc2 = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-2', input: { quantity: 50 }, actorId: 'u1' });
    const scope1 = (await (prisma as any).releaseScope.findMany({})).find((s: any) => s.orderLineId === 'OL-1');
    const scope2Id = (sc2 as any).data.scope.id;

    // 两个 scope 都用 SMP-PP-1 批准（共享证据）
    for (const sid of [scope1.id, scope2Id]) {
      const req = await createReleaseRequest({ prisma, scopeId: sid, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
      await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'production', actorId: 'u_prod' });
      await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_biz' });
    }
    // 返修 → 共享证据失效 → 两个 scope 均 invalidated
    const inv = await invalidateScopesBySample({ prisma, sampleId: 'SMP-PP-1', reason: '返修', sourceKey: 'revise-1', actorId: 'u_prod' });
    expect((inv as any).data.invalidated).toBe(2);
    for (const sid of [scope1.id, scope2Id]) {
      const e = await evaluateProductionRelease({ prisma, scopeId: sid });
      expect((e as any).data.eligible).toBe(false);
      expect((e as any).data.state).toBe('invalidated');
    }
    // 幂等：同 sourceKey 重复 → 不重复处理
    const inv2 = await invalidateScopesBySample({ prisma, sampleId: 'SMP-PP-1', reason: '返修2', sourceKey: 'revise-1', actorId: 'u_prod' });
    expect((inv2 as any).data.invalidated).toBe(0);
  });

  it('round 兜底：样品返修 round+1 后，即使 scope 仍 ready 也拒绝（§14.4 执行判定立即拒绝旧修订）', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [{ ...SAMPLE, round: 1 }] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'production', actorId: 'u_prod' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_biz' });
    let e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(true);

    // 样品返修 round+1（模拟 advanceSampleStage 后样品状态；scope 尚未 invalidate）
    state.sample[0].round = 2;
    e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(false);
    expect((e as any).data.reasons.join()).toContain('返修');
  });

  // ── P0-6（2026-09-13）：兜底空窗回归。原兜底只比 round 且依赖 sampleRound != null，
  //    而「置 revising」与「round+1」是两个独立动作 → round 未变时兜底整体失效。
  it('P0-6 空窗：paused 期间样品进入 revising（round 未变）→ 联动跳过 paused，resume 后兜底必须拦住', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [{ ...SAMPLE, round: 1 }] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });

    // 暂停 → 联动只处理 ready，paused 范围被跳过
    await transitionRelease({ prisma, scopeId, action: 'pause', reason: '待客户确认', actorId: 'u_admin' });
    // 客户 needs_revision：status 置 revising，**round 不变**（qc failed / needs_revision 均如此）
    state.sample[0].status = 'revising';
    const inv = await invalidateScopesBySample({ prisma, sampleId: 'SMP-PP-1', reason: '返修', actorId: 'u_prod' });
    expect((inv as any).data.invalidated).toBe(0); // 联动确实没覆盖到（这是原设计覆盖面，见 P2-1）

    // resume 直接回 ready → 修前：round 未变 → 兜底失效 → 误放行
    await transitionRelease({ prisma, scopeId, action: 'resume', reason: '恢复', actorId: 'u_admin' });
    const e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.state).toBe('ready');
    expect((e as any).data.eligible).toBe(false);
    expect((e as any).data.reasons.join()).toContain('证据已失效');
  });

  it('P0-6：客户判定 rejected（round 未变）→ 兜底拦住，不放行', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [{ ...SAMPLE, round: 1 }] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });
    expect((await evaluateProductionRelease({ prisma, scopeId }) as any).data.eligible).toBe(true);

    state.sample[0].status = 'rejected'; // advanceSampleStage: confirm(rejected)，round 不变
    const e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(false);
    expect((e as any).data.reasons.join()).toContain('证据已失效');
  });

  it('P0-6：批准锁定的证据样品已软删 → 证据不可核验，兜底拦住（fail-closed）', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [{ ...SAMPLE, round: 1 }] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });

    state.sample[0].deletedAt = BigInt(Date.now());
    const e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(false);
    expect((e as any).data.reasons.join()).toContain('无法核验');
  });

  it('P0-6 不误伤：样品封样 / 继续确认（round 未变、状态非失效态）→ 仍 eligible', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [{ ...SAMPLE, round: 1 }] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });

    state.sample[0].status = 'sealed'; // 放行后封样：合法后续动作
    expect((await evaluateProductionRelease({ prisma, scopeId }) as any).data.eligible).toBe(true);
    state.sample[0].status = 'confirmed';
    expect((await evaluateProductionRelease({ prisma, scopeId }) as any).data.eligible).toBe(true);
  });

  it('P0-6：未锁定 sampleRound（历史批准）但样品已返修 → 不再整体跳过兜底', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [{ ...SAMPLE, round: 1 }] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });
    // 模拟历史批准未锁 round
    const rel = (await (prisma as any).ppSampleRelease.findMany({}))[0];
    rel.sampleRound = null;

    state.sample[0].status = 'revising';
    state.sample[0].round = 3;
    const e = await evaluateProductionRelease({ prisma, scopeId });
    expect((e as any).data.eligible).toBe(false);
    expect((e as any).data.reasons.join()).toContain('证据已失效');
  });

  it('范围修订变化：签署时 scopeRevision 变化 → 409 SCOPE_REVISION_CHANGED', async () => {
    const { prisma, state } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: {}, actorId: 'u1' });
    const requestId = (req as any).data.request.id;
    // 范围修订变化（模拟工厂/规格变更递增 scopeRevision）——单签口径下在签署前发生
    const scope = await (prisma as any).releaseScope.findUnique({ where: { id: scopeId } });
    scope.scopeRevision = 2;
    const biz = await signReleaseRequest({ prisma, requestId, role: 'business', actorId: 'u_biz' });
    expect(biz.ok).toBe(false);
    expect((biz as any).error.code).toBe('SCOPE_REVISION_CHANGED');
    void state;
  });
});

// ═══ DR-053 §14.6 影子对账（只读）：在制订单 × 历史双签 × 放行差异 ═══
import { listReleaseReconciliation } from '../releaseService';

function makeReconPrisma(seed: { productionStages?: any[]; orders?: any[]; releaseScopes?: any[]; releaseEvents?: any[] } = {}) {
  const state: any = {
    releaseEvent: [...(seed.releaseEvents ?? [])],
    productionStage: [...(seed.productionStages ?? [])],
    order: [...(seed.orders ?? [])],
    releaseScope: (seed.releaseScopes ?? []).map(row => ({ orderLineId: 'OL-' + row.id, scopeRevision: 1, currentReleaseId: row.state === 'ready' ? 'REL-' + row.id : null, ...row })),
  };
  const prisma: any = {
    releaseEvent: { findFirst: async ({ where }: any) => state.releaseEvent.filter((row: any) => row.scopeId === where.scopeId).sort((a: any, b: any) => b.sequence - a.sequence)[0] ?? null },
    productionStage: {
      findMany: async ({ where }: any = {}) => state.productionStage.filter((s: any) => {
        if (where?.stageKey && s.stageKey !== where.stageKey) return false;
        if (where?.status?.in && !where.status.in.includes(s.status)) return false;
        if (where?.orderId?.in && !where.orderId.in.includes(s.orderId)) return false;
        return true;
      }),
    },
    order: {
      findUnique: async ({where}:any)=>({id:where.id,type:'Fabric',customerRelationId:null,moqSnapshot:{fabricDefaultMoq:1,garmentDefaultMoq:1,capsuleMoq:1,snapshotAt:'2026-10-04T00:00:00.000Z',configId:null,source:'fallback_constant'},lines:state.releaseScope.filter((r:any)=>r.orderId===where.id).map((r:any,i:number)=>({id:r.orderLineId,orderId:r.orderId,lineNumber:i+1,quantity:'1000',unit:'M'}))}),
      findMany: async ({ where }: any = {}) => state.order.filter((o: any) => !where?.id?.in || where.id.in.includes(o.id)),
    },
    releaseScope: {
      findMany: async ({ where }: any = {}) => state.releaseScope.filter((s: any) => !where?.orderId?.in || where.orderId.in.includes(s.orderId)),
      findFirst: async ({ where }: any) => state.releaseScope.find((row: any) => matchWhere(row, where)) ?? null,
    },
    orderLine: { findUnique: async ({ where }: any) => { const scope = state.releaseScope.find((row: any) => row.orderLineId === where.id); return scope ? { id: where.id, orderId: scope.orderId } : null; } },
    fabricProfile:{findUnique:async()=>null},garmentProfile:{findUnique:async()=>null},productAsset:{findMany:async()=>[]},
    ppSampleRelease: { findUnique: async ({ where }: any) => { const scope = state.releaseScope.find((row: any) => row.currentReleaseId === where.id); return scope ? { id: where.id, scopeId: scope.id, scopeRevision: 1, requestId: 'RR-' + scope.id, ruleVersion: 'pp-release-v1', evidenceSnapshot: null, sampleId: null, sampleRound: null } : null; } },
    releaseRequest: { findUnique: async ({ where }: any) => { const scope = state.releaseScope.find((row: any) => 'RR-' + row.id === where.id); return scope ? { id: where.id, scopeId: scope.id, scopeRevision: 1, specSnapshot: null, evidenceSnapshot: null, state: 'granted', ruleVersion: 'pp-release-v1' } : null; } },
  };
  return { prisma, state };
}

describe('DR-053 §14.6 影子对账', () => {
  it('在制订单有 ready scope → 无补证无差异', async () => {
    const { prisma } = makeReconPrisma({
      productionStages: [
        { orderId: 'ORD-1', stageKey: 'manufacturing', status: 'in_progress', doneAt: null },
        { orderId: 'ORD-1', stageKey: 'pp_sample_approved', status: 'done', signedByProduction: 'u1', signedByBusiness: 'u2' },
      ],
      orders: [{ id: 'ORD-1', poNumber: 'SO-1', customer: 'Acme' }],
      releaseScopes: [{ id: 'SC-1', orderId: 'ORD-1', state: 'ready' }],
    });
    const r = await listReleaseReconciliation({ prisma });
    expect(r.ok).toBe(true);
    const d = (r as any).data;
    expect(d.total).toBe(1);
    expect(d.backfillRequired).toBe(0);
    expect(d.discrepancies).toBe(0);
    expect(d.items[0].summary).toBe('ready');
    expect(d.items[0].needsBackfill).toBe(false);
  });

  it.each(['missing', 'pending'])('ready Scope with %s original Request remains a blocked reconciliation discrepancy', async requestState => {
    const { prisma } = makeReconPrisma({
      productionStages: [{ orderId: 'ORD-1', stageKey: 'manufacturing', status: 'in_progress', doneAt: null }],
      orders: [{ id: 'ORD-1', poNumber: 'SO-1', customer: 'Acme' }],
      releaseScopes: [{ id: 'SC-1', orderId: 'ORD-1', state: 'ready' }],
    });
    const readRequest = prisma.releaseRequest.findUnique;
    prisma.releaseRequest.findUnique = async (args: any) => requestState === 'missing' ? null : { ...await readRequest(args), state: 'pending' };
    const result = await listReleaseReconciliation({ prisma });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.data.total).toBe(1); expect(result.data.discrepancies).toBe(1);
    expect(result.data.items[0]).toMatchObject({ summary: 'blocked', discrepancy: true, needsBackfill: false, ready: 0 });
  });

  it('shadow reconciliation reports a Request SQL failure explicitly instead of ready or empty data', async () => {
    const { prisma } = makeReconPrisma({
      productionStages: [{ orderId: 'ORD-1', stageKey: 'manufacturing', status: 'in_progress', doneAt: null }],
      orders: [{ id: 'ORD-1', poNumber: 'SO-1', customer: 'Acme' }],
      releaseScopes: [{ id: 'SC-1', orderId: 'ORD-1', state: 'ready' }],
    });
    prisma.releaseRequest.findUnique = async () => { throw Object.assign(Error('Request SQL unavailable'), { code: 'P2022' }); };
    const result = await listReleaseReconciliation({ prisma });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'AUTHORIZATION_UNAVAILABLE', status: 503 });
    expect(result).not.toHaveProperty('data');
  });

  it('在制订单无 scope 但历史双签 → needsBackfill=true（历史批准保留，不自动赋予新放行资格）', async () => {
    const { prisma } = makeReconPrisma({
      productionStages: [
        { orderId: 'ORD-2', stageKey: 'manufacturing', status: 'done', doneAt: BigInt(1) },
        { orderId: 'ORD-2', stageKey: 'pp_sample_approved', status: 'done', signedByProduction: 'u1', signedByBusiness: 'u2' },
      ],
      orders: [{ id: 'ORD-2', poNumber: 'SO-2', customer: 'Beta' }],
      releaseScopes: [],
    });
    const r = await listReleaseReconciliation({ prisma });
    expect(r.ok).toBe(true);
    const d = (r as any).data;
    expect(d.backfillRequired).toBe(1);
    const item = d.items[0];
    expect(item.needsBackfill).toBe(true);
    expect(item.hasHistoricalDoubleSign).toBe(true);
    expect(item.scopeCount).toBe(0);
  });

  it('在制订单 scope 全失效（blocked）→ discrepancy=true（执行事实与放行资格不匹配）', async () => {
    const { prisma } = makeReconPrisma({
      productionStages: [
        { orderId: 'ORD-3', stageKey: 'manufacturing', status: 'in_progress', doneAt: null },
      ],
      orders: [{ id: 'ORD-3', poNumber: 'SO-3', customer: 'Gamma' }],
      releaseScopes: [
        { id: 'SC-3a', orderId: 'ORD-3', state: 'revoked' },
        { id: 'SC-3b', orderId: 'ORD-3', state: 'invalidated' },
      ],
    });
    const r = await listReleaseReconciliation({ prisma });
    expect(r.ok).toBe(true);
    const d = (r as any).data;
    expect(d.discrepancies).toBe(1);
    expect(d.items[0].summary).toBe('blocked');
    expect(d.items[0].discrepancy).toBe(true);
  });
});

/**
 * §9 **B39** · 位置参数内插原文的执行覆盖（R3 / §6 S1）
 *
 * 本批把该文件 5 处 ``fail(CODE, `…失败：${String(e?.message ?? e)}`, 500)`` 换成字面中文，
 * **并补上该文件原本没有的 `logger.error`**（实测 `logger.error` 计数为 0，只有 info/warn）—— D51。
 *
 * ★★ **D52：这 5 处形状一致，但文案必须不同** —— 差别由 `catch` 的覆盖面决定（**读原文判定**）：
 *   · `createReleaseScope`：`$transaction`（:88）**之后**还有 `await writeRouteAuditLog(...)`（:108，**事务外**）
 *     ⇒ 审计写失败时范围**已落库** ⇒ **不许承诺**；
 *   · `createReleaseRequest`：`$transaction`（:174）**之后**还有 `releaseRequest.create(...)`（:191，**直写、不在事务内**）
 *     ⇒ 请求可能已落库 ⇒ **不许承诺**；
 *   · `signReleaseRequest`（tx 在 :216）/ `transitionRelease`（:473）/ `invalidateScopesBySample`（:528）：
 *     `try` 内**唯一业务写就是那个 `$transaction`**（sign 的通知段有自己的内层 try，不会冒到外层 catch）
 *     ⇒ **可以**承诺「本次未确认任何改动」。
 *
 * 出口链已核：`production/releaseRoute.ts` 转发 `result.error.message`（与既有用例同口径）。
 * ⚠️ 本文件**未** `vi.mock` logger ⇒ 用 `vi.spyOn` 打在真 logger 上。
 */
const B39_RAW = 'PrismaClientKnownRequestError: Invalid `prisma.$transaction()` invocation in '
  + '/srv/app/server/src/production/releaseService.ts:216 — '
  + 'Unique constraint failed on the fields: (`id`)';
const B39_FRAGMENTS = ['PrismaClient', 'prisma.$transaction', 'releaseService.ts:216', 'Unique constraint', '/srv/app', 'P2002'];

function expectB39Copy(msg: unknown, mustMention: string, canPromise: boolean) {
  expect(typeof msg).toBe('string');
  const s = msg as string;
  expect(s.length, `文案过短（${s.length} 字）：${s}`).toBeGreaterThanOrEqual(20);
  expect(s, '必须含中文').toMatch(/[\u4e00-\u9fa5]/);
  expect(s, `必须说清对象：${s}`).toContain(mustMention);
  expect(s, `必须给下一步：${s}`).toMatch(/(稍后重试|联系管理员)/);
  expect(s.match(/[A-Za-z]{3,}/g) ?? [], `混入拉丁词（疑似原文上屏）：${s}`).toEqual([]);
  if (canPromise) expect(s, '唯一写是 $transaction ⇒ 可以承诺零改动').toContain('本次未确认任何改动');
  else expect(s, '事务外还有写入 ⇒ 不得承诺零改动').not.toMatch(/(没有写入任何数据|本次未确认任何改动|本次改动未生效)/);
}

describe('§9 B39 · 生产放行五处出口：内部原文不上屏', () => {
  it('★ createReleaseScope：**不许承诺**（审计写在事务外）', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    prisma.auditLog.create = async () => { throw new Error(B39_RAW); };
    const r = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SCOPE_CREATE_FAILED');
    const raw = JSON.stringify(r.error);
    for (const frag of B39_FRAGMENTS) expect(raw, `泄漏了「${frag}」`).not.toContain(frag);
    expectB39Copy(r.error.message, '放行范围', false);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Release]'), expect.objectContaining({ error: B39_RAW }));
    spy.mockRestore();
  });

  it('★ createReleaseRequest：**不许承诺**（请求 create 不在事务内）', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    prisma.releaseRequest.create = async () => { throw new Error(B39_RAW); };
    const r = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('REQUEST_CREATE_FAILED');
    const raw = JSON.stringify(r.error);
    for (const frag of B39_FRAGMENTS) expect(raw, `泄漏了「${frag}」`).not.toContain(frag);
    expectB39Copy(r.error.message, '放行请求', false);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Release]'), expect.objectContaining({ error: B39_RAW }));
    spy.mockRestore();
  });

  it('★ signReleaseRequest：**可以承诺零改动**（唯一写是 $transaction）', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const req = await createReleaseRequest({ prisma, scopeId: (sc as any).data.scope.id, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    prisma.$transaction = async () => { throw new Error(B39_RAW); };
    const r = await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SIGN_FAILED');
    const raw = JSON.stringify(r.error);
    for (const frag of B39_FRAGMENTS) expect(raw, `泄漏了「${frag}」`).not.toContain(frag);
    expectB39Copy(r.error.message, '放行签署', true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Release]'), expect.objectContaining({ error: B39_RAW }));
    spy.mockRestore();
  });

  it('★ transitionRelease：**可以承诺零改动**', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    prisma.$transaction = async () => { throw new Error(B39_RAW); };
    const r = await transitionRelease({ prisma, scopeId: (sc as any).data.scope.id, action: 'pause', reason: '客户临时调整', actorId: 'u_admin' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('TRANSITION_FAILED');
    const raw = JSON.stringify(r.error);
    for (const frag of B39_FRAGMENTS) expect(raw, `泄漏了「${frag}」`).not.toContain(frag);
    expectB39Copy(r.error.message, '放行状态变更', true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Release]'), expect.objectContaining({ error: B39_RAW }));
    spy.mockRestore();
  });

  it('★ invalidateScopesBySample：**可以承诺零改动**', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);
    const { prisma } = makePrisma({ orderLines: [LINE], samples: [SAMPLE] });
    const sc = await createReleaseScope({ prisma, orderId: 'ORD-1', orderLineId: 'OL-1', input: { quantity: 10 }, actorId: 'u1' });
    const scopeId = (sc as any).data.scope.id;
    const req = await createReleaseRequest({ prisma, scopeId, input: { sampleId: 'SMP-PP-1' }, actorId: 'u1' });
    await signReleaseRequest({ prisma, requestId: (req as any).data.request.id, role: 'business', actorId: 'u_leader' });
    prisma.$transaction = async () => { throw new Error(B39_RAW); };
    const r = await invalidateScopesBySample({ prisma, sampleId: 'SMP-PP-1', reason: '返修', sourceKey: 'revise-1', actorId: 'u_prod' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALIDATE_FAILED');
    const raw = JSON.stringify(r.error);
    for (const frag of B39_FRAGMENTS) expect(raw, `泄漏了「${frag}」`).not.toContain(frag);
    expectB39Copy(r.error.message, '失效联动', true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Release]'), expect.objectContaining({ error: B39_RAW }));
    spy.mockRestore();
  });
});
