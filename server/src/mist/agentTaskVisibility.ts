import { createHash } from 'node:crypto';
import type { MistState } from '../shared/mistWorkspace';
import { SCOPED_COLLECTIONS, type MistDataScope } from '../shared/mistDataScope';
import { AGENT_OBJECT_TYPES } from './agentRead';
import { fail } from './errors';

export type TaskSourceRef = { path: string; id: string; partial: boolean; coverage: string[]; observedRevision?:number; fieldRevisions?:Record<string,number> };
const PATHS = [...new Set<string>([...SCOPED_COLLECTIONS, 'customers','contacts','fabrics','files','market.products','market.suppliers','market.relations','email.accounts','email.messages'])];
const PARTIAL: Record<string,string> = { 'orderCosts.expenses':'partialExpenses','payables.bills':'partialPayableBills','receipts':'partialReceipts','customerStatements':'partialStatements','letterOfCredits':'partialLettersOfCredit' };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function ordered(v: any): any { return Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])) : v; }
export function taskScopeHash(scope?: MistDataScope, state?: MistState) {
  return hash(ordered({ scope: scope ? { users:[...scope.userIds].sort(),teams:[...scope.teamIds].sort(),lines:[...(scope.lines??[])].sort() } : null, configurations: scope ? (state?.teamScopes??[]).filter(s=>scope.teamIds.includes(s.teamId)).map(s=>({teamId:s.teamId,conditions:s.conditions,picks:s.picks,exclusions:s.exclusions})).sort((a,b)=>a.teamId.localeCompare(b.teamId)) : [] }));
}
function rows(state: MistState, path: string): Array<{row:any;partial:boolean}> {
  let value: any = state; for(const key of path.split('.'))value=value?.[key];
  const full = Array.isArray(value)?value.filter(r=>r&&typeof r.id==='string'):[];
  const partial = (state as any)[PARTIAL[path]];
  return [...full.map(row=>({row,partial:false})),...(Array.isArray(partial)?partial.filter(r=>r&&typeof r.id==='string'&&!full.some(f=>f.id===r.id)).map(row=>({row,partial:true})):[])];
}
/** A partial ledger's source IDs define the permitted slice; its numeric values do not. */
function coverage(value:any,key='',set=new Set<string>()):string[]{
  if(typeof value==='string'&&(key==='id'||key.endsWith('Id')||key.endsWith('Ids')))set.add(value);
  else if(Array.isArray(value))value.forEach(v=>coverage(v,key,set));
  else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))coverage(v,k,set);
  return [...set].sort();
}
function index(state: MistState) {
  const byPath = new Map<string,Map<string,any>>(), byId = new Map<string,string[]>();
  for(const path of PATHS){const map=new Map<string,any>();for(const item of rows(state,path)){map.set(item.row.id,item);byId.set(item.row.id,[...byId.get(item.row.id)??[],path]);}byPath.set(path,map);}
  return {byPath,byId};
}
export function taskSourcesVisible(refs: TaskSourceRef[], scopeHash: string, current: MistState, raw: MistState, scope?: MistDataScope) {
  if(scopeHash!==taskScopeHash(scope,raw))return false;
  const visible=index(current);
  return refs.every(ref=>{const item=visible.byPath.get(ref.path)?.get(ref.id);if(!item||!ref.partial&&item.partial)return false;if(!item.partial)return true;const allowed=new Set(coverage(item.row));return ref.coverage.every(id=>allowed.has(id));});
}
/** Required typed object references are rechecked; incidental IDs inside a visible email are not authority. */
export function collectTaskSources(data: unknown, current: MistState, previous: TaskSourceRef[]): TaskSourceRef[] {
  const visible=index(current), found=new Map(previous.map(r=>[r.path+'\0'+r.id,r]));
  const envelope=data as any,revision=Number.isSafeInteger(envelope?.revision)?envelope.revision:Number.isSafeInteger(envelope?.workspace?.revision)?envelope.workspace.revision:undefined;
  const full=envelope?.object?.data&&!envelope.object.truncated?envelope.object:null;
  const add=(path:string,id:string,required=false,type?:string)=>{const item=visible.byPath.get(path)?.get(id);if(!item){if(required)fail('AGENT_TASK_SCOPE_CHANGED','任务来源已不可见，请重新安排任务',403);return;}const prior=found.get(path+'\0'+id),freshFull=required&&revision!==undefined&&full?.id===id&&full?.type===type,observed=required&&revision!==undefined&&(prior?.observedRevision===undefined||freshFull)?revision:prior?.observedRevision;const ref:TaskSourceRef={path,id,partial:item.partial,coverage:item.partial?coverage(item.row):[],...(observed!==undefined?{observedRevision:observed}:{}),...(!freshFull&&prior?.fieldRevisions?{fieldRevisions:prior.fieldRevisions}:{})};found.set(path+'\0'+id,ref);};
  const walk=(v:any)=>{
    if(typeof v==='string'){const id=v.startsWith('i:')?v.slice(2):v;for(const path of visible.byId.get(id)??[])add(path,id);return;}
    if(Array.isArray(v)){v.forEach(walk);return;}
    if(v&&typeof v==='object'){
      if(typeof v.type==='string'&&typeof v.id==='string'){const type=AGENT_OBJECT_TYPES.find(t=>t.type===v.type);if(type)add(type.path.join('.'),v.id,true,type.type);}
      for(const [key,value]of Object.entries(v)){walk(key);walk(value);}
    }
  };
  walk(data);
  if(found.size>1500||[...found.values()].reduce((n,r)=>n+r.coverage.length,0)>5000)fail('AGENT_TASK_LIMIT','任务来源过多，请拆分任务',422);
  return [...found.values()];
}
