import type { MistContext, MistNotification, MistState, MistTarget } from './mistWorkspace';

/** Only explicit account relationships can address a bell notification. Never infer IDs from names or roles. */
export function notifyMist(root: MistState, context: MistContext, notification: Omit<MistNotification, 'id' | 'at' | 'readAt' | 'readBy' | 'recipientIds'>, recipients: readonly (string | undefined)[] = []) {
  const recipientIds = [...new Set(recipients.filter((id): id is string => !!id && id !== context.actorId))];
  if (!recipientIds.length) return;
  root.notifications.unshift({ ...notification, id: context.id(), at: context.now, readAt: null, recipientIds });
}

/** Source owners and process initiators, for callers that have a real business handoff/change to report. */
export function notificationOwners(root: MistState, entity: string, id: string): string[] {
  const ids = new Set<string>();
  const add = (value?: string) => { if (value) ids.add(value); };
  const order = (orderId?: string) => add(root.orders.find(row => row.id === orderId)?.ownerId);
  const development = (devId?: string) => add(root.devs.find(row => row.id === devId)?.ownerId);
  const purchase = (purchaseId?: string) => {
    const row = root.fulfillment.purchases.find(row => row.id === purchaseId);
    if (row) { add(row.requesterId); order(row.orderId); }
  };
  const shipment = (shipmentId?: string) => {
    const row = root.fulfillment.shipments.find(row => row.id === shipmentId);
    if (row) { add(row.requesterId); row.lines.forEach(line => order(line.orderId)); }
  };
  if (entity === 'order') order(id);
  if (entity === 'development') development(id);
  if (entity === 'customer') add(root.customers.find(row => row.id === id)?.ownerId);
  if (entity === 'production') order(root.productions.find(row => row.id === id)?.orderId);
  if (entity === 'procurement') purchase(id);
  if (entity === 'shipment') shipment(id);
  if (entity === 'customs') shipment(root.fulfillment.customs.find(row => row.id === id)?.shipmentId);
  if (entity === 'inventory') {
    const row = root.fulfillment.stock.find(row => row.id === id);
    if (row) { order(row.orderId); purchase(row.purchaseId); }
  }
  if (entity === 'qc') {
    const row = root.fulfillment.qcTasks.find(row => row.id === id);
    if (row) {
      add(row.requesterId);
      if (row.source.kind === 'version') development(row.source.devId); else order(row.source.orderId);
      const stockId = row.incoming?.stockId ?? row.quarantine?.stockId;
      purchase(root.fulfillment.stock.find(stock => stock.id === stockId)?.purchaseId);
    }
  }
  if (entity === 'invoice') {
    const row = root.invoices.find(row => row.id === id);
    if (row) {
      order(row.orderId); development(row.devId); add(row.issuedById); add(row.opening?.registeredById);
      add(root.customers.find(customer => customer.id === row.customerId)?.ownerId);
      add(root.sampleRequests?.find(request => request.id === row.sampleRequestId)?.requesterId);
    }
  }
  if (entity === 'claim') {
    const row = root.platform.claims.find(row => row.id === id);
    if (row) { order(row.orderId); row.coordination?.notices.forEach(notice => add(notice.byId)); row.dispositions.filter(d => !d.supersededById && d.state !== 'Cancelled').forEach(d => add(d.requesterId)); }
  }
  return [...ids];
}

export function notificationTargetOwners(root: MistState, target: MistTarget): string[] {
  const entity = ({ 'orders/detail': 'order', 'development/detail': 'development', 'production-board': 'production', shipments: 'shipment', procurement: 'procurement', invoices: 'invoice', claims: 'claim', 'qc-workbench': 'qc' } as Record<string, string>)[target.view];
  return entity && target.id ? notificationOwners(root, entity, target.id) : [];
}
