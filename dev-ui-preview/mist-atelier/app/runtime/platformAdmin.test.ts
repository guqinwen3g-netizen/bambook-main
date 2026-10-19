import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../../../services/apiService',()=>({apiService:{getAuthHeaders:()=>({Authorization:'Bearer fixture'})}}));
import {platformAdminApi} from './platformAdmin';
afterEach(()=>vi.unstubAllGlobals());
it('reports non-JSON server failures without exposing parser errors',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({status:502,json:()=>Promise.reject(new SyntaxError('Unexpected token <'))}));await expect(platformAdminApi.settings()).rejects.toThrow('平台服务返回异常（HTTP 502）');});
it('reports a readable network failure',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));await expect(platformAdminApi.staff()).rejects.toThrow('平台服务连接失败');});
it('keeps abort signals recognizable so unmounted requests stay silent',async()=>{const error=new Error('aborted');error.name='AbortError';vi.stubGlobal('fetch',vi.fn().mockRejectedValue(error));await expect(platformAdminApi.settings()).rejects.toBe(error);});
it('preserves actionable server validation feedback',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({status:409,ok:false,json:async()=>({ok:false,message:'设置已被其他管理员修改'})}));await expect(platformAdminApi.saveSettings({plan:'standard',seatLimit:null,version:0})).rejects.toThrow('设置已被其他管理员修改');});
