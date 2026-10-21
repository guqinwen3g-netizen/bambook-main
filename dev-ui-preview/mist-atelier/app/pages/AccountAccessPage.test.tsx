// @vitest-environment jsdom
import React,{act}from'react';import{createRoot,type Root}from'react-dom/client';import{beforeEach,afterEach,it,expect,vi}from'vitest';
const m=vi.hoisted(()=>({nav:{route:{view:'platform-recovery'},go:vi.fn()},api:{requestRecovery:vi.fn(),complete:vi.fn()}}));vi.mock('../nav',()=>({useNav:()=>m.nav}));vi.mock('../runtime/accountAccess',()=>({accountAccessApi:m.api}));import{AccountAccessPage}from'./AccountAccessPage';
let root:Root,host:HTMLDivElement;
const fill=(name:string,value:string)=>{const field=host.querySelector(`[aria-label="${name}"]`)as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));};
const submit=()=>act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
const render=()=>act(async()=>root.render(<AccountAccessPage/>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();sessionStorage.clear();history.replaceState({},'','/?view=platform-recovery');m.nav.route.view='platform-recovery';host=document.createElement('div');document.body.append(host);root=createRoot(host);});afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
it('submits the employee recovery address without claiming that an account exists',async()=>{m.api.requestRecovery.mockResolvedValue({message:'申请已处理，请检查邮箱'});await render();await act(async()=>fill('工作邮箱','ops@example.invalid'));await submit();expect(m.api.requestRecovery).toHaveBeenCalledWith('ops@example.invalid');expect(host.textContent).toContain('申请已提交');expect(host.querySelector('h2')?.textContent).toBe('找回密码');expect(host.querySelector('details')).toBeNull();});
it('rejects mismatched passwords and never renders the link secret',async()=>{m.nav.route.view='account-access';history.replaceState({},'','/?view=account-access&kind=invite&email=ops@example.invalid#private-link-secret');await render();await act(async()=>{fill('新密码','CorrectPassword42!');fill('确认新密码','different');});await submit();expect(m.api.complete).not.toHaveBeenCalled();expect(host.textContent).toContain('两次输入');expect(host.textContent).not.toContain('private-link-secret');});
it('sends the token only on explicit submission and clears it after success',async()=>{m.nav.route.view='account-access';history.replaceState({},'','/?view=account-access&kind=invite&email=ops@example.invalid#private-link-secret');m.api.complete.mockResolvedValue({platform:true});await render();expect(m.api.complete).not.toHaveBeenCalled();await act(async()=>{fill('新密码','CorrectPassword42!');fill('确认新密码','CorrectPassword42!');});await submit();expect(m.api.complete).toHaveBeenCalledWith(expect.objectContaining({kind:'invite',token:'private-link-secret'}));expect(location.hash).toBe('');expect(host.textContent).toContain('密码已设置');await act(async()=>host.querySelector('button')!.click());expect(m.nav.go).toHaveBeenCalledWith('login');});
it('keeps the reset form usable after a server error',async()=>{m.nav.route.view='account-access';history.replaceState({},'','/?view=account-access&kind=recovery&email=ops@example.invalid#private-link-secret');m.api.complete.mockRejectedValue(new Error('请求未完成，请重试'));await render();await act(async()=>{fill('新密码','CorrectPassword42!');fill('确认新密码','CorrectPassword42!');});await submit();expect(host.textContent).toContain('请求未完成');expect((host.querySelector('[aria-label="新密码"]')as HTMLInputElement).value).toBe('CorrectPassword42!');});

it('explains employee recovery without a platform-only restriction',async()=>{await render();expect(host.querySelector('form p')).toBeNull();expect(host.textContent).toContain('发送重置链接');expect(host.textContent).not.toContain('平台工作账号');expect(host.textContent).not.toContain('公司账号请联系');});
it('completes an employee recovery and returns to the shared login',async()=>{m.nav.route.view='account-access';history.replaceState({},'','/?view=account-access&kind=recovery&email=staff@example.test#private-link-secret');m.api.complete.mockResolvedValue({platform:false});await render();expect(host.querySelector('h2')?.textContent).toBe('设置新密码');await act(async()=>{fill('新密码','CorrectPassword42!');fill('确认新密码','CorrectPassword42!');});await submit();expect(m.api.complete).toHaveBeenCalledWith(expect.objectContaining({kind:'recovery',email:'staff@example.test'}));expect(location.hash).toBe('');await act(async()=>host.querySelector('button')!.click());expect(m.nav.go).toHaveBeenCalledWith('login');});

it('waits sixty seconds before resending and preserves the waiting deadline on remount',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));m.api.requestRecovery.mockResolvedValue({retryAfterSeconds:60});
 await render();await act(async()=>fill('工作邮箱','staff@example.invalid'));await submit();
 expect(host.textContent).toContain('重新发送（01:00）');expect((host.querySelector('input')as HTMLInputElement).value).toBe('staff@example.invalid');
 await submit();expect(m.api.requestRecovery).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTime(10000));expect(host.textContent).toContain('重新发送（00:50）');
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.textContent).toContain('重新发送（00:50）');
 await act(async()=>vi.advanceTimersByTime(50000));expect((host.querySelector('button[type=submit]')as HTMLButtonElement).disabled).toBe(false);
});
it('changing the email does not bypass the resend wait',async()=>{
 m.api.requestRecovery.mockResolvedValue({retryAfterSeconds:60});await render();await act(async()=>fill('工作邮箱','staff@example.invalid'));await submit();
 await act(async()=>fill('工作邮箱','other@example.invalid'));await submit();expect(m.api.requestRecovery).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('重新发送（01:00）');
});
it('prevents duplicate in-flight requests and never claims delivery before an acknowledgement',async()=>{
 let resolve!:(value:any)=>void;m.api.requestRecovery.mockImplementation(()=>new Promise(r=>{resolve=r;}));await render();await act(async()=>fill('工作邮箱','staff@example.invalid'));
 await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(m.api.requestRecovery).toHaveBeenCalledTimes(1);expect(host.textContent).not.toContain('申请已提交');
 await act(async()=>resolve({retryAfterSeconds:60}));expect(host.textContent).toContain('申请已提交');
});
it('uses the server retry interval without showing a success screen on rate limiting',async()=>{
 m.api.requestRecovery.mockRejectedValue(Object.assign(new Error('申请次数已达上限'),{code:'RATE_LIMITED',retryAfterSeconds:900}));await render();await act(async()=>fill('工作邮箱','staff@example.invalid'));await submit();
 expect(host.textContent).toContain('申请次数已达上限');expect(host.textContent).toContain('重新发送（15:00）');expect(host.textContent).not.toContain('申请已提交');
});
it('provides a recovery path for incomplete and expired links',async()=>{
 m.nav.route.view='account-access';history.replaceState({},'','/?view=account-access&kind=recovery');await render();expect(host.textContent).toContain('链接已失效');expect(host.querySelector('input')).toBeNull();
 await act(async()=>host.querySelector('button')!.click());expect(m.nav.go).toHaveBeenCalledWith('platform-recovery');
});
it('replaces an expired link form with an explicit reapplication action',async()=>{
 m.nav.route.view='account-access';history.replaceState({},'','/?view=account-access&kind=recovery&email=staff@example.invalid#private-link-secret');m.api.complete.mockRejectedValue(Object.assign(new Error('链接已失效'),{code:'ACCESS_LINK_INVALID'}));
 await render();await act(async()=>{fill('新密码','CorrectPassword42!');fill('确认新密码','CorrectPassword42!');});await submit();expect(host.textContent).toContain('链接已失效');expect(host.textContent).toContain('重新申请');expect(host.querySelector('input')).toBeNull();
});

it('resends after the wait and starts a fresh countdown',async()=>{
 vi.useFakeTimers();m.api.requestRecovery.mockResolvedValue({retryAfterSeconds:60});await render();await act(async()=>fill('工作邮箱','staff@example.invalid'));await submit();
 await act(async()=>vi.advanceTimersByTime(60000));await submit();expect(m.api.requestRecovery).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('申请已提交');expect(host.textContent).toContain('重新发送（01:00）');
});
it('keeps an in-memory countdown when browser storage is unavailable',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
 try{m.api.requestRecovery.mockResolvedValue({retryAfterSeconds:60});await render();await act(async()=>fill('工作邮箱','staff@example.invalid'));await submit();expect(host.textContent).toContain('重新发送（01:00）');await submit();expect(m.api.requestRecovery).toHaveBeenCalledTimes(1);}finally{storage.mockRestore();}
});
