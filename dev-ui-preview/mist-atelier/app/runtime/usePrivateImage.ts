import React from 'react';
import { apiService } from '../../../../services/apiService';
import { useMistSession } from './auth';

type Entry = { promise: Promise<string>; controller: AbortController; url?: string; users: number; bytes: number; usedAt: number; pending?: boolean };
const images = new Map<string, Entry>();
let currentScope = '', cachedBytes = 0;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;

function remove(key: string, entry: Entry) {
  if (images.get(key) !== entry) return;
  images.delete(key); cachedBytes -= entry.bytes;
  entry.controller.abort(); if (entry.url) URL.revokeObjectURL(entry.url);
}
function selectScope(scope: string) {
  if (currentScope === scope) return;
  for (const [key, entry] of images) remove(key, entry);
  currentScope = scope;
}
function trim() {
  if (cachedBytes <= MAX_CACHE_BYTES) return;
  for (const [key, entry] of [...images].filter(([, value]) => !value.users && !!value.url).sort((a, b) => a[1].usedAt - b[1].usedAt)) {
    remove(key, entry); if (cachedBytes <= MAX_CACHE_BYTES) break;
  }
}
function acquire(scope: string, path: string, background = false) {
  selectScope(scope);
  const key = `${scope}:${path}`;
  let entry = images.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, users: 0, bytes: 0, usedAt: Date.now(), promise: Promise.resolve('') };
    const created = entry;
    entry.promise = fetch(path, { headers: apiService.getAuthHeaders(), credentials: 'include', signal: controller.signal, ...(background ? { priority: 'low' as const } : {}) })
      .then(async response => { if (!response.ok) throw new Error('图片读取失败');created.pending=response.headers?.get?.('X-Bambook-Cutout')==='pending';return response.blob(); })
      .then(blob => {
        if (controller.signal.aborted) throw new Error('图片读取已取消');
        created.bytes = blob.size; cachedBytes += blob.size; created.usedAt = Date.now();
        created.url = URL.createObjectURL(blob); trim(); return created.url;
      });
    images.set(key, entry);
  }
  entry.usedAt = Date.now();
  return { key, entry };
}

/** Preload authenticated images into the same session cache consumed by list and detail views. */
export async function prefetchPrivateImages(scope: string, paths: string[], concurrency = 6, signal?: AbortSignal) {
  if (signal?.aborted) return;
  selectScope(scope);
  const queue = [...new Set(paths.filter(Boolean))];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (currentScope === scope && !signal?.aborted && queue.length) {
      const path = queue.shift()!;
      const { key, entry } = acquire(scope, path, true);
      try { await entry.promise; } catch { remove(key, entry); }
    }
  }));
}

/** Keep speculative image traffic behind interactive page/data requests. */
export function schedulePrivateImagePrefetch(scope: string, paths: string[]) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!paths.length || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return () => {};
  let stopped = false, running = false, timer: number | undefined, idle: number | undefined;
  let controller = new AbortController();
  const schedule = () => {
    if (stopped || running || document.hidden || timer !== undefined || idle !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (stopped || document.hidden) return;
      const run = () => {
        idle = undefined;
        if (stopped || document.hidden) return;
        if (controller.signal.aborted) controller = new AbortController();
        running = true;
        const current = controller;
        void prefetchPrivateImages(scope, paths, 1, current.signal).catch(() => undefined).finally(() => { running = false; if (current.signal.aborted) schedule(); });
      };
      if (window.requestIdleCallback) idle = window.requestIdleCallback(run);
      else run();
    }, 300);
  };
  const onVisibility = () => { if (document.hidden) controller.abort(); else schedule(); };
  document.addEventListener('visibilitychange', onVisibility);
  schedule();
  return () => {
    stopped = true; controller.abort();
    document.removeEventListener('visibilitychange', onVisibility);
    if (timer !== undefined) window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
export function clearPrivateImages() {
  for (const [key, entry] of images) remove(key, entry);
  currentScope = '';
}

export function usePrivateImageResourceForScope(path:string|undefined,scope:string){
  const key = `${scope}:${path || ''}`;
  const [image, setImage] = React.useState<{ key: string; url: string }>();
  const [failure, setFailure] = React.useState<string>();
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!path) return;
    setFailure(undefined);
    let active = true,retryTimer:ReturnType<typeof setTimeout>|undefined;
    const acquired = acquire(scope, path); acquired.entry.users++;
    void acquired.entry.promise.then(url => { if(active){setImage({key,url});if(acquired.entry.pending)retryTimer=setTimeout(()=>{remove(acquired.key,acquired.entry);setAttempt(value=>value+1);},3000);}}).catch(() => {
      remove(acquired.key, acquired.entry); if (active) { setImage(undefined); setFailure(key); }
    });
    return () => { active = false;if(retryTimer)clearTimeout(retryTimer); acquired.entry.users--; acquired.entry.usedAt = Date.now(); trim(); };
  }, [key, path, scope, attempt]);
  return { src: image?.key === key ? image.url : undefined, failed: failure === key, retry: () => setAttempt(value => value + 1) };
}
export function usePrivateImageResource(path: string | undefined, scopeHint = '') {
  const session = useMistSession();
  return usePrivateImageResourceForScope(path,`${session.sessionKey}:${session.user?.id || ''}:${scopeHint}`);
}

export function usePrivateImage(path: string | undefined, scopeHint = ''): string | undefined { return usePrivateImageResource(path, scopeHint).src; }
