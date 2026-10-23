import { applyMistCommand, type MistCommand, type MistContext, type MistState } from './mistWorkspace';

/** Seed-only supply plans use the same company, approval and allocation commands as live work. */
export function seedInternalFabricPlan(initial: MistState, contexts: { fabric: MistContext; garment: MistContext; reviewer: MistContext }, orderId: string, plans: Array<{ lineId: string; name: string; style: string; metres: number }>) {
  let state = initial;
  const run = (command: MistCommand, context: MistContext) => { const next = applyMistCommand(state, command, context); state = next.state; return next.result; };
  const order = state.orders.find(row => row.id === orderId);
  if (!order || order.type !== 'garment' || !order.ownerId) throw new Error('Internal supply seed requires a garment order owner');
  const fabricOrderId = run({ type: 'order.create', payload: {
    type: 'fabric', customerId: '', season: order.season, currency: order.currency, due: order.due, ownerId: contexts.fabric.actorId!,
    governance: { kind: 'internal', poNumber: '', confirmationFileIds: [], internalPurpose: '成衣面料供给', receiver: '', internalSupply: { group: 'garment', receiverId: order.ownerId }, paymentMethod: 'OTHER', depositPercent: 0, preShipmentPercent: 0, paymentNote: '内部供给，不对外收款', incoterm: 'EXW', deliveryPlace: '成衣工厂' },
    lines: plans.map(plan => ({ name: plan.name, style: plan.style, qty: plan.metres, unit: '米', price: 0, img: 'clay' as const })),
  } }, contexts.fabric).orderId!;
  run({ type: 'order.governance.submit', payload: { orderId: fabricOrderId } }, contexts.fabric);
  run({ type: 'order.governance.decide', payload: { id: fabricOrderId, decision: 'approved', note: '核对成衣条目、面料规格与计划米数' } }, contexts.reviewer);
  const fabricLines = state.orderLines.filter(row => row.orderId === fabricOrderId);
  for (const [index, plan] of plans.entries()) run({ type: 'order.fabric.allocate', payload: { orderId, lineId: plan.lineId, fabricOrderId, fabricLineId: fabricLines[index].id, metres: String(plan.metres), expectedRevision: 0 } }, contexts.garment);
  return { state, fabricOrderId, fabricLineIds: fabricLines.map(line => line.id) };
}
