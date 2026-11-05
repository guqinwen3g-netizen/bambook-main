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

export type MistDecisionSignature = {
  id: string; commandType: string; entityId: string; decision?: string;
  /** 归档的签字 SVG（私有文件，image/svg+xml）。 */
  fileId: string;
  actorId: string; actor: string; at: string; requestId: string;
};

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
    case 'order.governance.decide': return has(projected.orders);
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
