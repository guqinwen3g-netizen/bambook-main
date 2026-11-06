import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import { MistRepository, type MistCommandRequest } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testActor, testAuthority, testContract } from './__tests__/support';
import { fixture } from './__tests__/professionalFulfillment';
import { TEST_SIGNATURE, TEST_SIGNATURE_SVG } from './__tests__/signature';
import { normalizeSignatureSvg } from '../shared/mistSignatures';

vi.mock('./context', () => ({ mistApprovalAuthority: async () => ({ supplier: {} }) }));
vi.mock('../auth/tokenHelpers', () => ({ loadUserWithRoles: async (_db: any, id: string) => ({ id, status: 'active', deletedAt: null }), buildLoadedAuthTokenPayload: async (_db: any, u: any) => ({ userId: u.id, permissions: [], roles: [], departmentIds: [] }) }));
const now = '2026-10-13T12:00:00.000Z', digest = (b: Buffer) => createHash('sha256').update(b).digest('hex'), htmls: string[] = [];
const renderPdf = vi.fn(async (html: string) => { htmls.push(html); const pdf = Buffer.from('%PDF-1.4\n' + digest(Buffer.from(html)) + '\n%%EOF'); return { pdf, sha: digest(pdf), bytes: pdf.length, generatedAt: now, format: 'A4' }; });
let directory: string, db: MemoryMistDatabase, files: MistPrivateFiles;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'mist-sign-seal-')); db = new MemoryMistDatabase(); files = new MistPrivateFiles(directory); renderPdf.mockClear(); htmls.length = 0; });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
/** 普通成员账号（不带 owner 角色，权限只来自岗位）。 */
const member = (id: string) => ({ userId: id, displayName: id, roles: [], departmentIds: [], authorizationLoaded: true, permissions: [] }) as any;
const blobs = async (workspaceId: string) => (await readdir(path.join(directory, workspaceId)).catch(() => [] as string[])).filter(name => !name.includes('.preview-'));

describe('审批手写签字', () => {
  // 最小合同：订单审批与核销只改一条记录，便于聚焦仓储层的签字门禁。
  const decisions: any = {
    ...testContract,
    getMistReviewTasks: (state: any) => state.reviewTasks || [],
    mistCommandPermission: (command: any) => ['order.governance.decide', 'finance.receivable.writeoff'].includes(command.type) ? 'products:write' : testContract.mistCommandPermission(command),
    applyMistCommand: (state: any, command: any, context: any) => {
      if (command.type === 'order.governance.decide') { const row = state.reviewTasks.find((t: any) => t.entityId === command.payload.id); row.status = command.payload.decision; return { state, result: { id: row.entityId } }; }
      if (command.type === 'finance.receivable.writeoff') { state.writeoffs = [...(state.writeoffs || []), command.payload.kind]; return { state, result: { id: command.payload.invoiceId } }; }
      return testContract.applyMistCommand(state, command, context);
    },
  };
  let repo: MistRepository, auth: ReturnType<typeof testAuthority>, wid: string;
  const task = { id: 'order:1', kind: 'order', entityId: 'order-1', title: '订单审批', requesterId: 'owner', reviewerIds: ['owner'], status: 'pending', submittedAt: now, requiredPermission: 'products:write', target: { view: 'orders/detail', id: 'order-1' }, details: [] };
  const state = () => db.workspaces.get(wid).state;
  const exec = (requestId: string, command: any, extra: Partial<MistCommandRequest> = {}, actor = testActor()) => repo.execute(actor, wid, { requestId, expectedRevision: db.workspaces.get(wid).revision, command, ...extra } as MistCommandRequest);
  const approve = { type: 'order.governance.decide', payload: { id: 'order-1', decision: 'approved', note: '同意' } };
  beforeEach(async () => {
    auth = testAuthority(); repo = new MistRepository(db, decisions, files, auth.authorize, () => new Date(now));
    wid = (await repo.create(testActor(), { name: '签字' })).id; state().reviewTasks = [structuredClone(task)]; state().orders = [{ id: 'order-1' }]; state().invoices = [{ id: 'inv-1' }];
  });

  it('批准须附签字；驳回与尾差核销不得附签字', async () => {
    await expect(exec('a', approve)).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED', status: 422, message: '请先手写签字' });
    await expect(exec('b', { ...approve, payload: { ...approve.payload, decision: 'rejected' } }, { signature: TEST_SIGNATURE })).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 422 });
    await expect(exec('c', { type: 'finance.receivable.writeoff', payload: { invoiceId: 'inv-1', kind: 'difference', amount: 1, reason: '尾差' } }, { signature: TEST_SIGNATURE })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(exec('d', { type: 'finance.receivable.writeoff', payload: { invoiceId: 'inv-1', kind: 'badDebt', amount: 1, reason: '坏账' } })).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED' });
    await expect(exec('e', approve, { signature: { svg: TEST_SIGNATURE_SVG.replace('</svg>', '<script/></svg>') } })).rejects.toMatchObject({ code: 'VALIDATION', message: '签字无效，请重新签字' });
    expect(db.workspaces.get(wid).revision).toBe(0); expect(await blobs(wid)).toEqual([]);
    await expect(exec('f', { ...approve, payload: { ...approve.payload, decision: 'rejected' } })).resolves.toMatchObject({ receipt: { revision: 1 } });
  });

  it('归档规范化后的签字并登记到所签记录，回执带 signatureId；同请求换签字视为冲突', async () => {
    const r = await exec('sign-1', approve, { signature: TEST_SIGNATURE });
    const record = state().decisionSignatures[0], file = state().files.find((f: any) => f.id === record.fileId);
    expect(r.receipt.result.signatureId).toBe(record.id);
    expect(record).toMatchObject({ commandType: 'order.governance.decide', entityId: 'order-1', decision: 'approved', actorId: 'owner', requestId: 'sign-1' });
    expect(file).toMatchObject({ mimeType: 'image/svg+xml', name: '签字-sign-1.svg', uploadedBy: 'owner' });
    expect((await files.read(wid, file)).toString()).toBe(normalizeSignatureSvg(TEST_SIGNATURE_SVG));
    const replay = await repo.execute(testActor(), wid, { requestId: 'sign-1', expectedRevision: 0, command: approve, signature: TEST_SIGNATURE } as any);
    expect(replay.replayed).toBe(true);
    await expect(repo.execute(testActor(), wid, { requestId: 'sign-1', expectedRevision: 0, command: approve, signature: { svg: TEST_SIGNATURE_SVG.replace('2.70', '2.80') } } as any)).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    expect(await blobs(wid)).toHaveLength(1);
  });

  it('业务门禁失败时不留签字文件', async () => {
    db.failReceipt = true;
    await expect(exec('fail', approve, { signature: TEST_SIGNATURE })).rejects.toThrow();
    expect(await blobs(wid)).toEqual([]); expect(state().decisionSignatures).toBeUndefined();
  });

  it('Agent 不能签字', async () => {
    const agent = { ...testActor(), actorKind: 'agent', agentSessionId: 's' } as any;
    await expect(exec('agent', approve, { signature: TEST_SIGNATURE }, agent)).rejects.toMatchObject({ status: 403 });
    await expect(repo.decideReview(agent, wid, 'order:1', { requestId: 'agent-r', expectedRevision: 0, decision: 'approved', note: '同意', signature: TEST_SIGNATURE })).rejects.toMatchObject({ status: 403 });
  });

  it('审批入口：列表标出需要签字，批准须签字并归档，驳回不需要', async () => {
    expect((await repo.listReviews(testActor()))[0]).toMatchObject({ signatureRequired: true, canDecide: true });
    const input = { requestId: 'r1', expectedRevision: 0, decision: 'approved' as const, note: '同意' };
    await expect(repo.decideReview(testActor(), wid, 'order:1', input)).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED' });
    const done = await repo.decideReview(testActor(), wid, 'order:1', { ...input, signature: TEST_SIGNATURE });
    expect(done.receipt.result).toMatchObject({ reviewId: 'order:1', signatureId: state().decisionSignatures[0].id });
    expect((await repo.decideReview(testActor(), wid, 'order:1', { ...input, signature: TEST_SIGNATURE })).replayed).toBe(true);
    // 已处理事项：列表带出这次决定的签字文件，审批附件入口可下载该签字；无关文件仍被拒绝。
    const handled = (await repo.listReviews(testActor())).find((r: any) => r.id === 'order:1')!;
    expect(handled.signatureFileId).toBe(state().decisionSignatures[0].fileId);
    const signed = await repo.reviewFile(testActor(), wid, 'order:1', handled.signatureFileId!);
    expect(Buffer.from(signed.bytes).toString('utf8')).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    await expect(repo.reviewFile(testActor(), wid, 'order:1', 'not-a-review-file')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    await expect(repo.decideReview(testActor(), wid, 'order:1', input)).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    state().reviewTasks = [{ ...task, id: 'order:2', entityId: 'order-2', status: 'pending' }];
    await expect(repo.decideReview(testActor(), wid, 'order:2', { requestId: 'r2', expectedRevision: 1, decision: 'rejected', note: '退回', signature: TEST_SIGNATURE })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.decideReview(testActor(), wid, 'order:2', { requestId: 'r3', expectedRevision: 1, decision: 'rejected', note: '退回' })).resolves.toMatchObject({ replayed: false });
  });

  it('确认 Agent 提议：需要签字的提议须附确认人本人签字', async () => {
    auth.users.get('owner')!.permissions.push('ai:chat', 'ai:write:high');
    const verify = vi.fn(async () => true);
    repo = new MistRepository(db, decisions, files, auth.authorize, () => new Date(now), undefined, undefined, verify);
    state().agentProposals = [{ id: 'p', ownerId: 'owner', owner: 'owner', command: approve, summary: ['审批'], createdAt: now, state: 'pending' }];
    const confirm = (requestId: string, extra: any = {}) => repo.execute(testActor(), wid, { requestId, expectedRevision: db.workspaces.get(wid).revision, command: { type: 'agent.proposal.confirm', payload: { id: 'p' } }, reauth: { password: 'x' }, ...extra } as any);
    await expect(confirm('c1')).rejects.toMatchObject({ code: 'SIGNATURE_REQUIRED' });
    const done = await confirm('c2', { signature: TEST_SIGNATURE });
    expect(verify).toHaveBeenCalled();
    expect(state().reviewTasks[0].status).toBe('approved');
    expect(state().agentProposals[0].state).toBe('confirmed');
    expect(state().decisionSignatures[0]).toMatchObject({ commandType: 'order.governance.decide', actorId: 'owner', requestId: 'c2', fileId: expect.any(String) });
    expect(done.receipt.result.signatureId).toBe(state().decisionSignatures[0].id);
  });
});

describe('电子公章', () => {
  let repo: MistRepository, auth: ReturnType<typeof testAuthority>, wid: string, shipmentId = '', orderId = '';
  const state = () => db.workspaces.get(wid).state as contract.MistState;
  const exec = (requestId: string, command: unknown, actor = testActor()) => repo.execute(actor, wid, { requestId, expectedRevision: db.workspaces.get(wid).revision, command } as MistCommandRequest);
  const upload = async (name: string, mimeType: string, bytes: Buffer, actor = testActor()) => { const r = await repo.upload(actor, wid, { requestId: randomUUID(), expectedRevision: db.workspaces.get(wid).revision }, { bytes, name, mimeType }); return String(r.receipt.result.fileId || r.receipt.result.id); };
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a3b0d1c20000000049454e44ae426082', 'hex');
  const generate = async () => (await exec(randomUUID(), { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'CI', orderId, dueDate: '2026-12-01' } })).receipt.result.id as string;
  const saveSeal = async (fileId: string, userIds = ['owner']) => (await exec(randomUUID(), { type: 'seal.save', payload: { name: '合同专用章', kind: 'contract', fileId, userIds } })).receipt.result.id as string;
  beforeEach(async () => {
    auth = testAuthority();
    auth.users.get('owner')!.permissions.push('customs:read', 'customs:write', 'shipments:read', 'orders:read', 'orders:write', 'invoices:read', 'users:write');
    auth.users.set('clerk', { active: true, permissions: ['customs:read', 'customs:write', 'shipments:read', 'orders:read', 'orders:write', 'products:write'] }); auth.users.set('other', { active: true, permissions: ['customs:read', 'shipments:read', 'orders:read', 'products:write'] });
    repo = new MistRepository(db, contract, files, auth.authorize, () => new Date(now), undefined, renderPdf);
    wid = (await repo.create(testActor(), { name: '用印', seed: 'empty' })).id;
    const f = fixture(), { productionId, purchaseId } = f.released(); f.receiveAndComplete(productionId, purchaseId); shipmentId = f.shipment(productionId); orderId = f.orderId;
    const s = f.state; s.settings.companyProfile = { legalName: '杭州竹语服饰有限公司', englishName: 'Hangzhou Bamboo Apparel', address: '杭州', englishAddress: 'Hangzhou', phone: '', email: '', taxId: '', customsCode: '', bankName: '', bankAccount: '', swift: '', defaultCurrency: 'USD' };
    s.memberIds = ['clerk', 'other', 'outsider']; s.members = [{ userId: 'clerk', name: 'clerk' }, { userId: 'other', name: 'other' }, { userId: 'outsider', name: 'outsider' }] as any;
    db.workspaces.get(wid).state = s;
  });

  it('只有维护人能保存和停用印章；图片须为未被业务引用的 PNG / SVG，用印人须为成员', async () => {
    const image = await upload('seal.png', 'image/png', PNG), pdf = await upload('x.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF'));
    await expect(exec('s1', { type: 'seal.save', payload: { name: '公章', kind: 'company', fileId: image, userIds: ['owner'] } }, member('clerk'))).rejects.toMatchObject({ status: 403 });
    await expect(exec('s2', { type: 'seal.save', payload: { name: '公章', kind: 'company', fileId: pdf, userIds: ['owner'] } })).rejects.toMatchObject({ status: 422 });
    await expect(exec('s3', { type: 'seal.save', payload: { name: '公章', kind: 'company', fileId: image, userIds: ['stranger'] } })).rejects.toMatchObject({ status: 422 });
    await exec('attach', { type: 'order.files.add', payload: { orderId, fileIds: [pdf] } });
    const used = await upload('used.png', 'image/png', PNG); await exec('attach-2', { type: 'order.files.add', payload: { orderId, fileIds: [used] } });
    await expect(exec('s4', { type: 'seal.save', payload: { name: '公章', kind: 'company', fileId: used, userIds: ['owner'] } })).rejects.toMatchObject({ code: 'CONFLICT' });
    const id = await saveSeal(image, ['owner', 'clerk']);
    expect(state().seals![0]).toMatchObject({ id, status: 'active', userIds: ['owner', 'clerk'], fileId: image });
    expect(state().events[0].text).toContain('启用印章「合同专用章」');
    // 印章图片不能再被其他业务记录引用。
    await expect(exec('attach-3', { type: 'order.files.add', payload: { orderId, fileIds: [image] } })).rejects.toMatchObject({ status: 404 });
    await expect(exec('d1', { type: 'seal.disable', payload: { id, reason: '换新章' } }, member('clerk'))).rejects.toMatchObject({ status: 403 });
    await exec('d2', { type: 'seal.disable', payload: { id, reason: '换新章' } });
    expect(state().seals![0]).toMatchObject({ status: 'disabled', disabledReason: '换新章', disabledBy: 'owner' });
    const agent = { ...testActor(), actorKind: 'agent', agentSessionId: 's' } as any;
    await expect(exec('d3', { type: 'seal.save', payload: { name: '新章', kind: 'company', fileId: await upload('n.png', 'image/png', PNG), userIds: ['owner'] } }, agent)).rejects.toMatchObject({ status: 403 });
  });

  it('用印人盖章签发：按草稿快照重新渲染、归档新 PDF、草稿保留在历史并登记用印', async () => {
    const image = await upload('seal.png', 'image/png', PNG), sealId = await saveSeal(image), docId = await generate();
    const draft = state().fulfillment.documents.find(d => d.id === docId)!, draftFile = draft.fileIds[0];
    await expect(exec('no-reason', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId } })).rejects.toMatchObject({ status: 422 });
    await expect(exec('long', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId, sealReason: 'x'.repeat(201) } })).rejects.toMatchObject({ status: 422 });
    const r = await exec('issue', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId, sealReason: '客户清关' } });
    const doc = state().fulfillment.documents.find(d => d.id === docId)! as any, use = state().sealUses![0];
    expect(doc.status).toBe('issued'); expect(doc.invoiceId).toBeTruthy();
    expect(doc.fileIds).toHaveLength(1); expect(doc.fileIds[0]).not.toBe(draftFile);
    expect(doc.generated.map((g: any) => g.fileId)).toEqual([draftFile, doc.fileIds[0]]);
    expect(doc.generated[1]).toMatchObject({ sealUseId: use.id, snapshotFingerprint: doc.generated[0].snapshotFingerprint });
    expect(doc.sealUseId).toBe(use.id);
    expect(use).toMatchObject({ sealId, sealName: '合同专用章', documentKind: 'CI', documentId: docId, documentNumber: doc.number, fileId: doc.fileIds[0], actorId: 'owner', reason: '客户清关' });
    expect(r.receipt.result).toMatchObject({ id: docId, sealUseId: use.id });
    expect(htmls.at(-1)).toContain('class="doc-seal" src="data:image/png;base64,');
    expect(htmls[0]).not.toContain('class="doc-seal"');
    expect(state().files.find(f => f.id === doc.fileIds[0])!.name).toMatch(/盖章\.pdf$/);
    expect(JSON.stringify(state())).not.toContain(PNG.toString('base64'));
    expect(state().events.some(e => e.text.includes('加盖「合同专用章」签发'))).toBe(true);
  });

  it('非用印人、停用印章、上传文件的单据不能盖章；不带印章照常签发且不盖章', async () => {
    const image = await upload('seal.png', 'image/png', PNG), sealId = await saveSeal(image), docId = await generate();
    await expect(exec('clerk', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId, sealReason: '清关' } }, member('clerk'))).rejects.toMatchObject({ status: 403 });
    const manual = await upload('ci.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF'));
    const doc = state().fulfillment.documents.find(d => d.id === docId)!; doc.fileIds = [manual];
    await expect(exec('manual', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId, sealReason: '清关' } })).rejects.toMatchObject({ status: 422 });
    await exec('regen', { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'CI', orderId, dueDate: '2026-12-01' } });
    await exec('off', { type: 'seal.disable', payload: { id: sealId, reason: '停用' } });
    await expect(exec('disabled', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId, sealReason: '清关' } })).rejects.toMatchObject({ status: 422 });
    const renders = renderPdf.mock.calls.length;
    await exec('plain', { type: 'fulfillment.documents.issue', payload: { id: docId } }, member('clerk'));
    expect(state().fulfillment.documents.find(d => d.id === docId)!.status).toBe('issued');
    expect(renderPdf.mock.calls.length).toBe(renders); expect(state().sealUses ?? []).toEqual([]);
  });

  it('PI / SC 生成时盖章；未盖章的同内容可补盖一次', async () => {
    const svg = await upload('seal.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    await expect(saveSeal(svg)).rejects.toMatchObject({ status: 422 });
    const image = await upload('seal.png', 'image/png', PNG), sealId = await saveSeal(image);
    await exec('pi', { type: 'order.document.generate', payload: { orderId, kind: 'PI' } });
    const r = await exec('pi-seal', { type: 'order.document.generate', payload: { orderId, kind: 'PI', sealId, sealReason: '客户付款' } });
    const docs = (state().orders.find(o => o.id === orderId) as any).documents, use = state().sealUses![0];
    expect(docs).toHaveLength(2); expect(docs[1]).toMatchObject({ sealUseId: use.id, fileId: r.receipt.result.fileId });
    expect(use).toMatchObject({ documentKind: 'PI', documentId: docs[1].id, documentNumber: docs[1].number, reason: '客户付款' });
    expect(htmls.at(-1)).toContain('data:image/png;base64,');
    await expect(exec('pi-again', { type: 'order.document.generate', payload: { orderId, kind: 'PI', sealId, sealReason: '再盖' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(repo.preview(testActor(), wid, { requestId: 'p', expectedRevision: db.workspaces.get(wid).revision, command: { type: 'fulfillment.documents.issue', payload: { id: 'x', sealId, sealReason: 'r' } } } as never)).rejects.toMatchObject({ code: 'PREVIEW_UNSUPPORTED' });
  });

  it('印章图片只给维护人与用印人：投影省略 fileId、文件列表剔除、下载拒绝', async () => {
    const image = await upload('seal.png', 'image/png', PNG), sealId = await saveSeal(image, ['clerk']), docId = await generate();
    await exec('issue', { type: 'fulfillment.documents.issue', payload: { id: docId, sealId, sealReason: '清关' } }, member('clerk'));
    const viewOf = async (id: string) => (await repo.get(id === 'owner' ? testActor() : member(id), wid)).state as contract.MistState;
    const plain = await viewOf('other'), clerk = await viewOf('clerk'), owner = await viewOf('owner');
    expect(plain.seals![0]).toMatchObject({ id: sealId, name: '合同专用章', kind: 'contract', status: 'active', userIds: ['clerk'] });
    expect(plain.seals![0]).not.toHaveProperty('fileId');
    expect(plain.files.some(f => f.id === image)).toBe(false);
    // 能看到单据的人看到完整用印记录（含盖章件），看不到单据的人不下发。
    expect(plain.sealUses![0]).toMatchObject({ sealId, documentId: docId, fileId: expect.any(String) });
    auth.users.set('outsider', { active: true, permissions: ['products:write'] });
    const outsider = await viewOf('outsider');
    expect(outsider.sealUses ?? []).toEqual([]); expect(outsider.seals![0]).not.toHaveProperty('fileId');
    await expect(repo.download(member('other'), wid, image)).rejects.toMatchObject({ status: 404 });
    expect(clerk.seals![0].fileId).toBe(image); expect(clerk.files.some(f => f.id === image)).toBe(true);
    expect((await repo.download(member('clerk'), wid, image)).bytes.equals(PNG)).toBe(true);
    expect(clerk.sealUses![0]).toMatchObject({ sealId, documentId: docId, fileId: expect.any(String) });
    expect(owner.seals![0].fileId).toBe(image);
    const agent = { ...member('clerk'), actorKind: 'agent', agentSessionId: 's' } as any;
    expect(((await repo.get(agent, wid)).state as contract.MistState).files.some(f => f.id === image)).toBe(false);
  });
});
