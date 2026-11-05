import { Prisma, type PrismaClient } from '@prisma/client';
import type { TokenPayload } from '../auth/service';
import { authorizeSupplierContract, requireApprovedSupplierBasis } from './supplierCommitmentService';
import { authorizeSupplierSources, type SupplierContractTx } from './supplierContractAccess';
import { supplierSnapshot } from './supplierContractStore';
import { supplierFail, supplierFingerprint, supplierJson, type SupplierContractKind } from './supplierContractPolicy';

/** The document adapter reads the approved immutable revision. Mutable header
 * rows and offline acknowledgement labels are never an approval substitute. */
export type SupplierContractDocumentParams = { actor: TokenPayload; kind: SupplierContractKind; id: string; revisionId?: string; forNewPromise?: boolean };
export async function readSupplierContractDocumentInTx(tx: SupplierContractTx, params: SupplierContractDocumentParams) {
    const current = await authorizeSupplierContract(tx, params.kind, params.id, params.actor, { mode: params.forNewPromise ? 'write' : 'read', lock: params.forNewPromise, businessGates: false });
    const id = params.revisionId ?? current.contract.approvedCommitmentRevisionId;
    if (!id) return supplierFail('APPROVED_REVISION_REQUIRED', '尚无明确批准版本，不能生成正式采购单或加工合同。', 409);
    const revision = await tx.supplierCommitmentRevision.findUnique({ where: { id } });
    if (!revision || (params.kind === 'purchase' ? revision.purchaseOrderId : revision.outsourcingOrderId) !== params.id
      || !['approved', 'superseded'].includes(revision.status) || supplierFingerprint(revision.snapshot) !== revision.contentFingerprint)
      return supplierFail('SOURCE_PROOF_UNKNOWN', '正式文件准确批准依据无法核实。', 409);
    const snapshot = supplierSnapshot(revision.snapshot, params.kind);
    await authorizeSupplierSources(tx, params.actor, [...new Set([...snapshot.lines.map(row => row.orderLineId), ...snapshot.sourceProofs.map(row => row.orderLineId)])], { mode: params.forNewPromise ? 'write' : 'read', businessGates: false });
    if (params.forNewPromise) await requireApprovedSupplierBasis(tx, params.kind, params.id, current, id, params.actor, true);
    return { contractId: params.id, contractKind: params.kind, number: current.contract.number, revisionId: revision.id, revision: revision.revision,
      contentFingerprint: revision.contentFingerprint, approvedAt: revision.decidedAt?.toString() ?? null, historical: current.contract.approvedCommitmentRevisionId !== revision.id,
      snapshot: supplierJson(snapshot), sourceRef: `supplier:${params.kind}:${params.id}:${revision.id}` };
}
export async function readSupplierContractDocument(params: SupplierContractDocumentParams & { prisma: PrismaClient }) {
  return params.prisma.$transaction(tx => readSupplierContractDocumentInTx(tx, params), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
