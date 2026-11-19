import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { MistState } from '../shared/mistWorkspace';
import { normalizeAgentTaskIntentRefs, type AgentTaskIntentKind, type AgentTaskIntentRef } from '../shared/mistAgentTasks';
import { AGENT_OBJECT_TYPES } from './agentRead';
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
/** Only completed real get steps satisfy this pre-read; selecting an ID is not a read. */
export function nextTaskIntentRead(refs:AgentTaskIntentRef[],steps:PlatformTaskStep[]):{plan?:PlatformTaskPlan;failed?:boolean}{
  for(const target of taskIntentReadTargets(refs)){
    const attempts=steps.filter(step=>step.plan.name==='bambook_get'&&step.plan.arguments.type===target.type&&step.plan.arguments.id===target.id&&step.result!==undefined);
    const read=attempts.some(step=>{const result=step.result as any;return !result?.error&&(result?.object?.id===target.id||step.compacted);});
    if(read)continue;
    if(attempts.length)return{failed:true};
    return{plan:{name:'bambook_get',arguments:target}};
  }
  return{};
}
