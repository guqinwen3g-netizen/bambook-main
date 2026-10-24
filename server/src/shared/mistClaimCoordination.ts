import {orderFundingNonCustomerReceiptLimit} from './mistOrderFunding';
import {recoveryOtherFulfilledMinor,type ClaimRecoverySettlement} from './mistClaimRecoveryReceipts';
/**
 * 售后索赔协同（CAP-claims-01..03 · 协同首轮）。
 * 业务口径（2026-10-14 用户确认的实际做法）：
 * - 业务员接到客诉后建案，并通知内部质检、负责人、跟单 / 采购和相关工厂。通知工厂只是请其配合核实，
 *   不等于认定工厂责任，也不等于答应客户金额；系统不对外发送，只记录实际通知方式、时间与内部备注。
 *   本系统是公司端；供应商端 / 客户端是后续独立平台（数据互通），本轮不做对外说明或对外可见字段。
 * - 内部质检牵头核实事实：是否属实、影响范围、货物位置、可减损措施、工厂回复、是否涉及安全隐患。
 *   先核实再谈责任和金额；紧急情况允许先处置，页面会明确标出“质检尚未核实”。
 * - 两笔账分开：对客户的处置（折让 / 退货退款 / 补发 / 返修，沿用原处置审批）与向工厂追偿分别记录；
 *   公司自担 = 对客户已批准金额 − 工厂已同意金额，仅同币种时计算，不做汇率估算。
 * - 工厂追偿：协商中 → 已同意（金额与方式）→ 已落实（实际扣款 / 收款凭据）；放弃追偿须负责人（aftersales:approve）且不能自批。
 * - 客户处理完、工厂补偿落实或经批准放弃，案件才能关闭。
 */
import { MistCommandError, mistMoneyMinor, type MistContext, type MistState } from './mistWorkspace';
import { recoveryDeductedMinor } from './mistPayables';

export type ClaimGoodsLocation = 'factory' | 'transit' | 'customer' | 'sold' | 'unknown';
export type ClaimVerifyResult = 'confirmed' | 'partial' | 'notConfirmed';
export type ClaimRecoveryMethod = 'deduction' | 'payment' | 'replacement' | 'mixed';
export type ClaimRecoveryState = 'Negotiating' | 'Agreed' | 'Settled' | 'Waived' | 'Withdrawn';
export type ClaimNotice = { id: string; at: string; by: string; byId: string; supplierId: string; supplierName: string; factoryChannel: string; note: string; /** 首轮旧字段，只读兼容 */ factoryNote?: string; internalNote?: string };
export type ClaimVerification = { id: string; at: string; by: string; byId: string; result: ClaimVerifyResult; scope: string; affectedQuantity: number; unit: string; goodsLocation: ClaimGoodsLocation; mitigation: string; factoryResponse: string; safety: boolean; fileIds: string[] };
export type ClaimRecoveryEvent = { at: string; by: string; action: string; note: string };
export type ClaimRecovery = {
  id: string; supplierId: string; supplierName: string; currency: string; requested: number; basis: string; state: ClaimRecoveryState; createdAt: string; createdBy: string; createdById: string;
  settlements?: ClaimRecoverySettlement[];
  agreed?: number; method?: ClaimRecoveryMethod; agreedNote?: string; settled?: number; settledRef?: string; settledDate?: string; waiveReason?: string; events: ClaimRecoveryEvent[];
};
export type ClaimCoordination = { notices: ClaimNotice[]; verifications: ClaimVerification[]; recoveries: ClaimRecovery[] };
type ClaimLike = { id: string; code: string; orderId: string; invoiceId: string; state: string; coordination?: ClaimCoordination; dispositions: Array<{ kind: string; amount: number; state: string; supersededById?: string }> };

export type ClaimCoordinationCommand =
  | { type: 'platform.claim.notify'; payload: { id: string; supplierId: string; factoryChannel: string; note: string } }
  | { type: 'platform.claim.verify'; payload: { id: string; result: ClaimVerifyResult; scope: string; affectedQuantity: number; unit: string; goodsLocation: ClaimGoodsLocation; mitigation: string; factoryResponse: string; safety: boolean; fileIds: string[] } }
  | { type: 'platform.claim.recovery.open'; payload: { claimId: string; supplierId: string; currency: string; requested: number; basis: string } }
  | { type: 'platform.claim.recovery.agree'; payload: { id: string; agreed: number; method: ClaimRecoveryMethod; note: string } }
  | { type: 'platform.claim.recovery.method'; payload: { id: string; method: 'payment'; reason: string } }
  | { type: 'platform.claim.recovery.settle'; payload: { id: string; amount: number; reference?: string; date?: string; receiptId?:string; payerBasis?:string } }
  | { type: 'platform.claim.recovery.receipt.allocate'; payload:{id:string;amount:number;receiptId:string;payerBasis?:string;reference?:string;date?:string} }
  | { type: 'platform.claim.recovery.settlement.reverse'; payload:{id:string;settlementId:string;reason:string} }
  | { type: 'platform.claim.recovery.waive'; payload: { id: string; reason: string } };

export const CLAIM_COORDINATION_COMMANDS = ['platform.claim.notify', 'platform.claim.verify', 'platform.claim.recovery.open', 'platform.claim.recovery.agree', 'platform.claim.recovery.method', 'platform.claim.recovery.settle', 'platform.claim.recovery.receipt.allocate', 'platform.claim.recovery.settlement.reverse', 'platform.claim.recovery.waive'] as const;
export const CLAIM_GOODS_LOCATIONS: ClaimGoodsLocation[] = ['factory', 'transit', 'customer', 'sold', 'unknown'];
export const CLAIM_RECOVERY_METHODS: ClaimRecoveryMethod[] = ['deduction', 'payment', 'replacement', 'mixed'];
export const CLAIM_LOCATION_LABEL: Record<ClaimGoodsLocation, string> = { factory: '还在工厂', transit: '运输途中', customer: '已到客户仓库', sold: '已上架 / 已销售', unknown: '尚不清楚' };
export const CLAIM_RESULT_LABEL: Record<ClaimVerifyResult, string> = { confirmed: '问题属实', partial: '部分属实', notConfirmed: '不属实' };
export const CLAIM_METHOD_LABEL: Record<ClaimRecoveryMethod, string> = { deduction: '从货款中扣', payment: '工厂付款', replacement: '工厂免费补货 / 返修', mixed: '组合方式' };
export const CLAIM_RECOVERY_LABEL: Record<ClaimRecoveryState, string> = { Negotiating: '协商中', Agreed: '工厂已同意', Settled: '已落实', Waived: '已批准放弃', Withdrawn: '已撤回' };

export function claimCoordinationPermission(type: ClaimCoordinationCommand['type']): string {
  if (type === 'platform.claim.verify') return 'qc:inspect';
  if (type === 'platform.claim.recovery.settle'||type==='platform.claim.recovery.settlement.reverse'||type==='platform.claim.recovery.receipt.allocate') return 'invoices:reconcile';
  if (type === 'platform.claim.recovery.waive') return 'aftersales:approve';
  return 'aftersales:write';
}

function fail(message: string, code = 'VALIDATION'): never { throw new MistCommandError(code as any, message); }
function text(v: unknown, label: string, required = true, max = 2000) { if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(label + '未填写或格式无效'); return (v as string).trim(); }
function amount(v: unknown, label: string, allowZero = false) { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) fail(label + (allowZero ? '须为非负金额' : '须大于零')); const minor = mistMoneyMinor(v as number); if (!/^\d{1,12}(\.\d{1,2})?$/.test(String(v))) fail(label + '最多两位小数'); return minor / 100; }
function day(v: unknown) { const s = text(v, '日期'); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail('日期无效'); return s; }
function businessDay(instant: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)); const v = (t: string) => parts.find(x => x.type === t)?.value ?? ''; return v('year') + '-' + v('month') + '-' + v('day'); }
function enumOf<T extends string>(v: unknown, allowed: readonly T[], label: string): T { if (!allowed.includes(v as T)) fail(label + '无效'); return v as T; }
function coordination(claim: ClaimLike): ClaimCoordination { if (!claim.coordination) claim.coordination = { notices: [], verifications: [], recoveries: [] }; return claim.coordination; }
function active(claim: ClaimLike) { if (claim.state === 'Closed' || claim.state === 'Cancelled') fail('案件已结束，不能继续处理'); }
function actor(c: MistContext) { if (!c.actorId) fail('须记录实际登录账号', 'PRECONDITION'); return c.actorId!; }
function supplier(root: MistState, id: string) { const row = (root as MistState & { market?: { suppliers: Array<{ id: string; name: string }> } }).market?.suppliers.find(s => s.id === id); if (!row) fail('请选择供应商档案中的准确工厂', 'NOT_FOUND'); return row!; }
function claimOf(claims: ClaimLike[], id: string) { const row = claims.find(r => r.id === id); if (!row) fail('客诉案件不存在', 'NOT_FOUND'); return row!; }
function recoveryOf(claims: ClaimLike[], id: string) { for (const claim of claims) { const row = claim.coordination?.recoveries.find(r => r.id === id); if (row) return { claim, row }; } return fail('工厂追偿记录不存在', 'NOT_FOUND'); }
function emit(root: MistState, c: MistContext, claimId: string, message: string, fileIds: string[] = []) { root.events.unshift({ id: c.id(), entityType: 'claim', entityId: claimId, at: c.now, actor: c.actorName, text: message, fileIds: [...fileIds] }); }
function task(root: MistState, c: MistContext, claimId: string, kind: string, title: string, who: { assigneeIds?: string[]; permission?: string }) { const existing = root.tasks.find(t => t.kind === kind && t.target.view === 'claims' && t.target.id === claimId); if (existing) { existing.title = title; existing.done = false; existing.assigneeIds = who.assigneeIds ?? []; existing.permission = who.permission; return; } root.tasks.unshift({ id: c.id(), title, due: '', done: false, kind, target: { view: 'claims', id: claimId }, assigneeIds: who.assigneeIds ?? [], ...(who.permission ? { permission: who.permission } : {}) }); }
function done(root: MistState, claimId: string, kind: string) { for (const t of root.tasks) if (t.kind === kind && t.target.view === 'claims' && t.target.id === claimId) t.done = true; }
function notify(root: MistState, c: MistContext, claimId: string, title: string, detail: string) { root.notifications.unshift({ id: c.id(), title, detail, at: c.now, readAt: null, target: { view: 'claims', id: claimId }, category: 'general' }); }
function claimFiles(root: MistState, ids: unknown) { if (!Array.isArray(ids) || ids.length > 50) fail('附件无效'); for (const id of ids) if (!root.files.some(f => f.id === id)) fail('附件不存在', 'NOT_FOUND'); return [...new Set(ids as string[])]; }

/** 当前质检结论（最新一次核实）；未核实返回 null。 */
export function currentClaimVerification(claim: { coordination?: ClaimCoordination }) { const rows = claim.coordination?.verifications ?? []; return rows.length ? rows[rows.length - 1] : null; }
const OPEN_RECOVERY: ClaimRecoveryState[] = ['Negotiating', 'Agreed'];

/** Verification follows the authoritative order domain, never a domain supplied by the caller. */
export function claimQcPermission(root: Pick<MistState, 'orders'>, claim: Pick<ClaimLike, 'orderId'>): string | null {
  const domain = root.orders.find(order => order.id === claim.orderId)?.type;
  return domain === 'fabric' || domain === 'garment' ? `qc:${domain}_chain:write` : null;
}
export function canVerifyClaim(root: Pick<MistState, 'orders'>, claim: Pick<ClaimLike, 'orderId'>, can: MistContext['can']): boolean {
  const permission = claimQcPermission(root, claim);
  return !!permission && !!can?.('qc:inspect') && !!can?.(permission);
}

/** 两笔账（creditsOpen：贷项通知单仍有未结清余额，客户这边尚未真正处理完）：对客户已批准 / 已执行的金额、工厂已同意 / 已落实的金额、公司自担（同币种才计算）。 */
export function claimLedger(root: MistState, claim: ClaimLike, opts: { creditsOpen?: boolean } = {}) {
  const currency = root.invoices.find(i => i.id === claim.invoiceId)?.currency ?? root.orders.find(order => order.id === claim.orderId)?.currency ?? '';
  const customerMinor = claim.dispositions.filter(d => ['approved', 'Executed'].includes(d.state) && !d.supersededById).reduce((s, d) => s + mistMoneyMinor(d.amount || 0), 0);
  const pendingMinor = claim.dispositions.filter(d => ['Draft', 'pending'].includes(d.state) && !d.supersededById).reduce((s, d) => s + mistMoneyMinor(d.amount || 0), 0);
  const recoveries = (claim.coordination?.recoveries ?? []).filter(r => r.state !== 'Withdrawn');
  const sameCurrency = recoveries.every(r => r.currency === currency);
  const agreedMinor = recoveries.filter(r => r.state === 'Agreed' || r.state === 'Settled' || r.state === 'Waived' && (r.settled??0)>0).reduce((s, r) => s + mistMoneyMinor(r.state==='Waived'?(r.settled??0):(r.agreed??0)), 0);
  const settledMinor = recoveries.filter(r => r.state !== 'Withdrawn').reduce((s, r) => s + mistMoneyMinor(r.settled ?? 0), 0);
  const requestedMinor = recoveries.filter(r => r.state !== 'Waived').reduce((s, r) => s + mistMoneyMinor(r.requested), 0);
  const customerOpen = claim.dispositions.some(d => ['Draft', 'pending', 'approved'].includes(d.state) && !d.supersededById);
  const recoveryOpen = recoveries.some(r => OPEN_RECOVERY.includes(r.state));
  return {
    currency, customer: customerMinor / 100, customerPending: pendingMinor / 100, recoveryRequested: sameCurrency ? requestedMinor / 100 : null,
    recoveryAgreed: sameCurrency ? agreedMinor / 100 : null, recoverySettled: sameCurrency ? settledMinor / 100 : null,
    companyLoss: sameCurrency ? (customerMinor - agreedMinor) / 100 : null, sameCurrency,
    customerSettled: claim.dispositions.length > 0 && !customerOpen && !opts.creditsOpen, customerMoneyOpen: !!opts.creditsOpen, recoveryOpen, hasRecovery: recoveries.length > 0,
  };
}

/** 关闭前置：工厂追偿必须已落实、已批准放弃或已撤回。 */
export function assertClaimRecoveriesSettled(claim: ClaimLike) {
  const open = (claim.coordination?.recoveries ?? []).filter(r => OPEN_RECOVERY.includes(r.state)||r.state==='Settled'&&mistMoneyMinor(r.settled??0)!==mistMoneyMinor(r.agreed??0));
  if (open.length) fail('客户这边已处理，但还有 ' + open.length + ' 笔工厂补偿未落实；落实或经负责人批准放弃后才能关闭', 'PRECONDITION');
}

/** 撤销案件：已落实的工厂补偿不能随案撤销；协商中 / 已同意的追偿一并撤回并留痕。 */
export function withdrawClaimRecoveries(claim: ClaimLike, reason: string, c: MistContext) {
  const rows = claim.coordination?.recoveries ?? [];
  if (rows.some(r => r.state === 'Settled'||(r.settled??0)>0||recoveryOtherFulfilledMinor(r)>0)) fail('工厂补偿已落实，不能直接撤销案件；请人工核对退回工厂款项', 'PRECONDITION');
  for (const r of rows) if (OPEN_RECOVERY.includes(r.state)) { r.state = 'Withdrawn'; r.events.push({ at: c.now, by: c.actorName, action: 'withdraw', note: '随案撤销：' + reason }); }
}

export function applyClaimCoordinationCommand(root: MistState, claims: ClaimLike[], command: ClaimCoordinationCommand, c: MistContext): Record<string, unknown> {
  switch (command.type) {
    case 'platform.claim.notify': {
      const v = command.payload, claim = claimOf(claims, v.id); active(claim); const byId = actor(c), s = supplier(root, text(v.supplierId, '相关工厂'));
      const notice: ClaimNotice = { id: c.id(), at: c.now, by: c.actorName, byId, supplierId: s.id, supplierName: s.name, factoryChannel: text(v.factoryChannel, '通知工厂的实际方式', true, 200), note: text(v.note, '备注', false) };
      coordination(claim).notices.push(notice);
      task(root, c, claim.id, 'claim-verify:' + claim.id, '质检核实客诉事实 · ' + claim.code, { permission: claimQcPermission(root, claim) ?? 'qc:inspect' });
      task(root, c, claim.id, 'claim-factory:' + claim.id, '跟进工厂核实回复 · ' + claim.code + ' · ' + s.name, { assigneeIds: [byId] });
      notify(root, c, claim.id, claim.code + ' · 新客诉待关注', '业务员 ' + c.actorName + ' 已通知质检、跟单与工厂（' + s.name + '）配合核实；通知工厂不代表认定责任或答应客户金额。');
      emit(root, c, claim.id, '通知相关人员：内部质检 / 负责人 / 跟单，工厂 ' + s.name + '（' + notice.factoryChannel + '）');
      return { id: notice.id, claimId: claim.id };
    }
    case 'platform.claim.verify': {
      const v = command.payload, claim = claimOf(claims, v.id); active(claim); const byId = actor(c);
      if (!canVerifyClaim(root, claim, c.can)) throw new MistCommandError('FORBIDDEN', '仅对应业务线QC可核实客诉', 403);
      const qty = v.affectedQuantity; if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty * 10000)) fail('影响数量须为非负数');
      const row: ClaimVerification = { id: c.id(), at: c.now, by: c.actorName, byId, result: enumOf(v.result, ['confirmed', 'partial', 'notConfirmed'] as const, '核实结论'), scope: text(v.scope, '影响范围（款式 / 批次）'), affectedQuantity: qty, unit: text(v.unit, '数量单位', qty > 0, 20), goodsLocation: enumOf(v.goodsLocation, CLAIM_GOODS_LOCATIONS, '货物现在的位置'), mitigation: text(v.mitigation, '减少损失的办法', false), factoryResponse: text(v.factoryResponse, '工厂回复', false), safety: v.safety === true, fileIds: claimFiles(root, v.fileIds ?? []) };
      const first = !coordination(claim).verifications.length; coordination(claim).verifications.push(row);
      done(root, claim.id, 'claim-verify:' + claim.id); if (row.factoryResponse) done(root, claim.id, 'claim-factory:' + claim.id);
      notify(root, c, claim.id, claim.code + ' · 质检' + (first ? '已核实' : '更新核实') + '：' + CLAIM_RESULT_LABEL[row.result], (row.safety ? '⚠ 涉及安全隐患，需单独评估停售或召回，不能只谈折扣。' : '') + '影响 ' + row.scope + ' · ' + row.affectedQuantity + ' ' + row.unit + ' · 货物' + CLAIM_LOCATION_LABEL[row.goodsLocation]);
      emit(root, c, claim.id, '质检核实：' + CLAIM_RESULT_LABEL[row.result] + (row.safety ? '（涉及安全隐患）' : ''), row.fileIds);
      return { id: row.id, claimId: claim.id };
    }
    case 'platform.claim.recovery.open': {
      const v = command.payload, claim = claimOf(claims, v.claimId); active(claim); const byId = actor(c), s = supplier(root, text(v.supplierId, '追偿工厂'));
      const currency = text(v.currency, '币种', true, 8).toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) fail('币种须为三位代码');
      if (coordination(claim).recoveries.some(r => r.supplierId === s.id && OPEN_RECOVERY.includes(r.state))) fail('该工厂已有一笔未落实的追偿，请在原记录上继续', 'CONFLICT');
      const row: ClaimRecovery = { id: c.id(), supplierId: s.id, supplierName: s.name, currency, requested: amount(v.requested, '要求工厂承担的金额'), basis: text(v.basis, '追偿依据'), state: 'Negotiating', createdAt: c.now, createdBy: c.actorName, createdById: byId, events: [{ at: c.now, by: c.actorName, action: 'open', note: '向工厂提出 ' + currency + ' ' + v.requested }] };
      coordination(claim).recoveries.push(row); done(root, claim.id, 'claim-factory:' + claim.id);
      task(root, c, claim.id, 'claim-recovery:' + row.id, '跟进工厂补偿 · ' + claim.code + ' · ' + s.name, { assigneeIds: [byId] });
      emit(root, c, claim.id, '向工厂 ' + s.name + ' 提出追偿 ' + currency + ' ' + row.requested);
      return { id: row.id, claimId: claim.id };
    }
    case 'platform.claim.recovery.agree': {
      const v = command.payload, { claim, row } = recoveryOf(claims, v.id); active(claim); actor(c);
      if (row.state !== 'Negotiating') fail('只有协商中的追偿可以记录工厂同意结果');
      row.agreed = amount(v.agreed, '工厂同意承担的金额'); row.method = enumOf(v.method, CLAIM_RECOVERY_METHODS, '补偿方式'); row.agreedNote = text(v.note, '工厂确认依据（邮件 / 签字等）'); row.state = 'Agreed';
      task(root,c,claim.id,'claim-recovery:'+row.id,'工厂补偿 · '+claim.code,{assigneeIds:[row.createdById],permission:'invoices:reconcile'});
      row.events.push({ at: c.now, by: c.actorName, action: 'agree', note: '工厂同意 ' + row.currency + ' ' + row.agreed + ' · ' + CLAIM_METHOD_LABEL[row.method] + ' · ' + row.agreedNote });
      emit(root, c, claim.id, '工厂 ' + row.supplierName + ' 同意承担 ' + row.currency + ' ' + row.agreed + '（' + CLAIM_METHOD_LABEL[row.method] + '）');
      return { id: row.id, claimId: claim.id };
    }
    case 'platform.claim.recovery.method': {
      // 原约定“从货款中扣”（或组合方式）但货款已付清 / 没有可扣票据：经工厂确认改为工厂直接付款。已扣部分保留，只改还没扣的部分。
      const v = command.payload, { claim, row } = recoveryOf(claims, v.id); active(claim); actor(c);
      if (row.state !== 'Agreed') fail('只有工厂已同意、尚未落实的追偿可以改补偿方式', 'PRECONDITION');
      if (row.method !== 'deduction' && row.method !== 'mixed') fail('只有“从货款中扣”或组合方式可以改为工厂付款', 'PRECONDITION');
      if (v.method !== 'payment') fail('目前只支持改为工厂付款');
      const deductedMinor = recoveryDeductedMinor(root, row.id), left = mistMoneyMinor(row.agreed ?? 0) - deductedMinor-recoveryOtherFulfilledMinor(row);
      if (left <= 0) fail('同意金额已全部从货款中扣，无需改方式', 'PRECONDITION');
      const reason = text(v.reason, '改方式原因与工厂确认依据', true, 1000), from = row.method;
      row.method = 'payment';
      const fmt = (m: number) => (m / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      row.events.push({ at: c.now, by: c.actorName, action: 'method', note: CLAIM_METHOD_LABEL[from] + ' → 工厂付款' + (deductedMinor ? '（已从货款扣 ' + row.currency + ' ' + fmt(deductedMinor) + ' 保留）' : '') + '，待工厂付 ' + row.currency + ' ' + fmt(left) + ' · ' + reason });
      emit(root, c, claim.id, '向 ' + row.supplierName + ' 的追偿改为工厂付款：' + reason);
      return { id: row.id, claimId: claim.id };
    }
    case 'platform.claim.recovery.receipt.allocate':
    case 'platform.claim.recovery.settle': {
      const v=command.payload,{claim,row}=recoveryOf(claims,v.id);active(claim);const byId=actor(c);
      if(row.state!=='Agreed')fail('须先记录工厂同意的金额与方式，才能登记实际落实');
      if(row.method==='deduction')fail('请在应付票据登记索赔扣款','PRECONDITION');
      const value=amount(v.amount,'本次落实金额'),minor=mistMoneyMinor(value),deducted=recoveryDeductedMinor(root,row.id),previous=recoveryOtherFulfilledMinor(row);
      if(deducted+previous+minor>mistMoneyMinor(row.agreed??0))fail('本次金额超过工厂补偿未落实余额');
      if((row.method==='payment'||row.method==='mixed')&&command.type!=='platform.claim.recovery.receipt.allocate')fail('请使用对应到账办理工厂付款','PRECONDITION');
      if(command.type==='platform.claim.recovery.receipt.allocate'&&row.method!=='payment'&&row.method!=='mixed')fail('当前补偿方式不是工厂付款');
      let entry:ClaimRecoverySettlement;
      if(row.method==='payment'||row.method==='mixed'){
        const receiptId=text(v.receiptId,'对应到账'),receipt=root.receipts.find(item=>item.id===receiptId);
        if(!receipt)fail('对应到账不存在','NOT_FOUND');
        if(receipt!.currency!==row.currency)fail('到账与工厂补偿币种不同');
        const account=root.bankAccounts?.find(item=>item.id===receipt!.accountId);
        if(!account||account.currency!==receipt!.currency)fail('请先将到账归属公司账户','PRECONDITION');
        if(receipt!.date>businessDay(c.now))fail('到账日期不能在未来');
        const normalized=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
        const samePayer=normalized(receipt!.payer)===normalized(row.supplierName),payerBasis=v.payerBasis===undefined?'':text(v.payerBasis,'付款方关系依据',false);
        if(!samePayer&&!payerBasis)fail('请填写付款方关系依据');
        if(minor>mistMoneyMinor(orderFundingNonCustomerReceiptLimit(root,receiptId)))fail('到账可对应余额不足，或已归属客户款项','PRECONDITION');
        entry={id:c.id(),kind:'receipt',receiptId,receiptCode:receipt!.code,amount:value,currency:row.currency,date:receipt!.date,reference:receipt!.ref||receipt!.code,...(payerBasis?{payerBasis}:{}),at:c.now,by:c.actorName,byId};
      }else{
        const date=day(v.date);if(date>businessDay(c.now))fail('落实日期不能在未来');
        entry={id:c.id(),kind:'noncash',amount:value,currency:row.currency,date,reference:text(v.reference,'实际补偿凭据'),at:c.now,by:c.actorName,byId};
      }
      (row.settlements??=[]).push(entry);row.settled=(deducted+previous+minor)/100;row.settledRef=entry.reference;row.settledDate=entry.date;
      const complete=deducted+previous+minor===mistMoneyMinor(row.agreed??0);row.state=complete?'Settled':'Agreed';
      row.events.push({at:c.now,by:c.actorName,action:'settle',note:'落实 '+row.currency+' '+value+' · '+entry.reference});
      if(complete)done(root,claim.id,'claim-recovery:'+row.id);
      emit(root,c,claim.id,complete?'工厂补偿已落实':'工厂补偿部分落实');return{id:row.id,claimId:claim.id,settlementId:entry.id};
    }
    case 'platform.claim.recovery.settlement.reverse': {
      const v=command.payload,{claim,row}=recoveryOf(claims,v.id);active(claim);const byId=actor(c);
      if(row.state==='Waived'||row.state==='Withdrawn')fail('追偿已结束，请核对原决定','PRECONDITION');
      const entry=row.settlements?.find(item=>item.id===text(v.settlementId,'落实记录'));
      if(!entry||entry.reversed)fail('落实记录不存在或已冲回','PRECONDITION');
      const reason=text(v.reason,'冲回原因');entry!.reversed={at:c.now,by:c.actorName,byId,reason};
      const remaining=recoveryDeductedMinor(root,row.id)+recoveryOtherFulfilledMinor(row);row.state='Agreed';
      if(remaining)row.settled=remaining/100;else{delete row.settled;delete row.settledRef;delete row.settledDate;}
      row.events.push({at:c.now,by:c.actorName,action:'settle-reverse',note:entry!.reference+' · '+reason});
      task(root,c,claim.id,'claim-recovery:'+row.id,'工厂补偿 · '+claim.code,{assigneeIds:[row.createdById],permission:'invoices:reconcile'});
      emit(root,c,claim.id,'冲回工厂补偿对应：'+reason);return{id:row.id,claimId:claim.id,settlementId:entry!.id};
    }
    case 'platform.claim.recovery.waive': {
      const v = command.payload, { claim, row } = recoveryOf(claims, v.id); active(claim); const byId = actor(c);
      if (!OPEN_RECOVERY.includes(row.state)) fail('当前追偿已结束');
      if (byId === row.createdById) fail('提出追偿的人不能自己批准放弃，请由负责人决定', 'FORBIDDEN');
      row.waiveReason = text(v.reason, '放弃追偿的原因'); row.state = 'Waived';
      row.events.push({ at: c.now, by: c.actorName, action: 'waive', note: row.waiveReason });
      done(root, claim.id, 'claim-recovery:' + row.id);
      emit(root, c, claim.id, '负责人批准放弃向 ' + row.supplierName + ' 追偿：' + row.waiveReason);
      return { id: row.id, claimId: claim.id };
    }
  }
}
