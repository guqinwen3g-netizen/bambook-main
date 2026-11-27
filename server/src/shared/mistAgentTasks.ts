import type { TaskAttachment } from './mistTaskAttachments';
/** Public task views contain no service credential or execution lease secret. */
export const AGENT_TASK_INTENT_KINDS = ['orders','invoices','customers','purchases','shipments','developments','risks'] as const;
export type AgentTaskIntentKind = typeof AGENT_TASK_INTENT_KINDS[number];
/** User-selected intent, never a claim that the task has read the referenced data. */
export type AgentTaskIntentRef = { kind: AgentTaskIntentKind; id: string };
export function normalizeAgentTaskIntentRefs(value: unknown): AgentTaskIntentRef[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>12)throw new Error('最多引用12条业务记录');
  const seen=new Set<string>(),out:AgentTaskIntentRef[]=[];
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['kind','id'].includes(k))||!AGENT_TASK_INTENT_KINDS.includes(item.kind)||typeof item.id!=='string'||!item.id.length||item.id.length>200||item.id.trim()!==item.id)throw new Error('任务引用格式无效');
    const ref={kind:item.kind as AgentTaskIntentKind,id:item.id},key=JSON.stringify([ref.kind,ref.id]);if(!seen.has(key)){seen.add(key);out.push(ref);}
  }
  return out;
}
export type AgentTaskState = 'queued' | 'running' | 'waiting_time' | 'waiting_condition' | 'waiting_human' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'budget_exhausted' | 'access_changed';
export type AgentTaskQuestion = {id:string;question:string;askedAt:string;answer?:string;answeredAt?:string};
type AgentTaskTrailSource = { type: string; id: string; label: string; /** 读取结果给出的页面与锚点；id 为页面要打开的编号（可能是上级单据）。 */ view?: string; section?: string };
export type AgentTaskTrailItem = {
  at: string; kind: 'read' | 'write' | 'ask' | 'wait' | 'note'; label: string;
  completed?: boolean; failed?: boolean; progress?: string; detail?: string;
  /** A verified read of an original listed in this task's attachments. */
  taskAttachmentId?: string;
  /** A PDF page from the same authorized extraction window. */
  taskAttachmentPage?: number;
  /** Checked PDF window for this original, including pages with no readable text. */
  taskAttachmentPageRange?: {from:number;to:number};
  /** Pages evidenced by this returned slice, including confirmed pages without text. */
  taskAttachmentObservedPages?: number[];
  /** Workbook tabs with content (or a confirmed empty state) in this returned slice. */
  taskAttachmentObservedSheets?: string[];
  ref?: AgentTaskTrailSource;
  refs?: AgentTaskTrailSource[];
};
export type AgentTaskView = {
  id: string; identityId: string; identityName: string; name: string; ownerId: string; ownerName: string;
  instructions: string; state: AgentTaskState; version: number; createdAt: string; updatedAt: string; expiresAt: string;
  mode: 'read'|'operate';
  stepsUsed: number; stepLimit: number; runtimeUsedMs: number; runtimeLimitMs: number;
  lastHeartbeatAt: string | null; checkpoint: string; waitingProposalIds: string[]; result: string;
  canControl: boolean;
  /** Current server authorization withheld the original task contents. */
  contentRestricted?: true;
  /** Only the server can record that this terminal stop follows a real owner refusal. */
  stopReason?:'owner_declined';
  executor?:'external'|'platform';
  automationId?:string;
  conversationId?:string;
  intentRefs?:AgentTaskIntentRef[];
  attachments?: TaskAttachment[];
  /** 平台任务的办理过程（做了什么、读了哪条记录）；不含读取到的内容。 */
  trail?:AgentTaskTrailItem[];
  executionStage?: 'tool' | 'model';
  /** Server-observed worker state; it does not change the task lease. */
  runnerStatus?: 'heartbeat_stale' | 'awaiting_reclaim';
  executionStageSince?: string;
  /** Start of the same-turn backup model attempt. */
  modelFallbackSince?: string;
  executionIssue?:{code:'model_unavailable'|'model_response_invalid';retryAt?:string};
  /** Absent in older servers; questions and answers use the task's existing content visibility. */
  questions?:AgentTaskQuestion[];
  resumeAt?:string|null;
  waitingFor?:{type:string;id:string;label:string;link?:string}|null;
  nextCheckAt?:string|null;
  wakeReason?:'changed'|'deadline';
  requiredRead?:{type:string;id:string}|null;
};
export function agentTaskActivityText(value: string | undefined) {
  if (!value || /\b(?:bma1|bmc1|bms1|bmt1|aft1)[_.][A-Za-z0-9_-]+|\b(?:Bearer\s+|sk-)[A-Za-z0-9_-]{8,}/i.test(value)) return;
  return value.replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim() || undefined;
}

export function activeAgentTaskStep(task: Pick<AgentTaskView, 'state' | 'executionStage' | 'runnerStatus' | 'contentRestricted' | 'trail'>) {
  if (task.state!=='running' || task.executionStage!=='tool' || task.runnerStatus || task.contentRestricted) return;
  const last=task.trail?.at(-1);
  if(last && last.completed===false && !last.failed) return agentTaskActivityText(last.label);
}

export type AgentTaskPage = { items: AgentTaskView[]; nextCursor: string | null };
export const TASK_ACCESS_BATCH_LIMIT = 30;
export type PersonalTaskAccess = { restrictedIds: string[] };
/** Personal sidebar metadata for work in progress. */
export type AgentTaskActivity = {
  id: string;
  name: string;
  state: 'queued' | 'running';
  executionStage?: AgentTaskView['executionStage'];
  executionStageSince?: AgentTaskView['executionStageSince'];
  modelFallbackSince?: AgentTaskView['modelFallbackSince'];
  runnerStatus?: AgentTaskView['runnerStatus'];
  retrying?: boolean;
  currentStep?: string;
};
export type AgentTaskEvent = { action: string; at: string; actorId: string; actorName: string; version: number; state: AgentTaskState };
export type AgentTaskCommand = { type: 'agent.task.cancel'; payload: { id: string; version: number } };
/** Personal attention metadata; never carries questions, reports, credentials or business payloads. */
export type AgentTaskNotice = {recipientIds:string[];id:string;taskId:string;key:string;title:string;detail:string;at:string;readAt:string|null;category:'general';target:{view:'assistant';id:string;section:'tasks'}};
