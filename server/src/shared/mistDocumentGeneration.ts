/**
 * P1-3 document generation. Builds frozen snapshots from current business records and applies the generate commands.
 *
 * - `fulfillment.documents.generate` (shipment documents, `customs:write`): creates or refreshes a draft of an own document
 *   type for one shipment (CI per order), fills number, title and content from the records, renders the PDF and attaches it.
 *   CI/PL drafts generated here are issued through the existing `fulfillment.documents.issue`, which keeps the receivable rule.
 * - `order.document.generate` (`orders:write`): proforma invoice or sales contract from the approved order snapshot.
 * - `market.lookbook.document` (`marketing:write`): PDF of a prepared lookbook from its product snapshots.
 * - `fulfillment.documents.bl` (`customs:write`): B/L facts on an external BL draft (number, release form, originals,
 *   SI link, draft confirmation and telex / seaway release).
 * Content always comes from the server; a payload carrying content is refused.
 */
import { MistCommandError, lineAmount, type MistContext, type MistState, type MistOrder, type MistOrderLine } from './mistWorkspace';
import type { FulfillmentDocument, FulfillmentShipment } from './mistFulfillment';
import { platformBusinessDate } from './mistPlatform';
import { draftCustomsDeclaration } from './mistCustomsDeclaration';
import { breakdownSummary, type OrderLineBreakdown } from './mistOrderBreakdown';
import { readLetterOfCredits } from './mistLetterOfCredit';
import { replacementDeclaredUnitPrice } from './mistClaimReplacement';
import { amountInWords, generatedDocContent, generatedDocFingerprint, GENERATED_DOCUMENT_TEMPLATE_VERSION, issuerOf, money2, qtyText, type GeneratedDocArtifact, type GeneratedDocRecord, type GeneratedDocSnapshot } from './mistGeneratedDocument';
import { DOCUMENT_TYPE_LABEL, isOwnDocumentType, PER_ORDER_TYPES, POST_DEPARTURE_TYPES, BL_KIND_LABEL, type BillOfLadingDetails, type BillOfLadingKind, type OwnDocumentType } from './mistDocumentTypes';
import type { MarketLookbook } from './mistMarket';

export type DocumentGenerationCommand =
  | { type: 'fulfillment.documents.generate'; payload: { shipmentId: string; type: OwnDocumentType; orderId?: string; dueDate?: string } }
  | { type: 'fulfillment.documents.bl'; payload: { id: string; blNo: string; kind: BillOfLadingKind; originals: number; siDocumentId?: string; confirmDraft?: string; release?: string } }
  | { type: 'order.document.generate'; payload: { orderId: string; kind: 'PI' | 'SC' } }
  | { type: 'market.lookbook.document'; payload: { id: string } };
export const DOCUMENT_GENERATION_COMMANDS = ['fulfillment.documents.generate', 'fulfillment.documents.bl', 'order.document.generate', 'market.lookbook.document'] as const;
export const GENERATING_COMMANDS: ReadonlySet<string> = new Set(['fulfillment.documents.generate', 'order.document.generate', 'market.lookbook.document']);
export const documentGenerationPermission = (command: DocumentGenerationCommand) => command.type === 'order.document.generate' ? 'orders:write' : command.type === 'market.lookbook.document' ? 'marketing:write' : 'customs:write';
export const ORDER_DOCUMENT_LABEL = { PI: { zh: '形式发票', en: 'PROFORMA INVOICE' }, SC: { zh: '销售合同', en: 'SALES CONTRACT' } } as const;
export type OrderDocumentRecord = GeneratedDocRecord & { orderKind: 'PI' | 'SC'; version: number };

const fail = (message: string, code = 'PRECONDITION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const text = (v: unknown, label: string, max = 2000) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail(`${label}未填写或格式无效`, 'VALIDATION');
const r4 = (n: number) => Math.round(n * 10000) / 10000, r2 = (n: number) => Math.round(n * 100) / 100;
const exact = (payload: unknown, keys: string[]) => { if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => !keys.includes(k))) fail('单据内容只能由服务端按业务记录生成', 'VALIDATION'); };
const EN_TITLE: Record<OwnDocumentType, string> = { CI: 'COMMERCIAL INVOICE', PL: 'PACKING LIST', SO: 'BOOKING REQUEST', SI: 'SHIPPING INSTRUCTIONS', DN: 'SHIPMENT NOTICE', SA: 'SHIPPING ADVICE', BC: "BENEFICIARY'S CERTIFICATE", DFT: 'BILL OF EXCHANGE', CD: 'EXPORT DECLARATION DRAFT', CDA: 'CUSTOMS POWER OF ATTORNEY' };
const ZH_TITLE: Record<OwnDocumentType, string> = { CI: '商业发票', PL: '装箱单', SO: '订舱委托书', SI: '提单补料', DN: '出货通知', SA: '装船通知', BC: '受益人证明', DFT: '汇票', CD: '报关单草稿', CDA: '报关委托书' };
const PREFIX: Record<OwnDocumentType, string> = { CI: 'CI', PL: 'PL', SO: 'SO', SI: 'SI', DN: 'DN', SA: 'SA', BC: 'BC', DFT: 'DFT', CD: 'CD', CDA: 'CDA' };
const MODE = { sea: { zh: '海运', en: 'By sea' }, air: { zh: '空运', en: 'By air' } } as const;

const lineOf = (root: MistState, id: string) => root.orderLines.find(l => l.id === id) as (MistOrderLine & { breakdown?: OrderLineBreakdown }) | undefined;
const shipmentOrders = (root: MistState, s: FulfillmentShipment) => [...new Set(s.lines.map(l => l.orderId))].map(id => root.orders.find(o => o.id === id)).filter(Boolean) as MistOrder[];
const lcFor = (root: MistState, s: FulfillmentShipment) => readLetterOfCredits(root).find(lc => !lc.cancelled && s.lines.some(l => lc.orderIds.includes(l.orderId)));
const packingOf = (root: MistState, s: FulfillmentShipment) => root.fulfillment.packing.filter(p => p.shipmentId === s.id);
function packingTotals(root: MistState, s: FulfillmentShipment) {
  const rows = packingOf(root, s);
  return { packages: new Set(rows.map(r => r.carton)).size, net: r2(rows.reduce((n, r) => n + r.netWeight, 0)), gross: r2(rows.reduce((n, r) => n + r.grossWeight, 0)), volume: r4(rows.reduce((n, r) => n + r.volume, 0)) };
}
/** Unit price for the CI of an order on this shipment: the order line price, or the reviewed declared value for a replacement. */
const unitPriceOf = (root: MistState, s: FulfillmentShipment, order: MistOrder, lineId: string) => order.replacementSource ? replacementDeclaredUnitPrice(root, s.id, order.id, lineId)! : lineOf(root, lineId)!.price;
const consigneeParty = (s: FulfillmentShipment) => ({ label: { zh: '收货人', en: 'Consignee' }, name: s.consignee, detail: '' });
const buyerParty = (root: MistState, s: FulfillmentShipment) => { const c = root.customers.find(x => x.id === s.customerId); return { label: { zh: '买方', en: 'Buyer' }, name: s.customer, detail: [c?.city, c?.country].filter(Boolean).join(', ') }; };
const transportFacts = (s: FulfillmentShipment) => [
  { label: { zh: '运输方式', en: 'Mode' }, value: MODE[s.mode].zh + ' / ' + MODE[s.mode].en },
  { label: { zh: '起运港', en: 'Port of loading' }, value: s.portOfLoading },
  { label: { zh: '目的港', en: 'Port of discharge' }, value: s.portOfDischarge },
  { label: { zh: '贸易术语', en: 'Incoterm' }, value: s.incoterm },
  ...(s.booking ? [{ label: { zh: '订舱号', en: 'Booking no.' }, value: s.booking }] : []),
  ...(s.plannedDate ? [{ label: { zh: '计划出运日', en: 'Planned date' }, value: s.plannedDate }] : []),
];
function goodsLines(root: MistState, s: FulfillmentShipment, orderId?: string) {
  return s.lines.filter(l => !orderId || l.orderId === orderId).map(l => {
    const line = lineOf(root, l.lineId), order = root.orders.find(o => o.id === l.orderId);
    if (!line || !order) return fail('出运明细的订单条目不可用');
    return { order, line, quantity: l.quantity, detail: line.breakdown ? breakdownSummary(line.breakdown, line.unit) : '' };
  });
}
/** External goods names keep the identifier separate from specifications. */
const externalGoodsName = (line: Pick<MistOrderLine, 'name' | 'nameEn'>) => line.nameEn?.trim() ? `${line.nameEn.trim()} / ${line.name}` : line.name;
function ciSnapshot(root: MistState, s: FulfillmentShipment, order: MistOrder) {
  const lines = goodsLines(root, s, order.id);
  const rows = lines.map(g => { const price = unitPriceOf(root, s, order, g.line.id); return { style: g.line.style, desc: externalGoodsName(g.line) + (g.detail ? '\n' + g.detail : ''), qty: `${qtyText(g.quantity)} ${g.line.unit}`, price: money2(price), amount: money2(lineAmount(g.quantity, price)), _amount: lineAmount(g.quantity, price) }; });
  const total = r2(rows.reduce((n, r) => n + r._amount, 0)), pack = packingTotals(root, s), lc = lcFor(root, s);
  return {
    parties: [buyerParty(root, s), consigneeParty(s)], total,
    facts: [{ label: { zh: '订单 / 合同号', en: 'Order / Contract' }, value: [order.code, order.governance?.contract.poNumber].filter(Boolean).join(' · ') }, ...transportFacts(s), { label: { zh: '币种', en: 'Currency' }, value: order.currency },
      ...(order.governance?.contract.paymentMethod ? [{ label: { zh: '付款方式', en: 'Payment' }, value: [order.governance.contract.paymentMethod, order.governance.contract.paymentNote].filter(Boolean).join(' · ') }] : []),
      ...(lc ? [{ label: { zh: '信用证号', en: 'L/C no.' }, value: `${lc.lcNo} · ${lc.issuingBank}` }] : []),
      ...(pack.packages ? [{ label: { zh: '件数 / 毛净重', en: 'Packages / Weights' }, value: `${pack.packages} · N.W. ${money2(pack.net)} kg · G.W. ${money2(pack.gross)} kg` }] : [])],
    table: { columns: [{ key: 'style', label: { zh: '款号', en: 'Style' } }, { key: 'desc', label: { zh: '品名 / 规格', en: 'Description' } }, { key: 'qty', label: { zh: '数量', en: 'Quantity' }, num: true }, { key: 'price', label: { zh: `单价 ${order.currency}`, en: 'Unit price' }, num: true }, { key: 'amount', label: { zh: `金额 ${order.currency}`, en: 'Amount' }, num: true }],
      rows: rows.map(({ _amount, ...r }) => r), totals: { amount: `${order.currency} ${money2(total)}` } },
    amountInWords: amountInWords(total, order.currency),
  };
}
function plSnapshot(root: MistState, s: FulfillmentShipment) {
  const rows = packingOf(root, s);
  if (!rows.length) fail('请先登记装箱分配');
  const pack = packingTotals(root, s), fabric = s.domain === 'fabric';
  return {
    parties: [buyerParty(root, s), consigneeParty(s)],
    facts: [...transportFacts(s), { label: { zh: fabric ? '件数' : '箱数', en: 'Packages' }, value: String(pack.packages) }],
    table: { columns: [{ key: 'carton', label: fabric ? { zh: '卷 / 包号', en: 'Roll / Bale' } : { zh: '箱号', en: 'Carton' } }, { key: 'style', label: { zh: '款号 / 品名', en: 'Style / Description' } }, { key: 'detail', label: { zh: fabric ? '颜色' : '分色分码', en: fabric ? 'Colour' : 'Assortment' } }, { key: 'qty', label: { zh: '数量', en: 'Quantity' }, num: true }, { key: 'nw', label: { zh: '净重 kg', en: 'N.W.' }, num: true }, { key: 'gw', label: { zh: '毛重 kg', en: 'G.W.' }, num: true }, { key: 'cbm', label: { zh: '体积 m³', en: 'CBM' }, num: true }],
      rows: rows.map(r => { const line = lineOf(root, r.lineId); return { carton: r.carton, style: `${line?.style || ''} ${line ? externalGoodsName(line) : ''}`.trim(), detail: r.fabricColor || (r.assortment || []).filter(a => a.quantity > 0).map(a => `${a.color} ${a.size}×${a.quantity}`).join(' / '), qty: `${qtyText(r.quantity)} ${line?.unit || ''}`, nw: money2(r.netWeight), gw: money2(r.grossWeight), cbm: qtyText(r.volume) }; }),
      totals: { qty: [...new Set(rows.map(r => lineOf(root, r.lineId)?.unit || ''))].map(u => `${qtyText(r4(rows.filter(r => (lineOf(root, r.lineId)?.unit || '') === u).reduce((n, r) => n + r.quantity, 0)))} ${u}`).join(' / '), nw: money2(pack.net), gw: money2(pack.gross), cbm: qtyText(pack.volume) } },
  };
}
function cargoTable(root: MistState, s: FulfillmentShipment) {
  const pack = packingTotals(root, s);
  return { columns: [{ key: 'style', label: { zh: '款号', en: 'Style' } }, { key: 'desc', label: { zh: '品名', en: 'Description' } }, { key: 'qty', label: { zh: '数量', en: 'Quantity' }, num: true }],
    rows: goodsLines(root, s).map(g => ({ style: g.line.style, desc: externalGoodsName(g.line), qty: `${qtyText(g.quantity)} ${g.line.unit}` })),
    totals: pack.packages ? { desc: `${pack.packages} PKGS · N.W. ${money2(pack.net)} kg · G.W. ${money2(pack.gross)} kg · ${qtyText(pack.volume)} m³` } : undefined };
}
function shipmentDocContent(root: MistState, s: FulfillmentShipment, type: OwnDocumentType, order: MistOrder | undefined, dueDate: string): Pick<GeneratedDocSnapshot, 'parties' | 'facts' | 'table' | 'paragraphs' | 'amountInWords'> & { total?: number } {
  const c = root.settings.companyProfile!, lc = lcFor(root, s), forwarder = { label: { zh: '货代 / 承运人', en: 'Forwarder / Carrier' }, name: '', detail: '' };
  const shipper = { label: { zh: '发货人', en: 'Shipper' }, name: c.englishName || c.legalName, detail: c.englishAddress || c.address || '' };
  const bl = root.fulfillment.documents.find(d => d.shipmentId === s.id && d.type === 'BL' && d.status !== 'void') as (FulfillmentDocument & { bl?: BillOfLadingDetails }) | undefined;
  switch (type) {
    case 'CI': { const ci = ciSnapshot(root, s, order!); return { ...ci, paragraphs: dueDate ? [{ title: { zh: '付款期限', en: 'Payment due' }, text: dueDate }] : [] }; }
    case 'PL': return { ...plSnapshot(root, s), paragraphs: [] };
    case 'SO': return { parties: [shipper, forwarder], facts: [...transportFacts(s), { label: { zh: '收货人', en: 'Consignee' }, value: s.consignee }], table: cargoTable(root, s), paragraphs: [{ title: { zh: '订舱要求', en: 'Requirements' }, text: s.note || '请按上述货物与航线安排舱位并回传订舱确认。' }] };
    case 'SI': return { parties: [shipper, consigneeParty(s)], facts: [...transportFacts(s), ...(lc ? [{ label: { zh: '信用证号', en: 'L/C no.' }, value: lc.lcNo }] : []), ...(bl?.bl ? [{ label: { zh: '提单类型 / 正本份数', en: 'B/L type / Originals' }, value: `${BL_KIND_LABEL[bl.bl.kind]} · ${bl.bl.originals}` }] : [])], table: cargoTable(root, s), paragraphs: [{ title: { zh: '通知人', en: 'Notify party' }, text: s.consignee }, ...(lc?.documentsRequired ? [{ title: { zh: '信用证单据要求', en: 'L/C documents required' }, text: lc.documentsRequired }] : [])] };
    case 'DN': return { parties: [buyerParty(root, s), consigneeParty(s)], facts: transportFacts(s), table: cargoTable(root, s), paragraphs: [{ text: `We are pleased to advise that the goods listed below are ready for shipment as ${s.code}.` }] };
    case 'SA': { const dep = s.departedAt ? platformBusinessDate(s.departedAt) : ''; return { parties: [buyerParty(root, s), consigneeParty(s)], facts: [...transportFacts(s), ...(dep ? [{ label: { zh: '实际离港', en: 'Departed' }, value: dep }] : []), ...(bl?.bl?.blNo ? [{ label: { zh: '提单号', en: 'B/L no.' }, value: bl.bl.blNo }] : []), ...(lc ? [{ label: { zh: '信用证号', en: 'L/C no.' }, value: lc.lcNo }] : [])], table: cargoTable(root, s), paragraphs: [{ text: `We hereby advise that the above goods have been shipped${dep ? ' on ' + dep : ''}.` }] }; }
    case 'BC': { if (!lc) return fail('本票没有对应的有效信用证，无需受益人证明'); return { parties: [{ label: { zh: '开证行', en: 'Issuing bank' }, name: lc.issuingBank, detail: '' }, { label: { zh: '受益人', en: 'Beneficiary' }, name: c.englishName || c.legalName, detail: c.englishAddress || '' }], facts: [{ label: { zh: '信用证号', en: 'L/C no.' }, value: lc.lcNo }, ...transportFacts(s)], paragraphs: [{ title: { zh: '证明', en: 'Certificate' }, text: `WE HEREBY CERTIFY THAT ONE SET OF NON-NEGOTIABLE SHIPPING DOCUMENTS FOR SHIPMENT ${s.code} HAS BEEN SENT TO THE APPLICANT ${s.customer.toUpperCase()} AS REQUIRED UNDER L/C ${lc.lcNo}.` }] }; }
    case 'DFT': {
      const ci = ciSnapshot(root, s, order!), ciDoc = root.fulfillment.documents.find(d => d.shipmentId === s.id && d.orderId === order!.id && d.type === 'CI' && d.status === 'issued');
      const usance = lc?.availableBy === 'usance' ? `AT ${lc.usanceDays} DAYS AFTER SIGHT` : 'AT SIGHT';
      return { parties: [{ label: { zh: '付款人', en: 'Drawee' }, name: lc ? lc.issuingBank : s.customer, detail: '' }, { label: { zh: '出票人', en: 'Drawer' }, name: c.englishName || c.legalName, detail: '' }],
        facts: [{ label: { zh: '金额', en: 'Amount' }, value: `${order!.currency} ${money2(ci.total)}` }, { label: { zh: '期限', en: 'Tenor' }, value: usance }, ...(lc ? [{ label: { zh: '信用证号', en: 'Drawn under L/C' }, value: `${lc.lcNo} · ${lc.issuingBank}` }] : []), ...(ciDoc ? [{ label: { zh: '发票号', en: 'Invoice no.' }, value: ciDoc.number }] : [])],
        paragraphs: [{ text: `${usance} OF THIS FIRST OF EXCHANGE (SECOND OF THE SAME TENOR AND DATE UNPAID) PAY TO THE ORDER OF ${(lc?.advisingBank || c.bankName || 'OURSELVES').toUpperCase()} THE SUM OF ${amountInWords(ci.total, order!.currency)}.` }], total: ci.total };
    }
    case 'CD': {
      const draft = draftCustomsDeclaration(root, s), pack = packingTotals(root, s);
      const customs = root.fulfillment.customs.find(x => x.shipmentId === s.id);
      // No port/country mapping or structured consignee address exists; use the customer country, never infer from free text.
      const destinationCountry = root.customers.find(x => x.id === s.customerId)?.country || '';
      return { parties: [{ label: { zh: '境内发货人', en: 'Exporter' }, name: c.legalName, detail: [c.customsCode && '海关编码 ' + c.customsCode, c.taxId && '税号 ' + c.taxId].filter(Boolean).join(' · ') }, { label: { zh: '境外收货人', en: 'Overseas consignee' }, name: s.consignee, detail: '' }],
        facts: [...transportFacts(s), ...(customs ? [
          { label: { zh: '监管方式', en: 'Trade mode' }, value: customs.tradeMode },
          { label: { zh: '原产国', en: 'Country of origin' }, value: customs.origin },
          { label: { zh: '申报单位 / 报关行', en: 'Customs broker' }, value: customs.broker },
          { label: { zh: '运抵国 / 最终目的国', en: 'Country of destination' }, value: destinationCountry },
        ] : []), { label: { zh: '件数 / 毛重 / 净重', en: 'Packages / G.W. / N.W.' }, value: `${pack.packages} · ${money2(pack.gross)} kg · ${money2(pack.net)} kg` }],
        table: { columns: [{ key: 'no', label: { zh: '项号', en: 'No.' } }, { key: 'hs', label: { zh: '商品编号', en: 'HS code' } }, { key: 'name', label: { zh: '商品名称及规格型号', en: 'Description / elements' } }, { key: 'qty', label: { zh: '数量及单位', en: 'Quantity' }, num: true }, { key: 'price', label: { zh: '单价', en: 'Unit price' }, num: true }, { key: 'amount', label: { zh: '总价 / 币制', en: 'Amount' }, num: true }],
          rows: draft.items.map(i => ({ no: String(i.no), hs: i.hsCode, name: `${i.declaredName}\n${i.elements}`, qty: [`${qtyText(i.quantity)} ${i.unit}`, `${qtyText(i.legalQty)} ${i.legalUnit}`, i.secondUnit && i.secondQty !== null ? `${qtyText(i.secondQty)} ${i.secondUnit}` : ''].filter(Boolean).join('\n'), price: money2(i.unitPrice), amount: `${money2(i.amount)} ${i.currency}` })),
          totals: { amount: draft.totals.map(t => `${money2(t.amount)} ${t.currency}`).join(' / ') } },
        paragraphs: draft.blockers.length ? [{ title: { zh: '待补资料', en: 'Open items' }, text: draft.blockers.join('\n') }] : [] };
    }
    case 'CDA': return { parties: [{ label: { zh: '委托方', en: 'Principal' }, name: c.legalName, detail: [c.customsCode && '海关编码 ' + c.customsCode, c.taxId && '统一社会信用代码 ' + c.taxId].filter(Boolean).join(' · ') }, { label: { zh: '被委托方（报关企业）', en: 'Customs broker' }, name: root.fulfillment.customs.find(x => x.shipmentId === s.id)?.broker || '', detail: '' }],
      facts: [{ label: { zh: '出运', en: 'Shipment' }, value: s.code }, ...transportFacts(s)], table: cargoTable(root, s),
      paragraphs: [{ title: { zh: '委托事项', en: 'Scope' }, text: '现委托贵公司代理本票货物出口报关申报及相关手续。我公司保证所提供的资料真实、合法，与实际货物相符，并承担相应法律责任。' }] };
  }
}
/** Why this shipment document can’t be generated now; null when it can. */
export function documentGenerationBlocker(root: MistState, s: FulfillmentShipment | undefined, type: string, orderId?: string): string | null {
  if (!s) return '出运不存在';
  if (!isOwnDocumentType(type)) return '该类单据由外部机构签发，只能归档原件';
  if (!root.settings.companyProfile?.legalName) return '请先补全公司抬头';
  if (s.state === 'cancelled') return '出运已取消';
  if (s.state === 'departed' && !POST_DEPARTURE_TYPES.includes(type)) return '出运已离港';
  if (type === 'SA' && s.state !== 'departed') return '离港后才能出装船通知';
  if (PER_ORDER_TYPES.includes(type) && (!orderId || !s.lines.some(l => l.orderId === orderId))) return '请选择本票的准确订单';
  if (type === 'CI' && root.orders.find(o => o.id === orderId)?.governance?.contract.kind === 'internal') return '内部订单不生成销售发票';
  if (type === 'PL' && !packingOf(root, s).length) return '请先登记装箱分配';
  if (type === 'BC' && !lcFor(root, s)) return '本票没有对应的有效信用证';
  if (type === 'DFT' && !root.fulfillment.documents.some(d => d.shipmentId === s.id && d.orderId === orderId && d.type === 'CI' && d.status === 'issued')) return '请先签发本订单 CI';
  const family = root.fulfillment.documents.filter(d => d.shipmentId === s.id && d.type === type && d.orderId === (PER_ORDER_TYPES.includes(type) ? orderId : ''));
  if (family.some(d => d.status === 'issued')) return '已有有效签发版本，请先作废再生成新版本';
  return null;
}
function nextNumber(root: MistState, s: FulfillmentShipment, type: OwnDocumentType, order?: MistOrder) {
  const family = root.fulfillment.documents.filter(d => d.shipmentId === s.id && d.type === type && d.orderId === (order && PER_ORDER_TYPES.includes(type) ? order.id : ''));
  const draft = family.find(d => d.status === 'draft');
  if (draft) return { number: draft.number, version: draft.version, draft };
  const version = Math.max(0, ...family.map(d => d.version)) + 1, base = `${PREFIX[type]}-${s.code.replace(/^[A-Z]+-/, '')}${order && PER_ORDER_TYPES.includes(type) && shipmentOrders(root, s).length > 1 ? '-' + order.code.split('-').pop() : ''}`;
  return { number: version > 1 ? `${base}-V${version}` : base, version, draft: undefined };
}
export function prepareShipmentDocumentSnapshot(root: MistState, payload: unknown, ctx: MistContext): { snapshot: GeneratedDocSnapshot; total?: number } {
  exact(payload, ['shipmentId', 'type', 'orderId', 'dueDate']);
  const p = payload as { shipmentId: string; type: OwnDocumentType; orderId?: string; dueDate?: string };
  const s = root.fulfillment.shipments.find(x => x.id === p.shipmentId);
  const blocked = documentGenerationBlocker(root, s, p.type, p.orderId); if (blocked) fail(blocked, blocked === '出运不存在' ? 'NOT_FOUND' : 'PRECONDITION');
  if (!ctx.actorId) fail('缺少真实生成人');
  const order = PER_ORDER_TYPES.includes(p.type) ? root.orders.find(o => o.id === p.orderId) : undefined;
  const due = p.type === 'CI' && !order?.replacementSource ? (typeof p.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : fail('请填写应收到期日', 'VALIDATION')) : '';
  const { number } = nextNumber(root, s!, p.type, order), content = shipmentDocContent(root, s!, p.type, order, due);
  const { total, ...rest } = content;
  const snapshot: GeneratedDocSnapshot = { templateVersion: GENERATED_DOCUMENT_TEMPLATE_VERSION, kind: p.type, number, date: platformBusinessDate(ctx.now), title: { zh: ZH_TITLE[p.type], en: EN_TITLE[p.type] }, issuer: issuerOf(root.settings.companyProfile)!, signatures: [{ label: { zh: '授权签字及公司盖章', en: 'Authorized signature' }, name: root.settings.companyProfile!.englishName || root.settings.companyProfile!.legalName }], ...rest, paragraphs: rest.paragraphs || [], generatedAt: ctx.now, generatedBy: ctx.actorName, generatedById: ctx.actorId! };
  return { snapshot, total };
}
/** Plain-text summary stored as the document content (search, review and history), derived from the same snapshot. */
const contentText = (s: GeneratedDocSnapshot) => [...s.facts.map(f => `${f.label.zh}：${f.value}`), ...(s.table ? s.table.rows.map(r => Object.values(r).filter(v => String(v ?? '').trim()).join(' · ')) : []), ...s.paragraphs.map(p => (p.title ? p.title.zh + '：' : '') + p.text), s.amountInWords || ''].filter(Boolean).join('\n').slice(0, 8000);

export function prepareOrderDocumentSnapshot(root: MistState, payload: unknown, ctx: MistContext): GeneratedDocSnapshot {
  exact(payload, ['orderId', 'kind']);
  const p = payload as { orderId: string; kind: 'PI' | 'SC' };
  if (p.kind !== 'PI' && p.kind !== 'SC') fail('单据类型无效', 'VALIDATION');
  const order = root.orders.find(o => o.id === p.orderId) || fail('订单不存在', 'NOT_FOUND');
  const g = order.governance, snap = g?.approvedSnapshot;
  if (g?.status !== 'approved' || !snap) fail('订单审批通过后才能生成' + ORDER_DOCUMENT_LABEL[p.kind].zh);
  if (snap!.contract.kind === 'internal' || order.replacementSource) fail('内部或补发订单不出具对客单据');
  const issuer = issuerOf(root.settings.companyProfile) || fail('请先补全公司抬头');
  if (!ctx.actorId) fail('缺少真实生成人');
  const customer = root.customers.find(c => c.id === snap!.customerId), contract = snap!.contract;
  const rows = snap!.lines.map((l, i) => ({ no: String(i + 1), style: l.style, desc: externalGoodsName(l) + (l.breakdown ? '\n' + breakdownSummary(l.breakdown, l.unit) : ''), qty: `${qtyText(l.qty)} ${l.unit}`, price: money2(l.price), amount: money2(lineAmount(l.qty, l.price)), _a: lineAmount(l.qty, l.price) }));
  const total = r2(rows.reduce((n, r) => n + r._a, 0)), count = ((order as MistOrder & { documents?: OrderDocumentRecord[] }).documents || []).filter(d => d.orderKind === p.kind).length;
  const tolerance = contract.overPercent || contract.shortPercent ? `+${contract.overPercent || 0}% / -${contract.shortPercent || 0}%` : '';
  const terms = [
    { title: { zh: '交货期', en: 'Delivery' }, text: snap!.due },
    { title: { zh: '贸易术语 / 交货地点', en: 'Trade terms' }, text: [contract.incoterm, contract.deliveryPlace].filter(Boolean).join(' · ') },
    { title: { zh: '付款条件', en: 'Payment terms' }, text: [contract.paymentMethod === 'OTHER' ? '' : contract.paymentMethod, contract.depositPercent ? `${contract.depositPercent}% 预付 / deposit` : '', contract.paymentNote].filter(Boolean).join(' · ') },
    ...(tolerance ? [{ title: { zh: '溢短装', en: 'Quantity tolerance' }, text: tolerance }] : []),
    ...(p.kind === 'SC' ? [{ title: { zh: '质量与检验', en: 'Quality & inspection' }, text: '按双方确认的样品与规格生产；出货前由卖方或买方指定机构检验。' }, { title: { zh: '不可抗力', en: 'Force majeure' }, text: '因战争、自然灾害等不可抗力导致不能履约或延迟交货的，卖方不负责任，但应及时通知买方。' }, { title: { zh: '争议解决', en: 'Disputes' }, text: '因本合同引起的争议由双方友好协商解决；协商不成的，适用中华人民共和国法律。' }] : [{ title: { zh: '有效期', en: 'Validity' }, text: '本形式发票自出具之日起 30 天内有效。' }]),
  ];
  return { templateVersion: GENERATED_DOCUMENT_TEMPLATE_VERSION, kind: p.kind, number: `${p.kind}-${order.code}${count ? '-V' + (count + 1) : ''}`, date: platformBusinessDate(ctx.now), title: ORDER_DOCUMENT_LABEL[p.kind], issuer: issuer!,
    parties: [{ label: p.kind === 'SC' ? { zh: '卖方', en: 'Seller' } : { zh: '出具方', en: 'Seller' }, name: issuer!.englishName || issuer!.legalName, detail: issuer!.englishAddress || issuer!.address }, { label: { zh: '买方', en: 'Buyer' }, name: snap!.customer, detail: [customer?.city, customer?.country].filter(Boolean).join(', ') }],
    facts: [{ label: { zh: '订单号', en: 'Order no.' }, value: order.code }, ...(contract.poNumber ? [{ label: { zh: '客户 PO', en: 'Customer PO' }, value: contract.poNumber }] : []), { label: { zh: '币种', en: 'Currency' }, value: snap!.currency }, ...(snap!.season ? [{ label: { zh: '季节', en: 'Season' }, value: snap!.season }] : [])],
    table: { columns: [{ key: 'no', label: { zh: '序号', en: 'No.' } }, { key: 'style', label: { zh: '款号', en: 'Style' } }, { key: 'desc', label: { zh: '品名 / 规格', en: 'Description' } }, { key: 'qty', label: { zh: '数量', en: 'Quantity' }, num: true }, { key: 'price', label: { zh: `单价 ${snap!.currency}`, en: 'Unit price' }, num: true }, { key: 'amount', label: { zh: `金额 ${snap!.currency}`, en: 'Amount' }, num: true }], rows: rows.map(({ _a, ...r }) => r), totals: { amount: `${snap!.currency} ${money2(total)}` } },
    amountInWords: amountInWords(total, snap!.currency), paragraphs: terms,
    signatures: p.kind === 'SC' ? [{ label: { zh: '卖方签字盖章', en: 'The Seller' }, name: issuer!.englishName || issuer!.legalName }, { label: { zh: '买方签字盖章', en: 'The Buyer' }, name: snap!.customer }] : [{ label: { zh: '授权签字', en: 'Authorized signature' }, name: issuer!.englishName || issuer!.legalName }],
    generatedAt: ctx.now, generatedBy: ctx.actorName, generatedById: ctx.actorId! };
}
export function prepareLookbookSnapshot(root: MistState, payload: unknown, ctx: MistContext): GeneratedDocSnapshot {
  exact(payload, ['id']);
  const book = root.market.lookbooks.find(b => b.id === (payload as { id: string }).id) || fail('画册不存在', 'NOT_FOUND');
  if (book.status !== 'Prepared' || !book.snapshots.length) fail('请先准备画册');
  const issuer = issuerOf(root.settings.companyProfile) || fail('请先补全公司抬头');
  if (!ctx.actorId) fail('缺少真实生成人');
  const customer = root.customers.find(c => c.id === book.customerId), count = ((book as MarketLookbook & { documents?: GeneratedDocRecord[] }).documents || []).length;
  return { templateVersion: GENERATED_DOCUMENT_TEMPLATE_VERSION, kind: 'LOOKBOOK', number: `LB-${book.id.slice(0, 8).toUpperCase()}${count ? '-' + (count + 1) : ''}`, date: platformBusinessDate(ctx.now), title: { zh: book.name, en: 'LOOKBOOK' }, issuer: issuer!,
    parties: customer ? [{ label: { zh: '致', en: 'Prepared for' }, name: customer.name, detail: [customer.city, customer.country].filter(Boolean).join(', ') }] : [], facts: [],
    table: { columns: [{ key: 'sku', label: { zh: '货号', en: 'Item no.' } }, { key: 'name', label: { zh: '品名', en: 'Description' } }, { key: 'spec', label: { zh: '规格', en: 'Specification' } }], rows: book.snapshots.map(p => ({ sku: p.sku, name: p.name, spec: p.specification })) },
    paragraphs: book.note ? [{ text: book.note }] : [], signatures: [], generatedAt: ctx.now, generatedBy: ctx.actorName, generatedById: ctx.actorId! };
}
export function prepareGeneratedSnapshot(root: MistState, command: { type: string; payload: unknown }, ctx: MistContext): GeneratedDocSnapshot {
  if (command.type === 'fulfillment.documents.generate') return prepareShipmentDocumentSnapshot(root, command.payload, ctx).snapshot;
  if (command.type === 'order.document.generate') return prepareOrderDocumentSnapshot(root, command.payload, ctx);
  if (command.type === 'market.lookbook.document') return prepareLookbookSnapshot(root, command.payload, ctx);
  return fail('未知单据', 'VALIDATION');
}
function bound(root: MistState, snapshot: GeneratedDocSnapshot, ctx: MistContext): GeneratedDocArtifact {
  const artifact = (ctx as MistContext & { generatedDocument?: GeneratedDocArtifact }).generatedDocument;
  if (!artifact || artifact.record.number !== snapshot.number || artifact.record.kind !== snapshot.kind || artifact.record.snapshotFingerprint !== generatedDocFingerprint(snapshot) || generatedDocFingerprint(artifact.record.snapshot) !== artifact.record.snapshotFingerprint || artifact.record.fileId !== artifact.file.id) fail('单据须由服务端按业务记录生成');
  if (root.files.some(f => f.id === artifact!.file.id)) fail('单据已归档', 'CONFLICT');
  root.files.push(structuredClone(artifact!.file) as MistState['files'][number]);
  return artifact!;
}
const event = (root: MistState, ctx: MistContext, entityType: string, entityId: string, text: string, fileIds: string[] = []) => root.events.unshift({ id: ctx.id(), entityType, entityId, actor: ctx.actorName, at: ctx.now, text, fileIds });

export function applyDocumentGeneration(root: MistState, command: DocumentGenerationCommand, ctx: MistContext): { id: string; fileId?: string; documentId?: string } {
  if (command.type === 'fulfillment.documents.generate') {
    const { snapshot } = prepareShipmentDocumentSnapshot(root, command.payload, ctx), artifact = bound(root, snapshot, ctx), p = command.payload;
    const s = root.fulfillment.shipments.find(x => x.id === p.shipmentId)!, order = PER_ORDER_TYPES.includes(p.type) ? root.orders.find(o => o.id === p.orderId) : undefined;
    const { version, draft } = nextNumber(root, s, p.type, order);
    // A regenerated draft replaces its own earlier generated file; files uploaded by people stay attached.
    const generatedIds = new Set(((draft as FulfillmentDocument & { generated?: GeneratedDocRecord[] })?.generated || []).map(g => g.fileId));
    const row = draft || { id: ctx.id(), shipmentId: s.id, orderId: order?.id || '', type: p.type, number: snapshot.number, version, title: '', dueDate: '', content: '', fileIds: [], status: 'draft' as const, createdAt: ctx.now, actor: ctx.actorName };
    Object.assign(row, { title: `${ZH_TITLE[p.type]} ${s.code}${order ? ' · ' + order.code : ''}`, dueDate: p.type === 'CI' && !order?.replacementSource ? p.dueDate : row.dueDate, content: contentText(snapshot), fileIds: [...row.fileIds.filter(id => !generatedIds.has(id)), artifact.file.id] });
    (row as FulfillmentDocument & { generated?: GeneratedDocRecord[] }).generated = [...((row as FulfillmentDocument & { generated?: GeneratedDocRecord[] }).generated || []), structuredClone(artifact.record)];
    if (!draft) root.fulfillment.documents.push(row as FulfillmentDocument);
    event(root, ctx, 'document', row.id, `生成${DOCUMENT_TYPE_LABEL[p.type]} ${snapshot.number}`, [artifact.file.id]);
    return { id: row.id, documentId: row.id, fileId: artifact.file.id };
  }
  if (command.type === 'order.document.generate') {
    const snapshot = prepareOrderDocumentSnapshot(root, command.payload, ctx), artifact = bound(root, snapshot, ctx);
    const order = root.orders.find(o => o.id === command.payload.orderId)! as MistOrder & { documents?: OrderDocumentRecord[] };
    const prior = (order.documents || []).filter(d => d.orderKind === command.payload.kind).at(-1);
    if (prior && generatedDocFingerprint(generatedDocContent(prior.snapshot)) === generatedDocFingerprint(generatedDocContent({ ...snapshot, number: prior.number }))) fail('订单内容未变化，可直接下载上一份' + ORDER_DOCUMENT_LABEL[command.payload.kind].zh, 'CONFLICT');
    order.documents = [...(order.documents || []), { ...structuredClone(artifact.record), orderKind: command.payload.kind, version: (order.documents || []).filter(d => d.orderKind === command.payload.kind).length + 1 }];
    event(root, ctx, 'order', order.id, `生成${ORDER_DOCUMENT_LABEL[command.payload.kind].zh} ${snapshot.number}`, [artifact.file.id]);
    return { id: order.id, fileId: artifact.file.id };
  }
  if (command.type === 'market.lookbook.document') {
    const snapshot = prepareLookbookSnapshot(root, command.payload, ctx), artifact = bound(root, snapshot, ctx);
    const book = root.market.lookbooks.find(b => b.id === command.payload.id)! as MarketLookbook & { documents?: GeneratedDocRecord[] };
    book.documents = [...(book.documents || []), structuredClone(artifact.record)];
    book.fileIds = [...new Set([...book.fileIds, artifact.file.id])];
    event(root, ctx, 'lookbook', book.id, `生成画册 PDF ${snapshot.number}`, [artifact.file.id]);
    return { id: book.id, fileId: artifact.file.id };
  }
  // B/L details: shipping instructions sent, draft B/L checked, then originals or telex / seaway release recorded.
  const p = command.payload, d = root.fulfillment.documents.find(x => x.id === p.id) as (FulfillmentDocument & { bl?: BillOfLadingDetails }) | undefined;
  if (!d || d.type !== 'BL') return fail('提单不存在', 'NOT_FOUND');
  if (d.status === 'void') fail('已作废提单不能修改');
  if (!['original', 'telex', 'seaway'].includes(p.kind)) fail('请选择提单类型', 'VALIDATION');
  const originals = p.kind === 'original' ? (Number.isInteger(p.originals) && p.originals >= 1 && p.originals <= 6 ? p.originals : fail('正本份数须为 1–6', 'VALIDATION')) : 0;
  if (p.siDocumentId !== undefined && p.siDocumentId !== '' && !root.fulfillment.documents.some(x => x.id === p.siDocumentId && x.type === 'SI' && x.shipmentId === d.shipmentId)) fail('补料须为本票提单补料单', 'VALIDATION');
  if (p.release !== undefined && p.kind === 'original') fail('正本提单按正本交付，不登记电放', 'VALIDATION');
  if (p.release !== undefined && !(d.bl?.draftConfirmed || p.confirmDraft !== undefined)) fail('请先核对提单草稿');
  const blNo = text(p.blNo, '提单号', 60);
  d.bl = { ...(d.bl || {}), blNo, kind: p.kind, originals, ...(p.siDocumentId ? { siDocumentId: p.siDocumentId } : {}), updatedAt: ctx.now, updatedBy: ctx.actorName } as BillOfLadingDetails;
  if (p.confirmDraft !== undefined) d.bl.draftConfirmed = { at: ctx.now, actor: ctx.actorName, evidence: text(p.confirmDraft, '草稿核对依据') };
  if (p.release !== undefined) d.bl.released = { at: ctx.now, actor: ctx.actorName, evidence: text(p.release, p.kind === 'telex' ? '电放依据' : '放货依据') };
  if (d.status === 'draft' && d.number !== blNo) d.number = blNo;
  event(root, ctx, 'document', d.id, p.release !== undefined ? `提单 ${blNo} 已${BL_KIND_LABEL[p.kind]}放货` : p.confirmDraft !== undefined ? `提单 ${blNo} 草稿已核对` : `登记提单 ${blNo}（${BL_KIND_LABEL[p.kind]}${originals ? ` · 正本 ${originals} 份` : ''}）`);
  return { id: d.id };
}
