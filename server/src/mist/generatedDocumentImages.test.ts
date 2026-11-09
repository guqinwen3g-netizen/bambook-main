import { describe, expect, it } from 'vitest';
import { generatedDocumentImages } from './generatedDocumentPrint';
import { renderGeneratedDocumentHtml } from '../templates/generatedDocument';
import type { GeneratedDocSnapshot } from '../shared/mistGeneratedDocument';

const snapshot = (rows: Array<Record<string, string>>): GeneratedDocSnapshot => ({
  templateVersion: 1, kind: 'LOOKBOOK', number: 'LB-1', date: '2026-11-09', title: { zh: '画册', en: 'LOOKBOOK' },
  issuer: { legalName: '雾织', englishName: '', address: '', englishAddress: '', phone: '', email: '', taxId: '', customsCode: '' } as GeneratedDocSnapshot['issuer'],
  parties: [], facts: [], paragraphs: [], signatures: [], generatedAt: '', generatedBy: '', generatedById: 'u',
  table: { columns: [{ key: 'image', label: { zh: '图片', en: 'Image' }, image: true }, { key: 'sku', label: { zh: '货号', en: 'Item no.' } }], rows },
});

describe('generated document images', () => {
  it('embeds referenced bitmaps and skips unsupported, oversized or unreadable files without failing', async () => {
    const files = [
      { id: 'png', mimeType: 'image/png', size: 10 },
      { id: 'pdf', mimeType: 'application/pdf', size: 10 },
      { id: 'big', mimeType: 'image/jpeg', size: 9 * 1024 * 1024 },
      { id: 'lost', mimeType: 'image/png', size: 10 },
    ];
    const s = snapshot([{ image: 'png', sku: 'A' }, { image: 'pdf', sku: 'B' }, { image: 'big', sku: 'C' }, { image: 'lost', sku: 'D' }, { image: '', sku: 'E' }]);
    const read = async (file: { id: string }) => { if (file.id === 'lost') throw new Error('missing'); return Buffer.from('img-' + file.id); };
    const images = await generatedDocumentImages(s, files, read);
    expect(images).toEqual({ png: 'data:image/png;base64,' + Buffer.from('img-png').toString('base64') });
    const html = renderGeneratedDocumentHtml(s, { images });
    expect(html.match(/class="doc-thumb"/g)).toHaveLength(1);
    expect(html).toContain(images.png);
    expect(html).not.toContain('>pdf<');
  });

  it('reads nothing when the document has no image column', async () => {
    const s = { ...snapshot([]), table: { columns: [{ key: 'sku', label: { zh: '货号', en: 'Item no.' } }], rows: [{ sku: 'A' }] } };
    let reads = 0;
    expect(await generatedDocumentImages(s, [], async () => { reads++; return Buffer.from(''); })).toEqual({});
    expect(reads).toBe(0);
  });
});
