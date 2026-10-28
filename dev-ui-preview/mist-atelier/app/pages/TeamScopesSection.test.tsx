// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { MistRoot } from '../../../../components/mist';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ request: vi.fn(), run: vi.fn(), state: null as any, revision: 3 }));
vi.mock('../runtime/workspace', () => ({ mistApiRequest: api.request, useMistWorkspace: () => ({ state: api.state, workspace: { id: 'w1', revision: api.revision }, run: api.run, pending: null }) }));
import { TeamScopesSection, countText } from './TeamScopesSection';

let root: ReturnType<typeof createRoot>;
beforeEach(() => { api.request.mockReset(); api.run.mockReset(); api.revision = 3; });
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

it('opens the linked team and returns to the actual selected group without overriding later choices', async () => {
  vi.useFakeTimers(); let n = 0; api.state = createMistState({ id: () => `deep-${++n}`, now: '2026-10-13T00:00:00Z', actorName: 'boss' } as any, 'empty');
  api.request.mockImplementation(async (path: string) => path.endsWith('/team-scopes') ? { teams: ['t1', 't2'].map(id => ({ id, name: id, scope: { conditions: [{ id: 'c', line: 'fabric' }], picks: [], exclusions: [], history: [] }, counts })) } : { preview: { counts, readonlyCounts: {}, items: [], warnings: [] } });
  const back = vi.fn(), host = document.createElement('div'); root = createRoot(host);
  const paint = () => <MistRoot><TeamScopesSection canEdit initialTeamId="t2" onReturnToTeam={back} /></MistRoot>;
  await act(async () => root.render(paint())); await act(async () => { vi.advanceTimersByTime(350); });
  expect(host.textContent).toContain('t2 · 范围条件');
  await act(async () => ([...host.querySelectorAll('button')].find(b => b.textContent === '调整范围') as HTMLButtonElement).click());
  api.revision++; await act(async () => root.render(paint())); await act(async () => { vi.advanceTimersByTime(350); });
  expect(host.textContent).toContain('t1 · 范围条件');
  await act(async () => ([...host.querySelectorAll('button')].find(b => b.textContent === '返回小组') as HTMLButtonElement).click());
  expect(back).toHaveBeenCalledWith('t1');
});

it('refreshes the server preview when business data changes and retains the draft note', async () => {
  vi.useFakeTimers(); let n = 0; api.state = createMistState({ id: () => `preview-${++n}`, now: '2026-10-13T00:00:00Z', actorName: 'boss' } as any, 'empty');
  api.request.mockImplementation(async (path: string) => path.endsWith('/team-scopes') ? { teams: [{ id: 't1', name: '面料一组', scope: { conditions: [{ id: 'c', line: 'fabric' }], picks: [], exclusions: [], history: [] }, counts }] } : { preview: { counts: { ...counts, opportunity: api.revision - 3 }, readonlyCounts: {}, items: [], warnings: [] } });
  const host = document.createElement('div'); root = createRoot(host);
  const paint = () => <MistRoot><TeamScopesSection canEdit initialTeamId="t1" /></MistRoot>;
  await act(async () => root.render(paint())); await act(async () => { vi.advanceTimersByTime(350); });
  const note = host.querySelector('input[aria-label="调整说明"]') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(note, '保留正在填写的说明'); note.dispatchEvent(new Event('input', { bubbles: true })); });
  api.revision++; await act(async () => root.render(paint())); await act(async () => { vi.advanceTimersByTime(350); });
  expect(host.textContent).toContain('商机 1'); expect(note.value).toBe('保留正在填写的说明');
  expect(api.request.mock.calls.filter(([path]) => String(path).endsWith('/preview'))).toHaveLength(2);
});
