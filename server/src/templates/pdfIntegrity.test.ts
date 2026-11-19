import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const { page, context } = vi.hoisted(() => ({
  page: { setContent: vi.fn(), addStyleTag: vi.fn(), evaluate: vi.fn(), pdf: vi.fn(), close: vi.fn(async () => {}) },
  context: { close: vi.fn(async () => {}) },
}));
vi.mock('playwright', () => ({ chromium: { launch: async () => ({ newContext: async () => ({ ...context, newPage: async () => page }), close: vi.fn(async () => {}) }) } }));
import { renderHtmlToPdf } from './pdf';

beforeEach(() => {
  vi.clearAllMocks();
  page.evaluate.mockResolvedValue(true);
  page.pdf.mockResolvedValue(Buffer.from('%PDF-native-renderer-integrity'));
});

it('returns full original byte integrity after bundled fonts are ready', async () => {
  const rendered = await renderHtmlToPdf('<p>native PDF engine boundary</p>');
  expect(rendered.sha).toMatch(/^[a-f0-9]{64}$/);
  expect(rendered.sha).toBe(createHash('sha256').update(rendered.pdf).digest('hex'));
  expect(rendered.bytes).toBe(rendered.pdf.length);
  expect(page.addStyleTag).toHaveBeenCalledOnce();
  expect(page.evaluate.mock.invocationCallOrder[0]).toBeLessThan(page.pdf.mock.invocationCallOrder[0]);
});

it('refuses to issue a PDF if the CJK faces fail to load and closes the context', async () => {
  page.evaluate.mockResolvedValueOnce(false);
  await expect(renderHtmlToPdf('<p>长至禾辰</p>')).rejects.toThrow('Document CJK font did not load');
  expect(page.pdf).not.toHaveBeenCalled();
  expect(page.close).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});
