// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {AvatarDirectory} from './avatarDirectory';
import {Avatar} from './primitives';
it('uses one person color across placements and lets the editor preview override the saved photo',()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);
 try{act(()=>root.render(<AvatarDirectory people={[{id:'u1',name:'林澈',src:'data:image/png;base64,AAAA'}]}><Avatar name="林澈" identityKey="u1"/><Avatar name="林澈" identityKey="u1" src={null}/><Avatar name="林澈" identityKey="u1" src="initials:v1:rose"/></AvatarDirectory>));
 const avatars=host.querySelectorAll<HTMLElement>('.mist-avatar');expect(avatars[0].querySelector('img')?.src).toContain('data:image/png');expect(avatars[1].querySelector('img')).toBeNull();expect(avatars[0].style.backgroundColor).toBe(avatars[1].style.backgroundColor);expect(avatars[2].style.backgroundColor).not.toBe(avatars[1].style.backgroundColor);
 }finally{act(()=>root.unmount());}
});
