import { describe, expect, it } from 'vitest';
import { applyMistCommand, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { prepareGeneratedSnapshot, documentGenerationBlocker } from './mistDocumentGeneration';
import { generatedDocFingerprint, amountInWords } from './mistGeneratedDocument';
import { renderGeneratedDocumentHtml } from '../templates/generatedDocument';
import { fixture } from '../mist/__tests__/professionalFulfillment';

const company = { legalName: '杭州竹语服饰有限公司', englishName: 'Hangzhou Bamboo Apparel Co., Ltd.', address: '杭州市西湖区 1 号', englishAddress: '1 West Lake Rd, Hangzhou', phone: '0571-1', email: 'doc@example.com', taxId: '91330100', customsCode: '3301960000', bankName: 'Bank of China', bankAccount: '1234', swift: 'BKCHCNBJ', defaultCurrency: 'USD' };
/** Runs a generating command the way the repository does: snapshot → (fake) stored PDF → bound artifact → command. */
function generate(f: ReturnType<typeof fixture>, command: MistCommand, ctx: MistContext = f.context) {
  const snapshot = prepareGeneratedSnapshot(f.state, command, ctx), fileId = `file-${Math.random().toString(36).slice(2)}`;
  const file = { id: fileId, name: `${snapshot.number}.pdf`, mimeType: 'application/pdf', size: 10, storageKey: `ws/${fileId}`, createdAt: ctx.now };
  const record = { id: `rec-${fileId}`, kind: snapshot.kind, number: snapshot.number, fileId, fileName: file.name, sha256: 'x', bytes: 10, templateVersion: 1, snapshotFingerprint: generatedDocFingerprint(snapshot), snapshot, generatedAt: ctx.now, generatedBy: ctx.actorName };
  return { result: f.run(command, { ...ctx, generatedDocument: { requestId: 'r', record, file } } as MistContext), snapshot, fileId };
}
function ready() {
  const f = fixture(), { productionId, purchaseId } = f.released();
  f.receiveAndComplete(productionId, purchaseId);
  const shipmentId = f.shipment(productionId);
  (f.state as MistState).settings.companyProfile = { ...company };
  return { f, shipmentId };
}

describe('shipment document generation', () => {
  it('generates a CI draft from shipment and order prices, then issues it through the receivable rule', () => {
    const { f, shipmentId } = ready();
    const { result, snapshot, fileId } = generate(f, { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'CI', orderId: f.orderId, dueDate: '2026-12-01' } });
    expect(snapshot.table!.rows[0]).toMatchObject({ style: 'LOCAL', qty: '10 件', price: '10.00', amount: '100.00' });
    expect(snapshot.amountInWords).toBe('SAY TOTAL US DOLLARS ONE HUNDRED ONLY');
    const doc = f.state.fulfillment.documents.find(d => d.id === result.id)!;
    expect(doc).toMatchObject({ type: 'CI', status: 'draft', orderId: f.orderId, dueDate: '2026-12-01', fileIds: [fileId] });
    expect(doc.content).toContain('LOCAL');
    // Regenerating refreshes the same draft and replaces only its own generated file.
    f.run({ type: 'fulfillment.documents.save', payload: { id: doc.id, shipmentId, orderId: f.orderId, type: 'CI', number: doc.number, title: doc.title, dueDate: doc.dueDate, content: doc.content, fileIds: [...doc.fileIds, 'contract'] } });
    const again = generate(f, { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'CI', orderId: f.orderId, dueDate: '2026-12-05' } });
    expect(again.result.id).toBe(doc.id);
    expect(f.state.fulfillment.documents.find(d => d.id === doc.id)!.fileIds).toEqual(['contract', again.fileId]);
    f.run({ type: 'fulfillment.documents.issue', payload: { id: doc.id } });
    expect(f.state.invoices.at(-1)).toMatchObject({ amount: 100, due: '2026-12-05', financeStatus: 'pending' });
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'CI', f.orderId)).toContain('已有有效签发版本');
  });
  it('refuses client content, missing letterhead and types that need prior facts', () => {
    const { f, shipmentId } = ready();
    expect(() => prepareGeneratedSnapshot(f.state, { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'SO', content: 'x' } }, f.context)).toThrow('服务端');
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'PL')).toBe('请先登记装箱分配');
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'BC')).toBe('本票没有对应的有效信用证');
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'DFT', f.orderId)).toBe('请先签发本订单 CI');
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'SA')).toBe('离港后才能出装船通知');
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'BL')).toContain('外部机构');
    delete (f.state as MistState).settings.companyProfile;
    expect(documentGenerationBlocker(f.state, f.state.fulfillment.shipments[0], 'SO')).toBe('请先补全公司抬头');
  });
  it('generates booking, shipping instructions, customs draft and power of attorney as own drafts that do not gate departure', () => {
    const { f, shipmentId } = ready();
    for (const type of ['SO', 'SI', 'DN', 'CD', 'CDA'] as const) {
      const { result, snapshot } = generate(f, { type: 'fulfillment.documents.generate', payload: { shipmentId, type } });
      expect(f.state.fulfillment.documents.find(d => d.id === result.id)).toMatchObject({ type, orderId: '', status: 'draft' });
      expect(renderGeneratedDocumentHtml(snapshot)).toContain(snapshot.number);
    }
    const cd = f.state.fulfillment.documents.find(d => d.type === 'CD')!;
    expect(cd.content).toContain('尚未建立商品归类');
  });
});

describe('B/L details', () => {
  it('records number, release form and originals, requires a checked draft before telex release', () => {
    const { f, shipmentId } = ready();
    const id = f.run({ type: 'fulfillment.documents.save', payload: { shipmentId, orderId: '', type: 'BL', number: '待补', title: '提单', dueDate: '', content: '船公司提单', fileIds: [] } }).id!;
    expect(() => f.run({ type: 'fulfillment.documents.bl', payload: { id, blNo: 'COSU123', kind: 'original', originals: 0 } })).toThrow('正本份数');
    f.run({ type: 'fulfillment.documents.bl', payload: { id, blNo: 'COSU123', kind: 'telex', originals: 0 } });
    expect(() => f.run({ type: 'fulfillment.documents.bl', payload: { id, blNo: 'COSU123', kind: 'telex', originals: 0, release: '已电放' } })).toThrow('草稿');
    f.run({ type: 'fulfillment.documents.bl', payload: { id, blNo: 'COSU123', kind: 'telex', originals: 0, confirmDraft: '客户确认草稿无误' } });
    f.run({ type: 'fulfillment.documents.bl', payload: { id, blNo: 'COSU123', kind: 'telex', originals: 0, release: '船公司电放保函已收' } });
    const d = f.state.fulfillment.documents.find(x => x.id === id)!;
    expect(d.number).toBe('COSU123');
    expect(d.bl).toMatchObject({ blNo: 'COSU123', kind: 'telex', draftConfirmed: { evidence: '客户确认草稿无误' }, released: { evidence: '船公司电放保函已收' } });
  });
});

describe('order documents and lookbook', () => {
  it('generates PI and sales contract from the approved order snapshot only', () => {
    const f = fixture();
    (f.state as MistState).settings.companyProfile = { ...company };
    expect(() => prepareGeneratedSnapshot(f.state, { type: 'order.document.generate', payload: { orderId: f.orderId, kind: 'PI' } }, f.context)).toThrow('审批通过');
    f.approveOrder();
    const { snapshot } = generate(f, { type: 'order.document.generate', payload: { orderId: f.orderId, kind: 'PI' } });
    expect(snapshot.title.en).toBe('PROFORMA INVOICE');
    expect(snapshot.table!.totals!.amount).toBe('USD 100.00');
    expect(() => generate(f, { type: 'order.document.generate', payload: { orderId: f.orderId, kind: 'PI' } })).toThrow('未变化');
    const sc = generate(f, { type: 'order.document.generate', payload: { orderId: f.orderId, kind: 'SC' } }).snapshot;
    expect(sc.signatures.map(x => x.label.en)).toEqual(['The Seller', 'The Buyer']);
    expect((f.state.orders[0] as any).documents.map((d: any) => d.orderKind)).toEqual(['PI', 'SC']);
  });
  it('generates a lookbook PDF only after it is prepared', () => {
    const f = fixture();
    (f.state as MistState).settings.companyProfile = { ...company };
    f.state.market.products.push({ id: 'p1', sku: 'SKU-1', name: '羊毛大衣', category: 'garment', status: 'active', specification: '100% wool', createdAt: '', updatedAt: '', fileIds: [], note: '' } as any);
    const id = f.run({ type: 'market.lookbook.save', payload: { input: { name: 'AW27 精选', customerId: 'customer', productIds: ['p1'], fileIds: [], note: '' } } } as MistCommand).id!;
    expect(() => prepareGeneratedSnapshot(f.state, { type: 'market.lookbook.document', payload: { id } }, f.context)).toThrow('准备画册');
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Prepared' } } as MistCommand);
    const { snapshot, fileId } = generate(f, { type: 'market.lookbook.document', payload: { id } });
    expect(snapshot.table!.rows).toEqual([{ sku: 'SKU-1', name: '羊毛大衣', spec: '100% wool' }]);
    expect(f.state.market.lookbooks[0].fileIds).toContain(fileId);
  });
});

it('writes amounts in words the way invoices and drafts do', () => {
  expect(amountInWords(12345.67, 'USD')).toBe('SAY TOTAL US DOLLARS TWELVE THOUSAND THREE HUNDRED AND FORTY-FIVE AND CENTS SIXTY-SEVEN ONLY');
  expect(amountInWords(1000000, 'EUR')).toBe('SAY TOTAL EUROS ONE MILLION ONLY');
});
