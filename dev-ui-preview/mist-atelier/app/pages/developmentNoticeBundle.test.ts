import {expect,it,vi} from 'vitest';
import JSZip from 'jszip';
import type {MistFile} from '../../../../server/src/shared/mistWorkspace';
import type {DevNoticeRecord} from '../../../../server/src/shared/mistDevelopmentNotice';
import {developmentNoticeBundle} from './developmentNoticeBundle';
const file=(id:string,name:string,body:string):MistFile=>({id,name,mimeType:'application/pdf',size:new TextEncoder().encode(body).length,storageKey:'test/'+id,createdAt:'2026-10-08T00:18:00Z'});
const notice=(attachments:Array<{fileId:string;name:string}>):DevNoticeRecord=>({noticeNo:'DEV-1-R1-A-N01',fileId:'notice-pdf',generatedAt:'2026-10-08T00:18:00Z',snapshot:{attachments}} as DevNoticeRecord);
it('packages only frozen task attachments and preserves their bytes and formats, without adding the notice',async()=>{
 const files=[file('old','renamed-now.docx','original docx'),file('later','later.pdf','later'),file('notice-pdf','notice.pdf','notice')],read=vi.fn(async(f:MistFile)=>new Blob([f.id==='old'?'original docx':'unexpected']));
 const result=await developmentNoticeBundle(notice([{fileId:'old',name:'selected-original.docx'},{fileId:'notice-pdf',name:'notice.pdf'}]),files,read);
 const zip=await JSZip.loadAsync(result.bytes);expect(Object.keys(zip.files)).toEqual(['selected-original.docx']);expect(await zip.file('selected-original.docx')!.async('string')).toBe('original docx');expect(read.mock.calls.map(([f])=>f.id)).toEqual(['old']);expect(result.name).toBe('DEV-1-R1-A-N01-附件包.zip');
});
it('avoids unsafe paths, duplicate names and duplicate file IDs',async()=>{
 const files=[file('a','a','a'),file('b','b','b')];const result=await developmentNoticeBundle(notice([{fileId:'a',name:'../../spec.pdf'},{fileId:'a',name:'duplicate.pdf'},{fileId:'b',name:'spec.pdf'}]),files,async f=>new Blob([f.id]));
 const zip=await JSZip.loadAsync(result.bytes);expect(Object.keys(zip.files)).toEqual(['spec.pdf','spec (2).pdf']);
});
it('refuses an empty package or a missing reference without reading unrelated files',async()=>{
 const read=vi.fn();await expect(developmentNoticeBundle(notice([]),[],read)).rejects.toThrow('没有附件');await expect(developmentNoticeBundle(notice([{fileId:'foreign',name:'private.pdf'}]),[],read)).rejects.toThrow('不可用');expect(read).not.toHaveBeenCalled();
});
it('does not return a partial archive when an original cannot be read or has an unexpected size',async()=>{
 const f=file('a','a.pdf','original');await expect(developmentNoticeBundle(notice([{fileId:'a',name:f.name}]),[f],async()=>{throw new Error('无权读取');})).rejects.toThrow('无权读取');await expect(developmentNoticeBundle(notice([{fileId:'a',name:f.name}]),[f],async()=>new Blob(['short']))).rejects.toThrow('原件大小不符');
});
it('abandons the result when the page or account changes during an authenticated read',async()=>{
 const f=file('a','a.pdf','original');let current=true;await expect(developmentNoticeBundle(notice([{fileId:'a',name:f.name}]),[f],async()=>{current=false;return new Blob(['original']);},()=>current)).rejects.toThrow('页面已切换');
});
it('rejects an oversized package before reading the files',async()=>{
 const f={...file('a','a.pdf','a'),size:201*1024*1024},read=vi.fn();await expect(developmentNoticeBundle(notice([{fileId:'a',name:f.name}]),[f],read)).rejects.toThrow('200MB');expect(read).not.toHaveBeenCalled();
});
