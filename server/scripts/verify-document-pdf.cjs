/** Native-browser regression: actual HTML -> PDF -> independent text parser, no database. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const dir = process.argv.includes('--source') ? '../src/templates/' : '../dist/templates/';
const ext = process.argv.includes('--source') ? '.ts' : '.js';
const { buildServerDocument } = require(path.join(dir, 'docPrintBase' + ext));
const { renderHtmlToPdf } = require(path.join(dir, 'pdf' + ext));
const { renderQuotationDocumentHtml } = require(path.join(dir, 'quotationDocument' + ext));

async function extract(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  try {
    let text = '';
    for (let n = 1; n <= doc.numPages; n++) {
      text += (await (await doc.getPage(n)).getTextContent()).items.map(item => item.str || '').join('');
    }
    return { text, pages: doc.numPages };
  } finally { await doc.destroy(); }
}
const compact = text => text.replace(/\s/g, '');

async function verify() {
  // These pairs share outlines in the upstream font, but must keep distinct character codes.
  const phrase = '普通汉字：长至禾辰生日月；部首：⻓⾄⽲⾠⽣⽇⽉；全角：／｀；兼容字：﨑崎；中文，标点。';
  const html = buildServerDocument([400, 600, 700].map(weight => `<p style="font-weight:${weight}">${phrase}</p>`).join(''));
  const result = await renderHtmlToPdf(html);
  const parsed = await extract(result.pdf);
  assert.equal(compact(parsed.text), compact(phrase.repeat(3)), 'Printed Unicode must match the source, without NFKC or radical replacement');
  assert.equal(result.sha, createHash('sha256').update(result.pdf).digest('hex'));
  assert.equal(result.bytes, result.pdf.length);

  const note = '本版有效期延长至2026-11-30，其他商业条件以本版列示为准。';
  const quotation = {
    quotationId: 'pdf-check', code: 'QT-PDF-CHECK', revision: 2, draft: false, templateVersion: 1,
    issuer: { legalName: '北辰服饰贸易有限公司', englishName: 'Northstar Textiles', address: '', englishAddress: '', phone: '', email: '' },
    customer: { id: 'customer-check', name: 'Example Textiles', country: '', city: '' },
    date: '2026-11-15', validUntil: '2026-11-30', currency: 'USD', deliveryTerms: 'FOB Shanghai', paymentTerms: 'T/T', note,
    lines: [{ no: 1, lineId: 'line-check', name: '再生涤纶面料', style: '款号长至', specification: '100%再生涤纶', specs: [], moq: '', qty: '1800', unit: '码', price: '1.90', amount: '3420.00' }],
    total: '3420.00', sourceUpdatedAt: '2026-11-15T00:00:00.000Z', generatedAt: '2026-11-15T00:00:00.000Z', generatedBy: '沈禾', generatedById: 'user-check',
  };
  const quote = await renderHtmlToPdf(renderQuotationDocumentHtml(quotation));
  const content = await extract(quote.pdf);
  for (const original of [quotation.issuer.legalName, quotation.generatedBy, note, '100%再生涤纶', '款号长至', '3420.00', '1800码', '2026-11-30']) {
    assert.ok(compact(content.text).includes(compact(original)), `Missing original PDF text: ${original}`);
  }
  assert.equal(content.pages, 1, 'The normal one-line quotation must remain one page');
  const many = { ...quotation, code: 'QT-PDF-LONG', total: '239400.00', lines: Array.from({ length: 70 }, (_, i) => ({ ...quotation.lines[0], no: i + 1, lineId: `line-${i + 1}`, name: `面料批次第${i + 1}行` })) };
  const long = await extract((await renderHtmlToPdf(renderQuotationDocumentHtml(many))).pdf);
  assert.ok(long.pages > 1, 'The long quotation must exercise pagination');
  for (const line of many.lines) assert.ok(compact(long.text).includes(line.name), `Missing row: ${line.no}`);
  assert.equal((compact(long.text).match(/USD239400\.00/g) || []).length, 1, 'The grand total must print once');
  assert.ok(compact(long.text).includes(compact(note)));
  console.log(JSON.stringify({ nativePdfText: 'passed', documents: 3, weights: [400, 600, 700], sourceCharactersPreserved: true, quotationPages: content.pages, longQuotationPages: long.pages }));
}
// The production renderer deliberately keeps its browser alive; the standalone probe owns its process.
verify().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
