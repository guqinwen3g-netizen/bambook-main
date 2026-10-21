import { describe, expect, it } from 'vitest';
import { matchingCompany, validCompanyLookupQuery } from './companyLookup';

describe('bounded company-name prefixes', () => {
  it.each([
    ['雾织', '雾织贸易', true], ['雾织', '雾织数字科技研究中心', false],
    ['雾织数字', '雾织数字科技研究中心', true],
    ['Atla', 'Atlas Labs', false], ['Atlas', 'Atlas Labs', true],
    ['Northern', 'Northern Regional Engineering Services', true],
    ['3M', '3M', true], [' ACME ', 'Acme', true],
    ['织贸', '雾织贸易', false], ['贸易', '雾织贸易', false],
  ])('query %s against %s is eligible: %s', (query, name, allowed) => {
    expect(matchingCompany(query, [{ name }])).toEqual(allowed ? [{ name }] : []);
  });

  it('suppresses ambiguity before applying coverage, regardless of name length', () => {
    expect(matchingCompany('雾织', [{ name: '雾织贸易' }, { name: '雾织数字科技研究中心' }])).toEqual([]);
  });

  it('prefers a unique complete name, but never exposes duplicate complete names', () => {
    expect(matchingCompany('Atlas', [{ name: 'Atlas' }, { name: 'Atlas Labs' }])).toEqual([{ name: 'Atlas' }]);
    expect(matchingCompany('Atlas', [{ name: 'Atlas' }, { name: 'ATLAS' }])).toEqual([]);
  });

  it.each(['雾', '%%', '__', 'Mi%', 'Mi\\', ' '.repeat(3), '司'.repeat(61)])('refuses broad or invalid input %s', query => {
    expect(validCompanyLookupQuery(query)).toBe(false);
  });
});
