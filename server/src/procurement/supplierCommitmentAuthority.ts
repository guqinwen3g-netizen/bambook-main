import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { TokenPayload } from '../auth/service';
import { authorizeSupplierSources, freshSupplierActor, type SupplierContractTx, type SupplierSourceProof } from './supplierContractAccess';
import { beginSupplierCommand, persistSupplierCommand, replaySupplierCommand, supplierResponse } from './supplierContractCommandReceipt';
import { supplierFail, supplierJson, supplierObject, supplierText, SupplierContractError, type SupplierContractKind } from './supplierContractPolicy';
import { currentCompanyId } from '../auth/requestCompanyContext';

export const supplierAuthorityKey = (kind: SupplierContractKind, family: 'fabric' | 'garment') => `supplierCommitment.approvers.${kind}.${family}`;
/** 名单所属：公司会话存于 scope `company:<id>`；无公司会话沿用 `global`。显式传入优先，其次请求公司上下文。 */
export function supplierAuthorityScope(companyId?: string | null): { companyId: string | null; scope: string } {
  const resolved = companyId !== undefined ? companyId : currentCompanyId() ?? null;
  return { companyId: resolved, scope: resolved ? `company:${resolved}` : 'global' };
}
export const supplierAuthorityConfigId = (key: string, companyId?: string | null) => `${supplierAuthorityScope(companyId).scope}::${key}`;
async function activeCompanyMember(tx: SupplierContractTx, companyId: string | null, userId: string) {
  if (!companyId) return true;
  return !!await (tx as any).companyMember.findFirst({ where: { companyId, userId, status: 'active' }, select: { userId: true } });
}
function parseConfig(value: unknown): Record<string, unknown> {
  try { return supplierObject(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { return supplierFail('APPROVAL_AUTHORITY_INVALID', '供应商承诺审批名单格式无法核验，请修复配置。', 409); }
}
export async function resolveSupplierApprovers(tx: SupplierContractTx, kind: SupplierContractKind, sources: SupplierSourceProof[], companyIdInput?: string | null) {
  const { companyId } = supplierAuthorityScope(companyIdInput);
  const families = [...new Set(sources.map(row => row.businessLine))].sort();
  const configs: Array<{ key: string; version: number; userIds: string[] }> = [];
  for (const family of families) {
    const key = supplierAuthorityKey(kind, family);
    const row = await tx.systemConfig.findUnique({ where: { id: supplierAuthorityConfigId(key, companyId) } });
    const value = parseConfig(row?.value);
    if (!row || value.schemaVersion !== 1 || !Array.isArray(value.userIds) || !value.userIds.length || value.userIds.some(id => typeof id !== 'string'))
      return supplierFail('APPROVAL_AUTHORITY_MISSING', `尚未配置${family === 'fabric' ? '面料' : '成衣'}${kind === 'purchase' ? '采购' : '加工'}承诺审批人。`, 409);
    configs.push({ key, version: row.version, userIds: value.userIds as string[] });
  }
  let candidates = configs.length ? configs[0].userIds.filter(id => configs.every(config => config.userIds.includes(id))) : [];
  const active: string[] = [];
  for (const id of [...new Set(candidates)].sort()) {
    if (!await activeCompanyMember(tx, companyId, id)) continue;
    try {
      await authorizeSupplierSources(tx, { userId: id, permissions: [], departmentIds: [], roles: [] }, sources.map(row => row.orderLineId), { mode: 'approve', businessGates: false });
      active.push(id);
    } catch (error) {
      if (!(error instanceof SupplierContractError) || !['FORBIDDEN', 'ACCOUNT_DISABLED', 'NOT_FOUND'].includes(error.code)) throw error;
    }
  }
  candidates = active;
  if (!candidates.length) return supplierFail('APPROVAL_AUTHORITY_MISSING', '已配置名单中没有当前有效、具备审批 scope 且可读全部准确来源的账号。', 409);
  return { eligibleReviewerIds: candidates, configVersions: configs.map(({ key, version }) => ({ key, version })) };
}
export async function setSupplierApprovalAuthority(params: { prisma: PrismaClient; actor: TokenPayload; kind: SupplierContractKind; family: 'fabric' | 'garment';
  requestKey: string; userIds: string[]; expectedConfigVersion: number; reason: string }) {
  if (!['purchase', 'processing'].includes(params.kind) || !['fabric', 'garment'].includes(params.family)) return supplierFail('INVALID_INPUT', '请明确供应商合同类型和业务域。');
  if (!Array.isArray(params.userIds) || params.userIds.length > 100 || params.userIds.some(id => typeof id !== 'string' || !id.trim())) return supplierFail('INVALID_INPUT', '请选择真实审批人名单。');
  if (!Number.isSafeInteger(params.expectedConfigVersion) || params.expectedConfigVersion < 0) return supplierFail('REVISION_REQUIRED', '请先读取当前审批配置版本。');
  const userIds = [...new Set(params.userIds)].sort(), reason = supplierText(params.reason, '配置理由', 2000), key = supplierAuthorityKey(params.kind, params.family);
  const { companyId, scope } = supplierAuthorityScope(params.actor.companyId ?? null), configId = `${scope}::${key}`;
  const command = { actor: params.actor, requestKey: params.requestKey, operation: 'configure_approval_authority', kind: params.kind, targetId: `authority:${params.family}`,
    input: { userIds, reason, expectedConfigVersion: params.expectedConfigVersion, family: params.family }, mode: 'config' as const };
  return params.prisma.$transaction(async tx => {
    const started = await beginSupplierCommand(tx, command);
    await tx.$queryRaw(Prisma.sql`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-authority:${configId}`}, 0))) AS supplier_authority_lock`);
    await freshSupplierActor(tx, params.actor, 'config');
    const replay = await replaySupplierCommand(tx, command, started.fingerprint); if (replay) return replay;
    const previous = await tx.systemConfig.findUnique({ where: { id: configId } });
    if ((previous?.version ?? 0) !== params.expectedConfigVersion) return supplierFail('REVISION_CONFLICT', '审批配置已变化，请刷新核对。', 409);
    for (const userId of userIds) {
      if (!await activeCompanyMember(tx, companyId, userId)) return supplierFail('INVALID_INPUT', '审批人只能选择本公司在职成员。');
      await freshSupplierActor(tx, { userId, roles: [], permissions: [], departmentIds: [], ...(companyId ? { companyId } : {}) }, 'approve');
    }
    const value = { schemaVersion: 1, userIds }, version = (previous?.version ?? 0) + 1, now = BigInt(Date.now());
    const item = await tx.systemConfig.upsert({ where: { id: configId }, create: { id: configId, scope, key,
      group: 'rbac', label: '供应商承诺审批资格', valueType: 'json', value, version, updatedBy: started.actor.userId, auditReason: reason, updatedAt: now },
      update: { value, valueType: 'json', version, updatedBy: started.actor.userId, auditReason: reason, updatedAt: now } });
    await tx.systemConfigHistory.create({ data: { id: `SCH_${randomUUID()}`, configId: item.id, versionFrom: previous?.version ?? 0, versionTo: version,
      valueFrom: previous?.value ?? Prisma.JsonNull, valueTo: supplierJson(value), actorId: started.actor.userId, reason } });
    const response = supplierResponse({ key, version, userIds }, command, started.receiptId, command.targetId);
    return persistSupplierCommand(tx, command, started.fingerprint, response);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
