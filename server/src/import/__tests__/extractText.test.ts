import { describe, it, expect } from 'vitest';
import { extractPdfText } from '../extractText';
import { syntheticPoPdf } from './helpers/syntheticPdf';

describe('extractPdfText', () => {
  it('extracts text and page count from a synthetic PO', async () => {
    const { text, pages } = await extractPdfText(syntheticPoPdf('4500900001', 2));
    expect(pages).toBe(1);
    expect(text).toContain('Northwind Apparel Testing Inc.');
    expect(text).toContain('PO number / season / date');
    expect(text).toContain('4500900001');
  });
});
