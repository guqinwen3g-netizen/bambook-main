import type React from 'react';
import { pagePreloadKey, preloadPage } from './pageRegistry';

/** Preload code only, one page at a time after the current screen is ready. */
export function preloadPagesWhenIdle(pages: React.FC[], loadPage = preloadPage) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return () => {};

  const seen = new Set<ReturnType<typeof pagePreloadKey>>();
  const queue = pages.filter(page => { const key = pagePreloadKey(page); if (seen.has(key)) return false; seen.add(key); return true; });
  let stopped = false, timer: number | undefined, idle: number | undefined, running = false;
  const schedule = () => {
    if (stopped || running || document.hidden || !queue.length || timer !== undefined || idle !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (stopped || document.hidden) return;
      const run = () => {
        idle = undefined;
        if (stopped || document.hidden) return;
        const page = queue.shift();
        if (!page) return;
        running = true;
        void loadPage(page).catch(() => undefined).finally(() => { running = false; schedule(); });
      };
      if (window.requestIdleCallback) idle = window.requestIdleCallback(run);
      else run();
    }, 300);
  };
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', schedule);
    if (timer !== undefined) window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
