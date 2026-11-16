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
function customsReady() {
  const { f, shipmentId } = ready(), line = f.state.orderLines[0], productionId = f.state.fulfillment.shipments.find(s => s.id === shipmentId)!.lines[0].productionId;
  f.run({ type: 'fulfillment.shipments.pack', payload: { id: shipmentId, lines: [{ lineId: line.id, productionId, carton: 'C1', quantity: 10, netWeight: 5, grossWeight: 6, volume: 0.5, note: '' }] } });
  const id = f.run({ type: 'fulfillment.customs.save', payload: { shipmentId, status: 'draft', declarationNo: '', broker: '报关行', hsCode: '', origin: '中国', tradeMode: '一般贸易', declaredAt: '', clearedAt: '', evidence: '', fileIds: [], note: '' } }).id!;
  f.run({ type: 'fulfillment.customs.classify.save', payload: { family: 'garment', hsCode: '6203310000', declaredName: '男式羊毛西服上衣', brandType: '3', preference: '0', elements: ['机织', '西服上衣', '男式', '100%羊毛', '无品牌'], styles: [line.style], legalUnit: '件', secondUnit: '千克' } });
  f.run({ type: 'fulfillment.customs.items', payload: { id } });
  return { f, shipmentId, id };
}

describe('shipment document generation', () => {
  it('keeps ordinary sales CI payable rather than labelling its value as a free replacement',()=>{
    const {f,shipmentId}=ready();
    const snapshot=prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,orderId:f.orderId,type:'CI',dueDate:'2026-12-01'}},f.context);
    expect(renderGeneratedDocumentHtml(snapshot)).not.toMatch(/no charge|value for customs purposes only/i);
  });
  it('keeps each consolidated CI package and weight totals within its own order',()=>{
    const {f,shipmentId}=ready(),s=f.state.fulfillment.shipments.find(x=>x.id===shipmentId)!,order=f.state.orders.find(x=>x.id===f.orderId)!,line=f.state.orderLines.find(x=>x.orderId===order.id)!;
    Object.assign(order,{type:'fabric',currency:'EUR'});Object.assign(line,{qty:130.5,unit:'米',price:7.8});
    const secondOrder={...structuredClone(order),id:'order-b',code:'SO-F-B'},yards={...structuredClone(line),id:'line-yards',qty:110,unit:'码',price:1.75},secondLine={...structuredClone(line),id:'line-b',orderId:secondOrder.id,qty:70};
    f.state.orders.push(secondOrder);f.state.orderLines.push(yards,secondLine);s.domain='fabric';
    s.lines=[{...s.lines[0],quantity:130.5},{...s.lines[0],lineId:yards.id,productionId:'job-yards',quantity:110},{...s.lines[0],orderId:secondOrder.id,lineId:secondLine.id,productionId:'job-b',quantity:70}];
    const rows=[{lineId:line.id,productionId:s.lines[0].productionId,carton:'A1',quantity:65.25,netWeight:40.56,grossWeight:41.56,volume:0.12},{lineId:line.id,productionId:s.lines[0].productionId,carton:'A2',quantity:65.25,netWeight:40.56,grossWeight:41.56,volume:0.12},{lineId:yards.id,productionId:'job-yards',carton:'T1',quantity:60,netWeight:7.82,grossWeight:8.32,volume:0.035},{lineId:yards.id,productionId:'job-yards',carton:'T2',quantity:50,netWeight:6.52,grossWeight:7.02,volume:0.03},{lineId:secondLine.id,productionId:'job-b',carton:'B1',quantity:70,netWeight:43.51,grossWeight:44.51,volume:0.13}];
    f.state.fulfillment.packing=rows.map((r,i)=>({...r,id:'packed-'+i,shipmentId,note:''}));
    const snapshot=(type:string,orderId?:string)=>prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,type,...(orderId?{orderId,dueDate:'2026-12-01'}:{})}},f.context);
    const a=snapshot('CI',order.id),b=snapshot('CI',secondOrder.id),pl=snapshot('PL');
    const weights=(doc:typeof a)=>doc.facts?.find(x=>x.label.en==='Packages / Weights')?.value;
    expect(weights(a)).toBe('4 · N.W. 95.46 kg · G.W. 98.46 kg');expect(weights(b)).toBe('1 · N.W. 43.51 kg · G.W. 44.51 kg');
    expect(a.table!.totals!.amount).toBe('EUR 1,210.40');expect(b.table!.totals!.amount).toBe('EUR 546.00');
    expect(pl.facts?.find(x=>x.label.en==='Packages')?.value).toBe('5');expect(pl.table!.totals).toMatchObject({qty:'200.5 米 / 110 码',nw:'138.97',gw:'142.97',cbm:'0.435'});
    f.state.fulfillment.packing=f.state.fulfillment.packing.filter(x=>x.lineId!==secondLine.id);
    expect(weights(snapshot('CI',secondOrder.id))).toBeUndefined();
  });
  it('prints each partial garment CI assortment from its exact shipment and production packing',()=>{
    const {f,shipmentId}=ready(),line=f.state.orderLines[0],s=f.state.fulfillment.shipments.find(row=>row.id===shipmentId)!;
    line.qty=12;line.price=42;line.breakdown={kind:'garment',sizes:['S','M','L','XL'],rows:[{color:'Blue',quantities:[2,4,4,2]}]};
    const source=s.lines[0];source.quantity=8;
    const second={...structuredClone(s),id:'shipment-second',code:'SHP-B',lines:[{...source,quantity:4}]};f.state.fulfillment.shipments.push(second);
    const pack=(id:string,shipmentId:string,productionId:string|undefined,counts:number[])=>({id,shipmentId,lineId:line.id,productionId,carton:id,quantity:counts.reduce((a,b)=>a+b,0),netWeight:1,grossWeight:2,volume:0.1,note:'',assortment:counts.map((quantity,i)=>({color:'Blue',size:['S','M','L','XL'][i],quantity}))});
    f.state.fulfillment.packing=[pack('A1',s.id,source.productionId,[1,1,1,1]),pack('A2',s.id,source.productionId,[1,1,1,1]),pack('B1',second.id,source.productionId,[0,2,2,0]),pack('other-branch',s.id,'other-production',[0,20,0,0])];
    const ci=(id:string)=>prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId:id,type:'CI',orderId:f.orderId,dueDate:'2026-12-01'}},f.context);
    const before=structuredClone(f.state),a=ci(s.id),b=ci(second.id);
    expect(a.table!.rows[0]).toMatchObject({qty:'8 件',price:'42.00',amount:'336.00'});expect(a.table!.rows[0].desc).toContain('Blue：S 2 / M 2 / L 2 / XL 2（合计 8 件）');
    expect(b.table!.rows[0]).toMatchObject({qty:'4 件',amount:'168.00'});expect(b.table!.rows[0].desc).toContain('Blue：M 2 / L 2（合计 4 件）');
    expect(a.table!.rows[0].desc).not.toContain('12 件');expect(b.table!.rows[0].desc).not.toContain('XL');expect(f.state).toEqual(before);
  });
  it('never invents partial garment assortment before actual detailed packing is available',()=>{
    const {f,shipmentId}=ready(),line=f.state.orderLines[0],s=f.state.fulfillment.shipments.find(row=>row.id===shipmentId)!;
    line.breakdown={kind:'garment',sizes:['S','M'],rows:[{color:'Blue',quantities:[4,6]}]};s.lines[0].quantity=4;
    const snapshot=prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CI',orderId:f.orderId,dueDate:'2026-12-01'}},f.context);
    expect(snapshot.table!.rows[0].desc).toBe(line.name);expect(snapshot.table!.rows[0].qty).toBe('4 件');
  });
  it('keeps fabric physical specifications but prints only the actual batch colour quantity and source unit',()=>{
    const {f,shipmentId}=ready(),line=f.state.orderLines[0],s=f.state.fulfillment.shipments.find(row=>row.id===shipmentId)!;
    f.state.orders[0].type='fabric';s.domain='fabric';line.unit='码';line.qty=100;line.breakdown={kind:'fabric',width:150,weight:180,composition:'Cotton',rows:[{color:'Blue',quantity:60},{color:'White',quantity:40}]};s.lines[0].quantity=32.5;
    f.state.fulfillment.packing=[{id:'P1',shipmentId,lineId:line.id,productionId:s.lines[0].productionId,carton:'R1',quantity:32.5,netWeight:2,grossWeight:3,volume:0.1,note:'',fabricColor:'Blue'}];
    const snapshot=prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CI',orderId:f.orderId,dueDate:'2026-12-01'}},f.context),desc=snapshot.table!.rows[0].desc;
    expect(desc).toContain('门幅 150 cm');expect(desc).toContain('克重 180 g/m²');expect(desc).toContain('Cotton');expect(desc).toContain('Blue 32.5（合计 32.5 码）');expect(desc).not.toContain('White');expect(desc).not.toContain('100 码');
  });
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
 it('CD honors the saved manual declaration fields in its snapshot and rendered document',()=>{
  const {f,shipmentId,id}=customsReady();
  f.run({type:'fulfillment.customs.item.adjust',payload:{id,no:1,declaredName:'本批毛制上衣',elements:'本批70%羊毛30%涤纶',legalQty:10,secondQty:5.25,reason:'按本批实物及重新称重的申报依据核对'}});
  const before=structuredClone(f.state),snapshot=prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CD'}},f.context);
  expect(snapshot.table!.rows[0]).toMatchObject({name:'本批毛制上衣\n本批70%羊毛30%涤纶',qty:'10 件\n10 件\n5.25 千克',price:'10.00',amount:'100.00 USD'});
  expect(renderGeneratedDocumentHtml(snapshot)).toContain('本批70%羊毛30%涤纶');expect(renderGeneratedDocumentHtml(snapshot)).not.toContain('100%羊毛');expect(f.state).toEqual(before);
 });
 it.each(['quantity','price','netWeight','packages'] as const)('CD refuses stale saved declaration items after %s changes',change=>{
  const {f,shipmentId}=customsReady(),shipment=f.state.fulfillment.shipments.find(s=>s.id===shipmentId)!;
  if(change==='quantity')shipment.lines[0].quantity=9;
  if(change==='price')f.state.orderLines[0].price=11;
  const packing=f.state.fulfillment.packing.find(r=>r.shipmentId===shipmentId)!;
  if(change==='netWeight')packing.netWeight=6;
  if(change==='packages'){packing.quantity=5;packing.netWeight=2.5;packing.grossWeight=3;f.state.fulfillment.packing.push({...packing,id:'second-carton',carton:'C2'});}
  const before=structuredClone(f.state);expect(documentGenerationBlocker(f.state,shipment,'CD')).toContain('重新生成商品项');
  expect(()=>prepareGeneratedSnapshot(f.state,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CD'}},f.context)).toThrow('重新生成商品项');expect(f.state).toEqual(before);
 });
});

const acceptanceTerms={kind:'deliveryAcceptance' as const,days:30,terms:'交付验收后30天付款'};
function withAcceptanceContract(){const r=ready(),order=r.f.state.orders.find(o=>o.id===r.f.orderId)!;Object.assign(order.governance!.contract,{paymentMethod:'OA',paymentNote:acceptanceTerms.terms,depositPercent:0,preShipmentPercent:0});if(order.governance!.approvedSnapshot)order.governance!.approvedSnapshot.contract=structuredClone(order.governance!.contract);return r;}
function pendingAcceptanceInvoice(){
 const {f,shipmentId}=withAcceptanceContract();
 f.state.fulfillment.documents.push({id:'acceptance-ci',shipmentId,orderId:f.orderId,type:'CI',number:'CI-ACCEPTANCE',version:1,title:'CI',dueDate:'',content:'O/A 30 days after delivery acceptance',fileIds:['contract'],status:'issued',createdAt:f.context.now,actor:'业务',invoiceId:'acceptance-ar',receivableDueCondition:acceptanceTerms} as any);
 f.state.invoices.push({id:'acceptance-ar',code:'CI-ACCEPTANCE',orderId:f.orderId,order:'SO-LOCAL',customer:'客户',currency:'USD',amount:100,open:0,due:'',financeStatus:'pending',sourceDocumentId:'acceptance-ci',receivableDueCondition:acceptanceTerms} as any);
 const shipment=f.state.fulfillment.shipments.find(s=>s.id===shipmentId)!;shipment.state='departed';shipment.departedAt='2026-10-19T04:00:00.000Z';
 return {f,shipmentId,shipment,invoiceId:'acceptance-ar'};
}
it('generates and issues an acceptance-based CI with contract terms and an unresolved date',()=>{
 const {f,shipmentId}=withAcceptanceContract();
 const {result,snapshot}=generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CI',orderId:f.orderId}});
 const d=f.state.fulfillment.documents.find(d=>d.id===result.id)!;
 expect(d).toMatchObject({dueDate:'',receivableDueCondition:acceptanceTerms});
 expect(snapshot.facts.some(f=>String(f.value).includes(acceptanceTerms.terms))).toBe(true);
 expect(snapshot.paragraphs.some(p=>p.text.includes('2026-'))).toBe(false);
 f.run({type:'fulfillment.documents.issue',payload:{id:d.id}});
 expect(f.state.invoices.at(-1)).toMatchObject({financeStatus:'pending',open:0,due:'',receivableDueCondition:acceptanceTerms});
});
it('refuses a fixed date that would override an acceptance-based generated CI',()=>{
 const {f,shipmentId}=withAcceptanceContract();
 expect(()=>generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CI',orderId:f.orderId,dueDate:'2026-12-19'}})).toThrow('验收');
});
it('keeps manually registered acceptance-based CI terms unresolved as well',()=>{
 const {f,shipmentId}=withAcceptanceContract();
 const made=f.run({type:'fulfillment.documents.save',payload:{shipmentId,orderId:f.orderId,type:'CI',number:'MANUAL-ACCEPTANCE',title:'CI',dueDate:'',content:'O/A 30 days after delivery acceptance',fileIds:['contract']}});
 expect(f.state.fulfillment.documents.find(d=>d.id===made.id)).toMatchObject({dueDate:'',receivableDueCondition:acceptanceTerms});
});
it('allows finance to confirm the amount while the due date awaits actual acceptance',()=>{
 const {f,invoiceId}=pendingAcceptanceInvoice(),ctx={...f.context,now:'2026-10-22T04:00:00Z',actorId:'fin',actorName:'财务'};
 f.run({type:'finance.receivable.confirm',payload:{invoiceId}},ctx);
 expect(f.state.invoices.find(i=>i.id===invoiceId)).toMatchObject({financeStatus:'confirmed',open:100,due:''});
 const before=structuredClone(f.state);expect(()=>f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-21',acceptanceBasis:'AC1'}},ctx)).toThrow('签收');expect(f.state).toEqual(before);
});
it('computes and corrects only the due date from actual acceptance, preserving amount and issued CI',()=>{
 const {f,shipmentId,invoiceId}=pendingAcceptanceInvoice(),ctx={...f.context,now:'2026-10-22T04:00:00Z',actorId:'fin',actorName:'财务'};
 f.run({type:'finance.receivable.confirm',payload:{invoiceId}},ctx);
 f.state.fulfillment.shipments.find(s=>s.id===shipmentId)!.delivered={at:'2026-10-20T10:00:00Z',receiver:'Customer',evidence:'POD-1',fileIds:['contract'],recordedBy:'ops'};
 for(const acceptanceDate of ['2026-10-19','2026-10-23']){const before=structuredClone(f.state);expect(()=>f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate,acceptanceBasis:'AC1'}},ctx)).toThrow();expect(f.state).toEqual(before);}
 expect(()=>f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-21',acceptanceBasis:''}},ctx)).toThrow('依据');
 f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-21',acceptanceBasis:'Customer AC1 and POD1'}},ctx);
 expect(f.state.invoices.find(i=>i.id===invoiceId)).toMatchObject({financeStatus:'confirmed',amount:100,open:100,due:'2026-11-20',dueConfirmation:{acceptanceDate:'2026-10-21',basis:'Customer AC1 and POD1',actorId:'fin',shipmentId}});
 const beforeCorrection=structuredClone(f.state);expect(()=>f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-22',acceptanceBasis:'Corrected AC2'}},ctx)).toThrow('更正原因');expect(f.state).toEqual(beforeCorrection);
 f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-22',acceptanceBasis:'Corrected AC2',reason:'Original date was recorded one day early'}},ctx);
 const invoice=f.state.invoices.find(i=>i.id===invoiceId)!;expect(invoice).toMatchObject({financeStatus:'confirmed',amount:100,open:100,due:'2026-11-21',dueConfirmation:{acceptanceDate:'2026-10-22'},dueHistory:[{acceptanceDate:'2026-10-21',due:'2026-11-20',replacementReason:'Original date was recorded one day early'}]});
 expect(f.state.fulfillment.documents.find(d=>d.id==='acceptance-ci')!.dueDate).toBe('');
});
it('issues a valid conditional CI after JSON storage reordered its metadata keys',()=>{
 const {f,shipmentId}=withAcceptanceContract(),made=generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CI',orderId:f.orderId}}),d=f.state.fulfillment.documents.find(d=>d.id===made.result.id)!;
 d.receivableDueCondition={days:30,terms:acceptanceTerms.terms,kind:'deliveryAcceptance'};
 expect(()=>f.run({type:'fulfillment.documents.issue',payload:{id:d.id}})).not.toThrow();
});
it('does not let the historical independent-invoice API bypass acceptance-based CI evidence',()=>{
 const {f}=withAcceptanceContract(),draft=f.run({type:'platform.invoice.save',payload:{orderId:f.orderId,due:'2026-12-19',amount:100,note:'旧接口草稿'}}),before=structuredClone(f.state);
 expect(()=>f.run({type:'platform.invoice.issue',payload:{id:draft.id as string}})).toThrow('验收账期');
 expect(f.state).toEqual(before);
});

it('rejects an acceptance condition that no longer matches the exact issued CI',()=>{
 const {f,shipment,invoiceId}=pendingAcceptanceInvoice();shipment.delivered={at:'2026-10-20T10:00:00Z',receiver:'Customer',evidence:'POD',fileIds:[],recordedBy:'ops'};
 f.state.invoices.find(i=>i.id===invoiceId)!.receivableDueCondition={...acceptanceTerms,days:29};const before=structuredClone(f.state);
 expect(()=>f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-21',acceptanceBasis:'AC1'}},{...f.context,now:'2026-10-22T04:00:00Z'})).toThrow('来源不一致');expect(f.state).toEqual(before);
});

it('rejects an impossible fixed due date instead of freezing it into a CI PDF',()=>{
 const {f,shipmentId}=ready();expect(()=>generate(f,{type:'fulfillment.documents.generate',payload:{shipmentId,type:'CI',orderId:f.orderId,dueDate:'2026-02-30'}})).toThrow('到期日');expect(f.state.fulfillment.documents.some(d=>d.type==='CI')).toBe(false);
});

it('does not accept caller-supplied money or credit days in a due-date review',()=>{
 const {f,shipment,invoiceId}=pendingAcceptanceInvoice();shipment.delivered={at:'2026-10-20T10:00:00Z',receiver:'Buyer',evidence:'POD',fileIds:[],recordedBy:'Ops'};const before=structuredClone(f.state);
 expect(()=>f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-21',acceptanceBasis:'AC1',days:90,amount:1}} as any,{...f.context,now:'2026-10-22T04:00:00Z'})).toThrow('字段无效');expect(f.state).toEqual(before);
});

it('can verify an actual due date without also confirming the pending invoice amount',()=>{
 const {f,shipment,invoiceId}=pendingAcceptanceInvoice();shipment.delivered={at:'2026-10-20T10:00:00Z',receiver:'Buyer',evidence:'POD',fileIds:[],recordedBy:'Ops'};
 f.run({type:'finance.receivable.due',payload:{invoiceId,acceptanceDate:'2026-10-21',acceptanceBasis:'Customer AC1'}},{...f.context,now:'2026-10-22T04:00:00Z'});
 expect(f.state.invoices.find(i=>i.id===invoiceId)).toMatchObject({financeStatus:'pending',open:0,amount:100,due:'2026-11-20'});expect(f.state.invoices.find(i=>i.id===invoiceId)!.financeConfirmedAt).toBeUndefined();
});
