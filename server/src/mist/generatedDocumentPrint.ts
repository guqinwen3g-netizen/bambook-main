/** Generated business document PDF: rendered from the frozen snapshot, verified, stored privately, then bound to the command context. */
import { createHash } from 'node:crypto';
import { renderHtmlToPdf, type PdfRenderResult } from '../templates/pdf';
import { renderGeneratedDocumentHtml } from '../templates/generatedDocument';
import { MistCommandError } from '../shared/mistWorkspace';
import { GENERATED_DOCUMENT_TEMPLATE_VERSION, generatedDocFileName, generatedDocFingerprint, type GeneratedDocArtifact, type GeneratedDocSnapshot } from '../shared/mistGeneratedDocument';
import type { MistFileInput, MistStoredFile } from './files';

export type PreparedGeneratedDocument = { snapshot: GeneratedDocSnapshot; file: MistFileInput; sha256: string; bytes: number };
const fail = (message: string): never => { throw new MistCommandError('DOCUMENT_PRECONDITION', message, 422); };

const DOC_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'], DOC_IMAGE_MAX_BYTES = 8 * 1024 * 1024, DOC_IMAGE_LIMIT = 80;
/** 图片列引用的私有图片换成 data URI：只收常见位图、单张 8MB 内、最多 80 张；读不到的留空，不影响单据生成。 */
export async function generatedDocumentImages(snapshot: GeneratedDocSnapshot, files: ReadonlyArray<{ id: string; mimeType: string; size?: number }>, read: (file: any) => Promise<Buffer>): Promise<Record<string, string>> {
  const keys = snapshot.table?.columns.filter(c => c.image).map(c => c.key) ?? [], out: Record<string, string> = {};
  if (!keys.length) return out;
  const ids = [...new Set(snapshot.table!.rows.flatMap(row => keys.map(k => row[k]).filter(Boolean)))].slice(0, DOC_IMAGE_LIMIT);
  for (const id of ids) {
    const file = files.find(f => f.id === id);
    if (!file || !DOC_IMAGE_TYPES.includes(file.mimeType) || (file.size ?? 0) > DOC_IMAGE_MAX_BYTES) continue;
    try { const bytes = await read(file); if (bytes.length <= DOC_IMAGE_MAX_BYTES) out[id] = `data:${file.mimeType};base64,${bytes.toString('base64')}`; }
    catch (error) { console.error('[mist] document image unavailable:', error instanceof Error ? error.message : error); }
  }
  return out;
}
export async function buildGeneratedDocument(snapshot: GeneratedDocSnapshot, render: (html: string) => Promise<PdfRenderResult> = html => renderHtmlToPdf(html, { format: 'A4' }), options: { sealDataUrl?: string; images?: Record<string, string> } = {}): Promise<PreparedGeneratedDocument> {
  let result: PdfRenderResult;
  // Rendering happens before any file is written or state changes: a failure means nothing was generated.
  try { result = await render(renderGeneratedDocumentHtml(snapshot, options)); }
  catch (error) { console.error('[mist] document PDF render failed:', error instanceof Error ? error.message : error); throw new MistCommandError('DOCUMENT_PDF_UNAVAILABLE', '单据 PDF 渲染服务暂不可用，本次未生成文件，请稍后重试', 422); }
  const bytes = Buffer.from(result.pdf), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length < 10 || bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(Math.max(0, bytes.length - 1024)).toString('ascii').includes('%%EOF') || result.sha !== sha256 || result.bytes !== bytes.length) fail('未生成有效PDF，请重试');
  return { snapshot: structuredClone(snapshot), file: { bytes, name: options.sealDataUrl ? generatedDocFileName(snapshot).replace(/\.pdf$/, '-盖章.pdf') : generatedDocFileName(snapshot), mimeType: 'application/pdf' }, sha256, bytes: bytes.length };
}
export function bindGeneratedDocument(prepared: PreparedGeneratedDocument, file: MistStoredFile, ctx: { id: () => string; workspaceId: string; requestId: string }): GeneratedDocArtifact {
  if (file.mimeType !== 'application/pdf' || file.size !== prepared.bytes || file.name !== prepared.file.name || file.storageKey !== ctx.workspaceId + '/' + file.id || !ctx.requestId) fail('单据未按本公司安全归档');
  if (createHash('sha256').update(Buffer.from(prepared.file.bytes)).digest('hex') !== prepared.sha256) fail('待归档单据字节已变化');
  const s = prepared.snapshot;
  return { requestId: ctx.requestId, file: structuredClone(file), record: { id: ctx.id(), kind: s.kind, number: s.number, fileId: file.id, fileName: file.name, sha256: prepared.sha256, bytes: prepared.bytes, templateVersion: GENERATED_DOCUMENT_TEMPLATE_VERSION, snapshotFingerprint: generatedDocFingerprint(s), snapshot: structuredClone(s), generatedAt: s.generatedAt, generatedBy: s.generatedBy } };
}
