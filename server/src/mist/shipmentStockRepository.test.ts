import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import { materialDeliveryFixture } from './__tests__/materialDelivery';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';
import { MistPrivateFiles } from './files';
import { MistRepository } from './repository';
vi.mock('./context', () => ({ mistApprovalAuthority: async () => ({ supplier: {} }) }));
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'shipment-stock-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it('enforces current inventory permission and source visibility when linking an existing issue', async () => {
  const company = '11111111-1111-4111-8111-111111111111', db = new MemoryMistDatabase(), auth = testAuthority(), f = materialDeliveryFixture(20), wid = randomUUID();
  const stock = f.state.fulfillment.stock[0], order = f.state.orders.find(o => o.id === f.source.orderId)!;
  order.governance!.contract.kind = 'external'; delete order.governance!.contract.internalSupply;
  stock.available = 0;
  f.state.fulfillment.stockMovements.push({ id: 'issue-test', stockId: stock.id, kind: 'issue', quantity: 20, location: 'warehouse', person: 'logistics', note: 'issue', at: f.context.now, actor: 'owner' });
  f.state.fulfillment.shipments.push({ id: 'shipment-test', code: 'SHP-TEST', state: 'departed', lines: [{ orderId: f.source.orderId, lineId: f.source.lineId, productionId: f.sourceProductionId, quantity: 20, factoryConfirmedAt: '2026-10-24' }], customer: 'test', customerId: '', domain: 'fabric', consignee: 'test', mode: 'sea', portOfLoading: 'Shanghai', portOfDischarge: 'London', incoterm: 'FOB', plannedDate: '', booking: '', note: '', fileIds: [], requestedBy: 'owner', requesterId: 'owner', createdAt: f.context.now });
  auth.users.set('owner', { active: true, permissions: ['inventory:read', 'orders:read'] });
  auth.users.set('garment', { active: true, permissions: ['inventory:read', 'inventory:write', 'orders:read'] });
  for (const id of ['owner', 'garment']) { db.companyMembers.push({ companyId: company, userId: id, status: 'active' }); db.accounts.set(id, { status: 'active', displayName: id }); }
  db.workspaces.set(wid, { id: wid, ownerId: 'boss', companyId: company, slug: `company@${company}`, name: '公司', revision: 0, state: structuredClone(f.state), createdAt: new Date(), updatedAt: new Date() });
  const repo = new MistRepository(db, contract, new MistPrivateFiles(dir), auth.authorize, () => new Date(f.context.now));
  const input = { requestId: 'link-1', expectedRevision: 0, command: { type: 'fulfillment.inventory.shipment.link' as const, payload: { issueId: 'issue-test', shipmentId: 'shipment-test', evidence: '核对原出库与装箱单' } } };
  const actor = { ...testActor('owner'), roles: [], companyId: company };
  await expect(repo.execute(actor, wid, input)).rejects.toMatchObject({ status: 403 });
  const outsider = { ...testActor('garment'), roles: [], companyId: company };
  await expect(repo.execute(outsider, wid, { ...input, requestId: 'link-outside' })).rejects.toMatchObject({ status: 404 });
  auth.users.get('owner')!.permissions.push('inventory:write');
  await repo.execute(actor, wid, input);
  expect((await repo.get(actor, wid)).state.fulfillment.stockMovements.find(m => m.id === 'issue-test')?.shipmentLink).toMatchObject({ shipmentId: 'shipment-test' });
});
