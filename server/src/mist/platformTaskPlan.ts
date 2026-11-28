import { createHash, randomUUID } from 'node:crypto';
import type {AgentTaskIntentRef,AgentTaskIssueCode,AgentTaskQuestion,AgentTaskView} from '../shared/mistAgentTasks';
import type { MarketQuotation } from '../shared/mistMarket';
import { splitTaskRequest } from '../shared/mistTaskHistoryText';
import { officeKind, taskAttachmentLabels, taskWorkbookChoices, taskPdfChoices, isTaskPdf, PDF_VISUAL_PAGE_LIMIT, type PdfVisualCandidate, PDF_SELECTION_QUESTION, WORKBOOK_SELECTION_QUESTION } from '../shared/mistTaskAttachments';
import type { PdfPageTextSpan } from './agentFileText';
import { isFileTextCursor, type PdfPageRange, type PdfPageScope } from './agentFileWindow';
import type{ResponseLocale}from'./responseLanguage';

export type PlatformTaskPlan={name:string;arguments:Record<string,unknown>;progress?:string};
export type PlatformTaskStep={id:string;plan:PlatformTaskPlan;result?:unknown;at:string;completedAt?:string;compacted?:boolean};
export type PlatformTaskProgress={steps:PlatformTaskStep[];nextRunAt:number;modelFallbackAt?:number;requiresRead?:boolean;requiresReadBeforeWrite?:boolean;checkpointBeforeIssue?:string;retryAt?:number;failures?:number;issue?:AgentTaskIssueCode};
export const PLATFORM_TASK_TURN_LIMIT=60;
export const ATTACHMENT_PREFETCH_CHARS=3500;
export const PLATFORM_TASK_RESULT_LIMIT=160_000;
export type PlatformTaskContext={task:AgentTaskView;locale:ResponseLocale;businessAt?:string;hasTaskHistory?:boolean;taskReadRefs:AgentTaskIntentRef[];requiresRead:boolean;requiresReadBeforeWrite?:boolean;proposalReadBack?:{proposalId:string;outcome:'confirmed'|'rejected';ref:AgentTaskIntentRef;stepOffset:number};steps:PlatformTaskStep[];decisions:Array<{id:string;state:string;note?:string;produced?:{fileId:string;fileName:string}}>};
const names=new Set(['bambook_task','bambook_query','bambook_get','bambook_get_orders','bambook_related','bambook_commands','bambook_preview','bambook_execute','bambook_audit','bambook_mail_receiving','bambook_file_text']);

function assignsPlatformRequestId(name:string,args:Record<string,unknown>){
  return name==='bambook_execute'||name==='bambook_task'&&args.action!=='status';
}

/** Persist an observable tool decision, never private reasoning or provider credentials. */
export function parsePlatformTaskPlan(text:string):PlatformTaskPlan{
  if(typeof text!=='string'||text.length>30_000)throw Error('MODEL_PLAN_INVALID');
  const raw=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');let value:any;
  try{value=JSON.parse(raw);}catch{throw Error('MODEL_PLAN_INVALID');}
  if(!value||typeof value!=='object'||Array.isArray(value)||!names.has(value.name)||!value.arguments||typeof value.arguments!=='object'||Array.isArray(value.arguments))throw Error('MODEL_PLAN_INVALID');
  const assignsRequestId=assignsPlatformRequestId(value.name,value.arguments);
  // A redundant envelope ID can be dropped only for tools that get a server ID.
  if(Object.keys(value).some(key=>!['name','arguments','progress'].includes(key)
    &&!(key==='requestId'&&assignsRequestId&&typeof value.requestId==='string')))throw Error('MODEL_PLAN_INVALID');
  if('workspaceId'in value.arguments||'taskId'in value.arguments)throw Error('MODEL_PLAN_SCOPE');
  if(value.name==='bambook_task'&&!['status','checkpoint','question','wait','finish'].includes(value.arguments.action))throw Error('MODEL_PLAN_INVALID');
  const args={...value.arguments};
  if(assignsRequestId)delete args.requestId;
  const progress=typeof value.progress==='string'&&!/\b(?:bma1|bmc1|bmt1)_[A-Za-z0-9_-]+|\b(?:Bearer\s+|sk-)[A-Za-z0-9_-]{8,}/i.test(value.progress)
    ? value.progress.replace(/[\u0000-\u001f\u007f\s]+/gu,' ').trim().slice(0,240) : '';
  return{name:value.name,arguments:args,...(progress?{progress}:{})};
}
export function newPlatformTaskStep(plan:PlatformTaskPlan,now:number):PlatformTaskStep{
  const id='platform_'+randomUUID();return{id,plan:{...plan,arguments:{...plan.arguments,...(assignsPlatformRequestId(plan.name,plan.arguments)?{requestId:id}:{})}},at:new Date(now).toISOString()};
}
export const PLATFORM_TASK_ATTACHMENT_PREFIX = 'attachment_';

/** Attachment order remains fixed for a task, so these model-only handles survive a resume. */
export function platformTaskAttachmentHandles(attachments: AgentTaskView['attachments'] = []): ReadonlyMap<string, string> {
  return new Map(attachments.map((file, index) => [file.id, `${PLATFORM_TASK_ATTACHMENT_PREFIX}${index + 1}`]));
}

const escapeAttachmentName = (value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function taskAttachmentNames(attachments:NonNullable<AgentTaskView['attachments']>) {
  const labels=taskAttachmentLabels(attachments);
  const names=[...new Set([...attachments.map(file=>file.name),...labels])].sort((a,b)=>b.length-a.length);
  const pattern=names.length?new RegExp(
    '(?<![A-Za-z0-9_./-])(?:'+names.map(escapeAttachmentName).join('|')+')(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9]|[（(]\\d+)','gu',
  ):undefined;
  return (text:string) => {
    if(!pattern)return [];
    const normalized=text.replace(/(\.[a-z0-9]+)\((\d+)\)/gi,'$1（$2）');
    return [...normalized.matchAll(pattern)].map(([name])=>
      attachments.filter((file,index)=>file.name===name||labels[index]===name));
  };
}

type PdfChoice = {question:string;ids:string[]};
type PdfSelection = {
  pdfRanges: Map<string,PdfPageScope>;
  pdfVisualRanges: Map<string,PdfPageScope>;
  confirmedPdfChoices: Set<string>;
  pdfChoice?: PdfChoice;
  pdfScopeConflict?: boolean;
};

function mergePdfRanges(ranges:readonly PdfPageRange[]):PdfPageScope {
  const windows:PdfPageRange[]=[];
  for(const range of [...ranges].sort((a,b)=>a.from-b.from||a.to-b.to)){
    const previous=windows.at(-1);
    if(previous&&range.from<=previous.to+1)previous.to=Math.max(previous.to,range.to);
    else windows.push({...range});
  }
  return windows.length===1?windows[0]:{from:windows[0].from,to:windows.at(-1)!.to,windows};
}

const CHINESE_PDF_LIST_ITEM=/^[ \t]*(?:、|，|,|和|与|以及|及)[ \t]*(?:第[ \t]*)?([1-9]\d*)(?:[ \t]*(?:页[ \t]*)?(?:至|到|[-–—])[ \t]*(?:第[ \t]*)?([1-9]\d*))?(?:[ \t]*页|(?=[ \t]*(?:$|[。；;、，,]|和|与|以及|及|或)))/u;
const ENGLISH_PDF_LIST_ITEM=/^[ \t]*(?:,[ \t]*(?:and[ \t]+)?|and[ \t]+)(?:pages?[ \t]+)?([1-9]\d*)\b(?:[ \t]*(?:to|[-–—])[ \t]*([1-9]\d*)\b)?/iu;
const CHINESE_WIDER_PDF=/^[ \t]*(?:之?[前后]|以[前后外]|之外|起|开始|往[前后]|及其后|(?:和|与|及|以及|或|至|到|[、，,–—/-])[ \t]*(?:(?:第[ \t]*)?[0-9]|末页|最后))/u;
const ENGLISH_WIDER_PDF=/^[ \t]*(?:(?:and|or|to|through|[–—/,-])[ \t]*(?:(?:page[ \t]+)?[0-9]|later|earlier)|onward|before|after)/iu;

function readPdfPageList(first:PdfPageRange,tail:string,item:RegExp,wider:RegExp) {
  const ranges=[first];
  for(let match=item.exec(tail);match;match=item.exec(tail)){
    const from=Number(match[1]);
    ranges.push({from,to:Number(match[2]??match[1])});
    tail=tail.slice(match[0].length);
  }
  return {ranges,tail,invalid:wider.test(tail)};
}

function pdfSelection(attachments:AgentTaskView['attachments']=[],instructions='',questions:readonly AgentTaskQuestion[]=[]):PdfSelection {
  const pdfRanges=new Map<string,PdfPageScope>(),pdfVisualRanges=new Map<string,PdfPageScope>();
  const confirmedPdfChoices=new Set<string>();
  const request=splitTaskRequest(instructions);
  const files=attachments.filter(isTaskPdf);
  if(!files.length)return {pdfRanges,pdfVisualRanges,confirmedPdfChoices};
  const namesIn=taskAttachmentNames(attachments);
  const pdfIds=new Set(files.map(file=>file.id));
  const bind=(match:RegExpMatchArray,list:ReturnType<typeof readPdfPageList>)=>{
    const index=match.index??0;
    const suffix=list.tail.split(/[。；;！？!?，,\n]|\.(?=\s|$)/u,1)[0];
    const clause=match[0]+' '+suffix;
    const mentioned=namesIn(clause).flat();
    const ids=[...new Set(mentioned.filter(file=>pdfIds.has(file.id)).map(file=>file.id))];
    const binding={index,ranges:list.ranges,invalid:list.invalid,visual:/目视|按图片|\bvisually[ \t]+inspect\b/i.test(match[0])};
    if(ids.length)return {...binding,ids,confirm:ids.length>1};
    const namedPdf= /[^\s。；;，,]+\.pdf\b/iu.test(clause);
    if(mentioned.length&&!namedPdf)return;
    if(namedPdf||files.length>1)return {...binding,ids:[...pdfIds],confirm:true};
    if(attachments.length===1||/\bpdf\b/i.test(clause))return {...binding,ids:[files[0].id],confirm:false};
  };
  const chinese=[...request.matchAll(/(?:^|[。；;，,\n])[ \t]*(?:(?:本次|这次|请)[ \t]*){0,2}(?:(?:(?:只|仅)[ \t]*)?(?:目视|按图片)[ \t]*(?:读取|阅读|核对|查看|检查|读|看)|(?:只|仅)[ \t]*(?:读取|阅读|核对|查看|检查|读|看))[^。；;，,\n]{0,32}?(?:前[ \t]*([1-9]\d*)[ \t]*页|第[ \t]*([1-9]\d*)(?:[ \t]*(?:页[ \t]*)?(?:至|到|[-–—])[ \t]*第?[ \t]*([1-9]\d*))?(?:[ \t]*页|(?=[ \t]*(?:、|，|,|和|与|及|以及)[ \t]*(?:第[ \t]*)?[1-9]\d*[^。；;\n]{0,32}页)))/gu)];
  const english=[...request.matchAll(/(?:^|[.;,\n])[ \t]*(?:please[ \t]+)?(?:only[ \t]+(?:read|check|review)|(?:read|check|review)[ \t]+only|visually[ \t]+inspect)[ \t]+(?:the[ \t]+)?(?:first[ \t]+([1-9]\d*)[ \t]+pages?\b|pages?[ \t]+([1-9]\d*)\b(?:[ \t]*(?:to|[-–—])[ \t]*([1-9]\d*)\b)?|([1-9]\d*)(?:st|nd|rd|th)[ \t]+page\b)/gi)];
  const tailAfter=(match:RegExpMatchArray)=>request.slice((match.index??0)+match[0].length);
  const ranges=[
    ...chinese.map(match=>{
      const [,first,start,end]=match;
      return bind(match,readPdfPageList({from:first?1:Number(start),to:Number(first??end??start)},
        tailAfter(match),CHINESE_PDF_LIST_ITEM,CHINESE_WIDER_PDF));
    }),
    ...english.map(match=>{
      const [,first,start,end,ordinal]=match;
      return bind(match,readPdfPageList({from:first?1:Number(start??ordinal),to:Number(first??end??start??ordinal)},
        tailAfter(match),ENGLISH_PDF_LIST_ITEM,ENGLISH_WIDER_PDF));
    }),
  ];
  const bindings=ranges.flatMap(range=>range?[range]:[]).sort((a,b)=>a.index-b.index);
  const removed=new Set<string>();
  for(const [index,{ranges,ids,confirm,invalid,visual}] of bindings.entries()){
    if(invalid||ranges.some(({from,to})=>!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>to||to>1_000_000))
      return {pdfRanges,pdfVisualRanges,confirmedPdfChoices,pdfScopeConflict:true};
    let selected=ids[0];
    if(confirm){
      const planned=mergePdfRanges(ranges);
      const pages=(planned.windows??[planned]).map(({from,to})=>from===to?String(from):from+'–'+to).join('、');
      const question=bindings.length===1?PDF_SELECTION_QUESTION:`选择第 ${pages} 页对应的 PDF（第 ${index+1} 处）`;
      const answer=[...questions].reverse().find(q=>q.question===question&&q.answeredAt)?.answer?.trim();
      const name=answer?.replace(/(\.pdf)\((\d+)\)/gi,'$1（$2）');
      const choices=taskPdfChoices(attachments,ids).filter(({label})=>label===name);
      if(choices.length!==1)return {pdfRanges,pdfVisualRanges,confirmedPdfChoices,pdfChoice:{question,ids}};
      selected=choices[0].file.id;
      for(const id of ids)if(id!==selected)removed.add(id);
    }
    const previous=pdfRanges.get(selected);
    pdfRanges.set(selected,mergePdfRanges([...(previous?.windows??(previous?[previous]:[])),...ranges]));
    if(visual){
      const priorVisual=pdfVisualRanges.get(selected);
      pdfVisualRanges.set(selected,mergePdfRanges([...(priorVisual?.windows??(priorVisual?[priorVisual]:[])),...ranges]));
    }
  }
  for(const id of removed)if(!pdfRanges.has(id))confirmedPdfChoices.add(id);
  return {pdfRanges,pdfVisualRanges,confirmedPdfChoices};
}

function worksheetRowsAt(text:string,english:boolean){
  const row=english
    ? /^[ \t]*rows?[ \t]+([1-9]\d*)(?:[ \t]*(?:to|[-–—])[ \t]*([1-9]\d*))?\b/i
    : /^[ \t]*(?:的[ \t]*)?第[ \t]*([1-9]\d*)(?:[ \t]*(?:行[ \t]*)?(?:至|到|[-–—])[ \t]*第?[ \t]*([1-9]\d*))?(?:[ \t]*行|(?=[ \t]*(?:、|，|,|和|及|与)[ \t]*(?:第[ \t]*)?[1-9]\d*[^。；\n]{0,28}行))/u;
  const first=row.exec(text);
  if(!first)return {ranges:[],invalid:(english?/^[ \t]*rows?[ \t]+[0-9]/i:/^[ \t]*(?:的[ \t]*)?第[ \t]*[0-9][^。；\n]{0,32}行/u).test(text)};
  const item=english
    ? /^[ \t]*(?:,[ \t]*(?:and[ \t]+)?|and[ \t]+)(?:rows?[ \t]+)?([1-9]\d*)(?:[ \t]*(?:to|[-–—])[ \t]*([1-9]\d*))?\b/i
    : /^[ \t]*(?:、|和|及|与|，|,)[ \t]*(?:第[ \t]*)?([1-9]\d*)(?:[ \t]*(?:行[ \t]*)?(?:至|到|[-–—])[ \t]*第?[ \t]*([1-9]\d*))?(?:[ \t]*行|(?=[ \t]*(?:、|，|,|和|及|与)[ \t]*(?:第[ \t]*)?[1-9]\d*[^。；\n]{0,28}行))/u;
  const ranges=[{from:Number(first[1]),to:Number(first[2]??first[1])}];
  let rest=text.slice(first[0].length);
  for(let next=item.exec(rest);next;next=item.exec(rest)){
    ranges.push({from:Number(next[1]),to:Number(next[2]??next[1])});
    rest=rest.slice(next[0].length);
  }
  const invalid=ranges.some(({from,to})=>!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>to||to>1_048_576)
    ||/^[ \t]*(?:至|到|和|与|及|或|[、，,–—/-]|and\b|or\b|to\b|through\b)[ \t]*(?:第[ \t]*|rows?[ \t]+)?[0-9]/i.test(rest);
  return {ranges,invalid};
}

export function requestedWorkbookWorksheet(attachments:AgentTaskView['attachments']=[],instructions='',questions:readonly AgentTaskQuestion[]=[]) {
  const request=splitTaskRequest(instructions);
  const workbooks=taskWorkbookChoices(attachments);
  if(!workbooks.length)return;
  const chinese=[...request.matchAll(/(?:^|[。；;\n])[ \t]*(?:(?:本次|这次|请)[ \t]*){0,2}(?:只|仅)[ \t]*(?:读取|阅读|核对|查看|检查|读|看)([^。；;，,\n]{0,48}?)(?:[「“]([^」”\n]{1,31})[」”][ \t]*工作表|工作表[ \t]*[「“"]([^」”"\n]{1,31})[」”"]|工作表[ \t]*[：:][ \t]*([^。；;，,\n]{1,31})(?=[。；;，,\n]|$))/gu)];
  const english=[...request.matchAll(/(?:^|[.;\n])[ \t]*(?:please[ \t]+)?(?:only[ \t]+(?:read|check|review)|(?:read|check|review)[ \t]+only)[ \t]+(?:the[ \t]+)?worksheet[ \t]+["“]([^"”\n]{1,31})["”]/gi)];
  const names=new Set([...chinese.map(match=>match[2]??match[3]??match[4].trim()),...english.map(match=>match[1])]);
  if(names.size!==1)return;
  const [worksheet]=names;
  if(!worksheet)return;
  const rowBindings=[
    ...chinese.map(match=>worksheetRowsAt(request.slice((match.index??0)+match[0].length),false)),
    ...english.map(match=>worksheetRowsAt(request.slice((match.index??0)+match[0].length),true)),
  ];
  const values=rowBindings.flatMap(binding=>binding.ranges);
  const rowScopeConflict=rowBindings.some(binding=>binding.invalid);
  const merged=values.length&&!rowScopeConflict?mergePdfRanges(values):undefined;
  const rows=merged?(merged.windows??[{from:merged.from,to:merged.to}]):undefined;
  const selection={worksheet,rows,rowScopeConflict};

  const workbookIds=workbooks.map(({file})=>file.id);
  const aliases=[...new Set(workbooks.flatMap(({file,label})=>[file.name,label]))].sort((a,b)=>b.length-a.length);
  const pattern=new RegExp('(?<![\\w./-])(?:'+aliases.map(escapeAttachmentName).join('|')+')(?![\\w./-]|[（(]\\d+)','gu');
  const normalizeLabel=(value:string)=>value.replace(/(\.xlsx)\((\d+)\)/gi,'$1（$2）');
  const subjects=chinese.map(match=>normalizeLabel(match[1]));
  const candidates=new Set<string>();
  let unknownWorkbook=false;
  for(const subject of subjects){
    const matches=[...subject.matchAll(pattern)].map(match=>match[0]);
    if(!matches.length&&/\.xlsx(?:[（(]|\b)/i.test(subject))unknownWorkbook=true;
    for(const token of matches){
      for(const {file,label} of workbooks)if(token===label||token===file.name)candidates.add(file.id);
    }
  }
  if(!unknownWorkbook&&candidates.size===1)return {fileId:[...candidates][0],...selection,workbookIds};
  if(!unknownWorkbook&&!candidates.size&&workbooks.length===1)return {fileId:workbooks[0].file.id,...selection,workbookIds};
  const answer=[...questions].reverse().find(q=>q.question===WORKBOOK_SELECTION_QUESTION&&q.answeredAt)?.answer?.trim();
  const matching=answer?workbooks.filter(item=>item.label===normalizeLabel(answer)):[];
  return {fileId:matching.length===1?matching[0].file.id:undefined,...selection,workbookIds};
}

const SKIP_READ_ZH = /(?:不要|请勿|无需|不|勿)(?:再)?(?:读取|阅读|核对|查看|检查|处理|读|看)/.source;
const OTHER_FILES_ZH = /(?:其他|其它|其余|剩余)的?(?:附件|文件)(?!夹|名)/.source;
const EXCLUDE_ALL_FILES = new RegExp(SKIP_READ_ZH+'[ \t]*(?:任何|全部)附件','u');
const EXCLUDE_OTHER_FILES = new RegExp(
  SKIP_READ_ZH+'[ \t]*(?:任何)?'+OTHER_FILES_ZH+'|'+OTHER_FILES_ZH+'[ \t]*(?:均|都|一律)?'+SKIP_READ_ZH,'u',
);
const SKIP_FILE_READ = new RegExp(SKIP_READ_ZH+String.raw`|\b(?:do not|don't|never) (?:read|open|check|review|inspect)\b`,'iu');

/**
 * Explicit negatives apply to the entire task attachment set. A page or worksheet limit on
 * its own still allows the task to check other requested sources.
 */
function requestedPdfVisualRanges(instructions:string,pdfRanges:ReadonlyMap<string,PdfPageScope>,pdfVisualRanges:ReadonlyMap<string,PdfPageScope>){
  const request=splitTaskRequest(instructions);
  if(!/目视|按图片|看图|用\s*OCR|进行\s*OCR|\b(?:visually inspect|use OCR)\b/i.test(request)
    ||/(?:不要|禁止|无需|不用|不必|不需要)\s*(?:(?:用|使用|进行)\s*)?(?:目视|按图片|看图|OCR)|\b(?:do not|don't|without)\s+(?:(?:use|perform)\s+)?(?:OCR|visually inspect)\b/i.test(request))
    return new Map<string,PdfPageScope>();
  return pdfVisualRanges.size?pdfVisualRanges:pdfRanges.size===1?pdfRanges:new Map<string,PdfPageScope>();
}

function visualPageCount(ranges:ReadonlyMap<string,PdfPageScope>){
  return [...ranges.values()].reduce((total,scope)=>total+(scope.windows??[scope]).reduce((n,range)=>n+range.to-range.from+1,0),0);
}

function selectVisualPdfPages(attachments:AgentTaskView['attachments'],instructions:string,questions:readonly AgentTaskQuestion[],
  pdfRanges:Map<string,PdfPageScope>,pdfVisualRanges:Map<string,PdfPageScope>,
):{question?:string;candidates?:PdfVisualCandidate[];excluded:Set<string>}{
  const requested=requestedPdfVisualRanges(instructions,pdfRanges,pdfVisualRanges),excluded=new Set<string>();
  if(visualPageCount(requested)<=PDF_VISUAL_PAGE_LIMIT)return {excluded};
  const labels=taskAttachmentLabels(attachments??[]);
  const entries=(attachments??[]).flatMap((file,index)=>{
    const scope=requested.get(file.id);
    return scope?[{id:file.id,label:labels[index],windows:scope.windows??[scope]}]:[];
  });
  const listing=entries.map(entry=>entry.label+' '+entry.windows.map(({from,to})=>from===to?'第 '+from+' 页':'第 '+from+' 至 '+to+' 页').join('、')).join('\n');
  const question='本轮目视核对最多 3 页。请从下列页码中选择。'+(entries.length===1?'可回复“3、5”。':'请在页码前写文件名，每个文件一行。')+'\n'+listing;
  const candidates=entries.flatMap(entry=>entry.windows.map(({from,to})=>({fileId:entry.id,from,to})));
  const pending={question,candidates,excluded};
  const answer=[...questions].reverse().find(item=>item.question===question&&item.answeredAt)?.answer?.trim();
  if(!answer)return pending;
  const chosen=new Map<string,Set<number>>();
  for(const part of answer.split(/[；;\n]+/).map(value=>value.trim()).filter(Boolean)){
    const named=entries.find(entry=>part.startsWith(entry.label)&&/^[ \t:：第]/u.test(part.slice(entry.label.length)));
    const source=named??(entries.length===1?entries[0]:undefined);
    if(!source)return pending;
    const text=named?part.slice(named.label.length).replace(/^[ \t:：]+/,''):part;
    const pages=chosen.get(source.id)??new Set<number>();
    for(const piece of text.split(/[、,，和及]+/u).map(value=>value.trim())){
      const match=/^(?:第[ \t]*)?([1-9]\d{0,6})[ \t]*(?:页)?(?:[ \t]*(?:至|到|[-–—])[ \t]*第?[ \t]*([1-9]\d{0,6})[ \t]*(?:页)?)?$/u.exec(piece);
      if(!match)return pending;
      const first=Number(match[1]),last=Number(match[2]??match[1]);
      if(last<first||last-first+1>PDF_VISUAL_PAGE_LIMIT)return pending;
      for(let page=first;page<=last;page++){
        if(!source.windows.some(range=>page>=range.from&&page<=range.to))return pending;
        pages.add(page);
      }
    }
    chosen.set(source.id,pages);
  }
  const count=[...chosen.values()].reduce((sum,pages)=>sum+pages.size,0);
  if(!count||count>PDF_VISUAL_PAGE_LIMIT)return pending;
  pdfVisualRanges.clear();
  for(const source of entries){
    const previous=pdfRanges.get(source.id)!;
    let remainder=[...(previous.windows??[previous])];
    for(const visual of source.windows){
      remainder=remainder.flatMap(range=>{
        if(range.to<visual.from||range.from>visual.to)return [range];
        return [
          ...(range.from<visual.from?[{from:range.from,to:visual.from-1}]:[]),
          ...(range.to>visual.to?[{from:visual.to+1,to:range.to}]:[]),
        ];
      });
    }
    const keep=[...(chosen.get(source.id)??[])].map(page=>({from:page,to:page}));
    if(keep.length)pdfVisualRanges.set(source.id,mergePdfRanges(keep));
    if(remainder.length||keep.length)pdfRanges.set(source.id,mergePdfRanges([...remainder,...keep]));
    else{pdfRanges.delete(source.id);excluded.add(source.id);}
  }
  return {excluded};
}

export function requestedTaskAttachmentScope(attachments:AgentTaskView['attachments']=[],instructions='',questions:readonly AgentTaskQuestion[]=[]) {
  const {pdfRanges,pdfVisualRanges,pdfChoice,pdfScopeConflict,confirmedPdfChoices}=pdfSelection(attachments,instructions,questions);
  const worksheet = requestedWorkbookWorksheet(attachments,instructions,questions);
  const request = splitTaskRequest(instructions);
  const allExcluded = EXCLUDE_ALL_FILES.test(request)
    || /\b(?:do not|don't|never) (?:read|open|check|review|inspect) (?:any|all) attachments\b/iu.test(request);
  const othersExcluded = EXCLUDE_OTHER_FILES.test(request)
    || /\b(?:do not|don't|never) (?:read|open|check|review|inspect) (?:any )?(?:other|remaining) (?:attachments|files)\b/iu.test(request);
  if(allExcluded)return {pdfRanges:new Map<string,PdfPageScope>(),pdfVisualRanges:new Map<string,PdfPageScope>(),worksheet:undefined,allowedFiles:new Set<string>(),pdfVisualChoice:undefined,pdfVisualCandidates:undefined};
  const visualSelection=pdfChoice||pdfScopeConflict?undefined:selectVisualPdfPages(attachments,instructions,questions,pdfRanges,pdfVisualRanges);
  const pdfVisualChoice=visualSelection?.question;
  const pdfVisualCandidates=visualSelection?.candidates;
  const scopedNames=new Set(attachments.filter(file=>pdfRanges.has(file.id)).map(file=>file.name));
  const siblings=attachments.filter(file=>!pdfRanges.has(file.id)&&(scopedNames.has(file.name)||confirmedPdfChoices.has(file.id)));
  if(!othersExcluded&&!siblings.length&&!visualSelection?.excluded.size)return {pdfRanges,pdfVisualRanges,worksheet,pdfChoice,pdfScopeConflict,pdfVisualChoice,pdfVisualCandidates};

  const allowed=new Set(pdfRanges.keys());
  if(worksheet?.fileId)allowed.add(worksheet.fileId);
  const namesIn=taskAttachmentNames(attachments);
  const affirmative = /(?:^|[。！？；;!?\n]|\.[ \t]+)[ \t]*(?:(?:本次|这次|请|也|再)[ \t]*){0,2}(?:(?:只|仅)?(?:读取|阅读|核对|查看|检查|处理|读|看)|(?:please[ \t]+)?(?:only[ \t]+)?(?:read|open|check|review|inspect)(?:[ \t]+only)?\b)(?:(?!\.[ \t])[^。！？；;!?，,\n])+/giu;
  for(const clause of request.matchAll(affirmative)){
    for(const match of namesIn(clause[0].split(SKIP_FILE_READ,1)[0])){
      if(match.length===1&&!worksheet?.workbookIds.includes(match[0].id))allowed.add(match[0].id);
    }
  }
  if(!othersExcluded){
    const excludedSiblings=[...siblings.filter(file=>!allowed.has(file.id)).map(file=>file.id),...(visualSelection?.excluded??[])];
    return {pdfRanges,pdfVisualRanges,worksheet,pdfChoice,pdfScopeConflict,pdfVisualChoice,pdfVisualCandidates,excludedPdfIds:excludedSiblings.length?new Set(excludedSiblings):undefined};
  }
  for(const id of visualSelection?.excluded??[])allowed.delete(id);
  return {pdfRanges,pdfVisualRanges,worksheet,pdfChoice,pdfScopeConflict,pdfVisualChoice,pdfVisualCandidates,allowedFiles:allowed};
}

/** Older receipts without the requested scope cannot inform a new model turn. */
export function explicitPdfVisualPages(instructions:string,pdfRanges:ReadonlyMap<string,PdfPageScope>,pdfVisualRanges:ReadonlyMap<string,PdfPageScope>){
  const requested=requestedPdfVisualRanges(instructions,pdfRanges,pdfVisualRanges);
  if(visualPageCount(requested)>PDF_VISUAL_PAGE_LIMIT)return [];
  const windows=[...requested].map(([fileId,range])=>({fileId,ranges:range.windows??[range]}));
  return windows.map(({fileId,ranges})=>({fileId,
    pages:ranges.flatMap(range=>Array.from({length:range.to-range.from+1},(_,index)=>range.from+index)),
  }));
}

export function scopedAttachmentTaskSteps(steps:PlatformTaskStep[],pdfRanges:ReadonlyMap<string,PdfPageScope>,
  worksheetScope:ReturnType<typeof requestedWorkbookWorksheet>,allowedFiles?:ReadonlySet<string>,excludedPdfIds?:ReadonlySet<string>):PlatformTaskStep[] {
  if(!pdfRanges.size&&!worksheetScope&&!allowedFiles&&!excludedPdfIds)return steps;
  const eligible=steps.filter(step=>{
    const read=step.result as (PdfReadWindow&{worksheetScope?:string;worksheetRowScope?:readonly PdfPageRange[];sheets?:string[];observedSheets?:string[];attachmentScopeRereadRequired?:boolean;pdfScopeRereadRequired?:boolean;excludedAttachmentHistoryDiscarded?:boolean})|undefined;
    if(read?.excludedAttachmentHistoryDiscarded===true)return false;
    if(step.plan.name==='bambook_task'&&step.plan.arguments.action==='finish'
      &&(read?.pdfScopeRereadRequired===true||read?.attachmentScopeRereadRequired===true))return false;
    if(step.plan.name!=='bambook_file_text'||step.result===undefined)return true;
    const fileId=step.plan.arguments.fileId;
    if(typeof fileId==='string'&&(excludedPdfIds?.has(fileId)||allowedFiles&&!allowedFiles.has(fileId)))return false;
    const workbookInScope=typeof fileId==='string'&&worksheetScope?.workbookIds.includes(fileId);
    const pdfScope=typeof fileId==='string'?pdfRanges.get(fileId):undefined;
    if(typeof fileId!=='string'||!workbookInScope&&!pdfScope)return true;
    if(read?.error===true||read?.kind==='unreadable'||read?.kind==='unsupported')return !read.text;
    if(workbookInScope&&worksheetScope)return !worksheetScope.rowScopeConflict&&fileId===worksheetScope.fileId&&read?.kind==='xlsx'&&read.file?.id===fileId
      &&read.worksheetScope===worksheetScope.worksheet
      &&(!worksheetScope.rows||JSON.stringify(read.worksheetRowScope)===JSON.stringify(worksheetScope.rows))
      &&Array.isArray(read.sheets)&&read.sheets.length===1&&read.sheets[0]===worksheetScope.worksheet
      &&Array.isArray(read.observedSheets)&&read.observedSheets.every(name=>name===worksheetScope.worksheet);
    if(!pdfScope)return false;
    const range=read?.range;
    if(pdfScope.windows){
      const windows=read?.pageScopeWindows;
      return read?.kind==='pdf'&&read.file?.id===fileId&&!!range
        &&Number.isSafeInteger(range.pageFrom)&&Number.isSafeInteger(range.pageTo)&&range.pageFrom<=range.pageTo
        &&pdfScope.windows.some(window=>window.from<=range.pageFrom&&range.pageTo<=window.to)
        &&typeof read.pages==='number'&&Number.isSafeInteger(read.pages)&&range.pageTo<=read.pages
        &&Array.isArray(windows)&&windows.length===pdfScope.windows.length
        &&pdfScope.windows.every((window,index)=>window.from===windows[index]?.from&&window.to===windows[index]?.to);
    }
    return !read?.pageScopeWindows&&read?.kind==='pdf'&&read.file?.id===fileId&&!!range
      &&Number.isSafeInteger(range.pageFrom)&&Number.isSafeInteger(range.pageTo)
      &&range.pageFrom>=pdfScope.from&&range.pageTo>=range.pageFrom&&range.pageTo<=pdfScope.to
      &&(pdfScope.from===1||read.pageScopeStart===pdfScope.from)
      &&typeof read.pages==='number'&&Number.isSafeInteger(read.pages)
      &&(read.pages<=pdfScope.to||read.pageScopeLimit===pdfScope.to);
  });
  // Old checkpoints can summarize excluded reads. They must not reintroduce those facts.
  return eligible.length===steps.length?eligible:eligible.filter(step=>step.plan.name!=='bambook_task'||step.plan.arguments.action!=='checkpoint');
}

/** Fetch a few adjacent cursor windows before asking the model about a disjoint selection. */
export function shortDisjointPdfContinuationPlan(pdfRanges:ReadonlyMap<string,PdfPageScope>,steps:PlatformTaskStep[]):PlatformTaskPlan|undefined {
  for(const [fileId,scope] of pdfRanges){
    if(!scope.windows)continue;
    const reads=steps.filter(step=>step.plan.name==='bambook_file_text'&&step.plan.arguments.fileId===fileId);
    if(!reads.length||reads.length>=4)continue;
    const last=reads.at(-1)!;
    const read=last.result as PdfReadWindow|undefined;
    if(last.compacted||read?.error||read?.kind!=='pdf'||read.file?.id!==fileId||!read.hasMore||!isFileTextCursor(read.nextCursor))continue;
    return {name:'bambook_file_text',arguments:{fileId,cursor:read.nextCursor,maxChars:ATTACHMENT_PREFETCH_CHARS}};
  }
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
  text?:string; pageTextSpans?:PdfPageTextSpan[]; pageScopeStart?:number; pageScopeLimit?:number; pageScopeWindows?:PdfPageRange[];
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
    if(step.compacted||read?.error||read?.kind!=='pdf'||read.pageScopeWindows||read.file?.id!==fileId||typeof read.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(read.sourceHash)
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
    sha256?:string;notice?:string;kind?:string;nextCursor?:unknown;text?:string;pageTextSpans?:PdfPageTextSpan[];observedSheetRows?:Array<{sheet:string;row:number;start:number;end:number}>;
  };
  const cursor=typeof read.nextCursor==='string'?{nextCursor:'next'}:{};
  if(read.kind==='xlsx'&&typeof read.text==='string'&&read.observedSheetRows?.length){
    const {text,observedSheetRows,...metadata}=read;
    let previous=0;
    const numbered:string[]=[];
    for(const row of observedSheetRows){
      if(row.start<previous||row.end>text.length||row.start>=row.end)return {...read,...cursor};
      numbered.push(text.slice(previous,row.start),'工作表 '+row.sheet+' 第 '+row.row+' 行：',text.slice(row.start,row.end));
      previous=row.end;
    }
    numbered.push(text.slice(previous));
    return {...metadata,...cursor,text:numbered.join('')};
  }
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
