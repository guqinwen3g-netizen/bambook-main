import { describe, expect, it } from 'vitest';
import { getViewPermission, isAuthenticatedPublicView, isDevOnlyView } from './modulePermissions';
import type { View } from '../types';

describe('unknown views', () => {
  it('are treated as inaccessible instead of throwing', () => {
    const stale = 'payables' as View;
    expect(isAuthenticatedPublicView(stale)).toBe(false);
    expect(isDevOnlyView(stale)).toBe(false);
    expect(getViewPermission(stale)).toBeUndefined();
  });
});
