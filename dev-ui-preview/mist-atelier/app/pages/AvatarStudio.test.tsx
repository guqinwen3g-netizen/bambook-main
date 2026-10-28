// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {Avatar,MistRoot,ToastProvider} from '../../../../components/mist';
import {defaultPersonAvatar,personIdentity} from '../../../../lib/avatarIdentity';
import {AvatarSettingRow} from './AvatarStudio';
const update=vi.hoisted(()=>vi.fn());
const session=vi.hoisted(()=>({user:{id:'u1',email:'a@x.test',displayName:'顾青',avatarUrl:null as string|null}}));
vi.mock('../../../../services/authService',()=>({updateMyProfile:update}));
vi.mock('../runtime/auth',()=>({useMistSession:()=>session,useOptionalMistSession:()=>session}));
let root:Root,host:HTMLDivElement;
const click=async(role:string,name:string)=>act(async()=>getByRole(document.body,role as any,{name,exact:true}).click());
const settle=async(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,15));});check();},{timeout:3000,interval:20});
const open=async()=>{await act(async()=>root.render(<MistRoot><ToastProvider><AvatarSettingRow/></ToastProvider></MistRoot>));await click('button','编辑头像');};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;update.mockReset();session.user.avatarUrl=null;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});
it('removes the person editor while preserving existing saved person avatars',async()=>{
 session.user.avatarUrl=personIdentity(defaultPersonAvatar('u1'));await open();
 expect(queryByRole(document.body,'tab',{name:'人物'})).toBeNull();
 expect(getByRole(document.body,'tab',{name:'图案'}).getAttribute('aria-selected')).toBe('true');
 await click('button','取消');expect(update).not.toHaveBeenCalled();expect(session.user.avatarUrl).toMatch(/^person:v1:/);
});
it('changes initials color only on save and can return to automatic color',async()=>{
 update.mockImplementation(async({avatarUrl})=>{session.user.avatarUrl=avatarUrl;return session.user;});await open();await click('button','浅陶');expect(update).not.toHaveBeenCalled();await click('button','保存头像');expect(update).toHaveBeenLastCalledWith({avatarUrl:'initials:v1:clay'});
 await click('button','编辑头像');await click('button','自动');await click('button','保存头像');expect(update).toHaveBeenLastCalledWith({avatarUrl:null});
});
it('keeps cancelled changes local and keeps a failed save open for retry',async()=>{
 await open();await click('button','柔绿');await click('button','取消');expect(update).not.toHaveBeenCalled();await click('button','编辑头像');await click('button','浅陶');update.mockRejectedValue(new Error('服务连接失败'));await click('button','保存头像');expect(getByRole(document.body,'dialog',{name:'编辑头像'})).toBeTruthy();expect(document.body.textContent).toContain('服务连接失败');
});
it('restores the original four-direction DiceBear explorer and saves a deeper new preset',async()=>{
 update.mockResolvedValue({});await open();await click('tab','图案');
 for(const label of ['具象','活泼','抽象','沉静'])expect(getByRole(document.body,'button',{name:label})).toBeTruthy();
 await click('button','开始探索 ↗');
 await settle(()=>expect((getByRole(document.body,'button',{name:'就用这个'}) as HTMLButtonElement).disabled).toBe(false));
 expect(update).not.toHaveBeenCalled();await click('button','就用这个');expect(update.mock.calls[0][0].avatarUrl).toMatch(/^dicebear:v1:[a-z-]+:c\d+_v7_/);
});
it('accepts a photo draft and crop without updating the profile until final save',async()=>{
 class FakeImage {naturalWidth=400;naturalHeight=300;onload:any;onerror:any;set src(_value:string){queueMicrotask(()=>this.onload?.());}}
 vi.stubGlobal('Image',FakeImage);vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({beginPath(){},arc(){},clip(){},translate(){},rotate(){},drawImage(){}} as any);vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/webp;base64,AAAA');update.mockResolvedValue({});await open();await click('tab','照片');
 const input=document.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[new File(['photo'],'photo.png',{type:'image/png'})]});await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
 await settle(()=>expect(queryByRole(document.body,'group',{name:'拖动或使用方向键调整照片位置'})).not.toBeNull());expect(update).not.toHaveBeenCalled();await click('button','保存头像');expect(update).toHaveBeenCalledWith({avatarUrl:'data:image/webp;base64,AAAA'});
});
it('renders legacy presets, photos and text initials',async()=>{
 await act(async()=>root.render(<><Avatar name="顾青" src="dicebear:v1:glass:c205_v6_12_12_abc-0:still"/><Avatar name="林" src="data:image/webp;base64,AAAA"/><Avatar name="王"/></>));
 await settle(()=>expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/));expect(host.textContent).toBe('王');
});
