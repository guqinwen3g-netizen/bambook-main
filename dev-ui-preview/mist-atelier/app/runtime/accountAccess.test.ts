import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../../services/authService',()=>({getAuthApiBase:()=>'/api'}));
import { accountAccessApi } from './accountAccess';
afterEach(()=>vi.unstubAllGlobals());
it('preserves server retry advice and does not include credentials in recovery requests',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:false,code:'RATE_LIMITED',message:'请稍后重试',retryAfterSeconds:900}),{status:429,headers:{'Retry-After':'900'}}));vi.stubGlobal('fetch',fetch);
 await expect(accountAccessApi.requestRecovery('staff@example.invalid')).rejects.toMatchObject({code:'RATE_LIMITED',retryAfterSeconds:900,message:'请稍后重试'});
 expect(fetch).toHaveBeenCalledWith('/api/auth/account-access/request',expect.objectContaining({credentials:'omit',cache:'no-store',body:JSON.stringify({email:'staff@example.invalid'})}));
});
it('keeps an expired-link error distinct from a transport failure',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:false,code:'ACCESS_LINK_INVALID',message:'链接已失效'}),{status:400})));
 await expect(accountAccessApi.complete({kind:'recovery',email:'staff@example.invalid',token:'test',password:'TestPassword42'})).rejects.toMatchObject({code:'ACCESS_LINK_INVALID',retryAfterSeconds:0});
});
it('treats a timeout as unconfirmed and waits before a new request',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}));
 await expect(accountAccessApi.requestRecovery('staff@example.invalid')).rejects.toMatchObject({code:'REQUEST_UNCONFIRMED',retryAfterSeconds:60});
});
it('keeps network failures retryable without claiming that mail was sent',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 await expect(accountAccessApi.requestRecovery('staff@example.invalid')).rejects.toMatchObject({code:'NETWORK_ERROR',retryAfterSeconds:0});
});

it('honors Retry-After even when an upstream rate-limit response is not JSON',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('Try later',{status:429,headers:{'Retry-After':'120'}})));
 await expect(accountAccessApi.requestRecovery('staff@example.invalid')).rejects.toMatchObject({code:'RATE_LIMITED',retryAfterSeconds:120});
});
