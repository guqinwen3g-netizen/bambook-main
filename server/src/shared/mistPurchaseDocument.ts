import { MistCommandError, assertMistOrderApproved, lineAmount, type MistContext, type MistState } from './mistWorkspace';
import type { FulfillmentPurchaseRevision } from './mistFulfillment';
import { creditDocumentFingerprint } from './mistCreditDocuments';
import { platformBusinessDate } from './mistPlatform';
import type { MistRfq } from './mistSourcing';

export type PurchaseDocumentSnapshot = {
  purchaseId: string; code: string; revision: number; templateVersion: 1; date: string;
  issuer: { legalName: string; englishName: string; address: string; englishAddress: string; phone: string; email: string; taxId: string };
  supplier: { name: string; address: string }; orderCode: string; style: string;
  contract: FulfillmentPurchaseRevision['snapshot']; total: string;
  generatedAt: string; generatedBy: string; generatedById: string;
};
export type PurchaseDocumentRecord = { id: string; purchaseId: string; revision: number; fileId: string; fileName: string; sha256: string; bytes: number; snapshotFingerprint: string; snapshot: PurchaseDocumentSnapshot; generatedAt: string; generatedBy: string };
export type PurchaseDocumentArtifact = { record: PurchaseDocumentRecord; file: { id: string; name: string; mimeType: string; size: number; storageKey: string; createdAt: string; uploadedBy?: string } };
export const purchaseDocumentFingerprint = (s: PurchaseDocumentSnapshot) => creditDocumentFingerprint(s);
export const purchaseDocumentFileName = (s: PurchaseDocumentSnapshot, seq: number) => `${s.code}-V${s.revision}-${String(seq).padStart(2, '0')}.pdf`;
const fail = (message: string): never => { throw new MistCommandError('PURCHASE_DOCUMENT_PRECONDITION', message, 422); };

/** Only the approved commercial snapshot is sent to the supplier. Approval comments and internal financial data stay in the workspace. */
export function preparePurchaseDocumentSnapshot(root: MistState, payload: unknown, ctx: MistContext): PurchaseDocumentSnapshot {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => k !== 'id') || typeof (payload as { id?: unknown }).id !== 'string') fail('单据内容须按已批准合同生成');
  const p = root.fulfillment.purchases.find(p => p.id === (payload as { id: string }).id);
  if (!p || p.state !== 'approved' || p.decision?.decision !== 'approved') return fail('请先批准合同');
  assertMistOrderApproved(root, p.orderId);
  const revision = p.revisionHistory?.at(-1);
  if (!revision || revision.decision?.decision !== 'approved') return fail('缺少已批准合同版本');
  const c = root.settings.companyProfile;
  if (!c?.legalName) return fail('请先补全公司抬头');
  const order = root.orders.find(o => o.id === revision.snapshot.orderId), line = root.orderLines.find(l => l.id === revision.snapshot.lineId && l.orderId === order?.id);
  if (!order || !line || !ctx.actorId) return fail('无法核对合同来源或经办人');
  const supplier = root.market.suppliers.find(s => s.id === revision.snapshot.supplierId);
  const contract = structuredClone(revision.snapshot);
  const rfq = (root as MistState & { rfqs?: MistRfq[] }).rfqs?.find(r => r.award?.purchaseId === p.id && r.orderId === contract.orderId && r.lineId === contract.lineId);
  if (rfq?.award) {
    // Remove only the exact system-generated award paragraph backed by this RFQ.
    // Free supplier requirements and the original approved/audit records remain intact.
    const count = rfq.quotes.filter(q => !q.supersededAt && !q.declined).length;
    const memo = `询价 ${rfq.code} 定标（${count} 家报价）${rfq.award.reason ? '：' + rfq.award.reason : ''}`;
    const sections = contract.note.split(/\n\s*\n/), supplierSections = sections.filter(section => section.trim() !== memo);
    if (supplierSections.length !== sections.length) contract.note = supplierSections.join('\n\n');
  }
  return {
    purchaseId: p.id, code: p.code, revision: revision.revision, templateVersion: 1, date: platformBusinessDate(ctx.now),
    issuer: { legalName: c.legalName, englishName: c.englishName || '', address: c.address || '', englishAddress: c.englishAddress || '', phone: c.phone || '', email: c.email || '', taxId: c.taxId || '' },
    supplier: { name: revision.snapshot.supplier, address: supplier?.address || '' }, orderCode: order.code, style: line.style,
    contract, total: lineAmount(revision.snapshot.quantity, revision.snapshot.price).toFixed(2),
    generatedAt: ctx.now, generatedBy: ctx.actorName, generatedById: ctx.actorId,
  };
}
