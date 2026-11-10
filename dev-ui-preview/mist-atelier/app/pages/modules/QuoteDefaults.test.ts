import { describe, expect, it } from 'vitest';
import { defaultQuoteValidUntil, quoteTermDefaults } from './MarketPages';

describe('quote defaults', () => {
  const state = { customers: [{ id: 'c1', incoterm: 'FOB 上海', terms: 'T/T 30%' }, { id: 'c2' }] };
  it('falls back to the customer terms when there is no earlier quote', () => {
    expect(quoteTermDefaults(state, [], 'c1')).toEqual({ deliveryTerms: 'FOB 上海', paymentTerms: 'T/T 30%' });
    expect(quoteTermDefaults(state, [], 'c2')).toEqual({ deliveryTerms: '', paymentTerms: '' });
  });
  it('prefers the latest earlier quote of the same customer', () => {
    const qs: any[] = [
      { customerId: 'c1', createdAt: '2026-01-01', deliveryTerms: 'CIF 宁波', paymentTerms: 'L/C' },
      { customerId: 'c1', createdAt: '2026-03-01', deliveryTerms: 'EXW 苏州', paymentTerms: 'T/T 50%' },
      { customerId: 'c2', createdAt: '2026-05-01', deliveryTerms: 'DDP', paymentTerms: 'x' },
    ];
    expect(quoteTermDefaults(state, qs, 'c1')).toEqual({ deliveryTerms: 'EXW 苏州', paymentTerms: 'T/T 50%' });
  });
  it('validity defaults to 30 days ahead', () => {
    expect(defaultQuoteValidUntil('2026-11-10')).toBe('2026-12-10');
    expect(defaultQuoteValidUntil('2026-12-20')).toBe('2027-01-19');
  });
});
