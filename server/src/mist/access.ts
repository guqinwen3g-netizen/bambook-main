import {financialMaterialCostBasis,type InternalFabricCostBasis} from '../shared/mistInternalFabric';
import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { PermissionScope } from '../_shared/rolePermissionMatrix';
import { emailVisibleScope } from '../shared/mistEmail';
import { applyDataScope, scopedHiddenFiles, type MistDataScope } from '../shared/mistDataScope';
import type { MistState, MistWorkspaceMember, MistWorkspaceMemberLog, MistWorkspaceAccess as SharedAccess } from '../shared/mistWorkspace';
/**
 * 公司访问与读投影。
 * - 成员资格只决定"能不能进这家公司"，看到哪些业务数据仍由账号自身现有岗位的读权限决定；
 * - 所有者同样按自身读权限投影（全权限账号看到完整数据）。
 * 不新增任何权限点，只引用岗位矩阵里已有的读权限。
 */
export type MistMemberRecord = MistWorkspaceMember;
export type MistMemberLog = MistWorkspaceMemberLog;
export type MistWorkspaceAccess = SharedAccess;
type Section = { key: string; label: string; permissions: PermissionScope[]; paths: string[][]; entityTypes: string[]; views: string[] };
export const MIST_READ_SECTIONS: Section[] = [
  { key: 'receivables', label: '应收票据', permissions: ['invoices:read'], paths: [['invoices'], ['platform', 'invoiceDrafts'], ['customerStatements'], ['partialStatements']], entityTypes: ['invoice'], views: ['invoices'] },
  { key: 'receipts', label: '收款与核销', permissions: ['invoices:read', 'vouchers:read'], paths: [['receipts'], ['partialReceipts'], ['allocations'], ['financeReversals']], entityTypes: ['finance', 'receipt'], views: ['receipts', 'payment-vouchers'] },
  { key: 'payments', label: '付款记录', permissions: ['vouchers:read'], paths: [['payments']], entityTypes: ['payment'], views: [] },
  { key: 'payables', label: '供应商票据与应付', permissions: ['invoices:read', 'vouchers:read'], paths: [['payables'], ['partialPayableBills']], entityTypes: ['payable'], views: ['payables'] },
  { key: 'orderCosts', label: '订单费用与分摊', permissions: ['invoices:read', 'vouchers:read'], paths: [['orderCosts'], ['partialExpenses']], entityTypes: [], views: [] },
  // 公司银行账户与余额只给登记收付款的财务；业务员的财务只读只到本人应收/应付。
  { key: 'bankAccounts', label: '公司银行账户', permissions: ['vouchers:write'], paths: [['bankAccounts']], entityTypes: [], views: [] },
  { key: 'treasury', label: '锁汇结汇', permissions: ['vouchers:read'], paths: [['fxRecords'], ['fxRevaluations']], entityTypes: [], views: [] },
  // 月末汇率是公开牌价（人民银行中间价等），报表折算用，不按财务权限隐藏。
  { key: 'fxPeriodRates', label: '月末汇率', permissions: [], paths: [['fxPeriodRates']], entityTypes: [], views: [] },
  { key: 'exportRebate', label: '出口退税', permissions: ['tax:read'], paths: [['exportRebate']], entityTypes: ['rebate'], views: [] },
  { key: 'funding', label: '订单资金归属', permissions: ['finance:read', 'invoices:read', 'vouchers:read'], paths: [['orderFunding']], entityTypes: ['orderFunding'], views: ['funding'] },
  { key: 'relations', label: '客户与联系人', permissions: ['relations:read'], paths: [['customers'], ['contacts'], ['market', 'relations']], entityTypes: ['customer', 'relation'], views: ['customers', 'relations'] },
  { key: 'teamReports', label: '团队周报存档', permissions: ['relations:admin'], paths: [['teamReports']], entityTypes: [], views: [] },
  { key: 'reportSchedules', label: '报表订阅', permissions: ['reports:read'], paths: [['reportSchedules']], entityTypes: ['reportSchedule'], views: [] },
  { key: 'memberHandovers', label: '成员交接记录', permissions: ['relations:read'], paths: [['memberHandovers']], entityTypes: [], views: [] },
  { key: 'crm', label: '客户跟进', permissions: ['crm:read'], paths: [['crm']], entityTypes: ['crm'], views: ['crm'] },
  { key: 'email', label: '邮件', permissions: ['emails:read'], paths: [['email']], entityTypes: ['email'], views: ['emails'] },
  { key: 'quotations', label: '报价', permissions: ['quotations:read'], paths: [['market', 'quotations']], entityTypes: ['quotation'], views: ['quotations'] },
  { key: 'products', label: '开发与产品', permissions: ['products:read'], paths: [['devs'], ['versions'], ['rounds'], ['drafts'], ['fabrics'], ['market', 'products'], ['fulfillment', 'samples'], ['fulfillment', 'sampleMovements'], ['sampleRequests']], entityTypes: ['development', 'fabric', 'product', 'sample', 'sampleRequest'], views: ['development/detail', 'development/list', 'development/new', 'fabric-sourcing', 'products', 'samples'] },
  { key: 'suppliers', label: '供应商档案', permissions: ['suppliers:read'], paths: [['market', 'suppliers']], entityTypes: ['supplier'], views: ['suppliers'] },
  { key: 'seasons', label: '季节与市场参考', permissions: ['seasons:read'], paths: [['market', 'seasons'], ['market', 'trends'], ['market', 'shows']], entityTypes: ['season', 'trend', 'show'], views: ['seasons', 'trends', 'shows'] },
  { key: 'marketing', label: '营销', permissions: ['marketing:read'], paths: [['market', 'campaigns'], ['market', 'leads'], ['market', 'lookbooks']], entityTypes: ['campaign', 'lead', 'lookbook'], views: ['marketing'] },
  { key: 'claims', label: '售后案件与贷项', permissions: ['aftersales:read'], paths: [['platform', 'claims'], ['platform', 'credits'], ['platform', 'creditApplications'], ['platform', 'claimGoods']], entityTypes: ['claim', 'credit'], views: ['claims'] },
  { key: 'bom', label: '成本核算', permissions: ['bom:read'], paths: [['platform', 'boms']], entityTypes: ['bom'], views: ['bom'] },
  { key: 'pricing', label: '定价记录', permissions: ['pricing:read'], paths: [['platform', 'pricing'], ['platform', 'pricingParams']], entityTypes: ['pricing'], views: ['pricing'] },
  { key: 'risks', label: '风险台账', permissions: ['risk:read'], paths: [['platform', 'risks']], entityTypes: ['risk'], views: ['risks'] },
  { key: 'employees', label: '员工档案', permissions: ['hr:read'], paths: [['platform', 'employees']], entityTypes: ['employee'], views: ['hr'] },
  { key: 'assistant', label: '助手草稿', permissions: ['ai:chat'], paths: [['platform', 'assistantDrafts']], entityTypes: ['assistant'], views: ['ai-assistant'] },
  { key: 'procurement', label: '采购合同与收货', permissions: ['procurement:read'], paths: [['fulfillment', 'purchases'], ['fulfillment', 'receipts'], ['rfqs']], entityTypes: ['procurement'], views: ['procurement'] },
  { key: 'qc', label: '质检工作台', permissions: ['qc:read'], paths: [['fulfillment', 'qcTasks'], ['fulfillment', 'qcReports']], entityTypes: ['qc'], views: ['qc-workbench'] },
  { key: 'inventory', label: '库存', permissions: ['inventory:read'], paths: [['fulfillment', 'warehouses'], ['fulfillment', 'returnReceipts'], ['fulfillment', 'receivedRecords'], ['fulfillment', 'stock'], ['fulfillment', 'stockMovements'], ['fulfillment', 'stockCounts'], ['fulfillment', 'stockTransfers']], entityTypes: ['inventory', 'stock'], views: ['inventory'] },
  { key: 'shipments', label: '出运与装箱', permissions: ['shipments:read'], paths: [['fulfillment', 'shipments'], ['fulfillment', 'packing'], ['fulfillment', 'shippingTerms']], entityTypes: ['shipment', 'packing'], views: ['shipments', 'shipping', 'packing'] },
  { key: 'customs', label: '报关与单证', permissions: ['customs:read'], paths: [['fulfillment', 'customs'], ['fulfillment', 'customsClassifications'], ['fulfillment', 'documents'], ['letterOfCredits'], ['partialLettersOfCredit']], entityTypes: ['customs', 'document'], views: ['customs', 'documents'] },
  { key: 'orders', label: '订单', permissions: ['orders:read'], paths: [['orders'], ['orderLines'], ['internalFabricAllocations'], ['internalDeliveries']], entityTypes: ['order'], views: ['orders', 'orders/detail', 'orders/list', 'orders/new'] },
  { key: 'production', label: '生产', permissions: ['production:read'], paths: [['productions'], ['fulfillment', 'productionFacts']], entityTypes: ['production'], views: ['production-board'] },
];
/** 退税文字里的金额（应退 / 核准 / 到账 X CNY）；历史事件已入库，只能在读投影时脱敏。 */
const REBATE_EVENT_AMOUNT = /-?\d[\d,]*(?:\.\d+)?\s*CNY/g;
export const TAX_BASE_MASKED_TEXT = '已隐藏';
/**
 * 不持有 sensitive:tax_base 时统一的文字脱敏规则：退税事件、预演事件、提议说明、错误提示里的人民币金额替换为“已隐藏”。
 * 只对退税命令（rebate.*）及其事件使用；payable.* 事件不含税额（已核对 mistPayables / mistOrderCost / mistOpeningBalance），不纳入。
 */
export const maskTaxBaseText = (text: string) => text.replace(REBATE_EVENT_AMOUNT, TAX_BASE_MASKED_TEXT);
export const isTaxBaseCommand = (type?: string) => typeof type === 'string' && type.startsWith('rebate.');
/** 命令输入里属于计税依据的字段：专票税额、税率；退税核准额与到账勾稽额。 */
const TAX_INPUT_KEYS = new Set(['taxAmount', 'taxRate']);
export function maskTaxBaseInput(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const rebateAmounts = type.startsWith('rebate.claim.');
  const strip = (value: unknown): unknown => typeof value === 'string' ? (isTaxBaseCommand(type) ? maskTaxBaseText(value) : value) : Array.isArray(value) ? value.map(strip)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !TAX_INPUT_KEYS.has(key) && !(rebateAmounts && (key === 'amount' || key === 'receiptId'))).map(([key, item]) => [key, strip(item)])) : value;
  return strip(payload) as Record<string, unknown>;
}
/** 被退税到账勾稽占用的到账流水：金额即国库退税到账额。 */
export function rebateReceiptIds(state: MistState): Set<string> {
  return new Set((state.exportRebate?.claims || []).flatMap(claim => (claim.receipts || []).filter(r => !r.reversed).map(r => r.receiptId)));
}
/**
 * 掩码退税计税依据（sensitive:tax_base）。只改投影副本，不动原状态。
 * - 供应商票据：保留价税合计（付款需要），税额置 0、税率清空，避免用价税合计 × 税率还原税额；
 * - 退税申报：计税金额、应退、核准、到账勾稽金额与明细置 0；
 * - 退税事件文字中的金额替换为“已隐藏”（覆盖已入库的历史事件）；
 * - 被退税勾稽占用的银行到账流水整笔不下发（其金额就是退税到账额）。
 */
export function maskTaxBase(next: MistState) {
  if (next.payables?.bills?.length) next.payables = { ...next.payables, bills: next.payables.bills.map(b => ({ ...b, taxAmount: 0, taxRate: '', taxMasked: true })) };
  const rebate = next.exportRebate;
  const refundReceipts = rebateReceiptIds(next);
  if (rebate?.claims?.length) next.exportRebate = { ...rebate, claims: rebate.claims.map(c => ({ ...c, taxable: 0, expected: 0, taxMasked: true,
    ...(c.approved ? { approved: { ...c.approved, amount: 0 } } : {}),
    // 去掉到账流水 id：否则可凭 id 经资金归属等命令的提示拿到到账金额；勾稽编号与日期保留。
    receipts: (c.receipts || []).map(({ receiptId: _receipt, ...r }) => ({ ...r, receiptId: '', amount: 0 })),
    lines: (c.lines || []).map(({ parts: _parts, inputTaxCap: _cap, excluded: _excluded, taxLimited: _limited, ...l }) => ({ ...l, taxable: 0, rebate: 0 })) })) };
  if (next.events?.some(e => e.entityType === 'rebate')) next.events = next.events.map(e => e.entityType === 'rebate' ? { ...e, text: maskTaxBaseText(e.text) } : e);
  // Agent 提议说明来自预演事件或调用方填写，历史提议已入库：退税命令的说明按同一规则脱敏。
  if (next.agentProposals?.some(p => isTaxBaseCommand(p.command?.type))) next.agentProposals = next.agentProposals.map(p => isTaxBaseCommand(p.command?.type) ? { ...p, summary: p.summary.map(maskTaxBaseText) } : p);
  if (refundReceipts.size) {
    if (next.receipts?.some(r => refundReceipts.has(r.id))) next.receipts = next.receipts.filter(r => !refundReceipts.has(r.id));
    if (next.partialReceipts?.some(r => refundReceipts.has(r.id))) next.partialReceipts = next.partialReceipts.filter(r => !refundReceipts.has(r.id));
  }
}
export const memberIds = (state: MistState): string[] => Array.isArray(state.memberIds) ? state.memberIds.filter((id: unknown) => typeof id === 'string') : [];
export const members = (state: MistState): MistMemberRecord[] => Array.isArray(state.members) ? state.members : [];
export const isOwner = (row: { ownerId: string }, actor: TokenPayload) => row.ownerId === actor.userId;
export const isMember = (row: { state: MistState }, actor: TokenPayload) => memberIds(row.state).includes(actor.userId);
export function hiddenSections(actor: TokenPayload) { return MIST_READ_SECTIONS.filter(section => section.permissions.some(scope => !hasScope(actor, scope))); }
/** 无权限点命令仅限个人提醒及本人授权清理；命令仍校验归属，不能修改公司设置。 */
export const MEMBER_PERSONAL_COMMANDS = ['notification.read', 'notification.readAll', 'task.complete', 'calendar.save', 'calendar.delete', 'task.save', 'agent.proposal.reject', 'agent.task.cancel'];
/** 读取与提醒动作使用同一来源边界；未知路由不能绕过受限账号的读投影。 */
function targetVisibility(hidden: Section[]) {
  if (!hidden.length) return (_target?: { view?: string }) => true;
  const deniedViews = new Set(hidden.flatMap(section => section.views)), knownViews = new Set(MIST_READ_SECTIONS.flatMap(section => section.views));
  if (hidden.some(section => ['receivables', 'receipts', 'payments', 'payables', 'funding'].includes(section.key))) deniedViews.add('finance');
  knownViews.add('finance');
  return (target?: { view?: string }) => !target?.view || knownViews.has(target.view) && !deniedViews.has(target.view);
}
export function canReadTarget(actor: TokenPayload, target?: { view?: string }) {
  return targetVisibility(hiddenSections(actor))(target);
}
/** 按账号自身读权限裁剪状态；被隐藏的数据结构用空公司的同名结构替换，保证页面结构完整。 */
export function projectState(state: MistState, actor: TokenPayload, empty: () => MistState, ownerId?: string, scope?: MistDataScope): { state: MistState; hidden: Section[];costMaterialBasis?:InternalFabricCostBasis[] | null } {
  const hidden = hiddenSections(actor), next: MistState = scope ? applyDataScope(state, scope, actor.userId) : { ...state };
  // Legacy company activity had no recipients. Keep it in events, never broadcast it to accounts.
  next.notifications = (next.notifications || []).filter(item => item.recipientIds?.includes(actor.userId)).map(item => {
    const {readBy, ...notification} = item;
    return {...notification, recipientIds: [actor.userId], readAt: readBy?.[actor.userId] ?? null};
  });
  // Account balances require the complete company ledger; a row-scoped projection cannot compute them safely.
  if (scope && !hidden.some(section => section.key === 'bankAccounts')) hidden.push(MIST_READ_SECTIONS.find(section => section.key === 'bankAccounts')!);
  // 无 sensitive:tax_base 时退税到账流水不下发；账户余额须完整流水，同时隐藏公司银行账户。
  const taxBaseHidden = !hasScope(actor, 'sensitive:tax_base' as PermissionScope);
  if (taxBaseHidden && !hidden.some(section => section.key === 'bankAccounts') && (state.receipts || []).some(r => rebateReceiptIds(state).has(r.id))) hidden.push(MIST_READ_SECTIONS.find(section => section.key === 'bankAccounts')!);
  // Financial read metadata belongs to the response envelope, never to restorable business state.
  delete (next as MistState&{costMaterialBasis?:unknown}).costMaterialBasis;
  // Group scope conditions and notes may reference company-wide business; match the management API's permission boundary.
  // Agent 提议含待执行命令，只给提议所属账号本人。
  if (next.agentProposals) next.agentProposals = next.agentProposals.filter(proposal => proposal.ownerId === actor.userId);
  // fin63：报表订阅只给订阅人本人（收件人与发送节奏属个人安排）。
  if (next.reportSchedules) next.reportSchedules = next.reportSchedules.filter(row => row.ownerId === actor.userId);
  if (!hasScope(actor, 'hr:write')) {
    delete next.teamScopes;
    next.events = (next.events || []).filter(event => event.entityType !== 'teamScope');
  }
  if (hidden.length) {
    const blank = empty();
    for (const section of hidden) for (const path of section.paths) {
      const [root, child] = path;
      if (child) (next as any)[root] = { ...(next as any)[root], [child]: structuredClone((blank as any)[root]?.[child] ?? []) };
      else (next as any)[root] = structuredClone((blank as any)[root] ?? []);
    }
    const deniedTypes = new Set(hidden.flatMap(s => s.entityTypes)), allowedTypes = new Set(MIST_READ_SECTIONS.flatMap(s => s.entityTypes));
    const visibleTarget = targetVisibility(hidden);
    next.events = (next.events || []).filter(event => event.entityType === 'workspace' || allowedTypes.has(event.entityType) && !deniedTypes.has(event.entityType));
    next.tasks = (next.tasks || []).filter(task => visibleTarget(task.target));
    next.notifications = (next.notifications || []).filter(item => visibleTarget(item.target));
    next.calendar = (next.calendar || []).filter(item => visibleTarget(item.target));
  }
  // Warehouse-only readers still need the outcome required to dispose their own visible lot.
  // Expose only an action, not the hidden QC task, report, opinion or attachments.
  if (!hidden.some(section => section.key === 'inventory')) {
    next.fulfillment = {...next.fulfillment, stockMovements:(next.fulfillment.stockMovements || []).map(row => {
      const {quarantineAction:_stale, ...safe} = row;
      if (!row.quarantinedQuantity || row.quarantineDisposition || !hasScope(actor,'inventory:write')) return safe;
      const task = state.fulfillment.qcTasks.find(task => task.id === row.quarantineTaskId && task.kind === 'quarantine' && task.quarantine?.returnId === row.id);
      const report = task && state.fulfillment.qcReports.find(report => report.id === task.reportIds.at(-1) && report.taskId === task.id);
      const action = task?.state === 'blocked' && report?.result === 'reject' ? 'dispose' : task?.state === 'reported' && report?.result === 'pass' ? 'release' : undefined;
      return action ? {...safe,quarantineAction:action} : safe;
    })};
  }
  // 敏感字段 sensitive:tax_base：退税计税金额与供应商专票税额只给持码人；其余人按 0 返回并标 taxMasked，界面显示“已隐藏”。
  if (!hasScope(actor, 'sensitive:tax_base' as PermissionScope)) maskTaxBase(next);
  // Warehouse readers without payable access must not receive financial review evidence.
  if(hidden.some(section=>section.key==='payables') && next.fulfillment?.stockMovements){
    next.fulfillment={...next.fulfillment,stockMovements:next.fulfillment.stockMovements.map(row=>{
      if(!row.quarantineDisposition?.financeReviews)return row;
      const {financeReviews:_private,...disposition}=row.quarantineDisposition;
      return {...row,quarantineDisposition:disposition};
    })};
  }
  // 邮箱按用户 ID 隔离：个人邮箱只给本人，共享邮箱给本人与授权成员；不可见邮箱的邮件、草稿、发送记录、处理记录与跟进来源一并移除，附件随引用隐藏。
  if (next.email && !hidden.some(section => section.key === 'email')) {
    const scope = emailVisibleScope(next.email, actor.userId), denied = new Set<string>();
    for (const list of [next.email.accounts, next.email.messages, next.email.drafts, next.email.sends || []] as Array<Array<{ id: string }>>) for (const row of list) if (!scope.entityIds.has(row.id)) denied.add(row.id);
    if (denied.size) {
      next.email = { ...next.email, accounts: scope.accounts, messages: scope.messages, drafts: scope.drafts, sends: scope.sends };
      const allowed = (target?: { view?: string; id?: string }) => !(target?.view === 'emails' && target.id && denied.has(target.id));
      next.events = (next.events || []).filter(event => !(event.entityType === 'email' && denied.has(event.entityId)));
      next.tasks = (next.tasks || []).filter(task => allowed(task.target));
      next.notifications = (next.notifications || []).filter(item => allowed(item.target as { view?: string; id?: string } | undefined));
      next.calendar = (next.calendar || []).filter(item => allowed(item.target));
    }
  }
  const restrictedFiles = new Set(scopedHiddenFiles(next));
  if (taxBaseHidden) {
    // A PDF/image cannot use the structured tax mask. Use the full source state so
    // another shared reference (or uploader ownership) cannot reopen its original.
    for (const bill of state.payables?.bills || []) if (bill.invoiceType === 'vat-special' || bill.taxAmount > 0) for (const id of bill.fileIds || []) restrictedFiles.add(id);
    for (const claim of state.exportRebate?.claims || []) for (const id of claim.fileIds || []) restrictedFiles.add(id);
  }
  next.files = visibleFiles(state, next, actor.userId, ownerId).filter(file => !restrictedFiles.has(file.id));
  const costVisible=hasScope(actor,'reports:admin')&&!hidden.some(s=>['orders','procurement','receivables','payables'].includes(s.key));
  return { state: next, hidden,...(costVisible?{costMaterialBasis:scope ? null : financialMaterialCostBasis(state)}:{}) };
}
/** 精确匹配附件 ID，不用全文子串判断，避免相似文本开放隐藏附件。 */
function referencedFiles(state: MistState): Set<string> {
  const ids = new Set((state.files || []).map(file => file.id)), found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') { if (ids.has(value)) found.add(value); return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk({ ...state, files: [] });
  return found;
}
/** 已引用附件须有可见来源；尚未引用的附件只给上传人/公司所有者。 */
function visibleFiles(full: MistState, projected: MistState, actorId: string, ownerId?: string) {
  const visible = referencedFiles(projected), referenced = referencedFiles(full);
  return (full.files || []).filter(file => visible.has(file.id) || !referenced.has(file.id) && (actorId === ownerId || file.uploadedBy === actorId));
}
export function canReadFile(state: MistState, actor: TokenPayload, fileId: string, empty: () => MistState, ownerId?: string, scope?: MistDataScope) {
  return projectState(state, actor, empty, ownerId, scope).state.files.some(file => file.id === fileId);
}
