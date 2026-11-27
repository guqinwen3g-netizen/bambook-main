import { createHash, randomUUID } from 'node:crypto';
import type {AgentTaskIntentRef,AgentTaskView} from '../shared/mistAgentTasks';
import type { MarketQuotation } from '../shared/mistMarket';
import type{ResponseLocale}from'./responseLanguage';

export type PlatformTaskPlan={name:string;arguments:Record<string,unknown>;progress?:string};
export type PlatformTaskStep={id:string;plan:PlatformTaskPlan;result?:unknown;at:string;completedAt?:string;compacted?:boolean};
export type PlatformTaskProgress={steps:PlatformTaskStep[];nextRunAt:number;modelFallbackAt?:number;requiresRead?:boolean;requiresReadBeforeWrite?:boolean;checkpointBeforeIssue?:string;retryAt?:number;failures?:number;issue?:'model_unavailable'|'model_response_invalid'};
export const PLATFORM_TASK_TURN_LIMIT=60;
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

/** Pre-read at most one short physical page window from the task's sole PDF attachment. */
export function shortPdfTailPlan(attachments: AgentTaskView['attachments'] = [], steps: PlatformTaskStep[]): PlatformTaskPlan | undefined {
  const pdfs = attachments.filter(file => file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name));
  if (pdfs.length !== 1) return;
  const [file] = pdfs;
  const reads = steps.filter(step => step.plan.name === 'bambook_file_text' && step.plan.arguments.fileId === file.id);
  if (reads.length !== 1) return;
  const [initial] = reads;
  const result = initial.result as {
    kind?: string; error?: boolean; pages?: number; hasMore?: boolean;
    range?: { pageFrom?: number; pageTo?: number }; nextPageFrom?: number; nextCursor?: unknown;
  } | undefined;
  if (initial.compacted || initial.plan.arguments.cursor !== undefined || result?.error || result?.kind !== 'pdf'
    || typeof result.pages !== 'number' || !Number.isInteger(result.pages) || result.pages < 21 || result.pages > 24
    || result.range?.pageFrom !== 1 || result.range.pageTo !== 20 || result.hasMore !== true
    || result.nextPageFrom !== 21 || typeof result.nextCursor !== 'string' || !result.nextCursor.startsWith('aft1.')) return;
  return {name:'bambook_file_text',arguments:{fileId:file.id,cursor:result.nextCursor,maxChars:3500}};
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
  if (last?.compacted || result?.hasMore !== true || typeof result.nextCursor !== 'string' || !result.nextCursor.startsWith('aft1.')) return resolved;
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
    const window=fileRead?step.result as {nextCursor?:unknown}|undefined:undefined;
    const displayedResult=typeof window?.nextCursor==='string'?{...window,nextCursor:'next'}:step.result;
    const args=fileRead&&typeof step.plan.arguments.cursor==='string'?{...step.plan.arguments,cursor:'next'}:step.plan.arguments;
    const result=duplicateOf?{duplicateOf,readHint:'此读取的参数和完整结果与所引用步骤相同，请查看该步骤回执。'}:displayedResult;
    const amounts = !duplicateOf && !step.compacted && step.plan.name === 'bambook_get' && step.plan.arguments.type === 'quotation'
      ? quotationAmountScope(step.result) : undefined;
    const item={operationId:step.id,name:step.plan.name,arguments:args,result,compacted:step.compacted,...(amounts ? { quotationAmountScope: amounts } : {})},size=JSON.stringify(item).length;
    if(size>remaining)break;
    recent.unshift(item);remaining-=size;
    if(key&&!duplicateOf)readResults.set(key,step.id);
  }
  return{recent,omitted:steps.filter(s=>s.result!==undefined).length-recent.length,operations:steps.map(s=>({operationId:s.id,name:s.plan.name,completed:s.result!==undefined}))};
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
