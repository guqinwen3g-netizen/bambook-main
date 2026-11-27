import { createHash, randomUUID } from 'node:crypto';
import type {AgentTaskIntentRef,AgentTaskView} from '../shared/mistAgentTasks';
import type { MarketQuotation } from '../shared/mistMarket';
import { splitTaskRequest } from '../shared/mistTaskHistoryText';
import type { PdfPageTextSpan } from './agentFileText';
import { officeKind } from './agentOfficeText';
import { isFileTextCursor } from './agentFileWindow';
import type{ResponseLocale}from'./responseLanguage';

export type PlatformTaskPlan={name:string;arguments:Record<string,unknown>;progress?:string};
export type PlatformTaskStep={id:string;plan:PlatformTaskPlan;result?:unknown;at:string;completedAt?:string;compacted?:boolean};
export type PlatformTaskProgress={steps:PlatformTaskStep[];nextRunAt:number;modelFallbackAt?:number;requiresRead?:boolean;requiresReadBeforeWrite?:boolean;checkpointBeforeIssue?:string;retryAt?:number;failures?:number;issue?:'model_unavailable'|'model_response_invalid'};
export const PLATFORM_TASK_TURN_LIMIT=60;
export const ATTACHMENT_PREFETCH_CHARS=3500;
export const PLATFORM_TASK_RESULT_LIMIT=160_000;
export type PlatformTaskContext={task:AgentTaskView;locale:ResponseLocale;businessAt?:string;hasTaskHistory?:boolean;taskReadRefs:AgentTaskIntentRef[];requiresRead:boolean;requiresReadBeforeWrite?:boolean;steps:PlatformTaskStep[];decisions:Array<{id:string;state:string;note?:string;produced?:{fileId:string;fileName:string}}>};
const names=new Set(['bambook_task','bambook_query','bambook_get','bambook_get_orders','bambook_related','bambook_commands','bambook_preview','bambook_execute','bambook_audit','bambook_mail_receiving','bambook_file_text']);

/** Persist an observable tool decision, never private reasoning or provider credentials. */
export function parsePlatformTaskPlan(text:string):PlatformTaskPlan{
  if(typeof text!=='string'||text.length>30_000)throw Error('MODEL_PLAN_INVALID');
  const raw=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');let value:any;
  try{value=JSON.parse(raw);}catch{throw Error('MODEL_PLAN_INVALID');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['name','arguments','progress'].includes(k))||!names.has(value.name)||!value.arguments||typeof value.arguments!=='object'||Array.isArray(value.arguments))throw Error('MODEL_PLAN_INVALID');
  if('workspaceId'in value.arguments||'taskId'in value.arguments)throw Error('MODEL_PLAN_SCOPE');
  if(value.name==='bambook_task'&&!['status','checkpoint','question','wait','finish'].includes(value.arguments.action))throw Error('MODEL_PLAN_INVALID');
  // Idempotency belongs to the persisted server turn, not to text proposed by a model.
  const args={...value.arguments};if(value.name==='bambook_execute'||value.name==='bambook_task'&&args.action!=='status')delete args.requestId;
  const progress=typeof value.progress==='string'&&!/\b(?:bma1|bmc1|bmt1)_[A-Za-z0-9_-]+|\b(?:Bearer\s+|sk-)[A-Za-z0-9_-]{8,}/i.test(value.progress)
    ? value.progress.replace(/[\u0000-\u001f\u007f\s]+/gu,' ').trim().slice(0,240) : '';
  return{name:value.name,arguments:args,...(progress?{progress}:{})};
}
export function newPlatformTaskStep(plan:PlatformTaskPlan,now:number):PlatformTaskStep{
  const id='platform_'+randomUUID();return{id,plan:{...plan,arguments:{...plan.arguments,...(plan.name==='bambook_execute'||plan.name==='bambook_task'&&plan.arguments.action!=='status'?{requestId:id}:{})}},at:new Date(now).toISOString()};
}
export const PLATFORM_TASK_ATTACHMENT_PREFIX = 'attachment_';

/** Attachment order remains fixed for a task, so these model-only handles survive a resume. */
export function platformTaskAttachmentHandles(attachments: AgentTaskView['attachments'] = []): ReadonlyMap<string, string> {
  return new Map(attachments.map((file, index) => [file.id, `${PLATFORM_TASK_ATTACHMENT_PREFIX}${index + 1}`]));
}

export function requestedPdfRange(attachments:AgentTaskView['attachments']=[],instructions='') {
  const request=splitTaskRequest(instructions);
  const files=attachments.filter(file=>/^application\/pdf\b/i.test(file.mimeType)||/\.pdf$/i.test(file.name));
  if(files.length!==1)return;
  const file=files[0];
  if(attachments.length>1&&!request.includes(file.name)&&!/\bpdf\b/i.test(request))return;
  const chinese=[...request.matchAll(/(?:^|[。；;\n])[ \t]*(?:(?:本次|这次|请)[ \t]*){0,2}(?:只|仅)[ \t]*(?:读取|阅读|核对|查看|检查|读|看)[^。；;，,\n]{0,32}?(?:前[ \t]*|第[ \t]*([1-9]\d*)[ \t]*(?:至|到|[-–—])[ \t]*第?[ \t]*)([1-9]\d*)[ \t]*页/gu)];
  const english=[...request.matchAll(/(?:^|[.;\n])[ \t]*(?:please[ \t]+)?(?:only[ \t]+(?:read|check|review)|(?:read|check|review)[ \t]+only)[ \t]+(?:(?:the[ \t]+)?first[ \t]+([1-9]\d*)[ \t]+pages?\b|pages[ \t]+([1-9]\d*)[ \t]*(?:to|[-–—])[ \t]*([1-9]\d*)\b)/gi)];
  const ranges=[
    ...chinese.map(match=>({from:Number(match[1]??1),to:Number(match[2])})),
    ...english.map(match=>({from:Number(match[2]??1),to:Number(match[1]??match[3])})),
  ];
  const range=ranges[0];
  if(!range||ranges.some(({from,to})=>from!==range.from||to!==range.to))return;
  if(Number.isSafeInteger(range.from)&&Number.isSafeInteger(range.to)&&range.from<=range.to&&range.to<=1_000_000)
    return {fileId:file.id,...range};
}

export function requestedWorkbookWorksheet(attachments:AgentTaskView['attachments']=[],instructions='') {
  const request=splitTaskRequest(instructions);
  const workbooks=attachments.filter(file=>/\.xlsx$/i.test(file.name)||/spreadsheetml\.sheet/i.test(file.mimeType));
  const candidates=workbooks.length===1?workbooks:workbooks.filter(file=>request.includes(file.name));
  if(candidates.length!==1)return;
  const file=candidates[0];
  const chinese=[...request.matchAll(/(?:^|[。；;\n])[ \t]*(?:(?:本次|这次|请)[ \t]*){0,2}(?:只|仅)[ \t]*(?:读取|阅读|核对|查看|检查|读|看)[^。；;，,\n]{0,48}?(?:[「“]([^」”\n]{1,31})[」”][ \t]*工作表|工作表[ \t]*[：:][ \t]*([^。；;，,\n]{1,31})(?=[。；;，,\n]|$))/gu)];
  const english=[...request.matchAll(/(?:^|[.;\n])[ \t]*(?:please[ \t]+)?(?:only[ \t]+(?:read|check|review)|(?:read|check|review)[ \t]+only)[ \t]+(?:the[ \t]+)?worksheet[ \t]+["“]([^"”\n]{1,31})["”]/gi)];
  const names=new Set([...chinese.map(match=>match[1]??match[2].trim()),...english.map(match=>match[1])]);
  if(names.size!==1)return;
  const [worksheet]=names;
  if(worksheet)return {fileId:file.id,worksheet};
}

/** Older receipts without the requested scope cannot inform a new model turn. */
export function scopedAttachmentTaskSteps(steps:PlatformTaskStep[],pdfScope:ReturnType<typeof requestedPdfRange>,
  worksheetScope:ReturnType<typeof requestedWorkbookWorksheet>):PlatformTaskStep[] {
  if(!pdfScope&&!worksheetScope)return steps;
  const eligible=steps.filter(step=>{
    const read=step.result as (PdfReadWindow&{worksheetScope?:string;sheets?:string[];observedSheets?:string[];attachmentScopeRereadRequired?:boolean;pdfScopeRereadRequired?:boolean})|undefined;
    if(step.plan.name==='bambook_task'&&step.plan.arguments.action==='finish'
      &&(read?.pdfScopeRereadRequired===true||read?.attachmentScopeRereadRequired===true))return false;
    if(step.plan.name!=='bambook_file_text'||step.result===undefined)return true;
    const fileId=step.plan.arguments.fileId;
    if(typeof fileId!=='string'||worksheetScope?.fileId!==fileId&&pdfScope?.fileId!==fileId)return true;
    if(read?.error===true||read?.kind==='unreadable'||read?.kind==='unsupported')return !read.text;
    if(worksheetScope&&fileId===worksheetScope.fileId)return read?.kind==='xlsx'&&read.file?.id===fileId
      &&read.worksheetScope===worksheetScope.worksheet
      &&Array.isArray(read.sheets)&&read.sheets.length===1&&read.sheets[0]===worksheetScope.worksheet
      &&Array.isArray(read.observedSheets)&&read.observedSheets.every(name=>name===worksheetScope.worksheet);
    if(!pdfScope)return false;
    const range=read?.range;
    return read?.kind==='pdf'&&read.file?.id===fileId&&!!range
      &&Number.isSafeInteger(range.pageFrom)&&Number.isSafeInteger(range.pageTo)
      &&range.pageFrom>=pdfScope.from&&range.pageTo>=range.pageFrom&&range.pageTo<=pdfScope.to
      &&(pdfScope.from===1||read.pageScopeStart===pdfScope.from)
      &&typeof read.pages==='number'&&Number.isSafeInteger(read.pages)
      &&(read.pages<=pdfScope.to||read.pageScopeLimit===pdfScope.to);
  });
  // Old checkpoints can summarize excluded reads. They must not reintroduce those facts.
  return eligible.length===steps.length?eligible:eligible.filter(step=>step.plan.name!=='bambook_task'||step.plan.arguments.action!=='checkpoint');
}

/** Pre-read a short PDF or an explicitly requested last page within one additional window. */
export function shortPdfContinuationPlan(attachments: AgentTaskView['attachments'] = [], steps: PlatformTaskStep[], instructions = ''): PlatformTaskPlan | undefined {
  const limitedRange = /(?:只|仅|先)[^。；;\n]{0,48}(?:前[ \t]*[1-9]\d*[ \t]*页|第[ \t]*[1-9]\d*[ \t]*(?:至|到|[-–—])[ \t]*[1-9]\d*[ \t]*页)/u;
  const noContinuation = /(?:不要|无需|无须|不用|不必|暂不|先不|别|不)[ \t]*(?:续读|继续读|再读|(?:阅读|核对|读取|确认|检查|查看|看|读)[^。；;，,\n]{0,28}(?:末页|最后一页|尾段|后续页|第[ \t]*[1-9]\d*[ \t]*页))|\b(?:only the first|do not continue reading|(?:do not|don't) (?:read|check|review) (?:the )?(?:last|final) page|skip (?:the )?(?:last|final) page)\b/i;
  const tailDeferred = /(?:末页|最后一页|尾段|后续页)[ \t]*[，,]?[ \t]*(?:暂不|先不|稍后|留待|留到)/u;
  const onlyOnePage = /(?:只|仅)[ \t]*(?:核对|查看|读取|读(?!核对))[^。；;\n]{0,32}第[ \t]*[1-9]\d*[ \t]*页|\bonly page[ \t]+[1-9]\d*\b/i;
  if (limitedRange.test(instructions) || onlyOnePage.test(instructions) || noContinuation.test(instructions) || tailDeferred.test(instructions)) return;
  const pdfFiles = attachments.filter(file=>file.mimeType==='application/pdf'||/\.pdf$/i.test(file.name));
  const requestedPages = [...instructions.matchAll(/(?:读到|核对|确认|查看|检查)[ \t]*第[ \t]*([1-9]\d*)[ \t]*页/gu)].map(match=>Number(match[1]));
  const requestedTail = /(?:核对|读取|查看|检查|确认)[^。；;\n]{0,28}(?:末页|最后一页)/u.test(instructions);
  for (const file of pdfFiles) {
    const reads = steps.filter(step => step.plan.name === 'bambook_file_text' && step.plan.arguments.fileId === file.id);
    if (reads.length === 0 || reads.length > 2) continue;
    const verified = pdfReadCoverage(reads).get(file.id);
    if (!verified?.next) continue;
    const explicitOriginal = pdfFiles.length===1 && (instructions.includes(file.name)||/\bpdf\b/i.test(instructions));
    const explicitTail = explicitOriginal && (requestedTail||requestedPages.includes(verified.pages));
    if (verified.pages > (explicitTail ? 40 : 24)) continue;

    const first = reads[0].result as PdfReadWindow;
    if (first.range?.pageTo !== Math.min(20, verified.pages)) continue;
    if (reads.length === 2 && (first.nextPageFrom !== undefined || verified.next.from !== 21 || verified.next.offset !== 0)) continue;

    return { name: 'bambook_file_text', arguments: { fileId: file.id, cursor: verified.next.cursor, maxChars: ATTACHMENT_PREFETCH_CHARS } };
  }
}

/** Pre-read at most one small, fully extractable Office tail per original attachment. */
export function shortOfficeTailPlan(attachments:AgentTaskView['attachments']=[],steps:PlatformTaskStep[]):PlatformTaskPlan|undefined{
  for(const file of attachments){
    const kind=officeKind(file);
    if(!kind)continue;
    const reads=steps.filter(step=>step.plan.name==='bambook_file_text'&&step.plan.arguments.fileId===file.id);
    if(reads.length!==1)continue;
    const [first]=reads;
    const read=first.result as {
      kind?:string;error?:boolean;reason?:string;file?:{id?:string};sourceHash?:string;
      range?:{start:number;end:number};hasMore?:boolean;nextCursor?:unknown;remainingOfficeChars?:number;
    } | undefined;
    if(first.compacted||first.plan.arguments.cursor!==undefined||read?.kind!==kind||read.error||read.reason
      ||read.file?.id!==file.id||typeof read.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(read.sourceHash)
      ||read.range?.start!==0||!Number.isSafeInteger(read.range.end)||read.range.end<1
      ||read.hasMore!==true||!isFileTextCursor(read.nextCursor)
      ||typeof read.remainingOfficeChars!=='number'||!Number.isSafeInteger(read.remainingOfficeChars)
      ||read.remainingOfficeChars<1||read.remainingOfficeChars>ATTACHMENT_PREFETCH_CHARS)continue;
    return {name:'bambook_file_text',arguments:{fileId:file.id,cursor:read.nextCursor,maxChars:ATTACHMENT_PREFETCH_CHARS}};
  }
}

/** Restore the canonical file ID first, then resolve continuation from that exact file's latest successful read. */
export function resolvePlatformFileContinuation(
  plan: PlatformTaskPlan, steps: PlatformTaskStep[], handles?: ReadonlyMap<string, string>,
): PlatformTaskPlan {
  if (plan.name !== 'bambook_file_text' || typeof plan.arguments.fileId !== 'string') return plan;
  const requestedId = plan.arguments.fileId;
  const fileId = requestedId.startsWith(PLATFORM_TASK_ATTACHMENT_PREFIX)
    ? [...(handles ?? [])].find(([, handle]) => handle === requestedId)?.[0]
    : requestedId;
  if (fileId === undefined) return plan;
  const resolved = fileId === requestedId ? plan : { ...plan, arguments: { ...plan.arguments, fileId } };
  if (resolved.arguments.cursor !== 'next') return resolved;
  const last = [...steps].reverse().find(step => step.plan.name === 'bambook_file_text' && step.plan.arguments.fileId === fileId
    && step.result !== undefined && !(step.result as { error?: boolean })?.error);
  const result = last?.result as { hasMore?: boolean; nextCursor?: unknown } | undefined;
  if (last?.compacted || result?.hasMore !== true || !isFileTextCursor(result.nextCursor)) return resolved;
  return { ...resolved, arguments: { ...resolved.arguments, cursor: result.nextCursor } };
}
/** Label the amount scopes from one complete quotation read without calculating or refetching business values. */
function quotationAmountScope(result: unknown) {
  const read = result as { error?: boolean; object?: { type: string; truncated: boolean; data?: Partial<MarketQuotation> } } | undefined;
  const quote = read?.object?.data;
  if (read?.error || read?.object?.type !== 'quotation' || read.object.truncated !== false
    || typeof quote?.total !== 'string' || typeof quote.currency !== 'string' || !Array.isArray(quote.lines) || quote.lines.length < 2) return;
  const convertedLines = quote.lines.flatMap((line, index) => {
    const orderCode = line?.conversion?.orderCode;
    return orderCode && typeof line.amount === 'string'
      ? [{ lineNumber: index + 1, orderCode, quotationLineAmount: line.amount }]
      : [];
  });
  if (!convertedLines.length) return;
  return {
    currency: quote.currency, fullQuotationTotal: quote.total, convertedLines: convertedLines.slice(0, 12),
    ...(convertedLines.length > 12 ? { convertedLinesOmitted: convertedLines.length - 12 } : {}),
  };
}

type PdfReadWindow = {
  kind?:string; error?:boolean; file?:{id?:string}; sourceHash?:string; pages?:number;
  range?:{start:number;end:number;pageFrom:number;pageTo:number;textLimited?:boolean};
  hasMore?:boolean; nextCursor?:string; nextPageFrom?:number; pagesWithoutText?:number[]; reason?:string;
  text?:string; pageTextSpans?:PdfPageTextSpan[]; pageScopeStart?:number; pageScopeLimit?:number;
};

type PdfContinuation = {cursor:string;from:number;offset:number;to?:number};

/** Track coverage only across an exact continuation chain for the same original. */
function pdfReadCoverage(steps:PlatformTaskStep[]){
  const coverage=new Map<string,{sourceHash:string;pages:number;next?:PdfContinuation;pagesWithoutText:number[];textPages:Set<number>}>();
  for(const step of steps){
    const {name,arguments:args}=step.plan;
    const fileId=args.fileId;
    if(name!=='bambook_file_text'||typeof fileId!=='string')continue;
    const previous=coverage.get(fileId);
    coverage.delete(fileId);
    const read=step.result as PdfReadWindow|undefined,range=read?.range,missing=read?.pagesWithoutText??[];
    if(step.compacted||read?.error||read?.kind!=='pdf'||read.file?.id!==fileId||typeof read.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(read.sourceHash)
      ||!range||!Number.isSafeInteger(range.start)||range.start<0||!Number.isSafeInteger(range.end)||range.end<range.start
      ||!Number.isSafeInteger(range.pageFrom)||!Number.isSafeInteger(range.pageTo)||range.pageFrom<1||range.pageTo<range.pageFrom
      ||typeof read.pages!=='number'||!Number.isSafeInteger(read.pages)||range.pageTo>read.pages||typeof read.hasMore!=='boolean'
      ||!Array.isArray(missing)||missing.some(page=>!Number.isSafeInteger(page)||page<range.pageFrom||page>range.pageTo)
      ||(read.reason&&!missing.length))continue;
    const head=args.cursor===undefined;
    const expected=previous?.next;
    if(head?range.pageFrom!==1||range.start!==0:!expected||expected.cursor!==args.cursor
      ||previous?.sourceHash!==read.sourceHash||previous.pages!==read.pages||range.pageFrom!==expected.from
      ||range.start!==expected.offset||(expected.to!==undefined&&range.pageTo!==expected.to))continue;

    let next:PdfContinuation|undefined;
    if(read.hasMore){
      if(typeof read.nextCursor!=='string'||!read.nextCursor.startsWith('aft1.'))continue;
      if(read.nextPageFrom===undefined){
        if(!range.textLimited||range.end===range.start)continue;
        next={cursor:read.nextCursor,from:range.pageFrom,to:range.pageTo,offset:range.end};
      }else{
        if(range.textLimited||read.nextPageFrom!==range.pageTo+1||range.pageTo>=read.pages)continue;
        next={cursor:read.nextCursor,from:read.nextPageFrom,offset:0};
      }
    }else if(read.nextCursor!==undefined||range.textLimited||range.pageTo!==read.pages)continue;
    const textPages=new Set(head?[]:previous?.textPages);
    if(typeof read.text==='string'&&Array.isArray(read.pageTextSpans)){
      for(const span of read.pageTextSpans){
        if(span&&Number.isSafeInteger(span.page)&&span.page>=range.pageFrom&&span.page<=range.pageTo
          &&Number.isSafeInteger(span.start)&&Number.isSafeInteger(span.end)&&span.start>=0
          &&span.end>span.start&&span.end<=read.text.length&&read.text.slice(span.start,span.end).trim())textPages.add(span.page);
      }
    }
    coverage.set(fileId,{sourceHash:read.sourceHash,pages:read.pages,next,textPages,
      pagesWithoutText:[...new Set([...(head?[]:previous?.pagesWithoutText??[]),...missing])]});
  }
  return coverage;
}

/** Give the model physical page identities without sending the same excerpt twice. */
function modelFileRead(result:unknown) {
  if(!result||typeof result!=='object')return result;
  // Binary integrity is checked by the repository. Models only need sourceHash to join excerpts.
  const {sha256:_binaryDigest,notice:_repeatedNotice,...read}=result as {
    sha256?:string;notice?:string;kind?:string;nextCursor?:unknown;text?:string;pageTextSpans?:PdfPageTextSpan[];
  };
  const cursor=typeof read.nextCursor==='string'?{nextCursor:'next'}:{};
  if(read.kind!=='pdf'||typeof read.text!=='string'||!read.pageTextSpans?.length)return {...read,...cursor};
  const {text,pageTextSpans,...metadata}=read;
  return {...metadata,...cursor,pdfTextByPage:pageTextSpans.map(({page,start,end})=>({page,text:text.slice(start,end)}))};
}

/** Model context is explicit about omitted history; it cannot silently become full-read evidence. */
export function platformTaskHistory(steps:PlatformTaskStep[]){
  let remaining=240_000;const recent:Array<{operationId:string;name:string;arguments:unknown;result:unknown;compacted?:boolean;quotationAmountScope?:ReturnType<typeof quotationAmountScope>}>=[];
  const readResults = new Map<string,string>();
  for(const step of [...steps].reverse()){
    if(step.result===undefined)continue;
    const read = ['bambook_get','bambook_get_orders','bambook_query','bambook_related','bambook_file_text','bambook_commands'].includes(step.plan.name);
    const key=read&&!step.compacted
      ? createHash('sha256').update(JSON.stringify([step.plan.name,step.plan.arguments,step.result])).digest('hex')
      : undefined;
    const duplicateOf=key&&readResults.get(key);
    const fileRead=step.plan.name==='bambook_file_text';
    const displayedResult=fileRead?modelFileRead(step.result):step.result;
    const args=fileRead&&typeof step.plan.arguments.cursor==='string'?{...step.plan.arguments,cursor:'next'}:step.plan.arguments;
    const result=duplicateOf?{duplicateOf,readHint:'此读取的参数和完整结果与所引用步骤相同，请查看该步骤回执。'}:displayedResult;
    const amounts = !duplicateOf && !step.compacted && step.plan.name === 'bambook_get' && step.plan.arguments.type === 'quotation'
      ? quotationAmountScope(step.result) : undefined;
    const item={operationId:step.id,name:step.plan.name,arguments:args,result,compacted:step.compacted,...(amounts ? { quotationAmountScope: amounts } : {})},size=JSON.stringify(item).length;
    if(size>remaining)break;
    recent.unshift(item);remaining-=size;
    if(key&&!duplicateOf)readResults.set(key,step.id);
  }
  const included=new Set(recent.map(item=>item.operationId));
  const coverage=pdfReadCoverage(steps.filter(step=>included.has(step.id)));
  const pdfCoverage=[...coverage].flatMap(([fileId,read])=>!read.next
    ? [{fileId,pagesChecked:read.pages,pagesWithoutText:read.pagesWithoutText}] : []);
  const pdfPendingCoverage=[...coverage].flatMap(([fileId,read])=>{
    const next=read.next;
    if(!next)return [];
    const unreadFrom=next.to===undefined?next.from:next.to+1;
    return [{
      fileId,pagesInOriginal:read.pages,returnedThroughPage:next.from-1,pagesWithoutText:read.pagesWithoutText,
      ...(next.to!==undefined?{partialWindow:{from:next.from,to:next.to}}:{}),
      ...(unreadFrom<=read.pages?{unreadPages:{from:unreadFrom,to:read.pages}}:{}),
    }];
  });
  const pdfTextPageRanges=[...coverage].flatMap(([fileId,read])=>{
    if(!read.pagesWithoutText.length)return [];
    const missing=new Set(read.pagesWithoutText);
    const ranges:Array<{from:number;to:number}>=[];
    for(const page of [...read.textPages].sort((a,b)=>a-b)){
      if(missing.has(page))continue;
      const last=ranges.at(-1);
      if(last&&last.to+1===page)last.to=page;
      else ranges.push({from:page,to:page});
    }
    return ranges.length?[{fileId,ranges}]:[];
  });
  return{recent,...(pdfCoverage.length?{pdfCoverage}:{}),...(pdfPendingCoverage.length?{pdfPendingCoverage}:{}),
    ...(pdfTextPageRanges.length?{pdfTextPageRanges}:{}),
    omitted:steps.filter(s=>s.result!==undefined).length-recent.length,operations:steps.map(s=>({operationId:s.id,name:s.plan.name,completed:s.result!==undefined}))};
}
/** Keep durable completed-operation references, while bounding the registry and future prompts. */
export function compactPlatformTaskSteps(input:PlatformTaskStep[]):PlatformTaskStep[]{
  const steps=structuredClone(input);
  for(let i=0;JSON.stringify(steps).length>600_000&&i<steps.length;i++){
    const step=steps[i];if(step.result===undefined||step.compacted)continue;const result=step.result as any,args=step.plan.arguments;
    step.plan={name:step.plan.name,...(step.plan.progress?{progress:step.plan.progress}:{}),arguments:{...(args.type?{type:args.type}:{}),...(args.id?{id:args.id}:{}),...(args.requestId?{requestId:args.requestId}:{}),...(args.command?{commandType:(args.command as any).type}:{})}};
    step.result={truncated:true,status:result?.status,revision:result?.revision,error:result?.error,receipt:result?.receipt?{requestId:result.receipt.requestId,result:{id:result.receipt.result?.id}}:undefined};step.compacted=true;
  }
  return steps;
}
