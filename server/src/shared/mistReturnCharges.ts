/**
 * sup19: money owed back by the supplier on a goods return (deduction plus supplier-borne return freight), not yet carried by a
 * pending or confirmed settlement of the purchase. Cancelled or returned settlements release them again, like QC chargebacks.
 */
import type { MistState } from './mistWorkspace';

export type ReturnCharge = { id: string; receiptId: string; description: string; amount: number };
export function openReturnCharges(root: MistState, purchaseId: string): ReturnCharge[] {
  const carried = new Set((root.payables?.settlements || []).filter(s => s.purchaseId === purchaseId && (s.state === 'pending' || s.state === 'confirmed')).flatMap(s => s.disputes.map(d => d.returnId).filter(Boolean)));
  const out: ReturnCharge[] = [];
  for (const receipt of root.fulfillment?.receipts || []) {
    if (receipt.purchaseId !== purchaseId) continue;
    for (const r of receipt.returns || []) {
      if (r.reversed || carried.has(r.id)) continue;
      const amount = Math.round(((r.deduction || 0) + (r.freightBy === 'supplier' ? r.freight || 0 : 0)) * 100) / 100;
      if (amount <= 0) continue;
      const parts = [r.deduction ? `扣款 ${r.deduction}` : '', r.freightBy === 'supplier' && r.freight ? `运费 ${r.freight}` : ''].filter(Boolean).join(' + ');
      out.push({ id: r.id, receiptId: receipt.id, amount, description: `退货${r.returnNo ? ' ' + r.returnNo : ''} ${r.quantity}：${parts}` });
    }
  }
  return out;
}
