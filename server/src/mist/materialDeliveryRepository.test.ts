import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as contract from '../shared/mistWorkspace';
import { materialDeliveryRows } from '../shared/mistInternalFabric';
import { materialDeliveryFixture } from './__tests__/materialDelivery';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';
import { MistPrivateFiles } from './files';
import { MistRepository } from './repository';

vi.mock('./context', () => ({ mistApprovalAuthority: async () => ({ supplier: {} }) }));
let directory: string, db: MemoryMistDatabase, auth: ReturnType<typeof testAuthority>, repo: MistRepository, workspaceId: string, f: ReturnType<typeof materialDeliveryFixture>;
const state = () => db.workspaces.get(workspaceId).state as contract.MistState;
const issue = (requestId: string, expectedRevision: number, quantity = 20) => ({ requestId, expectedRevision, command: { type: 'fulfillment.materials.issue' as const, payload: { id: f.state.fulfillment.stock[0].id, quantity, location: 'Factory', person: 'factory', note: 'Delivery', targetProductionId: f.productionId } } });
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-material-delivery-')); db = new MemoryMistDatabase(); auth = testAuthority();
  auth.users.get('owner')!.permissions.push('inventory:read', 'inventory:write');
  auth.users.set('garment', { active: true, permissions: ['orders:read', 'orders:write'] }); auth.users.set('warehouse', { active: true, permissions: ['inventory:read'] });
  repo = new MistRepository(db, contract, new MistPrivateFiles(directory), auth.authorize, () => new Date('2026-10-24T08:00:00Z'));
  workspaceId = (await repo.create(testActor(), { name: 'Material handover', seed: 'empty' })).id;
  f = materialDeliveryFixture(); db.workspaces.get(workspaceId).state = structuredClone(f.state);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('replays both physical issue and receiver confirmation exactly once', async () => {
  const first = await repo.execute(testActor(), workspaceId, issue('issue-1', 0));
  expect((await repo.execute(testActor(), workspaceId, issue('issue-1', 0))).replayed).toBe(true);
  expect(materialDeliveryRows(state())).toHaveLength(1);
  const id = first.receipt.result.id, confirm = { requestId: 'receive-1', expectedRevision: 1, command: { type: 'fulfillment.materials.confirm' as const, payload: { kind: 'issue' as const, id, evidence: 'Factory counted 20 metres' } } };
  await repo.execute(testActor('garment'), workspaceId, confirm);
  expect((await repo.execute(testActor('garment'), workspaceId, confirm)).replayed).toBe(true);
  expect(materialDeliveryRows(state())[0].delivery.confirmation).toMatchObject({ actorId: 'garment' }); expect(state().fulfillment.stock[0].available).toBe(80.3);
});

it('serializes competing issues and rolls inventory back if receipt persistence fails', async () => {
  const outcomes = await Promise.allSettled([repo.execute(testActor(), workspaceId, issue('compete-a', 0, 60)), repo.execute(testActor(), workspaceId, issue('compete-b', 0, 60))]);
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(materialDeliveryRows(state())).toHaveLength(1); expect(state().fulfillment.stock[0].available).toBe(40.3);
  const before = structuredClone(state()); db.failReceipt = true;
  await expect(repo.execute(testActor(), workspaceId, issue('rollback', 1, 5))).rejects.toThrow('transaction failed'); expect(state()).toEqual(before);
});

it('uses fresh write permissions and current receiving-account status before touching inventory', async () => {
  const before = structuredClone(state());
  await expect(repo.execute(testActor('warehouse'), workspaceId, issue('readonly', 0))).rejects.toMatchObject({ status: 403 });
  db.accounts.set('garment', { status: 'disabled' });
  await expect(repo.execute(testActor(), workspaceId, issue('disabled-receiver', 0))).rejects.toThrow('停用');
  expect(state()).toEqual(before);
});
