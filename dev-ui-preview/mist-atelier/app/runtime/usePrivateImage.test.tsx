// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePrivateImage } from './usePrivateImage';

const login = vi.hoisted(() => ({ sessionKey: 'one', user: { id: 'one' } }));
vi.mock('./auth', () => ({ useMistSession: () => login }));
vi.mock('../../../../services/apiService', () => ({ apiService: { getAuthHeaders: () => ({ Authorization: 'Bearer private' }) } }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); login.sessionKey = 'one'; login.user.id = 'one'; });

it('authenticates images, hides previous-account content and disposes stale or unmounted blobs', async () => {
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
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
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
