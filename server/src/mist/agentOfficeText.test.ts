import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { extractFileText } from './agentFileText';

const zip = async (files: Record<string, string>) => { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })); };
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

it('reads Word paragraphs and tables, keeping cells on one row', async () => {
  const doc = `<w:document ${W}><w:body>
    <w:p><w:pPr><w:tabs/></w:pPr><w:r><w:t>采购合同 PO-2026-00012</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">交期：</w:t></w:r><w:r><w:t>2026-12-01 &amp; 分批</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>款号</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>CW-201</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  const r = await extractFileText({ name: '合同.docx', mimeType: 'application/octet-stream' }, await zip({ 'word/document.xml': doc }), 2000);
  expect(r.kind).toBe('docx');
  expect(r.text).toBe('采购合同 PO-2026-00012\n交期：2026-12-01 & 分批\n款号\t数量\nCW-201\t1200');
});

it('reads Excel sheets with shared strings, dates as dates, and skips hidden sheets', async () => {
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="装箱单" sheetId="1" r:id="rId1"/><sheet name="隐藏" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>箱号</t></si><si><r><t>交</t></r><r><t>期</t></r><rPh><t>こう</t></rPh></si><si><t>Cedar &amp; Crown</t></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy/m/d"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>12</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" s="1"><v>46357</v></c></row><row r="3"/></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>不应出现</t></is></c></row></sheetData></worksheet>',
  };
  const r = await extractFileText({ name: 'PL.xlsx', mimeType: '' }, await zip(files), 2000);
  expect(r.kind).toBe('xlsx');
  expect(r.sheets).toEqual(['装箱单']);
  expect(r.text).toBe('## 工作表：装箱单\n箱号\t\t交期\n12\tCedar & Crown\t2026-12-01');
  const small = await extractFileText({ name: 'PL.xlsx', mimeType: '' }, await zip(files), 200);
  expect(small.truncated).toBe(false);
});

it('marks long sheets truncated and reads slides in order', async () => {
  const rows = Array.from({ length: 400 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>第${i + 1}行 SO-G-2026-0${i}</t></is></c></row>`).join('');
  const book = await zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>` });
  const r = await extractFileText({ name: 'a.xlsx', mimeType: '' }, book, 500);
  expect(r).toMatchObject({ kind: 'xlsx', truncated: true });
  expect(r.text.length).toBeLessThanOrEqual(500);
  const deck = await zip({ 'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>报价汇总</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>面料</a:t></a:r><a:r><a:t>说明</a:t></a:r></a:p></p:sld>' });
  expect(await extractFileText({ name: 'deck.pptx', mimeType: '' }, deck, 2000)).toMatchObject({ kind: 'pptx', pages: 2, text: '## 第 2 页\n面料说明\n\n## 第 10 页\n报价汇总' });
});

it('refuses archives whose entries claim more than the decompression budget, and broken archives', async () => {
  const big = await zip({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>${'A'.repeat(31 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>` });
  expect(await extractFileText({ name: 'bomb.docx', mimeType: '' }, big, 500)).toMatchObject({ kind: 'unreadable', reason: expect.stringContaining('过大') });
  expect(await extractFileText({ name: 'x.docx', mimeType: '' }, new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 500)).toMatchObject({ kind: 'unreadable' });
  expect(await extractFileText({ name: 'empty.docx', mimeType: '' }, await zip({ 'other.xml': '<x/>' }), 500)).toMatchObject({ kind: 'unreadable' });
});
