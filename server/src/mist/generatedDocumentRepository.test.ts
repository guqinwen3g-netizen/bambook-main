import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import { MistRepository, type MistCommandRequest } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';
import { fixture } from './__tests__/professionalFulfillment';

vi.mock('./context', () => ({ mistApprovalAuthority: async () => ({ supplier: {} }) }));
const now = '2026-10-13T12:00:00.000Z', digest = (b: Buffer) => createHash('sha256').update(b).digest('hex'), htmls: string[] = [];
const renderPdf = vi.fn(async (html: string) => { htmls.push(html); const pdf = Buffer.from('%PDF-1.4\n' + digest(Buffer.from(html)) + '\n%%EOF'); return { pdf, sha: digest(pdf), bytes: pdf.length, generatedAt: now, format: 'A4' }; });
let directory: string, db: MemoryMistDatabase, files: MistPrivateFiles, repo: MistRepository, workspaceId: string, revision = 0, shipmentId = '', orderId = '';
const state = () => db.workspaces.get(workspaceId).state as contract.MistState;
const exec = async (requestId: string, command: unknown, expected = revision) => { const r = await repo.execute(testActor(), workspaceId, { requestId, expectedRevision: expected, command } as MistCommandRequest); revision = r.workspace.revision; return r; };

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mist-gen-doc-')); db = new MemoryMistDatabase(); const auth = testAuthority();
  auth.users.get('owner')!.permissions.push('customs:read', 'customs:write', 'shipments:read', 'orders:read', 'orders:write');
  files = new MistPrivateFiles(directory); renderPdf.mockClear(); htmls.length = 0; revision = 0;
  repo = new MistRepository(db, contract, files, auth.authorize, () => new Date(now), undefined, renderPdf);
  workspaceId = (await repo.create(testActor(), { name: '单据生成', seed: 'empty' })).id;
  const f = fixture(), { productionId, purchaseId } = f.released(); f.receiveAndComplete(productionId, purchaseId); shipmentId = f.shipment(productionId); orderId = f.orderId;
  const s = f.state; s.settings.companyProfile = { legalName: '杭州竹语服饰有限公司', englishName: 'Hangzhou Bamboo Apparel', address: '杭州', englishAddress: 'Hangzhou', phone: '', email: '', taxId: '', customsCode: '', bankName: '', bankAccount: '', swift: '', defaultCurrency: 'USD' };
  for (const m of [{ userId: 'owner', name: 'Owner' }]) if (!s.members?.some((x: any) => x.userId === m.userId)) (s.members ||= [] as any).push(m as any);
  db.workspaces.get(workspaceId).state = s;
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

it('renders, stores and attaches the PDF in one command, and replays without rendering again', async () => {
  const r = await exec('ci-1', { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'CI', orderId, dueDate: '2026-12-01' } });
  const doc = state().fulfillment.documents.find(d => d.id === r.receipt.result.id)!, file = state().files.find(x => x.id === r.receipt.result.fileId)!;
  expect(doc.fileIds).toEqual([file.id]);
  expect(file).toMatchObject({ mimeType: 'application/pdf' });
  expect((await files.read(workspaceId, file)).subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(htmls[0]).toContain('COMMERCIAL INVOICE');
  const replay = await repo.execute(testActor(), workspaceId, { requestId: 'ci-1', expectedRevision: revision - 1, command: { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'CI', orderId, dueDate: '2026-12-01' } } } as MistCommandRequest);
  expect(replay.replayed).toBe(true); expect(renderPdf).toHaveBeenCalledTimes(1);
});
it('refuses forged content and blocked documents before rendering or writing a file', async () => {
  const before = (await readdir(path.join(directory, workspaceId)).catch(() => [] as string[])).length;
  await expect(exec('forged', { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'SO', content: '伪造' } })).rejects.toMatchObject({ status: 422 });
  await expect(exec('pl', { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'PL' } })).rejects.toMatchObject({ status: 422 });
  await expect(repo.preview?.(testActor(), workspaceId, { requestId: 'p', expectedRevision: revision, command: { type: 'order.document.generate', payload: { orderId, kind: 'PI' } } } as never)).rejects.toMatchObject({ code: 'PREVIEW_UNSUPPORTED' });
  expect(renderPdf).not.toHaveBeenCalled();
  expect((await readdir(path.join(directory, workspaceId)).catch(() => [] as string[])).length).toBe(before);
});
