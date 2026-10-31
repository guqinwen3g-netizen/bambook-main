import type { TokenPayload } from '../auth/service';
import { createHash } from 'node:crypto';
import { hasScope } from '../auth/permissionService';
import type { MistState } from '../shared/mistWorkspace';
import type { AgentAuditDetail, AgentAuditEntry, AgentAuditVisibleChange } from '../shared/mistAgentAudit';
import { AGENT_AUDIT_FIELD_LABELS, agentAuditActionLabel } from '../shared/mistAgentAudit';
import { MIST_READ_SECTIONS } from './access';
import { AGENT_OBJECT_TYPES } from './agentRead';
import { AGENT_AUDIT_FIELD, AGENT_AUDIT_HASH, agentAuditReceiptId, redactAgentAuditValue, type AgentCommandAudit, type AgentAuditChange } from './agentAudit';

const plain = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v: any, k: string) => plain(v) && Object.prototype.hasOwnProperty.call(v, k);
function same(a:any,b:any):boolean {
  if(a===b)return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  if(plain(a)&&plain(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>own(b,k)&&same(a[k],b[k]));}
  return false;
}
/** A projected subtotal is not the original historical total. Keep only actual values still visible,
 * rather than presenting a newly derived partial value as a committed change. */
function visibleHistoricalValue(raw:any, projected:any):any {
  if(same(raw,projected))return projected;
  if(Array.isArray(raw)&&Array.isArray(projected))return projected.flatMap(item=>{
    const original=plain(item)&&typeof item.id==='string'?raw.find(v=>v?.id===item.id):raw.find(v=>same(v,item));
    if(original===undefined)return[];const value=visibleHistoricalValue(original,item);return value===undefined?[]:[value];
  });
  if(plain(raw)&&plain(projected))return Object.fromEntries(Object.keys(projected).flatMap(key=>{
    if(!own(raw,key))return[];const value=visibleHistoricalValue(raw[key],projected[key]);return value===undefined?[]:[[key,value]];
  }));
  return undefined;
}
const SYSTEM = new Set(['events', 'tasks', 'notifications', 'agentProposals', 'reviewerIds', 'schemaVersion']);
const PERSONAL = new Set(['calendar', 'files']);
const PRIMARY_TYPES:[string,string][]=[['payable.settlement.','payable_settlement'],['payable.bill.','payable_bill'],['payable.request.','payment_request'],['payable.payment.','supplier_payment'],['fulfillment.procurement.','purchase'],['market.quotation.','quotation'],['order.','order'],['production.','production'],['market.customer.','customer'],['customer.','customer'],['market.supplier.','supplier'],['development.','development'],['contact.','contact']];

/** Partial ledger projections deliberately live outside full collections. Reattach ONLY those
 * already-authorized header/line fields for delta comparison; never recreate hidden totals. */
function auditReadView(state:MistState):MistState {
  const next=structuredClone(state) as any;
  const add=(path:string[],rows:any[])=>{let parent=next;for(const key of path.slice(0,-1))parent=parent[key]??={};const key=path[path.length-1];parent[key]??=[];for(const row of rows)if(!parent[key].some((r:any)=>r.id===row.id))parent[key].push(row);};
  add(['payables','bills'],(state.partialPayableBills??[]).map(({hiddenCount,voided,...row})=>row));
  add(['orderCosts','expenses'],(state.partialExpenses??[]).map(({hiddenCount,voided,...row})=>row));
  add(['receipts'],(state.partialReceipts??[]).map(({hiddenCount,visibleAllocatedAmount,...row})=>row));
  add(['customerStatements'],(state.partialStatements??[]).map((row:any)=>({id:row.id,customerId:row.customerId,statementNo:row.statementNo,asOf:row.asOf,sections:row.sections.map((section:any)=>({currency:section.currency,lines:section.lines}))})));
  add(['letterOfCredits'],(state.partialLettersOfCredit??[]).map(({hiddenCount,cancelled,...row})=>row));
  return next;
}

/** For another actor, prove each original input value against this operation's visible primary
 * record. Unknown/ignored request fields are not company-wide business data. */
function evidencedInput(payload:Record<string,unknown>,contexts:any[]):Record<string,unknown>|undefined {
  const result:Record<string,unknown>={};
  for(const [key,value] of Object.entries(payload)){
    const values=contexts.flatMap(c=>[c,c?.confirmation,c?.approval,c?.reversed,c?.returned].filter(record=>own(record,key)).map(record=>record[key]));
    if(values.some(v=>same(v,value)))Object.defineProperty(result,key,{value,writable:true,enumerable:true,configurable:true});
    else if(['input','patch'].includes(key)&&plain(value)){const child=evidencedInput(value as Record<string,unknown>,contexts);if(child)Object.defineProperty(result,key,{value:child,writable:true,enumerable:true,configurable:true});}
  }
  return Object.keys(result).length?result:undefined;
}
const FIELDS=AGENT_AUDIT_FIELD_LABELS;
const bodyOf = (a: AgentCommandAudit) => a.command.type === 'agent.proposal.create' && plain(a.command.payload.command) ? a.command.payload.command as AgentCommandAudit['command'] : a.command;
export function agentAuditLabel(type: string) { return agentAuditActionLabel(type); }
export function auditFromReceipt(row: any, workspaceId: string): AgentCommandAudit | undefined {
  const a = row?.result?.[AGENT_AUDIT_FIELD];
  if (row?.workspaceId!==workspaceId || row?.inputHash !== AGENT_AUDIT_HASH || !a || a.schemaVersion !== 1 || a.workspaceId !== workspaceId || typeof a.requestId!=='string' || typeof a.actor?.name!=='string' || typeof a.actor?.id!=='string' || row.requestId !== agentAuditReceiptId(a.requestId) || row.actorId !== a.actor.id || !plain(a.command?.payload) || typeof a.command.type !== 'string' || !Array.isArray(a.changes) || typeof a.at!=='string' || !Number.isFinite(Date.parse(a.at))) return;
  if(a.command.type==='agent.proposal.create'&&(!plain(a.command.payload.command)||typeof a.command.payload.command.type!=='string'||!plain(a.command.payload.command.payload)))return;
  if (!['agent','human_confirmation','human_rejection'].includes(a.source) || !['executed','proposed','confirmed','rejected'].includes(a.phase) || ![a.requestedRevision,a.baseRevision,a.committedRevision].every(n => Number.isSafeInteger(n) && n >= 0)) return;
  if (a.changes.some((c: any) => !['add','remove','replace','reorder'].includes(c.operation) || !Array.isArray(c.path) || !c.path.length || c.path.length > 40 || c.path.some((p: any) => typeof p !== 'string' || !/^[ki]:.+/.test(p)))) return;
  return a;
}
export function auditMatchesParent(a:AgentCommandAudit,parent:any){return parent?.workspaceId===a.workspaceId&&parent.requestId===a.requestId&&parent.actorId===a.actor.id&&parent.expectedRevision===a.requestedRevision&&parent.result?.revision===a.committedRevision;}
export function auditEntry(a: AgentCommandAudit): AgentAuditEntry {
  const type = bodyOf(a).type;
  return { requestId:a.requestId,at:a.at,actor:a.actor,source:a.source,phase:a.phase,commandType:a.command.type,requestedCommandType:type,label:agentAuditLabel(type),agentSessionId:a.agentSessionId, ...(a.proposalId ? {proposalId:a.proposalId}:{}),requestedRevision:a.requestedRevision,baseRevision:a.baseRevision,committedRevision:a.committedRevision };
}
function read(root: any, path: string[]): any {
  let value = root;
  for (const part of path) {
    if (part.startsWith('k:')) value = own(value, part.slice(2)) ? value[part.slice(2)] : undefined;
    else value = Array.isArray(value) ? value.find(item => item?.id === part.slice(2)) : undefined;
  }
  return value;
}
function define(root: any, path: string[], present: boolean, value: any, position?: number) {
  let parent = root;
  for (let index = 0; index < path.length; index++) {
    const part = path[index], last = index === path.length - 1;
    if (part.startsWith('k:')) {
      if (!plain(parent)) return;
      const key = part.slice(2);
      if (last) { if (!present) delete parent[key]; else Object.defineProperty(parent,key,{value:structuredClone(value),writable:true,enumerable:true,configurable:true}); return; }
      if (!own(parent,key) || !parent[key] || typeof parent[key] !== 'object') Object.defineProperty(parent,key,{value:path[index+1].startsWith('i:')?[]:{},writable:true,enumerable:true,configurable:true});
      parent = parent[key];
    } else {
      if (!Array.isArray(parent)) return;
      const id = part.slice(2), found = parent.findIndex(item => item?.id === id);
      if (last) {
        if (found >= 0) parent.splice(found,1);
        if (present) parent.splice(Number.isSafeInteger(position)?Math.min(Math.max(position!,0),parent.length):parent.length,0,structuredClone(value));
        return;
      }
      if (found < 0) { parent.push({id}); parent=parent[parent.length-1]; } else parent=parent[found];
    }
  }
}
function knownPermission(path: string[], actor: TokenPayload) {
  const keys = path.filter(p=>p.startsWith('k:')).map(p=>p.slice(2));
  const section = MIST_READ_SECTIONS.filter(s=>s.paths.some(prefix=>prefix.every((p,i)=>p===keys[i]))).sort((a,b)=>Math.max(...b.paths.map(p=>p.length))-Math.max(...a.paths.map(p=>p.length)))[0];
  if(section)return section.permissions.every(p=>hasScope(actor,p));
  if(PERSONAL.has(keys[0]))return true;
  if(keys[0]==='settings')return hasScope(actor,'settings:system:read');
  if(['members','memberIds','memberLog','memberGroups','teamScopes'].includes(keys[0]))return hasScope(actor,'hr:write');
  return false;
}
function currentlyHidden(path: string[], raw: MistState, visible: MistState) {
  for(let i=0;i<path.length;i++)if(path[i].startsWith('i:') && read(raw,path.slice(0,i+1))!==undefined && read(visible,path.slice(0,i+1))===undefined)return true;
  return false;
}
function ids(state: MistState, output = new Set<string>(), labels?:Map<string,string>,locations?:Map<string,string>) {
  const rows=(root:any,path:string[])=>{
    if(Array.isArray(root)){for(const item of root)rows(item,path);return;}
    if(!plain(root))return;
    // Only authoritative collection records establish visibility. A proposal payload or frozen
    // snapshot mentioning an id must not grant access to the record bearing that id.
    const id=typeof root.id==='string'?root.id:typeof root.userId==='string'?root.userId:undefined;
    if(id){output.add(id);locations?.set(JSON.stringify([...path,'i:'+id]),id);const label=[root.code,root.name,root.title,root.displayName].find(v=>typeof v==='string'&&v.trim());if(label&&labels){const text=label.slice(0,120);if(!labels.has(id))labels.set(id,text);else if(labels.get(id)!==text)labels.set(id,'');}return;}
    for(const [key,value] of Object.entries(root))rows(value,[...path,'k:'+key]);
  };
  for(const path of [...MIST_READ_SECTIONS.flatMap(s=>s.paths),['files'],['calendar'],['members']]){const segments=path.map(k=>'k:'+k);rows(read(state,segments),segments);}
  return output;
}
function referencesVisible(value: any, known: Set<string>, visible: Set<string>,hidden:Set<string>, key=''): boolean {
  if(typeof value==='string')return !hidden.has(value)&&(!known.has(value)||visible.has(value)) && (!/(?:Id|Ids)$|^id$/.test(key)||known.has(value)&&visible.has(value));
  if(Array.isArray(value))return value.every(v=>referencesVisible(v,known,visible,hidden,key));
  if(plain(value))return Object.entries(value).every(([k,v])=>referencesVisible(v,known,visible,hidden,k));
  return true;
}
function readableCommand(command: AgentCommandAudit['command'], actor: TokenPayload, permission: (c: any)=>string|null) {
  if(command.type.startsWith('teamScope.'))return hasScope(actor,'hr:write');
  if(command.type.startsWith('settings.'))return hasScope(actor,'settings:system:read');
  if(['finance.account.save','finance.account.close','finance.account.reopen'].includes(command.type))return hasScope(actor,'vouchers:write');
  if((command.type.startsWith('payable.')||command.type.startsWith('market.supplier.bank.')) && (!hasScope(actor,'invoices:read')||!hasScope(actor,'vouchers:read')))return false;
  try { const scope=permission(command);if(scope==='ai:chat'||scope==='relations:admin')return hasScope(actor,scope);if(scope)return hasScope(actor,(scope.split(':')[0]+':read') as any);return /^(calendar\.|notification\.|task\.)/.test(command.type); } catch{return false;}
}

/** Project historical deltas with today's authority AND today's live-record visibility. Never return raw internal JSON. */
export function projectAgentAudit(a: AgentCommandAudit, input: { actor:TokenPayload; current:MistState; visible:MistState; project:(s:MistState)=>MistState; permission:(c:any)=>string|null; unrestricted:boolean; offset:number; limit:number; includeCommand:boolean }): AgentAuditDetail {
  const {actor,current}=input,visible=auditReadView(input.visible),project=(s:MistState)=>auditReadView(input.project(s)), before=structuredClone(current),after=structuredClone(current);
  for(const c of a.changes)if(c.operation!=='reorder' && !SYSTEM.has(c.path[0]?.slice(2))){define(before,c.path,own(c,'before'),c.before,c.beforeIndex);define(after,c.path,own(c,'after'),c.after,c.afterIndex);}
  const old=project(before),next=project(after), allowed:AgentAuditVisibleChange[]=[];
  let restricted=false, system=false;
  for(const c of a.changes){
    if(SYSTEM.has(c.path[0]?.slice(2))){system=true;continue;}
    if(!knownPermission(c.path,actor)||currentlyHidden(c.path,current,visible)){restricted=true;continue;}
    const anchor=c.path.findIndex(p=>p.startsWith('i:'));
    if(anchor>=0 && read(current,c.path.slice(0,anchor+1))===undefined && !hasScope(actor,'audit:read')){restricted=true;continue;}
    const record:AgentAuditVisibleChange={path:c.path,label:FIELDS[c.path.at(-1)!.slice(2)]??MIST_READ_SECTIONS.find(s=>s.paths.some(p=>p[0]===c.path[0]?.slice(2)))?.label??'其他信息',operation:c.operation};
    let hasValue=false;
    for(const side of ['before','after'] as const)if(own(c,side)){
      const snapshot=side==='before'?old:next;
      let projected=read(snapshot,c.path);
      if(c.operation==='reorder'){
        const rows=Array.isArray(projected)?projected:[];const kept=(c[side] as string[]).filter(id=>rows.some(r=>r.id===id));
        projected=kept.length?kept:undefined;
      } else projected=visibleHistoricalValue(c[side],projected);
      if(projected===undefined){record[side+'Restricted' as 'beforeRestricted']=true;restricted=true;}
      else {record[side]=redactAgentAuditValue(projected);hasValue=true;if(!same(c[side],projected)){record[side+'Restricted' as 'beforeRestricted']=true;restricted=true;}}
    }
    if(hasValue)allowed.push(record);else restricted=true;
  }
  const body=bodyOf(a),fullReader=input.unrestricted&&hasScope(actor,'audit:read')&&MIST_READ_SECTIONS.every(s=>s.permissions.every(p=>hasScope(actor,p)));
  const known=ids(current);ids(before,known);ids(after,known);const seen=ids(visible);ids(old,seen);ids(next,seen);
  const currentLocations=new Map<string,string>(),visibleLocations=new Map<string,string>();ids(current,new Set(),undefined,currentLocations);ids(visible,new Set(),undefined,visibleLocations);
  const hiddenIds=new Set([...currentLocations].filter(([key])=>!visibleLocations.has(key)).map(([,id])=>id));
  const canReadInput=readableCommand(body,actor,input.permission);
  const payloadAllowed=!restricted&&(a.actor.id===actor.userId||fullReader)&&canReadInput&&referencesVisible(body.payload,known,seen,hiddenIds);
  const primaryKind=PRIMARY_TYPES.find(([prefix])=>body.type.startsWith(prefix))?.[1],primaryDefinition=AGENT_OBJECT_TYPES.find(t=>t.type===primaryKind);
  const contexts:any[]=[];
  if(primaryDefinition){
    const prefix=primaryDefinition.path.map(k=>'k:'+k),subject=body.payload.id??body.payload.orderId??body.payload.quotationId;
    const subjectIds=new Set<string>(typeof subject==='string'?[subject]:[]);
    for(const change of allowed)if(prefix.every((p,i)=>change.path[i]===p)&&change.path[prefix.length]?.startsWith('i:'))subjectIds.add(change.path[prefix.length].slice(2));
    for(const id of subjectIds){
      const recordPath=[...prefix,'i:'+id],live=read(current,recordPath),shown=read(visible,recordPath);
      // A historical owner/association must never restore a live record hidden today.
      // Missing records require audit authority, just as historical delta values do.
      if(live!==undefined&&shown===undefined||live===undefined&&!hasScope(actor,'audit:read'))continue;
      for(const snapshot of [visible,old,next]){const record=read(snapshot,recordPath);if(record!==undefined)contexts.push(record);}
    }
  }
  let projectedPayload:Record<string,unknown>|undefined=payloadAllowed?a.command.payload:undefined;
  if(!projectedPayload&&canReadInput){
    const proven=evidencedInput(body.payload,contexts);
    if(proven&&referencesVisible(proven,known,seen,hiddenIds))projectedPayload=a.command.type==='agent.proposal.create'?{command:{type:body.type,payload:proven}}:proven;
  }
  const commandRestricted=!projectedPayload||!same(projectedPayload,a.command.payload),commandAvailable=projectedPayload!==undefined;
  const selected=allowed.slice(input.offset,input.offset+input.limit),end=input.offset+selected.length;
  const names=new Map<string,string>(),currentIds=ids(current),currentVisibleIds=ids(visible);ids(visible,new Set(),names);
  if(hasScope(actor,'audit:read')){const historicNames=new Map<string,string>();ids(old,new Set(),historicNames);ids(next,new Set(),historicNames);for(const [id,name] of historicNames)if((!currentIds.has(id)||currentVisibleIds.has(id))&&!names.has(id))names.set(id,name);}
  const needed=new Set<string>();const collect=(v:any)=>{if(typeof v==='string'&&names.get(v)&&!hiddenIds.has(v))needed.add(v);else if(Array.isArray(v))v.forEach(collect);else if(plain(v))Object.values(v).forEach(collect);};selected.forEach(c=>{collect(c.before);collect(c.after);c.path.filter(p=>p.startsWith('i:')).forEach(p=>collect(p.slice(2)));});
  if(input.includeCommand&&projectedPayload)collect(projectedPayload);
  const references=Object.fromEntries([...needed].map(id=>[id,names.get(id)!]));
  const targets:AgentAuditDetail['targets']=[],targetKeys=new Set<string>(),targetRecords:any[]=[];
  const target=(type:string,id:unknown)=>{
    if(typeof id!=='string')return;const definition=AGENT_OBJECT_TYPES.find(t=>t.type===type);if(!definition||!hasScope(actor,definition.scope))return;
    const rows=read(visible,definition.path.map(k=>'k:'+k));const record=Array.isArray(rows)?rows.find(r=>r.id===id):undefined;if(!record)return;
    const linkId=definition.linkId?definition.linkId(record):record.id,key=definition.view+':'+(definition.section??'')+':'+linkId;if(typeof linkId!=='string'||targetKeys.has(key))return;
    targetKeys.add(key);const label=(['supplier','customer','contact'].includes(type)?[record.name,record.code,record.title]:[record.code,record.name,record.title,record.style]).find(v=>typeof v==='string'&&v.trim())??definition.label;
    targets.push({label:label.slice(0,120),view:definition.view,id:linkId,...(definition.section?{section:definition.section}:{})});targetRecords.push(record);
  };
  for(const change of allowed)for(const definition of AGENT_OBJECT_TYPES){const prefix=definition.path.map(k=>'k:'+k);if(prefix.every((p,i)=>change.path[i]===p)&&change.path[prefix.length]?.startsWith('i:'))target(definition.type,change.path[prefix.length].slice(2));}
  if(primaryKind)target(primaryKind,body.payload.id??body.payload.orderId??body.payload.quotationId);
  const referenceTypes:Record<string,string>={orderId:'order',purchaseId:'purchase',invoiceId:'invoice',customerId:'customer',supplierId:'supplier',settlementId:'payable_settlement'};
  // An otherwise public supplier/customer must not reveal its hidden association in a restricted
  // original command. Secondary links are taken from visible records, or from authorized input.
  for(const record of [...targetRecords])for(const [key,type] of Object.entries(referenceTypes))target(type,record[key]);
  if(payloadAllowed)for(const [key,type] of Object.entries(referenceTypes))if(!hiddenIds.has(String(body.payload[key])))target(type,body.payload[key]);
  const accessKey=createHash('sha256').update(JSON.stringify({allowed,projectedPayload,restricted,targets})).digest('hex');
  return {...auditEntry(a),command:{type:a.command.type,...(input.includeCommand&&projectedPayload?{payload:redactAgentAuditValue(projectedPayload)}:{})},commandRestricted,commandAvailable,changes:selected,detailsRestricted:restricted,systemChangesOmitted:system,offset:input.offset,totalChanges:allowed.length,nextOffset:end<allowed.length?end:null,references,accessKey,targets};
}
