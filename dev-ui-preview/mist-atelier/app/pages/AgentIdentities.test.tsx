// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';import {getByRole,getByLabelText,queryByRole,getByText,getAllByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),copy:vi.fn(),identity:'A',userId:'finance'}));
vi.mock('../runtime/auth',()=>({useMistSession:()=>({sessionKey:seam.identity,user:{id:seam.userId}})}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'workspace'}}),mistApiRequest:(...args:any[])=>seam.api(...args)}));
import {AgentIdentities} from './AgentIdentities';
let host:HTMLDivElement,root:Root;
const row=(own=true)=>({id:'identity',name:'财务值守',ownerId:'finance',ownerName:'林舒',mode:'read',version:1,state:'pending',createdAt:new Date().toISOString(),canManage:!own,canIssue:own});
const page=(own=true)=>({items:[row(own)],canManage:!own,owners:own?[]:[{id:'finance',name:'林舒'}],nextCursor:null});
const paint=(management=false)=>root.render(<MistRoot><AgentIdentities management={management}/></MistRoot>);
const flush=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve();});};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();seam.identity='A';seam.userId='finance';localStorage.clear();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:seam.copy.mockResolvedValue(undefined)}});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('lets the real owner issue a long credential and copy only the Agent-key authentication scheme',async()=>{
 const expiresAt=new Date(Date.now()+90*86400000).toISOString();seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{identity:{...row(),state:'active',version:2,expiresAt},token:'private-long-key'}:page()));
 act(()=>paint());await flush();await act(async()=>getByRole(host,'button',{name:'启用凭据',exact:true}).click());expect(seam.api.mock.calls.filter(([,i])=>i?.method==='POST')).toHaveLength(0);
 await act(async()=>getByRole(document.body,'button',{name:'生成长期密钥'}).click());await flush();
 const field=getByLabelText(document.body,'长期密钥',{selector:'input'}) as HTMLInputElement;expect(field.type).toBe('password');expect(field.value).toBe('private-long-key');expect(document.body.textContent).not.toContain('private-long-key');
 await act(async()=>getByRole(document.body,'button',{name:'复制配置'}).click());const config=JSON.parse(seam.copy.mock.calls[0][0]);expect(config.mcpServers.bambook.headers).toEqual({'x-bambook-agent-key':'private-long-key'});expect(JSON.stringify(config)).not.toContain('Authorization');
 await act(async()=>getAllByRole(document.body,'button',{name:'关闭',exact:true})[0].click());expect(document.body.innerHTML).not.toContain('private-long-key');expect(JSON.stringify(sessionStorage)).not.toContain('private-long-key');
});
it('gives company managers configuration controls without an issue control for another owner',async()=>{
 seam.userId='admin';seam.api.mockResolvedValue(page(false));act(()=>paint(true));await flush();expect(getByRole(host,'button',{name:'新建Agent身份'})).toBeTruthy();expect(getByRole(host,'button',{name:'配置',exact:true})).toBeTruthy();expect(queryByRole(host,'button',{name:'启用凭据'})).toBeNull();expect(seam.api.mock.calls[0][0]).toContain('scope=company');
});
it('drops a delayed credential result after the logged-in user changes',async()=>{
 let finish!:(value:any)=>void;const slow=new Promise(resolve=>finish=resolve);seam.api.mockImplementation((url:string,init:any)=>init?.method==='POST'?slow:Promise.resolve(page()));
 act(()=>paint());await flush();await act(async()=>getByRole(host,'button',{name:'启用凭据',exact:true}).click());await act(async()=>getByRole(document.body,'button',{name:'生成长期密钥'}).click());
 seam.identity='B';seam.userId='other';act(()=>paint());await flush();await act(async()=>finish({identity:{...row(),expiresAt:new Date(Date.now()+86400000).toISOString()},token:'old-owner-secret'}));await flush();expect(queryByRole(document.body,'dialog',{name:'长期Agent凭据'})).toBeNull();expect(document.body.innerHTML).not.toContain('old-owner-secret');
});
it('makes inactive states explicit instead of claiming that a background Agent is running',async()=>{
 seam.api.mockResolvedValue({...page(),items:[{...row(),state:'disabled',canIssue:false}]});act(()=>paint());await flush();expect(getByText(host,'已停用')).toBeTruthy();expect(queryByRole(host,'button',{name:'启用凭据'})).toBeNull();expect(host.textContent).not.toContain('运行中');
});
it('shows lifecycle history without implying that a revoked key is enabled',async()=>{
 seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/history')?{items:[{action:'revoked',actor:{id:'finance',name:'林舒'},at:new Date().toISOString(),version:3,ownerId:'finance',ownerName:'林舒',mode:'read',enabled:true}],nextCursor:null}:page()));
 act(()=>paint());await flush();await act(async()=>getByRole(host,'button',{name:'操作记录',exact:true}).click());await flush();
 const dialog=getByRole(document.body,'dialog',{name:'操作记录'});expect(getByText(dialog,'撤销密钥 · 林舒')).toBeTruthy();expect(dialog.textContent).not.toContain('身份启用');expect(dialog.textContent).not.toContain('长期密钥');
});
it('lets the owner revoke an issued key after AI access is lost without exposing issuance',async()=>{
 const lost={...row(),state:'invalid',canManage:false,canIssue:false,canRevoke:true,activatedAt:'2026-11-01T00:00:00Z',expiresAt:'2027-01-30T00:00:00Z'};
 seam.api.mockImplementation((url:string,init:any)=>Promise.resolve(init?.method==='POST'?{identity:{...lost,state:'revoked',canRevoke:false}}:{...page(),items:[lost]}));
 act(()=>paint());await flush();expect(queryByRole(host,'button',{name:'轮换密钥'})).toBeNull();expect(queryByRole(host,'button',{name:'启用凭据'})).toBeNull();
 await act(async()=>getByRole(host,'button',{name:'撤销',exact:true}).click());await flush();await act(async()=>getByRole(document.body,'button',{name:'确认撤销'}).click());await flush();
 const writes=seam.api.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);expect(writes[0][0]).toMatch(/\/agent-identities\/identity\/revoke$/);expect(JSON.parse(writes[0][1].body)).toEqual({requestId:expect.any(String)});
});
