import { expect, it } from 'vitest';
import { businessInputInstant, businessInputValue } from './businessClock';

it('datetime inputs read and write Beijing business time regardless of the computer timezone', () => {
  expect(businessInputValue(new Date('2026-11-09T15:20:00Z'))).toBe('2026-11-09T23:20');
  expect(businessInputValue(new Date('2026-12-31T17:05:00Z'))).toBe('2027-01-01T01:05');
  expect(businessInputInstant('2026-11-09T23:20')).toBe('2026-11-09T15:20:00.000Z');
  expect(businessInputInstant(businessInputValue(new Date('2026-03-01T00:00:00Z')))).toBe('2026-03-01T00:00:00.000Z');
  expect(businessInputValue(new Date('x'))).toBe('');
});
