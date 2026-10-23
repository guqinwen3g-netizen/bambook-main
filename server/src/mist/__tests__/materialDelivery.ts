import { applyMistCommand, createMistState, type MistCommand, type MistContext } from '../../shared/mistWorkspace';
import { createOrderGovernance } from '../../shared/mistOrderGovernance';

/** In-memory business fixtures; the QC record isolates delivery guards from the separately tested QC workflow. */
export function materialDeliveryFixture(quantity = 100.3, warehouse = true) {
  let serial = 0;
  const now = '2026-10-24T08:00:00Z', members: NonNullable<MistContext['members']> = [
    { id: 'owner', name: 'Fabric', active: true, groups: ['fabric'] }, { id: 'garment', name: 'Garment', active: true, groups: ['garment'] },
    { id: 'reviewer', name: 'Leader', active: true, groups: ['fabric', 'garment'] }, { id: 'warehouse', name: 'Warehouse', active: true, groups: [] },
  ];
  const context: MistContext = { id: () => `material-${++serial}`, now, actorId: 'owner', actorName: 'Fabric', members, authority: { orderReviewerIds: { fabric: ['reviewer'], garment: ['reviewer'] }, supplier: { 'supplierCommitment.approvers.purchase.fabric': { version: 1, userIds: ['reviewer'] }, 'supplierCommitment.approvers.processing.garment': { version: 1, userIds: ['reviewer'] } } } };
  const actor = (id: string) => ({ ...context, actorId: id, actorName: members.find(m => m.id === id)!.name });
  let state = createMistState(context, 'empty');
  const run = (command: MistCommand, id = 'owner') => { const result = applyMistCommand(state, command, actor(id)); state = result.state; return result.result; };
  const create = (type: 'fabric' | 'garment') => {
    const ownerId = type === 'fabric' ? 'owner' : 'garment';
    const orderId = run({ type: 'order.create', payload: { type, customerId: '', currency: 'CNY', season: 'AW27', due: '2026-12-01', ownerId,
      governance: { ...createOrderGovernance(context).contract, kind: 'internal', internalPurpose: 'Supply', receiver: 'Garment', paymentMethod: 'OTHER', depositPercent: 0, preShipmentPercent: 0, paymentNote: 'Internal', incoterm: 'EXW', deliveryPlace: 'Factory', ...(type === 'fabric' ? { internalSupply: { group: 'garment', receiverId: 'garment' } } : {}) },
      lines: [{ name: type === 'fabric' ? 'Twill' : 'Jacket', style: type, img: 'clay', qty: type === 'fabric' ? quantity : 10, unit: type === 'fabric' ? '米' : '件', price: 100, ...(type === 'garment' ? { fulfillmentMode: 'full_package', cmtIncludedItems: [] } : {}) }] } }, ownerId).orderId!;
    run({ type: 'order.governance.submit', payload: { orderId } }, ownerId); run({ type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: 'Checked' } }, 'reviewer');
    return { orderId, lineId: state.orderLines.find(l => l.orderId === orderId)!.id };
  };
  const source = create('fabric'), target = create('garment');
  run({ type: 'order.fabric.allocate', payload: { ...target, fabricOrderId: source.orderId, fabricLineId: source.lineId, metres: String(quantity), expectedRevision: 0 } }, 'garment');
  for (const [id, type] of [['mill', '面料贸易'], ['factory', '成衣加工']]) state.market.suppliers.push({ id, code: id, name: id, type, country: 'CN', address: '', capabilities: 'Supply', capacity: 1000, capacityUnit: '件', leadDays: 10, status: 'active', blockReason: '', contacts: [], fileIds: [], note: '', createdAt: now, updatedAt: now });
  const purchase = (kind: 'finished' | 'processing', reference = kind === 'finished' ? source : target) => {
    const id = run({ type: 'fulfillment.procurement.save', payload: { ...reference, kind, supplierId: kind === 'finished' ? 'mill' : 'factory', supplier: '', description: kind, quantity: kind === 'finished' ? quantity : 10, unit: kind === 'finished' ? '米' : '件', price: kind === 'finished' ? 68 : 2, currency: 'CNY', due: '2026-11-20', terms: 'After acceptance', destination: 'Warehouse', note: '', fileIds: [] } }, kind === 'finished' ? 'owner' : 'garment').id!;
    const buyer = kind === 'finished' ? 'owner' : 'garment';
    run({ type: 'fulfillment.procurement.submit', payload: { id } }, buyer); run({ type: 'fulfillment.procurement.decide', payload: { id, decision: 'approved', note: 'Checked' } }, 'reviewer');
    run({ type: 'fulfillment.procurement.send', payload: { id, at: now, evidence: 'Sent', fileIds: [] } }, buyer); run({ type: 'fulfillment.procurement.confirm', payload: { id, at: now, confirmedDue: '2026-11-20', evidence: 'Accepted', fileIds: [] } }, buyer);
    return id;
  };
  const purchaseId = purchase('finished'), processingId = purchase('processing'), productionId = state.productions.find(p => p.sourcePurchaseId === processingId)!.id;
  const sourceProduction = state.productions.find(p => p.sourcePurchaseId === purchaseId)!;
  if (warehouse) run({ type: 'fulfillment.procurement.receive', payload: { id: purchaseId, quantity, rejected: 0, destination: 'warehouse', location: 'A-01', date: '2026-10-24', evidence: 'Received', fileIds: [] } });
  const fact = state.fulfillment.productionFacts.find(f => f.productionId === sourceProduction.id)!;
  state.fulfillment.qcTasks.push({ id: 'fabric-qc', code: 'QC-F', source: { kind: 'orderLine', ...source, productionId: sourceProduction.id }, domain: 'fabric', kind: 'production', factory: 'mill', location: 'A-01', contact: '', due: '2026-10-24', requestedBy: 'Fabric', assignee: 'QC', assigneeId: 'qc', state: 'reported', reportIds: ['fabric-report'], createdAt: now });
  state.fulfillment.qcReports.push({ id: 'fabric-report', taskId: 'fabric-qc', result: 'pass', report: 'FABRIC-PASS', opinion: 'Checked', measurements: [], fileIds: [], reviewer: 'QC', reviewedAt: now, scopeRevision: fact.revision });
  state.memberIds = ['garment', 'reviewer', 'warehouse']; state.members = state.memberIds.map(userId => ({ userId, name: userId, addedBy: 'owner', addedByName: 'Fabric', addedAt: now }));
  state.memberGroups = members.map(m => ({ userId: m.id, name: m.name, groups: m.groups, updatedAt: now, updatedBy: 'owner' }));
  const issue = (amount = quantity, id = 'owner', branch = productionId) => run({ type: 'fulfillment.materials.issue', payload: { id: state.fulfillment.stock[0].id, quantity: amount, location: 'Factory warehouse', person: 'factory', note: 'Delivery note', targetProductionId: branch } }, id).id!;
  return { actor, context, run, create, purchase, source, target, purchaseId, processingId, productionId, sourceProductionId: sourceProduction.id, issue, get state() { return state; } };
}
