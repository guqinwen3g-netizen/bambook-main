import {createHash} from 'node:crypto';
import {extractFileText,fileTextLimit} from './agentFileText';
import {MistApiError} from './errors';

// Each parse remains bounded by the original file/decompression/structure limits.
// A cursor is a location, never an authorization credential or proof of prior reads.
const TEXT_WINDOW_MAX=2_000_000;
type Scope={workspaceId:string;fileId:string};
type Position=Scope&{v:1;source:string;page:number;offset:number};
const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
function position(value:unknown,scope:Scope,source:string):Position{
 if(value===undefined)return {...scope,v:1,source,page:1,offset:0};
 if(typeof value!=='string'||value.length>2048||!/^aft1\.[A-Za-z0-9_-]+$/.test(value))throw new RangeError('附件续读位置无效');
 let p:Position;try{p=JSON.parse(Buffer.from(value.slice(5),'base64url').toString('utf8'));}catch{throw new RangeError('附件续读位置无效');}
 if(!p||Object.keys(p).sort().join(',')!=='fileId,offset,page,source,v,workspaceId'||p.v!==1||p.workspaceId!==scope.workspaceId||p.fileId!==scope.fileId||typeof p.source!=='string'||!/^[a-f0-9]{64}$/.test(p.source)||!Number.isSafeInteger(p.page)||p.page<1||p.page>1_000_000||(p.page-1)%20!==0||!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>TEXT_WINDOW_MAX)throw new RangeError('附件续读位置无效');
 if(p.source!==source)throw new MistApiError('FILE_TEXT_SOURCE_CHANGED','附件已变化，请从首段重新读取',409);
 return p;
}
export async function readFileTextWindow(scope:Scope,file:{name:string;mimeType:string},bytes:Uint8Array,maxChars?:number,cursor?:unknown){
 // Bump the protocol tag and cursor version if extraction/normalization semantics change.
 const limit=fileTextLimit(maxChars),sha256=hash(bytes),sourceHash=hash(JSON.stringify(['file-text-v1',sha256,file.name,file.mimeType])),p=position(cursor,scope,sourceHash);
 const raw=await extractFileText(file,bytes,TEXT_WINDOW_MAX+1,p.page);
 const content=raw.text.slice(0,TEXT_WINDOW_MAX),pdf=raw.kind==='pdf',morePages=!!raw.window&&raw.window.end<(raw.pages??0);
 if(!pdf&&p.page!==1||p.offset>content.length||p.offset>0&&/[\uDC00-\uDFFF]/.test(content[p.offset]??''))throw new RangeError('附件续读位置超出当前正文');
 const readable=!['unreadable','unsupported'].includes(raw.kind);
 let end=Math.min(content.length,p.offset+limit);
 if(end<content.length&&/[\uD800-\uDBFF]/.test(content[end-1]??''))end--;
 const text=content.slice(p.offset,end);
 const extractionLimited=raw.text.length>TEXT_WINDOW_MAX || raw.truncated&&!morePages;
 const next=readable&&end<content.length?{...p,offset:end}:readable&&morePages&&!extractionLimited?{...p,page:raw.window!.end+1,offset:0}:undefined;
 const fromStart=p.page===1&&p.offset===0,hasMore=!!next;
 const complete=readable&&fromStart&&!hasMore&&!extractionLimited&&!raw.reason;
 return {kind:raw.kind,text,truncated:readable&&(!complete),complete,hasMore,
  ...(next?{nextCursor:'aft1.'+Buffer.from(JSON.stringify(next)).toString('base64url')}:{}),
  sourceHash,sha256,range:{unit:'utf16' as const,start:p.offset,end,...(raw.window?{pageFrom:raw.window.start,pageTo:raw.window.end}:{})},
  ...(raw.pages!==undefined?{pages:raw.pages}:{}),...(raw.sheets?{sheets:raw.sheets}:{}),
  ...(raw.pagesWithoutText?.length?{pagesWithoutText:raw.pagesWithoutText}:{}),
  ...(raw.reason?{reason:raw.reason}:extractionLimited?{reason:'正文超过安全提取范围，当前片段不能代表完整原件'}:{}),
  ...(hasMore?{readHint:'用同一 fileId 和 nextCursor 调用 bambook_file_text 继续读取；累计范围连续且 sourceHash 一致才可认定没有漏读。'}:!fromStart?{readHint:'本段已到可提取范围末尾，但仅是片段；须与此前相同 sourceHash 的连续范围一起核对，不代表此前部分已读取。'}:{})};
}
