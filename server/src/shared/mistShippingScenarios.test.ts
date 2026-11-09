import { describe, expect, it } from 'vitest';
import { type MistCommand } from './mistWorkspace';
import { customsItemsStale } from './mistCustomsDeclaration';
import { lineShipmentFacts } from './mistOrderClosure';
import type { ShipmentLine } from './mistFulfillment';
import { fixture } from '../mist/__tests__/professionalFulfillment';

function scenario(actualQuantity = 10) {
  const f = fixture();
  f.context.authority!.supplier!['supplierCommitment.approvers.purchase.garment'] = { version: 1, userIds: ['reviewer'] };
  const actors = {
    sales: f.context,
    logistics: { ...f.context, actorId: 'logistics', actorName: '后勤', can: (p: string) => p === 'customs:clear' },
    qc: { ...f.context, actorId: 'qc', actorName: '质检' },
    reviewer: { ...f.context, actorId: 'reviewer', actorName: '主管' },
  };
  const run = (command: MistCommand, role: keyof typeof actors = 'sales') => f.run(command, actors[role]);
  run({ type: 'order.governance.saveDraft', payload: { orderId: f.orderId, input: { ...f.state.orders[0].governance!.contract, preShipmentPercent: 0 }, lines: f.state.orderLines.map(l => ({ ...l, fulfillmentMode: 'full_package' })) } });
  const firstLine = secondOrder(f.orderId);
  const line = (): ShipmentLine => ({ ...firstLine });
  function handoff(orderId = f.orderId, partialAllowed = true) {
    const order = f.state.orders.find(o => o.id === orderId)!;
    for (const item of order.checklist) run({ type: 'order.checklist', payload: { orderId, itemId: item.id, done: true } });
    run({ type: 'order.handoff', payload: { orderId, note: '合同条款与发货范围已核对' } });
    run({ type: 'fulfillment.shipments.sourceTerms', payload: { orderId, consignee: '本地验收收货人', partialAllowed, mode: 'sea', confirmedAt: '2026-10-13', evidence: '客户合同' } });
  }
  function shipment(lines = [line()], id?: string) {
    return run({ type: 'fulfillment.shipments.save', payload: { id, consignee: '本地验收收货人', mode: 'sea', portOfLoading: '上海', portOfDischarge: '伦敦', incoterm: 'FOB', plannedDate: '', booking: '', lines, note: '', fileIds: [] } }).id!;
  }
  function pack(id: string, grossWeight = 2) {
    const s = f.state.fulfillment.shipments.find(s => s.id === id)!;
    run({ type: 'fulfillment.shipments.pack', payload: { id, lines: s.lines.map((l, i) => ({ lineId: l.lineId, productionId: l.productionId, carton: String(i + 1), quantity: l.quantity, netWeight: 1, grossWeight, volume: 1, note: '' })) } }, 'logistics');
  }
  function document(shipmentId: string, type: 'CI' | 'PL', orderId = type === 'CI' ? f.orderId : '') {
    const id = run({ type: 'fulfillment.documents.save', payload: { shipmentId, orderId, type, number: `${type}-${f.state.fulfillment.documents.length + 1}`, title: type, dueDate: type === 'CI' ? '2026-11-01' : '', content: '已核对正式原件', fileIds: ['contract'] } }, 'logistics').id!;
    run({ type: 'fulfillment.documents.issue', payload: { id } }, 'logistics');
    return id;
  }
  function prepare(id: string) {
    const s = f.state.fulfillment.shipments.find(s => s.id === id)!;
    // Samples remain specific to the actual order line, branch and shipment batch.
    for (const l of s.lines) sample(l, 'shipping', id);
    pack(id);
    const cis = [...new Set(s.lines.map(l => l.orderId))].map(orderId => document(id, 'CI', orderId));
    const pl = document(id, 'PL');
    run({ type: 'fulfillment.shipments.ready', payload: { id } }, 'logistics');
    run({ type: 'fulfillment.shipments.sent', payload: { id, at: f.context.now } });
    return { cis, pl };
  }
  function customs(shipmentId: string, status: 'draft' | 'submitted' | 'cleared' = 'cleared', id?: string, channel: 'general' | 'express' = 'general') {
    return run({ type: 'fulfillment.customs.save', payload: { id, shipmentId, channel, status, declarationNo: 'DECL-1', broker: '本地验收报关行', hsCode: '6203310000', origin: '中国', tradeMode: 'FOB', declaredAt: '2026-10-13', clearedAt: status === 'cleared' ? '2026-10-13' : '', evidence: '外部回执', fileIds: [], note: '' } }, 'logistics').id!;
  }
  function classify(style = 'LOCAL') {
    return run({ type: 'fulfillment.customs.classify.save', payload: { family: 'garment', hsCode: '6203310000', declaredName: '男式羊毛上衣', brandType: '0', preference: '0', elements: ['机织', '上衣', '男式', '100%羊毛', '无品牌'], styles: [style] } }, 'logistics').id!;
  }
  function depart(id: string) {
    return run({ type: 'fulfillment.shipments.depart', payload: { id, at: f.context.now, evidence: '承运人确认离港', fileIds: [] } }, 'logistics');
  }
  function sample(l: ShipmentLine, role: 'pp' | 'shipping', shipmentId?: string) {
    const source = { kind: 'orderLine' as const, orderId: l.orderId, lineId: l.lineId, productionId: l.productionId };
    const sampleId = run({ type: 'fulfillment.samples.create', payload: { name: '上衣样', category: '成衣', form: '实物', quantity: 1, unit: '件', size: 'M', color: '蓝', location: '样品室', source, role, shipmentId, note: '', fileIds: [] } }).id!;
    const id = run({ type: 'fulfillment.qc.request', payload: { source, sampleId, domain: 'garment', kind: 'sample', factory: '本地验收工厂', location: '样品室', contact: '', due: '2026-10-13' } }).id!;
    run({ type: 'fulfillment.qc.claim', payload: { id, domain: 'garment' } }, 'qc');
    run({ type: 'fulfillment.qc.report', payload: { id, domain: 'garment', result: 'pass', report: 'SAMPLE', opinion: '按实物检验', measurements: [], fileIds: [], reviewedAt: f.context.now } }, 'qc');
    run({ type: 'fulfillment.qc.confirm', payload: { id, result: 'approved', note: '客户确认' } });
    run({ type: 'fulfillment.qc.continue', payload: { id, note: '业务确认继续' } });
  }
  function secondOrder(existingOrderId?: string) {
    const first = f.state.orders.find(o => o.id === f.orderId)!;
    const orderId = existingOrderId || run({ type: 'order.create', payload: { type: 'garment', customerId: first.customerId, season: 'AW', currency: 'USD', due: '2026-11-01', ownerId: 'sales', governance: { ...first.governance!.contract, poNumber: 'LOCAL-PO-2' }, lines: [{ fulfillmentMode: 'full_package', cmtIncludedItems: [], name: '第二款上衣', style: 'LOCAL-2', qty: 10, unit: '件', price: 12, img: 'coat' }] } }).id!;
    run({ type: 'order.governance.submit', payload: { orderId } });
    run({ type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: '主单核对' } }, 'reviewer');
    const lineId = f.state.orderLines.find(l => l.orderId === orderId)!.id;
    const purchaseId = run({ type: 'fulfillment.procurement.save', payload: { orderId, lineId, kind: 'finished', supplierId: 'supplier', supplier: '本地验收工厂', description: '上衣加工', quantity: 10, unit: '件', price: 2, currency: 'CNY', due: '2026-10-30', terms: '月结', destination: '成品仓', note: '', fileIds: [] } }).id!;
    run({ type: 'fulfillment.procurement.submit', payload: { id: purchaseId } });
    run({ type: 'fulfillment.procurement.decide', payload: { id: purchaseId, decision: 'approved', note: '合同核对' } }, 'reviewer');
    f.confirmContract(purchaseId);
    const productionId = f.state.productions.find(p => p.sourcePurchaseId === purchaseId)!.id;
    const l = { orderId, lineId, productionId, quantity: actualQuantity, factoryConfirmedAt: '2026-10-13' };
    run({ type: 'fulfillment.production.plan', payload: { productionId, sizes: [{ size: 'M', quantity: 10 }] } });
    sample(l, 'pp');
    run({ type: 'fulfillment.production.release', payload: { productionId, note: '开产条件已齐备' } });
    run({ type: 'fulfillment.procurement.receive', payload: { id: purchaseId, quantity: actualQuantity, rejected: 0, destination: 'warehouse', location: '成品仓', date: '2026-10-13', evidence: '点收十件', fileIds: [] } }, 'logistics');
    run({ type: 'fulfillment.production.complete', payload: { productionId, quantity: actualQuantity, sizeQuantities: [{ size: 'M', quantity: actualQuantity }], date: '2026-10-13', evidence: '完工点数', fileIds: [] } });
    if (actualQuantity !== 10) run({ type: 'fulfillment.production.acceptCompletion', payload: { productionId, note: '客户书面接受实际完工数量' } });
    const task = run({ type: 'fulfillment.qc.request', payload: { source: { kind: 'orderLine', orderId, lineId, productionId }, domain: 'garment', kind: 'production', factory: '本地验收工厂', location: '成品仓', contact: '', due: '2026-10-13' } }).id!;
    run({ type: 'fulfillment.qc.claim', payload: { id: task, domain: 'garment' } }, 'qc');
    run({ type: 'fulfillment.qc.report', payload: { id: task, domain: 'garment', result: 'pass', report: 'FINAL-2', opinion: '尾检通过', measurements: [], sizeChecks: [{ size: 'M', inspected: 1, result: 'pass', evidence: '逐码抽检' }], fileIds: [], reviewedAt: f.context.now } }, 'qc');
    handoff(orderId);
    return l;
  }
  return { context: f.context, orderId: f.orderId, get state() { return f.state; }, run, line, handoff, shipment, pack, document, prepare, customs, classify, depart, secondOrder };
}

describe('后勤场景：分批、合票、取消、单据重开和退关', () => {
  it('enforces a no-partial contract against the accepted final quantity', () => {
    const f = scenario(9);
    f.handoff(f.orderId, false);
    expect(() => f.shipment([{ ...f.line(), quantity: 4 }])).toThrow('禁止分批');
    expect(f.shipment()).toBeTruthy();
    expect(f.state.orderLines[0].qty).toBe(10);
    expect(f.state.fulfillment.shipments[0].lines[0].quantity).toBe(9);
  });

  it('requires manager approval for over-shipment and releases the approved reservation after cancellation', () => {
    const f = scenario(11);
    expect(() => f.shipment()).toThrow('须经理审批');
    const request = f.run({ type: 'order.governance.requestOverShip', payload: { orderId: f.orderId, lineId: f.line().lineId, quantity: 11, reason: '客户要求随主批出运多做一件' } });
    const requestId = request.reviewId!.replace('order-overship:', '');
    const decision = { type: 'order.governance.decide', payload: { id: `${f.orderId}#overship:${requestId}`, decision: 'approved', note: '核对客户要求' } } as const;
    expect(() => f.run(decision)).toThrow('不能审批自己的');
    f.run(decision, 'reviewer');
    const id = f.shipment();
    expect(() => f.shipment([{ ...f.line(), quantity: 1 }])).toThrow('实际交付数量');
    f.run({ type: 'fulfillment.shipments.cancel', payload: { id, reason: '调整船期重新排单' } });
    expect(f.shipment()).toBeTruthy();
    expect(f.state.fulfillment.stock[0].available).toBe(11);
    expect(lineShipmentFacts(f.state, f.line().lineId)).toMatchObject({ planned: 11, departed: 0 });
  });

  it('departs two partial batches and issues only their exact warehouse quantities', () => {
    const f = scenario(), first = f.shipment([{ ...f.line(), quantity: 4 }]);
    f.prepare(first); f.customs(first); f.depart(first);
    expect(f.state.orders[0].state).toBe('部分出运');
    expect(f.state.fulfillment.stock[0].available).toBe(6);
    expect(f.state.invoices.map(i => i.amount)).toEqual([40]);
    const second = f.shipment([{ ...f.line(), quantity: 6 }]);
    f.prepare(second); f.customs(second); f.depart(second);
    expect(f.state.orders[0].state).toBe('履约完成');
    expect(f.state.fulfillment.stock[0].available).toBe(0);
    expect(f.state.invoices.reduce((n, i) => n + i.amount, 0)).toBe(100);
    expect(lineShipmentFacts(f.state, f.line().lineId)).toMatchObject({ planned: 10, departed: 10, open: [] });
    expect(() => f.run({ type: 'fulfillment.shipments.cancel', payload: { id: first, reason: '离港后撤销' } })).toThrow('不能修改');
    expect(f.state.fulfillment.stockMovements.filter(m => m.kind === 'issue').map(m => m.quantity)).toEqual([4, 6]);
  });

  it('requires one CI per order in a consolidated shipment and preserves both order amounts', () => {
    const f = scenario(), second = f.secondOrder(), id = f.shipment([f.line(), second]);
    f.prepare(id); f.classify(); f.classify('LOCAL-2');
    const customsId = f.customs(id, 'draft');
    f.run({ type: 'fulfillment.customs.items', payload: { id: customsId } }, 'logistics');
    expect(f.state.fulfillment.customs[0].items!.map(i => i.amount)).toEqual([100, 120]);
    const ci = f.state.fulfillment.documents.find(d => d.orderId === second.orderId)!;
    f.run({ type: 'fulfillment.documents.void', payload: { id: ci.id, reason: '第二份CI更正' } }, 'logistics');
    expect(() => f.run({ type: 'fulfillment.shipments.ready', payload: { id } }, 'logistics')).toThrow('分别签发CI');
    f.document(id, 'CI', second.orderId);
    f.run({ type: 'fulfillment.shipments.ready', payload: { id } }, 'logistics');
    f.run({ type: 'fulfillment.shipments.sent', payload: { id, at: f.context.now } });
    f.customs(id, 'cleared', customsId); f.depart(id);
    expect(f.state.orders.map(o => o.state)).toEqual(['履约完成', '履约完成']);
    expect(f.state.fulfillment.stock.map(s => s.available)).toEqual([0, 0]);
    expect(f.state.invoices.filter(i => !i.voidedAt).map(i => [i.orderId, i.amount])).toEqual([[f.orderId, 100], [second.orderId, 120]]);
  });

  it('voids and reissues CI without reusing dispatch or receivable facts, then cancels without issuing stock', () => {
    const f = scenario(), id = f.shipment(), { cis, pl } = f.prepare(id);
    const stock = structuredClone(f.state.fulfillment.stock), movements = structuredClone(f.state.fulfillment.stockMovements);
    const oldInvoice = f.state.invoices[0].id;
    expect(() => f.run({ type: 'fulfillment.shipments.cancel', payload: { id, reason: '取消' } })).toThrow('先作废');
    f.run({ type: 'fulfillment.documents.void', payload: { id: cis[0], reason: '原票更正' } }, 'logistics');
    const revised = f.document(id, 'CI');
    expect(f.state.fulfillment.documents.find(d => d.id === revised)).toMatchObject({ version: 2, status: 'issued' });
    f.run({ type: 'fulfillment.shipments.ready', payload: { id } }, 'logistics');
    f.customs(id);
    expect(() => f.depart(id)).toThrow('登记对客发送');
    f.run({ type: 'fulfillment.shipments.sent', payload: { id, at: f.context.now } });
    expect(f.state.fulfillment.shipments[0].documentDispatches!.map(d => d.documentIds)).toEqual([[cis[0], pl], [pl, revised]]);
    f.run({ type: 'fulfillment.customs.amend', payload: { id: f.state.fulfillment.customs[0].id, kind: 'withdraw', reason: '承运人取消航次，海关退关', fileIds: [] } }, 'logistics');
    for (const doc of [revised, pl]) f.run({ type: 'fulfillment.documents.void', payload: { id: doc, reason: '取消本票' } }, 'logistics');
    f.run({ type: 'fulfillment.shipments.cancel', payload: { id, reason: '客户取消本次发运' } });
    expect(f.state.invoices.find(i => i.id === oldInvoice)).toMatchObject({ amount: 100, open: 0, voidedAt: f.context.now });
    expect(f.state.fulfillment.stock).toEqual(stock);
    expect(f.state.fulfillment.stockMovements).toEqual(movements);
    expect(f.state.orders[0].state).toBe('待出运');
    expect(lineShipmentFacts(f.state, f.line().lineId)).toMatchObject({ planned: 0, departed: 0, open: [] });
    expect(f.shipment()).toBeTruthy();
  });

  it('keeps customs amendment history and blocks departure after withdrawal until re-clearance', () => {
    const f = scenario(), id = f.shipment(); f.prepare(id);
    const customsId = f.customs(id), original = structuredClone(f.state.fulfillment.customs[0]);
    f.run({ type: 'fulfillment.customs.amend', payload: { id: customsId, kind: 'amend', reason: '海关回执更正收货人', fileIds: ['contract'] } }, 'logistics');
    expect(f.state.fulfillment.customs[0]).toMatchObject({ declarationNo: original.declarationNo, clearedAt: original.clearedAt, amendments: [{ kind: 'amend', reason: '海关回执更正收货人' }] });
    f.run({ type: 'fulfillment.customs.amend', payload: { id: customsId, kind: 'withdraw', reason: '海关确认退关', fileIds: [] } }, 'logistics');
    f.run({ type: 'fulfillment.shipments.ready', payload: { id } }, 'logistics');
    expect(() => f.depart(id)).toThrow('清关尚未完成');
    f.customs(id, 'submitted', customsId);
    expect(() => f.depart(id)).toThrow('清关尚未完成');
    f.customs(id, 'cleared', customsId); f.depart(id);
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'fulfillment.customs.amend', payload: { id: customsId, kind: 'withdraw', reason: '离港后退关', fileIds: [] } }, 'logistics')).toThrow('已离港');
    expect(f.state).toEqual(before);
  });

  it('does not retain express-channel status when a draft is changed to general customs', () => {
    const f = scenario(), id = f.shipment(), customsId = f.customs(id, 'draft', undefined, 'express');
    f.customs(id, 'draft', customsId, 'general');
    expect(f.state.fulfillment.customs[0].channel).toBe('general');
  });

  it('rejects packing rows without a positive net and gross weight', () => {
    const f = scenario(), id = f.shipment([{ ...f.line(), quantity: 4 }]);
    const s = f.state.fulfillment.shipments.find(x => x.id === id)!;
    const pack = (netWeight: number, grossWeight: number) => f.run({ type: 'fulfillment.shipments.pack', payload: { id, lines: s.lines.map((l, i) => ({ lineId: l.lineId, productionId: l.productionId, carton: String(i + 1), quantity: l.quantity, netWeight, grossWeight, volume: 0, note: '' })) } }, 'logistics');
    expect(() => pack(0, 0)).toThrow('净重须为正数');
    expect(() => pack(1, 0)).toThrow('毛重不能小于净重');
    expect(f.state.fulfillment.packing.filter(p => p.shipmentId === id)).toEqual([]);
    pack(1, 1.2);
    expect(f.state.fulfillment.packing.filter(p => p.shipmentId === id)).toHaveLength(1);
  });

  it.each(['submitted', 'cleared'] as const)('rejects stale generated declaration quantities before marking %s', status => {
    const f = scenario(), id = f.shipment([{ ...f.line(), quantity: 4 }]); f.pack(id); f.classify();
    const customsId = f.customs(id, 'draft');
    f.run({ type: 'fulfillment.customs.items', payload: { id: customsId } }, 'logistics');
    f.pack(id, 3);
    const before = structuredClone(f.state);
    expect(customsItemsStale(f.state, f.state.fulfillment.customs[0])).toBe(true);
    expect(() => f.customs(id, status, customsId)).toThrow('重新生成');
    expect(f.state).toEqual(before);
    f.run({ type: 'fulfillment.customs.items', payload: { id: customsId } }, 'logistics');
    f.customs(id, status, customsId);
    expect(f.state.fulfillment.customs[0]).toMatchObject({ status, grossWeight: 3, items: [{ quantity: 4, amount: 40 }] });
  });

  it('does not submit stale goods quantities after a draft shipment is edited', () => {
    const f = scenario(), id = f.shipment([{ ...f.line(), quantity: 4 }]);
    // A legal-unit declaration can be drafted before weights are needed.
    f.run({ type: 'fulfillment.customs.classify.save', payload: { family: 'garment', hsCode: '6203310000', declaredName: '男式上衣', brandType: '0', preference: '0', elements: ['机织', '上衣', '男式', '羊毛', '无品牌'], styles: ['LOCAL'], legalUnit: '件', secondUnit: '' } }, 'logistics');
    const customsId = f.customs(id, 'draft');
    f.run({ type: 'fulfillment.customs.items', payload: { id: customsId } }, 'logistics');
    f.shipment([{ ...f.line(), quantity: 6 }], id);
    expect(() => f.customs(id, 'submitted', customsId)).toThrow('重新生成');
    f.run({ type: 'fulfillment.customs.items', payload: { id: customsId } }, 'logistics');
    f.customs(id, 'submitted', customsId);
    expect(f.state.fulfillment.customs[0].items![0]).toMatchObject({ quantity: 6, amount: 60 });
  });
});
