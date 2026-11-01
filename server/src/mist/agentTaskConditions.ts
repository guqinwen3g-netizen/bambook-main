import type {TokenPayload} from '../auth/service';
import type {MistState} from '../shared/mistWorkspace';
import {AGENT_OBJECT_TYPES,agentGet} from './agentRead';
import {taskReadHash,type TaskSourceRef} from './agentTaskVisibility';
import {fail} from './errors';

export type TaskConditionTarget={type:string;id:string};
export type TaskCondition=TaskConditionTarget&{label:string;link?:string;hash:string;nextCheckAt:number};
export const CONDITION_CHECK_MS=30_000;

/** No client-supplied hashes, expressions, hidden fields or arbitrary object paths. */
export function taskConditionInput(value:unknown):TaskConditionTarget|undefined{
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['type','id'].includes(k)))fail('INVALID_INPUT','等待条件字段无效',400);
  const v=value as Record<string,unknown>;
  if(typeof v.type!=='string'||!AGENT_OBJECT_TYPES.some(t=>t.type===v.type)||typeof v.id!=='string'||!v.id.trim()||v.id.length>200)fail('INVALID_INPUT','等待对象无效',400);
  return{type:v.type,id:v.id};
}
export function prepareTaskCondition(target:TaskConditionTarget,sources:TaskSourceRef[],visible:MistState,actor:TokenPayload):Omit<TaskCondition,'nextCheckAt'>{
  const object=agentGet(visible,actor,target.type,target.id),path=AGENT_OBJECT_TYPES.find(t=>t.type===target.type)!.path.join('.');
  if(object.id!==target.id)fail('INVALID_INPUT','请使用原资料的对象编号',400);
  const source=sources.find(s=>s.path===path&&s.id===object.id);
  if(object.truncated||!source?.fullReadHash)fail('PRECONDITION','请先完整读取等待对象',422);
  if(taskReadHash(object.data)!==source.fullReadHash)fail('PRECONDITION','等待对象已变化，请重新读取',422);
  return{...target,label:object.label.slice(0,200),...(object.link?{link:object.link}:{}),hash:source.fullReadHash};
}
/** Caller must first refresh the original owner's authority and source visibility. */
export function taskConditionChanged(condition:TaskCondition,visible:MistState,actor:TokenPayload):boolean{
  const object=agentGet(visible,actor,condition.type,condition.id);
  return object.truncated||taskReadHash(object.data)!==condition.hash;
}
