import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

export class DemandError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.statusCode = status; }
  readonly statusCode: number;
}
const fail = (code: string, message: string, status = 400): never => { throw new DemandError(code, message, status); };
const id = (prefix: string) => `${prefix}_${randomUUID()}`;

/** Unit-cost BOM lines become unresolved needs, never executable total quantities. */
export async function createDemandsFromBOM(prisma: PrismaClient, bomId: string) {
  return prisma.$transaction(async (tx: any) => {
    const bom = await tx.bOM.findUnique({ where: { id: bomId }, include: { lines: true } });
    if (!bom || bom.deletedAt || bom.status !== 'Confirmed') fail('INVALID_BOM', 'BOM不存在或尚未确认');
    const now = Date.now();
    if (bom.parentBomId) {
      const old = await tx.procurementDemand.findMany({ where: { bomId: bom.parentBomId, allocations: { none: { status: 'Active' } } } });
      for (const demand of old) await tx.procurementDemand.update({ where: { id: demand.id }, data: { status: 'Superseded', revision: { increment: 1 }, updatedAt: now } });
    }
    const demands = [];
    for (const l of bom.lines) {
      demands.push(await tx.procurementDemand.upsert({ where: { sourceKey: `bom:${bom.id}:${bom.version}:${l.id}` }, update: {}, create: { id: id('PD'), sourceKey: `bom:${bom.id}:${bom.version}:${l.id}`, bomId: bom.id, bomLineId: l.id, bomVersion: bom.version, orderId: bom.orderId, description: l.description, unit: l.unit, perOutputQuantity: l.effectiveQty, quantityBasis: 'PerOutput', status: 'NeedsConfirmation', createdAt: now, updatedAt: now } }));
    }
    return { demandIds: demands.map(d => d.id), lineCount: demands.length };
  });
}
