// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MODULE_VIEWS, PageLoadBoundary, page, preloadPage } from './pageRegistry';
import { FULFILLMENT_PAGES } from './pages/modules/FulfillmentPages';
import { MARKET_PAGES } from './pages/modules/MarketPages';
import { PLATFORM_PAGES } from './pages/modules/PlatformPages';

it('lists exactly the views each module file exports', () => {
  expect([...MODULE_VIEWS.FULFILLMENT_PAGES].sort()).toEqual(Object.keys(FULFILLMENT_PAGES).sort());
  expect([...MODULE_VIEWS.MARKET_PAGES].sort()).toEqual(Object.keys(MARKET_PAGES).sort());
  expect([...MODULE_VIEWS.PLATFORM_PAGES].sort()).toEqual(Object.keys(PLATFORM_PAGES).sort());
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('opens a preloaded page without committing the loading fallback', async () => {
  const loader = vi.fn(async () => ({ Example: () => <h1>Ready page</h1> }));
  const Page = page(loader, module => module.Example);
  await Promise.all([preloadPage(Page), preloadPage(Page)]);
  expect(loader).toHaveBeenCalledTimes(1);
  const fallbackCommitted = vi.fn();
  function Fallback() { React.useLayoutEffect(fallbackCommitted, []); return <p>Loading</p>; }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<React.Suspense fallback={<Fallback />}><Page /></React.Suspense>));
  expect(host.textContent).toBe('Ready page');
  expect(fallbackCommitted).not.toHaveBeenCalled();
  act(() => root.unmount()); host.remove();
});

it('retries a page preload after a network failure', async () => {
  const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ Example: () => null });
  const Page = page(loader, module => module.Example);
  await expect(preloadPage(Page)).rejects.toThrow('offline');
  await expect(preloadPage(Page)).resolves.toBeDefined();
  expect(loader).toHaveBeenCalledTimes(2);
});

it('offers a reload instead of a blank shell when page code cannot be downloaded', async () => {
  const Broken = React.lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => root.render(<PageLoadBoundary resetKey="a" fallback={() => <p>页面未能加载</p>}><React.Suspense fallback={<p>loading</p>}><Broken /></React.Suspense></PageLoadBoundary>));
  expect(host.textContent).toBe('页面未能加载');
  act(() => root.unmount()); host.remove();
});
