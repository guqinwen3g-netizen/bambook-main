import {financialMaterialCostBasis,type InternalFabricCostBasis} from '../shared/mistInternalFabric';
import {financialClaimCostBasis,type OrderClaimCostBasis} from '../shared/mistClaimCost';
import {MistCommandError} from '../shared/mistWorkspace';
import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { PermissionScope } from '../_shared/rolePermissionMatrix';
import { emailVisibleScope } from '../shared/mistEmail';
import { applyDataScope, scopedHiddenFiles, scopedMaterialDeliveryFileIds, type MistDataScope } from '../shared/mistDataScope';
import type { MistCalendarEvent, MistState, MistTask, MistWorkspaceMember, MistWorkspaceMemberLog, MistWorkspaceAccess as SharedAccess } from '../shared/mistWorkspace';
import { MIST_BUSINESS_GROUPS, MIST_BUSINESS_GROUP_LABEL, type MistOwnedObject } from '../shared/mistAccounts';
import { accountHandovers, type MistAccountHandover } from '../shared/mistHandover';
import { COMPANY_MAINTAIN_SCOPE, LINE_SUPERVISOR_SCOPE } from './companyLibrary';
import { PERMISSION_SCOPES } from '../_shared/rolePermissionMatrix';
import { projectSeals } from '../shared/mistSeals';
import { currentCrmCalendar } from '../shared/mistCrmCalendar';
import { fileMaintainer, restrictedSensitiveFiles, type FilePrivacyContext } from './filePrivacy';
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
  if (next.payables?.bills?.length) next.payables = { ...next.payables, bills: next.payables.bills.map(b => {
    const taxDocument = b.invoiceType === 'vat-special' || b.taxAmount > 0;
    return { ...b, taxAmount: 0, taxRate: '', taxMasked: true,
      // 财务票据自由备注及税务核对原因不能直接恢复被隐藏的税额；业务条款仍在来源合同/结算中。
      ...(taxDocument ? { note: '', ...(b.voided ? { voided: { ...b.voided, reason: '' } } : {}),
        ...(b.invoiceTypeHistory ? { invoiceTypeHistory: b.invoiceTypeHistory.map(entry => ({ ...entry, reason: '' })) } : {}) } : {}) };
  }) };
  const rebate = next.exportRebate;
  const refundReceipts = rebateReceiptIds(next);
  if (rebate?.claims?.length) next.exportRebate = { ...rebate, claims: rebate.claims.map(c => ({ ...c, taxable: 0, expected: 0, taxMasked: true, note: '',
    ...(c.approved ? { approved: { ...c.approved, amount: 0, reason: '' } } : {}),
    ...(c.withdrawn ? { withdrawn: { ...c.withdrawn, reason: '' } } : {}),
    ...(c.settled ? { settled: { ...c.settled, reason: '' } } : {}),
    // 去掉到账流水 id：否则可凭 id 经资金归属等命令的提示拿到到账金额；勾稽编号与日期保留。
    receipts: (c.receipts || []).map(({ receiptId: _receipt, ...r }) => ({ ...r, receiptId: '', amount: 0, ...(r.reversed ? { reversed: { ...r.reversed, reason: '' } } : {}) })),
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
  // 首页个人待办指向 cockpit，不属于任何业务分区，按本人事项处理，不能因账号缺少某个分区权限而被整体隐藏。
  knownViews.add('cockpit');
  return (target?: { view?: string }) => !target?.view || knownViews.has(target.view) && !deniedViews.has(target.view);
}
export function canReadTarget(actor: TokenPayload, target?: { view?: string }) {
  return targetVisibility(hiddenSections(actor))(target);
}
/** 私人日程（有 ownerId）只给本人与参与人；旧日程没有 ownerId 视为公司共享。与前端 calendarVisibleTo 同一规则，服务端为准。 */
export const calendarVisibleTo = (event: Pick<MistCalendarEvent, 'ownerId' | 'participants'>, actorId: string) =>
  !event.ownerId || event.ownerId === actorId || !!event.participants?.some(person => person?.id === actorId);
/**
 * 调度他人待办的依据：业务线主管权限 relations:admin（LINE_SUPERVISOR_SCOPE）。
 * 它是现有「主管团队视角 / 督办 team.nudge / 客户交接」所用的权限点（mistTeam.ts、mistHandover.ts），
 * 与“给成员派待办、跟进成员在手事项”最贴近；users:write 只管公司设置与成员授权，不作为调度依据。
 */
export const TASK_DISPATCH_SCOPE = LINE_SUPERVISOR_SCOPE;
const WRITE_SCOPES = new Set(Object.keys(PERMISSION_SCOPES));
/** 目标页面对应的写入权限：取该页面读取分区的每个读权限的同模块写权限；未登记的页面或无对应写权限时返回 null（失败关闭）。 */
function targetWriteScopes(target?: { view?: string }): string[] | null {
  const section = target?.view ? MIST_READ_SECTIONS.find(item => item.views.includes(target.view!)) : undefined;
  if (!section || !section.permissions.length) return null;
  const scopes = section.permissions.map(scope => scope.replace(/:read$/, ':write'));
  return scopes.every(scope => scope.endsWith(':write') && WRITE_SCOPES.has(scope)) ? scopes : null;
}
/**
 * 修改已有待办（task.complete、带 id 的 task.save）的办理资格；可见性须先由调用方按读投影核对（不可见一律 404）。
 * (a) 在指派人中；(b) 没有指派人的公共待办：持有该待办的岗位权限，或待办无岗位权限时对来源页面有写入权限；(c) 有调度他人待办的主管权限。
 */
export function canHandleTask(actor: TokenPayload, task: Pick<MistTask, 'assigneeIds' | 'permission' | 'target'>) {
  const assignees = Array.isArray(task.assigneeIds) ? task.assigneeIds : [];
  if (assignees.includes(actor.userId)) return true;
  if (hasScope(actor, TASK_DISPATCH_SCOPE as PermissionScope)) return true;
  // 标了岗位权限的事项属于该岗位（与前端 isMyMistTask 一致）：有指派人时岗位持有人同样可以办理，例如工厂补偿交财务核对。
  // 只读权限只决定能否看到，不能作为办理依据（例如内部交付待办标的是 orders:read）。
  const duty = task.permission && !task.permission.endsWith(':read') ? task.permission : undefined;
  if (duty && hasScope(actor, duty as PermissionScope)) return true;
  if (assignees.length) return false;
  if (task.permission) return !!duty && hasScope(actor, duty as PermissionScope);
  const scopes = targetWriteScopes(task.target);
  return !!scopes && scopes.every(scope => hasScope(actor, scope as PermissionScope));
}
const OWNED_KIND_BY_ROLE: Record<string, MistOwnedObject['kind']> = { 客户负责人: 'customer', 订单负责人: 'order', 开发负责人: 'development', 寻样负责人: 'fabric', 商机负责人: 'opportunity' };
for (const group of MIST_BUSINESS_GROUPS) OWNED_KIND_BY_ROLE[`${MIST_BUSINESS_GROUP_LABEL[group]}经手人`] = 'supplier';
/** 当前投影里可见对象的交接清单文字（与 accountOwnedObjects 同一格式，但不限负责人）；交接记录只存文字，按文字精确匹配。 */
function visibleOwnedTexts(state: MistState) {
  const out = new Set<string>();
  for (const c of state.customers || []) out.add(`客户负责人 ${c.code} · ${c.name}`);
  for (const o of state.orders || []) out.add(`订单负责人 ${o.code} · ${o.customer}`);
  for (const d of state.devs || []) out.add(`开发负责人 ${d.code} · ${d.name}`);
  for (const f of state.fabrics || []) out.add(`寻样负责人 ${f.code} · ${f.name}`);
  for (const o of state.crm?.opportunities || []) out.add(`商机负责人 ${o.title}`);
  for (const s of state.market?.suppliers || []) for (const group of MIST_BUSINESS_GROUPS) out.add(`${MIST_BUSINESS_GROUP_LABEL[group]}经手人 ${s.code} · ${s.name}`);
  return out;
}
/**
 * 成员交接档案（handover.account）的读取边界：
 * - 能办理成员交接的账号（公司库为公司维护权限 users:write，本机空间为所有者，与仓储层 null 权限命令的门禁一致）或没有行级范围的账号：完整记录；
 * - 其余账号：只看本人作为交出人或接手人的记录，清单只保留本人当前投影中可见的对象，数量按保留的对象重算，不暴露被隐藏的数量；
 * - 工作区活动里的“成员交接”事件改为中性文本（只留交出人→接手人）。选择改写而不是删除：同事仍能看到负责人变动这一事实（名字本就在成员目录中），
 *   但数量与原因属于交接档案内容，不随公司活动广播；
 * - “接手业务”待办标题含数量汇总，只给接手人本人。
 */
function projectMemberHandovers(next: MistState, actor: TokenPayload) {
  const handovers = accountHandovers(next);
  const visibleTexts = handovers.some(row => row.fromId === actor.userId || row.toId === actor.userId) ? visibleOwnedTexts(next) : new Set<string>();
  const records = handovers.filter(row => row.fromId === actor.userId || row.toId === actor.userId).map((row): MistAccountHandover => {
    const objects = (row.objects || []).filter(text => visibleTexts.has(text)), counts: MistAccountHandover['counts'] = {};
    for (const text of objects) { const kind = OWNED_KIND_BY_ROLE[text.slice(0, text.indexOf(' '))]; if (kind) counts[kind] = (counts[kind] || 0) + 1; }
    return { ...row, objects, counts };
  });
  if (handovers.length) (next as MistState & { memberHandovers?: MistAccountHandover[] }).memberHandovers = records;
  next.events = (next.events || []).map(event => {
    if (event.entityType === 'workspace' && event.text.startsWith('成员交接：')) {
      const names = /^成员交接：([^；]*)；/.exec(event.text)?.[1];
      return { ...event, text: names ? `成员交接：${names}` : '成员交接' };
    }
    // 对象自身的“成员交接 · 负责人：甲→乙：原因”事件（供应商、面料寻样不按行裁剪）：保留负责人变动，去掉原因。
    const object = /^(成员交接 · 负责人：[^：]*)：/.exec(event.text) || /^(内部交付接收人：[^：]*)：/.exec(event.text);
    return object ? { ...event, text: object[1] } : event;
  });
  next.tasks = (next.tasks || []).filter(task => task.kind !== 'account-handover' || task.assigneeIds?.includes(actor.userId));
}
const canManageMemberHandover = (actor: TokenPayload, ownerId?: string) => hasScope(actor, COMPANY_MAINTAIN_SCOPE as PermissionScope) || !!ownerId && ownerId === actor.userId;
/** 按账号自身读权限裁剪状态；被隐藏的数据结构用空公司的同名结构替换，保证页面结构完整。 */
export function projectState(state: MistState, actor: TokenPayload, empty: () => MistState, ownerId?: string, scope?: MistDataScope, privacy?: FilePrivacyContext): { state: MistState; hidden: Section[];costMaterialBasis?:InternalFabricCostBasis[] | null;costClaimBasis?:OrderClaimCostBasis[]|null } {
  const calendarState = { ...state, calendar: currentCrmCalendar(state) };
  const hidden = hiddenSections(actor), next: MistState = scope ? applyDataScope(calendarState, scope, actor.userId) : calendarState;
  // Legacy company activity had no recipients. Keep it in events, never broadcast it to accounts.
  next.notifications = (next.notifications || []).filter(item => item.recipientIds?.includes(actor.userId)).map(item => {
    const {readBy, ...notification} = item;
    return {...notification, recipientIds: [actor.userId], readAt: readBy?.[actor.userId] ?? null};
  });
  // 私人日程只给本人与参与人，不论账号权限多大或有无行级范围（日程原文不进入他人的任何读投影、预演和命令可见性校验）。
  next.calendar = (next.calendar || []).filter(item => calendarVisibleTo(item, actor.userId));
  // Account balances require the complete company ledger; a row-scoped projection cannot compute them safely.
  if (scope && !hidden.some(section => section.key === 'bankAccounts')) hidden.push(MIST_READ_SECTIONS.find(section => section.key === 'bankAccounts')!);
  // 无 sensitive:tax_base 时退税到账流水不下发；账户余额须完整流水，同时隐藏公司银行账户。
  const taxBaseHidden = !hasScope(actor, 'sensitive:tax_base' as PermissionScope);
  if (taxBaseHidden && !hidden.some(section => section.key === 'bankAccounts') && (state.receipts || []).some(r => rebateReceiptIds(state).has(r.id))) hidden.push(MIST_READ_SECTIONS.find(section => section.key === 'bankAccounts')!);
  // Financial read metadata belongs to the response envelope, never to restorable business state.
  delete (next as MistState&{costMaterialBasis?:unknown}).costMaterialBasis;
  delete (next as MistState&{costClaimBasis?:unknown}).costClaimBasis;
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
  // 在分区隐藏之后执行：交接清单只按本账号最终可见的对象过滤。
  if (scope && !canManageMemberHandover(actor, ownerId)) projectMemberHandovers(next, actor);
  // Warehouse-only readers still need the outcome required to dispose their own visible lot.
  // Expose only an action, not the hidden QC task, report, opinion or attachments.
  if (!hidden.some(section => section.key === 'inventory') && next.fulfillment) {
    next.fulfillment = {...next.fulfillment, stockMovements:(next.fulfillment.stockMovements || []).map(row => {
      const {quarantineAction:_stale, ...safe} = row;
      if (!row.quarantinedQuantity || row.quarantineDisposition || !hasScope(actor,'inventory:write')) return safe;
      const task = (state.fulfillment?.qcTasks || []).find(task => task.id === row.quarantineTaskId && task.kind === 'quarantine' && task.quarantine?.returnId === row.id);
      const report = task && (state.fulfillment?.qcReports || []).find(report => report.id === task.reportIds.at(-1) && report.taskId === task.id);
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
  // 印章图片只给公司管理员（本机空间为所有者）与该章用印人，Agent 一律不给；用印与签字记录按所涉业务记录裁剪（见 mistSeals）。
  const maintainer = fileMaintainer(actor, ownerId);
  for (const id of projectSeals(state, next, actor.userId, maintainer, (actor as { actorKind?: unknown }).actorKind === 'agent')) restrictedFiles.add(id);
  // Re-uploading identical bytes does not remove an existing source restriction.
  for (const id of restrictedSensitiveFiles(state, actor, ownerId, privacy)) restrictedFiles.add(id);
  const handoffFiles=scope&&hasScope(actor,'orders:read')&&hasScope(actor,'orders:write')?scopedMaterialDeliveryFileIds(state,scope,actor.userId):new Set<string>();
  next.files = visibleFiles(state, next, actor.userId, ownerId,handoffFiles).filter(file => !restrictedFiles.has(file.id));
  const costVisible=hasScope(actor,'reports:admin')&&!hidden.some(s=>['orders','procurement','receivables','payables'].includes(s.key));
  let costClaimBasis:OrderClaimCostBasis[]|null=null;
  if(costVisible)try{costClaimBasis=financialClaimCostBasis(state,new Set(next.orders.map(order=>order.id)));}catch(error){if(!(error instanceof MistCommandError))throw error;}
  return { state: next, hidden,...(costVisible?{costMaterialBasis:scope ? null : financialMaterialCostBasis(state),costClaimBasis}:{}) };
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
function visibleFiles(full: MistState, projected: MistState, actorId: string, ownerId?: string,extra:ReadonlySet<string>=new Set()) {
  const visible = referencedFiles(projected), referenced = referencedFiles(full);
  return (full.files || []).filter(file => visible.has(file.id) || extra.has(file.id) || !referenced.has(file.id) && (actorId === ownerId || file.uploadedBy === actorId));
}
export function canReadFile(state: MistState, actor: TokenPayload, fileId: string, empty: () => MistState, ownerId?: string, scope?: MistDataScope, privacy?: FilePrivacyContext) {
  return projectState(state, actor, empty, ownerId, scope, privacy).state.files.some(file => file.id === fileId);
}
