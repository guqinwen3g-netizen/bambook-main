// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
beforeEach(()=>{vi.resetModules();vi.unstubAllGlobals();vi.unstubAllEnvs();localStorage.clear();sessionStorage.clear();vi.stubEnv('DEV',false);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it.each(['bambook.sylway.cloud','bambook-admin.sylway.cloud','bambook-dev.sylway.cloud'])('keeps auth, business and explicit requests on the current public entry %s',async host=>{
 vi.stubGlobal('location',{host,origin:'https://'+host,protocol:'https:'});
 localStorage.setItem('panda_system_config',JSON.stringify({cloudEndpoint:'https://different.invalid/bambook'}));localStorage.setItem('cloudEndpoint','https://bambook.sylway.cloud');
 vi.stubEnv('VITE_API_BASE_URL','https://bambook.sylway.cloud/api');
 const api=await import('./apiBase'),auth=await import('./authService'),{apiService}=await import('./apiService');
 expect(api.getApiBaseUrl()).toBe('https://'+host+'/api');expect(auth.getAuthApiBase()).toBe('https://'+host+'/api');
 expect(apiService.buildApiUrl('/platform/companies','https://different.invalid')).toBe('https://'+host+'/api/platform/companies');
});
it('preserves an explicit relative local proxy and nonpublic endpoint configuration',async()=>{
 vi.stubGlobal('location',{host:'localhost:13020',origin:'http://localhost:13020',protocol:'http:'});vi.stubEnv('VITE_API_BASE_URL','/api');
 const api=await import('./apiBase'),auth=await import('./authService');expect(api.getApiBaseUrl()).toBe('/api');expect(auth.getAuthApiBase()).toBe('/api');
 vi.stubEnv('VITE_API_BASE_URL','');localStorage.setItem('panda_system_config',JSON.stringify({cloudEndpoint:'https://owned.invalid/custom'}));expect(api.getApiBaseUrl()).toBe('https://owned.invalid/custom/api');expect(auth.getAuthApiBase()).toBe('https://owned.invalid/custom/api');
});
it('sends a platform login only to that entry and never retries it against the company host',async()=>{
 vi.stubGlobal('location',{host:'bambook-admin.sylway.cloud',origin:'https://bambook-admin.sylway.cloud',protocol:'https:'});localStorage.setItem('panda_system_config',JSON.stringify({cloudEndpoint:'https://bambook.sylway.cloud'}));
 const fetch=vi.fn().mockResolvedValue({ok:false,status:403,text:async()=>JSON.stringify({message:'请从公司入口登录。',error:'COMPANY_ENTRY_ONLY'})});vi.stubGlobal('fetch',fetch);const auth=await import('./authService');
 await expect(auth.login('company@example.invalid','local-example-password',undefined,'platform')).rejects.toThrow('请从公司入口登录');
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('https://bambook-admin.sylway.cloud/api/auth/login');
});
