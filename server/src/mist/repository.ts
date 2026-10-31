import {mistBusinessInstant} from '../shared/mistBusinessClock';
import { EMAIL_SERVER_COMMAND, emailAccountAccessible, emailBusinessOwner } from '../shared/mistEmail';
import { emailAnalysisHash } from './mail/intelligence';
import { createHash, randomUUID } from 'node:crypto';
import type { TokenPayload } from '../auth/service';
import type { MistState, MistCommand, MistContext } from '../shared/mistWorkspace';
import { freshMistAuthority, type FreshAuthority } from './authority';
import { fail, MistApiError } from './errors';
import { mistApprovalAuthority } from './context';
import type { MistReviewTask } from '../shared/mistReview';
const REVIEW_COMMAND_BY_KIND = {
  procurement:'fulfillment.procurement.decide',quotation:'market.quotation.decide',
  claim:'platform.claim.decide',order:'order.governance.decide',
  payment:'payable.request.decide',risk:'platform.risk.decide',
  productionIntake:'fulfillment.production.intake.decide',
} as const satisfies Record<MistReviewTask['kind'],MistCommand['type']>;
const REVIEW_KIND_BY_COMMAND = new Map<string,MistReviewTask['kind']>(Object.entries(REVIEW_COMMAND_BY_KIND).map(([kind,type])=>[type,kind as MistReviewTask['kind']]));
import { hasScope } from '../auth/permissionService';
import { isMember, isOwner, memberIds, members, MEMBER_PERSONAL_COMMANDS, projectState, canReadFile, canReadTarget, type MistWorkspaceAccess, type MistMemberLog } from './access';
import { payablesCommandPermissions, financialDisposalViews } from '../shared/mistPayables';
import { MIST_LOCAL_PROFILES, mistLocalPublicUser } from './local';
import { applyRoster, canMaintainCompany, companyDataScope, companyTeamIds, companyLibrary, companyRoster, companyRow, companySlug, companyTeams, localMode, singleLibrary } from './companyLibrary';
import { isAgentActor, type AgentActor } from './agentDelegation';
import { TASK_HASH, TASK_PREFIX, assertHumanTaskProposal, assertTaskControl, assertTaskLease, assertTaskAuthority, assertTaskViewAuthority, advanceTaskSources, changeTask, checkpointTask, claimTask, createTask, finishTask, finishTaskSession, heartbeatTask, issueTaskControl, listTasks, readTaskRecord, reserveTaskStep, resolveTaskControl, resolveTaskCredential, saveTaskSources, settleTaskProposal, taskHistory, taskRecord, taskView, waitTaskForProposal, type MakeTaskCredential, type MakeTaskControl, type TaskRecord } from './agentTasks';
import { collectTaskSources, knownCommandSourcesVisible, taskScopeHash, taskSourcesVisible } from './agentTaskVisibility';
import {assertConnection,listConnections,getConnection,createConnection,changeConnection,type MakeAgentLease} from './agentConnections';
import {assertServiceLease,listIdentities,createIdentity,configureIdentity,issueServiceKey,revokeServiceKey,resolveServiceCredential,identityRecord,identityHistory,serviceCanManage,type MakeServiceCredential} from './agentIdentities';
import { assertReceivingLease, receivingRecord, receivingView, setReceiving, claimReceiving, finishReceiving, blockReceiving, invalidateReceiving, dueReceiving, RECEIVE_LEASE_MS, RECEIVE_INTERVAL_MS, type MailSyncActor, type MailSyncLease, type ReceivingJob, receiveSource } from './mail/receiverRegistry';
import { enqueueMailState, taskHasPendingMail, mailStateViews, pendingMailFields, dueMailState, readMailState, claimMailState, planMailState, rememberMailState, failMailState, completeMailState, type MailStateRecord, type MailStateAttempt } from './mail/stateQueue';
import type { MailStateObservation } from '../shared/mistMailState';
import { AGENT_AUDIT_FIELD, AGENT_AUDIT_HASH, AGENT_AUDIT_PREFIX, agentAuditReceiptId, createAgentCommandAudit, publicCommandReceiptResult } from './agentAudit';
import { auditFromReceipt, auditMatchesParent, auditEntry, projectAgentAudit, readableCommand } from './agentAuditRead';
import { markAgentProposalConfirmed } from '../shared/mistAgentProposals';
import { canGenerateScopedStatement, scopedMaterialIssueTargets, scopedFabricAccess, scopedReferenceViolation, scopedTargetViolation, scopedVisibility, scopedWriteViolation, type MistDataScope } from '../shared/mistDataScope';
import { buildTeamScopeGraph, resolveTeamScope, normalizeTeamScopeInput, previewTeamScope } from '../shared/mistTeamScope';
import { buildMemberDirectory, MIST_MEMBER_DIRECTORY_COMMANDS } from '../shared/mistAccounts';
import { buildLoadedAuthTokenPayload, loadUserWithRoles } from '../auth/tokenHelpers';
import { primaryImageIds } from '../shared/mistPrimaryImage';
import { MistPrivateFiles, validateFileInput, type MistFileInput, type MistStoredFile } from './files';
import type { ImagePreviewMode } from './imagePreview';
import { prepareMistBusinessNumbers } from './businessNumbers';
import { buildIssueArchive, bindIssueArchive, prepareCreditDocumentSnapshot, assertCreditIssuePayload, assertIssuedCreditArchive, type PreparedCreditIssueArchive } from './creditPrint';
import { buildQuotationDocument, bindQuotationDocument, nextQuotationDocumentSeq, prepareQuotationDocumentSnapshot } from './quotationPrint';
import { buildPurchaseDocument, bindPurchaseDocument } from './purchasePrint';
import { preparePurchaseDocumentSnapshot } from '../shared/mistPurchaseDocument';
import { bindDevelopmentNotice, buildDevelopmentNotice, prepareDevelopmentNoticeSnapshot } from './developmentNoticePrint';
import { bindCustomerStatement, buildCustomerStatement, prepareCustomerStatementSnapshot } from './customerStatementPrint';
import type { PdfRenderResult } from '../templates/pdf';
import { canonicalCreditDocument, creditDocumentFingerprint, creditSourceFingerprint, type MistBusinessNumberNeed, type MistCreditPrintSnapshot } from '../shared/mistCreditDocuments';
/** 演示公司里指派给演示成员（demo-*）的审批无人能处理，不阻止移入回收站。 */
const demoOnlyReview=(task:{reviewerIds:string[]})=>task.reviewerIds.length>0&&task.reviewerIds.every(id=>id.startsWith('demo-'));
export type MistContract = {
  createMistState: (context: MistContext, seed?: 'demo' | 'empty') => MistState;
  /** 演示公司的示例附件：按公司数据生成可下载 PDF，创建时写入私有存储。 */
  renderDemoFile?: (state: MistState, file: MistState['files'][number]) => Uint8Array;
  applyMistCommand: (state: MistState, command: MistCommand, context: MistContext) => { state: MistState; result: Record<string, unknown> };
  mistCommandPermission: (command: MistCommand) => string | null;
  getMistReviewTasks?: (state:MistState)=>MistReviewTask[];
  normalizeMistState?: (state:MistState,context:MistContext)=>void;
  getRequiredBusinessNumberPlan?: (state: MistState, command: MistCommand) => MistBusinessNumberNeed[];
};
export type MistWorkspaceRow = { id: string; ownerId: string; companyId?: string | null; slug: string; name: string; revision: number; state: MistState; createdAt: Date; updatedAt: Date };
export type MistCommandRequest = { requestId: string; expectedRevision: number; command: MistCommand };
export type MistUploadRequest = { requestId: string; expectedRevision: number; claimId?: string };
const MIST_UPLOAD_SCOPES = ['products:write', 'orders:write', 'procurement:write', 'shipments:write', 'customs:write', 'invoices:write', 'vouchers:write', 'qc:fabric_chain:write', 'qc:garment_chain:write', 'relations:write', 'aftersales:write'] as const;
function canonical(value: any, depth = 0): string {
  if (depth > 32) fail('INVALID_INPUT', '请求嵌套层级过深', 400);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  fail('INVALID_INPUT', '请求必须是有效JSON', 400);
}
function identifier(value: unknown, label: string, maxLength = 120): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength) fail('INVALID_INPUT', `${label}无效`, 400);
  return value;
}
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) fail('INVALID_INPUT', '公司版本无效', 400); return Number(value); }
/** 服务端内部回执前缀：数字版本标记与私有Agent审计；客户端不得使用。 */
const REVISION_MARKER_PREFIX = 'mist-revision:';
const REVISION_MARKER_HASH = 'mist-revision-change-keys:v1';
/**
 * 自动合并只跨越有限个落后版本（一次批量读取写入记录）；整笔事务因死锁 / 序列化失败最多尝试有限次，不睡眠、不无界循环。
 * 页面会定时同步最新版本，正常落后几十个版本以内；上限只防异常陈旧的页面。
 */
export const MIST_MAX_REBASE_GAP = 500;
export const MIST_MAX_SAVE_ATTEMPTS = 3;
const MAX_CHANGE_KEYS = 2000;
const RETRYABLE_TRANSACTION_CODES = ['P2034', 'P2002'];
/** PostgreSQL 可串行化失败 / 死锁：经 Prisma 普通查询报 P2034，经行锁原生查询（FOR UPDATE）报 P2010 并带原始 SQLSTATE。 */
const retryableTransaction = (error: any) => RETRYABLE_TRANSACTION_CODES.includes(error?.code) || error?.code === 'P2010' && ['40001', '40P01'].includes(error?.meta?.code);
/**
 * 签发 / 正式单据：内容取自多条记录的快照，版本落后时必须刷新重新确认，不自动合并。
 * 审批、确认、放行只针对所办理的那条记录：期间他人改了同一记录（写入位置重叠）照旧拒绝、要求刷新核对；
 * 改的是别的记录则在最新状态上重新执行全部业务门禁后合并，避免多人同时办公时每次审批都因无关更新被退回。
 */
const NON_REBASABLE_COMMAND = /\.(issue|document)$/;
function requestIdentifier(value: unknown, maxLength = 120): string {
  const id = identifier(value, '请求编号', maxLength);
  if (id.startsWith(REVISION_MARKER_PREFIX)) fail('INVALID_INPUT', '请求编号无效', 400);
  return id;
}
const revisionMarker = (value: number) => `${REVISION_MARKER_PREFIX}${value}`;
function plainRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function keyedById(list: unknown[]): Map<string, unknown> | null {
  const map = new Map<string, unknown>();
  for (const item of list) { if (!plainRecord(item) || typeof item.id !== 'string' || !item.id || map.has(item.id)) return null; map.set(item.id, item); }
  return map;
}
/**
 * 本次命令实际写入的位置：对象逐字段下钻，带唯一 id 的记录数组按记录（整条记录为最小单位）比较，
 * 其余数组或值整体比较。返回 null 表示写入范围过大，无法作为安全合并依据。
 */
export function mistChangeKeys(before: unknown, after: unknown): string[][] | null {
  const out = new Map<string, string[]>();
  const add = (path: string[]) => { out.set(JSON.stringify(path), path); };
  const walk = (a: unknown, b: unknown, path: string[]) => {
    if (out.size > MAX_CHANGE_KEYS || Object.is(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const left = keyedById(a), right = keyedById(b);
      if (left && right) {
        for (const id of new Set([...left.keys(), ...right.keys()])) {
          const x = left.get(id), y = right.get(id);
            if (x === undefined || y === undefined) add([...path, 'i:' + id]);
            else if (path.length === 2 && path[0] === 'k:email' && path[1] === 'k:messages') walk(x, y, [...path, 'i:' + id]);
            else if (canonical(x) !== canonical(y)) add([...path, 'i:' + id]);
        }
        return;
      }
    } else if (plainRecord(a) && plainRecord(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], [...path, 'k:' + key]);
      return;
    }
    if (a === undefined || b === undefined || canonical(a) !== canonical(b)) add(path);
  };
  walk(before, after, []);
  out.delete(JSON.stringify(['k:reviewerIds'])); // 由最新状态重新派生，不代表业务写入。
  return out.size > MAX_CHANGE_KEYS ? null : [...out.values()];
}
const overlapping = (a: string[], b: string[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return false; return true; };
function claimIdentifier(value:unknown):string { const id=identifier(value,'案件编号');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))fail('INVALID_INPUT','案件编号无效',400);return id; }
function activeUploadClaim(state:MistState,claimId:string){
  const claim=Array.isArray(state.platform?.claims)?state.platform.claims.find(item=>item.id===claimId):undefined;
  if(!claim)fail('CLAIM_NOT_FOUND','案件不存在或不属于本公司',404);
  if(claim!.state==='Closed'||claim!.state==='Cancelled')fail('CLAIM_CLOSED','案件已结束，不能上传新的案件凭据',409);
}
export function publicWorkspace(row: MistWorkspaceRow) { return { id: row.id, ownerId: row.ownerId, name: row.name, revision: row.revision, state: row.state }; }
/** 公司库没有回收站：历史上误标的回收站标记对公司库不生效。 */
const archived=(row:MistWorkspaceRow)=>!companyRow(row)&&!!row.state.workspaceArchive;
/** 文件可见性所用的“所有者”：公司库没有所有者特权（未引用附件只对上传人可见）。 */
const fileOwner=(row:MistWorkspaceRow)=>companyRow(row)?undefined:row.ownerId;
/** 审批候选与成员目录：公司库只取公司在职成员名册（已覆盖到 memberIds），不含已离职的库创建人。 */
/** 本次读取时为该行解析的受限范围（undefined = 不裁剪）；随行对象存活，不写入状态。 */
const ROW_SCOPE=new WeakMap<object,MistDataScope>();
/** Exact state loaded under the write lock, before roster/normalization changes. Never serialized. */
const ORIGINAL_WRITE_STATE = new WeakMap<object, MistState>();
const OWN_TEAMS = new WeakMap<object, string[]>();
const TASK_PROPOSAL_ACCESS = new WeakMap<object,Map<string,{visible:boolean;blocked?:string}>>();
const scopeOf=(row:MistWorkspaceRow)=>ROW_SCOPE.get(row);
const candidateIds=(row:MistWorkspaceRow)=>companyRow(row)?memberIds(row.state):[row.ownerId,...memberIds(row.state)];
/** 同一数据库客户端共享的按公司写入队列（多个仓储实例共用一个连接池时也按同一队列排队）。 */
const WRITE_QUEUES = new WeakMap<object, Map<string, Promise<void>>>();
/** 预演结束时用来整笔回滚的信号（不是错误）。 */
class MistPreviewOutcome extends Error { constructor(readonly preview: { revision: number; result: unknown; events: string[]; changes: unknown }) { super('preview'); } }
const PREVIEW_UNSUPPORTED = new Set(['platform.credit.issue', 'fulfillment.procurement.document', 'market.quotation.document', 'development.notice.generate', 'finance.statement.generate']);

export class MistRepository {
  private mailStateWake?: () => void;
  setMailStateWake(wake: () => void) { this.mailStateWake = wake; }
  constructor(private readonly prisma: any, private readonly contract: MistContract, private readonly files: MistPrivateFiles, private readonly authorize: FreshAuthority = freshMistAuthority, private readonly now = () => new Date(), private readonly creditArchiveBuilder: (snapshot: MistCreditPrintSnapshot, options?: {draft?: boolean}) => Promise<PreparedCreditIssueArchive> = buildIssueArchive, private readonly quotationPdfRenderer?: (html: string) => Promise<PdfRenderResult>) {}
  private context(actor: TokenPayload, state?: MistState): MistContext { const auditNow=this.now().toISOString();return { id: randomUUID, now: mistBusinessInstant(state,auditNow), auditNow, actorName: actor.displayName || actor.userId, actorId:actor.userId, can: scope => hasScope(actor, scope as any) }; }
  /** 普通附件上传：只落私有文件、不改业务记录；持有任一业务写入权限即可（后勤的 CI/PL、财务的水单、质检的报告都要先上传再关联）。关联到哪条记录仍由各自业务命令按权限校验。 */
  private async uploadPermission(db: any, prior: TokenPayload) {
    const actor = await this.authorize(db, prior);
    return MIST_UPLOAD_SCOPES.find(scope => hasScope(actor, scope as any)) ?? MIST_UPLOAD_SCOPES[0];
  }
  private async authorizeCompoundCommand(db: any, prior: TokenPayload, command?: MistCommand) {
    if (command?.type === 'email.server.analysis') await this.authorize(db, prior, 'ai:chat');
    if (command?.type === 'email.server.analysis' || command?.type.startsWith('email.extraction.')) await this.authorize(db, prior, 'emails:read');
    if(command?.type==='fulfillment.inventory.quarantine.noRecovery'||command?.type==='fulfillment.inventory.quarantine.noRecovery.revoke')await this.authorize(db,prior,'inventory:read');
    if (command?.type.startsWith('payable.')) for (const scope of payablesCommandPermissions(command as any).slice(1)) await this.authorize(db, prior, scope);
  }
  /** 公司库：当前公司在职成员即可进入（R2），ownerOnly 的动作（回收站、成员授权）一律不适用。非公司（本机）空间：所有者或被明确授权的成员可进入，ownerOnly 只限所有者。 */
  private async own(db: any, prior: TokenPayload, id: string, permission?: string | null, lock = false, allowArchived = false, ownerOnly = false, captureAuditBefore = false): Promise<{ actor: TokenPayload; row: MistWorkspaceRow }> {
    if(isAgentActor(prior)&&prior.agentWorkspaceId&&prior.agentWorkspaceId!==id)fail('NOT_FOUND','公司不存在或当前账号无权访问',404);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail('INVALID_INPUT', '公司编号无效', 400);
    const actor = await this.authorize(db, prior, permission);
    if (lock) await db.$queryRawUnsafe('SELECT "id" FROM "MistWorkspace" WHERE "id" = $1::uuid FOR UPDATE', id);
    const row = await db.mistWorkspace.findFirst({ where: { id } });
    // 公司边界：会话属于某家公司时，只能进入该公司。
    // 即使某账号在另一家公司里被列为成员，当前会话也不能跨公司读取。
    if (row && row.companyId !== (actor.companyId ?? null) && (row.companyId || actor.companyId)) fail('NOT_FOUND', '公司不存在或当前账号无权访问', 404);
    if (row && companyRow(row) && ownerOnly) singleLibrary();
    if (!row || !(companyRow(row) || isOwner(row, actor) || (!ownerOnly && isMember(row, actor)))) fail('NOT_FOUND', '公司不存在或当前账号无权访问', 404);
    if(archived(row)&&!allowArchived)fail('NOT_FOUND','公司已移入回收站，请先恢复',404);
    if(isAgentActor(prior)&&prior.agentLease)await assertConnection(db,actor,prior.agentLease,Date.now());
    if(isAgentActor(prior)&&prior.agentServiceLease)await assertServiceLease(db,actor,prior.agentServiceLease,Date.now());
    if(isAgentActor(prior)&&prior.agentTaskControlLease)await assertTaskControl(db,actor,prior.agentTaskControlLease,Date.now());
    const taskActor=await this.taskValidationActor(db,prior,actor);
    const task=isAgentActor(prior)&&prior.agentTaskLease?(await assertTaskLease(db,taskActor,prior.agentTaskLease,Date.now(),lock)).value:undefined;
    if((prior as MailSyncActor).mailSyncLease)await assertReceivingLease(db,actor,(prior as MailSyncActor).mailSyncLease!,row,Date.now(),lock);
    if (lock && captureAuditBefore) ORIGINAL_WRITE_STATE.set(row, structuredClone(row.state));
    if (companyRow(row)) { applyRoster(row.state, await companyRoster(db, row.companyId!)); const scope = await companyDataScope(db, row, actor); if (scope) ROW_SCOPE.set(row, scope); OWN_TEAMS.set(row, scope?.teamIds ?? await companyTeamIds(db, row.companyId!, actor.userId)); }
    this.contract.normalizeMistState?.(row.state,this.context(actor));
    if(task){if(taskActor===actor)this.assertTaskSources(row,actor,task);else{const taskScope=await companyDataScope(db,row,taskActor),visible=projectState(row.state,taskActor,this.emptyState(taskActor),fileOwner(row),taskScope).state;if(!taskSourcesVisible(task.sources,task.scopeHash,visible,row.state,taskScope))fail('AGENT_TASK_SCOPE_CHANGED','任务可见范围已变化',403);}}
    await this.prepareTaskProposalAccess(db,row,actor);
    return { actor, row };
  }
  /** 包 A：本次执行时的成员目录（所有者 + 授权成员，账号状态与业务组）。账号已停用 / 删除或查不到时记为停用（失败关闭）。 */
  private async memberDirectory(db: any, row: MistWorkspaceRow, actor: TokenPayload) {
    const ids = candidateIds(row), accounts = new Map<string, { name: string; active: boolean }>();
    if (localMode(actor)) for (const profile of MIST_LOCAL_PROFILES) accounts.set(profile.id, { name: profile.name, active: true });
    else if (typeof db.userAccount?.findMany === 'function') for (const user of await db.userAccount.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, status: true, deletedAt: true } })) accounts.set(user.id, { name: user.displayName || user.id, active: user.status === 'active' && !user.deletedAt });
    return buildMemberDirectory({ ownerId: row.ownerId, state: row.state, accounts });
  }
  private transact<T>(run: (db: any) => Promise<T>): Promise<T> { return this.prisma.$transaction(run, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 30000 }); }
  /**
   * 公司写入：同一进程内按公司排队，一次只有一笔写事务在库里等锁（不占满连接池）；
   * 库内以 READ COMMITTED + 首句 FOR UPDATE 行锁为准串行化（多进程同样安全），拿到锁后读到的就是最新已提交版本，
   * 不会像可串行化快照那样在等锁后整笔回滚。所有改写公司状态的路径都必须先锁行、再读行。
   */
  private writeTransact<T>(workspaceId: string, run: (db: any) => Promise<T>): Promise<T> {
    let queues = WRITE_QUEUES.get(this.prisma); if (!queues) { queues = new Map(); WRITE_QUEUES.set(this.prisma, queues); }
    const previous = queues.get(workspaceId) ?? Promise.resolve();
    const next = previous.then(() => this.prisma.$transaction(run, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 })) as Promise<T>;
    const tail = next.then(() => undefined, () => undefined); queues.set(workspaceId, tail);
    void tail.then(() => { if (queues!.get(workspaceId) === tail) queues!.delete(workspaceId); });
    return next;
  }
  private emptyState(actor: TokenPayload) { return () => { const context = this.context(actor), state = this.contract.createMistState(context, 'empty'); this.contract.normalizeMistState?.(state, context); return state; }; }
  private async taskValidationActor(db:any,prior:TokenPayload,actor:TokenPayload){
    if(isAgentActor(prior)&&prior.agentTaskLease&&(prior as any).mailStateWorker===true){const c=(await taskRecord(db,prior.agentTaskLease.workspaceId,prior.agentTaskLease.taskId)).value;return this.authorize(db,{...prior,permissionCeiling:[...c.ceiling]});}return actor;
  }
  private taskSourcesAllowed(row:MistWorkspaceRow,actor:TokenPayload,c:TaskRecord,visible?:MistState){return c.ownerId===actor.userId&&c.ceiling.every(scope=>hasScope(actor,scope as any))&&taskSourcesVisible(c.sources,c.scopeHash,visible??projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state,row.state,scopeOf(row));}
  private assertTaskSources(row:MistWorkspaceRow,actor:TokenPayload,c:TaskRecord){if(!this.taskSourcesAllowed(row,actor,c))fail('AGENT_TASK_SCOPE_CHANGED','任务可见范围已变化，请重新安排任务',403);}
  private async prepareTaskProposalAccess(db:any,row:MistWorkspaceRow,actor:TokenPayload){
    const proposals=(row.state.agentProposals??[]).filter(p=>p.taskId&&p.ownerId===actor.userId),access=new Map<string,{visible:boolean;blocked?:string}>();
    TASK_PROPOSAL_ACCESS.set(row,access);if(!proposals.length)return;
    const records=await db.mistCommandReceipt.findMany({where:{workspaceId:row.id,actorId:actor.userId,inputHash:TASK_HASH,requestId:{in:[...new Set(proposals.map(p=>TASK_PREFIX+p.taskId))]}}});
    const tasks=new Map<string,TaskRecord>();for(const r of records)try{const c=readTaskRecord(r,row.id);tasks.set(c.id,c);}catch(e){if(!(e instanceof MistApiError))throw e;}
    const visible=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;
    for(const p of proposals){const c=tasks.get(p.taskId!),allowed=!!c&&this.taskSourcesAllowed(row,actor,c,visible);if(!allowed){access.set(p.id,{visible:false});continue;}let blocked:string|undefined;
      if(p.state==='pending'){if(!['waiting_human','paused'].includes(c!.state)||c!.expiresAt<=Date.now())blocked='所属任务已停止或过期';
      else try{await assertTaskAuthority(db,actor,c!,Date.now());}catch(e){if(!(e instanceof MistApiError))throw e;blocked='任务连接已失效';}}
      access.set(p.id,{visible:true,...(blocked?{blocked}:{})});
    }
  }
  /** 返回给当前账号的公司：按其现有读权限裁剪，并附带访问说明。 */
  private view(row: MistWorkspaceRow, actor: TokenPayload) {
    const projected = projectState(row.state, actor, this.emptyState(actor), fileOwner(row), scopeOf(row)), owner = isOwner(row, actor), company = companyRow(row);
    const proposalSources=projected.state.agentProposals?.some(p=>!p.taskId)?knownCommandSourcesVisible(row.state,projected.state):undefined;
    if(projected.state.agentProposals)projected.state.agentProposals=projected.state.agentProposals.map(p=>{
      const access=p.taskId?TASK_PROPOSAL_ACCESS.get(row)?.get(p.id):undefined;
      if(readableCommand(p.command,actor,this.contract.mistCommandPermission)&&(p.taskId?access?.visible:proposalSources?.(p.command)))return {...p,...(access?.blocked?{taskBlocked:access.blocked}:{})};
      return {id:p.id,ownerId:p.ownerId,owner:p.owner,createdAt:p.createdAt,state:p.state,...(p.taskId?{taskId:p.taskId}:{}),command:{type:'unavailable',payload:{}},summary:['提议来源已不可见'],unavailable:true,taskBlocked:p.taskId?'请停止任务或拒绝此提议':'请拒绝此提议后重新核对'};
    });
    // Ship only already-authorized record references for the user's own groups.
    // Conditions, exclusions and management history remain behind hr:write.
    const teamViews: NonNullable<MistWorkspaceAccess['teamViews']> = {};
    const ownTeams = OWN_TEAMS.get(row) ?? [];
    const graph = ownTeams.length ? buildTeamScopeGraph(row.state) : undefined, allowed = ownTeams.length ? buildTeamScopeGraph(projected.state) : undefined;
    for (const teamId of ownTeams) {
      const configured = row.state.teamScopes?.find(team => team.teamId === teamId);
      const resolved = configured ? resolveTeamScope(row.state, configured, graph!) : undefined;
      teamViews[teamId] = [...(resolved?.collaborate ?? [])].flatMap(key => {
        const node = allowed!.nodes.get(key);
        return node ? [{kind: node.kind, id: node.id}] : [];
      });
    }
    const access: MistWorkspaceAccess = { role: owner ? 'owner' : 'member', canManageMembers: owner && !company, canManageCompany: company ? canMaintainCompany(actor) : owner, ...(company ? { companyLibrary: true, teamViews } : {}), ...(scopeOf(row) ? {manageableCustomerIds: (row.state.customers??[]).filter(customer=>scopeOf(row)!.userIds.includes(customer.ownerId)).map(customer=>customer.id)} : {}), hidden: projected.hidden.map(s => ({ key: s.key, label: s.label, permissions: [...s.permissions] })) };
    const scope=scopeOf(row), materialIssueTargets=scope&&hasScope(actor,'inventory:read')&&hasScope(actor,'inventory:write')?scopedMaterialIssueTargets(row.state,scope):undefined;
    const financialDisposals=hasScope(actor,'invoices:read')&&hasScope(actor,'vouchers:read')&&hasScope(actor,'procurement:read')?financialDisposalViews(row.state,new Set((projected.state.fulfillment?.purchases||[]).map(p=>p.id))):undefined;
    const fabricAccess=scope&&hasScope(actor,'orders:read')&&hasScope(actor,'orders:write')?scopedFabricAccess(row.state,scope,actor.userId,actor.displayName||actor.userId,hasScope(actor,'production:read')&&hasScope(actor,'products:read')&&hasScope(actor,'qc:read')):undefined;
    return { ...publicWorkspace({ ...row, state: projected.state }), access,...(projected.costMaterialBasis!==undefined?{costMaterialBasis:projected.costMaterialBasis}:{}),...(materialIssueTargets?{materialIssueTargets}:{}),...(financialDisposals?{financialDisposals}:{}),...(fabricAccess?{scopedFabricAccess:fabricAccess}:{}) };
  }
  async list(prior: TokenPayload) { return this.transact(async db => { if(isAgentActor(prior)&&prior.agentWorkspaceId){const {row,actor}=await this.own(db,prior,prior.agentWorkspaceId);return[this.view(row,actor)];}const actor = await this.authorize(db, prior); const rows: MistWorkspaceRow[] = await db.mistWorkspace.findMany({ where: this.accessibleWhere(actor), orderBy: { updatedAt: 'desc' } }); const out = []; for (const row of rows.filter(row=>this.accessible(row,actor))) { if (companyRow(row)) { applyRoster(row.state, await companyRoster(db, row.companyId!)); const scope = await companyDataScope(db, row, actor); if (scope) ROW_SCOPE.set(row, scope); OWN_TEAMS.set(row, scope?.teamIds ?? await companyTeamIds(db, row.companyId!, actor.userId)); } this.contract.normalizeMistState?.(row.state,this.context(actor)); out.push(this.view(row,actor)); } return out; }); }
  /** 公司会话只看本公司唯一的库；本机空间看自己拥有或被授权的。 */
  private accessibleWhere(actor: TokenPayload) { return companyLibrary(actor) ? { companyId: actor.companyId } : { ...(actor.companyId ? { companyId: actor.companyId } : {}), OR: [{ ownerId: actor.userId }, { state: { path: ['memberIds'], array_contains: [actor.userId] } }] }; }
  private accessible(row: MistWorkspaceRow, actor: TokenPayload) { return !archived(row) && (companyLibrary(actor) ? row.companyId === actor.companyId : isOwner(row, actor) || isMember(row, actor)); }
  /** Navigation needs identities only, never the full business snapshots of every company workspace. */
  async listSummaries(prior: TokenPayload) { return this.transact(async db => {
    if(isAgentActor(prior)&&prior.agentWorkspaceId){const {row}=await this.own(db,prior,prior.agentWorkspaceId);return[{id:row.id,name:row.name,ownerId:row.ownerId,revision:row.revision,access:{role:'member'}}];}
    const actor = await this.authorize(db, prior);
    const rows: MistWorkspaceRow[] = await db.mistWorkspace.findMany({where: this.accessibleWhere(actor), orderBy: {updatedAt: 'desc'}});
    return rows.filter(row => this.accessible(row, actor))
      .map(row => ({id: row.id, name: row.name, ownerId: row.ownerId, revision: row.revision, access: {role: isOwner(row, actor) ? 'owner' : 'member'}}));
  }); }
  async listArchived(prior:TokenPayload){return this.transact(async db=>{const actor=await this.authorize(db,prior);if(companyLibrary(actor))return [];const rows: MistWorkspaceRow[]=await db.mistWorkspace.findMany({where:{ownerId:actor.userId,...(actor.companyId?{companyId:actor.companyId}:{})},orderBy:{updatedAt:'desc'}});return rows.filter(archived).map(row=>({id:row.id,name:row.name,revision:row.revision,archivedAt:row.state.workspaceArchive!.at}));});}
  private async activeWorkspace(db:any,actor:TokenPayload,preferredId?:string){const rows:MistWorkspaceRow[]=await db.mistWorkspace.findMany({where:{ownerId:actor.userId,...(actor.companyId?{companyId:actor.companyId}:{})},orderBy:{updatedAt:'desc'}});const active=rows.filter(row=>!archived(row));const existing=active.find(row=>row.id===preferredId)??active[0];if(existing){this.contract.normalizeMistState?.(existing.state,this.context(actor));return existing;}const context=this.context(actor),state=this.contract.createMistState(context,'empty');state.settings.workspaceName='新的公司';return db.mistWorkspace.create({data:{id:randomUUID(),ownerId:actor.userId,companyId:actor.companyId??null,slug:'continuation-'+randomUUID(),name:state.settings.workspaceName,revision:0,state}});}
  async changeArchive(prior:TokenPayload,workspaceId:string,input:{requestId:string;expectedRevision:number},action:'archive'|'restore'){
    requestIdentifier(input.requestId);revision(input.expectedRevision);const hash=createHash('sha256').update(canonical({actorId:prior.userId,action,expectedRevision:input.expectedRevision})).digest('hex');
    return this.writeTransact(workspaceId,async db=>{const{actor,row}=await this.own(db,prior,workspaceId,null,true,true,true);const previous=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:input.requestId}}});
      if(previous){if(previous.actorId!==actor.userId||previous.inputHash!==hash)fail('REQUEST_CONFLICT','请求编号已用于另一项操作',409);const active=await this.activeWorkspace(db,actor,previous.result.result.activeWorkspaceId);return{workspace:this.view(active,actor),receipt:{requestId:previous.requestId,...publicCommandReceiptResult(previous.result)},replayed:true};}
      if(row.revision!==input.expectedRevision)fail('REVISION_CONFLICT','公司已更新，请刷新后重试',409);
      if(action==='archive'&&archived(row)||action==='restore'&&!archived(row))fail('WORKSPACE_STATE_CONFLICT',action==='archive'?'公司已在回收站':'公司已恢复',409);
      if(action==='archive'&&this.reviews(row.state).some(task=>task.status==='pending'&&!demoOnlyReview(task)))fail('PENDING_REVIEWS','请先处理或撤销公司中的待审批事项，再移入回收站',409);
      const state=structuredClone(row.state),context=this.context(actor);if(action==='archive')state.workspaceArchive={at:context.now,actorId:actor.userId};else delete state.workspaceArchive;
      if(Array.isArray(state.events))state.events.unshift({id:context.id(),entityType:'workspace',entityId:row.id,actor:context.actorName,at:context.now,text:action==='archive'?'公司移入回收站':'公司从回收站恢复',fileIds:[]});
      const saved=await db.mistWorkspace.update({where:{id:row.id},data:{state,revision:row.revision+1}});const active=action==='restore'?saved:await this.activeWorkspace(db,actor);
      const result={revision:saved.revision,result:{workspaceId:row.id,action,activeWorkspaceId:active.id}};await db.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId:row.id,requestId:input.requestId,actorId:actor.userId,inputHash:hash,expectedRevision:input.expectedRevision,result}});
      await this.markRevision(db,row.id,actor.userId,row.revision,saved.revision,mistChangeKeys(row.state,state));await this.authorize(db,prior);
      return{workspace:this.view(active,actor),receipt:{requestId:input.requestId,...result},replayed:false};
    });
  }
  /** 所有者明确授权/撤销其他账号进入本公司；只记录访问，不授予任何业务权限，历史保留。 */
  async changeMember(prior:TokenPayload,workspaceId:string,input:{requestId:string;expectedRevision:number;action:'add'|'remove';account:string}){
    requestIdentifier(input.requestId);revision(input.expectedRevision);const account=identifier(input.account,'账号',200);
    if(!['add','remove'].includes(input.action))fail('INVALID_INPUT','请选择授权或撤销',400);
    const hash=createHash('sha256').update(canonical({actorId:prior.userId,type:'workspace.member',action:input.action,account,expectedRevision:input.expectedRevision})).digest('hex');
    return this.writeTransact(workspaceId,async db=>{
      const{actor,row}=await this.own(db,prior,workspaceId,null,true,false,true);
      const previous=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:input.requestId}}});
      if(previous){if(previous.actorId!==actor.userId||previous.inputHash!==hash)fail('REQUEST_CONFLICT','请求编号已用于另一项操作',409);return{workspace:this.view(row,actor),receipt:{requestId:previous.requestId,...publicCommandReceiptResult(previous.result)},replayed:true};}
      if(row.revision!==input.expectedRevision)fail('REVISION_CONFLICT','公司已更新，请刷新后重试',409);
      let target:{id:string;name:string};
      const existingMember=input.action==='remove'?members(row.state).find(m=>m.userId===account):undefined;
      if(existingMember)target={id:existingMember.userId,name:existingMember.name};
      else if(localMode(actor)){const profile=MIST_LOCAL_PROFILES.find(p=>p.id===account);if(!profile)fail('ACCOUNT_NOT_FOUND','没有找到这个本地账号',404);target={id:profile!.id,name:profile!.name};}
      else{const user=await db.userAccount.findFirst({where:{OR:[{id:account},{email:account}],...(input.action==='add'?{deletedAt:null}:{})}});if(!user||input.action==='add'&&user.status!=='active')fail('ACCOUNT_NOT_FOUND','没有找到可用的员工账号',404);target={id:user.id,name:user.displayName||user.id};}
      if(target!.id===row.ownerId)fail('INVALID_INPUT','所有者本来就能进入本公司',400);
      const state:any=structuredClone(row.state),context=this.context(actor),ids=memberIds(state),list=members(state);
      if(input.action==='add'){if(ids.includes(target!.id))fail('MEMBER_EXISTS','该账号已被授权',409);state.memberIds=[...ids,target!.id];state.members=[...list,{userId:target!.id,name:target!.name,addedBy:actor.userId,addedByName:context.actorName,addedAt:context.now}];}
      else{if(!ids.includes(target!.id))fail('MEMBER_NOT_FOUND','该账号当前没有被授权',409);state.memberIds=ids.filter(id=>id!==target!.id);state.members=list.filter(m=>m.userId!==target!.id);if(Array.isArray(state.memberGroups))state.memberGroups=state.memberGroups.filter((g:any)=>g.userId!==target!.id);}
      const log:MistMemberLog={id:context.id(),action:input.action,userId:target!.id,name:target!.name,actorId:actor.userId,actorName:context.actorName,at:context.now};
      state.memberLog=[log,...(Array.isArray(state.memberLog)?state.memberLog:[])];
      state.events.unshift({id:context.id(),entityType:'workspace',entityId:row.id,actor:context.actorName,at:context.now,text:(input.action==='add'?'授权账号进入公司：':'撤销账号的公司访问：')+target!.name,fileIds:[]});
      const saved=await db.mistWorkspace.update({where:{id:row.id},data:{state,revision:row.revision+1}});
      const result={revision:saved.revision,result:{workspaceId:row.id,action:input.action,userId:target!.id}};
      await db.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId:row.id,requestId:input.requestId,actorId:actor.userId,inputHash:hash,expectedRevision:input.expectedRevision,result}});
      await this.markRevision(db,row.id,actor.userId,row.revision,saved.revision,mistChangeKeys(row.state,state));
      await this.authorize(db,prior);
      return{workspace:this.view(saved,actor),receipt:{requestId:input.requestId,...result},replayed:false};
    });
  }
  async get(prior: TokenPayload, id: string) { return this.transact(async db => { const { actor, row } = await this.own(db, prior, id); return this.view(row, actor); }); }
  /** 页面定时同步用的轻量查询：只返回当前版本号（同样核验账号、成员与回收站状态），版本变了页面再读取完整内容。 */
  async revisionOf(prior: TokenPayload, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail('INVALID_INPUT', '公司编号无效', 400);
    return this.transact(async db => {
      const actor = await this.authorize(db, prior), row: MistWorkspaceRow | null = await db.mistWorkspace.findFirst({ where: { id } });
      if (row && row.companyId !== (actor.companyId ?? null) && (row.companyId || actor.companyId)) fail('NOT_FOUND', '公司不存在或当前账号无权访问', 404);
      if (!row || !(companyRow(row) || isOwner(row, actor) || isMember(row, actor)) || archived(row)) fail('NOT_FOUND', '公司不存在或当前账号无权访问', 404);
      return { id: row!.id, revision: row!.revision };
    });
  }
  /** 当前真实执行者（事务内重新加载账号与授权，保留会话自身的权限上限）。 */
  async currentActor(prior:TokenPayload,permission?:string|null){return this.transact(db=>this.authorize(db,prior,permission));}
  async authorizeAgentConnection(actor:AgentActor){if(!actor.agentWorkspaceId||!actor.agentLease&&!actor.agentServiceLease)fail('UNAUTHORIZED','连接登记无效',401);await this.transact(db=>this.own(db,actor,actor.agentWorkspaceId!,'ai:chat'));}
  private async connectionTransaction<T>(run:(db:any)=>Promise<T>):Promise<T>{for(let n=0;;n++){try{return await this.transact(run);}catch(error){if(n>=2||!retryableTransaction(error))throw error;}}}
  async agentConnections(prior:TokenPayload,workspaceId:string,cursor:unknown,now=Date.now()){return this.transact(async db=>{const {actor}=await this.own(db,prior,workspaceId);return listConnections(db,actor,workspaceId,cursor,now);});}
  async agentConnection(prior:TokenPayload,workspaceId:string,id:string,now=Date.now()){return this.transact(async db=>{const {actor}=await this.own(db,prior,workspaceId);return getConnection(db,actor,workspaceId,id,now);});}
  async createAgentConnection(prior:TokenPayload,workspaceId:string,input:Record<string,unknown>,make:MakeAgentLease,now=Date.now()){if(isAgentActor(prior))fail('FORBIDDEN','须由本人连接',403);return this.connectionTransaction(async db=>{const {actor}=await this.own(db,prior,workspaceId,'ai:chat');return createConnection(db,actor,workspaceId,input,make,now);});}
  async changeAgentConnection(prior:TokenPayload,workspaceId:string,id:string,action:'renew'|'revoke',input:Record<string,unknown>,make:MakeAgentLease,now=Date.now()){if(isAgentActor(prior))fail('FORBIDDEN','须由本人操作连接',403);return this.connectionTransaction(async db=>{const {actor}=await this.own(db,prior,workspaceId,action==='renew'?'ai:chat':undefined);return changeConnection(db,actor,workspaceId,id,action,input,make,now);});}
  private async identityOwners(db:any,row:MistWorkspaceRow,actor:TokenPayload){
    const directory=await this.memberDirectory(db,row,actor);
    if(!row.companyId)return directory;
    const memberships=await db.companyMember.findMany({where:{companyId:row.companyId,status:'active'},select:{userId:true}}),active=new Set(memberships.map((m:any)=>m.userId));
    return directory.map(m=>({...m,active:m.active&&active.has(m.id)}));
  }
  private identityManager(actor:TokenPayload,row:MistWorkspaceRow):TokenPayload{return localMode(actor)&&!companyRow(row)&&isOwner(row,actor)?{...actor,serviceIdentityAdmin:true} as TokenPayload:actor;}
  async agentIdentities(prior:TokenPayload,workspaceId:string,now=Date.now(),scope:unknown='mine',cursor?:unknown){return this.transact(async db=>{const{row,actor}=await this.own(db,prior,workspaceId);return listIdentities(db,this.identityManager(actor,row),workspaceId,now,await this.identityOwners(db,row,actor),scope,cursor);});}
  async createAgentIdentity(prior:TokenPayload,workspaceId:string,input:Record<string,unknown>,now=Date.now()){if(isAgentActor(prior))fail('FORBIDDEN','Agent不能开设服务身份',403);return this.connectionTransaction(async db=>{const{row,actor}=await this.own(db,prior,workspaceId);const manager=this.identityManager(actor,row);if(!serviceCanManage(manager))fail('FORBIDDEN','没有Agent身份管理权限',403);const owner=(await this.identityOwners(db,row,actor)).find(m=>m.id===input.ownerId&&m.active);if(!owner)fail('INVALID_INPUT','请选择在职责任人',422);return createIdentity(db,manager,workspaceId,input,owner!,now,row.companyId??undefined);});}
  async configureAgentIdentity(prior:TokenPayload,workspaceId:string,id:string,input:Record<string,unknown>,now=Date.now()){if(isAgentActor(prior))fail('FORBIDDEN','Agent不能配置服务身份',403);return this.connectionTransaction(async db=>{const{row,actor}=await this.own(db,prior,workspaceId);const manager=this.identityManager(actor,row);if(!serviceCanManage(manager))fail('FORBIDDEN','没有Agent身份管理权限',403);let owner=(await this.identityOwners(db,row,actor)).find(m=>m.id===input.ownerId&&m.active);if(!owner&&input.enabled===false){const c=(await identityRecord(db,workspaceId,id)).value;if(input.ownerId===c.ownerId)owner={id:c.ownerId,name:c.ownerName,active:false,groups:[]};}if(!owner)fail('INVALID_INPUT','请选择在职责任人',422);return configureIdentity(db,manager,workspaceId,id,input,owner!,now);});}
  async issueAgentServiceKey(prior:TokenPayload,workspaceId:string,id:string,input:Record<string,unknown>,make:MakeServiceCredential,now=Date.now()){if(isAgentActor(prior))fail('FORBIDDEN','Agent不能启用长期凭据',403);return this.connectionTransaction(async db=>{const{actor}=await this.own(db,prior,workspaceId,'ai:chat');return issueServiceKey(db,actor,workspaceId,id,input,make,now);});}
  async revokeAgentServiceKey(prior:TokenPayload,workspaceId:string,id:string,input:Record<string,unknown>,now=Date.now()){if(isAgentActor(prior))fail('FORBIDDEN','Agent不能管理长期凭据',403);return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId);return revokeServiceKey(db,this.identityManager(actor,row),workspaceId,id,input,now);});}
  async resolveAgentServiceKey(token:unknown){return this.transact(db=>resolveServiceCredential(db,token));}
  /** Heartbeat/control traffic reads company metadata, never the shared business JSON. */
  private async taskAccess(db:any,prior:TokenPayload,workspaceId:string,permission?:string){
    if(isAgentActor(prior)&&prior.agentWorkspaceId!==workspaceId)fail('NOT_FOUND','公司不存在或无权访问',404);
    const actor=await this.authorize(db,prior,permission);
    const row=await db.mistWorkspace.findUnique({where:{id:workspaceId},select:{id:true,companyId:true,ownerId:true}});
    if(!row||(row.companyId??null)!==(actor.companyId??null))fail('NOT_FOUND','公司不存在或无权访问',404);
    if(!row.companyId)return (await this.own(db,prior,workspaceId,permission)).actor;
    if(isAgentActor(prior)&&prior.agentServiceLease)await assertServiceLease(db,actor,prior.agentServiceLease,Date.now());
    if(isAgentActor(prior)&&prior.agentTaskControlLease)await assertTaskControl(db,actor,prior.agentTaskControlLease,Date.now());
    if(isAgentActor(prior)&&prior.agentLease)await assertConnection(db,actor,prior.agentLease,Date.now());
    if(isAgentActor(prior)&&prior.agentTaskLease)await assertTaskLease(db,actor,prior.agentTaskLease,Date.now());
    return actor;
  }
  async authorizeAgentTaskConnection(prior:AgentActor){if(!prior.agentWorkspaceId||!prior.agentServiceLease)fail('FORBIDDEN','请使用长期Agent连接',403);await this.transact(db=>this.taskAccess(db,prior,prior.agentWorkspaceId!));}
  async resolveAgentTaskCredential(token:unknown){return this.transact(db=>resolveTaskCredential(db,token,Date.now()));}
  async resolveAgentTaskControl(token:unknown){return this.transact(db=>resolveTaskControl(db,token,Date.now()));}
  async authorizeTaskControlConnection(prior:AgentActor){if(!prior.agentTaskControlLease)fail('FORBIDDEN','任务连接无效',403);await this.transact(db=>this.taskAccess(db,prior,prior.agentTaskControlLease!.workspaceId));}
  async issueAgentTaskControl(prior:TokenPayload,workspaceId:string,taskId:string,input:Record<string,unknown>,make:MakeTaskControl){
    if(isAgentActor(prior))fail('FORBIDDEN','任务连接须由本人签发',403);
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'ai:chat');this.assertTaskSources(row,actor,(await taskRecord(db,workspaceId,taskId)).value);const pending=(row.state.agentProposals??[]).filter(p=>p.taskId===taskId&&p.ownerId===actor.userId&&p.state==='pending').map(p=>p.id);return issueTaskControl(db,actor,workspaceId,taskId,input,make,Date.now(),pending);});
  }
  async taskSessionActor(prior:AgentActor,workerId:string,make:MakeTaskCredential){
    if(!prior.agentTaskControlLease)fail('FORBIDDEN','请使用任务专用连接',403);
    return this.connectionTransaction(async db=>{const control=prior.agentTaskControlLease!,{actor,row}=await this.own(db,prior,control.workspaceId),c=(await taskRecord(db,control.workspaceId,control.taskId)).value;this.assertTaskSources(row,actor,c);const pending=(row.state.agentProposals??[]).filter(p=>p.taskId===c.id&&p.ownerId===actor.userId&&p.state==='pending').map(p=>p.id);const requestId=c.lease?.workerId===workerId&&c.lease.expiresAt>Date.now()?c.lease.claimRequestId:randomUUID();
      const claim=await claimTask(db,{...prior,...actor},control.workspaceId,c.id,{requestId,workerId},make,Date.now(),pending);if(!claim.token)fail('AGENT_TASK_NOT_READY','任务等待本人确认',409);
      const raw=await resolveTaskCredential(db,claim.token,Date.now());raw.agentTaskControlLease=control;const current=(await taskRecord(db,control.workspaceId,c.id)).value;await heartbeatTask(db,actor,raw.agentTaskLease!,current.lease!.sequence+1,Date.now());return raw;
    });
  }
  async pulseTaskSession(prior:AgentActor,workerId:string){
    if(!prior.agentTaskControlLease)return;
    return this.connectionTransaction(async db=>{const control=prior.agentTaskControlLease!,actor=await this.taskAccess(db,prior,control.workspaceId),c=await assertTaskControl(db,actor,control,Date.now());if(c.state!=='running'||c.lease?.workerId!==workerId||c.lease.expiresAt<=Date.now())return;await heartbeatTask(db,actor,{workspaceId:c.workspaceId,taskId:c.id,runId:c.lease.id,grantHash:c.lease.grantHash,serviceLease:c.authority},c.lease.sequence+1,Date.now());});
  }
  async finishAgentTaskSession(prior:TokenPayload,workspaceId:string,input:Record<string,unknown>){
    if(!isAgentActor(prior)||!prior.agentTaskControlLease||!prior.agentTaskWorkerId||prior.agentTaskControlLease.workspaceId!==workspaceId)fail('FORBIDDEN','请使用本任务连接',403);
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId),c=(await taskRecord(db,workspaceId,prior.agentTaskControlLease!.taskId)).value;this.assertTaskSources(row,actor,c);if(input.outcome==='succeeded'&&await taskHasPendingMail(db,workspaceId,c.id))fail('PRECONDITION','请先核对待同步的邮箱操作',422);return finishTaskSession(db,actor,prior.agentTaskControlLease!,prior.agentTaskWorkerId!,input,Date.now());});
  }
  async listAgentTasks(prior:TokenPayload,workspaceId:string,cursor?:unknown){
    if(isAgentActor(prior)&&(!prior.agentServiceLease||prior.agentTaskLease))fail('FORBIDDEN','请使用执行器管理连接',403);
    return this.transact(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'ai:chat');const visible=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;return listTasks(db,{...prior,...actor},workspaceId,cursor,Date.now(),c=>this.taskSourcesAllowed(row,actor,c,visible));});
  }
  async getAgentTask(prior:TokenPayload,workspaceId:string,taskId:string,summaryOnly=false){
    if(isAgentActor(prior)&&prior.agentTaskLease&&prior.agentTaskLease.taskId!==taskId)fail('NOT_FOUND','任务不存在或无权访问',404);
    if(summaryOnly)return this.transact(async db=>{const actor=await this.taskAccess(db,prior,workspaceId,'ai:chat'),c=(await taskRecord(db,workspaceId,taskId)).value;if(isAgentActor(prior)&&prior.agentIdentity?.id!==c.identityId)fail('NOT_FOUND','任务不存在或无权访问',404);let valid=true;try{await assertTaskViewAuthority(db,actor,c,Date.now());}catch(e){if(!(e instanceof MistApiError))throw e;valid=false;}return {...taskView(c,actor,Date.now(),valid),name:'Agent任务',instructions:'',checkpoint:'',result:''};});
    return this.transact(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'ai:chat'),c=(await taskRecord(db,workspaceId,taskId)).value;if(isAgentActor(prior)&&prior.agentIdentity?.id!==c.identityId)fail('NOT_FOUND','任务不存在或无权访问',404);let valid=this.taskSourcesAllowed(row,actor,c);try{await assertTaskViewAuthority(db,actor,c,Date.now());}catch(e){if(!(e instanceof MistApiError))throw e;valid=false;}return taskView(c,actor,Date.now(),valid);});
  }
  async createAgentTask(prior:TokenPayload,workspaceId:string,input:Record<string,unknown>){
    if(isAgentActor(prior))fail('FORBIDDEN','任务须由本人安排',403);
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'ai:chat');const result=await createTask(db,actor,workspaceId,input,Date.now(),taskScopeHash(scopeOf(row),row.state));const c=(await taskRecord(db,workspaceId,result.id)).value;return taskView(c,actor,Date.now(),result.state!=='access_changed'&&this.taskSourcesAllowed(row,actor,c));});
  }
  async claimAgentTask(prior:TokenPayload,workspaceId:string,taskId:string,input:Record<string,unknown>,make:MakeTaskCredential){
    if(!isAgentActor(prior)||!prior.agentServiceLease||prior.agentTaskLease)fail('FORBIDDEN','请使用执行器管理连接领取任务',403);
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId);this.assertTaskSources(row,actor,(await taskRecord(db,workspaceId,taskId)).value);const pending=(row.state.agentProposals??[]).filter(p=>p.taskId===taskId&&p.ownerId===actor.userId&&p.state==='pending').map(p=>p.id);return claimTask(db,{...prior,...actor},workspaceId,taskId,input,make,Date.now(),pending);});
  }
  async changeAgentTask(prior:TokenPayload,workspaceId:string,taskId:string,action:'pause'|'resume',input:Record<string,unknown>){
    if(isAgentActor(prior))fail('FORBIDDEN','任务须由本人管理',403);
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'ai:chat');if(action==='resume')this.assertTaskSources(row,actor,(await taskRecord(db,workspaceId,taskId)).value);const pending=(row.state.agentProposals??[]).filter(p=>p.taskId===taskId&&p.ownerId===actor.userId&&p.state==='pending').map(p=>p.id);return changeTask(db,actor,workspaceId,taskId,action,input,Date.now(),pending);});
  }
  async cancelAgentTask(prior:TokenPayload,workspaceId:string,taskId:string,input:Record<string,unknown>){
    if(isAgentActor(prior))fail('FORBIDDEN','任务须由本人停止',403);
    const previous=await this.receipt(prior,workspaceId,input.requestId as string).catch((e:any)=>{if(['NOT_FOUND','RECEIPT_NOT_FOUND'].includes(e.code))return null;throw e;});
    for(let n=0;;n++){const ws=await this.get(prior,workspaceId);try{return await this.execute(prior,workspaceId,{requestId:input.requestId as string,expectedRevision:previous?.expectedRevision??ws.revision,command:{type:'agent.task.cancel',payload:{id:taskId,version:input.version as number}}});}catch(e:any){if(e.code!=='REVISION_CONFLICT'||n>=2||previous)throw e;}}
  }
  async agentTaskRuntime(prior:TokenPayload,workspaceId:string,action:'heartbeat'|'checkpoint'|'finish',input:Record<string,unknown>){
    if(!isAgentActor(prior)||!prior.agentTaskLease||prior.agentTaskLease.workspaceId!==workspaceId)fail('FORBIDDEN','请使用本任务执行连接',403);
    return this.connectionTransaction(async db=>{const actor=action==='heartbeat'?await this.taskAccess(db,prior,workspaceId):(await this.own(db,prior,workspaceId)).actor;if(action==='finish'&&input.outcome==='succeeded'&&await taskHasPendingMail(db,workspaceId,prior.agentTaskLease!.taskId))fail('PRECONDITION','请先核对待同步的邮箱操作',422);return action==='heartbeat'?heartbeatTask(db,actor,prior.agentTaskLease!,input.sequence,Date.now()):action==='checkpoint'?checkpointTask(db,actor,prior.agentTaskLease!,input,Date.now()):finishTask(db,actor,prior.agentTaskLease!,input,Date.now());});
  }
  async reserveAgentTaskRequest(prior:AgentActor,requestId:string,input:unknown){
    if(!prior.agentTaskLease)return;
    return this.connectionTransaction(async db=>{const actor=await this.taskAccess(db,prior,prior.agentTaskLease!.workspaceId);return reserveTaskStep(db,actor,prior.agentTaskLease!,requestId,createHash('sha256').update(canonical(input)).digest('hex'),Date.now());});
  }
  async recordAgentTaskRead(prior:TokenPayload,workspaceId:string,data:unknown){
    if(!isAgentActor(prior)||!prior.agentTaskLease)return;
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId),c=(await taskRecord(db,workspaceId,prior.agentTaskLease!.taskId)).value;const visible=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;await saveTaskSources(db,actor,prior.agentTaskLease!,collectTaskSources(data,visible,c.sources),Date.now());});
  }
  async agentTaskExpectedRevision(prior:TokenPayload,workspaceId:string,command:{type:string;payload:Record<string,unknown>}){
    if(!isAgentActor(prior)||!prior.agentTaskLease)return undefined;
    return this.transact(async db=>{const{row}=await this.own(db,prior,workspaceId),c=(await taskRecord(db,workspaceId,prior.agentTaskLease!.taskId)).value,ids=new Set<string>();const walk=(v:any)=>{if(typeof v==='string')ids.add(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};walk(command.payload);const fields=command.type==='email.flag'?[String(command.payload.flag)]:command.type==='email.move'?['folder','previousFolder']:['email.link','email.unlink'].includes(command.type)?['links']:command.type==='email.extraction.review'?['analysis','extractionReview','extracted','category']:command.type==='email.submitExtraction'?['analysis','extractionReview','extracted','submissions','links']:[];const versions=c.sources.filter(r=>ids.has(r.id)&&r.observedRevision!==undefined).flatMap(r=>r.path==='email.messages'&&fields.length?fields.map(f=>r.fieldRevisions?.[f]??r.observedRevision!):[r.observedRevision!]);return versions.length?Math.min(...versions):row.revision;});
  }
  async agentTaskHistory(prior:TokenPayload,workspaceId:string,taskId:string,cursor:unknown){if(isAgentActor(prior))fail('FORBIDDEN','任务记录只供本人查看',403);return this.transact(async db=>{const actor=await this.taskAccess(db,prior,workspaceId,'ai:chat');return taskHistory(db,actor,workspaceId,taskId,cursor);});}
  async agentIdentityHistory(prior:TokenPayload,workspaceId:string,id:string,cursor?:unknown){return this.transact(async db=>{const{row,actor}=await this.own(db,prior,workspaceId);return identityHistory(db,this.identityManager(actor,row),workspaceId,id,cursor);});}
  /** 工作助手读取：与 get 相同的进入与投影规则，同时返回重新加载后的执行者供逐类型复核。 */
  async getForAgent(prior:TokenPayload,id:string){return this.transact(async db=>{const {row,actor}=await this.own(db,prior,id);return {workspace:this.view(row,actor),actor};});}
  async getForAssistant(prior:TokenPayload,id:string){return this.transact(async db=>{const {row,actor}=await this.own(db,prior,id,'ai:chat');return {workspace:this.view(row,actor),actor};});}

  async create(prior: TokenPayload, input: { name: string; slug?: string; seed?: 'demo' | 'empty' }, defaultOnly = false) {
    const name = identifier(input.name, '公司名称'), slug = defaultOnly ? 'default' : identifier(input.slug || randomUUID(), '公司标识');
    if (input.seed !== undefined && !['demo', 'empty'].includes(input.seed)) fail('INVALID_INPUT', '公司初始方式无效', 400);
    // 正式账号首次进入的默认公司一律空白，示例数据只在本机演示模式或显式新建演示公司时出现。
    const seed = defaultOnly && !localMode(prior) ? 'empty' : input.seed ?? 'demo', requestId = `create:${slug}`;
    const inputHash = createHash('sha256').update(canonical({ type: 'workspace.create', actorId: prior.userId, name, seed })).digest('hex');
    const create = () => this.transact(async db => {
      const actor = await this.authorize(db, prior);
      // 一家公司一个业务库：已有则直接进入（任何在职成员都进同一个库）；没有才由首位进入的成员建立空白公司库。
      // 显式“新建公司”在公司会话中不可用；不合并、不迁移任何历史个人空间的数据。
      if (companyLibrary(actor)) {
        const library: MistWorkspaceRow | null = await db.mistWorkspace.findFirst({ where: { companyId: actor.companyId } });
        if (library) {
          if (!defaultOnly) singleLibrary();
          applyRoster(library.state, await companyRoster(db, actor.companyId!)); { const scope = await companyDataScope(db, library, actor); if (scope) ROW_SCOPE.set(library, scope); OWN_TEAMS.set(library, scope?.teamIds ?? await companyTeamIds(db, library.companyId!, actor.userId)); }
          this.contract.normalizeMistState?.(library.state, this.context(actor));
          return this.view(library, actor);
        }
        const state = this.contract.createMistState(this.context(actor), 'empty'); state.settings.workspaceName = name;
        const row = await db.mistWorkspace.create({ data: { id: randomUUID(), ownerId: actor.userId, companyId: actor.companyId, slug: companySlug(actor.companyId!), name, revision: 0, state } });
        applyRoster(row.state, await companyRoster(db, actor.companyId!)); { const scope = await companyDataScope(db, row, actor); if (scope) ROW_SCOPE.set(row, scope); OWN_TEAMS.set(row, scope?.teamIds ?? await companyTeamIds(db, row.companyId!, actor.userId)); }
        await this.authorize(db, prior);
        return this.view(row, actor);
      }
      const scopedSlug = actor.companyId ? `${slug}@${actor.companyId}` : slug;
      const found = await db.mistWorkspace.findUnique({ where: { ownerId_slug: { ownerId: actor.userId, slug: scopedSlug } } });
      if (found) {
        if(archived(found)){if(defaultOnly)return this.view(await this.activeWorkspace(db,actor),actor);fail('WORKSPACE_ARCHIVED','\u5de5\u4f5c\u533a\u5df2\u5728\u56de\u6536\u7ad9\uff0c\u8bf7\u5148\u6062\u590d',409);}
        if (defaultOnly) {this.contract.normalizeMistState?.(found.state,this.context(actor));return this.view(found,actor);}
        const previous = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId: found.id, requestId } } });
        if (!previous || previous.actorId !== actor.userId || previous.inputHash !== inputHash || previous.expectedRevision !== 0) fail('REQUEST_CONFLICT', '此创建请求已用于不同的公司参数', 409);
        await this.authorize(db, prior);
        this.contract.normalizeMistState?.(found.state,this.context(actor));return this.view(found,actor);
      }
      if (defaultOnly && localMode(actor) && actor.userId.startsWith('demo-')) {
        // 本机演示：示例经办人共用一个演示公司（周敏 demo-reviewer 为所有者，其余经办人为成员），
        // 以便按岗位切换身份走通同一套协作链。所有者移除某人后不再自动加回，该人改用自己的默认公司。
        const owner = 'demo-reviewer', shared: MistWorkspaceRow | null = await db.mistWorkspace.findUnique({ where: { ownerId_slug: { ownerId: owner, slug: 'default' } } });
        if (shared && !archived(shared) && (shared.ownerId === actor.userId || memberIds(shared.state).includes(actor.userId))) { this.contract.normalizeMistState?.(shared.state, this.context(actor)); return this.view(shared, actor); }
        if (!shared) {
          const ownerProfile = MIST_LOCAL_PROFILES.find(p => p.id === owner)!, context = this.context({ ...actor, userId: owner, displayName: ownerProfile.name } as TokenPayload);
          const state: any = this.contract.createMistState(context, 'demo'), workspaceId = randomUUID(), others = MIST_LOCAL_PROFILES.filter(p => p.id.startsWith('demo-') && p.id !== owner);
          state.settings.workspaceName = name; state.memberIds = others.map(p => p.id);
          state.members = others.map(p => ({ userId: p.id, name: p.name, addedBy: owner, addedByName: ownerProfile.name, addedAt: context.now }));
          await this.writeDemoFiles(workspaceId, state);
          const row = await db.mistWorkspace.create({ data: { id: workspaceId, ownerId: owner, slug: 'default', name, revision: 0, state } });
          await this.authorize(db, prior);
          return this.view(row, actor);
        }
      }
      if (defaultOnly) {
        // A default lookup selects an existing active workspace before creating
        // anything. Named workspaces and archive continuations need not own the
        // reserved default slug, and must not be replaced with another seed.
        const rows: MistWorkspaceRow[] = await db.mistWorkspace.findMany({ where: { ownerId: actor.userId, ...(actor.companyId ? { companyId: actor.companyId } : {}) }, orderBy: { updatedAt: 'desc' } });
        const active = rows.find(row => !archived(row));
        if (active) {
          this.contract.normalizeMistState?.(active.state, this.context(actor));
          return this.view(active, actor);
        }
        // 公司成员首次登录：已被授权进入公司时直接进入该公司，不另建同名的个人空白公司（否则会落在空白公司里找不到业务）。
        const shared: MistWorkspaceRow[] = await db.mistWorkspace.findMany({ where: { ...(actor.companyId ? { companyId: actor.companyId } : {}), OR: [{ state: { path: ['memberIds'], array_contains: [actor.userId] } }] }, orderBy: { updatedAt: 'desc' } });
        const joined = shared.find(row => !archived(row) && isMember(row, actor));
        if (joined) {
          this.contract.normalizeMistState?.(joined.state, this.context(actor));
          return this.view(joined, actor);
        }
      }
      const state = this.contract.createMistState(this.context(actor), seed), workspaceId = randomUUID();
      state.settings.workspaceName = name;
      await this.writeDemoFiles(workspaceId, state);
      const row = await db.mistWorkspace.create({ data: { id: workspaceId, ownerId: actor.userId, companyId: actor.companyId ?? null, slug: scopedSlug, name, revision: 0, state } });
      if (!defaultOnly) await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId: row.id, requestId, actorId: actor.userId, inputHash, expectedRevision: 0, result: { revision: 0, result: { workspaceId: row.id } } } });
      await this.authorize(db, prior);
      return this.view(row, actor);
    });
    try { return await create(); } catch (error: any) {
      if (defaultOnly && ['P2002', 'P2034'].includes(error?.code)) return create();
      // The competing transaction may already have committed this creation.
      // A fresh serializable read must verify its durable input before replay.
      if (['P2002', 'P2034'].includes(error?.code)) return create();
      throw error;
    }
  }
  async receipt(prior: TokenPayload, workspaceId: string, requestId: string) { return this.transact(async db => {
    await this.own(db, prior, workspaceId,null,false,true);
    const receipt = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: requestIdentifier(requestId, typeof requestId === 'string' && requestId.startsWith('create:') ? 127 : 120) } } });
    if (!receipt || receipt.actorId !== prior.userId) fail('NOT_FOUND', '请求回执不存在', 404);
    return { requestId: receipt.requestId, ...publicCommandReceiptResult(receipt.result), expectedRevision: receipt.expectedRevision };
  }); }
  async agentAudits(prior:TokenPayload,workspaceId:string,input:Record<string,unknown>={}) {return this.transact(async db=>{
    const {actor}=await this.own(db,prior,workspaceId);
    const allowed=['scope','actorId','source','phase','proposalId','agentSessionId','since','until','cursor','limit'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))fail('INVALID_INPUT','查询参数无效',400);
    const company=input.scope==='company';if(input.scope!==undefined&&!['mine','company'].includes(String(input.scope)))fail('INVALID_INPUT','查询范围无效',400);
    const canReadCompany=hasScope(actor,'audit:read');if(company&&!canReadCompany)fail('FORBIDDEN','没有公司审计查看权限',403);
    const number=(v:unknown,fallback:number)=>{if(v===undefined)return fallback;if((typeof v!=='number'&&typeof v!=='string')||!/^\d+$/.test(String(v))||Number(v)<1||Number(v)>50)fail('INVALID_INPUT','每页条数须为1至50',400);return Number(v);};
    const limit=number(input.limit,20),where:any={workspaceId,inputHash:AGENT_AUDIT_HASH,requestId:{startsWith:AGENT_AUDIT_PREFIX}};
    if(!company)where.actorId=actor.userId;
    if(input.actorId!==undefined){const id=identifier(input.actorId,'经办账号');if(!company&&id!==actor.userId)fail('FORBIDDEN','只能查看本人操作',403);where.actorId=id;}
    const and:any[]=[];
    for(const key of ['proposalId','agentSessionId'])if(input[key]!==undefined)and.push({result:{path:[AGENT_AUDIT_FIELD,key],equals:identifier(input[key],'关联编号')}});
    for(const [key,values] of [['source',['agent','human_confirmation','human_rejection']],['phase',['executed','proposed','confirmed','rejected']]] as const)if(input[key]!==undefined){if(!values.includes(input[key] as never))fail('INVALID_INPUT','操作类型无效',400);and.push({result:{path:[AGENT_AUDIT_FIELD,key],equals:input[key]}});}
    for(const [key,op] of [['since','gte'],['until','lte']] as const)if(input[key]!==undefined){const date=input[key];if(typeof date!=='string'||!/^\d{4}-\d\d-\d\dT/.test(date)||!Number.isFinite(Date.parse(date)))fail('INVALID_INPUT','查询时间无效',400);(where.createdAt??={})[op]=new Date(date as string);}
    if(input.cursor!==undefined){
      if(typeof input.cursor!=='string'||input.cursor.length>500||!/^[A-Za-z0-9_-]+$/.test(input.cursor))fail('INVALID_INPUT','翻页位置无效',400);
      let c:any;try{c=JSON.parse(Buffer.from(input.cursor as string,'base64url').toString());}catch{fail('INVALID_INPUT','翻页位置无效',400);}
      if(!c||typeof c.at!=='string'||!Number.isFinite(Date.parse(c.at))||typeof c.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id))fail('INVALID_INPUT','翻页位置无效',400);
      and.push({OR:[{createdAt:{lt:new Date(c.at)}},{createdAt:new Date(c.at),id:{lt:c.id}}]});
    }
    if(and.length)where.AND=and;
    const rows=await db.mistCommandReceipt.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit+1});
    const page=rows.slice(0,limit),last=page.at(-1),nextCursor=rows.length>limit&&last?Buffer.from(JSON.stringify({at:new Date(last.createdAt??last.result?.[AGENT_AUDIT_FIELD]?.at??0).toISOString(),id:last.id})).toString('base64url'):null;
    const audits=page.flatMap((r:any)=>{const a=auditFromReceipt(r,workspaceId);return a?[a]:[];});
    const parents=audits.length?await db.mistCommandReceipt.findMany({where:{workspaceId,requestId:{in:audits.map((a:any)=>a.requestId)}}}):[];
    const byRequest=new Map(parents.map((p:any)=>[p.requestId,p]));
    const items=audits.filter((a:any)=>auditMatchesParent(a,byRequest.get(a.requestId))).map(auditEntry);
    return {items,nextCursor,canReadCompany,unavailableCount:page.length-items.length};
  });}
  async agentAudit(prior:TokenPayload,workspaceId:string,requestId:string,input:Record<string,unknown>={}) {return this.transact(async db=>{
    requestIdentifier(requestId);
    if(Object.keys(input).some(k=>!['offset','limit','includeCommand'].includes(k)))fail('INVALID_INPUT','查询参数无效',400);
    const {actor,row}=await this.own(db,prior,workspaceId);
    const pair=await db.mistCommandReceipt.findMany({where:{workspaceId,requestId:{in:[agentAuditReceiptId(requestId),requestId]}}});
    const receipt=pair.find((r:any)=>r.requestId===agentAuditReceiptId(requestId));
    const audit=auditFromReceipt(receipt,workspaceId);if(!audit||(audit.actor.id!==actor.userId&&!hasScope(actor,'audit:read')))fail('NOT_FOUND','操作记录不存在或无权查看',404);
    const parent=pair.find((r:any)=>r.requestId===requestId);
    if(!auditMatchesParent(audit!,parent))fail('NOT_FOUND','操作记录不存在或无权查看',404);
    const integer=(value:unknown,fallback:number,min:number,max:number)=>{if(value===undefined)return fallback;if((typeof value!=='string'&&typeof value!=='number')||!/^\d+$/.test(String(value))||Number(value)<min||Number(value)>max)fail('INVALID_INPUT','明细翻页参数无效',400);return Number(value);};
    if(input.includeCommand!==undefined&&![true,false,'true','false'].includes(input.includeCommand as any))fail('INVALID_INPUT','查询参数无效',400);
    const visible=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;
    return projectAgentAudit(audit!,{actor,current:row.state,visible,project:s=>projectState(s,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state,permission:c=>this.contract.mistCommandPermission(c),unrestricted:!scopeOf(row),offset:integer(input.offset,0,0,1000000),limit:integer(input.limit,25,1,50),includeCommand:input.includeCommand===true||input.includeCommand==='true'});
  });}
  async execute(prior: TokenPayload, workspaceId: string, input: MistCommandRequest) {
    if (!input.command || typeof input.command.type !== 'string' || !input.command.payload || typeof input.command.payload !== 'object' || Array.isArray(input.command.payload)) fail('INVALID_COMMAND', '业务命令格式无效', 400);
    if (input.command.type === 'files.add') fail('INVALID_COMMAND', '附件只能通过真实上传接口添加', 400);
    if (EMAIL_SERVER_COMMAND.test(input.command.type)) fail('INVALID_COMMAND', '收信、发信与连接结果只能由服务端邮件服务写入', 400);
    if (input.command.type === 'agent.proposal.confirm') {
      // 本人确认 Agent 提议：换成提议里的原命令，按本人身份走完整门禁；同一事务内再核对提议未变后记为已确认。
      if (isAgentActor(prior)) fail('FORBIDDEN', 'Agent 不能确认提议，须本人在系统中确认', 403);
      const id = typeof input.command.payload.id === 'string' ? input.command.payload.id : '';
      const { workspace } = await this.getForAgent(prior, workspaceId);
      const proposal = workspace.state.agentProposals?.find((p: { id: string; state: string }) => p.id === id && p.state === 'pending');
      if (!proposal) fail('NOT_FOUND', '提议不存在、已处理或不属于当前账号', 404);
      if(proposal!.unavailable||proposal!.taskBlocked)fail(proposal!.taskId?'AGENT_TASK_SCOPE_CHANGED':'AGENT_PROPOSAL_UNAVAILABLE',proposal!.taskBlocked||'提议来源已不可见',409);
      return this.executeInternal(prior, workspaceId, { ...input, command: proposal!.command }, { command: input.command }, undefined, false, id);
    }
    return this.executeInternal(prior, workspaceId, input, { command: input.command });
  }
  /**
   * 预演：与 execute 走同一事务、同一套账号 / 成员 / 权限 / 范围 / 业务门禁，应用命令后整笔回滚，不留状态、回执或编号。
   * 返回本应产生的结果与业务事件说明，供工作助手和外部 Agent 在执行前核对。会生成文件的命令不支持预演。
   */
  async preview(prior: TokenPayload, workspaceId: string, input: MistCommandRequest) {
    if (!input.command || typeof input.command.type !== 'string' || !input.command.payload || typeof input.command.payload !== 'object' || Array.isArray(input.command.payload)) fail('INVALID_COMMAND', '业务命令格式无效', 400);
    if (input.command.type === 'files.add' || EMAIL_SERVER_COMMAND.test(input.command.type)) fail('INVALID_COMMAND', '该命令只能由服务端写入', 400);
    if (PREVIEW_UNSUPPORTED.has(input.command.type)) fail('PREVIEW_UNSUPPORTED', '该命令会生成正式文件，不支持预演', 400);
    try { await this.executeInternal(prior, workspaceId, input, { command: input.command }, undefined, true); }
    catch (error) { if (error instanceof MistPreviewOutcome) return error.preview; throw error; }
    fail('PREVIEW_UNSUPPORTED', '预演未完成', 500);
  }
  private async executeInternal(prior: TokenPayload, workspaceId: string, input: Omit<MistCommandRequest, 'command'> & { command?: any; claimId?: string }, hashPayload: any, upload?: MistFileInput, dryRun = false, confirmProposalId = '') {
    if(isAgentActor(prior)&&prior.agentTaskLease&&!prior.agentTaskOperation)fail('FORBIDDEN','任务业务请求缺少操作编号',403);
    if (isAgentActor(prior)) identifier(prior.agentSessionId, 'Agent会话编号');
    requestIdentifier(input.requestId); revision(input.expectedRevision);
    const hash = createHash('sha256').update(canonical({ actorId: prior.userId, expectedRevision: input.expectedRevision, ...hashPayload })).digest('hex');
    const permissionFor = async (db: any) => upload&&input.claimId!==undefined?'aftersales:write':!input.command&&upload?await this.uploadPermission(db, prior):this.contract.mistCommandPermission(input.command ?? { type: 'files.add', payload: {} });
    // 每次尝试都是一笔全新事务：重新读取最新状态并重新核验账号、成员、权限与业务门禁；不复用旧整份状态。
    for (let attempt = 1; ; attempt++) {
      let stored: MistStoredFile | undefined;
      try { const response = await this.writeTransact(workspaceId, async db => {
        const permission = await permissionFor(db);
        const { actor, row } = await this.own(db, prior, workspaceId, permission, true, false, false, isAgentActor(prior) || !!confirmProposalId || input.command?.type === 'agent.proposal.reject');
        if(input.command?.type==='email.account.save'){const existing=row.state.email?.accounts.find(a=>a.id===input.command.payload?.id);if(existing?.kind==='shared'&&emailAccountAccessible(existing,actor.userId))await this.authorize(db,prior,'emails:admin');}
        await this.authorizeCompoundCommand(db, prior, input.command);
        if (input.command?.type === 'email.server.analysis' || input.command?.type === 'email.extraction.review') {
          const visible = projectState(row.state, actor, this.emptyState(actor), fileOwner(row), scopeOf(row)).state;
          const message = visible.email.messages.find(m => m.id === input.command!.payload.id);
          if (!message) fail('NOT_FOUND', '邮件不存在或当前账号不可见', 404);
          const expected = input.command.type === 'email.server.analysis' ? input.command.payload.analysis.sourceHash : message!.analysis?.sourceHash;
          if (!expected || emailAnalysisHash(message!) !== expected) fail('CONFLICT', '邮件原文已变化，请重新整理', 409);
        }
        if (permission === null && !MEMBER_PERSONAL_COMMANDS.includes(input.command?.type) && !(companyRow(row) ? canMaintainCompany(actor) : isOwner(row, actor))) fail('FORBIDDEN', companyRow(row) ? '公司设置只能由公司管理员修改' : '公司设置只能由所有者修改', 403);
        const previous = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: input.requestId } } });
        if (previous) {
          if (previous.actorId !== actor.userId || previous.inputHash !== hash || previous.expectedRevision !== input.expectedRevision) fail('REQUEST_CONFLICT', '此请求编号已用于另一项操作', 409);
          return { workspace: this.view(row, actor), receipt: { requestId: previous.requestId, ...publicCommandReceiptResult(previous.result), expectedRevision: previous.expectedRevision }, replayed: true };
        }
        if(input.command?.type==='agent.task.cancel'){
          if(isAgentActor(prior))fail('FORBIDDEN','任务须由本人停止',403);
          await changeTask(db,actor,workspaceId,input.command.payload.id,'cancel',{requestId:input.requestId,version:input.command.payload.version},Date.now(),[]);
        }
        if(isAgentActor(prior)&&prior.agentTaskLease&&input.command?.type==='agent.proposal.create'&&await taskHasPendingMail(db,workspaceId,prior.agentTaskLease.taskId))fail('PRECONDITION','请先核对待同步的邮箱操作',422);
        const humanTaskProposal=confirmProposalId?row.state.agentProposals?.find(p=>p.id===confirmProposalId):undefined;
        if(humanTaskProposal&&!humanTaskProposal.taskId){const visible=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;if(!readableCommand(humanTaskProposal.command,actor,this.contract.mistCommandPermission)||!knownCommandSourcesVisible(row.state,visible)(humanTaskProposal.command))fail('FORBIDDEN','提议来源已不可见，请拒绝后重新核对',403);}
        if(humanTaskProposal?.taskId){this.assertTaskSources(row,actor,(await taskRecord(db,workspaceId,humanTaskProposal.taskId)).value);await assertHumanTaskProposal(db,actor,workspaceId,humanTaskProposal.taskId,humanTaskProposal.id,Date.now());}
        // 版本落后时只在能证明安全时把本命令重新应用到最新状态；否则照旧明确拒绝。
        const concurrent = row.revision === input.expectedRevision ? undefined : await this.concurrentChanges(db, workspaceId, row.revision, input.expectedRevision, upload ? 'files.add' : input.command?.type);
        const earlyScope = scopeOf(row);
        if (companyRow(row) && ['market.customer.update','customer.update'].includes(input.command?.type)) {
          const customer = row.state.customers.find(item => item.id === input.command.payload?.id);
          const ownerId = input.command.payload?.patch?.ownerId;
          if (customer && ownerId !== undefined && ownerId !== customer.ownerId && !hasScope(actor, 'relations:admin')) fail('FORBIDDEN', '客户负责人变更需要客户管理权限', 403);
          if (customer && earlyScope && !earlyScope.userIds.includes(customer.ownerId)) fail('NOT_FOUND', '客户不在当前可维护范围内', 404);
        }
        if (earlyScope && ['market.contact.save','market.contact.delete','contact.save'].includes(input.command?.type)) {
          const payload=input.command.payload, customerId=input.command.type==='contact.save'?payload?.customerId:payload?.kind==='customer'?payload.parentId:payload?.kind==='relation'?row.state.market.relations.find(item=>item.id===payload.parentId)?.customerId:undefined;
          const customer = row.state.customers.find(item => item.id === customerId);
          if (customer && !earlyScope.userIds.includes(customer.ownerId)) fail('NOT_FOUND', '客户不在当前可维护范围内', 404);
        }
        if (earlyScope && input.command?.type === 'handover.customer') {
          const customer = row.state.customers.find(item => item.id === input.command.payload?.customerId);
          if (customer && !earlyScope.userIds.includes(customer.ownerId)) fail('NOT_FOUND', '客户不在当前可交接范围内', 404);
        }
        if (input.command) {
          if (input.command.type === 'email.submitExtraction') {
            const visible = projectState(row.state, actor, this.emptyState(actor), fileOwner(row), earlyScope).state;
            const ownerId = emailBusinessOwner(visible, input.command.payload.link);
            if (!ownerId || !candidateIds(row).includes(ownerId)) fail('PRECONDITION', '请先核对业务负责人及其公司成员资格', 422);
            const recipient = await this.reviewSubject(db, actor, ownerId!, '业务负责人');
            if (!hasScope(recipient, 'emails:read') || !hasScope(recipient, 'emails:write')) fail('PRECONDITION', '业务负责人缺少邮件办理权限，请先核对岗位', 422);
          }
          if(input.command.type.startsWith('order.internal.')&&!hasScope(actor,'orders:read'))fail('FORBIDDEN','内部交付需要订单查看和办理权限',403);
          if(input.command.type==='order.internal.send'){
            const required=['orders:read','production:read','procurement:read'] as const;
            if(required.some(permission=>!hasScope(actor,permission))||input.command.payload.source?.kind==='stockIssue'&&!hasScope(actor,'inventory:read'))fail('FORBIDDEN','内部交付需要读取准确订单、生产及交付来源',403);
            const receiverId=input.command.payload.receiverId;
            if(typeof receiverId!=='string'||!receiverId.trim())fail('VALIDATION','请选择本次接收账号',422);
            const listedReceiver=memberIds(row.state).includes(receiverId)||!companyRow(row)&&receiverId===row.ownerId;
            if(!listedReceiver)fail('VALIDATION','本次接收账号须为本公司在用成员',422);
            const receiver=await this.reviewSubject(db,actor,receiverId,'接收账号');
            if(!hasScope(receiver,'orders:read')||!hasScope(receiver,'orders:write'))fail('PRECONDITION','接收账号缺少订单办理权限，请换人或由管理员调整岗位',422);
          }
          const known = new Set(row.state.files.map(file => file.id));
          const allowed = new Set(projectState(row.state, actor, this.emptyState(actor), fileOwner(row), earlyScope).state.files.map(file => file.id));
          const check = (value: unknown): void => {
            if (typeof value === 'string' && known.has(value) && !allowed.has(value)) fail('FILE_NOT_FOUND', '附件不存在或当前账号无权引用', 404);
            else if (Array.isArray(value)) value.forEach(check);
            else if (value && typeof value === 'object') Object.values(value).forEach(check);
          };
          check(input.command.payload);
        }
        if (earlyScope && scopedTargetViolation(row.state, earlyScope, input.command, input.claimId, actor.userId)) fail('NOT_FOUND', '记录不存在或不在当前账号的业务范围内', 404);
        const scopeManagement = input.command?.type?.startsWith('teamScope.') || REVIEW_KIND_BY_COMMAND.has(input.command?.type);
        const crossIssue=input.command?.type==='fulfillment.materials.issue'?input.command.payload:undefined;
        const crossTarget=earlyScope&&crossIssue&&scopedMaterialIssueTargets(row.state,earlyScope)[crossIssue.id]?.some(option=>option.value===crossIssue.targetProductionId)?crossIssue.targetProductionId:undefined;
        const fabricAccess=earlyScope&&hasScope(actor,'orders:read')&&hasScope(actor,'orders:write')?scopedFabricAccess(row.state,earlyScope,actor.userId,actor.displayName||actor.userId):undefined;
        const allocating=input.command?.type==='order.fabric.allocate'?input.command.payload:undefined;
        const fabricCandidate=allocating&&fabricAccess?.[allocating.lineId]?.candidates.find(c=>c.fabricOrderId===allocating.fabricOrderId&&c.fabricLineId===allocating.fabricLineId&&row.state.orderLines.some(l=>l.id===allocating.lineId&&l.orderId===allocating.orderId));
        const confirming=input.command?.type==='fulfillment.materials.confirm'?input.command.payload:undefined;
        const incoming=confirming?.kind==='issue'?Object.values(fabricAccess||{}).flatMap(a=>a.deliveries).find(d=>d.id===confirming.id):undefined;
        const crossRefs=new Set([...(crossTarget?[crossTarget]:[]),...(fabricCandidate?[fabricCandidate.fabricOrderId,fabricCandidate.fabricLineId]:[]),...(incoming?[incoming.id]:[])]);
        if (earlyScope && !scopeManagement && scopedReferenceViolation(row.state, earlyScope, input.command?.payload, ['market.quotation.save','order.create','order.governance.saveDraft'].includes(input.command?.type),crossRefs)) fail('NOT_FOUND', '来源记录不存在或不在当前账号的业务范围内', 404);
        if(upload&&input.claimId!==undefined)activeUploadClaim(row.state,input.claimId);
        const context = this.context(actor, input.command?.type?.startsWith('email.') ? undefined : row.state);
        // 经 Agent（委托令牌）的写入在业务事件经办人后标注，账号与权限判断不受影响。
        if (isAgentActor(prior)) Object.assign(context, { actorName: `${context.actorName}（经 Agent）`, viaAgent: true, agentSessionId: prior.agentSessionId,...(prior.agentIdentity?{agentIdentity:prior.agentIdentity}:{}),...(prior.agentTaskLease?{agentTaskId:prior.agentTaskLease.taskId,agentTaskSourceRevision:prior.agentTaskSourceRevision}:{}) });
        if (MEMBER_PERSONAL_COMMANDS.includes(input.command?.type)) {
          const visible = projectState(row.state, actor, this.emptyState(actor), fileOwner(row), scopeOf(row)).state;
          const { type, payload } = input.command;
          const collection = type === 'notification.read' ? visible.notifications : type === 'task.complete' ? visible.tasks : type === 'calendar.save' && payload.id ? visible.calendar : undefined;
          if (collection && !collection.some(item => item.id === payload.id)) fail('NOT_FOUND', '记录不存在或当前账号无权访问', 404);
          if (type === 'calendar.save' && !canReadTarget(actor, payload.target)) fail('FORBIDDEN', '无权关联该业务来源', 403);
          if (type === 'notification.readAll') context.visibleNotificationIds = visible.notifications.map(item => item.id);
        }
        if(input.command) {
          const kind=REVIEW_KIND_BY_COMMAND.get(input.command.type),payload=input.command.payload as {id?:unknown;escalationId?:unknown}|undefined;
          const review=kind?this.reviews(row.state).find(task=>task.kind===kind&&(kind==='risk'?task.entityId===payload?.escalationId&&task.target.id===payload?.id:task.entityId===payload?.id)):undefined;
          const subject=review?await this.reviewSubject(db,actor,review.requesterId):actor;
          context.authority = await mistApprovalAuthority(db,subject,input.command.type,candidateIds(row));
        }
        if(input.command && MIST_MEMBER_DIRECTORY_COMMANDS.includes(input.command.type)) context.members = await this.memberDirectory(db,row,actor);
        if(input.command?.type?.startsWith('teamScope.')) context.teams = await companyTeams(db,row.companyId);
        const plan = input.command ? this.contract.getRequiredBusinessNumberPlan?.(row.state, input.command) ?? [] : [];
        const numbers = await prepareMistBusinessNumbers(db, row.state, plan, context.now);
        context.consumeBusinessNumber = prefix => numbers.consume(prefix);
        if (upload) stored = { ...await this.files.write(workspaceId, upload, context.now), uploadedBy: actor.userId };
        if (input.command?.type === 'platform.credit.issue') {
          const payload = assertCreditIssuePayload(input.command.payload);
          const credit = row.state.platform.credits.find(note => note.id === payload.creditId);
          if (!payload.correctsPrintId && credit?.printVersions?.some(version => version.sourceVersionId === payload.versionId)) fail('CREDIT_ALREADY_ISSUED', '该来源版本已签发，请读取已归档的正式原件', 409);
          const printSnapshot = prepareCreditDocumentSnapshot(row.state, payload.creditId, payload.versionId, context,payload.correctsPrintId?{correctsPrintId:payload.correctsPrintId,reason:payload.reason!}:undefined);
          if(payload.correctsPrintId){const prior=credit!.printVersions!.find(version=>version.id===payload.correctsPrintId)!,originalFile=row.state.files.find(file=>file.id===prior.fileId);if(!originalFile||originalFile.name!==prior.fileName||originalFile.mimeType!=='application/pdf'||originalFile.size!==prior.bytes)fail('CREDIT_DOCUMENT_INVALID','缺少准确归档原件，不能更正',422);assertIssuedCreditArchive(prior,await this.files.read(workspaceId,originalFile));}
          const prepared = await this.creditArchiveBuilder(printSnapshot);
          stored = await this.files.write(workspaceId, prepared.file, context.now);
          context.creditDocumentIssue = bindIssueArchive(prepared, stored, { id: context.id, workspaceId, requestId: input.requestId });
        }
        if (input.command?.type === 'fulfillment.procurement.document') {
          const snapshot = preparePurchaseDocumentSnapshot(row.state, input.command.payload, context);
          const count = row.state.fulfillment.purchases.find(p => p.id === snapshot.purchaseId)?.documents?.length || 0;
          const prepared = await buildPurchaseDocument(snapshot, count + 1, this.quotationPdfRenderer);
          stored = await this.files.write(workspaceId, prepared.file, context.now);
          (context as typeof context & { purchaseDocument?: unknown }).purchaseDocument = bindPurchaseDocument(prepared, stored, { id: context.id, workspaceId });
        }
        if (input.command?.type === 'market.quotation.document') {
          const snapshot = prepareQuotationDocumentSnapshot(row.state, input.command.payload || {}, context);
          const prepared = await buildQuotationDocument(snapshot, nextQuotationDocumentSeq(row.state, snapshot.quotationId), { renderPdf: this.quotationPdfRenderer });
          stored = await this.files.write(workspaceId, prepared.file, context.now);
          (context as typeof context & { quotationDocument?: unknown }).quotationDocument = bindQuotationDocument(prepared, stored, { id: context.id, workspaceId, requestId: input.requestId });
        }
        if (input.command?.type === 'development.notice.generate') {
          const snapshot = prepareDevelopmentNoticeSnapshot(row.state, input.command.payload || {}, context);
          const prepared = await buildDevelopmentNotice(snapshot, { renderPdf: this.quotationPdfRenderer });
          stored = await this.files.write(workspaceId, prepared.file, context.now);
          (context as typeof context & { developmentNotice?: unknown }).developmentNotice = bindDevelopmentNotice(prepared, stored, { id: context.id, workspaceId, requestId: input.requestId });
        }
        if (input.command?.type === 'finance.statement.generate') {
          const statementScope = scopeOf(row), customerId = String(input.command.payload?.customerId ?? '');
          if (statementScope && !canGenerateScopedStatement(row.state, statementScope, customerId)) fail('FORBIDDEN', '对账单包含当前范围外的业务，请由财务生成', 403);
          const snapshot = prepareCustomerStatementSnapshot(row.state, input.command.payload || {}, context);
          const prepared = await buildCustomerStatement(snapshot, { renderPdf: this.quotationPdfRenderer });
          stored = await this.files.write(workspaceId, prepared.file, context.now);
          (context as typeof context & { customerStatement?: unknown }).customerStatement = bindCustomerStatement(prepared, stored, { id: context.id, workspaceId, requestId: input.requestId });
        }
        const command = upload ? { type: 'files.add', payload: { file: stored } } : input.command;
        if (command?.type === 'email.server.sync' || command?.type === 'email.server.state') Object.assign(context, {mailPendingFields:await pendingMailFields(db,workspaceId,command.type === 'email.server.state' ? command.payload.operationId : undefined)});
        const applied = this.contract.applyMistCommand(structuredClone(row.state), command, context);
        const remoteQueued = await enqueueMailState(db, row, applied.state, command, actor, prior, Date.now());
        if (remoteQueued) applied.result = {...applied.result, remoteQueued:true};
        if (command?.type === 'email.server.state') await completeMailState(db,workspaceId,command.payload.operationId,command.payload.attemptId,command.payload.observation,(prior as MailSyncActor).mailSyncLease!.id);
        numbers.assertConsumed();
        if (confirmProposalId) markAgentProposalConfirmed(applied.state, confirmProposalId, command, actor.userId, context.now);
        if(isAgentActor(prior)&&prior.agentTaskLease&&command.type==='agent.proposal.create')await waitTaskForProposal(db,actor,prior.agentTaskLease,String(applied.result.id),input.requestId,Date.now());
        const rejectedTaskProposal=command.type==='agent.proposal.reject'?row.state.agentProposals?.find(p=>p.id===command.payload.id):undefined;
        if(humanTaskProposal?.taskId)await settleTaskProposal(db,actor,workspaceId,humanTaskProposal.taskId,humanTaskProposal.id,input.requestId,'confirmed',Date.now());
        if(rejectedTaskProposal?.taskId)try{await settleTaskProposal(db,actor,workspaceId,rejectedTaskProposal.taskId,rejectedTaskProposal.id,input.requestId,'rejected',Date.now());}catch(e){if(!(e instanceof MistApiError)||e.code!=='NOT_FOUND')throw e;}
        const previousEvents=new Set((row.state.events??[]).map((event:{id:string})=>event.id));
        for(const event of applied.state.events??[])if(!previousEvents.has(event.id))event.at=context.auditNow ?? context.now;
        if(upload&&input.claimId!==undefined)applied.result={...applied.result,claimId:input.claimId};
        if(this.contract.getMistReviewTasks)(applied.state as any).reviewerIds=[...new Set(this.contract.getMistReviewTasks(applied.state).flatMap(t=>t.reviewerIds))];
        canonical(applied.state); canonical(applied.result);
        const changeKeys = mistChangeKeys(row.state, applied.state);
        if(humanTaskProposal?.sourceRevision!==undefined&&humanTaskProposal.sourceRevision<row.revision){const changed=await this.concurrentChanges(db,workspaceId,row.revision,humanTaskProposal.sourceRevision,undefined,true),system=new Set(['k:agentProposals','k:events','k:tasks','k:notifications','k:calendar','k:reviewerIds']);if(!changeKeys||changeKeys.filter(key=>!system.has(key[0])).some(key=>changed.some(other=>overlapping(key,other))))fail('REVISION_CONFLICT','提议来源已更新，请重新读取后再提出',409);}
        // 行级范围写侧：受限岗位不能改看不到的业务，也不能在看不到的业务下新建。
        const incomingSource=incoming&&row.state.fulfillment.purchases.find(p=>p.id===incoming.purchaseId);
        const internalIncoming=['order.internal.receive','order.internal.reverseCheck'].includes(input.command?.type)?row.state.internalDeliveries?.find(d=>d.id===input.command.payload.id&&d.receiverId===actor.userId):undefined;
        const scope = scopeOf(row), violation = scope ? scopedWriteViolation(row.state, applied.state, scope, incoming&&incomingSource?{issueId:incoming.id,sourceOrderId:incomingSource.orderId}:undefined,internalIncoming?{deliveryId:internalIncoming.id,sourceOrderId:internalIncoming.orderId}:undefined) : null;
        if (violation) fail('NOT_FOUND', '记录不存在或不在当前账号的业务范围内', 404);
        if (concurrent) {
          if (!changeKeys) fail('REVISION_CONFLICT', '公司已被他人更新，本次修改范围过大无法自动合并，请刷新后重试', 409);
          if (changeKeys!.some(key => concurrent.some(other => overlapping(key, other)))) fail('REVISION_CONFLICT', '其他人已修改同一记录，为避免覆盖对方的更新未自动合并，请刷新核对后重试', 409);
        }
        if (dryRun) throw new MistPreviewOutcome({ revision: row.revision, result: applied.result, events: (applied.state.events ?? []).filter((event: { id: string }) => !previousEvents.has(event.id)).map((event: { text: string }) => event.text), changes: changeKeys ?? null });
        const nextRevision = row.revision + 1;
        const sourceTask=isAgentActor(prior)?prior.agentTaskLease?.taskId:humanTaskProposal?.taskId;
        if(sourceTask&&!EMAIL_SERVER_COMMAND.test(command?.type??''))await advanceTaskSources(db,actor,workspaceId,sourceTask,changeKeys,nextRevision);
        const saved = await db.mistWorkspace.update({ where: { id: workspaceId }, data: { state: applied.state, name: identifier(applied.state.settings.workspaceName, '公司名称'), revision: nextRevision } });
        if (scope) ROW_SCOPE.set(saved, scope);
        OWN_TEAMS.set(saved, OWN_TEAMS.get(row) ?? []);
        const result = { revision: nextRevision, result: applied.result };
        const proposalId = confirmProposalId || (input.command?.type === 'agent.proposal.reject' ? input.command.payload.id : undefined);
        const proposal = proposalId ? row.state.agentProposals?.find(item => item.id === proposalId) : undefined;
        const agent = isAgentActor(prior);
        const audit = agent || proposal ? createAgentCommandAudit({
          workspaceId, requestId: input.requestId, at: context.auditNow ?? context.now,
          actor: { id: actor.userId, name: actor.displayName || actor.userId },
          source: agent ? 'agent' : confirmProposalId ? 'human_confirmation' : 'human_rejection',
          agentSessionId: agent ? prior.agentSessionId : proposal?.agentSessionId ?? null,
          ...((agent?prior.agentIdentity:proposal?.agentIdentity)?{agentIdentity:agent?prior.agentIdentity:proposal?.agentIdentity}:{}),
          ...(proposalId ? { proposalId } : input.command?.type === 'agent.proposal.create' ? { proposalId: String(applied.result.id) } : {}),
          phase: agent ? input.command?.type === 'agent.proposal.create' ? 'proposed' : 'executed' : confirmProposalId ? 'confirmed' : 'rejected',
          command, ...(confirmProposalId ? { trigger: input.command ? hashPayload.command : undefined } : {}),
          requestedRevision: input.expectedRevision, baseRevision: row.revision, committedRevision: nextRevision,
          before: ORIGINAL_WRITE_STATE.get(row) ?? row.state, after: applied.state,
        }) : undefined;
        await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: input.requestId, actorId: actor.userId, inputHash: hash, expectedRevision: input.expectedRevision, result } });
        // A separate internal receipt keeps ordinary receipts byte-compatible even on rollback:
        // previous releases also reject mist-revision:* before reading any stored receipt.
        if (audit) await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: agentAuditReceiptId(input.requestId), actorId: actor.userId, inputHash: AGENT_AUDIT_HASH, expectedRevision: input.expectedRevision, result: { revision: nextRevision, [AGENT_AUDIT_FIELD]: audit } } });
        // 同事务记下本版本写入的位置，供之后落后版本的保存判断能否安全合并；原请求回执保持原样。
        await this.markRevision(db, workspaceId, actor.userId, row.revision, nextRevision, changeKeys);
        await this.authorize(db, prior, permission);
        await this.authorizeCompoundCommand(db, prior, input.command);
        if(isAgentActor(prior)&&prior.agentTaskLease){
          if(command.type==='agent.proposal.create'){const c=(await taskRecord(db,workspaceId,prior.agentTaskLease.taskId)).value;await assertTaskAuthority(db,actor,c,Date.now());if(c.state!=='waiting_human'||!c.waitingProposalIds.includes(String(applied.result.id)))fail('AGENT_TASK_LEASE_INVALID','任务已停止',401);}
          else await assertTaskLease(db,await this.taskValidationActor(db,prior,actor),prior.agentTaskLease,Date.now());
        }
        await this.prepareTaskProposalAccess(db,saved,actor);
        return { workspace: this.view(saved, actor), receipt: { requestId: input.requestId, ...result, expectedRevision: input.expectedRevision }, replayed: false };
      });
        if (input.command?.type && ['email.flag','email.move','email.state.retry'].includes(input.command.type)) this.mailStateWake?.();
        return response;
      } catch (error: any) {
        let blobSettled = true;
        if (stored) {
          blobSettled = false;
          // A competing copy can own this request receipt while referencing a
          // different file. Check the durable workspace before retaining this
          // attempt's blob; never delete a committed attachment or guess after
          // an unavailable/unknown commit result.
          try {
            const receipt = await this.prisma.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: input.requestId } } });
            const durable = receipt && retryableTransaction(error)
              ? await this.transact(db => db.mistWorkspace.findFirst({ where: { id: workspaceId } })) as MistWorkspaceRow | null
              : null;
            if (!receipt || durable && Array.isArray(durable.state.files) && !durable.state.files.some(file => file.id === stored!.id)) {
              await this.files.remove(workspaceId, stored); blobSettled = true;
            }
          } catch { /* Do not delete a potentially committed attachment. */ }
        }
        if (!retryableTransaction(error)) throw error;
        // A competing copy of this same request may have committed while this
        // serializable transaction rolled back. Resolve its durable receipt.
        const replay = await this.transact(async db => {
          const { row, actor } = await this.own(db, prior, workspaceId, await permissionFor(db));
          await this.authorizeCompoundCommand(db, prior, input.command);
          const receipt = await db.mistCommandReceipt.findUnique({ where: { workspaceId_requestId: { workspaceId, requestId: input.requestId } } });
          if (!receipt) return undefined;
          if (receipt.actorId !== prior.userId || receipt.inputHash !== hash) fail('REQUEST_CONFLICT', '此请求编号已用于另一项操作', 409);
          return { workspace: this.view(row, actor), receipt: { requestId: receipt.requestId, ...publicCommandReceiptResult(receipt.result), expectedRevision: receipt.expectedRevision }, replayed: true };
        });
        if (replay) return replay;
        // 文件副作用无法确认已清理时不再重试，避免重复生成或残留。
        if (!blobSettled) fail('REVISION_CONFLICT', '公司并发更新，请核对原请求回执后重试', 409);
        if (attempt >= MIST_MAX_SAVE_ATTEMPTS) fail('REVISION_CONFLICT', `多人同时保存发生冲突，已自动重试${MIST_MAX_SAVE_ATTEMPTS}次仍未成功，请刷新后重试`, 409);
      }
    }
  }
  /** 同事务记下本版本写入的位置（写入范围过大时记为 null，之后跨越它的落后保存一律拒绝合并）。 */
  private async markRevision(db: any, workspaceId: string, actorId: string, previous: number, next: number, keys: string[][] | null) {
    await db.mistCommandReceipt.create({ data: { id: randomUUID(), workspaceId, requestId: revisionMarker(next), actorId, inputHash: REVISION_MARKER_HASH, expectedRevision: previous, result: { revision: next, keys } } });
  }
  /** 收集从客户端所见版本到最新版本之间每个版本的写入位置；任何一个版本无法证明时拒绝自动合并。 */
  private async concurrentChanges(db: any, workspaceId: string, current: number, expected: number, type: string | undefined, sourceOnly=false): Promise<string[][]> {
    const refuse = (message: string): never => fail('REVISION_CONFLICT', message, 409);
    if (expected > current) refuse('公司版本无效，请刷新后重试');
    if (!sourceOnly&&(!type || NON_REBASABLE_COMMAND.test(type) || type === 'development.notice.generate' || type === 'finance.statement.generate')) refuse('公司已被他人更新，此操作需基于最新内容重新确认，请刷新后重试');
    if (current - expected > MIST_MAX_REBASE_GAP) refuse('公司已有较多更新，无法自动合并，请刷新后重试');
    const keys: string[][] = [], wanted = Array.from({ length: current - expected }, (_, i) => revisionMarker(expected + 1 + i));
    const found = new Map<string, any>((await db.mistCommandReceipt.findMany({ where: { workspaceId, requestId: { in: wanted } } })).map((row: any) => [row.requestId, row]));
    for (let value = expected + 1; value <= current; value++) {
      const marker = found.get(revisionMarker(value));
      const recorded = marker?.inputHash === REVISION_MARKER_HASH && marker.result?.revision === value && Array.isArray(marker.result.keys) && marker.result.keys.every((key: unknown) => Array.isArray(key) && key.every(part => typeof part === 'string')) ? marker.result.keys as string[][] : null;
      if (!recorded) refuse('公司已被他人更新，无法确认本次修改可安全合并，请刷新后重试');
      keys.push(...recorded!);
    }
    return keys;
  }
  /** 演示种子里的附件只有占位记录；这里生成真实 PDF 并改写为公司私有存储路径。 */
  private async writeDemoFiles(workspaceId: string, state: MistState) {
    const render = this.contract.renderDemoFile;
    if (!render) return;
    for (const file of state.files) {
      if (!file.storageKey.startsWith('demo-seed/')) continue;
      const stored = await this.files.writeWithId(workspaceId, file.id, { bytes: Buffer.from(render(state, file)), name: file.name, mimeType: file.mimeType }, file.createdAt);
      file.size = stored.size; file.storageKey = stored.storageKey;
    }
  }
  private reviews(state:MistState):MistReviewTask[]{return this.contract.getMistReviewTasks?.(state)||[];}
  /** Both command and review entry points rebuild routing from the current requester, while the actor remains the decision maker. */
  private async reviewSubject(db:any,actor:TokenPayload,requesterId:string,label='申请账号'):Promise<TokenPayload>{
    if((actor as any).mistLocal===true && process.env.MIST_LOCAL_WORKSPACE==='1' && process.env.NODE_ENV!=='production'){
      if(!MIST_LOCAL_PROFILES.some(p=>p.id===requesterId))fail('REQUESTER_UNAVAILABLE',label==='申请账号'?'本地申请身份无效':`${label}无效`,409);
      const requester=mistLocalPublicUser(requesterId);return {...requester,userId:requester.id,mistLocal:true} as unknown as TokenPayload;
    }
    const requester=await loadUserWithRoles(db,requesterId);
    if(!requester||requester.status!=='active'||requester.deletedAt)fail('REQUESTER_UNAVAILABLE',`${label}当前不可核验，请联系管理员`,409);
    return buildLoadedAuthTokenPayload(db,requester,actor.companyId ?? null);
  }
  async listReviews(prior:TokenPayload){return this.transact(async db=>{
    const actor=await this.authorize(db,prior);
    const mine={state:{path:['reviewerIds'],array_contains:[actor.userId]}},rows=await db.mistWorkspace.findMany({where:companyLibrary(actor)?{companyId:actor.companyId,OR:[mine]}:{...(actor.companyId?{companyId:actor.companyId}:{}),OR:[{ownerId:actor.userId},mine]},orderBy:{updatedAt:'desc'},take:200});
    return rows.filter((row:MistWorkspaceRow)=>!archived(row)).flatMap((row:MistWorkspaceRow)=>this.reviews(row.state).filter(t=>!companyRow(row)&&row.ownerId===actor.userId||(t.reviewerIds.includes(actor.userId)&&hasScope(actor,t.requiredPermission as any))).map(t=>({workspaceId:row.id,workspaceName:row.name,revision:row.revision,canDecide:t.status==='pending'&&t.reviewerIds.includes(actor.userId)&&hasScope(actor,t.requiredPermission as any),files:(t.fileIds||[]).flatMap(id=>{const file=row.state.files.find(f=>f.id===id);return file?[{id:file.id,name:file.name,size:file.size}]:[];}),...t})));
  });}
  async reviewFile(prior:TokenPayload,workspaceId:string,reviewId:string,fileId:string){return this.transact(async db=>{
    const actor=await this.authorize(db,prior),row=await db.mistWorkspace.findFirst({where:{id:workspaceId}});
    if(row&&(row.companyId||actor.companyId)&&(row.companyId??null)!==(actor.companyId??null))fail('NOT_FOUND','审批不存在',404);
    if(!row||archived(row))fail('NOT_FOUND','审批不存在',404);
    const task=this.reviews(row.state).find(t=>t.id===reviewId);
    if(!task||((companyRow(row)||row.ownerId!==actor.userId)&&(!task.reviewerIds.includes(actor.userId)||!hasScope(actor,task.requiredPermission as any))))fail('NOT_FOUND','该审批不属于当前账号',404);
    if(!(task.fileIds||[]).includes(fileId))fail('FILE_NOT_FOUND','附件不在提交的审批快照中',404);
    const file=row.state.files.find((f:MistStoredFile)=>f.id===fileId);if(!file)fail('FILE_NOT_FOUND','附件不存在',404);
    const bytes=await this.files.read(workspaceId,file);await this.authorize(db,prior);return {file,bytes};
  });}
  async reviewReceipt(prior:TokenPayload,workspaceId:string,requestId:string){return this.transact(async db=>{
    const actor=await this.authorize(db,prior);requestIdentifier(requestId);
    const item=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId}}});
    if(!item||item.actorId!==actor.userId)fail('NOT_FOUND','原审批回执不存在',404);
    return {requestId:item.requestId,...publicCommandReceiptResult(item.result)};
  });}
  async decideReview(prior:TokenPayload,workspaceId:string,reviewId:string,input:{requestId:string;expectedRevision:number;decision:'approved'|'rejected';note:string}){
    if(!/^[0-9a-f-]{36}$/i.test(workspaceId))fail('INVALID_INPUT','公司编号无效',400);
    requestIdentifier(input.requestId);revision(input.expectedRevision);identifier(reviewId,'审批编号');
    if(!['approved','rejected'].includes(input.decision)||typeof input.note!=='string'||!input.note.trim()||input.note.length>4000)fail('INVALID_INPUT','请选择审批结论并填写意见',400);
    const hash=createHash('sha256').update(canonical({actorId:prior.userId,reviewId,...input})).digest('hex');
    return this.writeTransact(workspaceId,async db=>{
      const actor=await this.authorize(db,prior);
      await db.$queryRawUnsafe('SELECT "id" FROM "MistWorkspace" WHERE "id" = $1::uuid FOR UPDATE',workspaceId);
      const row=await db.mistWorkspace.findFirst({where:{id:workspaceId}});if(row&&(row.companyId||actor.companyId)&&(row.companyId??null)!==(actor.companyId??null))fail('NOT_FOUND','审批对象不存在',404);if(!row||archived(row))fail('NOT_FOUND','审批对象不存在',404);if(companyRow(row))applyRoster(row.state,await companyRoster(db,row.companyId));
      const previous=await db.mistCommandReceipt.findUnique({where:{workspaceId_requestId:{workspaceId,requestId:input.requestId}}});
      if(previous){if(previous.actorId!==actor.userId||previous.inputHash!==hash)fail('REQUEST_CONFLICT','原请求编号用于另一项决定',409);return {receipt:{requestId:previous.requestId,...publicCommandReceiptResult(previous.result)},replayed:true};}
      const task=this.reviews(row.state).find(t=>t.id===reviewId);
      if(!task||!task.reviewerIds.includes(actor.userId))fail('NOT_FOUND','该审批不属于当前账号',404);
      await this.authorize(db,prior,task.requiredPermission);
      if(task.status!=='pending')fail('REVIEW_RESOLVED','审批已处理，请刷新记录',409);
      const subject=await this.reviewSubject(db,actor,task.requesterId);
      const type=REVIEW_COMMAND_BY_KIND[task.kind];
      // 风险申请：审批结果回到原风险记录（target.id），并精确对应本次申请（entityId）。
      const command={type,payload:task.kind==='risk'?{id:task.target.id,escalationId:task.entityId,decision:input.decision,note:input.note}:{id:task.entityId,decision:input.decision,note:input.note}} as MistCommand;
      // 审批人所见版本落后时：只要期间没有人改过本次审批写入的同一记录，就在最新状态上重新执行审批门禁后落库；否则要求刷新核对。
      const concurrent=row.revision===input.expectedRevision?undefined:await this.concurrentChanges(db,workspaceId,row.revision,input.expectedRevision,type);
      const context=this.context(actor,row.state);context.authority=await mistApprovalAuthority(db,subject,type,candidateIds(row));
      if(MIST_MEMBER_DIRECTORY_COMMANDS.includes(type))context.members=await this.memberDirectory(db,row,actor);
      const applied=this.contract.applyMistCommand(structuredClone(row.state),command,context);
      const previousEvents=new Set((row.state.events??[]).map((event:{id:string})=>event.id));
      for(const event of applied.state.events??[])if(!previousEvents.has(event.id))event.at=context.auditNow ?? context.now;
      (applied.state as any).reviewerIds=[...new Set(this.reviews(applied.state).flatMap(t=>t.reviewerIds))];
      canonical(applied.state);canonical(applied.result);
      const changeKeys=mistChangeKeys(row.state,applied.state);
      if(concurrent&&(!changeKeys||changeKeys.some(key=>concurrent.some(other=>overlapping(key,other)))))fail('REVISION_CONFLICT','业务记录已有更新，请刷新审批并重新核对',409);
      const next=await db.mistWorkspace.update({where:{id:workspaceId},data:{state:applied.state,revision:row.revision+1}});
      const result={revision:next.revision,result:{...applied.result,reviewId}};
      await db.mistCommandReceipt.create({data:{id:randomUUID(),workspaceId,requestId:input.requestId,actorId:actor.userId,inputHash:hash,expectedRevision:input.expectedRevision,result}});
      await this.markRevision(db,workspaceId,actor.userId,row.revision,next.revision,changeKeys);
      await this.authorize(db,prior,task.requiredPermission);
      return {receipt:{requestId:input.requestId,...result},replayed:false};
    });
  }
  /** 小组协作范围：本公司在用的小组、各组已存范围与当前匹配数量。范围明细会涉及全公司业务，限人事小组管理权限。 */
  async teamScopes(prior: TokenPayload, workspaceId: string) {
    return this.transact(async db => {
      const { row } = await this.own(db, prior, workspaceId, 'hr:write'), teams = await companyTeams(db, row.companyId), stored = row.state.teamScopes ?? [];
      return { revision: row.revision, teams: teams.map(team => { const scope = stored.find(item => item.teamId === team.id); return { ...team, scope: scope ?? null, counts: scope ? previewTeamScope(row.state, scope).counts : null }; }) };
    });
  }
  /** 设置范围时的即时预览：用与保存相同的校验，在最新完整数据上匹配，不写库。 */
  async previewTeamScope(prior: TokenPayload, workspaceId: string, input: unknown) {
    return this.transact(async db => {
      const { row } = await this.own(db, prior, workspaceId, 'hr:write');
      const { team, scope } = normalizeTeamScopeInput(row.state, input, await companyTeams(db, row.companyId));
      return { teamId: team.id, revision: row.revision, preview: previewTeamScope(row.state, scope) };
    });
  }
  /** 邮件服务读取：按当前账号的读投影返回（只含本人/授权成员可见的邮箱、邮件与附件），并要求邮件编辑权限。 */
  async mailSnapshot(prior: TokenPayload, workspaceId: string) {
    return this.transact(async db => {
      const { actor, row } = await this.own(db, prior, workspaceId, 'emails:write');
      return { actor, revision: row.revision as number, state: projectState(row.state, actor, this.emptyState(actor), fileOwner(row), scopeOf(row)).state };
    });
  }
  async mailStateViews(prior:TokenPayload,workspaceId:string) { return this.transact(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'emails:read');const state=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;const items=await mailStateViews(db,workspaceId,state,actor);return isAgentActor(prior)?items.map(item=>({...item,canRetry:false})):items;}); }
  async dueMailState(now=Date.now(),take=2) {return this.transact(db=>dueMailState(db,now,take));}
  async claimMailState(prior:TokenPayload,job:MailStateRecord,now=Date.now()) {
    return this.connectionTransaction(async db=>{
      const{actor,row}=await this.own(db,prior,job.workspaceId,'emails:write');
      const state=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;
      const m=state.email.messages.find(m=>m.id===job.messageId),a=state.email.accounts.find(a=>a.id===job.accountId);
      if(!m||!a||!m.remote)fail('NOT_FOUND','邮件不存在或无权使用',404);
      if((a!.sourceGeneration||1)!==job.source||receiveSource(a!)!==job.sourceHash||(m!.source||1)!==job.source)fail('MAIL_SOURCE_CHANGED','邮箱来源已变化，请在原邮箱核对',409);
      if(now-job.authorizedAt>24*60*60_000)fail('MAIL_STATE_EXPIRED','同步操作已过期，请重试',409);
      const lease=await claimReceiving(db,actor,job.workspaceId,a!,now,false,RECEIVE_LEASE_MS,undefined,'state');
      lease.stateOperationId=job.id;
      const next=await claimMailState(db,job,lease.id,lease.expiresAt,now);
      return{job:next,actor:{...prior,mailSyncLease:lease} as MailSyncActor};
    });
  }
  async planMailState(job:MailStateRecord,attempt:MailStateAttempt){return this.connectionTransaction(db=>planMailState(db,job,attempt));}
  async rememberMailState(job:MailStateRecord,o:MailStateObservation){return this.connectionTransaction(db=>rememberMailState(db,job,o));}
  async failMailState(job:MailStateRecord,phase:'pending'|'failed'|'unknown'|'blocked',error:string,now=Date.now(),confirmedNotApplied=false){return this.connectionTransaction(db=>failMailState(db,job,phase,error,now,confirmedNotApplied));}
  async blockUnclaimedMailState(job:MailStateRecord,error:string){return this.connectionTransaction(async db=>{const current=await readMailState(db,job.workspaceId,job.id);if(current.record.version!==job.version)return;return failMailState(db,current.record,'blocked',error,Date.now());});}
  async mailReceivingViews(prior:TokenPayload,workspaceId:string,now=Date.now()) {
    return this.transact(async db=>{
      const {actor,row}=await this.own(db,prior,workspaceId,'emails:read');
      const state=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;
      return Promise.all((state.email?.accounts??[]).filter(a=>!a.example).map(async account=>{const view=receivingView((await receivingRecord(db,workspaceId,account.id)).value,account,actor,now);return isAgentActor(prior)?{...view,canEnable:false,canDisable:false}:view;}));
    });
  }
  async setMailReceiving(prior:TokenPayload,workspaceId:string,accountId:string,input:Record<string,unknown>,now=Date.now()) {
    if(isAgentActor(prior)||(prior as MailSyncActor).mailSyncLease||(prior as any).mailReceivingWorker)fail('FORBIDDEN','自动收件须由邮箱接入人本人设置',403);
    return this.connectionTransaction(async db=>{
      const {actor,row}=await this.own(db,prior,workspaceId,'emails:write');
      const state=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;
      const account=state.email?.accounts.find(a=>a.id===accountId);if(!account)fail('NOT_FOUND','邮箱不存在或无权查看',404);
      return setReceiving(db,actor,workspaceId,account!,input,now,row.companyId??undefined);
    });
  }
  async claimMailSync(prior:TokenPayload,workspaceId:string,accountId:string,background=false,job?:ReceivingJob,leaseMs=RECEIVE_LEASE_MS,now=Date.now()):Promise<MailSyncActor> {
    return this.connectionTransaction(async db=>{
      const {actor,row}=await this.own(db,prior,workspaceId,'emails:write');
      const state=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;
      const account=state.email?.accounts.find(a=>a.id===accountId);if(!account)fail('NOT_FOUND','邮箱不存在或无权查看',404);
      const lease=await claimReceiving(db,actor,workspaceId,account!,now,background,leaseMs,job);
      return {...prior,mailSyncLease:lease};
    });
  }
  async assertMailSync(prior:MailSyncActor,workspaceId:string){await this.transact(db=>this.own(db,prior,workspaceId,'emails:write'));}
  async finishMailSync(lease:MailSyncLease,outcome:Parameters<typeof finishReceiving>[2],intervalMs=RECEIVE_INTERVAL_MS,now=Date.now()) {return this.connectionTransaction(db=>finishReceiving(db,lease,outcome,now,intervalMs));}
  async dueMailReceiving(now=Date.now(),take=2){return this.transact(db=>dueReceiving(db,now,take));}
  async blockMailReceiving(job:ReceivingJob,problem:{code:string;message:string},now=Date.now()){return this.connectionTransaction(db=>blockReceiving(db,job,problem,now));}
  async invalidateMailReceiving(prior:TokenPayload,workspaceId:string,accountId:string,now=Date.now()) {
    return this.connectionTransaction(async db=>{const{actor,row}=await this.own(db,prior,workspaceId,'emails:write');const state=projectState(row.state,actor,this.emptyState(actor),fileOwner(row),scopeOf(row)).state;const a=state.email?.accounts.find(a=>a.id===accountId);if(!a||a.ownerId!==actor.userId)fail('FORBIDDEN','只有邮箱接入人可以断开',403);await invalidateReceiving(db,workspaceId,accountId,now);});
  }
  /** 邮件服务写回真实收发结果：每次读取最新版本作为基线，经同一命令事务（权限、成员、邮箱归属复核）落库。 */
  async executeMail(prior: TokenPayload, workspaceId: string, command: { type: string; payload: Record<string, unknown> }) {
    if (!EMAIL_SERVER_COMMAND.test(command.type) && command.type !== 'email.draft.save') fail('INVALID_COMMAND', '邮件服务命令无效', 400);
    const lease=(prior as MailSyncActor).mailSyncLease;
    if(command.type==='email.server.sync'&&(!lease||lease.kind==='state'||command.payload.accountId!==lease.accountId)||command.type==='email.server.state'&&(!lease||lease.kind!=='state'||command.payload.operationId!==lease.stateOperationId)||lease&&command.type!==(lease.kind==='state'?'email.server.state':'email.server.sync'))fail('INVALID_COMMAND','收件结果须使用当前同步授权',400);
    for (let attempt = 1; ; attempt++) {
      const { revision: current } = await this.mailSnapshot(prior, workspaceId);
      try { return await this.executeInternal(prior, workspaceId, { requestId: `mail-${randomUUID()}`, expectedRevision: current, command }, { command }); }
      catch (error: any) { if (error?.code !== 'REVISION_CONFLICT' || attempt >= MIST_MAX_SAVE_ATTEMPTS) throw error; }
    }
  }
  /** 仅供邮件服务在授权读取后使用：私有附件写入、读取与未落库清理。 */
  mailFiles() { return { write: (workspaceId: string, input: MistFileInput, now: string) => this.files.write(workspaceId, input, now), read: (workspaceId: string, file: MistStoredFile) => this.files.read(workspaceId, file), remove: (workspaceId: string, file: MistStoredFile) => this.files.remove(workspaceId, file) }; }
  async upload(prior: TokenPayload, workspaceId: string, input: MistUploadRequest, file: MistFileInput) {
    const claimId=input.claimId===undefined?undefined:claimIdentifier(input.claimId);
    const meta = validateFileInput(file);
    return this.executeInternal(prior, workspaceId, {...input,claimId}, { upload: meta,...(claimId===undefined?{}:{claimId}) }, file);
  }
  async download(prior: TokenPayload, workspaceId: string, fileId: string, preview?: ImagePreviewMode) {
    const result = await this.transact(async db => {
      const { row, actor } = await this.own(db, prior, workspaceId);
      const file = Array.isArray(row.state.files) ? row.state.files.find((item: MistStoredFile) => item.id === fileId) : null;
      if (!file || !canReadFile(row.state, actor, fileId, this.emptyState(actor), fileOwner(row), scopeOf(row))) fail('FILE_NOT_FOUND', '附件不存在或不属于此公司', 404);
      // 只有主图提供抠图；补充图请求抠图尺寸时退回同尺寸普通预览，且不进入抠图队列。
      const cutoutRequested=!!preview?.startsWith('cutout-'),cutoutAllowed=cutoutRequested&&primaryImageIds(row.state).has(file.id),mode:ImagePreviewMode|undefined=cutoutRequested&&!cutoutAllowed?(preview==='cutout-thumb'?'thumb':'display'):preview;
      const previewReady=mode?await this.files.previewReady(workspaceId,file,mode):undefined,bytes = mode ? await this.files.readPreview(workspaceId, file, mode) : await this.files.read(workspaceId, file);
      const cutout:'ready'|'pending'|'none'|undefined=cutoutRequested?(cutoutAllowed?(previewReady?'ready':'pending'):'none'):undefined;
      await this.authorize(db, prior);
      return { file, bytes,previewReady,cutout };
    });
    return result;
  }
  async previewCreditDocument(prior: TokenPayload, workspaceId: string, creditId: string, versionId: string) {
    identifier(creditId, '贷项编号'); identifier(versionId, '来源版本编号');
    return this.transact(async db => {
      const { actor, row } = await this.own(db, prior, workspaceId, 'aftersales:read');
      const scope = scopeOf(row);
      if (scope && !scopedVisibility(row.state, scope).get('platform.credits')?.has(creditId)) fail('CREDIT_DOCUMENT_NOT_FOUND', '该贷项没有所选版本', 404);
      const snapshot = prepareCreditDocumentSnapshot(row.state, creditId, versionId, this.context(actor, row.state));
      const prepared = await this.creditArchiveBuilder(snapshot, { draft: true });
      await this.authorize(db, prior, 'aftersales:read');
      return { name: prepared.file.name, bytes: Buffer.from(prepared.file.bytes), sha256: prepared.sha256 };
    });
  }
  async downloadCreditDocument(prior: TokenPayload, workspaceId: string, creditId: string, versionId: string) {
    identifier(creditId, '贷项编号'); identifier(versionId, '已签版本编号');
    return this.transact(async db => {
      const { row } = await this.own(db, prior, workspaceId, 'aftersales:read');
      const scope = scopeOf(row);
      if (scope && !scopedVisibility(row.state, scope).get('platform.credits')?.has(creditId)) fail('CREDIT_DOCUMENT_NOT_FOUND', '该贷项没有所选版本', 404);
      const credit = row.state.platform.credits.find(note => note.id === creditId);
      const version = credit?.printVersions?.find(item => item.id === versionId);
      const source = version && credit?.sourceVersions?.find(item => item.id === version.sourceVersionId);
      if (!credit || !version || !source) fail('CREDIT_DOCUMENT_NOT_FOUND', '该贷项没有所选已签发版本', 404);
      if (version!.snapshot.creditId !== credit!.id || version!.snapshot.sourceVersionId !== source!.id || version!.sourceFingerprint !== creditSourceFingerprint(source!) || version!.snapshotFingerprint !== creditDocumentFingerprint(version!.snapshot) || canonicalCreditDocument(version!.snapshot.sourceLines) !== canonicalCreditDocument(source!.lines)) fail('CREDIT_DOCUMENT_INVALID', '正式CN版本及冻结来源不一致', 422);
      const file = row.state.files.find(item => item.id === version!.fileId);
      if (!file || file.name !== version!.fileName || file.mimeType !== 'application/pdf' || file.size !== version!.bytes) fail('CREDIT_DOCUMENT_INVALID', '正式CN缺少匹配原件', 422);
      const bytes = assertIssuedCreditArchive(version!, await this.files.read(workspaceId, file));
      await this.authorize(db, prior, 'aftersales:read');
      return { name: version!.fileName, bytes, sha256: version!.sha256 };
    });
  }
}
