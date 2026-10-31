/**
 * Mist 的标准 MCP 接口（JSON-RPC 2.0，POST /api/mist/mcp）：让桌面工作助手和外部 Agent 不经前端操作同一套业务。
 *
 * - 身份：本人会话签发的委托令牌（x-bambook-delegation）；只读委托只能用读取类工具，可办理委托（mode=operate）还能预演与执行。
 * - 写入只走 repository.preview / repository.execute，与页面同一事务、同一套账号 / 成员 / 权限 / 数据范围 / 业务门禁，不另开后门。
 * - 确认 / 删除 / 资金 / 对外发送类命令（agentCommandSensitivity === 'confirm'）不直接执行：预演通过后记为 Agent 提议，本人确认后才执行（2026-10-30 用户定案）。
 * - 经 Agent 的写入由仓储在业务事件经办人后标注“经 Agent”，与人工操作同处可查。
 */
import { randomUUID } from 'node:crypto';
import type { TokenPayload } from '../auth/service';
import type { MistState } from '../shared/mistWorkspace';
import { isAgentActor } from './agentDelegation';
import { MIST_COMMAND_CATALOG } from './agentCommandCatalog';
import { AGENT_OBJECT_TYPES, agentGet, agentQuery, agentRelated } from './agentRead';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26'];
type CatalogEntry = (typeof MIST_COMMAND_CATALOG)[number];
const COMMANDS = new Map<string, CatalogEntry>(MIST_COMMAND_CATALOG.map(entry => [entry.type, entry]));

const CONFIRM_PREFIXES = ['payable.', 'finance.', 'funding.', 'fxrate.', 'lc.', 'rebate.', 'opening.', 'platform.credit.', 'platform.invoice.issue', 'platform.claim.recovery.', 'platform.pricingParams.', 'platform.employee.', 'market.supplier.bank.', 'settings.', 'member.', 'teamScope.', 'handover.', 'email.server.'];
const CONFIRM_VERB = /(^|\.)(confirm|approve|decide|reject|void|reverse|cancel|delete|remove|close|archive|issue|send|notify|present|refund|waive|withdraw|transition|execute|settle|allocate|assign|release|lock|reconcile|import|restore|purge)/i;
/** 采购经办提交结算只是交给财务复核，不改应付；其余 payable.* 都须本人确认。 */
const NORMAL_EXCEPTIONS = new Set(['payable.settlement.submit']);
const NEVER_VIA_AGENT = new Set(['files.add']);

/** confirm：须本人在系统中确认；normal：可由可办理委托直接执行；blocked：不能经接口执行。 */
export function agentCommandSensitivity(type: string): 'normal' | 'confirm' | 'blocked' {
  if (NEVER_VIA_AGENT.has(type) || type.startsWith('email.server.') || type.startsWith('agent.')) return 'blocked';
  if (NORMAL_EXCEPTIONS.has(type)) return 'normal';
  if (CONFIRM_PREFIXES.some(prefix => type.startsWith(prefix)) || CONFIRM_VERB.test(type.slice(type.indexOf('.') + 1))) return 'confirm';
  return 'normal';
}

export type McpRepository = {
  list(actor: TokenPayload): Promise<Array<{ id: string; name: string; revision: number }>>;
  getForAgent(actor: TokenPayload, id: string): Promise<{ workspace: { id: string; name: string; revision: number; state: MistState }; actor: TokenPayload }>;
  preview(actor: TokenPayload, id: string, input: { requestId: string; expectedRevision: number; command: { type: string; payload: Record<string, unknown> } }): Promise<unknown>;
  execute(actor: TokenPayload, id: string, input: { requestId: string; expectedRevision: number; command: { type: string; payload: Record<string, unknown> } }): Promise<{ receipt: unknown; replayed?: boolean }>;
  receipt(actor: TokenPayload, id: string, requestId: string): Promise<{ expectedRevision: number; result?: { id?: unknown } }>;
  agentAudits(actor:TokenPayload,id:string,input?:Record<string,unknown>):Promise<unknown>;
  agentAudit(actor:TokenPayload,id:string,requestId:string,input?:Record<string,unknown>):Promise<unknown>;
};

const str = (description: string) => ({ type: 'string', description });
const commandSchema = { type: 'object', description: 'Mist 类型化命令，type 取自 bambook_commands', properties: { type: str('命令类型，如 payable.settlement.submit'), payload: { type: 'object', description: '按 bambook_commands 给出的 payload 结构填写' } }, required: ['type', 'payload'] };
const TOOLS = [
  { name: 'bambook_workspaces', description: '列出当前账号可访问的公司工作区（id、名称、版本）。', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'bambook_query', description: '按对象类型和关键词查找业务对象（客户、订单、采购合同、出运等），结果已按当前账号权限和数据范围裁剪。', inputSchema: { type: 'object', properties: { workspaceId: str('工作区 id'), type: { type: 'string', enum: AGENT_OBJECT_TYPES.map(t => t.type) }, q: str('关键词，可选'), limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['workspaceId'] }, annotations: { readOnlyHint: true } },
  { name: 'bambook_get', description: '读取一个业务对象的详情。', inputSchema: { type: 'object', properties: { workspaceId: str('工作区 id'), type: { type: 'string', enum: AGENT_OBJECT_TYPES.map(t => t.type) }, id: str('对象 id') }, required: ['workspaceId', 'type', 'id'] }, annotations: { readOnlyHint: true } },
  { name: 'bambook_related', description: '展开一个业务对象的关联对象（如合同的收货、结算、票据）。', inputSchema: { type: 'object', properties: { workspaceId: str('工作区 id'), type: { type: 'string', enum: AGENT_OBJECT_TYPES.map(t => t.type) }, id: str('对象 id') }, required: ['workspaceId', 'type', 'id'] }, annotations: { readOnlyHint: true } },
  { name: 'bambook_commands', description: '列出可用的业务命令、payload 结构，以及是否须本人确认（confirm）。', inputSchema: { type: 'object', properties: { prefix: str('按命令前缀筛选，如 payable. 或 fulfillment.；带前缀时附上 payload 引用的类型定义（types）') } }, annotations: { readOnlyHint: true } },
  {name:'bambook_audit',description:'查看本人的Agent操作记录；有审计权限时可查当前公司。提供requestId读取按当前权限裁剪的变更详情，offset/limit翻页；includeCommand显式请求可见的原始命令。历史不能恢复已经失去的业务访问权。',inputSchema:{type:'object',properties:{workspaceId:str('工作区id'),requestId:str('原业务请求编号；不提供时列出记录'),scope:{type:'string',enum:['mine','company']},actorId:str('公司范围内按经办账号筛选'),proposalId:str('同一提议的操作'),agentSessionId:str('同一Agent会话的操作'),source:{type:'string',enum:['agent','human_confirmation','human_rejection']},phase:{type:'string',enum:['executed','proposed','confirmed','rejected']},since:str('起始ISO时间'),until:str('截止ISO时间'),cursor:str('列表下一页游标'),offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50},includeCommand:{type:'boolean'}},required:['workspaceId']},annotations:{readOnlyHint:true}},
  { name: 'bambook_preview', description: '预演一条命令：执行全部权限与业务校验后回滚，返回将产生的结果和业务事件，不保存任何数据。执行前先预演。', inputSchema: { type: 'object', properties: { workspaceId: str('工作区 id'), command: commandSchema }, required: ['workspaceId', 'command'] }, annotations: { readOnlyHint: true } },
  { name: 'bambook_execute', description: '执行一条命令（与页面操作同一规则并留审计）。每项操作生成一个 requestId，超时重试沿用原编号。确认 / 删除 / 资金 / 对外发送类命令不会直接执行：预演通过后记为提议，用户在「接着完成」里确认后才生效，请告知用户去确认。', inputSchema: { type: 'object', properties: { workspaceId: str('工作区 id'), command: commandSchema, requestId: { ...str('幂等请求编号；同一操作重试必须沿用，新的操作须用新编号'), minLength: 1, maxLength: 116 } }, required: ['workspaceId', 'command', 'requestId'] }, annotations: { destructiveHint: true, idempotentHint: true } },
];

class ToolInputError extends Error {}
const need = (args: Record<string, unknown>, key: string) => { const v = args[key]; if (typeof v !== 'string' || !v.trim() || v.length > 300) throw new ToolInputError(`缺少参数 ${key}`); return v; };
function commandOf(args: Record<string, unknown>) {
  const command = args.command as { type?: unknown; payload?: unknown } | undefined;
  if (!command || typeof command.type !== 'string' || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) throw new ToolInputError('command 需要 type 和 payload 对象');
  if (!COMMANDS.has(command.type)) throw new ToolInputError(`未知命令 ${command.type}，请先用 bambook_commands 查询`);
  return { type: command.type, payload: command.payload as Record<string, unknown> };
}
const canOperate = (actor: TokenPayload) => isAgentActor(actor) && actor.agentMode === 'operate';

async function callTool(repository: McpRepository, actor: TokenPayload, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'bambook_workspaces': return { workspaces: (await repository.list(actor)).map(w => ({ id: w.id, name: w.name, revision: w.revision })) };
    case 'bambook_query': { const { workspace, actor: current } = await repository.getForAgent(actor, need(args, 'workspaceId')); return { revision: workspace.revision, ...agentQuery(workspace.state, current, { type: args.type, q: args.q, limit: args.limit }) }; }
    case 'bambook_get': { const { workspace, actor: current } = await repository.getForAgent(actor, need(args, 'workspaceId')); return { object: agentGet(workspace.state, current, args.type, args.id) }; }
    case 'bambook_related': { const { workspace, actor: current } = await repository.getForAgent(actor, need(args, 'workspaceId')); return { object: agentRelated(workspace.state, current, args.type, args.id) }; }
    case 'bambook_commands': {
      const prefix = typeof args.prefix === 'string' ? args.prefix : '';
      return { commands: [...COMMANDS.values()].filter(c => c.type.startsWith(prefix)).map(c => ({ type: c.type, payload: c.payload, ...(prefix && c.types ? { types: c.types } : {}), via: agentCommandSensitivity(c.type) })) };
    }
    case 'bambook_audit':{
      const workspaceId=need(args,'workspaceId');
      if(args.requestId!==undefined)return repository.agentAudit(actor,workspaceId,need(args,'requestId'),{offset:args.offset,limit:args.limit,includeCommand:args.includeCommand});
      const {workspaceId:_workspace,...input}=args;return repository.agentAudits(actor,workspaceId,input);
    }
    case 'bambook_preview': case 'bambook_execute': {
      if (!isAgentActor(actor)) throw new ToolInputError('MCP 办理需要本人签发的可办理委托');
      if (!canOperate(actor)) throw new ToolInputError('当前是只读委托；预演和执行需要用户在页面上签发“可办理”委托');
      const workspaceId = need(args, 'workspaceId'), command = commandOf(args), via = agentCommandSensitivity(command.type);
      if (via === 'blocked') throw new ToolInputError(`${command.type} 不能经接口执行`);
      const { workspace } = await repository.getForAgent(actor, workspaceId);
      if (name === 'bambook_preview') return { via, ...(await repository.preview(actor, workspaceId, { requestId: `mcp-preview-${randomUUID()}`, expectedRevision: workspace.revision, command }) as object) };
      const operationId = args.requestId;
      if (typeof operationId !== 'string' || !operationId.trim() || operationId !== operationId.trim() || operationId.length > 116) throw new ToolInputError('执行需要 1–116 字的 requestId；同一操作重试请沿用原编号');
      const requestId = `mcp-${operationId}`;
      // 重试同一请求编号时沿用原版本号：相同命令按原回执重放，不同命令仍被拒绝。
      const prior = await repository.receipt(actor, workspaceId, requestId).catch(() => null);
      if (via === 'confirm') {
        // 高敏感命令：先按 Agent 身份完整预演（不合规的不提交），再记为提议，等本人在「接着完成」里确认执行。
        const preview = prior ? null : await repository.preview(actor, workspaceId, { requestId: `mcp-preview-${randomUUID()}`, expectedRevision: workspace.revision, command }) as { events?: string[] };
        // 重试必须沿用原提议说明；换成通用文字会改变请求哈希，让同一编号误报冲突。
        // 仅在当前本人可见的提议中查找，不因重试重新提交或再次执行已确认的业务。
        const original = prior ? workspace.state.agentProposals?.find(item => item.id === prior.result?.id && item.ownerId === actor.userId) : undefined;
        if (prior && !original) throw new ToolInputError('请求编号已用于另一项操作，不能重复使用');
        const summary = original ? original.summary : preview?.events?.length ? preview.events.slice(0, 10) : [`执行 ${command.type}`];
        const { receipt, replayed } = await repository.execute(actor, workspaceId, { requestId, expectedRevision: prior ? prior.expectedRevision : workspace.revision, command: { type: 'agent.proposal.create', payload: { command, summary } } });
        const status = original?.state === 'confirmed' ? 'confirmed' : original?.state === 'rejected' ? 'rejected' : 'awaiting_confirmation';
        const message = status === 'confirmed' ? '此提议已由本人确认执行，本次只回放原回执。' : status === 'rejected' ? '此提议已被本人拒绝，本次没有执行。' : '已提交给用户确认：用户在「接着完成」里确认后才会执行。';
        return { status, message, summary, receipt, replayed: !!replayed };
      }
      const { receipt, replayed } = await repository.execute(actor, workspaceId, { requestId, expectedRevision: prior ? prior.expectedRevision : workspace.revision, command });
      return { receipt, replayed: !!replayed };
    }
    default: throw new ToolInputError(`未知工具 ${name}`);
  }
}

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** 处理一条 JSON-RPC 消息；通知（无 id）返回 null，由路由回 202。 */
export async function handleMcpMessage(repository: McpRepository, actor: TokenPayload, message: RpcRequest, describeError: (error: unknown) => string): Promise<object | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Invalid Request');
  const { id, method } = message, params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
  if (id === undefined) return null;
  switch (method) {
    case 'initialize': return { jsonrpc: '2.0', id, result: { protocolVersion: typeof params.protocolVersion === 'string' && MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'bambook-mist', version: '1' },
      instructions: '先用 bambook_workspaces 取得工作区，再查询；写入前先 bambook_preview。确认、删除、资金、对外发送类命令执行后只会成为提议，请告诉用户到「接着完成」里确认。' } };
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      const name = params.name, args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      if (typeof name !== 'string') return rpcError(id, -32602, 'Invalid params');
      try {
        const data = await callTool(repository, actor, name, args);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } };
      } catch (error) {
        // 业务和权限错误作为工具结果返回，Agent 能据此修正；不暴露内部细节。
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: error instanceof ToolInputError ? error.message : describeError(error) }], isError: true } };
      }
    }
    default: return rpcError(id, -32601, 'Method not found');
  }
}
