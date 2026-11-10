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
  it('leaves no empty separators in the PL body when packing rows have no colour or size detail', () => {
    const { f, shipmentId } = ready(), line = f.state.fulfillment.shipments.find(s => s.id === shipmentId)!.lines[0];
    f.run({ type: 'fulfillment.shipments.pack', payload: { id: shipmentId, lines: [{ lineId: line.lineId, productionId: line.productionId, carton: '1', quantity: line.quantity, netWeight: 10, grossWeight: 11, volume: 1, note: '' }] } } as MistCommand);
    const { result } = generate(f, { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'PL' } });
    const doc = f.state.fulfillment.documents.find(d => d.id === result.id)!;
    expect(doc.content).not.toMatch(/·\s+·/);
  });
  it('merges consecutive identical cartons into one PL range with summed quantity and weights', () => {
    const { f, shipmentId } = ready(), line = f.state.fulfillment.shipments.find(s => s.id === shipmentId)!.lines[0];
    const carton = (n: number, netWeight: number) => ({ lineId: line.lineId, productionId: line.productionId, carton: String(n), quantity: 2, netWeight, grossWeight: 1.5, volume: 0.1, note: '' });
    f.run({ type: 'fulfillment.shipments.pack', payload: { id: shipmentId, lines: [carton(1, 1), carton(2, 1), carton(3, 1), carton(4, 1), carton(5, 1.2)] } } as MistCommand);
    const { snapshot } = generate(f, { type: 'fulfillment.documents.generate', payload: { shipmentId, type: 'PL' } });
    expect(snapshot.table!.rows).toHaveLength(2);
    expect(snapshot.table!.rows[0]).toMatchObject({ carton: '1-4', qty: '8 件 (4 × 2)', nw: '4.00', gw: '6.00', cbm: '0.4' });
    expect(snapshot.table!.rows[1]).toMatchObject({ carton: '5', qty: '2 件', nw: '1.20' });
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
  it('keeps generated lookbook history when saving a revised draft and continues its numbering', () => {
    const f = fixture(); f.state.settings.companyProfile = { ...company };
    f.state.market.products.push({ id: 'p1', sku: 'SKU-1', name: '羊毛大衣', category: 'garment', status: 'active', specification: '100% wool', createdAt: '', updatedAt: '', fileIds: [], note: '' } as any);
    const id = f.run({ type: 'market.lookbook.save', payload: { input: { name: '秋冬画册', customerId: 'customer', productIds: ['p1'], fileIds: [], note: '首版' } } }).id!;
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Prepared' } });
    const first = generate(f, { type: 'market.lookbook.document', payload: { id } });
    const history = structuredClone((f.state.market.lookbooks[0] as any).documents);
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Draft' } });
    // A client cannot replace the archived records or nominate a current file while saving a draft.
    f.run({ type: 'market.lookbook.save', payload: { id, input: { name: '秋冬画册', customerId: 'customer', productIds: ['p1'], fileIds: [first.fileId], note: '新版说明', documents: [], currentDocumentId: history[0].id } } } as any);
    expect((f.state.market.lookbooks[0] as any).documents).toEqual(history);
    expect((f.state.market.lookbooks[0] as any).currentDocumentId).toBeUndefined();
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Prepared' } });
    const second = generate(f, { type: 'market.lookbook.document', payload: { id } });
    const records = (f.state.market.lookbooks[0] as any).documents;
    expect(second.snapshot.number).toBe(first.snapshot.number + '-2');
    expect(records).toHaveLength(2); expect(records[0]).toEqual(history[0]);
    expect(records[1].snapshot.paragraphs).toEqual([{ text: '新版说明' }]);
  });
  it('selects a newly generated current PDF, clears that selection for a new preparation and keeps it on archive', () => {
    const f = fixture(); f.state.settings.companyProfile = { ...company };
    f.state.market.products.push({ id: 'p1', sku: 'SKU-1', name: '羊毛大衣', category: 'garment', status: 'active', specification: '100% wool', createdAt: '', updatedAt: '', fileIds: [], note: '' } as any);
    const id = f.run({ type: 'market.lookbook.save', payload: { input: { name: '秋冬画册', customerId: 'customer', productIds: ['p1'], fileIds: [], note: '' } } }).id!;
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Prepared' } });
    generate(f, { type: 'market.lookbook.document', payload: { id } });
    let book = f.state.market.lookbooks[0] as any;
    expect(book.currentDocumentId).toBe(book.documents.at(-1).id);
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Draft' } });
    expect((f.state.market.lookbooks[0] as any).currentDocumentId).toBeUndefined();
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Prepared' } });
    expect((f.state.market.lookbooks[0] as any).currentDocumentId).toBeUndefined();
    generate(f, { type: 'market.lookbook.document', payload: { id } });
    book = f.state.market.lookbooks[0] as any;
    expect(book.currentDocumentId).toBe(book.documents.at(-1).id);
    const current = book.currentDocumentId;
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Archived' } });
    expect((f.state.market.lookbooks[0] as any).currentDocumentId).toBe(current);
  });
});

it('writes amounts in words the way invoices and drafts do', () => {
  expect(amountInWords(12345.67, 'USD')).toBe('SAY TOTAL US DOLLARS TWELVE THOUSAND THREE HUNDRED AND FORTY-FIVE AND CENTS SIXTY-SEVEN ONLY');
  expect(amountInWords(1000000, 'EUR')).toBe('SAY TOTAL EUROS ONE MILLION ONLY');
});


describe('external goods descriptions and customs facts',()=>{
 it.each([undefined,'COTTON COAT'])('uses English then Chinese externally, with unchanged fallback: %s',nameEn=>{
  const {f,shipmentId}=ready(),line=f.state.orderLines[0];line.nameEn=nameEn;
  f.state.orders[0].governance!.approvedSnapshot!.lines[0].nameEn=nameEn;
  f.state.fulfillment.packing.push({id:'pack',shipmentId,lineId:line.id,productionId:f.state.fulfillment.shipments[0].lines[0].productionId,carton:'1',quantity:10,netWeight:2,grossWeight:3,volume:1,note:''});
  const expected=nameEn?`${nameEn} / ${line.name}`:line.name;
  for(const type of ['CI','PL','SO','SI','DN','CDA'] as const){
   const {snapshot}=generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type,...(type==='CI'?{orderId:f.orderId,dueDate:'2026-12-01'}:{})}});
   const row=snapshot.table!.rows[0];expect(type==='PL'?row.style:row.desc).toContain(expected);
   expect(renderGeneratedDocumentHtml(snapshot)).toContain(expected);
  }
  for(const kind of ['PI','SC'] as const){
   const snapshot=prepareGeneratedSnapshot(f.state,{type:'order.document.generate',payload:{orderId:f.orderId,kind}},f.context);
   expect(snapshot.table!.rows[0].desc).toContain(expected);
  }
  f.state.fulfillment.shipments[0].state='departed';
  expect(prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'SA'}},f.context).table!.rows[0].desc).toBe(expected);
 });
 it.each(['瑞典',''])('fills CD from the customs record and known country only: %s',country=>{
  const {f,shipmentId}=ready(),line=f.state.orderLines[0];line.price=3.2;line.nameEn='COTTON COAT';f.state.customers[0].country=country;
  f.state.fulfillment.customs.push({id:'customs',shipmentId,code:'CUS-1',status:'draft',channel:'general',declarationNo:'',broker:'模拟报关行',origin:'中国',tradeMode:'一般贸易',declaredAt:'',clearedAt:'',evidence:'',fileIds:[],note:''});
  f.run({type:'fulfillment.customs.classify.save',payload:{family:'garment',hsCode:'6203310000',declaredName:'男式羊毛西服上衣',brandType:'3',preference:'0',elements:['机织','西服上衣','男式','100%羊毛','无品牌'],styles:[line.style],legalUnit:'件',secondUnit:''}});
  const {snapshot}=generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CD'}});
  expect(Object.fromEntries(snapshot.facts.map(fact=>[fact.label.zh,fact.value]))).toMatchObject({'监管方式':'一般贸易','原产国':'中国','申报单位 / 报关行':'模拟报关行','运抵国 / 最终目的国':country});
  expect(snapshot.table!.rows[0]).toMatchObject({price:'3.20',amount:'32.00 USD'});
  expect(snapshot.table!.rows[0].name).toContain('男式羊毛西服上衣');expect(snapshot.table!.rows[0].name).not.toContain('COTTON COAT');
  const html=renderGeneratedDocumentHtml(snapshot);for(const text of ['监管方式','一般贸易','原产国','中国','模拟报关行','3.20'])expect(html).toContain(text);
 });
 it('does not add customs facts without a customs record',()=>{
  const {f,shipmentId}=ready();const {snapshot}=generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CD'}});
  expect(snapshot.facts.some(fact=>fact.label.zh==='监管方式')).toBe(false);
  expect(snapshot.paragraphs[0].text).toContain('尚未建立商品归类');
 });
});
