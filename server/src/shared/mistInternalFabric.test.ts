import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext, type MistOrderLine } from './mistWorkspace';
import { createOrderGovernance, getOrderGovernanceReviews, type OrderGovernanceInput } from './mistOrderGovernance';
import { assertGarmentMaterial, garmentMaterialBlocker, internalFabricCandidates, internalFabricRemaining, normalizeGarmentFulfillment, normalizeInternalMetres, type GarmentFulfillmentMode } from './mistInternalFabric';

function fixture(sourceQty = 100.3) {
  let serial = 0;
  const context: MistContext = { id: () => `supply-${++serial}`, now: '2026-10-24T08:00:00Z', actorId: 'garment', actorName: '成衣业务', members: [
    { id: 'garment', name: '成衣业务', active: true, groups: ['garment'] },
    { id: 'fabric', name: '面料业务', active: true, groups: ['fabric'] },
    { id: 'leader', name: '业务主管', active: true, groups: ['fabric', 'garment'] },
    { id: 'qc', name: '成衣QC', active: true, groups: [] },
  ], authority: { orderReviewerIds: { garment: ['leader'], fabric: ['leader'] }, supplier: { 'supplierCommitment.approvers.processing.garment': { version: 1, userIds: ['leader'] }, 'supplierCommitment.approvers.purchase.garment': { version: 1, userIds: ['leader'] } } } };
  const fabric = { ...context, actorId: 'fabric', actorName: '面料业务' }, leader = { ...context, actorId: 'leader', actorName: '业务主管' };
  let state = createMistState(context, 'empty');
  state.customers.push({ id: 'customer', name: '模拟客户', code: 'C1', country: 'CN', city: '', industry: '', owner: '成衣业务', ownerId: 'garment', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  state.files.push({ id: 'po', name: 'PO.pdf', mimeType: 'application/pdf', size: 4, storageKey: 'synthetic/po', createdAt: context.now });
  for (const id of ['factory', 'alternate']) state.market.suppliers.push({ id, code: id, name: id, type: '成衣加工', country: 'CN', address: '工厂', capabilities: '加工', capacity: 100, capacityUnit: '件', leadDays: 10, status: 'active', blockReason: '', contacts: [], fileIds: [], note: '', createdAt: context.now, updatedAt: context.now });
  const run = (command: MistCommand, actor = context) => { const result = applyMistCommand(state, command, actor); state = result.state; return result.result; };
  const contract = (internal = false): OrderGovernanceInput => ({ ...createOrderGovernance(context).contract, kind: internal ? 'internal' : 'external', poNumber: internal ? '' : 'PO-1', confirmationFileIds: internal ? [] : ['po'], internalPurpose: internal ? '供成衣生产' : '', receiver: internal ? '客户端显示名不可信' : '', paymentNote: '无定金，履约结算', depositPercent: 0, incoterm: 'FOB', deliveryPlace: '上海', ...(internal ? { internalSupply: { group: 'garment', receiverId: 'garment' } } : {}) });
  const create = (type: 'garment' | 'fabric', mode: GarmentFulfillmentMode | undefined = 'full_package', qty = type === 'fabric' ? sourceQty : 10, actor = type === 'fabric' ? fabric : context, input = contract(type === 'fabric')) => {
    const orderId = run({ type: 'order.create', payload: { type, customerId: type === 'fabric' ? '' : 'customer', season: 'AW', currency: 'USD', due: '2026-11-30', ownerId: actor.actorId!, governance: input, lines: [{ name: type === 'fabric' ? '斜纹面料' : '衬衫', style: type === 'fabric' ? 'F1' : 'G1', img: 'clay', qty, unit: type === 'fabric' ? '米' : '件', price: 10, ...(type === 'garment' && mode ? { fulfillmentMode: mode, cmtIncludedItems: [] } : {}) }] } }, actor).orderId!;
    return { orderId, lineId: state.orderLines.find(line => line.orderId === orderId)!.id };
  };
  const approve = (orderId: string, actor = context) => { run({ type: 'order.governance.submit', payload: { orderId } }, actor); run({ type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: '核对通过' } }, leader); };
  const source = create('fabric'); approve(source.orderId, fabric);
  const target = create('garment'); approve(target.orderId);
  const allocate = (metres = '20', targetLine = target, revision = 0, sourceLine = source, actor = context) => run({ type: 'order.fabric.allocate', payload: { ...targetLine, fabricOrderId: sourceLine.orderId, fabricLineId: sourceLine.lineId, metres, expectedRevision: revision } }, actor);
  const revise = (which = source, patch: Partial<MistOrderLine> = {}, governance?: OrderGovernanceInput, actor = which.orderId === source.orderId ? fabric : context) => {
    const order = state.orders.find(row => row.id === which.orderId)!;
    return run({ type: 'order.governance.saveDraft', payload: { orderId: order.id, input: governance || order.governance!.contract, reason: '调整计划', lines: state.orderLines.filter(line => line.orderId === order.id).map(line => ({ ...line, ...patch })) } }, actor);
  };
  const purchase = (kind: 'processing' | 'material' | 'finished' = 'processing', materialKind?: 'fabric' | 'trims' | 'packaging' | 'other') => run({ type: 'fulfillment.procurement.save', payload: { ...target, kind, ...(materialKind ? { materialKind } : {}), supplierId: 'factory', supplier: 'factory', description: '衬衫加工', quantity: 10, unit: '件', price: 2, currency: 'USD', due: '2026-11-20', terms: '验收后结算', destination: '工厂', note: '', fileIds: ['po'] } }).id!;
  const production = () => {
    const id = purchase(); run({ type: 'fulfillment.procurement.submit', payload: { id } }); run({ type: 'fulfillment.procurement.decide', payload: { id, decision: 'approved', note: '核准' } }, leader);
    run({ type: 'fulfillment.procurement.send', payload: { id, at: context.now, evidence: '线下发出', fileIds: ['po'] } }); run({ type: 'fulfillment.procurement.confirm', payload: { id, at: context.now, confirmedDue: '2026-11-20', evidence: '工厂确认', fileIds: ['po'] } });
    const productionId = state.productions.find(row => row.sourcePurchaseId === id)!.id;
    run({ type: 'fulfillment.production.plan', payload: { productionId, sizes: [{ size: 'M', quantity: 10 }] } });
    return { id, productionId };
  };
  const pp = (productionId: string, actor = context) => run({ type: 'fulfillment.samples.create', payload: { name: '衬衫产前样', category: '成衣', form: '产前样', unit: '件', quantity: 1, location: '样品室', size: 'M', color: '蓝', source: { kind: 'orderLine', ...target, productionId }, role: 'pp', fileIds: [], note: '' } }, actor).id!;
  const approvePp = (productionId: string) => {
    const sampleId=pp(productionId), source={kind:'orderLine' as const,...target,productionId};
    const id=run({type:'fulfillment.qc.request',payload:{source,sampleId,domain:'garment',kind:'sample',factory:'factory',location:'样品室',contact:'',due:'2026-10-24'}}).id!;
    const inspector={...context,actorId:'qc',actorName:'成衣QC'};
    run({type:'fulfillment.qc.claim',payload:{id,domain:'garment'}},inspector);
    run({type:'fulfillment.qc.report',payload:{id,domain:'garment',result:'pass',report:'PP-REPORT',opinion:'尺寸与工艺通过',measurements:[],fileIds:[],reviewedAt:context.now}},inspector);
    run({type:'fulfillment.qc.confirm',payload:{id,result:'approved',note:'客户确认通过'}});
    run({type:'fulfillment.qc.continue',payload:{id,note:'业务确认继续'}});
    return sampleId;
  };
  return { approvePp, context, fabric, leader, run, contract, create, approve, source, target, allocate, revise, purchase, production, pp, get state() { return state; } };
}

describe('current Mist internal fabric contract', () => {
  it('uses inventory handover rather than export shipments or CI for internal supply',()=>{
    const f=fixture(),before=structuredClone(f.state);
    expect(()=>f.run({type:'fulfillment.shipments.save',payload:{consignee:'Production',mode:'sea',portOfLoading:'Warehouse',portOfDischarge:'Factory',incoterm:'Internal',plannedDate:'2026-10-24',booking:'',lines:[{...f.source,quantity:1,factoryConfirmedAt:'2026-10-24'}],note:'',fileIds:[]}})).toThrow('内部订单请登记库存交接');
    expect(f.state).toEqual(before);
    f.state.fulfillment.shipments.push({id:'retained-shipment',state:'preparing',lines:[{...f.source,quantity:1}]} as never);
    expect(()=>f.run({type:'fulfillment.documents.save',payload:{shipmentId:'retained-shipment',orderId:f.source.orderId,type:'CI',number:'CI-INTERNAL',title:'CI',dueDate:'2026-11-24',content:'Internal',fileIds:['po']}})).toThrow('内部订单不生成销售发票');
    f.state.fulfillment.documents.push({id:'retained-ci',shipmentId:'retained-shipment',orderId:f.source.orderId,type:'CI',status:'draft',fileIds:['po']} as never);
    expect(()=>f.run({type:'fulfillment.documents.issue',payload:{id:'retained-ci'}})).toThrow('内部订单不生成销售发票');
    expect(f.state.invoices).toEqual([]);
  });
  it('keeps unknown garment modes unknown and blocks submitting them', () => {
    const f = fixture(), target = f.create('garment', undefined); // Default argument is explicit full package; remove through a draft edit.
    const order = f.state.orders.find(row => row.id === target.orderId)!;
    const line = f.state.orderLines.find(row => row.id === target.lineId)!; delete line.fulfillmentMode; delete line.cmtIncludedItems;
    expect(() => f.run({ type: 'order.governance.submit', payload: { orderId: target.orderId } })).toThrow('履约模式');
    expect(order.governance!.status).toBe('draft'); expect(normalizeGarmentFulfillment({}, false)).toEqual({});
    expect(() => normalizeGarmentFulfillment({ fulfillmentMode: 'cmt', cmtIncludedItems: ['辅料' as never] })).toThrow('包含项目');
  });
  it('freezes mode and explicit included items in approval snapshots', () => {
    const f = fixture(); expect(f.state.orders.find(row => row.id === f.target.orderId)!.governance!.approvedSnapshot!.lines[0]).toMatchObject({ fulfillmentMode: 'full_package', cmtIncludedItems: [] });
    expect(f.state.orders.find(row => row.id === f.source.orderId)!.governance!.contract.receiver).toBe('成衣 / 成衣业务');
    const reviews=getOrderGovernanceReviews(f.state),target=reviews.find(row=>row.entityId===f.target.orderId)!,source=reviews.find(row=>row.entityId===f.source.orderId)!;
    expect(target.details.find(row=>row.label==='G1 · 衬衫')?.value).toContain('全包');
    expect(target.details.find(row=>row.label==='G1 · 衬衫')?.value).toContain('CMT 包含：无');
    expect(source.details.some(row=>row.label==='付款'||row.label==='出运前累计收款')).toBe(false);
  });
  it('requires fresh fabric creator and owner, and a fresh garment receiver', () => {
    const f = fixture(), before = JSON.stringify(f.state);
    expect(() => f.create('fabric', undefined, 100, f.context)).toThrow('面料业务组');
    expect(() => f.create('fabric', undefined, 100, f.fabric, { ...f.contract(true), internalSupply: { group: 'garment', receiverId: 'fabric' } })).toThrow('成衣业务组');
    const inactive = { ...f.fabric, members: f.context.members!.map(member => member.id === 'garment' ? { ...member, active: false } : member) };
    expect(() => f.create('fabric', undefined, 100, inactive)).toThrow('停用'); expect(JSON.stringify(f.state)).toBe(before);
  });
  it('sums exact decimal metres across target lines and refuses the first extra fraction atomically', () => {
    const f = fixture(.3), second = f.create('garment'); f.approve(second.orderId);
    f.allocate('0.1'); f.allocate('0.2', second);
    expect(internalFabricRemaining(f.state, f.source.lineId)).toBe('0');
    const before = JSON.stringify(f.state); expect(() => f.allocate('0.2001', second, 1)).toThrow('余量'); expect(JSON.stringify(f.state)).toBe(before);
    expect(normalizeInternalMetres('12.3400')).toBe('12.34'); expect(() => normalizeInternalMetres('0.00001')).toThrow('四位小数');
  });
  it('requires exact source identity, approved supply, metre units and garment actors', () => {
    const f = fixture(), pending = f.create('fabric');
    expect(() => f.allocate('1', f.target, 0, pending)).toThrow('尚未批准');
    expect(() => f.allocate('1', f.target, 0, { ...f.source, orderId: pending.orderId })).toThrow('条目不存在');
    expect(() => f.allocate('1', f.target, 0, f.source, f.fabric)).toThrow('成衣业务组');
    f.revise(f.source, { unit: '码' }); f.approve(f.source.orderId, f.fabric);
    expect(() => f.allocate()).toThrow('米数单位');
  });
  it('exposes candidates with the current target allocation added back and preserves change/cancel history', () => {
    const f = fixture(30), id = f.allocate('20').id!;
    expect(internalFabricCandidates(f.state, f.target.orderId, f.target.lineId, f.context)[0]).toMatchObject({ remaining: '30', allocated: '0' });
    f.allocate('25', f.target, 1); expect(internalFabricRemaining(f.state, f.source.lineId)).toBe('5');
    expect(() => f.allocate('1', f.target, 1)).toThrow('已变化');
    f.run({ type: 'order.fabric.cancel', payload: { id, expectedRevision: 2 } });
    expect(internalFabricRemaining(f.state, f.source.lineId)).toBe('30');
    expect(f.state.internalFabricAllocations![0]).toMatchObject({ status: 'cancelled', revision: 3 });
    expect(f.state.internalFabricAllocations![0].history.map(row => row.metres)).toEqual(['20', '25']);
  });
  it('rejects reducing a source below allocations and changing an allocated target to CMT', () => {
    const f = fixture(); f.allocate('20'); const before = JSON.stringify(f.state);
    expect(() => f.revise(f.source, { qty: 19 })).toThrow('低于已分配');
    expect(() => f.revise(f.target, { fulfillmentMode: 'cmt', cmtIncludedItems: [] })).toThrow('取消该条目');
    expect(() => f.revise(f.source, {}, { ...f.contract(true), internalSupply: undefined })).toThrow('取消受影响'); expect(JSON.stringify(f.state)).toBe(before);
  });
  it('keeps draft source increases from expanding the approved supply', () => {
    const f = fixture(20); f.allocate('20'); f.revise(f.source, { qty: 100 });
    expect(internalFabricRemaining(f.state, f.source.lineId)).toBe('0'); expect(() => f.allocate('21', f.target, 1)).toThrow('余量');
    f.approve(f.source.orderId, f.fabric); f.allocate('21', f.target, 1); expect(internalFabricRemaining(f.state, f.source.lineId)).toBe('79');
  });
  it('blocks full-package PP creation before allocation but accepts an approved plan before physical fabric production', () => {
    const f = fixture(), { productionId } = f.production(), before = JSON.stringify(f.state);
    expect(() => f.pp(productionId)).toThrow('先分配内部面料'); expect(JSON.stringify(f.state)).toBe(before);
    f.allocate(); expect(f.pp(productionId)).toBeTruthy();
    expect(f.state.fulfillment.purchases.every(row => row.orderId !== f.source.orderId)).toBe(true); expect(f.state.fulfillment.stock).toHaveLength(0);
  });
  it('uses the same fresh gate on PP, release and continued production after a cancelled allocation', () => {
    const f = fixture(), { productionId } = f.production(), id = f.allocate().id!; f.pp(productionId);
    f.run({ type: 'order.fabric.cancel', payload: { id, expectedRevision: 1 } });
    expect(() => f.run({ type: 'fulfillment.production.release', payload: { productionId, note: '拟开产' } })).toThrow('先分配内部面料');
    expect(() => f.run({ type: 'production.move', payload: { id: productionId, col: 'sew' } })).toThrow('先分配内部面料');
    expect(() => f.run({ type: 'production.update', payload: { id: productionId, pct: 10 } })).toThrow('先分配内部面料');
  });
  it('revoked receiver membership, invalid source approval and over-allocation block the gate without changing evidence', () => {
    const f = fixture(); f.allocate(); const stale = { ...f.context, members: f.context.members!.map(member => member.id === 'garment' ? { ...member, active: false } : member) };
    expect(garmentMaterialBlocker(f.state, f.target.orderId, f.target.lineId, stale)).toContain('停用');
    f.state.orderLines.find(line => line.id === f.source.lineId)!.qty = 1;
    expect(() => assertGarmentMaterial(f.state, f.target.orderId, f.target.lineId, f.context)).toThrow('批准快照');
  });
  it.each(['cmt', 'trims_cmt'] as const)('%s requires no internal fabric allocation', mode => {
    const f = fixture(), target = f.create('garment', mode); f.approve(target.orderId);
    expect(garmentMaterialBlocker(f.state, target.orderId, target.lineId, f.context)).toBe('');
  });
  it('rejects fabric and finished purchases on garment lines and preserves typed material classifications', () => {
    const f = fixture(); expect(() => f.purchase('material', 'fabric')).toThrow('面料组'); expect(() => f.purchase('finished')).toThrow('加工服务');
    expect(() => f.purchase('material')).toThrow('物料类别');
    const id = f.purchase('material', 'trims'); expect(f.state.fulfillment.purchases.find(row => row.id === id)!.materialKind).toBe('trims');
    f.run({ type: 'fulfillment.procurement.submit', payload: { id } }); expect(f.state.fulfillment.purchases.find(row => row.id === id)!.revisionHistory![0].snapshot.materialKind).toBe('trims');
  });
  it('does not let a proposed mode or CMT inclusion change duplicate existing material purchases', () => {
    const f = fixture(); f.purchase('material', 'trims');
    expect(() => f.revise(f.target, { cmtIncludedItems: ['trims'] })).toThrow('重复采购');
    expect(() => f.revise(f.target, { fulfillmentMode: 'cmt', cmtIncludedItems: [] })).toThrow('不另行采购');
  });
  it('does not reuse an approved PP after its exact full-package material plan changes', () => {
    const f=fixture();f.allocate();const {productionId}=f.production(),sampleId=f.approvePp(productionId);
    f.run({type:'fulfillment.production.release',payload:{productionId,note:'用料与产前样核对通过'}});
    const original=f.state.fulfillment.samples.find(sample=>sample.id===sampleId)!.materialPlan;
    f.allocate('21',f.target,1);
    expect(()=>f.run({type:'production.update',payload:{id:productionId,pct:10}})).toThrow('用料计划已变化');
    expect(f.state.fulfillment.samples.find(sample=>sample.id===sampleId)!.materialPlan).toBe(original);
    f.approvePp(productionId);expect(()=>f.run({type:'production.update',payload:{id:productionId,pct:10}})).not.toThrow();
  });
  it('preserves the approved PP when only the source fabric price changes', () => {
    const f=fixture();f.allocate();const {productionId}=f.production(),sampleId=f.approvePp(productionId);
    f.run({type:'fulfillment.production.release',payload:{productionId,note:'用料与产前样核对通过'}});
    const original=f.state.fulfillment.samples.find(sample=>sample.id===sampleId)!.materialPlan;
    f.revise(f.source,{price:12});f.approve(f.source.orderId,f.fabric);
    expect(()=>f.run({type:'production.update',payload:{id:productionId,pct:10}})).not.toThrow();
    expect(f.state.fulfillment.samples.find(sample=>sample.id===sampleId)!.materialPlan).toBe(original);
  });
  it('keeps material RFQ classification through award and rejects a forbidden CMT material inquiry', () => {
    const f=fixture(),input={...f.target,kind:'material' as const,materialKind:'packaging' as const,description:'包装箱',quantity:10,unit:'件',currency:'USD',due:'2026-11-20',destination:'工厂',deadline:'2026-11-01',supplierIds:['factory','alternate']};
    const id=f.run({type:'rfq.save',payload:{input}}).id!;
    const quoteId=f.run({type:'rfq.quote',payload:{id,supplierId:'factory',price:2,currency:'USD',moq:1,promisedDue:'2026-11-20',terms:'验收结算',validUntil:'2026-11-15'}}).quoteId!;
    const purchaseId=f.run({type:'rfq.award',payload:{id,quoteId,reason:'另一家未报价'}}).purchaseId!;
    expect(f.state.fulfillment.purchases.find(p=>p.id===purchaseId)!.materialKind).toBe('packaging');
    const cmt=f.create('garment','cmt');
    expect(()=>f.run({type:'rfq.save',payload:{input:{...input,...cmt}}})).toThrow('不另行采购');
  });
  it('preserves classification when transferring a material contract to a new supplier', () => {
    const f = fixture(), id = f.purchase('material', 'packaging'); f.run({ type: 'fulfillment.procurement.submit', payload: { id } }); f.run({ type: 'fulfillment.procurement.decide', payload: { id, decision: 'approved', note: '批准' } }, f.leader);
    const transferred = f.run({ type: 'sourcing.purchase.transfer', payload: { purchaseId: id, supplierId: 'alternate', price: 3, currency: 'USD', due: '2026-11-20', reason: '调整供应商' } });
    const purchase = f.state.fulfillment.purchases.find(row => row.id === transferred.purchaseId)!;
    expect(purchase.materialKind).toBe('packaging'); expect(purchase.state).toBe('draft');
  });
});
