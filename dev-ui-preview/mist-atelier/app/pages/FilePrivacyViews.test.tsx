// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../components/mist';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {Nav} from '../nav';
const bridge=vi.hoisted(()=>({workspace:null as any,reviews:null as any}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>bridge.workspace}));
vi.mock('../runtime/auth',()=>{const useMistSession=()=>({status:'authenticated',user:{id:'reader'},sessionKey:'session',hasPermission:()=>true,canAccessView:()=>true});return{useMistSession,useOptionalMistSession:useMistSession};});
vi.mock('../runtime/reviews',()=>({useMistReviews:()=>bridge.reviews,reviewSignatureImage:vi.fn()}));
import {RecordFiles} from './modules/fulfillmentKit';
import {ApprovalsPage} from './ApprovalsPage';
let host:HTMLElement,root:Root;
const visible={id:'visible',name:'ordinary.pdf',mimeType:'application/pdf',size:20,storageKey:'workspace/visible',createdAt:''};
const wrap=(node:React.ReactNode,route:any={view:'products'})=><MistRoot><ToastProvider><Nav.Provider value={{route,go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openAI:vi.fn(),openPalette:vi.fn()}}>{node}</Nav.Provider></ToastProvider></MistRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-13T12:00:00Z',actorName:'reader'} as any,'empty');state.files=[visible];bridge.workspace={workspace:{id:'workspace',name:'Company',revision:1},state,uploadFile:vi.fn(),downloadFile:vi.fn(),recover:vi.fn(),pending:null,saving:false};bridge.reviews={rows:[],loaded:true,error:'',busy:false,intent:null,refresh:vi.fn(),download:vi.fn(),decide:vi.fn()};host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('indicates unavailable record attachments without exposing their ids or suppressing the readable file',()=>{act(()=>root.render(wrap(<RecordFiles ids={['secret-tax-id','visible']}/>)));expect(host.textContent).toContain('1份附件不可读');expect(host.textContent).toContain('ordinary.pdf');expect(host.textContent).not.toContain('secret-tax-id');expect(bridge.workspace.downloadFile).not.toHaveBeenCalled();});
it('does not label loading metadata as a permission failure',()=>{bridge.workspace.state=null;act(()=>root.render(wrap(<RecordFiles ids={['secret-tax-id']}/>)));expect(host.textContent).not.toContain('附件不可读');});
it('keeps review evidence completeness visible without exposing a restricted filename or granting decision authority',()=>{bridge.reviews.rows=[{id:'review',kind:'quotation',entityId:'quote',title:'Quote review',requesterId:'owner',reviewerIds:['reader'],status:'pending',submittedAt:'2026-11-13T12:00:00Z',requiredPermission:'approvals:write',target:{view:'quotations',id:'quote'},details:[],fileIds:['secret-tax-id','visible'],files:[visible],workspaceId:'workspace',workspaceName:'Company',revision:1,canDecide:false}];act(()=>root.render(wrap(<ApprovalsPage/>,{view:'approvals',id:'workspace|review',section:'others'})));expect(host.textContent).toContain('1份附件不可读');expect(host.textContent).toContain('ordinary.pdf');expect(host.textContent).not.toContain('secret-tax-id');expect(()=>getByRole(host,'button',{name:'批准',exact:true})).toThrow();expect(bridge.reviews.download).not.toHaveBeenCalled();});
it('does not associate a late upload after the record widget changes while the route stays the same',async()=>{
 let finish!:(value:unknown)=>void;bridge.workspace.uploadFile.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const first=vi.fn(),second=vi.fn();
 act(()=>root.render(wrap(<RecordFiles key="first" ids={[]} onAttach={first}/>)));
 const input=host.querySelector('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[new File(['new'],'new.txt',{type:'text/plain'})]});
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
 act(()=>root.render(wrap(<RecordFiles key="second" ids={[]} onAttach={second}/>)));
 await act(async()=>{finish({id:'new-upload',name:'new.txt',mimeType:'text/plain',size:3,storageKey:'workspace/new-upload',createdAt:''});});
 expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();
});
it('clears the local association failure when original-request recovery confirms the file on this record',async()=>{
 const uploaded={id:'upload',name:'new.txt',mimeType:'text/plain',size:3,storageKey:'workspace/upload',createdAt:''};bridge.workspace.uploadFile.mockResolvedValue(uploaded);const associate=vi.fn(async()=>{bridge.workspace.pending={kind:'command',requestId:'link'};throw new Error('关联回执丢失');});
 act(()=>root.render(wrap(<RecordFiles ids={[]} onAttach={associate}/>)));const input=host.querySelector('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[new File(['new'],'new.txt',{type:'text/plain'})]});await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.textContent).toContain('附件未完成保存');expect(associate).toHaveBeenCalledTimes(1);
 bridge.workspace.pending=null;bridge.workspace.state.files.push(uploaded);act(()=>root.render(wrap(<RecordFiles ids={['upload']} onAttach={associate}/>)));
 expect(host.textContent).not.toContain('附件未完成保存');expect(host.textContent).not.toContain('重试关联已上传附件');expect(associate).toHaveBeenCalledTimes(1);
});
