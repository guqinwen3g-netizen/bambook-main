import { createHash } from 'node:crypto';
import { MistCommandError } from '../shared/mistWorkspace';
import { type TrimNoticeSnapshot } from '../shared/mistGarmentTrimTasks';
import { buildServerDocument, esc } from '../templates/docPrintBase';
import { renderHtmlToPdf, type PdfRenderResult } from '../templates/pdf';
import type { MistFileInput } from './files';

export async function buildTrimTaskNotice(
  snapshot: TrimNoticeSnapshot,
  render: (html: string) => Promise<PdfRenderResult> = html => renderHtmlToPdf(html, { format: 'A4' }),
): Promise<MistFileInput> {
  const facts = [
    ['开发案', snapshot.devCode + ' · ' + snapshot.devName],
    ['辅料任务', snapshot.taskCode],
    ['联系人', snapshot.contact],
    ['数量和单位', snapshot.quantity + ' ' + snapshot.unit],
    ['交期', snapshot.dueDate],
  ];
  const html = buildServerDocument(`
    <header class="doc-header">
      <div class="doc-title-block"><h1>${esc(snapshot.issuer.legalName)}</h1>
        <div>${esc([snapshot.issuer.address, snapshot.issuer.phone].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="doc-meta"><h2>${esc(snapshot.title)}</h2>
        <div>${esc(snapshot.noticeNo)}</div><div>致：${esc(snapshot.supplier)}</div>
      </div>
    </header>
    <table class="doc-table"><tbody>${facts.filter(([, value]) => value).map(([label, value]) =>
      `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table>
    <section><h3>开发要求</h3><div class="trim-requirements">${esc(snapshot.requirements)}</div></section>
    ${snapshot.attachments.length ? `<section><h3>附件</h3><ol>${snapshot.attachments.map(file => `<li>${esc(file.name)}</li>`).join('')}</ol></section>` : ''}
    <footer class="doc-footer">${esc(snapshot.generatedBy)}</footer>
  `, { extraStyles: '@page{size:A4}body{padding:0;font-size:11px}.trim-requirements{white-space:pre-wrap;overflow-wrap:anywhere}li{overflow-wrap:anywhere}.doc-table th{width:25%;text-align:left}' });
  let output: PdfRenderResult;
  try {
    output = await render(html);
  } catch {
    throw new MistCommandError('TRIM_NOTICE_PDF_UNAVAILABLE', '辅料通知单生成失败，请重试', 422);
  }
  const bytes = Buffer.from(output.pdf);
  if (bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-1024).includes('%%EOF') ||
      output.bytes !== bytes.length || output.sha !== createHash('sha256').update(bytes).digest('hex')) {
    throw new MistCommandError('TRIM_NOTICE_PDF_INVALID', '辅料通知单文件校验失败，请重试', 422);
  }
  return { name: snapshot.title + '-' + snapshot.noticeNo + '.pdf', mimeType: 'application/pdf', bytes };
}
