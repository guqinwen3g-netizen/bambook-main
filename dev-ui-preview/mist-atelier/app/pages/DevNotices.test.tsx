// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../components/mist';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {Nav} from '../nav';
const store=vi.hoisted(()=>({value:null as any,session:'s1',bundle:vi.fn(),url:vi.fn(),anchor:vi.fn()}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>store.value}));
vi.mock('../runtime/auth',()=>({useOptionalMistSession:()=>({sessionKey:store.session,hasPermission:()=>true})}));
vi.mock('./developmentNoticeBundle',()=>({developmentNoticeBundle:store.bundle}));
import {DevNoticeCard} from './DevNotices';
let host:HTMLElement,root:Root,version:any,dev:any,route:any;
function render(){act(()=>root.render(<MistRoot><Nav.Provider value={{route,go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DevNoticeCard state={store.value.state} dev={dev} version={version} busy={false} onGenerate={vi.fn()} onDownload={vi.fn()} onPrint={vi.fn()}/></Nav.Provider></MistRoot>));}
async function download(){await act(async()=>getByRole(host,'button',{name:'附件包 (zip)',exact:true}).click());}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;store.session='s1';store.bundle.mockReset();store.url.mockReset().mockReturnValue('blob:test');store.anchor.mockReset();
 vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:store.url,revokeObjectURL:vi.fn()}));vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){store.anchor(this.download);});
 const state=createMistState({id:()=>'',now:'2026-10-08T00:18:00Z',actorName:'业务员'},'empty');
 state.files=[{id:'reference',name:'reference.pdf',mimeType:'application/pdf',size:1,storageKey:'reference',createdAt:''},{id:'notice',name:'notice.pdf',mimeType:'application/pdf',size:1,storageKey:'notice',createdAt:''}];
 dev={id:'dev',name:'西装',code:'DEV',values:{domain:'garment'},versionIds:['v']};version={id:'v',label:'R1-A',devId:'dev',factory:'工厂',fileIds:['reference'],notices:[{id:'n',noticeNo:'NOTICE-1',seq:1,fileId:'notice',generatedAt:'2026-10-08T00:18:00Z',generatedBy:'业务员',snapshot:{dueDate:'2026-10-22',attachments:[{fileId:'reference',name:'reference.pdf'}]}}]};
 state.devs=[dev];state.versions=[version];store.value={state,workspace:{id:'company-workspace'},readFile:vi.fn()};store.bundle.mockResolvedValue({name:'NOTICE-1-附件包.zip',bytes:new Uint8Array([1,2,3])});route={view:'development/detail',id:'dev',versionId:'v'};host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('offers independent notice and ZIP downloads and uses the authenticated file reader',async()=>{
 render();expect(getByRole(host,'button',{name:'通知单',exact:true})).toBeTruthy();await download();expect(store.bundle).toHaveBeenCalledWith(version.notices[0],store.value.state.files,store.value.readFile,expect.any(Function));expect(store.anchor).toHaveBeenCalledWith('NOTICE-1-附件包.zip');
});
it('shows a file failure and allows retry without creating a partial download',async()=>{
 store.bundle.mockRejectedValueOnce(new Error('原件读取失败'));render();await download();expect(host.textContent).toContain('原件读取失败');expect(store.anchor).not.toHaveBeenCalled();await download();expect(store.anchor).toHaveBeenCalledTimes(1);
});
it('does not download data into a different workspace after an in-flight bundle completes',async()=>{
 let complete!:(value:any)=>void;store.bundle.mockReturnValue(new Promise(resolve=>complete=resolve));render();await download();store.value.workspace={id:'other-company'};route={...route,id:'other'};render();await act(async()=>complete({name:'old.zip',bytes:new Uint8Array([1])}));expect(store.url).not.toHaveBeenCalled();expect(store.anchor).not.toHaveBeenCalled();
});
it('disables the ZIP action when the frozen notice has no attachments',()=>{
 version.notices[0].snapshot.attachments=[];render();expect((getByRole(host,'button',{name:'附件包 (zip)',exact:true}) as HTMLButtonElement).disabled).toBe(true);expect(store.bundle).not.toHaveBeenCalled();
});
