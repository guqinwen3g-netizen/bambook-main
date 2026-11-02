/**
 * Agent 提议（2026-10-30 用户定案）：确认 / 删除 / 资金 / 对外发送类命令，Agent 只能提交提议，
 * 由账号本人在「接着完成」里确认后，按本人身份走完整的命令门禁执行；Agent 不能确认或拒绝。
 * 提议只给本人看（读投影按 ownerId 过滤）；确认时由仓储把 agent.proposal.confirm 换成原命令执行，
 * 并在同一事务里用 markAgentProposalConfirmed 核对命令未变、提议仍待确认后记为已确认。
 */
import { MistCommandError, type MistContext, type MistState } from './mistWorkspace';

export type AgentProposalCommandBody = { type: string; payload: Record<string, unknown> };
export type AgentProposal = {
  id: string; ownerId: string; owner: string; agentSessionId?: string;agentIdentity?:{id:string;name:string};
  command: AgentProposalCommandBody; summary: string[]; createdAt: string;
  state: 'pending' | 'confirmed' | 'rejected'; decidedAt?: string; note?: string; taskId?: string;
  /** Response-only access state; never accepted as a client authority claim. */
  unavailable?: boolean; taskBlocked?: string;
  sourceRevision?: number;
};
export type AgentProposalCommand =
  | { type: 'agent.proposal.create'; payload: { command: AgentProposalCommandBody; summary: string[] } }
  | { type: 'agent.proposal.confirm'; payload: { id: string } }
  | { type: 'agent.proposal.reject'; payload: { id: string; note?: string } };

export const AGENT_PROPOSAL_MAX_PENDING = 50;
const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message); };

/**
 * AI 写入三级确认（2026-11 用户定案）：每类可被提议的命令登记风险等级，确认人须持有对应 ai:write:* 码。
 * - 低：记跟进、加标签、标记已读等，不改单据内容；
 * - 中：修改单据、整理邮件、移动邮件等，确认界面列出将要改动的字段；
 * - 高：付款、核销、审批、作废等资金或不可逆操作，确认请求须带本人当前登录密码，由服务端复验。
 * 没有在此登记的命令一律按高处理。无论哪一级，确认人自己仍须持有该命令本身的业务权限（仓储按原命令重新校验）。
 */
export type AgentCommandRisk = 'low' | 'medium' | 'high';
export const AI_WRITE_SCOPES: Record<AgentCommandRisk, string> = { low: 'ai:write:low', medium: 'ai:write:medium', high: 'ai:write:high' };
export const AGENT_RISK_LABEL: Record<AgentCommandRisk, string> = { low: '低风险', medium: '中风险', high: '高风险' };
const LOW_RISK = ['crm.followUp.save', 'email.flag', 'email.link', 'email.unlink', 'email.followUp', 'email.draft.save', 'notification.read', 'notification.readAll', 'task.complete', 'calendar.save', 'market.quotation.feedback.add', 'platform.assistant.saveDraft'];
const MEDIUM_RISK = ['email.move', 'email.state.retry', 'email.draft.delete', 'email.account.save', 'email.submitExtraction', 'email.extraction.review', 'email.extraction.resolve',
  'customer.update', 'contact.save', 'market.customer.update', 'market.contact.save', 'market.relation.save', 'market.lead.save', 'market.supplier.save', 'market.product.save', 'market.quotation.save',
  'crm.opportunity.save', 'crm.opportunity.stage', 'development.saveDraft', 'development.update', 'order.update', 'order.checklist', 'production.update',
  'fulfillment.procurement.save', 'fulfillment.shipments.save', 'fulfillment.documents.save', 'fulfillment.samples.create', 'fulfillment.samples.edit', 'payable.settlement.submit'];
export const AGENT_COMMAND_RISK: Readonly<Record<string, AgentCommandRisk>> = Object.freeze({ ...Object.fromEntries(LOW_RISK.map(t => [t, 'low' as const])), ...Object.fromEntries(MEDIUM_RISK.map(t => [t, 'medium' as const])) });
export const agentCommandRisk = (type: string): AgentCommandRisk => AGENT_COMMAND_RISK[type] ?? 'high';

/** 拒绝本人旧提议只是撤销待办，不依赖继续使用 AI 的权限；确认的原业务权限仍在仓储重新校验。 */
export const agentProposalCommandPermission = (type?: string): string|null => type==='agent.proposal.reject'?null:'ai:chat';

const plainOwner = (name: string) => name.replace(/（经 Agent）$/, '');
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',')}}` : JSON.stringify(value);

export function applyAgentProposalCommand(state: MistState, command: AgentProposalCommand, context: MistContext): { id: string } {
  const list = (state.agentProposals ??= []);
  if (command.type === 'agent.proposal.create') {
    if (!context.viaAgent || !context.actorId) fail('只有 Agent 可以提交提议', 'FORBIDDEN');
    const { command: body, summary } = command.payload ?? ({} as never);
    if (!body || typeof body.type !== 'string' || !/^[a-z][\w]*(\.[\w]+)+$/.test(body.type) || body.type.startsWith('agent.') || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) fail('提议的命令格式无效');
    if (JSON.stringify(body).length > 20000) fail('提议的命令过大');
    if (!Array.isArray(summary) || !summary.length || summary.length > 10 || summary.some(line => typeof line !== 'string' || !line.trim() || line.length > 500)) fail('提议须附 1–10 行业务说明');
    if (list.filter(p => p.ownerId === context.actorId && p.state === 'pending').length >= AGENT_PROPOSAL_MAX_PENDING) fail('待确认的 Agent 提议过多，请先处理已有提议', 'PRECONDITION');
    const id = context.id();
    list.push({ id, ownerId: context.actorId!, owner: plainOwner(context.actorName), ...(context.agentSessionId ? { agentSessionId: context.agentSessionId } : {}),...(context.agentIdentity?{agentIdentity:context.agentIdentity}:{}), ...(context.agentTaskId ? {taskId:context.agentTaskId,sourceRevision:context.agentTaskSourceRevision} : {}), command: { type: body.type, payload: JSON.parse(JSON.stringify(body.payload)) }, summary: summary.map(line => line.trim()), createdAt: context.now, state: 'pending' });
    return { id };
  }
  if (command.type === 'agent.proposal.reject') {
    if (context.viaAgent) fail('Agent 不能处理自己的提议', 'FORBIDDEN');
    const proposal = list.find(p => p.id === command.payload?.id && p.ownerId === context.actorId) ?? fail('提议不存在或不属于当前账号', 'NOT_FOUND');
    if (proposal.state !== 'pending') fail('提议已处理', 'CONFLICT');
    const note = typeof command.payload.note === 'string' ? command.payload.note.trim().slice(0, 500) : '';
    Object.assign(proposal, { state: 'rejected', decidedAt: context.now, ...(note ? { note } : {}) });
    return { id: proposal.id };
  }
  return fail('确认提议须由服务端换成原命令执行', 'INVALID_COMMAND');
}

/** 仓储在执行原命令后、落库前调用：本人、待确认、命令与提议完全一致，才记为已确认。 */
export function markAgentProposalConfirmed(state: MistState, id: string, executed: AgentProposalCommandBody, actorId: string, now: string) {
  const proposal = state.agentProposals?.find(p => p.id === id);
  if (!proposal || proposal.ownerId !== actorId) fail('提议不存在或不属于当前账号', 'NOT_FOUND');
  if (proposal!.state !== 'pending') fail('提议已处理', 'CONFLICT');
  if (stable(proposal!.command) !== stable({ type: executed.type, payload: executed.payload })) fail('提议内容已变化，请刷新后重新核对', 'CONFLICT');
  Object.assign(proposal!, { state: 'confirmed', decidedAt: now });
}
