import { describe, it, expect } from 'vitest';
import { detectCustomer } from '../detectCustomer';
import { TEST_PROFILE, peerlessHeaderLines } from './helpers/syntheticPdf';

// 识别条件来自客户档案（这里用虚构档案 TEST_PROFILE），代码不写死真实客户信息。
describe('detectCustomer', () => {
  const text = peerlessHeaderLines().join('\n');

  it('detects the profiled customer with high confidence', () => {
    const r = detectCustomer(text, [TEST_PROFILE]);
    expect(r.customerId).toBe('peerless');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.reasons).toEqual(['legal name', 'tax id ×2', 'contact', 'PO number pattern']);
  });

  it('ignores accents, case and spacing differences in the legal name', () => {
    const r = detectCustomer('NÖRTHWIND   apparel testing inc.', [TEST_PROFILE]);
    expect(r.customerId).toBe('peerless');
    expect(r.confidence).toBeCloseTo(0.5, 5);
  });

  it('detects nothing without customer profiles', () => {
    const r = detectCustomer(text);
    expect(r.customerId).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('picks the best-scoring profile', () => {
    const other = { customerId: 'other', contacts: ['Alex Sample/555-010-0100'] };
    expect(detectCustomer(text, [other, TEST_PROFILE]).customerId).toBe('peerless');
  });

  it('skips an invalid PO pattern instead of throwing', () => {
    const r = detectCustomer(text, [{ customerId: 'x', poNumberPattern: '(' }]);
    expect(r.customerId).toBeNull();
  });

  it('returns null with 0 confidence on unrelated text', () => {
    const r = detectCustomer('Hello world. Just some random text.', [TEST_PROFILE]);
    expect(r.customerId).toBeNull();
    expect(r.confidence).toBe(0);
  });
});
