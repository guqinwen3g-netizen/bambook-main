import type {MistDev,MistState} from './mistWorkspace';

export type DevelopmentClosure={id?:string;kind:'closed'|'archived'|'cancelled';at:string;by:string;byId?:string;reason:string};
export type DevelopmentCloseSnapshot=DevelopmentClosure&{id:string};
export type DevelopmentLifecycleEvent={action:'closed'|'reopened';closure:DevelopmentCloseSnapshot;actorId?:string;expectedVersionId:string|null;reason?:string};
const CLOSE_TEXT={closed:'结束开发案：',archived:'归档开发案：',cancelled:'取消开发案：'}as const;

/** A close cycle is identified by a trusted ID, never by a clock/name/reason tuple. */
export function developmentReopenSource(state:Pick<MistState,'events'>,dev:Pick<MistDev,'id'|'closure'|'currentVersionId'>):{closureId:string;expectedVersionId:string|null;closure:DevelopmentCloseSnapshot}|null{
 const closure=dev.closure;if(!closure)return null;
 let id=closure.id;
 if(!id){
  // Before IDs existed close() could run only once. Reuse its unique immutable
  // event, without rewriting it or guessing an account from the display name.
  // event.at can be audit time while closure.at is the business clock.
  const events=state.events.filter(event=>event.entityType==='development'&&event.entityId===dev.id&&event.actor===closure.by&&event.text===CLOSE_TEXT[closure.kind]+closure.reason);
  if(events.length!==1)return null;id=events[0].id;
 }
 return{closureId:id,expectedVersionId:dev.currentVersionId??null,closure:{...closure,id}};
}
