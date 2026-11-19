import type { MistEvent, MistOrder } from './mistWorkspace';

/** Written only by a resolved split/merge command. No names, costs or prose-derived identities. */
export type MistOrderFlow = {
  action: 'split' | 'merge'; sourceOrderId: string; targetOrderId: string;
  lines: Array<{ sourceLineId: string; targetLineId: string; quantity: number; unit: string }>;
};
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value;

/** Current projection is authoritative: a former counterpart does not grant continuing access. */
export function visibleOrderFlow(event: Pick<MistEvent, 'entityType' | 'entityId' | 'orderFlow'>, orders: readonly Pick<MistOrder, 'id'>[]): MistOrderFlow | undefined {
  const flow = event.orderFlow;
  if (event.entityType !== 'order' || !flow || !['split', 'merge'].includes(flow.action) || !id(flow.sourceOrderId) || !id(flow.targetOrderId) || flow.sourceOrderId === flow.targetOrderId || ![flow.sourceOrderId, flow.targetOrderId].includes(event.entityId)) return undefined;
  if (orders.filter(order=>order.id===flow.sourceOrderId).length!==1 || orders.filter(order=>order.id===flow.targetOrderId).length!==1 || !Array.isArray(flow.lines) || !flow.lines.length || flow.lines.length > 200) return undefined;
  const sources = new Set<string>(), targets = new Set<string>();
  const lines: MistOrderFlow['lines'] = [];
  for (const line of flow.lines) {
    if (!line || !id(line.sourceLineId) || !id(line.targetLineId) || sources.has(line.sourceLineId) || targets.has(line.targetLineId) || !Number.isFinite(line.quantity) || line.quantity <= 0 || Math.round(line.quantity * 10000) / 10000 !== line.quantity || typeof line.unit !== 'string' || !line.unit.trim() || line.unit !== line.unit.trim() || line.unit.length > 40 || flow.action === 'merge' && line.sourceLineId !== line.targetLineId) return undefined;
    sources.add(line.sourceLineId); targets.add(line.targetLineId);
    // Whitelist even for full-company readers; extra imported price/cost fields are never a read channel.
    lines.push({ sourceLineId: line.sourceLineId, targetLineId: line.targetLineId, quantity: line.quantity, unit: line.unit });
  }
  return { action: flow.action, sourceOrderId: flow.sourceOrderId, targetOrderId: flow.targetOrderId, lines };
}

/** Response-only sanitisation; old records remain unchanged and never acquire inferred references. */
export function projectOrderFlowEvents(events: readonly MistEvent[], orders: readonly Pick<MistOrder, 'id'>[]): MistEvent[] {
  return events.map(event => {
    if (!event.orderFlow) return event;
    const { orderFlow: _untrusted, ...ordinary } = event;
    const flow = visibleOrderFlow(event, orders);
    return flow ? { ...ordinary, orderFlow: flow } : ordinary;
  });
}
