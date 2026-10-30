import {describe, expect, it} from 'vitest';
import {commitExists, head, verdictFor} from './wiki-lib.mjs';

describe('employee manual version status', () => {
  it('recognizes a real commit without treating git’s empty success output as failure', () => {
    expect(commitExists(head())).toBe(true);
    expect(commitExists('not-a-real-commit')).toBe(false);
  });
  it('does not mark a chapter current when its actual sources are not declared or are missing', () => {
    const chapter = {verifiedCommit: head(), sources: [], module: 'orders'};
    expect(verdictFor(chapter, [])).toMatchObject({verdict: 'unverified'});
    expect(verdictFor({...chapter, sources: ['missing/retired-page.tsx']}, [])).toMatchObject({verdict: 'unverified'});
  });
});
