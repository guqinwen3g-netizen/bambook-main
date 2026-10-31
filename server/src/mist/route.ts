import { createPublicEntryHostGuard } from '../auth/publicEntryHostGuard';
import { withResponseLocale } from './responseLanguage';
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth/middleware';
import type { TokenPayload } from '../auth/service';
import { MistRepository, type MistContract } from './repository';
import { MistPrivateFiles, MIST_FILE_MAX_BYTES } from './files';
import type { ImagePreviewMode } from './imagePreview';
import { MistApiError, fail } from './errors';
import {getMistAssistantStatus,runMistAssistant} from './assistant';
import { analyzeEmail } from './mail/intelligence';
import {runQuoteCostAdvisor} from './quoteCostAdvisor';
import { hasScope } from '../auth/permissionService';
import { codexSubscriptions, CodexSubscriptionError, PLATFORM_SUBJECT, personalSubject, type CodexSubscriptionService } from '../ai/codexSubscription';
import { platformProfileList } from '../ai/platformModel';
import { platformProviders, type PlatformProviderStore } from '../ai/platformProviders';
import { resolveEnvProviderChain, testLlmProvider } from '../ai/llmProviders';
import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { handleMcpMessage, MCP_PROTOCOL_VERSIONS, type McpRepository } from './agentMcp';
import { AGENT_DELEGATION_HEADER, agentRouteAllowed, createAgentDelegation, isAgentActor, type AgentDelegation } from './agentDelegation';
import { agentCatalog, agentGet, agentQuery, agentRelated } from './agentRead';
import {SERVICE_KEY_HEADER} from './agentIdentities';
import type { MistMailReceiver } from './mail/receiverWorker';
import { MistMailService } from './mail/service';
import { MistMailCredentials } from './mail/credentials';
import type { MailTransport } from './mail/transport';
/** 服务端模式：委托签名密钥从 JWT 密钥派生（生产启动已强制配置）；还原的执行者没有任何权限，仓储会在事务里重新加载真实账号。 */
export function defaultAgentDelegation(): AgentDelegation {
  return createAgentDelegation({
    rootSecret: () => process.env.JWT_SECRET || 'change-me-in-production-at-least-32-chars',
    resolve: userId => ({ userId, roles: [], permissions: [], departmentIds: [], authorizationLoaded: true }),
  });
}
function exactBody(body: unknown, allowed: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail('INVALID_INPUT', '请求字段无效；身份只能来自登录会话', 400);
  return body as Record<string, any>;
}
function publicError(res: Response, error: any) {
  const known = error instanceof MistApiError || (typeof error?.code === 'string' && Number(error?.status) >= 400 && Number(error?.status) < 500);
  res.status(known ? Number(error.status) : 500).json({ ok: false, error: { code: known ? error.code : 'MIST_REQUEST_FAILED', message: known ? error.message : '公司操作未完成，请查询原请求回执或稍后重试' } });
}
export function createMistRouter(options: { prisma?: any; platformProviders?: PlatformProviderStore; filesRoot?: string; repository?: MistRepository; contract?: MistContract; authenticate?: RequestHandler; subscriptions?: CodexSubscriptionService; mail?: MistMailService; mailReceiver?: MistMailReceiver; mailTransport?: MailTransport; mailCredentialsRoot?: string; delegation?: AgentDelegation; delegationGuard?: (req: Request) => void }) {
  const repository = options.repository ?? new MistRepository(options.prisma, options.contract ?? require('../shared/mistWorkspace') as MistContract, new MistPrivateFiles(options.filesRoot ?? path.resolve(__dirname, '../../private/mist-files')));
  const router = Router();
  const authenticate = options.authenticate ?? requireAuth;
  const delegation = options.delegation ?? defaultAgentDelegation();
  // 带委托头的请求一律按工作助手身份处理（比本人会话更窄），且只放行工作助手读取接口。
  router.use((req, res, next) => {
    const header = req.headers[AGENT_DELEGATION_HEADER];
    const serviceKey=req.headers[SERVICE_KEY_HEADER];
    if (header === undefined&&serviceKey===undefined) { authenticate(req, res, next); return; }
    void (async () => {
      options.delegationGuard?.(req);
      if(header!==undefined&&serviceKey!==undefined)fail('AGENT_KEY_INVALID','请只使用一种Agent凭据',401);
      let agent;
      if(serviceKey!==undefined){agent=await delegation.hydrateServiceActor(await repository.resolveAgentServiceKey(serviceKey));await repository.authorizeAgentConnection(agent);}
      else {if (typeof header !== 'string') fail('AGENT_DELEGATION_INVALID', '工作助手委托无效', 401);agent=await delegation.authenticate(header, actor=>repository.authorizeAgentConnection(actor),true);}
      if (!agentRouteAllowed(req.method, req.path)) fail('AGENT_FORBIDDEN', '工作助手委托只能读取业务数据，不能调用此接口', 403);
      (req as Request & { actor: TokenPayload }).actor = agent;
      res.setHeader('Cache-Control', 'private, no-store');
      next();
    })().catch(error => publicError(res, error));
  });
  router.use(createPublicEntryHostGuard('mist'));
  const actor = (req: Request) => (req as Request & { actor: TokenPayload }).actor;
  const run = (handler: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res) => { void handler(req, res).catch(error => publicError(res, error)); };
  // ChatGPT 订阅连接：凭据只留在服务器，响应只含连接状态与设备验证码。
  //   - 平台连接（管理员）：平台 AI 固定流程共用；测试期为管理员个人订阅，生产期改企业 API。
  //   - 个人连接（ai:chat）：仅供后续本机工作助手使用，不参与平台 AI。
  const subscriptions = () => options.subscriptions ?? codexSubscriptions();
  const aiActor = (req: Request) => { const a = actor(req); if (!a?.userId || !hasScope(a, 'ai:chat')) fail('FORBIDDEN', '当前账号无助手使用权限', 403); return a; };
  const platformAdmin = async (req: Request) => { const a = actor(req); if (options.prisma) { const current = a?.userId ? await options.prisma.userAccount.findUnique({ where: { id: a.userId }, select: { platformRole: true, status: true, deletedAt: true } }) : null; if (!current || current.status !== 'active' || current.deletedAt || current.platformRole !== 'platform_admin') fail('FORBIDDEN', '仅平台管理员可配置平台模型', 403); } else if (!a?.userId || !(a.roles ?? []).some(role => role === 'owner' || role === (SYSTEM_ROLE_IDS.SUPER_ADMIN as unknown))) fail('FORBIDDEN', '仅管理员可配置平台模型', 403); return a; };
  const subscriptionCall = (handler: (req: Request, res: Response) => Promise<void> | void) => run(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { await handler(req, res); } catch (error) {
      if (error instanceof CodexSubscriptionError) throw new MistApiError(error.code, error.message, error.status >= 400 && error.status < 500 ? error.status : 502);
      throw error;
    }
  });
  // 平台 API 提供方（平台管理员）：Key 只写不读，响应与审计只含名称、主机与模型。
  const providerStore = () => options.platformProviders ?? platformProviders();
  const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };
  const envView = () => resolveEnvProviderChain().map(p => ({ id: 'env:' + p.id, host: hostOf(p.baseUrl), model: p.model }));
  const platformView = () => ({ chatgpt: subscriptions().status(PLATFORM_SUBJECT), profiles: platformProfileList(), api: providerStore().list(), env: envView() });
  const providerAudit = async (req: Request, action: string, targetId: string, detail: Record<string, unknown>) => {
    if (!options.prisma) return;
    await options.prisma.auditLog.create({ data: { id: randomUUID(), actorId: actor(req).userId, action, targetType: 'PlatformAiProvider', targetId, detail } });
  };
  const brief = (p: { name: string; baseUrl: string; model: string; enabled: boolean }) => ({ name: p.name, host: hostOf(p.baseUrl), model: p.model, enabled: p.enabled });
  router.get('/ai/platform-model', subscriptionCall(async (req, res) => { await platformAdmin(req); res.json(platformView()); }));
  router.post('/ai/platform-model/chatgpt/login', subscriptionCall(async (req, res) => { await platformAdmin(req); exactBody(req.body ?? {}, []); res.status(201).json({ login: await subscriptions().startLogin(PLATFORM_SUBJECT) }); }));
  router.get('/ai/platform-model/chatgpt/login/:loginId', subscriptionCall(async (req, res) => { await platformAdmin(req); res.json({ login: subscriptions().getLogin(PLATFORM_SUBJECT, req.params.loginId), ...platformView() }); }));
  router.post('/ai/platform-model/chatgpt/disconnect', subscriptionCall(async (req, res) => { await platformAdmin(req); exactBody(req.body ?? {}, []); subscriptions().disconnect(PLATFORM_SUBJECT); res.json(platformView()); }));
  router.post('/ai/platform-model/providers', subscriptionCall(async (req, res) => {
    await platformAdmin(req);
    const created = providerStore().create(req.body ?? {});
    await providerAudit(req, 'platform.ai.provider.create', created.id, brief(created));
    res.status(201).json({ provider: created, ...platformView() });
  }));
  router.patch('/ai/platform-model/providers/:id', subscriptionCall(async (req, res) => {
    await platformAdmin(req);
    const keyChanged = typeof req.body?.apiKey === 'string' && req.body.apiKey !== '';
    const { before, after } = providerStore().update(req.params.id, req.body ?? {});
    await providerAudit(req, 'platform.ai.provider.update', after.id, { before: brief(before), after: brief(after), keyChanged });
    res.json({ provider: after, ...platformView() });
  }));
  router.delete('/ai/platform-model/providers/:id', subscriptionCall(async (req, res) => {
    await platformAdmin(req);
    const removed = providerStore().remove(req.params.id);
    await providerAudit(req, 'platform.ai.provider.delete', removed.id, brief(removed));
    res.json(platformView());
  }));
  router.put('/ai/platform-model/order', subscriptionCall(async (req, res) => {
    await platformAdmin(req);
    const { before, after } = providerStore().reorder(req.body ?? {});
    await providerAudit(req, 'platform.ai.provider.order', 'order', { before, after });
    res.json(platformView());
  }));
  router.post('/ai/platform-model/providers/:id/test', subscriptionCall(async (req, res) => {
    await platformAdmin(req);
    exactBody(req.body ?? {}, []);
    const provider = providerStore().get(req.params.id);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000), started = Date.now();
    timer.unref?.();
    try {
      await testLlmProvider({ id: 'test', baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model }, controller.signal);
      res.json({ ok: true, latencyMs: Date.now() - started });
    } catch (error: any) {
      const cause = typeof error?.cause?.code === 'string' ? error.cause.code : '';
      const message = controller.signal.aborted ? '连接超时（20 秒内无响应）'
        : error?.message === 'fetch failed' || cause ? `无法连接到接口地址${cause ? '（' + cause + '）' : ''}，请检查地址是否正确，以及服务器能否访问该地址`
        : String(error?.message || error).split(provider.apiKey).join('••••').slice(0, 300);
      res.json({ ok: false, error: message || '连接失败' });
    } finally { clearTimeout(timer); }
  }));
  router.get('/ai/subscriptions', subscriptionCall((req, res) => { res.json({ chatgpt: subscriptions().status(personalSubject(aiActor(req).userId)) }); }));
  router.post('/ai/subscriptions/chatgpt/login', subscriptionCall(async (req, res) => { const a = aiActor(req); exactBody(req.body ?? {}, []); res.status(201).json({ login: await subscriptions().startLogin(personalSubject(a.userId)) }); }));
  router.get('/ai/subscriptions/chatgpt/login/:loginId', subscriptionCall((req, res) => { const a = aiActor(req); res.json({ login: subscriptions().getLogin(personalSubject(a.userId), req.params.loginId), chatgpt: subscriptions().status(personalSubject(a.userId)) }); }));
  router.post('/ai/subscriptions/chatgpt/disconnect', subscriptionCall((req, res) => { const a = aiActor(req); exactBody(req.body ?? {}, []); res.json({ chatgpt: subscriptions().disconnect(personalSubject(a.userId)) }); }));
  const connectionReply=(result:any)=>({...result,payload:undefined,...(result.payload?{delegation:delegation.signManaged(result.payload),readable:agentCatalog({userId:result.payload.sub,roles:[],permissions:result.payload.ceil,departmentIds:[],permissionCeiling:result.payload.ceil,authorizationLoaded:true})}:{} )});
  router.get('/workspaces/:id/agent-identities',run(async(req,res)=>{const query=exactBody(req.query,['scope','cursor']);res.setHeader('Cache-Control','private, no-store');res.json(await repository.agentIdentities(actor(req),req.params.id,delegation.timestamp(),query.scope??'mine',query.cursor));}));
  router.post('/workspaces/:id/agent-identities',run(async(req,res)=>{const body=exactBody(req.body??{},['id','name','ownerId','mode']);res.setHeader('Cache-Control','private, no-store');res.status(201).json(await repository.createAgentIdentity(actor(req),req.params.id,body,delegation.timestamp()));}));
  router.post('/workspaces/:id/agent-identities/:identityId/configure',run(async(req,res)=>{const body=exactBody(req.body??{},['requestId','version','name','ownerId','mode','enabled']);res.setHeader('Cache-Control','private, no-store');res.json(await repository.configureAgentIdentity(actor(req),req.params.id,req.params.identityId,body,delegation.timestamp()));}));
  router.post('/workspaces/:id/agent-identities/:identityId/issue',run(async(req,res)=>{const body=exactBody(req.body??{},['requestId','version']);res.setHeader('Cache-Control','private, no-store');res.json(await repository.issueAgentServiceKey(actor(req),req.params.id,req.params.identityId,body,delegation.makeServiceCredential,delegation.timestamp()));}));
  router.post('/workspaces/:id/agent-identities/:identityId/revoke',run(async(req,res)=>{const body=exactBody(req.body??{},['requestId']);res.setHeader('Cache-Control','private, no-store');res.json(await repository.revokeAgentServiceKey(actor(req),req.params.id,req.params.identityId,body,delegation.timestamp()));}));
  router.get('/workspaces/:id/agent-identities/:identityId/history',run(async(req,res)=>{const query=exactBody(req.query,['cursor']);res.setHeader('Cache-Control','private, no-store');res.json(await repository.agentIdentityHistory(actor(req),req.params.id,req.params.identityId,query.cursor));}));
  router.get('/workspaces/:id/agent-connections',run(async(req,res)=>{const query=exactBody(req.query,['cursor']);res.setHeader('Cache-Control','private, no-store');res.json(await repository.agentConnections(actor(req),req.params.id,query.cursor,delegation.timestamp()));}));
  router.get('/workspaces/:id/agent-connections/:connectionId',run(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json(await repository.agentConnection(actor(req),req.params.id,req.params.connectionId,delegation.timestamp()));}));
  router.post('/workspaces/:id/agent-connections',run(async(req,res)=>{const input=exactBody(req.body??{},['id','name','mode']);const result=await repository.createAgentConnection(actor(req),req.params.id,input,delegation.prepareManaged,delegation.timestamp());res.setHeader('Cache-Control','private, no-store');res.status(201).json(connectionReply(result));}));
  for(const action of ['renew','revoke'] as const)router.post('/workspaces/:id/agent-connections/:connectionId/'+action,run(async(req,res)=>{const input=exactBody(req.body??{},['requestId','version']);const result=await repository.changeAgentConnection(actor(req),req.params.id,req.params.connectionId,action,input,delegation.prepareManaged,delegation.timestamp());res.setHeader('Cache-Control','private, no-store');res.json(connectionReply(result));}));
  // Compatibility entry for the desktop bridge: all newly issued credentials are registered v2.
  router.post('/agent/delegations', run(async (req, res) => {
    const body = exactBody(req.body ?? {}, ['mode','workspaceId','id']);
    if (body.mode !== undefined && body.mode !== 'read' && body.mode !== 'operate') fail('INVALID_INPUT', '委托类型无效', 400);
    const current = await repository.currentActor(actor(req), 'ai:chat');
    if(typeof body.workspaceId!=='string'||typeof body.id!=='string')fail('CONNECTION_UPGRADE_REQUIRED','请更新客户端后重新连接',400);
    const result=await repository.createAgentConnection(actor(req),body.workspaceId,{id:body.id,name:'桌面工作助手',mode:body.mode==='operate'?'operate':'read'},delegation.prepareManaged,delegation.timestamp());
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(201).json({...connectionReply(result),readable:agentCatalog({...current,permissionCeiling:result.payload.ceil})});
  }));
  // 标准 MCP 接口（JSON-RPC）：读取、命令目录、预演与执行普通命令；高敏感命令须本人在系统中确认。
  const checkMcpProtocol = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const protocol = req.headers['mcp-protocol-version'];
    if (protocol !== undefined && (typeof protocol !== 'string' || !MCP_PROTOCOL_VERSIONS.includes(protocol))) fail('MCP_PROTOCOL_UNSUPPORTED', '不支持该 MCP 协议版本，请重新连接', 400);
  };
  router.post('/mcp', run(async (req, res) => {
    checkMcpProtocol(req, res);
    const describe = (error: any) => error instanceof MistApiError || (typeof error?.code === 'string' && Number(error?.status) >= 400 && Number(error?.status) < 500) ? String(error.message) : '操作未完成，请稍后重试';
    const reply = await handleMcpMessage(repository as unknown as McpRepository, actor(req), req.body, describe);
    if (reply === null) { res.status(202).end(); return; }
    res.json(reply);
  }));
  router.get('/mcp', run(async (req, res) => { checkMcpProtocol(req, res); res.status(405).set('Allow', 'POST').end(); }));
  router.get('/workspaces/:id/agent/query', run(async (req, res) => {
    const { workspace, actor: current } = await repository.getForAgent(actor(req), req.params.id);
    res.json({ workspace: { id: workspace.id, name: workspace.name, revision: workspace.revision }, ...agentQuery(workspace.state, current, { type: req.query.type, q: req.query.q, limit: req.query.limit }) });
  }));
  router.get('/workspaces/:id/agent/objects/:type/:objectId', run(async (req, res) => {
    const { workspace, actor: current } = await repository.getForAgent(actor(req), req.params.id);
    res.json({ workspace: { id: workspace.id, name: workspace.name, revision: workspace.revision }, object: agentGet(workspace.state, current, req.params.type, req.params.objectId) });
  }));
  router.get('/workspaces/:id/agent/objects/:type/:objectId/related', run(async (req, res) => {
    const { workspace, actor: current } = await repository.getForAgent(actor(req), req.params.id);
    res.json({ workspace: { id: workspace.id, name: workspace.name, revision: workspace.revision }, object: agentRelated(workspace.state, current, req.params.type, req.params.objectId) });
  }));
  router.get('/reviews', run(async (req,res)=>{res.json({reviews:await repository.listReviews(actor(req))});}));
  router.get('/reviews/:workspaceId/receipts/:requestId', run(async (req,res)=>{res.json({receipt:await repository.reviewReceipt(actor(req),req.params.workspaceId,req.params.requestId)});}));
  router.get('/reviews/:workspaceId/:reviewId/files/:fileId',run(async(req,res)=>{const {file,bytes}=await repository.reviewFile(actor(req),req.params.workspaceId,req.params.reviewId,req.params.fileId);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.type('application/octet-stream').send(Buffer.from(bytes));}));
  router.post('/reviews/:workspaceId/:reviewId', run(async (req,res)=>{const body=exactBody(req.body,['requestId','expectedRevision','decision','note']);res.json(await repository.decideReview(actor(req),req.params.workspaceId,req.params.reviewId,body as any));}));
  router.get('/workspaces/default', run(async (req, res) => { res.json({ workspace: await repository.create(actor(req), { name: '公司业务', seed: actor(req)?.companyId ? 'empty' : 'demo' }, true) }); }));
  router.get('/workspaces', run(async (req, res) => {
    const workspaces = req.query.summary === '1' ? await repository.listSummaries(actor(req)) : await repository.list(actor(req));
    res.json({ workspaces: isAgentActor(actor(req)) ? workspaces.map((w: { id: string; name: string; revision: number }) => ({ id: w.id, name: w.name, revision: w.revision })) : workspaces });
  }));
  router.get('/workspaces/archived',run(async(req,res)=>{res.json({workspaces:await repository.listArchived(actor(req))});}));
  router.post('/workspaces', run(async (req, res) => {
    const body = exactBody(req.body, ['name', 'slug', 'seed']);
    res.status(201).json({ workspace: await repository.create(actor(req), body as any) });
  }));
  router.get('/workspaces/:id', run(async (req, res) => { res.json({ workspace: await repository.get(actor(req), req.params.id) }); }));
  router.get('/workspaces/:id/revision', run(async (req, res) => { res.json(await repository.revisionOf(actor(req), req.params.id)); }));
  router.post('/workspaces/:id/archive',run(async(req,res)=>{const body=exactBody(req.body,['requestId','expectedRevision']);res.json(await repository.changeArchive(actor(req),req.params.id,body as any,'archive'));}));
  router.post('/workspaces/:id/restore',run(async(req,res)=>{const body=exactBody(req.body,['requestId','expectedRevision']);res.json(await repository.changeArchive(actor(req),req.params.id,body as any,'restore'));}));
  router.post('/workspaces/:id/members',run(async(req,res)=>{const body=exactBody(req.body,['requestId','expectedRevision','action','account']);res.json(await repository.changeMember(actor(req),req.params.id,body as any));}));
  router.get('/workspaces/:id/assistant/status',run(async(req,res)=>{await repository.getForAssistant(actor(req),req.params.id);res.json(getMistAssistantStatus());}));
  router.post('/workspaces/:id/assistant',run(async(req,res)=>{const context=await repository.getForAssistant(actor(req),req.params.id);const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});res.json(await runMistAssistant({...context,body:withResponseLocale(req.body,req.get('X-Bambook-Locale')),signal:controller.signal}));}));
  router.post('/workspaces/:id/quotation-cost-advisor',run(async(req,res)=>{const context=await repository.getForAssistant(actor(req),req.params.id);const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});res.setHeader('Cache-Control','private, no-store');res.json(await runQuoteCostAdvisor({...context,body:withResponseLocale(req.body,req.get('X-Bambook-Locale')),signal:controller.signal}));}));
  router.get('/workspaces/:id/team-scopes', run(async (req, res) => { res.json(await repository.teamScopes(actor(req), req.params.id)); }));
  router.post('/workspaces/:id/team-scopes/preview', run(async (req, res) => { res.json(await repository.previewTeamScope(actor(req), req.params.id, exactBody(req.body, ['teamId', 'conditions', 'picks', 'exclusions', 'note']))); }));
  router.post('/workspaces/:id/commands', run(async (req, res) => {
    const body = exactBody(req.body, ['requestId', 'expectedRevision', 'command']);
    exactBody(body.command, ['type', 'payload']);
    res.json(await repository.execute(actor(req), req.params.id, body as any));
  }));
  // 智能邮箱真实收发：凭据只写入服务端，响应只含公司投影与操作结果。
  const mail = options.mail ?? new MistMailService(repository, new MistMailCredentials(options.mailCredentialsRoot ?? process.env.MIST_MAIL_CREDENTIAL_DIR ?? path.resolve(__dirname, '../../private/mist-mail-credentials')), options.mailTransport);
  const mailCall = (handler: (req: Request) => Promise<any>) => run(async (req, res) => { res.setHeader('Cache-Control', 'private, no-store'); const result = await handler(req); res.json({ workspace: result.workspace, receipt: result.receipt, ...(result.sync ? { sync: result.sync } : {}), ...(result.send ? { send: result.send } : {}) }); });
  router.get('/workspaces/:id/agent/mail-receiving',run(async(req,res)=>{exactBody(req.query,[]);const items=await mail.receivingViews(actor(req),req.params.id);const {workspace}=await repository.getForAgent(actor(req),req.params.id);res.setHeader('Cache-Control','private, no-store');res.json({workspace:{id:workspace.id,revision:workspace.revision},results:items,stateResults:await repository.mailStateViews(actor(req),req.params.id),serviceAvailable:options.mailReceiver?.running===true});}));
  router.get('/workspaces/:id/email/states',run(async(req,res)=>{exactBody(req.query,[]);res.setHeader('Cache-Control','private, no-store');res.json({serviceAvailable:options.mailReceiver?.running===true,items:await repository.mailStateViews(actor(req),req.params.id)});}));
  router.get('/workspaces/:id/email/receiving',run(async(req,res)=>{exactBody(req.query,[]);res.setHeader('Cache-Control','private, no-store');res.json({serviceAvailable:options.mailReceiver?.running===true,items:await mail.receivingViews(actor(req),req.params.id)});}));
  router.put('/workspaces/:id/email/accounts/:accountId/receiving',run(async(req,res)=>{const body=exactBody(req.body??{},['enabled','requestId','version','sourceGeneration']);if(body.enabled===true&&!options.mailReceiver?.running)fail('MAIL_RECEIVER_UNAVAILABLE','自动收件服务未运行，请稍后重试',503);res.setHeader('Cache-Control','private, no-store');res.json({item:await mail.setReceiving(actor(req),req.params.id,req.params.accountId,body)});}));
  router.put('/workspaces/:id/email/accounts/:accountId/credential', mailCall(req => mail.bindCredential(actor(req), req.params.id, req.params.accountId, exactBody(req.body, ['password']).password)));
  router.delete('/workspaces/:id/email/accounts/:accountId/credential', mailCall(req => mail.disconnect(actor(req), req.params.id, req.params.accountId)));
  router.post('/workspaces/:id/email/accounts/:accountId/sync', mailCall(req => { exactBody(req.body ?? {}, []); return mail.sync(actor(req), req.params.id, req.params.accountId); }));
  router.post('/workspaces/:id/email/messages/:messageId/analyze', mailCall(req => {
    const controller = new AbortController(); req.res!.once('close', () => { if (!req.res!.writableEnded) controller.abort(); });
    return analyzeEmail(repository, actor(req), req.params.id, req.params.messageId, withResponseLocale(req.body, req.get('X-Bambook-Locale')), controller.signal);
  }));
  router.post('/workspaces/:id/email/sends', mailCall(req => mail.send(actor(req), req.params.id, exactBody(req.body, ['requestKey', 'draftId', 'input', 'forwardOfId']))));
  router.post('/workspaces/:id/email/sends/:sendId/retry', mailCall(req => mail.retry(actor(req), req.params.id, req.params.sendId, exactBody(req.body ?? {}, ['confirmUnknown']).confirmUnknown)));
  router.post('/workspaces/:id/email/sends/:sendId/verify', mailCall(req => { exactBody(req.body ?? {}, []); return mail.verify(actor(req), req.params.id, req.params.sendId); }));
  router.get('/workspaces/:id/receipts/:requestId', run(async (req, res) => { res.json({ receipt: await repository.receipt(actor(req), req.params.id, req.params.requestId) }); }));
  router.get('/workspaces/:id/agent-audits', run(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json(await repository.agentAudits(actor(req),req.params.id,req.query as any));}));
  router.get('/workspaces/:id/agent-audits/:requestId', run(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json(await repository.agentAudit(actor(req),req.params.id,req.params.requestId,req.query as any));}));
  router.get('/workspaces/:id/credits/:creditId/versions/:versionId/preview.pdf', run(async (req, res) => {
    const document = await repository.previewCreditDocument(actor(req), req.params.id, req.params.creditId, req.params.versionId);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`);
    res.setHeader('X-Document-SHA256', document.sha256); res.type('application/pdf').send(Buffer.from(document.bytes));
  }));
  router.get('/workspaces/:id/credits/:creditId/versions/:versionId/document.pdf', run(async (req, res) => {
    const document = await repository.downloadCreditDocument(actor(req), req.params.id, req.params.creditId, req.params.versionId);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`);
    res.setHeader('X-Document-SHA256', document.sha256); res.type('application/pdf').send(Buffer.from(document.bytes));
  }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MIST_FILE_MAX_BYTES, files: 1, fields: 3, fieldSize: 200 } }).single('file');
  router.post('/workspaces/:id/files', (req: Request, res: Response, next: NextFunction) => {
    // Check owner/account before allocating an uploaded body.
    void repository.get(actor(req), req.params.id).then(() => upload(req, res, error => {
      if (error) { publicError(res, new MistApiError('INVALID_UPLOAD', '请上传单个不超过50MiB的文件', 400)); return; }
      next();
    })).catch(error => publicError(res, error));
  }, run(async (req, res) => {
    const body = exactBody(req.body, ['requestId', 'expectedRevision', 'claimId']);
    if (!req.file) fail('FILE_REQUIRED', '请选择实际文件', 400);
    if (typeof body.expectedRevision !== 'string' || !/^\d+$/.test(body.expectedRevision)) fail('INVALID_INPUT', '公司版本无效', 400);
    res.status(201).json(await repository.upload(actor(req), req.params.id, { requestId: body.requestId, expectedRevision: Number(body.expectedRevision),...(Object.prototype.hasOwnProperty.call(body,'claimId')?{claimId:body.claimId}:{}) }, { bytes: req.file!.buffer, name: req.file!.originalname, multipartFilename: true, mimeType: req.file!.mimetype }));
  }));
  router.get('/workspaces/:id/files/:fileId', run(async (req, res) => {
    const preview = req.query.preview === undefined ? undefined : req.query.preview;
    if (preview !== undefined && !['thumb','display','cutout-thumb','cutout-display'].includes(String(preview))) fail('INVALID_INPUT', '图片预览尺寸无效', 400);
    const { file, bytes,cutout } = await repository.download(actor(req), req.params.id, req.params.fileId, preview as ImagePreviewMode | undefined);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (preview) {
      if(cutout)res.setHeader('X-Bambook-Cutout',cutout);
      res.type('image/webp').send(Buffer.from(bytes));
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.type('application/octet-stream').send(Buffer.from(bytes));
  }));
  return router;
}
