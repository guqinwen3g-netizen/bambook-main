// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { MistRoot } from '../../../../../components/mist';
import { PERMISSION_SCOPES } from '../../../../../lib/rolePermissionMatrix';
import { JobPermissionEditor } from './JobPermissionEditor';
it('tells administrators that label-only approval codes do not decide who approves', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    act(() => root.render(<MistRoot><JobPermissionEditor value={[]} onChange={() => {}} catalog={Object.keys(PERMISSION_SCOPES)} /></MistRoot>));
    const orders = host.querySelector('[data-approval-label-only="orders"]')?.textContent || '';
    expect(orders).toContain('该权限不控制审批人，审批人由审批规则决定');
    expect(host.querySelector('[data-approval-label-only="shipments"]')).not.toBeNull();
    expect(host.querySelector('[data-approval-label-only="procurement"]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});
