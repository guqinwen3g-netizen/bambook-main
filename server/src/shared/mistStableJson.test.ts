import { describe, it, expect } from 'vitest';
import { stableJson } from './stableJson';

describe('stableJson', () => {
  it('ignores object key order and undefined keys but keeps array order and values', () => {
    expect(stableJson({ a: 1, b: { c: [1, { d: 2, e: 'x' }] } })).toBe(stableJson({ b: { c: [1, { e: 'x', d: 2 }] }, a: 1, z: undefined }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: '1' }));
    expect(stableJson({ a: null })).not.toBe(stableJson({}));
    expect(stableJson(null)).toBe('null');
  });
});
