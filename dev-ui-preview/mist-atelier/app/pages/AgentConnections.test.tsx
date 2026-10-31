// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getAllByRole,getByLabelText,getByText,queryByRole} from '@testing-library/dom';import {MistRoot} from '../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),copy:vi.fn(),identity:'A',userId:'A'}));
vi.mock('../runtime/auth',()=>({useMistSession:()=>({sessionKey:seam.identity,user:{id:seam.userId}})}));
vi.mock('../runtime/workspace',()=>({mistApiRequest:(...args:any[])=>seam.api(...args),useMistWorkspace:()=>({workspace:{id:'workspace'}})}));
import {AgentConnections} from './AgentConnections';
let host:HTMLDivElement,root:Root;
const row=(version=1,state='active')=>({id:'connection',name:'采购助手',mode:'read',state,version,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+7200000).toISOString()});
const page=()=>({items:[row()],canConnect:true,nextCursor:null});
const paint=()=>root.render(<MistRoot><AgentConnections/></MistRoot>);
const flush=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve();});};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();seam.identity='A';seam.userId='A';localStorage.clear();sessionStorage.clear();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:seam.copy.mockResolvedValue(undefined)}});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('creates through the real API contract, masks credentials and copies a usable remote MCP configuration',async()=>{
 seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{connection:row(),delegation:{token:'private-test-token',expiresAt:row().expiresAt}}:page()));
 act(paint);await flush();await act(async()=>getByRole(host,'button',{name:'新建连接'}).click());
 await act(async()=>{const input=getByLabelText(document.body,'连接名称') as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'本机 MCP');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>getByRole(document.body,'button',{name:'创建连接'}).click());await flush();
 const secret=getByLabelText(document.body,'连接凭据',{selector:'input'}) as HTMLInputElement;expect(secret.type).toBe('password');expect(secret.value).toBe('private-test-token');expect(document.body.textContent).not.toContain('private-test-token');
 await act(async()=>getByRole(document.body,'button',{name:'复制配置'}).click());const config=JSON.parse(seam.copy.mock.calls[0][0]);expect(config.mcpServers.bambook.url).toBe(new URL('/api/mist/mcp',location.origin).href);expect(config.mcpServers.bambook.headers['x-bambook-delegation']).toBe('private-test-token');
 await act(async()=>getAllByRole(document.body,'button',{name:'关闭',exact:true})[0].click());expect(queryByRole(document.body,'dialog')).toBeNull();expect(document.body.innerHTML).not.toContain('private-test-token');expect(JSON.stringify(localStorage)).not.toContain('private-test-token');
});
it('retries a renewal with the same request id and version after an unknown network outcome',async()=>{
 let attempt=0;seam.api.mockImplementation((url:string,init:any)=>{if(init?.method!=='POST')return Promise.resolve(page());if(++attempt===1)return Promise.reject(new Error('网络超时'));return Promise.resolve({connection:row(2),delegation:{token:'rotated-token',expiresAt:row().expiresAt}});});
 act(paint);await flush();await act(async()=>getByRole(host,'button',{name:'续签',exact:true}).click());await act(async()=>getByRole(document.body,'button',{name:'确认续签'}).click());await flush();expect(document.body.textContent).toContain('网络超时');
 await act(async()=>getByRole(document.body,'button',{name:'确认续签'}).click());await flush();
 const posts=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(2);expect(posts[0][1].body).toBe(posts[1][1].body);expect(JSON.parse(posts[0][1].body).version).toBe(1);
});
it('discards an old-account credential response after account switching',async()=>{
 let finish!:(value:any)=>void;const delayed=new Promise(resolve=>finish=resolve);seam.api.mockImplementation((url:string,init:any)=>init?.method==='POST'?delayed:Promise.resolve(page()));
 act(paint);await flush();await act(async()=>getByRole(host,'button',{name:'续签',exact:true}).click());await act(async()=>getByRole(document.body,'button',{name:'确认续签'}).click());
 seam.identity='B';seam.userId='B';act(paint);await flush();await act(async()=>finish({connection:row(2),delegation:{token:'old-account-secret',expiresAt:row().expiresAt}}));await flush();
 expect(queryByRole(document.body,'dialog',{name:'连接凭据'})).toBeNull();expect(document.body.innerHTML).not.toContain('old-account-secret');
});
it('requires explicit revocation and displays terminal state without showing a credential',async()=>{
 let revoked=false;seam.api.mockImplementation((url:string,init:any)=>{if(init?.method==='POST'){revoked=true;return Promise.resolve({connection:row(2,'revoked')});}return Promise.resolve({...page(),items:[row(revoked?2:1,revoked?'revoked':'active')]});});
 act(paint);await flush();await act(async()=>getByRole(host,'button',{name:'撤销',exact:true}).click());expect(seam.api.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 await act(async()=>getByRole(document.body,'button',{name:'确认撤销'}).click());await flush();expect(getByText(host,'已撤销')).toBeTruthy();expect(queryByRole(host,'button',{name:'续签',exact:true})).toBeNull();expect(queryByRole(document.body,'dialog')).toBeNull();
});
