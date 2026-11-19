// @vitest-environment jsdom
// Actual auth service, controlled HTTP timing. No backend account/auth/PG proof.
import { beforeEach, expect, it, vi } from 'vitest';
const user = (id: string) => ({ id, displayName: id, email: id + '@example.test', roles: ['viewer'] as const, permissions: ['orders:read'], departmentIds: [], department: null });
const response = (id: string, token?: string) => ({ ok: true, status: 200, text: async () => JSON.stringify({ user: user(id), token, revokedSession: true }) }) as Response;
const okLogout=()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:true,revokedSession:true})}) as Response;
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
for (const outcome of ['success', '401', 'fault', 'parse-late'] as const) it(`old /me ${outcome} cannot overwrite a later successful login`, async () => {
  const old = deferred<Response>(); const parse = deferred<string>();
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/login') ? Promise.resolve(response('new', 'new-credential')) : old.promise));
  const auth = await import('./authService'); const refresh = auth.checkAuth();
  if (outcome === 'parse-late') { old.resolve({ ok: true, status: 200, text: () => parse.promise } as Response); await Promise.resolve(); await Promise.resolve(); }
  await auth.login('new', 'credential');
  if (outcome === 'success') old.resolve(response('old'));
  if (outcome === '401') old.resolve({ ok: false, status: 401 } as Response);
  if (outcome === 'fault') old.reject(new Error('network failed'));
  if (outcome === 'parse-late') parse.resolve(JSON.stringify({ user: user('old') }));
  await refresh;
  expect(auth.getAuthState()).toMatchObject({ isAuthenticated: true, user: { id: 'new' }, isLoading: false });
  expect(localStorage.getItem('bambook_auth_token')).toBe('new-credential');
  expect(JSON.parse(localStorage.getItem('bambook_auth_user')!).id).toBe('new');
});
it('logout clears state immediately, and its late acknowledgement cannot clear a newer login', async () => {
  const ack = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/logout') ? ack.promise : Promise.resolve(response('new', 'new-credential'))));
  const auth = await import('./authService'); await auth.devLoginAs('old-credential', user('old') as any);
  const loggingOut = auth.logout();
  expect(auth.getAuthState().user).toBeNull(); expect(localStorage.getItem('bambook_auth_token')).toBeNull();
  await auth.login('new', 'credential'); ack.resolve(okLogout()); await loggingOut;
  expect(auth.getAuthState().user?.id).toBe('new'); expect(localStorage.getItem('bambook_auth_token')).toBe('new-credential');
});
it('logout sends the original bearer before clearing local credentials',async()=>{
 const fetcher=vi.fn(async()=>(okLogout()));vi.stubGlobal('fetch',fetcher);
 const auth=await import('./authService');await auth.devLoginAs('current-device-credential',user('old') as any);await auth.logout();
 const call=fetcher.mock.calls.find(([url]:any)=>String(url).endsWith('/auth/logout')) as any;
 expect(call[1].headers).toMatchObject({Authorization:'Bearer current-device-credential'});expect(auth.getAuthState().user).toBeNull();
});
it.each(['network','storage'] as const)('reports an unconfirmed server logout after local cleanup: %s',async kind=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{if(kind==='network')throw Error('offline');return{ok:false,status:503} as Response;}));
 const auth=await import('./authService');await auth.devLoginAs('old-credential',user('old') as any);
 await expect(auth.logout()).rejects.toThrow('服务器退出未确认');expect(auth.getAuthState().user).toBeNull();expect(localStorage.getItem('bambook_auth_token')).toBeNull();
});
it('retries an unconfirmed bearer logout using its captured credential, while the local state remains anonymous',async()=>{
 let calls=0;const fetcher=vi.fn(async()=>({ok:++calls>1,status:calls>1?200:503,text:async()=>JSON.stringify({ok:true,revokedSession:true})} as Response));vi.stubGlobal('fetch',fetcher);
 const auth=await import('./authService');await auth.devLoginAs('retry-this-session',user('old') as any);await expect(auth.logout()).rejects.toThrow('服务器退出未确认');await auth.logout();
 const headers=fetcher.mock.calls.map((call:any)=>call[1].headers.Authorization);expect(headers).toEqual(['Bearer retry-this-session','Bearer retry-this-session']);expect(auth.getAuthState().user).toBeNull();
});
it('bounds an unacknowledged logout and retains an honest retry state',async()=>{
 vi.useFakeTimers();try{
  vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))));
  const auth=await import('./authService');await auth.devLoginAs('logout-timeout',user('old') as any);const pending=auth.logout(),failure=expect(pending).rejects.toThrow('服务器退出未确认');await vi.advanceTimersByTimeAsync(15_000);await failure;expect(auth.getAuthState().user).toBeNull();expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
it('clears local state after confirmed logout-all without a second logout request',async()=>{
 const fetcher=vi.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:true})} as Response));vi.stubGlobal('fetch',fetcher);const auth=await import('./authService');await auth.devLoginAs('all-devices',user('old') as any);await auth.logoutAllSessions();expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0]?.[0])).toContain('/auth/logout-all');expect(auth.getAuthState().user).toBeNull();
});
it('does not clear a newer login when an older logout-all acknowledgement arrives',async()=>{
 const ack=deferred<Response>();vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/auth/logout-all')?ack.promise:Promise.resolve(response('new','new-credential'))));const auth=await import('./authService');await auth.devLoginAs('old-credential',user('old') as any);const leaving=auth.logoutAllSessions();await auth.login('new','credential');ack.resolve({ok:true,status:200,text:async()=>JSON.stringify({ok:true})} as Response);await leaving;expect(auth.getAuthState().user?.id).toBe('new');expect(localStorage.getItem('bambook_auth_token')).toBe('new-credential');
});
it('does not restore an unconfirmed logout from a cookie after the client reloads',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline');}));const first=await import('./authService');await first.devLoginAs('old-credential',user('old') as any);await expect(first.logout()).rejects.toThrow('服务器退出未确认');vi.resetModules();const cookie=vi.fn(async()=>response('old'));vi.stubGlobal('fetch',cookie);const reloaded=await import('./authService');expect(await reloaded.checkAuth()).toMatchObject({isAuthenticated:false,logoutUnconfirmed:true});expect(cookie).not.toHaveBeenCalled();
});
it('keeps confirmed logout across a reload until another explicit login succeeds',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>(okLogout())));const first=await import('./authService');await first.devLoginAs('old',user('old') as any);await first.logout();vi.resetModules();const fetcher=vi.fn(async(url:string)=>url.endsWith('/auth/login')?response('new','new-credential'):response('new'));vi.stubGlobal('fetch',fetcher);const reloaded=await import('./authService');expect((await reloaded.checkAuth()).isAuthenticated).toBe(false);expect(fetcher).not.toHaveBeenCalled();await reloaded.login('new','credential');expect(reloaded.getAuthState().user?.id).toBe('new');await reloaded.checkAuth();expect(fetcher).toHaveBeenCalledTimes(2);
});
it('retains the selected bearer when a cookie/CORS transport requires the credential-free fallback',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('credentialed transport unavailable')).mockResolvedValueOnce(okLogout());vi.stubGlobal('fetch',fetcher);const auth=await import('./authService');await auth.devLoginAs('logout-bearer',user('old') as any);await auth.logout();expect(fetcher.mock.calls.map((c:any)=>c[1].credentials)).toEqual(['include','omit']);expect(fetcher.mock.calls.map((c:any)=>c[1].headers.Authorization)).toEqual(['Bearer logout-bearer','Bearer logout-bearer']);
});
it('retries after a reload with a logout-only capability instead of retaining the login bearer',async()=>{
 const ticket='purpose.logout.capabilityA';let offline=true;const calls:RequestInit[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{if(url.endsWith('/auth/login'))return{ok:true,status:200,text:async()=>JSON.stringify({user:user('old'),token:'private-login-bearer',logoutTicket:ticket})} as Response;calls.push(init);if(offline)throw new TypeError('offline');return okLogout();}));
 const first=await import('./authService');await first.login('old','password');await expect(first.logout()).rejects.toThrow('服务器退出未确认');expect(localStorage.getItem('bambook_auth_token')).toBeNull();expect(sessionStorage.getItem('bambook_auth_token')).toBeNull();expect(JSON.stringify({...localStorage})).not.toContain('private-login-bearer');vi.resetModules();offline=false;calls.length=0;const reloaded=await import('./authService');await reloaded.logout();expect(calls).toHaveLength(1);expect(JSON.parse(String(calls[0].body))).toEqual({logoutTicket:ticket});expect(new Headers(calls[0].headers).has('Authorization')).toBe(false);expect(reloaded.getAuthState().user).toBeNull();
});
it('retains earlier unconfirmed logout capabilities while another account explicitly signs in',async()=>{
 let identity='one',offline=true;const targets:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{if(url.endsWith('/auth/login'))return{ok:true,status:200,text:async()=>JSON.stringify({user:user(identity),token:'login-'+identity,logoutTicket:'purpose.logout.'+identity})} as Response;if(offline)throw new TypeError('offline');targets.push(JSON.parse(String(init.body)).logoutTicket);return okLogout();}));const auth=await import('./authService');await auth.login('one','password');await expect(auth.logout()).rejects.toThrow();identity='two';await auth.login('two','password');offline=false;await auth.logout();expect(targets.sort()).toEqual(['purpose.logout.one','purpose.logout.two']);
});
it('does not treat an anonymous acknowledgement as proof of an unrecoverable previous logout',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('offline');}));const auth=await import('./authService');await auth.devLoginAs('legacy-bearer',user('old') as any);await expect(auth.logout()).rejects.toThrow();vi.resetModules();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:true,revokedSession:false})} as Response)));const reloaded=await import('./authService');await expect(reloaded.logout()).rejects.toThrow('服务器退出未确认');expect(reloaded.getAuthState()).toMatchObject({isAuthenticated:false,logoutUnconfirmed:true});
});
it('never sends an earlier server logout capability to a different configured API',async()=>{
 let offline=true;const sent:Array<{url:string;ticket:string}>=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{const second=url.includes('api-two.example.test');if(url.endsWith('/auth/login'))return{ok:true,status:200,text:async()=>JSON.stringify({user:user(second?'two':'one'),token:'login-'+(second?'two':'one'),logoutTicket:'purpose.logout.'+(second?'two':'one')})} as Response;if(offline)throw new TypeError('offline');sent.push({url,ticket:JSON.parse(String(init.body)).logoutTicket});return okLogout();}));localStorage.setItem('panda_system_config',JSON.stringify({cloudEndpoint:'https://api-one.example.test/api'}));const auth=await import('./authService');await auth.login('one','password');await expect(auth.logout()).rejects.toThrow();localStorage.setItem('panda_system_config',JSON.stringify({cloudEndpoint:'https://api-two.example.test/api'}));await auth.login('two','password');offline=false;await auth.logout();expect(sent).toHaveLength(1);expect(sent[0].url).toContain('api-two.example.test');expect(sent[0].ticket).toBe('purpose.logout.two');
});
it('a login success arriving after logout is rejected rather than resurrecting a session', async () => {
  const login = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/login') ? login.promise : Promise.resolve(okLogout())));
  const auth = await import('./authService'); const pending = auth.login('old', 'credential');
  const rejection = expect(pending).rejects.toThrow('替代'); await auth.logout(); login.resolve(response('old', 'old-credential'));
  await rejection; expect(auth.getAuthState().user).toBeNull(); expect(localStorage.getItem('bambook_auth_token')).toBeNull();
});
it('concurrent logins commit only the newest operation', async () => {
  const first = deferred<Response>(); const second = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
  const auth = await import('./authService'); const old = auth.login('old', 'credential'); const current = auth.login('new', 'credential');
  const rejected = expect(old).rejects.toThrow('替代'); second.resolve(response('new', 'new-credential')); await current;
  first.resolve(response('old', 'old-credential')); await rejected;
  expect(auth.getAuthState().user?.id).toBe('new'); expect(sessionStorage.getItem('bambook_auth_token')).toBe('new-credential');
});
it('an old refresh cannot restore a logged-out session, including dev role switching', async () => {
  const old = deferred<Response>(); vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/logout') ? Promise.resolve(okLogout()) : old.promise));
  const auth = await import('./authService'); const refresh = auth.checkAuth(); await auth.logout(); old.resolve(response('old')); await refresh;
  expect(auth.getAuthState().user).toBeNull();
  const late = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => late.promise)); const refresh2 = auth.checkAuth();
  await auth.devLoginAs('qc-credential', user('qc') as any); late.resolve(response('old')); await refresh2;
  expect(auth.getAuthState().user?.id).toBe('qc');
});
it('older refresh cannot restore revoked permissions after the newer refresh', async () => {
  const first = deferred<Response>(); const second = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
  const auth = await import('./authService'); const old = auth.checkAuth(); const newest = auth.checkAuth();
  second.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ user: { ...user('same'), permissions: [] } }) } as Response); await newest;
  first.resolve(response('same')); await old; expect(auth.getAuthState().user?.permissions).toEqual([]);
});
it('an old profile update cannot reinstall the previous user after role switching', async () => {
  const old = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => old.promise));
  const auth = await import('./authService'); await auth.devLoginAs('owner-credential', user('owner') as any);
  const pending = auth.updateMyProfile({ displayName: 'Changed Owner' }); const rejected = expect(pending).rejects.toThrow('先前');
  await auth.devLoginAs('qc-credential', user('qc') as any); old.resolve(response('owner')); await rejected;
  expect(auth.getAuthState().user?.id).toBe('qc'); expect(JSON.parse(localStorage.getItem('bambook_auth_user')!).id).toBe('qc');
});
it('a late profile response cannot restore permissions revoked by a newer same-account refresh', async () => {
  const old = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => options?.method === 'PATCH' ? old.promise
    : Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ user: { ...user('same'), permissions: [] } }) } as Response)));
  const auth = await import('./authService'); await auth.devLoginAs('same-credential', user('same') as any);
  const pending = auth.updateMyProfile({ displayName: 'Changed Name' }); const rejected = expect(pending).rejects.toThrow('先前');
  await auth.checkAuth(); expect(auth.getAuthState().user?.permissions).toEqual([]);
  old.resolve(response('same')); await rejected;
  expect(auth.getAuthState().user?.permissions).toEqual([]);
  expect(JSON.parse(localStorage.getItem('bambook_auth_user')!).permissions).toEqual([]);
});
