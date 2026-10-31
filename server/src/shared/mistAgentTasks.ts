/** Public task views contain no service credential or execution lease secret. */
export type AgentTaskState = 'queued' | 'running' | 'waiting_human' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'budget_exhausted' | 'access_changed';
export type AgentTaskView = {
  id: string; identityId: string; identityName: string; name: string; ownerId: string; ownerName: string;
  instructions: string; state: AgentTaskState; version: number; createdAt: string; updatedAt: string; expiresAt: string;
  mode: 'read'|'operate';
  stepsUsed: number; stepLimit: number; runtimeUsedMs: number; runtimeLimitMs: number;
  lastHeartbeatAt: string | null; checkpoint: string; waitingProposalIds: string[]; result: string;
  canControl: boolean;
};
export type AgentTaskPage = { items: AgentTaskView[]; nextCursor: string | null };
export type AgentTaskEvent = { action: string; at: string; actorId: string; actorName: string; version: number; state: AgentTaskState };
export type AgentTaskCommand = { type: 'agent.task.cancel'; payload: { id: string; version: number } };
