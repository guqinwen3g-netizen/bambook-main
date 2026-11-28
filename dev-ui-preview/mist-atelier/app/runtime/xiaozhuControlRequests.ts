import { submissionFileIdentity } from './xiaozhuSubmissions';

export type TaskControlIntent = {action:'answer';questionId:string;answer:string;files?:readonly File[]} | {action:'cancel'|'resume'};
export type TaskStateAction = 'pause'|'resume'|'cancel';
type ControlRecord = {version:number;requestId:string};
export type TaskControlRequest = ControlRecord & (
  | {action:'answer';questionId:string;answer?:string;fingerprint?:string;hasAttachments?:true;restoredFromStorage?:true}
  | {action:TaskStateAction}
);

const storageKey = (scope:string) => 'mist.xiaozhu.controls:' + scope;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const isId = (value:unknown): value is string => typeof value==='string'&&value.length>0&&value.length<=100;

/** Keep answer text in the page. The tab only stores a digest to match a verified read or exact retry. */
export async function answerFingerprint(taskId:string,questionId:string,answer:string,files:readonly File[]=[]): Promise<string|undefined> {
  try {
    const input:unknown[]=[taskId,questionId,answer];
    if(files.length)input.push(await submissionFileIdentity(files));
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
    return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  } catch { return; }
}

export function answerRequestBody(payload:ControlRecord&{questionId:string;answer:string},files:readonly File[]=[]):string|FormData {
  const json=JSON.stringify(payload);
  if(!files.length)return json;
  const form=new FormData();
  form.append('answer',json);
  files.forEach(file=>form.append('attachments',file));
  return form;
}

export function readTaskControls(scope:string): Map<string,TaskControlRequest> {
  const entries = new Map<string,TaskControlRequest>();
  if (!scope) return entries;
  try {
    const stored:unknown = JSON.parse(sessionStorage.getItem(storageKey(scope))??'[]');
    if (!Array.isArray(stored)) return entries;
    for (const [id,entry] of stored.slice(-90).filter(Array.isArray)) {
      if (!isId(id)||typeof entry?.requestId!=='string'||!uuidPattern.test(entry.requestId)
        ||!Number.isSafeInteger(entry.version)||entry.version<0) continue;
      const base={version:entry.version,requestId:entry.requestId};
      if(entry.action==='pause'||entry.action==='cancel'||entry.action==='resume') entries.set(id,{...base,action:entry.action});
      else if(entry.action==='answer'&&isId(entry.questionId)&&typeof entry.fingerprint==='string'&&fingerprintPattern.test(entry.fingerprint))
        entries.set(id,{...base,action:'answer',questionId:entry.questionId,fingerprint:entry.fingerprint,...(entry.hasAttachments===true?{hasAttachments:true,restoredFromStorage:true}:{})});
    }
  } catch { /* The page still supports in-memory recovery. */ }
  return entries;
}

export function saveTaskControls(scope:string, entries:ReadonlyMap<string,TaskControlRequest>) {
  if (!scope) return;
  try {
    const stored=[...entries].slice(-90).flatMap<[string,TaskControlRequest]>(([id,entry])=>{
      const base={requestId:entry.requestId,version:entry.version};
      if(entry.action!=='answer') return [[id,{...base,action:entry.action}]];
      if(!entry.fingerprint) return [];
      return [[id,{...base,action:'answer',questionId:entry.questionId,fingerprint:entry.fingerprint,...(entry.hasAttachments?{hasAttachments:true}:{})}]];
    });
    if(stored.length) sessionStorage.setItem(storageKey(scope),JSON.stringify(stored));
    else sessionStorage.removeItem(storageKey(scope));
  } catch { /* Storage can be unavailable. */ }
}
