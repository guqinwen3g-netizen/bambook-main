/**
 * 工作助手读取 Office 附件正文（.docx / .xlsx / .pptx）。
 * 只解 OOXML 压缩包里的 XML 文本，不执行宏、不读嵌入对象；解压前按条目登记的原始大小限额，防压缩炸弹。
 * 不用 xlsx(SheetJS 0.18) 解析外部文件：该版本对构造文件有原型污染与正则回溯问题。
 */
import JSZip from 'jszip';
import { posix } from 'node:path';

const ENTRY_MAX = 30 * 1024 * 1024;
const TOTAL_MAX = 60 * 1024 * 1024;
const SHEETS_MAX = 20;
const COLUMNS_MAX = 60;
const SLIDES_MAX = 200;

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';
export type OfficeText = { text: string; truncated: boolean; sheets?: string[]; pages?: number; reason?: string };

const OFFICE_MIME: Record<OfficeKind, RegExp> = {
  docx: /wordprocessingml\.document/i,
  xlsx: /spreadsheetml\.sheet/i,
  pptx: /presentationml\.presentation/i,
};
export function officeKind(file: { name: string; mimeType: string }): OfficeKind | undefined {
  const ext = /\.(docx|xlsx|pptx)$/i.exec(file.name)?.[1]?.toLowerCase() as OfficeKind | undefined;
  return ext ?? (Object.keys(OFFICE_MIME) as OfficeKind[]).find(k => OFFICE_MIME[k].test(file.mimeType));
}
export const LEGACY_OFFICE = /\.(doc|xls|ppt)$/i;

class OfficeLimit extends Error {}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITY[code.toLowerCase()] ?? whole;
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? decodeXml(m[1]) : undefined; };

/** Resolve package-local relationships only; never fetch an external document. */
function partTargets(xml: string, directory: string) {
  const targets = new Map<string,string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id=attr(m[0],'Id'),target=attr(m[0],'Target');
    if(!id||!target||attr(m[0],'TargetMode')==='External'||/^[a-z][a-z0-9+.-]*:|^\/\/|\\/i.test(target))continue;
    const path=posix.normalize(target.startsWith('/')?target.slice(1):directory+'/'+target);
    if(path.startsWith(directory+'/')&&!path.includes('\0'))targets.set(id,path);
  }
  return targets;
}

/** 按条目原始大小限额后读取文本；条目不存在返回 undefined。 */
function reader(zip: JSZip) {
  let total = 0;
  return async (path: string): Promise<string | undefined> => {
    const entry = zip.file(path);
    if (!entry) return undefined;
    const size = Number((entry as any)._data?.uncompressedSize);
    if (!Number.isFinite(size) || size < 0 || size > ENTRY_MAX || (total += size) > TOTAL_MAX) throw new OfficeLimit();
    return entry.async('string');
  };
}

/** Word 正文：段落换行，表格单元格以制表符分隔、行尾换行。 */
export function docxText(xml: string): string {
  let out = '', inText = false, cell = 0;
  const token = /<(\/?)(w:p|w:tc|w:tr|w:t|w:tab|w:br|w:cr)\b([^>]*?)(\/?)>|([^<]+)|<[^>]*>/g;
  for (let m; (m = token.exec(xml));) {
    const [, close, name, , self, text] = m;
    if (text !== undefined) { if (inText) out += decodeXml(text); continue; }
    if (!name) continue;
    if (name === 'w:t') { inText = !close && !self; continue; }
    if (name === 'w:tab' && !close) out += '\t';
    else if ((name === 'w:br' || name === 'w:cr') && !close) out += '\n';
    else if (name === 'w:p' && close) out += cell > 0 ? ' ' : '\n';
    else if (name === 'w:tc') { if (close) { cell = Math.max(0, cell - 1); out = out.replace(/ $/, '') + '\t'; } else if (!self) cell++; }
    else if (name === 'w:tr' && close) out = out.replace(/\t$/, '') + '\n';
  }
  return out;
}

/** 内置日期格式与含年月日的自定义格式。 */
function dateStyles(styles: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!styles) return dates;
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) { const id = Number(attr(m[0], 'numFmtId')), code = attr(m[0], 'formatCode') ?? ''; custom.set(id, code); }
  const isDate = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && /[ymd]/i.test(custom.get(id)!.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  let index = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) { if (isDate(Number(attr(m[0], 'numFmtId')))) dates.add(index); index++; }
  return dates;
}
function serialDate(value: number, date1904: boolean): string {
  const ms = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.round(value * 86_400_000);
  const iso = new Date(ms).toISOString();
  return value % 1 ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
}
const columnIndex = (ref: string | undefined, fallback: number) => {
  const letters = /^([A-Z]+)/.exec(ref ?? '')?.[1];
  if (!letters) return fallback;
  let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1;
};
const cellText = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();

export function sheetRows(xml: string, shared: string[], dates: Set<number>, date1904: boolean, budget: number): { lines: string[]; truncated: boolean } {
  const lines: string[] = []; let used = 0, truncated = false;
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []; let next = 0;
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = c[1], body = c[2] ?? '', col = columnIndex(attr(' ' + head, 'r'), next); next = col + 1;
      if (col >= COLUMNS_MAX) { truncated = true; continue; }
      const type = attr(' ' + head, 't'), style = Number(attr(' ' + head, 's') ?? -1);
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => decodeXml(t[1])).join('');
      else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
      else if (raw !== undefined) { const v = decodeXml(raw); const n = Number(v); value = (!type || type === 'n') && dates.has(style) && Number.isFinite(n) ? serialDate(n, date1904) : v; }
      cells[col] = cellText(value);
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (!cells.length) continue;
    const line = Array.from(cells, v => v ?? '').join('\t');
    if (used + line.length + 1 > budget) {
      const remaining=Math.max(0,budget-used-1);
      if(remaining)lines.push(line.slice(0,remaining));
      truncated = true; break;
    }
    lines.push(line); used += line.length + 1;
  }
  return { lines, truncated };
}

async function xlsxText(read: (p: string) => Promise<string | undefined>, limit: number): Promise<OfficeText> {
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('Missing workbook');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = partTargets(rels,'xl');
  const sharedXml = (await read('xl/sharedStrings.xml')) ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(si => [...si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => decodeXml(t[1])).join(''));
  const dates = dateStyles(await read('xl/styles.xml'));
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: attr(m[0], 'name') ?? '', rid: attr(m[0], 'r:id'), hidden: /state="(hidden|veryHidden)"/.test(m[0]) })).filter(s => !s.hidden);
  const parts: string[] = []; let truncated = sheets.length > SHEETS_MAX, used = 0;
  for (const sheet of sheets.slice(0, SHEETS_MAX)) {
    const path = sheet.rid && target.get(sheet.rid);
    const xml = path ? await read(path) : undefined;
    if (!xml) throw new Error('Missing worksheet');
    const head = `## 工作表：${sheet.name}`;
    const { lines, truncated: cut } = sheetRows(xml, shared, dates, date1904, Math.max(0, limit - used - head.length - 2));
    truncated ||= cut;
    const block = [head, ...(lines.length ? lines : [cut?'（正文超出本次摘录范围）':'（空）'])].join('\n');
    parts.push(block); used += block.length + 2;
    if (used >= limit) { truncated = true; break; }
  }
  return { text: parts.join('\n\n'), truncated, sheets: sheets.map(s => s.name) };
}

async function pptxText(read: (p: string) => Promise<string | undefined>): Promise<OfficeText> {
  const presentation=await read('ppt/presentation.xml');
  if(!presentation)throw new Error('Missing presentation');
  const targets=partTargets((await read('ppt/_rels/presentation.xml.rels'))??'','ppt');
  const slides=[...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map((m,i)=>({path:targets.get(attr(m[0],'r:id')||''),n:i+1}));
  const parts: string[] = [];
  for (const slide of slides.slice(0, SLIDES_MAX)) {
    if(!slide.path)throw new Error('Missing slide relationship');
    const xml = await read(slide.path);
    if(!xml)throw new Error('Missing slide');
    const paras = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(p => [...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(t => decodeXml(t[1])).join('')).filter(s => s.trim());
    if (paras.length) parts.push(`## 第 ${slide.n} 页\n${paras.join('\n')}`);
  }
  return { text: parts.join('\n\n'), truncated: slides.length > SLIDES_MAX, pages: slides.length };
}

/** 返回未截断的正文（由调用方统一按 limit 截取）；无法解析时给出原因。 */
export async function extractOfficeText(kind: OfficeKind, bytes: Uint8Array, limit: number): Promise<OfficeText & { unreadable?: boolean }> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { text: '', truncated: false, unreadable: true, reason: '文件不是有效的 Office 文档（可能是旧版格式或已加密）' };
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return { text: '', truncated: false, unreadable: true, reason: 'Office 文档无法解压（可能已损坏或加密）' }; }
  const read = reader(zip);
  try {
    if (kind === 'docx') {
      const xml = await read('word/document.xml');
      if (!xml) return { text: '', truncated: false, unreadable: true, reason: '不是有效的 Word 文档' };
      return { text: docxText(xml), truncated: false };
    }
    if (kind === 'xlsx') return await xlsxText(read, limit);
    return await pptxText(read);
  } catch (error) {
    if (error instanceof OfficeLimit) return { text: '', truncated: false, unreadable: true, reason: '文档解压后过大，不提取正文' };
    return { text: '', truncated: false, unreadable: true, reason: 'Office 文档无法解析' };
  }
}
