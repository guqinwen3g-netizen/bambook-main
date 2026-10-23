import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMistState, applyMistCommand, mistCommandPermission, mistMoneyMinor, renderDemoFile } from '../shared/mistWorkspace';
import { MistRepository, type MistContract } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, requestReceiptCount, testActor, testAuthority } from './__tests__/support';
const contract: MistContract = { createMistState, applyMistCommand, mistCommandPermission, renderDemoFile };
let root: string, db: MemoryMistDatabase, repo: MistRepository;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'mist-real-contract-')); db = new MemoryMistDatabase(); repo = new MistRepository(db, contract, new MistPrivateFiles(root), testAuthority().authorize, () => new Date('2026-10-13T04:00:00Z')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('Mist repository with the real shared business commands', () => {
  it('does not let a QC reader claim tasks, and hides QC data after read access is removed', async () => {
    const authority = testAuthority();
    const readerActor = { ...testActor(), roles: ['viewer' as const], authorizationLoaded: true };
    authority.users.get('owner')!.permissions = ['products:write', 'qc:read'];
    repo = new MistRepository(db, contract, new MistPrivateFiles(root), authority.authorize);
    const workspace = await repo.create(readerActor, { name: 'QC read boundary', seed: 'demo' });
    const before = structuredClone(db.workspaces.get(workspace.id));
    await expect(repo.execute(readerActor, workspace.id, { requestId: 'readonly-qc-claim', expectedRevision: 0, command: { type: 'fulfillment.qc.claim', payload: { id: 'qc-task', domain: 'garment' } } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.workspaces.get(workspace.id)).toEqual(before);
    authority.users.get('owner')!.permissions = ['products:write'];
    const denied = await repo.get(readerActor, workspace.id);
    expect(denied.state.fulfillment.qcTasks).toEqual([]);
    expect(denied.state.fulfillment.qcReports).toEqual([]);
  });
  it('creates demo workspaces with downloadable sample PDFs stored privately, and empty workspaces without them', async () => {
    const workspace = await repo.create(testActor(), { name: 'Demo', seed: 'demo' });
    const demoFiles = workspace.state.files.filter(file => file.mimeType === 'application/pdf' && file.storageKey === `${workspace.id}/${file.id}`);
    expect(workspace.state.files.some(file => file.storageKey.startsWith('demo-seed/'))).toBe(false);
    expect(demoFiles.length).toBeGreaterThanOrEqual(5);
    const download = await repo.download(testActor(), workspace.id, demoFiles[0].id);
    expect(download.bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(download.bytes.length).toBe(demoFiles[0].size);
    const pendingDemo = workspace.state.market.quotations.find(q => q.approval?.status === 'pending');
    expect(pendingDemo?.approval?.reviewerId).toBe('demo-reviewer');
    const empty = await repo.create(testActor(), { name: 'Empty', seed: 'empty' });
    expect(empty.state.files).toEqual([]);
  });
  it('persists real reconciliation and its receipt once, rejects excess amounts without partially changing either balance', async () => {
    const workspace = await repo.create(testActor(), { name: 'Real contract', seed: 'demo' });
    const receipt = workspace.state.receipts.find(row => row.remaining > 100.25 && row.currency === 'USD')!;
    const invoice = workspace.state.invoices.find(row => row.open > 100.25 && row.currency === 'USD')!;
    expect(receipt).toBeDefined(); expect(invoice).toBeDefined();
    const command = { requestId: 'real-reconcile', expectedRevision: 0, command: { type: 'finance.reconcile' as const, payload: { receiptId: receipt.id, invoiceId: invoice.id, amount: 100.25, payerBasis: '本地测试：已核验付款人与客户的代付关系' } } };
    const first = await repo.execute(testActor(), workspace.id, command);
    expect(first.receipt.result.applied).toBe(1);
    expect(first.workspace.state.allocations[workspace.state.allocations.length].payerBasis).toBe('本地测试：已核验付款人与客户的代付关系');
    expect(mistMoneyMinor(first.workspace.state.receipts.find(row => row.id === receipt.id)!.remaining)).toBe(mistMoneyMinor(receipt.remaining) - 10025);
    expect(mistMoneyMinor(first.workspace.state.invoices.find(row => row.id === invoice.id)!.open)).toBe(mistMoneyMinor(invoice.open) - 10025);
    const replay = await repo.execute(testActor(), workspace.id, command);
    expect(replay.replayed).toBe(true); expect(replay.workspace.state.allocations).toEqual(first.workspace.state.allocations);
    await expect(repo.execute(testActor(), workspace.id, { requestId: 'excess', expectedRevision: 1, command: { ...command.command, payload: { ...command.command.payload, amount: receipt.amount + invoice.amount + 1 } } })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await repo.get(testActor(), workspace.id)).toEqual(first.workspace);
    expect(requestReceiptCount(db)).toBe(2); // One creation receipt and one reconciliation receipt.
  });
  it('keeps the switcher name and settings name consistent through a typed rename', async () => {
    const input = { name: '第一公司', seed: 'empty' as const, slug: 'rename-after-create' };
    const workspace = await repo.create(testActor(), input);
    expect(workspace.state.settings.workspaceName).toBe('第一公司');
    const changed = await repo.execute(testActor(), workspace.id, { requestId: 'rename', expectedRevision: 0, command: { type: 'settings.update', payload: { workspaceName: '新名称' } } });
    expect(changed.workspace.name).toBe('新名称'); expect(changed.workspace.state.settings.workspaceName).toBe('新名称');
    const replay = await repo.create(testActor(), input);
    expect(replay.id).toBe(workspace.id); expect(replay.name).toBe('新名称'); expect(replay.revision).toBe(1);
  });
  it('registers only real uploaded bytes through the actual files.add command', async () => {
    const workspace = await repo.create(testActor(), { name: 'Empty', seed: 'empty' });
    expect(workspace.state.files).toEqual([]); expect(workspace.state.devs).toEqual([]);
    const bytes = Buffer.from('actual Mist brief bytes');
    const result = await repo.upload(testActor(), workspace.id, { requestId: 'real-file', expectedRevision: 0 }, { bytes, name: 'brief.txt', mimeType: 'text/plain' });
    expect(result.workspace.state.files).toHaveLength(1);
    const file = result.workspace.state.files[0]; expect(result.receipt.result.fileId).toBe(file.id);
    expect((await repo.download(testActor(), workspace.id, file.id)).bytes).toEqual(bytes);
    await expect(repo.execute(testActor(), workspace.id, { requestId: 'fake-file', expectedRevision: 1, command: { type: 'files.add', payload: { file: { ...file, id: 'fake' } } } })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
  });
});
