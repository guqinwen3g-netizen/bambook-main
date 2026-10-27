import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import type { FulfillmentShipment } from '../../../../server/src/shared/mistFulfillment';

export type ShipmentStage = 'intake' | 'logistics' | 'business' | 'departure' | 'departed' | 'cancelled';
/** Logistics workbench stage derived only from recorded facts (packing, booking, documents, customs, dispatch, departure). */
export function shipmentStage(root: MistState, s: FulfillmentShipment): ShipmentStage {
  if (s.state === 'cancelled') return 'cancelled';
  if (s.state === 'departed') return 'departed';
  if (s.state === 'ready') return s.documentsSentAt ? 'departure' : 'business';
  const f = root.fulfillment;
  const touched = !!s.booking || f.packing.some(row => row.shipmentId === s.id) || f.documents.some(row => row.shipmentId === s.id && row.status !== 'void') || f.customs.some(row => row.shipmentId === s.id);
  return touched ? 'logistics' : 'intake';
}
