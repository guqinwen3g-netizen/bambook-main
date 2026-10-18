/** 客户对账单 PDF：服务端按冻结快照渲染、校验，写入私有存储后绑定为命令上下文中的归档产物。 */
import { createHash } from 'node:crypto';
import { renderHtmlToPdf, type PdfRenderResult } from '../templates/pdf';
import { renderCustomerStatementHtml } from '../templates/customerStatement';
import { MistCommandError } from '../shared/mistWorkspace';
import { customerStatementFileName, customerStatementFingerprint, type CustomerStatementArtifact, type StatementSnapshot } from '../shared/mistCustomerStatement';
import type { MistFileInput, MistStoredFile } from './files';

export { prepareCustomerStatementSnapshot } from '../shared/mistCustomerStatement';
export type PreparedCustomerStatement = { snapshot: StatementSnapshot; snapshotFingerprint: string; file: MistFileInput; sha256: string; bytes: number };
const fail = (message: string): never => { throw new MistCommandError('CUSTOMER_STATEMENT_PRECONDITION', message, 422); };

export async function buildCustomerStatement(snapshot: StatementSnapshot, options: { renderPdf?: (html: string) => Promise<PdfRenderResult> } = {}): Promise<PreparedCustomerStatement> {
  const html = renderCustomerStatementHtml(snapshot), render = options.renderPdf || ((value: string) => renderHtmlToPdf(value, { format: 'A4' }));
  let result: PdfRenderResult;
  // 渲染失败发生在文件写入和落库之前，明确拒绝以便前端结束本次请求。
  try { result = await render(html); } catch (error) { console.error('[mist] customer statement PDF render failed:', error instanceof Error ? error.message : error); throw new MistCommandError('CUSTOMER_STATEMENT_PDF_UNAVAILABLE', '对账单 PDF 渲染服务暂不可用，本次未生成文件，请稍后重试或联系管理员', 422); }
  const bytes = Buffer.from(result.pdf);
  if (bytes.length < 10 || bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(Math.max(0, bytes.length - 1024)).toString('ascii').includes('%%EOF')) return fail('PDF渲染未返回有效对账单');
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (result.sha !== sha || result.bytes !== bytes.length) return fail('对账单PDF哈希或大小不一致');
  return { snapshot: structuredClone(snapshot), snapshotFingerprint: customerStatementFingerprint(snapshot), file: { bytes, name: customerStatementFileName(snapshot), mimeType: 'application/pdf' }, sha256: sha, bytes: bytes.length };
}

export function bindCustomerStatement(prepared: PreparedCustomerStatement, file: MistStoredFile, context: { id: () => string; workspaceId: string; requestId: string }): CustomerStatementArtifact {
  if (file.mimeType !== 'application/pdf' || file.size !== prepared.bytes || file.name !== prepared.file.name || file.storageKey !== context.workspaceId + '/' + file.id || !context.requestId) return fail('对账单未按当前工作区安全归档');
  if (createHash('sha256').update(Buffer.from(prepared.file.bytes)).digest('hex') !== prepared.sha256) return fail('待归档对账单字节已变化');
  const s = prepared.snapshot;
  return { requestId: context.requestId, file: structuredClone(file), record: { id: context.id(), customerId: s.customer.id, statementNo: s.statementNo, seq: s.seq, asOf: s.asOf, totals: s.sections.map(sec => ({ currency: sec.currency, net: sec.net })), fileId: file.id, fileName: file.name, sha256: prepared.sha256, bytes: prepared.bytes, templateVersion: s.templateVersion, snapshotFingerprint: prepared.snapshotFingerprint, snapshot: structuredClone(s), generatedAt: s.generatedAt, generatedBy: s.generatedBy, generatedById: s.generatedById } };
}
