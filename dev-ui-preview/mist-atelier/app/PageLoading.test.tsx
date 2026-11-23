// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PageLoading } from './PageLoading';
import { CompanyManagementLoading } from './pages/CompanyManagementLoading';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('shows an accessible, padded loading state while a page loads, then displays the page', async () => {
  let finish!: (page: { default: React.ComponentType }) => void;
  const Page = React.lazy(() => new Promise(resolve => { finish = resolve; }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<React.Suspense fallback={<PageLoading />}><Page /></React.Suspense>));
  const loading = host.querySelector('[role="status"][aria-busy="true"]');
  expect(loading?.getAttribute('aria-label')).toBeTruthy();
  expect(loading?.querySelectorAll('.mist-card-body > .mist-skel')).toHaveLength(3);
  await act(async () => finish({ default: () => <h1>Loaded page</h1> }));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('h1')?.textContent).toBe('Loaded page');
  act(() => root.unmount());
  host.remove();
});

it('keeps the company management header and two-column layout during its initial load', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CompanyManagementLoading />));
    expect(host.textContent).toContain('公司管理');
    const status = host.querySelector('.mist-wizard[role="status"][aria-busy="true"]');
    expect(status?.getAttribute('aria-label')).toBeTruthy();
    expect(status?.querySelectorAll('.mist-vsteps .mist-skel')).toHaveLength(4);
    expect(status?.querySelectorAll('.mist-col .mist-card')).toHaveLength(2);
    expect(status?.querySelector('button, a, input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
