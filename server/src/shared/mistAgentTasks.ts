/** Public task views contain no service credential or execution lease secret. */
export type AgentTaskState = 'queued' | 'running' | 'waiting_human' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'budget_exhausted' | 'access_changed';
export type AgentTaskQuestion = {id:string;question:string;askedAt:string;answer?:string;answeredAt?:string};
export type AgentTaskView = {
  id: string; identityId: string; identityName: string; name: string; ownerId: string; ownerName: string;
  instructions: string; state: AgentTaskState; version: number; createdAt: string; updatedAt: string; expiresAt: string;
  mode: 'read'|'operate';
  stepsUsed: number; stepLimit: number; runtimeUsedMs: number; runtimeLimitMs: number;
  lastHeartbeatAt: string | null; checkpoint: string; waitingProposalIds: string[]; result: string;
  canControl: boolean;
  executor?:'external'|'platform';
  executionIssue?:{code:'model_unavailable'|'model_response_invalid';retryAt?:string};
  /** Absent in older servers; questions and answers use the task's existing content visibility. */
  questions?:AgentTaskQuestion[];
};
export type AgentTaskPage = { items: AgentTaskView[]; nextCursor: string | null };
export type AgentTaskEvent = { action: string; at: string; actorId: string; actorName: string; version: number; state: AgentTaskState };
export type AgentTaskCommand = { type: 'agent.task.cancel'; payload: { id: string; version: number } };
/** Personal attention metadata; never carries questions, reports, credentials or business payloads. */
export type AgentTaskNotice = {id:string;taskId:string;key:string;title:string;detail:string;at:string;readAt:string|null;category:'general';target:{view:'account';id:string;section:'agents'}};
