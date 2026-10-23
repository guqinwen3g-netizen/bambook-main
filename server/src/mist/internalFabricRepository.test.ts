import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MistRepository } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';
import * as contract from '../shared/mistWorkspace';
import { createOrderGovernance } from '../shared/mistOrderGovernance';
import { internalFabricRemaining } from '../shared/mistInternalFabric';

vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{},orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}})}));
vi.mock('../auth/tokenHelpers',()=>({loadUserWithRoles:async(_db:unknown,id:string)=>({id,status:'active',deletedAt:null}),buildLoadedAuthTokenPayload:async(_db:unknown,user:{id:string})=>({userId:user.id,permissions:['orders:write'],roles:[],departmentIds:[]})}));

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'mist-fabric-allocation-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function approvedPlans() {
  let serial = 0;
  const context: contract.MistContext = { id: () => `allocation-${++serial}`, now: '2026-10-24T08:00:00Z', actorId: 'owner', actorName: 'Owner',
    members: [
      { id: 'owner', name: 'Owner', active: true, groups: ['fabric', 'garment'] },
      { id: 'sales', name: 'Sales', active: true, groups: ['garment'] },
      { id: 'reviewer', name: 'Reviewer', active: true, groups: ['fabric', 'garment'] },
    ], authority: { supplier: {}, orderReviewerIds: { fabric: ['reviewer'], garment: ['reviewer'] } } };
  let state = contract.createMistState(context, 'empty');
  const run = (command: contract.MistCommand, actorId = 'owner') => { const out = contract.applyMistCommand(state, command, { ...context, actorId }); state = out.state; return out.result; };
  const create = (type: 'garment' | 'fabric') => {
    const input = { ...createOrderGovernance(context).contract, kind: 'internal' as const, internalPurpose: 'Production supply', receiver: 'Garment team', depositPercent: 0, paymentNote: 'Internal allocation', incoterm: 'EXW', deliveryPlace: 'Factory', ...(type === 'fabric' ? { internalSupply: { group: 'garment' as const, receiverId: 'owner' } } : {}) };
    const orderId = run({ type: 'order.create', payload: { type, customerId: '', season: 'AW27', currency: 'CNY', due: '2026-12-01', ownerId: 'owner', governance: input, lines: [{ name: 'Supply', style: type, img: 'clay', qty: type === 'fabric' ? .3 : 1, unit: type === 'fabric' ? '米' : '件', price: 1, ...(type === 'garment' ? { fulfillmentMode: 'full_package' as const, cmtIncludedItems: [] } : {}) }] } }).orderId!;
    run({ type: 'order.governance.submit', payload: { orderId } });
    run({ type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: 'Checked' } }, 'reviewer');
    return { orderId, lineId: state.orderLines.find(line => line.orderId === orderId)!.id };
  };
  const source = create('fabric'), targets = [create('garment'), create('garment')];
  state.memberIds = ['sales', 'reviewer', 'viewer'];
  state.members = state.memberIds.map(userId => ({ userId, name: userId, addedBy: 'owner', addedByName: 'Owner', addedAt: context.now }));
  state.memberGroups = context.members!.map(member => ({ userId: member.id, name: member.name, groups: member.groups, updatedAt: context.now, updatedBy: 'owner' }));
  return { state, source, targets };
}

it('rechecks current members inside the approval-center transaction and preserves the pending request on rejection',async()=>{
  const db=new MemoryMistDatabase(),auth=testAuthority();auth.users.get('owner')!.permissions.push('orders:read','orders:write');auth.users.set('reviewer',{active:true,permissions:['orders:read','orders:write']});
  const repo=new MistRepository(db,contract,new MistPrivateFiles(directory),auth.authorize,()=>new Date('2026-10-24T08:00:00Z'));
  const workspace=await repo.create(testActor(),{name:'Internal supply review',seed:'empty'}),f=approvedPlans(),source=f.state.orders.find(o=>o.id===f.source.orderId)!;
  source.governance=createOrderGovernance({id:()=>'',now:'2026-10-24T08:00:00Z',actorName:'Owner'},source.governance!.contract);db.workspaces.get(workspace.id).state=f.state;
  const submitted=await repo.execute(testActor(),workspace.id,{requestId:'submit-internal-supply',expectedRevision:0,command:{type:'order.governance.submit',payload:{orderId:source.id}}});
  const review=(await repo.listReviews(testActor('reviewer'))).find((task:{entityId:string})=>task.entityId===source.id)!;
  const before=structuredClone(db.workspaces.get(workspace.id));db.accounts.set('owner',{status:'disabled'});
  await expect(repo.decideReview(testActor('reviewer'),workspace.id,review.id,{requestId:'disabled-supply-owner',expectedRevision:submitted.workspace.revision,decision:'approved',note:'Review supply'})).rejects.toThrow('停用');
  expect(db.workspaces.get(workspace.id)).toEqual(before);
  db.accounts.set('owner',{status:'active'});
  const input={requestId:'approve-internal-supply',expectedRevision:submitted.workspace.revision,decision:'approved' as const,note:'Supply owner and receiver checked'};
  const approved=await repo.decideReview(testActor('reviewer'),workspace.id,review.id,input);
  expect(approved.receipt.result.orderId).toBe(source.id);
  expect(db.workspaces.get(workspace.id).state.orders.find((o:{id:string})=>o.id===source.id).governance.status).toBe('approved');
  expect((await repo.decideReview(testActor('reviewer'),workspace.id,review.id,input)).replayed).toBe(true);
});

it('serializes competing allocations, replays once, rolls back receipt failures and checks current access', async () => {
  const db = new MemoryMistDatabase(), auth = testAuthority();
  auth.users.get('owner')!.permissions.push('orders:read', 'orders:write');
  auth.users.set('sales', { active: true, permissions: ['orders:read', 'orders:write'] });
  auth.users.set('viewer', { active: true, permissions: ['orders:read'] });
  const repo = new MistRepository(db, contract, new MistPrivateFiles(directory), auth.authorize, () => new Date('2026-10-24T08:00:00Z'));
  const workspace = await repo.create(testActor(), { name: 'Allocation fixture', seed: 'empty' });
  const fixture = approvedPlans(); db.workspaces.get(workspace.id).state = fixture.state;
  const requests = fixture.targets.map((target, i) => ({ requestId: `competing-${i}`, expectedRevision: 0, command: { type: 'order.fabric.allocate' as const, payload: { ...target, fabricOrderId: fixture.source.orderId, fabricLineId: fixture.source.lineId, metres: '0.2', expectedRevision: 0 } } }));
  const actors = [testActor(), testActor('sales')];
  const results = await Promise.allSettled(requests.map((request, i) => repo.execute(actors[i], workspace.id, request)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const won = results.findIndex(result => result.status === 'fulfilled'), lost = 1 - won;
  const saved = await repo.get(testActor(), workspace.id);
  expect(internalFabricRemaining(saved.state, fixture.source.lineId)).toBe('0.1');
  const replay = await repo.execute(actors[won], workspace.id, requests[won]);
  expect(replay.replayed).toBe(true); expect(replay.workspace.state.internalFabricAllocations).toHaveLength(1);
  await expect(repo.execute(actors[lost], workspace.id, { ...requests[lost], expectedRevision: saved.revision })).rejects.toThrow('余量');
  const before = await repo.get(testActor(), workspace.id), receipts = db.receipts.size;
  db.failReceipt = true;
  await expect(repo.execute(testActor(), workspace.id, { requestId: 'rollback-allocation', expectedRevision: before.revision, command: { ...requests[lost].command, payload: { ...requests[lost].command.payload, metres: '0.1' } } })).rejects.toThrow('transaction failed');
  db.failReceipt = false;
  expect(await repo.get(testActor(), workspace.id)).toEqual(before); expect(db.receipts.size).toBe(receipts);
  await expect(repo.execute(testActor('viewer'), workspace.id, { ...requests[lost], requestId: 'read-only-denied', expectedRevision: before.revision })).rejects.toMatchObject({ status: 403 });
  db.accounts.set('sales', { status: 'disabled' });
  const allocation = before.state.internalFabricAllocations![0];
  await expect(repo.execute(testActor('sales'), workspace.id, { requestId: 'inactive-cancel', expectedRevision: before.revision, command: { type: 'order.fabric.cancel', payload: { id: allocation.id, expectedRevision: allocation.revision } } })).rejects.toThrow('停用');
  expect((await repo.get(testActor(), workspace.id)).state.internalFabricAllocations![0].status).toBe('active');
});
