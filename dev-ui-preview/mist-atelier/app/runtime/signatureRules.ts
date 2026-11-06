/** 合同与资金类批准须当场手写签字（2026-11-05 用户定案）。与服务端 mistCommandRequiresSignature 同一清单；服务端独立校验，此处只决定界面是否出现签字板。 */
const APPROVAL_DECISIONS = new Set(['order.governance.decide', 'fulfillment.procurement.decide', 'fulfillment.procurement.amend.decide', 'payable.request.decide', 'fulfillment.stock.count.decide']);
export function commandRequiresSignature(command: { type: string; payload?: unknown } | undefined | null): boolean {
  if (!command) return false;
  const payload = (command.payload ?? {}) as { decision?: unknown; kind?: unknown };
  if (APPROVAL_DECISIONS.has(command.type)) return payload.decision === 'approved';
  if (command.type === 'finance.receivable.writeoff') return payload.kind === 'badDebt' || payload.kind === 'correction';
  return command.type === 'payable.settlement.confirm' || command.type === 'rebate.claim.approve';
}
