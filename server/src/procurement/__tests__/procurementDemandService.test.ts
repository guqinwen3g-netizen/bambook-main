import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createDemandsFromBOM } from '../procurementDemandService';
import { validatePurchaseLines } from '../procurementService';

function fixture() {
  const tx: any = {
    procurementDemand: {
      findMany: vi.fn(async () => [{ id: 'D1' }]),
      update: vi.fn(async ({ data }) => data),
      upsert: vi.fn(async ({ create }) => create),
    },
    purchaseOrder: { create: vi.fn() },
    bOM: { findUnique: vi.fn() },
  };
  const prisma: any = { ...tx, $transaction: vi.fn(async fn => fn(tx)) };
  return { tx, prisma };
}

describe('procurement demand from BOM', () => {
  it('L7 preserves per-output requirement but never creates PO or assumes total/output line', async () => {
    const f=fixture();f.tx.bOM.findUnique.mockResolvedValue({id:'B1',version:2,status:'Confirmed',orderId:'O1',lines:[{id:'BL1',description:'Fabric',unit:'M',effectiveQty:new Prisma.Decimal('1.575')}]});
    await createDemandsFromBOM(f.prisma,'B1');
    expect(f.tx.procurementDemand.upsert.mock.calls[0][0]).toMatchObject({where:{sourceKey:'bom:B1:2:BL1'},create:{status:'NeedsConfirmation',quantityBasis:'PerOutput'}});
    const created=f.tx.procurementDemand.upsert.mock.calls[0][0].create;
    expect(created.requiredQuantity).toBeUndefined();expect(created.orderLineId).toBeUndefined();expect(f.tx.purchaseOrder.create).not.toHaveBeenCalled();
  });
  it('new BOM supersedes unallocated old requirements without replacing purchased facts', async()=>{
    const f=fixture();f.tx.bOM.findUnique.mockResolvedValue({id:'B2',parentBomId:'B1',status:'Confirmed',version:2,lines:[]});
    await createDemandsFromBOM(f.prisma,'B2');
    expect(f.tx.procurementDemand.findMany).toHaveBeenCalledWith({where:{bomId:'B1',allocations:{none:{status:'Active'}}}});
    expect(f.tx.procurementDemand.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'Superseded'})}));
  });
  it('permits zero price draft but rejects blank or negative/NaN purchase lines', () => {
    const good={description:'布料',quantity:2,unit:'M',unitPrice:0};expect(()=>validatePurchaseLines([good])).not.toThrow();
    for(const bad of [[],[{...good,quantity:-1}],[{...good,quantity:NaN}],[{...good,description:''}],[{...good,unitPrice:-1}]]) expect(()=>validatePurchaseLines(bad)).toThrow();
  });
});
