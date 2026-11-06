// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {organizationLabel, useOrganizationContext} from './organizationContext';

const session=vi.hoisted(()=>({status:'authenticated',sessionKey:'a',user:{id:'a',department:'面料部'} as any,localMode:false}));
vi.mock('./auth',()=>({useMistSession:()=>session}));
vi.mock('../../../../services/apiService',()=>({apiService:{getAuthHeaders:()=>({Authorization:'Bearer current'})}}));
afterEach(()=>{vi.unstubAllGlobals();session.sessionKey='a';session.user={id:'a',department:'面料部'};});
it('prefers actual active groups, falls back to department and never invents one when several exist',()=>{
 expect(organizationLabel('面料部',[])).toEqual({name:'面料部',caption:'当前部门'});
 expect(organizationLabel('面料部',[{id:'1',name:'针织一组',status:'active'}])).toEqual({name:'针织一组',caption:'当前小组'});
 expect(organizationLabel('面料部',[{id:'1',name:'旧组',status:'dissolved'}]).name).toBe('面料部');
 expect(organizationLabel('面料部',[{id:'1',name:'一组'},{id:'2',name:'二组'}])).toEqual({name:'一组、二组',caption:'所属小组'});
 expect(organizationLabel(null,[]).name).toBe('部门未设置');
});
it('uses the own-membership endpoint and hides prior-account groups immediately',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 let finish!: (value:any)=>void;
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,teams:[{id:'1',name:'针织一组',status:'active'}]})}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 vi.stubGlobal('fetch',fetcher);const host=document.createElement('div'),root=createRoot(host);
 function View(){const info=useOrganizationContext();return <div>{info.name} / {info.caption}</div>;}
 await act(async()=>root.render(<View/>));expect(host.textContent).toContain('针织一组');
 expect(fetcher).toHaveBeenCalledWith('/api/hr/teams/mine',expect.objectContaining({credentials:'include',headers:{Authorization:'Bearer current'}}));
 session.sessionKey='b';session.user.id='b';await act(async()=>root.render(<View/>));expect(host.textContent).not.toContain('针织一组');expect(host.textContent).toContain('面料部');
 await act(async()=>finish({ok:false}));expect(host.textContent).toContain('小组归属待核对');
 await act(async()=>root.unmount());expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
});
it.each([
 ['a platform-only operator',{id:'p',platformRole:'platform_admin',roleIds:[]}],
 ['a platform operator managing a company',{id:'p',platformRole:'platform_admin',roleIds:['role-super-admin@c1'],platformCompany:{companyId:'c1',companyName:'雾织',startedAt:''}}],
 ['an account that must change its password first',{id:'a',department:'面料部',mustChangePassword:true}],
])('does not request own groups for %s and shows no loading state',async(_label,user)=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);session.user=user;
 const host=document.createElement('div'),root=createRoot(host);
 function View(){const info=useOrganizationContext();return <div>{info.caption}</div>;}
 await act(async()=>root.render(<View/>));
 expect(fetcher).not.toHaveBeenCalled();expect(host.textContent).not.toContain('正在读取小组');expect(host.textContent).not.toContain('待核对');
 await act(async()=>root.unmount());
});
