/**
 * 合同类、资金类审批的当场手写签字（2026-11-05 用户定案）。
 *
 * - 批准（decision === 'approved'）下列审批，以及应付结算复核、坏账 / 红冲核销、退税核准，须附本人当场手写的签字；
 *   驳回与其他命令不需要。签字不存储复用，每次决定单独归档一份。
 * - 签字只接受 components/mist/SignaturePad.tsx `signatureSvg` 的输出格式：一个 <svg>，内部只有 <path d="M x y Q x y x y" stroke-width>
 *   与 <circle cx cy r fill>。服务端按解析出的数字重新序列化后归档，不透传原文。
 * - 仓储层（server/src/mist/repository.ts）负责要求 / 拒绝签字、写入私有文件并在命令成功后登记 decisionSignatures；
 *   Agent 永远不能签字。读投影（server/src/mist/access.ts）只把签字记录给签字人本人和能看到所签业务记录的人。
 */
import { MistCommandError, type MistState } from './mistWorkspace';
import type { ClosableLine } from './mistOrderClosure';
import type { MistReviewTask } from './mistReview';
import { stableJson } from './stableJson';

export type MistDecisionSignature = {
  id: string; commandType: string; entityId: string; decision?: string;
  /** 归档的签字 SVG（私有文件，image/svg+xml）。 */
  fileId: string;
  actorId: string; actor: string; at: string; requestId: string;
  /** Locked, server-derived approval identity; never copied from a client payload. */
  reviewId?: string;
};

/** Response-only associations. They are never added to old business/signature records. */
export type MistSignatureReviewBinding = { signatureId: string; reviewId: string };
export type MistSignatureReceiptFact = { signatureId: string; requestId: string; actorId: string; revision?: number; reviewId?: string; unresolved?: true };
export const REVIEW_SIGNATURE_COMMANDS: Partial<Record<MistReviewTask['kind'], string>> = {
  order: 'order.governance.decide', procurement: 'fulfillment.procurement.decide',
  procurementAmendment: 'fulfillment.procurement.amend.decide', payment: 'payable.request.decide', stockCount: 'fulfillment.stock.count.decide',
};
const exactId = (value: unknown): value is string => typeof value === 'string' && !!value && value === value.trim();
const frozenRoster = (value: unknown): value is string[] => Array.isArray(value) && !!value.length && value.every(exactId) && new Set(value).size === value.length;
type SignatureState = Pick<MistState, 'decisionSignatures'> & Partial<Pick<MistState, 'orders' | 'orderLines' | 'fulfillment' | 'payables'>>;

/** Receipt fields must identify this same actor/request/signature before supplying any association. */
export function signatureReceiptFact(signature: MistDecisionSignature, receipt: any): MistSignatureReceiptFact {
  const base = { signatureId: signature.id, requestId: signature.requestId, actorId: signature.actorId };
  if (!exactId(signature.id) || !exactId(signature.requestId) || !exactId(signature.actorId)) return { ...base, unresolved: true };
  const result = receipt?.result, value = result?.result;
  if (!receipt || receipt.requestId !== signature.requestId || receipt.actorId !== signature.actorId || value?.signatureId !== signature.id || !Number.isSafeInteger(result?.revision) || result.revision <= 0 || !Number.isSafeInteger(receipt.expectedRevision) || receipt.expectedRevision < 0 || receipt.expectedRevision >= result.revision) return { ...base, unresolved: true };
  if (Object.prototype.hasOwnProperty.call(value, 'reviewId') && !exactId(value.reviewId)) return { ...base, unresolved: true };
  return { ...base, revision: result.revision, ...(value.reviewId === undefined ? {} : { reviewId: value.reviewId }) };
}

/** Run on locked pre-command state, after domain validation and before writing a signature file. */
export function pendingSignatureReviewId(tasks: readonly MistReviewTask[], command: { type: string; payload?: any }, actorId: string, expectedReviewId?: string): string | undefined {
  if (!Object.values(REVIEW_SIGNATURE_COMMANDS).includes(command.type)) return undefined;
  const matches = tasks.filter(task => REVIEW_SIGNATURE_COMMANDS[task.kind] === command.type && task.entityId === signatureEntityId(command) && task.status === 'pending');
  if (command.payload?.decision !== 'approved' || matches.length !== 1 || !exactId(matches[0].id) || !frozenRoster(matches[0].reviewerIds) || !matches[0].reviewerIds.includes(actorId) || expectedReviewId !== undefined && matches[0].id !== expectedReviewId) throw new MistCommandError('PRECONDITION', '无法唯一核对本次审批，请重新读取后核对', 422);
  return matches[0].id;
}

function decidedActorId(state: SignatureState, task: MistReviewTask): string | undefined {
  if (task.kind === 'order') {
    for (const order of state.orders || []) {
      if (task.entityId === order.id && task.id.startsWith('order:')) return order.governance?.rounds.find(round => 'order:' + round.id === task.id)?.decidedBy;
      const cancellation = order.governance?.cancellation;
      if (cancellation && task.id === 'order-cancel:' + cancellation.id && task.entityId === order.id + '#cancel:' + cancellation.id) return cancellation.decidedBy;
    }
    for (const line of (state.orderLines || []) as ClosableLine[]) {
      if (line.closure && task.id === 'order-close:' + line.closure.id && task.entityId === line.orderId + '#close:' + line.id) return line.closure.decidedBy;
      const request = line.overShips?.find(item => task.id === 'order-overship:' + item.id && task.entityId === line.orderId + '#overship:' + item.id);
      if (request) return request.decidedBy;
    }
  }
  if (task.kind === 'procurement') return state.fulfillment?.purchases.find(item => item.id === task.entityId)?.decision?.actorId;
  if (task.kind === 'procurementAmendment') return state.fulfillment?.purchases.flatMap(item => item.amendments || []).find(item => item.id === task.entityId)?.decision?.actorId;
  if (task.kind === 'payment') return state.payables?.requests?.find(item => item.id === task.entityId)?.decision?.actorId;
  if (task.kind === 'stockCount') return state.fulfillment?.stockCounts?.find(item => item.id === task.entityId)?.decision?.actorId;
  return undefined;
}

/** Shared by server review reads and local submitted rows; no name or clock matching. */
export function resolveReviewDecisionSignature(state: SignatureState, task: MistReviewTask, tasks: readonly MistReviewTask[], options: { receipts?: readonly MistSignatureReceiptFact[]; bindings?: readonly MistSignatureReviewBinding[] } = {}): MistDecisionSignature | undefined {
  const command = REVIEW_SIGNATURE_COMMANDS[task.kind], all = state.decisionSignatures || [];
  if (!command || task.status !== 'approved' || !frozenRoster(task.reviewerIds)) return undefined;
  const actorId = decidedActorId(state, task);
  const counts = new Map<string, number>();
  for (const row of all) for (const [kind, value] of [['id', row.id], ['file', row.fileId], ['request', row.requestId]]) { const key = kind + ':' + value; counts.set(key, (counts.get(key) || 0) + 1); }
  const compatible = all.filter(row => row.commandType === command && row.entityId === task.entityId && row.decision === task.status && exactId(row.id) && exactId(row.fileId) && exactId(row.actorId) && exactId(row.requestId) && task.reviewerIds.includes(row.actorId) && (!actorId || actorId === row.actorId) && counts.get('id:' + row.id) === 1 && counts.get('file:' + row.fileId) === 1 && counts.get('request:' + row.requestId) === 1);
  // A new service's response-only map is authoritative even when empty/unresolvable.
  if (options.bindings !== undefined) {
    if (!Array.isArray(options.bindings)) return undefined;
    const bound = compatible.filter(row => { const refs = options.bindings!.filter(ref => ref.signatureId === row.id); return refs.length === 1 && refs[0].reviewId === task.id && (row.reviewId === undefined || row.reviewId === task.id); });
    return bound.length === 1 ? bound[0] : undefined;
  }
  const link = (row: MistDecisionSignature) => {
    const facts = options.receipts?.filter(item => item.signatureId === row.id);
    if (facts && (facts.length !== 1 || facts[0].unresolved || facts[0].requestId !== row.requestId || facts[0].actorId !== row.actorId)) return { invalid: true };
    const fact = facts?.[0];
    if (row.reviewId !== undefined && !exactId(row.reviewId) || row.reviewId !== undefined && fact?.reviewId !== undefined && row.reviewId !== fact.reviewId) return { invalid: true };
    return { reviewId: row.reviewId ?? fact?.reviewId, revision: fact?.revision, invalid: false };
  };
  const bound = compatible.filter(row => { const ref = link(row); return !ref.invalid && ref.reviewId === task.id; });
  if (bound.length === 1) return bound[0];
  if (bound.length > 1) return undefined;
  const sameTasks = tasks.filter(item => REVIEW_SIGNATURE_COMMANDS[item.kind] === command && item.entityId === task.entityId && item.status === 'approved');
  if (task.kind !== 'order' || !task.id.startsWith('order:')) {
    const legacy = compatible.filter(row => { const ref = link(row); return !ref.invalid && ref.reviewId === undefined && actorId === row.actorId; });
    return sameTasks.length === 1 && exactId(actorId) && legacy.length === 1 ? legacy[0] : undefined;
  }
  const order = state.orders?.find(item => item.id === task.entityId), governance = order?.governance;
  if (!order || !governance || !Array.isArray(governance.rounds)) return undefined;
  const rounds = governance.rounds.filter(round => round.status === 'approved');
  const signatures = all.filter(row => row.commandType === command && row.entityId === order.id);
  if (!rounds.length || rounds.length !== signatures.length || sameTasks.length !== rounds.length || governance.effectiveVersion !== rounds.length || new Set(governance.rounds.map(round => round.id)).size !== governance.rounds.length || new Set(sameTasks.map(item => item.id)).size !== sameTasks.length || stableJson(governance.approvedSnapshot) !== stableJson(rounds.at(-1)!.snapshot) || governance.approvedBy !== rounds.at(-1)!.decidedBy) return undefined;
  if (new Set(signatures.map(row => row.id)).size !== signatures.length || new Set(signatures.map(row => row.fileId)).size !== signatures.length || new Set(signatures.map(row => row.requestId)).size !== signatures.length) return undefined;
  let previousRevision = -1;
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index], signature = signatures[index], ref = link(signature), reviewId = 'order:' + round.id;
    if (signature.decision !== 'approved' || !exactId(round.decidedBy) || signature.actorId !== round.decidedBy || !frozenRoster(round.reviewerIds) || !round.reviewerIds.includes(signature.actorId) || !sameTasks.some(item => item.id === reviewId) || round.snapshot.orderId !== order.id || round.snapshot.code !== order.code || !exactId(signature.id) || !exactId(signature.fileId) || !exactId(signature.requestId) || ref.invalid || ref.reviewId !== undefined && ref.reviewId !== reviewId) return undefined;
    // A single exact legacy source can be identified by actor/roster alone; multiple
    // rounds additionally require their durable commit sequence, never timestamps.
    if (rounds.length > 1 || options.receipts !== undefined) {
      if (!Number.isSafeInteger(ref.revision) || ref.revision! <= previousRevision) return undefined;
      previousRevision = ref.revision!;
    }
  }
  const index = rounds.findIndex(round => 'order:' + round.id === task.id);
  return index < 0 || !compatible.includes(signatures[index]) ? undefined : signatures[index];
}

const DECIDE_COMMANDS: ReadonlySet<string> = new Set(['order.governance.decide', 'fulfillment.procurement.decide', 'fulfillment.procurement.amend.decide', 'payable.request.decide', 'fulfillment.stock.count.decide']);
/** 需要签字的全部命令类型（批准类只在 approved 时需要，核销只在坏账 / 红冲时需要）。 */
export const SIGNATURE_COMMAND_TYPES: readonly string[] = [...DECIDE_COMMANDS, 'payable.settlement.confirm', 'finance.receivable.writeoff', 'rebate.claim.approve'];

export function mistCommandRequiresSignature(command: { type: string; payload?: any }): boolean {
  const payload = command?.payload;
  if (DECIDE_COMMANDS.has(command?.type)) return payload?.decision === 'approved';
  if (command?.type === 'finance.receivable.writeoff') return payload?.kind === 'badDebt' || payload?.kind === 'correction';
  return command?.type === 'payable.settlement.confirm' || command?.type === 'rebate.claim.approve';
}

/** 签字对应的业务记录：审批与结算按 payload.id，核销按 payload.invoiceId。 */
export function signatureEntityId(command: { type: string; payload?: any }): string {
  const p = command?.payload ?? {};
  const id = command.type === 'finance.receivable.writeoff' ? p.invoiceId : p.id ?? p.orderId ?? p.invoiceId;
  return typeof id === 'string' ? id : '';
}

export const SIGNATURE_MAX_BYTES = 64 * 1024;
const MAX_ELEMENTS = 4000, MAX_ABS = 10000, MAX_WIDTH = 40;
const invalid = (): never => { throw new MistCommandError('VALIDATION', '签字无效，请重新签字', 422); };
const NUM = '-?\\d{1,5}(?:\\.\\d{1,4})?';
const HEX = '#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}';
const HEAD = new RegExp(`^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="(${NUM}) (${NUM}) (${NUM}) (${NUM})" width="(${NUM})" height="(${NUM})" fill="none" stroke="(${HEX})" stroke-linecap="round" stroke-linejoin="round">`);
const PATH = new RegExp(`<path d="M(${NUM}) (${NUM})Q(${NUM}) (${NUM}) (${NUM}) (${NUM})" stroke-width="(${NUM})"/>`, 'y');
const CIRCLE = new RegExp(`<circle cx="(${NUM})" cy="(${NUM})" r="(${NUM})" fill="(${HEX})"/>`, 'y');
const TAIL = '</svg>';

function num(raw: string, min = -MAX_ABS, max = MAX_ABS): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) invalid();
  return n;
}
const fmt = (n: number) => { const v = Math.round(n * 100) / 100; return String(Object.is(v, -0) ? 0 : v); };

/**
 * 校验手写签字 SVG 并按解析出的数值重新生成。只认签字板的输出结构；脚本、链接、实体、其他标签或属性、空签字、超过 64 KB 一律拒绝。
 */
export function normalizeSignatureSvg(svg: unknown): string {
  if (typeof svg !== 'string' || !svg || svg.length > SIGNATURE_MAX_BYTES || new TextEncoder().encode(svg).length > SIGNATURE_MAX_BYTES) invalid();
  const source = svg as string;
  const head = HEAD.exec(source); if (!head) return invalid();
  const [vx, vy] = [num(head[1]), num(head[2])], [vw, vh] = [num(head[3], 0.1), num(head[4], 0.1)], [w, h] = [num(head[5], 0.1), num(head[6], 0.1)], ink = head[7];
  const body: string[] = [];
  let at = head[0].length;
  while (at < source.length - TAIL.length) {
    PATH.lastIndex = at; CIRCLE.lastIndex = at;
    const path = PATH.exec(source);
    if (path) {
      const d = path.slice(1, 7).map(v => fmt(num(v))), width = num(path[7], 0.01, MAX_WIDTH);
      body.push(`<path d="M${d[0]} ${d[1]}Q${d[2]} ${d[3]} ${d[4]} ${d[5]}" stroke-width="${fmt(width)}"/>`);
      at = PATH.lastIndex;
    } else {
      const circle = CIRCLE.exec(source); if (!circle) return invalid();
      const [cx, cy] = [num(circle[1]), num(circle[2])], r = num(circle[3], 0.01, MAX_WIDTH);
      body.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${circle[4]}"/>`);
      at = CIRCLE.lastIndex;
    }
    if (body.length > MAX_ELEMENTS) invalid();
  }
  if (!body.length || at !== source.length - TAIL.length || !source.endsWith(TAIL)) invalid();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}" width="${fmt(w)}" height="${fmt(h)}" fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">${body.join('')}</svg>`;
}

/** 签字记录是否给当前读者：签字人本人，或所签业务记录在读者的投影中可见。 */
export function decisionSignatureVisible(projected: MistState, row: MistDecisionSignature, actorId: string): boolean {
  if (row.actorId === actorId) return true;
  const has = (list: Array<{ id: string }> | undefined) => !!list?.some(item => item.id === row.entityId);
  switch (row.commandType) {
    case 'order.governance.decide': return orderDecisionSourceVisible(projected, row.entityId);
    case 'fulfillment.procurement.decide': return has(projected.fulfillment?.purchases);
    case 'fulfillment.procurement.amend.decide': return !!projected.fulfillment?.purchases?.some(p => has(p.amendments));
    case 'fulfillment.stock.count.decide': return has(projected.fulfillment?.stockCounts);
    case 'payable.request.decide': return has(projected.payables?.requests);
    case 'payable.settlement.confirm': return has(projected.payables?.settlements);
    case 'finance.receivable.writeoff': return has(projected.invoices);
    case 'rebate.claim.approve': return has(projected.exportRebate?.claims);
    default: return false;
  }
}

/** Composite approval IDs require an exact visible parent and actual child, never a prefix grant. */
function orderDecisionSourceVisible(projected: MistState, entityId: string): boolean {
  const orders = projected.orders || [], orderIds = new Set(orders.map(order => order.id));
  if (orderIds.has(entityId)) return true;
  for (const order of orders) {
    const cancellation = order.governance?.cancellation;
    if (cancellation?.id && entityId === order.id + '#cancel:' + cancellation.id) return true;
  }
  for (const line of (projected.orderLines || []) as ClosableLine[]) {
    if (!orderIds.has(line.orderId)) continue;
    if (line.closure && entityId === line.orderId + '#close:' + line.id) return true;
    if (line.overShips?.some(request => entityId === line.orderId + '#overship:' + request.id)) return true;
  }
  return false;
}
