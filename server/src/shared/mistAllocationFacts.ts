import type { MistAllocation, MistState } from './mistWorkspace';
import { mistBusinessDate } from './mistBusinessClock';

/** Active rows and reversal snapshots are one immutable allocation history. */
export function allocationFacts(root: Pick<MistState, 'allocations' | 'financeReversals'>): MistAllocation[] {
  const rows = new Map((root.allocations || []).map(a => [a.id, a]));
  for (const reversal of root.financeReversals || []) {
    if (reversal.kind === 'allocation' && reversal.allocation && !rows.has(reversal.allocation.id)) {
      rows.set(reversal.allocation.id, reversal.allocation);
    }
  }
  return [...rows.values()].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
}

/** Legacy rows without a registration instant retain their receipt date. */
export const allocationDate = (allocation: MistAllocation, receiptDate: string) =>
  allocation.createdAt ? mistBusinessDate(allocation.createdAt) : receiptDate;
