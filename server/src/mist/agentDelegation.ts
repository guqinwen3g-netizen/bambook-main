/**
 * Two-hour Agent credentials. HTTP accepts only registered v2 leases, bound to the real
 * account/company/workspace and revalidated on every request and business transaction.
 * The v1 codec remains for upgrade/rejection tests; it is never issued by HTTP routes.
 */
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type { TokenPayload } from '../auth/service';
import { MIST_READ_SECTIONS } from './access';
import { MistApiError } from './errors';
import { PERMISSION_SCOPES } from '../_shared/rolePermissionMatrix';
import {hasScope} from '../auth/permissionService';

export const AGENT_DELEGATION_HEADER = 'x-bambook-delegation';
export const AGENT_DELEGATION_TTL_MS = 2 * 60 * 60 * 1000;
const PURPOSE = 'bambook-mist-agent-delegation/v1';
const MAX_TOKEN = 4096;

/** Read authority follows actual read projections (bank accounts/team settings use write/admin-named
 * scopes). Read mode and route/tool guards still forbid ALL writes, including proposals/preview. */
export const WORK_ASSISTANT_CEILING: readonly string[] = Object.freeze([...new Set([...MIST_READ_SECTIONS.flatMap(s => s.permissions), 'audit:read','settings:system:read','hr:write'])].sort());

/**
 * 可办理委托（2026-10-30 用户定案）：上限 = 账号现有权限（不超出），供 MCP 接口读取、预演与执行普通命令；
 * 确认 / 删除 / 资金 / 对外发送类命令仍须本人在系统中确认，由 MCP 执行入口拒绝（见 agentCommands.ts）。
 */
export const AGENT_OPERATE_CEILING: readonly string[] = Object.freeze(Object.keys(PERMISSION_SCOPES).sort());
export type AgentDelegationMode = 'read' | 'operate';
export type AgentActor = TokenPayload & { actorKind: 'agent'; agentSessionId: string; agentMode: AgentDelegationMode; agentWorkspaceId?:string; agentLease?:ManagedAgentPayload };
export type AgentDelegationPayload = { v: 1; kind: 'mist-agent'; sub: string; companyId?: string; sid: string; ceil: string[]; iat: number; exp: number; mode?: 'operate'; credentialVersion?:string };
export type ManagedAgentPayload=Omit<AgentDelegationPayload,'v'|'kind'>&{v:2;kind:'mist-agent-connection';wid:string;generation:string};
export type AgentDelegationIssue = { token: string; sessionId: string; expiresAt: string; ceiling: string[]; mode: AgentDelegationMode };

export function isAgentActor(actor: unknown): actor is AgentActor {
  return !!actor && typeof actor === 'object' && (actor as { actorKind?: unknown }).actorKind === 'agent';
}

function deny(message: string, status = 401, code = 'AGENT_DELEGATION_INVALID'): never { throw new MistApiError(code, message, status); }

/** 委托身份可调用的接口；MCP 写入仍由 mode、实时权限与命令门禁限制。 */
const AGENT_ALLOWED_ROUTES: Array<[string, RegExp]> = [
  ['GET', /^\/workspaces\/?$/],
  ['GET', /^\/workspaces\/[^/]+\/agent\/(query|objects\/[^/]+\/[^/]+(\/related)?)\/?$/],
  ['POST', /^\/mcp\/?$/],
  // 无 SSE 流时返回标准 405；不能在委托路由层先误判成越权。
  ['GET', /^\/mcp\/?$/],
];
export function agentRouteAllowed(method: string, path: string) {
  return AGENT_ALLOWED_ROUTES.some(([m, pattern]) => m === method.toUpperCase() && pattern.test(path));
}

export type AgentDelegationOptions = {
  /** 派生签名密钥的根密钥（服务端为 JWT 密钥；本地模式为本地会话密钥）。 */
  rootSecret: () => string | Buffer;
  /** 用签名里的账号 ID 还原执行者（之后仓储仍会在事务里重新加载真实账号与授权）。 */
  resolve: (userId: string) => Promise<TokenPayload> | TokenPayload;
  now?: () => number;
  ttlMs?: number;
};

export function createAgentDelegation(options: AgentDelegationOptions) {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? AGENT_DELEGATION_TTL_MS;
  const key = () => createHmac('sha256', options.rootSecret()).update(PURPOSE).digest();
  const signature = (data: string) => createHmac('sha256', key()).update(data).digest('base64url');

  /** 签发：只接受本人会话（非委托身份）；上限再与会话自身的上限取交集。 */
  function issue(actor: TokenPayload, mode: AgentDelegationMode = 'read'): AgentDelegationIssue {
    if (!actor?.userId) deny('请先登录');
    if (isAgentActor(actor)) deny('工作助手不能自行续签委托，请在页面上由本人续签', 403, 'FORBIDDEN');
    const prior = actor.permissionCeiling;
    const ceil = (mode === 'operate' ? AGENT_OPERATE_CEILING : WORK_ASSISTANT_CEILING).filter(scope => prior === undefined || prior.includes('*') || prior.includes(scope));
    const iat = now();
    const payload: AgentDelegationPayload = { v: 1, kind: 'mist-agent', sub: actor.userId, ...(actor.companyId ? { companyId: actor.companyId } : {}), sid: randomUUID(), ceil, iat, exp: iat + ttl, ...(mode === 'operate' ? { mode } : {}) };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${data}.${signature(data)}`, sessionId: payload.sid, expiresAt: new Date(payload.exp).toISOString(), ceiling: [...ceil], mode };
  }

  function prepareManaged(actor:TokenPayload,id:string,workspaceId:string,mode:AgentDelegationMode,priorCeiling?:string[]):ManagedAgentPayload {
    if(!actor?.userId||isAgentActor(actor))deny('须由本人连接',403,'FORBIDDEN');
    const allowed=mode==='operate'?AGENT_OPERATE_CEILING:WORK_ASSISTANT_CEILING,ceil=allowed.filter(scope=>(!priorCeiling||priorCeiling.includes(scope))&&hasScope(actor,scope as any)),iat=now();
    return{v:2,kind:'mist-agent-connection',sub:actor.userId,...(actor.companyId?{companyId:actor.companyId}:{}),sid:id,wid:workspaceId,generation:randomUUID(),ceil,iat,exp:iat+ttl,...(mode==='operate'?{mode}:{}),...(actor.credentialVersion?{credentialVersion:actor.credentialVersion}:{})};
  }
  function signManaged(payload:ManagedAgentPayload):AgentDelegationIssue {
    // JSON persistence can reorder object keys. A retry must reproduce the same credential.
    const sorted=(v:any):any=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
    const data=Buffer.from(JSON.stringify(sorted(payload))).toString('base64url');return{token:`${data}.${signature(data)}`,sessionId:payload.sid,expiresAt:new Date(payload.exp).toISOString(),ceiling:[...payload.ceil],mode:payload.mode==='operate'?'operate':'read'};
  }
  function verify(token: unknown): AgentDelegationPayload|ManagedAgentPayload {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) deny('工作助手委托无效，请在页面上重新连接');
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) deny('工作助手委托签名无效');
    const expected = signature(parts[0]);
    if (parts[1].length !== expected.length || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) deny('工作助手委托签名无效');
    let payload: AgentDelegationPayload|ManagedAgentPayload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { deny('工作助手委托格式无效'); }
    if (!payload! || typeof payload! !== 'object' || Array.isArray(payload!) || !(payload!.v===1&&payload!.kind==='mist-agent'||payload!.v===2&&payload!.kind==='mist-agent-connection')
      || (payload!.companyId !== undefined && typeof payload!.companyId !== 'string')
      || typeof payload!.sub !== 'string' || !payload!.sub || payload!.sub.length > 300 || typeof payload!.sid !== 'string' || !payload!.sid
      || (payload!.mode !== undefined && payload!.mode !== 'operate')
      || !Array.isArray(payload!.ceil) || payload!.ceil.some(scope => typeof scope !== 'string' || !(payload!.mode === 'operate' ? AGENT_OPERATE_CEILING : WORK_ASSISTANT_CEILING).includes(scope))
      || !Number.isSafeInteger(payload!.exp) || !Number.isSafeInteger(payload!.iat) || payload!.exp <= payload!.iat
      || payload!.credentialVersion!==undefined&&typeof payload!.credentialVersion!=='string'
      || payload!.v===2&&(typeof payload!.wid!=='string'||!payload!.wid||typeof payload!.generation!=='string'||!payload!.generation)
      || payload!.iat > now() + 30_000 || payload!.exp - payload!.iat > ttl) deny('工作助手委托格式无效');
    if (payload!.exp <= now()) deny('工作助手委托已过期，请在页面上续签', 401, 'AGENT_DELEGATION_EXPIRED');
    return payload!;
  }

  /** 还原委托身份：permissionCeiling 只来自签名内容，且不含 '*'。 */
  async function authenticate(token: unknown,authorizeManaged?:(actor:AgentActor,payload:ManagedAgentPayload)=>Promise<void>,requireManaged=false): Promise<AgentActor> {
    const payload = verify(token);
    if(requireManaged&&payload.v!==2)deny('授权已更新，请重新连接',401,'AGENT_CONNECTION_UPGRADE_REQUIRED');
    const base = await options.resolve(payload.sub);
    if (!base?.userId || base.userId !== payload.sub) deny('工作助手委托对应的账号无效');
    const actor:AgentActor={ ...base, ...(payload.companyId ? { companyId: payload.companyId } : {}),credentialVersion:payload.credentialVersion,iat:Math.floor(payload.iat/1000), permissionCeiling: [...payload.ceil], actorKind: 'agent', agentSessionId: payload.sid, agentMode: payload.mode === 'operate' ? 'operate' : 'read',...(payload.v===2?{agentWorkspaceId:payload.wid,agentLease:payload}:{}) } as AgentActor;
    if(payload.v===2){if(!authorizeManaged)deny('连接登记校验不可用',503);await authorizeManaged!(actor,payload);}
    return actor;
  }

  return { issue, verify, authenticate,prepareManaged,signManaged,timestamp:now };
}
export type AgentDelegation = ReturnType<typeof createAgentDelegation>;
