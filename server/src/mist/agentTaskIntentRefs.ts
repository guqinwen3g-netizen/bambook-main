import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { MistState } from '../shared/mistWorkspace';
import { AGENT_TASK_INTENT_KINDS, normalizeAgentTaskIntentRefs, type AgentTaskIntentKind, type AgentTaskIntentRef } from '../shared/mistAgentTasks';
import { AGENT_OBJECT_TYPES, matchesAgentObjectIdentifier } from './agentRead';
import { fail } from './errors';
import type { PlatformTaskStep, PlatformTaskPlan } from './platformTaskPlan';

/** UI categories map explicitly to existing MCP object types, never arbitrary paths. */
const OBJECT_TYPE:Record<AgentTaskIntentKind,string>={orders:'order',invoices:'invoice',customers:'customer',purchases:'purchase',shipments:'shipment',developments:'development',risks:'risk'};
const descriptor=(kind:AgentTaskIntentKind)=>AGENT_OBJECT_TYPES.find(t=>t.type===OBJECT_TYPE[kind])!;
export const taskIntentReadTargets=(refs:AgentTaskIntentRef[])=>refs.map(ref=>({type:OBJECT_TYPE[ref.kind],id:ref.id}));
export function taskIntentRefsVisible(refs:AgentTaskIntentRef[],actor:TokenPayload,visible:MistState):boolean {
  return refs.every(ref=>{const type=descriptor(ref.kind);if(!type||!hasScope(actor,type.scope))return false;let list:any=visible;for(const key of type.path)list=list?.[key];return Array.isArray(list)&&list.some(row=>row?.id===ref.id);});
}
export function validateTaskIntentRefs(value:unknown,actor:TokenPayload,visible:MistState):AgentTaskIntentRef[]{
  let refs:AgentTaskIntentRef[];try{refs=normalizeAgentTaskIntentRefs(value);}catch(e){fail('INVALID_INPUT',e instanceof Error?e.message:'任务引用格式无效',400);}
  if(!taskIntentRefsVisible(refs!,actor,visible))fail('NOT_FOUND','引用记录不存在或不在当前账号的业务范围内',404);
  return refs!;
}
export function taskIntentCeilingAllows(refs:AgentTaskIntentRef[],ceiling:readonly string[]):boolean{return refs.every(ref=>ceiling.includes(descriptor(ref.kind).scope)||ceiling.includes('*'));}
const HISTORY_READ_LIMIT = 12;
type PriorReadObject = { type?: string; id?: string; truncated?: boolean; data?: { code?: unknown; sku?: unknown } };

export function taskHistoryReadRefs(
  selected: AgentTaskIntentRef[],
  steps: PlatformTaskStep[],
): AgentTaskIntentRef[] | undefined {
  const reads = new Map(selected.map(ref => [ref.kind + '\0' + ref.id, ref]));
  const collect = (object: PriorReadObject | undefined, expectedType: unknown, expectedIds: readonly unknown[]) => {
    if (!object?.data || object.truncated !== false || object.type !== expectedType || typeof object.id !== 'string') return;
    const { code, sku } = object.data;
    const identifier = { id: object.id, code, sku };
    if (!expectedIds.some(id => typeof id === 'string' && matchesAgentObjectIdentifier(identifier, id))) return;
    const kind = AGENT_TASK_INTENT_KINDS.find(kind => OBJECT_TYPE[kind] === object.type);
    if (kind) reads.set(kind + '\0' + object.id, { kind, id: object.id });
  };
  for (const step of steps) {
    const result = step.result as { error?: boolean; object?: PriorReadObject; orders?: PriorReadObject[] } | undefined;
    if (!result || result.error || step.compacted) continue;
    const { name, arguments: args } = step.plan;
    if (name === 'bambook_get') collect(result.object, args.type, [args.id]);
    if (name === 'bambook_get_orders' && Array.isArray(args.ids) && Array.isArray(result.orders)) {
      for (const object of result.orders) collect(object, 'order', args.ids);
    }
    if (reads.size > HISTORY_READ_LIMIT) return undefined;
  }
  return [...reads.values()];
}

/** Only completed real get steps satisfy this pre-read; selecting an ID is not a read. */
export function nextTaskIntentRead(refs:AgentTaskIntentRef[],steps:PlatformTaskStep[],requireFull=false):{plan?:PlatformTaskPlan;failed?:boolean}{
  for(const target of taskIntentReadTargets(refs)){
    const attempts=steps.filter(step=>step.plan.name==='bambook_get'&&step.plan.arguments.type===target.type&&step.plan.arguments.id===target.id&&step.result!==undefined);
    const read=attempts.some(step=>{const result=step.result as any;return !result?.error&&(requireFull?result?.object?.id===target.id&&result.object.truncated===false:result?.object?.id===target.id||step.compacted);});
    if(read)continue;
    if(attempts.length)return{failed:true};
    return{plan:{name:'bambook_get',arguments:target}};
  }
  return{};
}
