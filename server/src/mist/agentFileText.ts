/**
 * 工作助手读取附件正文（bambook_file_text）。
 * 只在调用方已通过 canReadFile 授权取得字节之后运行：纯文本、PDF 与 Word / Excel / PowerPoint（OOXML）取有界摘录，其余类型如实标明不支持，不猜测内容。
 * 摘录是外部来源的不可信资料，不得当作本人指令。
 */
import { PDFParse } from 'pdf-parse';
import { extractOfficeText, LEGACY_OFFICE, officeKind } from './agentOfficeText';

export const FILE_TEXT_DEFAULT = 8_000;
export const FILE_TEXT_MAX = 20_000;
const SOURCE_BYTES_MAX = 20 * 1024 * 1024;
const PDF_PAGES_MAX = 20;
class PdfPageOutOfRange extends RangeError {}
const TEXT_MIME = /^(text\/|application\/(json|xml|csv)\b)/i;
const TEXT_EXT = /\.(txt|csv|json|xml|md|log)$/i;

export type FileTextResult = { kind: 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'unsupported' | 'unreadable'; text: string; truncated: boolean; pages?: number; window?: {start:number;end:number}; pagesWithoutText?:number[]; sheets?: string[]; reason?: string };

export const fileTextLimit = (value: unknown): number => {
  if (value === undefined) return FILE_TEXT_DEFAULT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 200 || value > FILE_TEXT_MAX) throw new RangeError(`maxChars 需为 200–${FILE_TEXT_MAX} 的整数`);
  return value;
};

const clean = (text: string) => text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const cut = (text: string, limit: number) => ({ text: text.slice(0, limit), truncated: text.length > limit });

export async function extractFileText(file: { name: string; mimeType: string }, bytes: Uint8Array, limit: number, startPage=1): Promise<FileTextResult> {
  if (bytes.length > SOURCE_BYTES_MAX) return { kind: 'unsupported', text: '', truncated: false, reason: '文件超过 20MB，不提取正文' };
  const isPdf = /^application\/pdf\b/i.test(file.mimeType) || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return { kind: 'unreadable', text: '', truncated: false, reason: '文件不是有效的 PDF' };
    let parser: PDFParse | undefined;
    try {
      parser = new PDFParse({ data: new Uint8Array(bytes) });
      const result = await parser.getText({ first: startPage, last: startPage+PDF_PAGES_MAX-1, pageJoiner: '' });
      if(startPage>result.total)throw new PdfPageOutOfRange('附件续读页码超出原件');
      const window={start:startPage,end:Math.min(result.total,startPage+PDF_PAGES_MAX-1)},morePages=window.end<result.total;
      const text = clean(result.text ?? '');
      const pageText=new Map(result.pages.map(page=>[page.num,page.text]));
      const pagesWithoutText=Array.from({length:window.end-window.start+1},(_,i)=>window.start+i).filter(page=>!clean(pageText.get(page)??''));
      if (!text) return { kind: 'pdf', text: '', truncated: morePages, pages: result.total, window, pagesWithoutText, reason: morePages ? `第 ${window.start}–${window.end} 页未提取到文字，后续页尚未读取` : '未提取到文字，可能是扫描件或图片' };
      const out = cut(text, limit);
      return { kind: 'pdf', ...out, truncated: out.truncated || morePages, pages: result.total, window, ...(pagesWithoutText.length?{pagesWithoutText,reason:`第 ${pagesWithoutText.join('、')} 页没有可提取文字，请核对原页是否为空白或扫描件`}:{}) };
    } catch(error) { if(error instanceof PdfPageOutOfRange)throw error;return { kind: 'unreadable', text: '', truncated: false, reason: 'PDF 无法解析（可能已加密或损坏）' }; }
    finally { try { await parser?.destroy(); } catch { /* parser already released */ } }
  }
  if (TEXT_MIME.test(file.mimeType) || TEXT_EXT.test(file.name)) {
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const bad = (decoded.match(/�/g) ?? []).length;
    if (bad > decoded.length * 0.05) return { kind: 'unreadable', text: '', truncated: false, reason: '文本编码无法识别' };
    return { kind: 'text', ...cut(clean(decoded), limit) };
  }
  const office = officeKind(file);
  if (office) {
    const result = await extractOfficeText(office, bytes, limit);
    if (result.unreadable) return { kind: 'unreadable', text: '', truncated: false, reason: result.reason };
    const out = cut(clean(result.text), limit);
    if (!out.text) return { kind: office, text: '', truncated: false, ...(result.sheets ? { sheets: result.sheets } : {}), ...(result.pages !== undefined ? { pages: result.pages } : {}), reason: '文档里没有可提取的文字' };
    return { kind: office, ...out, truncated: out.truncated || result.truncated, ...(result.sheets ? { sheets: result.sheets } : {}), ...(result.pages !== undefined ? { pages: result.pages } : {}) };
  }
  if (LEGACY_OFFICE.test(file.name)) return { kind: 'unsupported', text: '', truncated: false, reason: '旧版 Office 格式（.doc/.xls/.ppt）暂不提取，可另存为 .docx/.xlsx/.pptx 后上传' };
  if (/^image\//i.test(file.mimeType) || /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(file.name)) return { kind: 'unsupported', text: '', truncated: false, reason: '图片不提取文字，请本人查看' };
  return { kind: 'unsupported', text: '', truncated: false, reason: `暂不提取 ${file.mimeType || '该类型'} 的正文` };
}
