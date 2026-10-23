import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import { preparePurchaseDocumentSnapshot } from '../shared/mistPurchaseDocument';
import { renderPurchaseDocumentHtml } from '../templates/purchaseDocument';
import { MistRepository } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';

vi.mock('./context', () => ({ mistApprovalAuthority: async () => ({ supplier: {} }) }));
const now = '2026-10-24T08:00:00.000Z', digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const renderPdf = vi.fn(async (html: string) => { const pdf = Buffer.from('%PDF-1.4\n' + digest(Buffer.from(html)) + '\n%%EOF'); return { pdf, sha: digest(pdf), bytes: pdf.length, generatedAt: now, format: 'A4' }; });
let directory: string, db: MemoryMistDatabase, auth: ReturnType<typeof testAuthority>, files: MistPrivateFiles, repo: MistRepository, workspaceId: string;
const state = () => db.workspaces.get(workspaceId).state as contract.MistState;
const purchase = () => state().fulfillment.purchases[0];
const generate = (requestId = 'document-1', expectedRevision = 0, extra = {}) => repo.execute(testActor(), workspaceId, { requestId, expectedRevision, command: { type: 'fulfillment.procurement.document', payload: { id: 'purchase', ...extra } } as never });
const storedNames = () => readdir(path.join(directory, workspaceId)).catch(() => []);

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-purchase-doc-')); db = new MemoryMistDatabase(); auth = testAuthority(); auth.users.get('owner')!.permissions.push('procurement:read', 'procurement:write');
  files = new MistPrivateFiles(directory); renderPdf.mockClear(); repo = new MistRepository(db, contract, files, auth.authorize, () => new Date(now), undefined, renderPdf);
  workspaceId = (await repo.create(testActor(), { name: 'Supplier documents', seed: 'empty' })).id;
  let s = state(), serial = 0;
  const ctx: contract.MistContext = { id: () => `seed-${++serial}`, now, actorName: 'Buyer', actorId: 'owner', members: [{ id: 'owner', name: 'Buyer', active: true, groups: ['garment'] }], authority: { supplier: {}, orderReviewerIds: { garment: ['leader'] } } };
  const run = (command: contract.MistCommand, actorId = 'owner') => { const next = contract.applyMistCommand(s, command, { ...ctx, actorId }); s = next.state; return next.result; };
  const orderId = run({ type: 'order.create', payload: { type: 'garment', customerId: '', currency: 'CNY', season: 'AW27', due: '2026-12-01', ownerId: 'owner', governance: { kind: 'internal', internalPurpose: 'Sample supply', receiver: 'Buyer', paymentMethod: 'OTHER', depositPercent: 0, preShipmentPercent: 0, paymentNote: 'Internal', incoterm: 'EXW', deliveryPlace: 'Factory', poNumber: '', confirmationFileIds: [] }, lines: [{ name: 'Jacket', style: 'JK-01', qty: 600, unit: '件', price: 100, img: 'coat', fulfillmentMode: 'cmt', cmtIncludedItems: [] }] } }).orderId!;
  run({ type: 'order.governance.submit', payload: { orderId } }); run({ type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: 'Internal approval secret' } }, 'leader');
  s.settings.companyProfile = { legalName: '示例贸易有限公司', englishName: 'Example Trading Ltd', address: '上海市示例路1号', phone: '021-000', email: 'buy@example.com', taxId: 'TAX-1', bankAccount: 'PRIVATE-BANK' } as never;
  s.market.suppliers.push({ id: 'supplier', name: '示例工厂', address: '示例工业园', status: 'active' } as never);
  const snapshot = { orderId, lineId: s.orderLines[0].id, kind: 'material' as const, materialKind: 'trims' as const, supplierId: 'supplier', supplier: '示例工厂', description: '辅料套件', quantity: 1359.6, unit: '米', price: 68, currency: 'CNY', due: '2026-11-10', terms: '30%预付，70%验收后付清。', destination: '上海仓', note: '<质量要求> 同批次供货', fileIds: [] };
  const decision = { actorId: 'leader', actor: 'Manager', at: now, decision: 'approved' as const, note: 'INTERNAL-REVIEW-SECRET' };
  s.fulfillment.purchases.push({ id: 'purchase', code: 'PO-EXAMPLE-001', ...snapshot, domain: 'garment', state: 'approved', requesterId: 'owner', createdBy: 'Buyer', createdAt: now, reviewerIds: ['leader'], configVersions: {}, received: 0, decision, revisionHistory: [{ revision: 2, submittedAt: now, requesterId: 'owner', reviewerIds: ['leader'], configVersions: {}, snapshot: structuredClone(snapshot), decision }] });
  db.workspaces.get(workspaceId).state = s;
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

it('archives the approved PDF atomically, returns its file and replays without rendering again', async () => {
  const result = await generate(); expect(result.receipt.result).toMatchObject({ id: 'purchase', fileId: expect.any(String) });
  const record = purchase().documents![0], original = structuredClone(record);
  expect(record).toMatchObject({ revision: 2, fileName: 'PO-EXAMPLE-001-V2-01.pdf', snapshot: { total: '92452.80' } });
  const file = state().files.find(f => f.id === record.fileId)!;
  expect((await files.read(workspaceId, file)).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await generate()).replayed).toBe(true); expect(renderPdf).toHaveBeenCalledOnce();
  state().settings.companyProfile!.legalName = '更新后公司'; purchase().description = 'Unapproved mutation';
  await generate('document-2', 1); expect(purchase().documents![0]).toEqual(original);
  expect(purchase().documents![1]).toMatchObject({ fileName: 'PO-EXAMPLE-001-V2-02.pdf', snapshot: { issuer: { legalName: '更新后公司' }, contract: { description: '辅料套件' } } });
  expect(await storedNames()).toHaveLength(2);
});

it('prints totals, agreed terms and blank signatures without internal approval or bank data', async () => {
  await generate(); const html = renderPdf.mock.calls[0][0];
  for (const text of ['示例贸易有限公司', '示例工厂', '92,452.80', '30%预付', '签字 / 盖章', '&lt;质量要求&gt;']) expect(html).toContain(text);
  for (const text of ['INTERNAL-REVIEW-SECRET', 'PRIVATE-BANK', '批准时间', '审批意见', 'Template v']) expect(html).not.toContain(text);
  const snapshot = preparePurchaseDocumentSnapshot(state(), { id: 'purchase' }, { id: () => '', now, actorName: 'Buyer', actorId: 'owner' });
  snapshot.contract.kind = 'processing'; expect(renderPurchaseDocumentHtml(snapshot)).toContain('委外加工合同');
});

it.each([{ html: 'forged' }, { fileId: 'forged' }, { snapshot: {} }])('rejects forged payload before creating a file: %j', async extra => {
  const before = structuredClone(state()); await expect(generate('forged', 0, extra)).rejects.toMatchObject({ status: 422 }); expect(state()).toEqual(before); expect(renderPdf).not.toHaveBeenCalled();
});
it.each(['draft', 'pending', 'rejected', 'cancelled'] as const)('does not generate a document for %s contracts', async status => {
  purchase().state = status; await expect(generate()).rejects.toMatchObject({ status: 422 }); expect(renderPdf).not.toHaveBeenCalled();
});
it('requires current write authority, company header and the approved revision', async () => {
  auth.users.get('owner')!.permissions = ['procurement:read']; await expect(generate()).rejects.toMatchObject({ status: 403 });
  auth.users.get('owner')!.permissions.push('procurement:write'); delete state().settings.companyProfile;
  await expect(generate()).rejects.toMatchObject({ status: 422 });
  state().settings.companyProfile = { legalName: 'Company' } as never; purchase().revisionHistory = [];
  await expect(generate()).rejects.toMatchObject({ status: 422 }); expect(renderPdf).not.toHaveBeenCalled(); expect(await storedNames()).toHaveLength(0);
});
it('cleans up files and leaves no document after render or transaction failure', async () => {
  const before = structuredClone(state()); renderPdf.mockRejectedValueOnce(new Error('renderer failed'));
  await expect(generate()).rejects.toMatchObject({ code: 'PURCHASE_PDF_UNAVAILABLE' }); expect(state()).toEqual(before);
  db.failReceipt = true; await expect(generate()).rejects.toThrow('transaction failed'); expect(state()).toEqual(before); expect(await storedNames()).toHaveLength(0);
});
