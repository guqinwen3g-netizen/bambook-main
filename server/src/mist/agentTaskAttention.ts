import {createHash} from 'node:crypto';
import type {AgentTaskNotice,AgentTaskView} from '../shared/mistAgentTasks';
import {readTaskRecord,TASK_HASH,type TaskRecord} from './agentTasks';

const ended=['succeeded','failed','cancelled'];
/** Active tasks cannot be buried by a large completed history; the recent archive remains bounded. */
export async function taskNoticeCandidates(db:any,workspaceId:string,ownerId:string,now:number):Promise<TaskRecord[]>{
  const base={workspaceId,actorId:ownerId,inputHash:TASK_HASH},at=(key:string,value:unknown)=>({result:{path:['__agentTask',key],...value as object}});
  const [active,recent]=await Promise.all([
    db.mistCommandReceipt.findMany({where:{...base,AND:[{OR:['queued','running','waiting_time','waiting_condition','waiting_human','paused'].map(state=>at('state',{equals:state}))},at('expiresAt',{gte:now})]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:10}),
    db.mistCommandReceipt.findMany({where:{...base,OR:[...ended.map(state=>at('state',{equals:state})),at('expiresAt',{lte:now-1})]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20})
  ]);
  return [...new Map([...active,...recent].map(row=>{const c=readTaskRecord(row,workspaceId);return[c.id,c];})).values()];
}

/** A stable state boundary, not a heartbeat/version number. New human work is a new reminder. */
export function taskNotice(c:TaskRecord,view:AgentTaskView):AgentTaskNotice|null{
  if(view.state==='cancelled')return null;
  const waiting=['waiting_human','paused'].includes(view.state),question=waiting?view.questions?.filter(q=>!q.answeredAt)??[]:[],pending=waiting?view.waitingProposalIds:[];
  const title=view.state==='access_changed'?'Agent任务权限已变化':view.state==='expired'?'Agent任务已到期':view.state==='budget_exhausted'?'Agent任务达到限额':question.length?'Agent待补充资料':pending.length?'Agent待本人确认':view.state==='paused'&&view.executionIssue?'Agent任务需处理':view.state==='succeeded'?'Agent执行结束':view.state==='failed'?'Agent执行失败':null;
  if(!title)return null;
  const key=createHash('sha256').update(JSON.stringify([title,question.map(q=>q.id),pending,title==='Agent任务需处理'?c.controlVersion:null,view.executionIssue?.code??null])).digest('hex');
  return{id:'agent-task:'+c.id+':'+key.slice(0,20),taskId:c.id,key,title,detail:view.name,at:question.at(-1)?.askedAt??c.updatedAt,readAt:c.noticeRead?.key===key?c.noticeRead.at:null,category:'general',target:{view:'account',id:c.id,section:'agents'}};
}
