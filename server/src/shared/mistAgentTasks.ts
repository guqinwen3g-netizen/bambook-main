/** Public task views contain no service credential or execution lease secret. */
export type AgentTaskState = 'queued' | 'running' | 'waiting_time' | 'waiting_condition' | 'waiting_human' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'budget_exhausted' | 'access_changed';
export type AgentTaskQuestion = {id:string;question:string;askedAt:string;answer?:string;answeredAt?:string};
export type AgentTaskTrailItem = { at: string; kind: 'read' | 'write' | 'ask' | 'wait' | 'note'; label: string; failed?: boolean; ref?: { type: string; id: string; label: string } };
export type AgentTaskView = {
  id: string; identityId: string; identityName: string; name: string; ownerId: string; ownerName: string;
  instructions: string; state: AgentTaskState; version: number; createdAt: string; updatedAt: string; expiresAt: string;
  mode: 'read'|'operate';
  stepsUsed: number; stepLimit: number; runtimeUsedMs: number; runtimeLimitMs: number;
  lastHeartbeatAt: string | null; checkpoint: string; waitingProposalIds: string[]; result: string;
  canControl: boolean;
  executor?:'external'|'platform';
  automationId?:string;
  conversationId?:string;
  /** 平台任务的办理过程（做了什么、读了哪条记录）；不含读取到的内容。 */
  trail?:AgentTaskTrailItem[];
  executionIssue?:{code:'model_unavailable'|'model_response_invalid';retryAt?:string};
  /** Absent in older servers; questions and answers use the task's existing content visibility. */
  questions?:AgentTaskQuestion[];
  resumeAt?:string|null;
  waitingFor?:{type:string;id:string;label:string;link?:string}|null;
  nextCheckAt?:string|null;
  wakeReason?:'changed'|'deadline';
  requiredRead?:{type:string;id:string}|null;
};
export type AgentTaskPage = { items: AgentTaskView[]; nextCursor: string | null };
export type AgentTaskEvent = { action: string; at: string; actorId: string; actorName: string; version: number; state: AgentTaskState };
export type AgentTaskCommand = { type: 'agent.task.cancel'; payload: { id: string; version: number } };
/** Personal attention metadata; never carries questions, reports, credentials or business payloads. */
export type AgentTaskNotice = {recipientIds:string[];id:string;taskId:string;key:string;title:string;detail:string;at:string;readAt:string|null;category:'general';target:{view:'assistant';id:string;section:'tasks'}};
