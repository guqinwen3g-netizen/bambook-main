import {createHash} from 'node:crypto';
import {extractFileText,fileTextLimit,type FileTextResult} from './agentFileText';
import {MistApiError} from './errors';

// Each parse remains bounded by the original file/decompression/structure limits.
// A cursor is a location, never an authorization credential or proof of prior reads.
const TEXT_WINDOW_MAX=2_000_000;
type Scope={workspaceId:string;fileId:string};
type CursorVersion=1|2;
type PdfPageScope={from:number;to:number};
type Position=Scope&{v:CursorVersion;source:string;page:number;offset:number};
/** Parsed PDF and Office excerpts scoped to one active task run. Each read still verifies the original bytes. */
export type FileTextWindowCache=Map<string,{sourceHash:string;page:number;result:FileTextResult}>;
const FILE_CACHE_COUNT_MAX=6;
const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
export function isFileTextCursor(value:unknown):value is string {
 return typeof value==='string'&&value.length<=2048&&/^aft[12]\.[A-Za-z0-9_-]+$/.test(value);
}
function position(value:unknown,scope:Scope,sourceFor:(version:CursorVersion)=>string,pdfPages?:PdfPageScope):Position{
 const start=pdfPages?.from??1;
 if(value===undefined)return {...scope,v:1,source:sourceFor(1),page:start,offset:0};
 if(!isFileTextCursor(value))throw new RangeError('附件续读位置无效');
 let p:Position;try{p=JSON.parse(Buffer.from(value.slice(5),'base64url').toString('utf8'));}catch{throw new RangeError('附件续读位置无效');}
 if(!p||Object.keys(p).sort().join(',')!=='fileId,offset,page,source,v,workspaceId'||p.v!==Number(value[3])||p.workspaceId!==scope.workspaceId||p.fileId!==scope.fileId||typeof p.source!=='string'||!/^[a-f0-9]{64}$/.test(p.source)||!Number.isSafeInteger(p.page)||p.page<1||p.page>1_000_000||!pdfPages&&(p.page-1)%20!==0||!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>TEXT_WINDOW_MAX)throw new RangeError('附件续读位置无效');
 if(p.source!==sourceFor(p.v))throw new MistApiError('FILE_TEXT_SOURCE_CHANGED','附件已变化，请从首段重新读取',409);
 if(pdfPages&&(p.page<pdfPages.from||p.page>pdfPages.to))throw new MistApiError('FILE_TEXT_PAGE_SCOPE','该页超出本任务指定的 PDF 读取范围',422);
 if((p.page-start)%20!==0)throw new RangeError('附件续读位置无效');
 return p;
}
export async function readFileTextWindow(scope:Scope,file:{name:string;mimeType:string},bytes:Uint8Array,maxChars?:number,cursor?:unknown,fileCache?:FileTextWindowCache,pdfPages?:PdfPageScope){
 // Bump the protocol tag and cursor version if extraction/normalization semantics change.
 const limit=fileTextLimit(maxChars),sha256=hash(bytes);
 const sourceFor=(version:CursorVersion)=>hash(JSON.stringify(['file-text-v'+version,sha256,file.name,file.mimeType,
  ...(!pdfPages?[]:pdfPages.from===1?['requested-pdf-prefix',pdfPages.to]:['requested-pdf-range',pdfPages.from,pdfPages.to])]));
 let p=position(cursor,scope,sourceFor,pdfPages);
 const cacheKey=JSON.stringify([scope.workspaceId,scope.fileId]);
 const cached=fileCache?.get(cacheKey);
 const raw=p.offset>0&&cached?.sourceHash===p.source&&cached.page===p.page
   ? cached.result : await extractFileText(file,bytes,TEXT_WINDOW_MAX+1,p.page,pdfPages?.to);
 if(raw.kind==='xlsx'&&raw.attributedValues&&p.v===1){
   if(cursor!==undefined)throw new MistApiError('FILE_TEXT_CURSOR_UPDATED','Excel 正文读取方式已更新，请从首段重新读取',409);
   p={...p,v:2,source:sourceFor(2)};
 }else if(p.v===2&&(raw.kind!=='xlsx'||!raw.attributedValues)){
   throw new RangeError('附件续读位置无效');
 }
 const sourceHash=p.source;
 const content=raw.text.slice(0,TEXT_WINDOW_MAX),pdf=raw.kind==='pdf',originalHasLaterPages=!!raw.window&&raw.window.end<(raw.pages??0);
 const morePages=originalHasLaterPages&&raw.window!.end<(pdfPages?.to??Infinity);
 const pageScopeStart=pdf&&pdfPages&&pdfPages.from>1?pdfPages.from:undefined;
 const pageScopeLimit=pdf&&pdfPages&&pdfPages.to<(raw.pages??0)?pdfPages.to:undefined;
 const office=raw.kind==='docx'||raw.kind==='xlsx'||raw.kind==='pptx';
 if(!pdf&&p.page!==1||p.offset>content.length||p.offset>0&&/[\uDC00-\uDFFF]/.test(content[p.offset]??''))throw new RangeError('附件续读位置超出当前正文');
 const readable=!['unreadable','unsupported'].includes(raw.kind);
 let end=Math.min(content.length,p.offset+limit);
 if(end<content.length&&/[\uD800-\uDBFF]/.test(content[end-1]??''))end--;
 const text=content.slice(p.offset,end);
 const pageTextSpans=raw.pageTextSpans?.filter(span=>span.end>p.offset&&span.start<end).map(span=>({
  page:span.page,start:Math.max(span.start,p.offset)-p.offset,end:Math.min(span.end,end)-p.offset,
 }));
 const extractionLimited=raw.text.length>TEXT_WINDOW_MAX || raw.truncated&&!originalHasLaterPages;
 const next=readable&&end<content.length?{...p,offset:end}:readable&&morePages&&!extractionLimited?{...p,page:raw.window!.end+1,offset:0}:undefined;
 if(fileCache){
   fileCache.delete(cacheKey);
   if((pdf||office)&&next?.page===p.page&&raw.text.length<=TEXT_WINDOW_MAX){
     fileCache.set(cacheKey,{sourceHash,page:p.page,result:raw});
     let retainedChars=0;
     for(const window of fileCache.values())retainedChars+=window.result.text.length;
     for(const [key,window] of fileCache){
       if(fileCache.size<=FILE_CACHE_COUNT_MAX&&retainedChars<=TEXT_WINDOW_MAX)break;
       fileCache.delete(key);
       retainedChars-=window.result.text.length;
     }
   }
 }
 const fromStart=p.page===1&&p.offset===0,hasMore=!!next;
 const complete=readable&&fromStart&&!hasMore&&!extractionLimited&&!raw.reason&&pageScopeLimit===undefined;
 return {kind:raw.kind,text,truncated:readable&&(!complete),complete,hasMore,
  ...(next?{nextCursor:'aft'+next.v+'.'+Buffer.from(JSON.stringify(next)).toString('base64url')}:{}),
  ...(next&&next.page>p.page?{nextPageFrom:next.page}:{}),
  ...(office&&next&&!extractionLimited?{remainingOfficeChars:content.length-end}:{}),
  sourceHash,sha256,range:{unit:'utf16' as const,start:p.offset,end,...(raw.window?{
   pageFrom:raw.window.start,pageTo:raw.window.end,...(end<content.length||extractionLimited?{textLimited:true as const}:{})
  }:{})},
  ...(pageScopeStart!==undefined?{pageScopeStart}:{}),
  ...(pageScopeLimit!==undefined?{pageScopeLimit}:{}),
  ...(raw.pages!==undefined?{pages:raw.pages}:{}),...(raw.sheets?{sheets:[...raw.sheets]}:{}),
  ...(raw.pagesWithoutText?.length?{pagesWithoutText:[...raw.pagesWithoutText]}:{}),
  ...(raw.kind==='xlsx'?{observedSheets:raw.sheetTextSpans?.filter(span=>span.end>p.offset&&span.start<end).map(span=>span.name)??[]}:{}),
  ...(pdf?{pageTextSpans:pageTextSpans??[]}:{}),
  ...(raw.reason?{reason:raw.reason}:extractionLimited?{reason:'正文超过安全提取范围，当前片段不能代表完整原件'}:{}),
  ...(hasMore?{readHint:'用同一 fileId 和 nextCursor 调用 bambook_file_text 继续读取；累计范围连续且 sourceHash 一致才可认定没有漏读。'}:pageScopeStart!==undefined?{readHint:`本任务只读取第 ${pageScopeStart} 至 ${pageScopeLimit??raw.pages} 页，范围外未核实。`}:pageScopeLimit!==undefined?{readHint:`本任务只读取前 ${pageScopeLimit} 页，之后的页未核实。`}:!fromStart?{readHint:'本段已到可提取范围末尾，但仅是片段；须与此前相同 sourceHash 的连续范围一起核对，不代表此前部分已读取。'}:{})};
}
