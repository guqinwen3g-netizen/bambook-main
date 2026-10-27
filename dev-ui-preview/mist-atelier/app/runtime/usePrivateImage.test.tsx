// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { clearPrivateImages, prefetchPrivateImages, schedulePrivateImagePrefetch, usePrivateImage } from './usePrivateImage';

const login = vi.hoisted(() => ({ sessionKey: 'one', user: { id: 'one' } }));
vi.mock('./auth', () => ({ useMistSession: () => login }));
vi.mock('../../../../services/apiService', () => ({ apiService: { getAuthHeaders: () => ({ Authorization: 'Bearer private' }) } }));
afterEach(() => { clearPrivateImages(); vi.unstubAllGlobals(); vi.restoreAllMocks(); login.sessionKey = 'one'; login.user.id = 'one'; });

it('authenticates images, hides previous-account content and retains only the current session after unmount', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let finish!: (response: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['first']) })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  URL.createObjectURL = vi.fn(() => 'blob:private'); URL.revokeObjectURL = vi.fn();
  const host = document.createElement('div'), root = createRoot(host);
  function View() { const src = usePrivateImage('/private/image'); return src ? <img src={src} /> : null; }
  await act(async () => root.render(<View />));
  expect(fetcher).toHaveBeenCalledWith('/private/image', expect.objectContaining({ headers: { Authorization: 'Bearer private' }, credentials: 'include' }));
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:private');
  login.sessionKey = 'two'; login.user.id = 'two';
  await act(async () => root.render(<View />));
  expect(host.querySelector('img')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private');
  await act(async () => root.unmount());
  await act(async () => finish({ ok: true, blob: async () => new Blob(['late']) } as Response));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(false);
});

it('shares one authenticated image request across thumbnails and reuses it after reopening',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const fetcher=vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['image'])});vi.stubGlobal('fetch',fetcher);
 URL.createObjectURL=vi.fn(()=>'blob:shared');URL.revokeObjectURL=vi.fn();
 login.sessionKey='shared';
 const host=document.createElement('div'),root=createRoot(host);
 function Image(){const src=usePrivateImage('/private/shared');return src?<img src={src}/>:null;}
 await act(async()=>root.render(<><Image/><Image/></>));expect(fetcher).toHaveBeenCalledTimes(1);expect(host.querySelectorAll('img')).toHaveLength(2);
 await act(async()=>root.render(null));await act(async()=>root.render(<Image/>));expect(fetcher).toHaveBeenCalledTimes(1);
 login.sessionKey='after-shared';await act(async()=>root.render(<Image/>));expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:shared');expect(fetcher).toHaveBeenCalledTimes(2);
 await act(async()=>root.unmount());
});

it('prefetches detail previews once and lets a later detail view render without another request',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const fetcher=vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['prefetched'])});vi.stubGlobal('fetch',fetcher);
 URL.createObjectURL=vi.fn(()=> 'blob:prefetched');URL.revokeObjectURL=vi.fn();login.sessionKey='prefetch';
 const scope='prefetch:one:workspace-a',path='/private/product?preview=display';
 await prefetchPrivateImages(scope,[path,path],2);expect(fetcher).toHaveBeenCalledTimes(1);
 const host=document.createElement('div'),root=createRoot(host);
 function Detail(){const src=usePrivateImage(path,'workspace-a');return src?<img src={src}/>:null;}
 await act(async()=>root.render(<Detail/>));expect(host.querySelector('img')?.src).toContain('blob:prefetched');expect(fetcher).toHaveBeenCalledTimes(1);
 await act(async()=>root.unmount());
});

it('uses low priority for background images and stops the queue when cancelled', async () => {
 let finish!: (value: Response) => void;
 const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 vi.stubGlobal('fetch', fetcher);
 URL.createObjectURL = vi.fn(() => 'blob:background'); URL.revokeObjectURL = vi.fn();
 const controller = new AbortController();
 const task = prefetchPrivateImages('background:one:workspace-a', ['/private/one', '/private/two'], 1, controller.signal);
 expect(fetcher).toHaveBeenCalledWith('/private/one', expect.objectContaining({ priority: 'low' }));
 controller.abort();
 finish({ ok: true, blob: async () => new Blob(['image']) } as Response);
 await task;
 expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps a shared foreground image available when background prefetch is cancelled', async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 let finish!: (value: Response) => void;
 const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 vi.stubGlobal('fetch', fetcher); URL.createObjectURL = vi.fn(() => 'blob:visible'); URL.revokeObjectURL = vi.fn();
 login.sessionKey = 'during';
 const controller = new AbortController(), path = '/private/shared-background';
 const task = prefetchPrivateImages('during:one:workspace-a', [path, '/private/other'], 1, controller.signal);
 const host = document.createElement('div'), root = createRoot(host);
 function Image() { const src = usePrivateImage(path, 'workspace-a'); return src ? <img src={src} /> : null; }
 await act(async () => root.render(<Image />));
 controller.abort();
 await act(async () => { finish({ ok: true, blob: async () => new Blob(['image']) } as Response); await task; });
 expect(host.querySelector('img')?.src).toContain('blob:visible');
 expect(fetcher).toHaveBeenCalledTimes(1);
 await act(async () => root.unmount()); host.remove();
});

it('pauses background images when hidden and resumes the remaining queue', async () => {
 vi.useFakeTimers(); vi.stubGlobal('requestIdleCallback', undefined);
 const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
 let finish!: (value: Response) => void;
 const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
   .mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) });
 vi.stubGlobal('fetch', fetcher); URL.createObjectURL = vi.fn(() => 'blob:idle'); URL.revokeObjectURL = vi.fn();
 const stop = schedulePrivateImagePrefetch('idle:one:workspace-a', ['/private/one', '/private/two']);
 try {
  await vi.advanceTimersByTimeAsync(300); expect(fetcher).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  finish({ ok: true, blob: async () => new Blob(['image']) } as Response);
  await vi.advanceTimersByTimeAsync(300);
  expect(fetcher).toHaveBeenCalledTimes(2);
 } finally { stop(); vi.useRealTimers(); }
});

it('does not prefetch private images when data saving is requested', () => {
 vi.stubGlobal('navigator', { connection: { saveData: true } });
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
 const stop = schedulePrivateImagePrefetch('save:one:workspace-a', ['/private/one']);
 expect(fetcher).not.toHaveBeenCalled(); stop();
});

it('shows the original fallback while AI cutout is pending, then replaces it after the worker finishes',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,headers:{get:()=> 'pending'},blob:async()=>new Blob(['original'])}).mockResolvedValueOnce({ok:true,headers:{get:()=> 'ready'},blob:async()=>new Blob(['cutout'])});vi.stubGlobal('fetch',fetcher);
 URL.createObjectURL=vi.fn().mockReturnValueOnce('blob:original').mockReturnValueOnce('blob:cutout');URL.revokeObjectURL=vi.fn();login.sessionKey='worker';
 const host=document.createElement('div'),root=createRoot(host);function Image(){const src=usePrivateImage('/private/cutout','workspace-a');return src?<img src={src}/>:null;}
 try{await act(async()=>root.render(<Image/>));expect(host.querySelector('img')?.src).toContain('blob:original');await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(fetcher).toHaveBeenCalledTimes(2);expect(host.querySelector('img')?.src).toContain('blob:cutout');}
 finally{await act(async()=>root.unmount());vi.useRealTimers();}
});
