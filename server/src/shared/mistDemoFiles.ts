/**
 * 版本化种子工作区的附件模板。附件内容由当前工作区数据实时生成为可下载的 PDF（英文，单页）。
 * 只有 storageKey 以 DEMO_FILE_PREFIX 开头的记录会被服务端写入存储；前缀仅是内部兼容键，不进入正文。
 */
import type { MistFile, MistState } from './mistWorkspace';

export const DEMO_FILE_PREFIX = 'demo-seed/';
export type DemoFileTemplate = 'customer-po' | 'commercial-invoice' | 'packing-list' | 'customs-release' | 'supplier-contract' | 'vat-invoice' | 'letter-of-credit';

export function demoFileRecord(id: string, template: DemoFileTemplate, ref: string, name: string, createdAt: string): MistFile {
  return { id, name, mimeType: 'application/pdf', size: 0, storageKey: `${DEMO_FILE_PREFIX}${template}/${encodeURIComponent(ref)}`, createdAt };
}

export function isDemoFile(file: MistFile) { return file.storageKey.startsWith(DEMO_FILE_PREFIX); }

/** 按模板从工作区数据生成 PDF 字节。找不到引用对象时仍生成说明页，不抛错。 */
export function renderDemoFile(state: MistState, file: MistFile): Uint8Array {
  const [template, rawRef] = file.storageKey.slice(DEMO_FILE_PREFIX.length).split('/') as [DemoFileTemplate, string];
  const ref = decodeURIComponent(rawRef || '');
  const order = state.orders.find(o => o.id === ref || o.code === ref);
  const customer = order ? state.customers.find(c => c.id === order.customerId) : undefined;
  const lines = order ? state.orderLines.filter(l => l.orderId === order.id) : [];
  const purchase = state.fulfillment?.purchases.find(p => p.id === ref);
  const shipment = state.fulfillment?.shipments.find(s => s.id === ref);
  const body: string[] = [];
  const company = ascii(state.settings.companyProfile?.englishName || state.settings.companyProfile?.legalName || 'Claridge Peak Textile & Apparel Trading (Shanghai) Co., Ltd.');
  const title = { 'customer-po': 'PURCHASE ORDER', 'commercial-invoice': 'COMMERCIAL INVOICE', 'packing-list': 'PACKING LIST', 'customs-release': 'CUSTOMS RELEASE NOTICE', 'supplier-contract': 'SUPPLY CONTRACT', 'vat-invoice': 'VAT SPECIAL INVOICE (FAPIAO)', 'letter-of-credit': 'DOCUMENTARY CREDIT (MT700 ADVICE)' }[template] || 'DOCUMENT';
  if (template === 'customer-po' && order) {
    body.push(`Buyer: ${ascii(customer?.name || order.customer)}`, `Seller: ${company}`, `Order: ${order.code}    Season: ${ascii(order.season)}    Currency: ${order.currency}`, `Delivery: ${order.due}    Terms: ${ascii(customer?.incoterm || 'FOB Shanghai')}    Payment: ${ascii(customer?.terms || 'T/T')}`, '');
    body.push('Style                         Qty        Unit price');
    for (const l of lines) body.push(`${pad(ascii(l.style), 30)}${pad(String(l.qty) + ' ' + unit(l.unit), 11)}${order.currency} ${l.price.toFixed(2)}`);
    body.push('', `Total quantity: ${lines.reduce((s, l) => s + l.qty, 0)}`, '', 'Confirmed by buyer (signature on file).');
  } else if ((template === 'commercial-invoice' || template === 'packing-list' || template === 'customs-release') && shipment) {
    const shipped = shipment.lines.map(l => ({ line: state.orderLines.find(x => x.id === l.lineId), qty: l.quantity }));
    const shipOrder = state.orders.find(o => o.id === shipment.lines[0]?.orderId);
    body.push(`Shipment: ${shipment.code}    Mode: ${shipment.mode.toUpperCase()}    Booking: ${ascii(shipment.booking)}`, `From: ${ascii(shipment.portOfLoading)}    To: ${ascii(shipment.portOfDischarge)}    Incoterm: ${ascii(shipment.incoterm)}`, `Consignee: ${ascii(shipment.consignee)}`, '');
    if (template === 'packing-list') { const packs = state.fulfillment.packing.filter(p => p.shipmentId === shipment.id); body.push('Cartons          Qty     N.W. kg   G.W. kg   CBM'); for (const p of packs) body.push(`${pad(ascii(p.carton), 17)}${pad(String(p.quantity), 8)}${pad(String(p.netWeight), 10)}${pad(String(p.grossWeight), 10)}${p.volume}`); }
    else if (template === 'commercial-invoice') { body.push('Style                         Qty        Amount'); for (const s of shipped) body.push(`${pad(ascii(s.line?.style || ''), 30)}${pad(String(s.qty), 11)}${shipOrder?.currency || ''} ${((s.line?.price || 0) * s.qty).toFixed(2)}`); }
    else { const c = state.fulfillment.customs.find(x => x.shipmentId === shipment.id); body.push(`Declaration: ${ascii(c?.declarationNo || '')}`, `HS code: ${ascii(c?.hsCode || '')}    Declared: ${c?.declaredAt || ''}    Released: ${c?.clearedAt || ''}`, `Broker: Shanghai customs broker (on file)`); }
  } else if (template === 'supplier-contract' && purchase) {
    body.push(`Supplier: ${ascii(purchase.supplier)}`, `Contract: ${purchase.code}    Order: ${state.orders.find(o => o.id === purchase.orderId)?.code || ''}`, `Quantity: ${purchase.quantity} ${unit(purchase.unit)}    Unit price: ${purchase.currency} ${purchase.price}`, `Due: ${purchase.due}`);
  } else if (template === 'vat-invoice' && purchase) {
    const bill = state.payables?.bills.find(b => b.lines.some(l => l.purchaseId === purchase.id));
    body.push(`Seller: ${ascii(purchase.supplier)}`, `Buyer: ${company}`, `Invoice No.: ${ascii(bill?.invoiceNo || '')}    Date: ${bill?.invoiceDate || ''}`, `Contract: ${purchase.code}    Order: ${state.orders.find(o => o.id === purchase.orderId)?.code || ''}`, `Goods: ${purchase.quantity} ${unit(purchase.unit)}`,
      `Amount incl. VAT: ${purchase.currency} ${(bill?.amount ?? 0).toFixed(2)}    VAT ${ascii(bill?.taxRate || '')}: ${purchase.currency} ${(bill?.taxAmount ?? 0).toFixed(2)}`, '', 'Purpose: export VAT refund (confirmed in e-tax system).');
  } else if (template === 'letter-of-credit' && state.letterOfCredits?.some(l => l.lcNo === ref)) {
    const lc = state.letterOfCredits!.find(l => l.lcNo === ref)!;
    body.push(`:20: Documentary credit number: ${ascii(lc.lcNo)}`, `:31C: Date of issue: ${lc.issueDate}`, `:31D: Date and place of expiry: ${lc.expiryDate} CHINA`, `:52A: Issuing bank: ${ascii(lc.issuingBank)}`, `:50: Applicant: ${ascii(lc.customer)}`, `:59: Beneficiary: ${company}`,
      `:32B: Amount: ${lc.currency} ${lc.amount.toFixed(2)}    :39A: Tolerance: ${lc.tolerancePct}/${lc.tolerancePct}`, `:41D: Available with any bank by negotiation    :42C: Drafts at ${lc.availableBy === 'sight' ? 'SIGHT' : `${lc.usanceDays} DAYS AFTER B/L DATE`}`,
      `:43P: Partial shipments: ${lc.partialShipment ? 'ALLOWED' : 'NOT ALLOWED'}    :43T: Transhipment: ${lc.transhipment ? 'ALLOWED' : 'NOT ALLOWED'}`, `:44C: Latest date of shipment: ${lc.latestShipmentDate}`,
      `:45A: Goods: garments as per order ${state.orders.filter(o => lc.orderIds.includes(o.id)).map(o => o.code).join(', ')}`, ':46A: Documents required: commercial invoice, full set clean on board B/L, packing list, certificate of origin', `:48: Period for presentation: ${lc.presentationDays} days after shipment date, within validity`, ':49: Confirmation instructions: WITHOUT', '', `Advised by: ${ascii(lc.advisingBank)}`, 'Subject to UCP 600.');
  } else body.push('The referenced record is no longer in this workspace.');
  body.push('', '', `Generated from the approved workspace record of ${company}.`);
  return pdf(title, body);
}

/** 种子 PDF 只用标准 ASCII 字体：先把业务数据里的中文专有名词换成英文，其余非 ASCII 字符去掉，空值显示为 "-"。 */
const GLOSSARY: Record<string, string> = {
  '上海洋山': 'Shanghai Yangshan', '上海外高桥': 'Shanghai Waigaoqiao', '上海': 'Shanghai', '宁波': 'Ningbo', '深圳': 'Shenzhen', '青岛': 'Qingdao',
  '哥德堡': 'Gothenburg', '汉堡': 'Hamburg', '鹿特丹': 'Rotterdam', '安特卫普': 'Antwerp', '费利克斯托': 'Felixstowe', '洛杉矶': 'Los Angeles', '纽约': 'New York', '东京': 'Tokyo', '横滨': 'Yokohama',
  '江南成衣': 'Jiangnan Garment Co., Ltd.', '远山服装': 'Yuanshan Apparel Co., Ltd.', '华盛毛纺': 'Huasheng Wool Textile Co., Ltd.', '宝泰辅料': 'Baotai Trims Co., Ltd.',
  '绍兴岚桥纺织': 'Shaoxing Lanqiao Textile Co., Ltd.', '湖州嘉纬染整': 'Huzhou Jiawei Finishing Co., Ltd.',
  '宁波新拓辅料': 'Ningbo Xintuo Trims Co., Ltd.', '苏州云帛数码': 'Suzhou Yunbo Digital Print Co., Ltd.',
  '平湖启程服饰': 'Pinghu Qicheng Apparel Co., Ltd.', '南通衡远制衣': 'Nantong Hengyuan Garment Co., Ltd.',
};
const GLOSSARY_KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
export function ascii(value: string) {
  let text = value || '';
  for (const key of GLOSSARY_KEYS) text = text.split(key).join(` ${GLOSSARY[key]} `);
  return text.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim() || '-';
}
function unit(value: string) { return ({ '件': 'pcs', '米': 'm', '码': 'yd', '粒': 'pcs', '套': 'sets', '公斤': 'kg' } as Record<string, string>)[value] || ascii(value) || 'units'; }
function pad(value: string, width: number) { return value.length >= width ? value.slice(0, width - 1) + ' ' : value + ' '.repeat(width - value.length); }

/** 最小 PDF 1.4：单页 A4，Helvetica / Courier，纯 ASCII。 */
function pdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  lines=lines.flatMap(line=>{const rows:string[]=[];while(line.length>78){const space=line.lastIndexOf(' ',78),cut=space>25?space:78;rows.push(line.slice(0,cut));line=line.slice(cut).trimStart();}rows.push(line);return rows;});
  const stream = ['BT', '/F1 20 Tf', '56 780 Td', `(${esc(title)}) Tj`, 'ET', 'BT', '/F2 10 Tf', '14 TL', '56 740 Td', ...lines.map(l => `(${esc(l)}) '`), 'ET'].join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
