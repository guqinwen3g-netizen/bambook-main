// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useXiaozhuCowork} from './xiaozhuCowork';
const api=vi.hoisted(()=>vi.fn());vi.mock('./workspace',()=>({mistApiRequest:(...args:any[])=>api(...args)}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,cowork:any;const posts:any[]=[];
function Probe(){cowork=useXiaozhuCowork('workspace','actor:workspace',true);return null;}
beforeEach(async()=>{posts.length=0;api.mockReset();api.mockImplementation(async(url:string,init:any)=>{if(init?.method==='POST'){posts.push(JSON.parse(init.body));throw new Error('create response unavailable');}if(url.includes('/agent-identities'))return{items:[{id:'personal',kind:'personal',state:'active'}]};if(url.endsWith('/agent-task-capabilities'))return{platformAvailable:true};return{items:[],nextCursor:null};});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Probe/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('carries exact typed references separately from the same human-readable question',async()=>{
 await act(async()=>{await cowork.send('核对同名资料',[],'conversation_1',[{kind:'orders',id:'selected-order'},{kind:'invoices',id:'selected-invoice'}]);});
 expect(posts).toHaveLength(1);expect(posts[0].intentRefs).toEqual([{kind:'orders',id:'selected-order'},{kind:'invoices',id:'selected-invoice'}]);expect(posts[0].instructions).toBe('核对同名资料');
});
it('does not reuse an uncertain creation request when the selected identity changes under the same label',async()=>{
 await act(async()=>{await cowork.send('同名资料',[],'conversation_1',[{kind:'orders',id:'order-A'}]);});await act(async()=>{await cowork.reload();});await act(async()=>{await cowork.send('同名资料',[],'conversation_1',[{kind:'orders',id:'order-B'}]);});
 expect(posts).toHaveLength(2);expect(posts[1].requestId).not.toBe(posts[0].requestId);expect(posts[1].intentRefs).toEqual([{kind:'orders',id:'order-B'}]);
});
it('keeps legacy no-reference request bodies unchanged',async()=>{
 await act(async()=>{await cowork.send('旧客户端请求',[],'conversation_1');});expect(posts).toHaveLength(1);expect(posts[0]).not.toHaveProperty('intentRefs');
});
