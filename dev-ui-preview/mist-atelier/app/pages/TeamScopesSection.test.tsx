// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { MistRoot } from '../../../../components/mist';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ request: vi.fn(), run: vi.fn(), state: null as any }));
vi.mock('../runtime/workspace', () => ({ mistApiRequest: api.request, useMistWorkspace: () => ({ state: api.state, workspace: { id: 'w1', revision: 3 }, run: api.run, pending: null }) }));
import { TeamScopesSection, countText } from './TeamScopesSection';

let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root?.unmount()); vi.useRealTimers(); });
const counts = { order: 2, quotation: 1, development: 0, opportunity: 0 };

it('lists groups with their match counts, previews edits and saves through the audited command', async () => {
  vi.useFakeTimers();
  let n = 0; api.state = createMistState({ id: () => `id-${++n}`, now: '2026-10-13T00:00:00Z', actorName: 'boss' } as any, 'demo');
  api.request.mockImplementation(async (path: string) => path.endsWith('/team-scopes')
    ? { teams: [{ id: 't1', name: 'Maison Lune 组', scope: { conditions: [{ id: 'c1', customerId: 'customer-2' }], picks: [], exclusions: [], history: [] }, counts }] }
    : { preview: { counts, readonlyCounts: { order: 0, quotation: 0, development: 0, opportunity: 0 }, byLine: {}, records: {}, items: [{ kind: 'order', id: 'SO-G-2026-012', code: 'SO-G-2026-012', name: '', access: 'collaborate' }], warnings: [] } });
  api.run.mockResolvedValue({});
  const host = document.createElement('div'); root = createRoot(host);
  await act(async () => root.render(<MistRoot><TeamScopesSection canEdit /></MistRoot>));
  expect(host.textContent).toContain('Maison Lune 组'); expect(host.textContent).toContain(countText(counts));
  await act(async () => ([...host.querySelectorAll('button')].find(b => b.textContent === '调整范围') as HTMLButtonElement).click());
  await act(async () => { vi.advanceTimersByTime(350); });
  expect(api.request).toHaveBeenLastCalledWith('/api/mist/workspaces/w1/team-scopes/preview', expect.objectContaining({ method: 'POST', body: JSON.stringify({ teamId: 't1', conditions: [{ customerId: 'customer-2' }], picks: [], exclusions: [] }) }));
  expect(host.textContent).toContain('订单 SO-G-2026-012');
  await act(async () => ([...host.querySelectorAll('button')].find(b => b.textContent === '保存范围') as HTMLButtonElement).click());
  expect(api.run).toHaveBeenCalledWith({ type: 'teamScope.save', payload: { teamId: 't1', conditions: [{ customerId: 'customer-2' }], picks: [], exclusions: [] } });
});
