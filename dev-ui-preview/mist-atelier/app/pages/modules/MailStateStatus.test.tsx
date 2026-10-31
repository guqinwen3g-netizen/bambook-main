// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import { MistRoot } from '../../../../../components/mist';
import type { EmailMessage } from '../../../../../server/src/shared/mistEmail';
const seam=vi.hoisted(()=>({api:vi.fn(),session:'owner',revision:1}));
vi.mock('../../runtime/auth',()=>({useMistSession:()=>({sessionKey:seam.session})}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'workspace',revision:seam.revision}}),mistApiRequest:(...args:any[])=>seam.api(...args)}));
import { MailStateStatus } from './MailStateStatus';
let root:Root,host:HTMLDivElement;
const m={id:'mail',example:false,remote:{folder:'INBOX',uid:1,uidValidity:7},remoteState:{folder:'inbox',read:false,starred:false}} as EmailMessage;
const retry=vi.fn(async()=>{});
const paint=(message=m)=>root.render(<MistRoot><MailStateStatus message={message} locked={false} retry={retry}/></MistRoot>);
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();seam.session='owner';seam.revision=1;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('shows failure and offers distinct retry and original-mailbox recovery actions',async()=>{
  seam.api.mockResolvedValue({serviceAvailable:true,items:[{messageId:'mail',state:'unknown',fields:['folder'],canRetry:true,error:'移动结果待核对'}]});act(()=>paint());await flush();
  expect(host.textContent).toContain('移动结果待核对');
  await act(async()=>getByRole(host,'button',{name:'重试同步'}).click());expect(retry).toHaveBeenLastCalledWith(false);
  await act(async()=>getByRole(host,'button',{name:'以原邮箱为准'}).click());expect(retry).toHaveBeenLastCalledWith(true);
});
it('does not offer a retry to a read-only viewer or call receive/move from the page',async()=>{
  seam.api.mockResolvedValue({serviceAvailable:true,items:[{messageId:'mail',state:'failed',fields:['read'],canRetry:false,error:'稍后重试'}]});act(()=>paint());await flush();
  expect(queryByRole(host,'button',{name:'重试同步'})).toBeNull();expect(seam.api.mock.calls.every(([url])=>url.endsWith('/email/states'))).toBe(true);
});
it('does not claim success before the status read and discards a previous account response',async()=>{
  let finish!:(r:any)=>void;seam.api.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));act(()=>paint());expect(host.textContent).toContain('正在核对原邮箱');
  seam.session='another-user';seam.api.mockResolvedValue({serviceAvailable:true,items:[]});act(()=>paint());await flush();
  await act(async()=>finish({serviceAvailable:true,items:[{messageId:'mail',state:'failed',fields:['read'],canRetry:true,error:'旧账号错误'}]}));expect(host.textContent).not.toContain('旧账号错误');
});
it('does not call a server for synthetic example messages',async()=>{
  act(()=>paint({...m,example:true}));await flush();expect(seam.api).not.toHaveBeenCalled();expect(host.textContent).toBe('');
});
