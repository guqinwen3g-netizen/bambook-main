import { createHash } from 'node:crypto';
import { renderHtmlToPdf, type PdfRenderResult } from '../templates/pdf';
import { renderPurchaseDocumentHtml } from '../templates/purchaseDocument';
import { MistCommandError } from '../shared/mistWorkspace';
import { purchaseDocumentFileName, purchaseDocumentFingerprint, type PurchaseDocumentArtifact, type PurchaseDocumentSnapshot } from '../shared/mistPurchaseDocument';
import type { MistFileInput, MistStoredFile } from './files';

type Prepared = { snapshot: PurchaseDocumentSnapshot; file: MistFileInput; sha256: string; bytes: number };
export async function buildPurchaseDocument(snapshot: PurchaseDocumentSnapshot, seq: number, renderPdf = (html: string): Promise<PdfRenderResult> => renderHtmlToPdf(html, { format: 'A4' })): Promise<Prepared> {
  let result: PdfRenderResult;
  try { result = await renderPdf(renderPurchaseDocumentHtml(snapshot)); }
  catch { throw new MistCommandError('PURCHASE_PDF_UNAVAILABLE', '单据生成失败，请稍后重试', 422); }
  const bytes = Buffer.from(result.pdf), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(Math.max(0, bytes.length - 1024)).toString('ascii').includes('%%EOF') || result.sha !== sha256 || result.bytes !== bytes.length) throw new MistCommandError('PURCHASE_PDF_INVALID', '未生成有效PDF，请重试', 422);
  return { snapshot: structuredClone(snapshot), file: { bytes, name: purchaseDocumentFileName(snapshot, seq), mimeType: 'application/pdf' }, sha256, bytes: bytes.length };
}
export function bindPurchaseDocument(prepared: Prepared, file: MistStoredFile, ctx: { id: () => string; workspaceId: string }): PurchaseDocumentArtifact {
  if (file.mimeType !== 'application/pdf' || file.size !== prepared.bytes || file.name !== prepared.file.name || file.storageKey !== ctx.workspaceId + '/' + file.id || createHash('sha256').update(Buffer.from(prepared.file.bytes)).digest('hex') !== prepared.sha256) throw new MistCommandError('PURCHASE_ARCHIVE_INVALID', '单据归档失败', 422);
  const s = prepared.snapshot;
  return { file: structuredClone(file), record: { id: ctx.id(), purchaseId: s.purchaseId, revision: s.revision, fileId: file.id, fileName: file.name, sha256: prepared.sha256, bytes: prepared.bytes, snapshotFingerprint: purchaseDocumentFingerprint(s), snapshot: structuredClone(s), generatedAt: s.generatedAt, generatedBy: s.generatedBy } };
}
