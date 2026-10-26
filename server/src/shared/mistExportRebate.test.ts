import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { orderRebate, rebatePlan, rebateCandidateBills, rebateClaimTotals, rebateRateFor, readRebate } from './mistExportRebate';
import type { SupplierBill } from './mistPayables';

function setup() {
  let n = 0; const ctx: MistContext = { id: () => `rb-${++n}`, now: '2026-10-17T04:00:00Z', actorName: '林舒', actorId: 'demo-finance' };
  let state = createMistState(ctx, 'demo');
  // 演示数据自带一张专票与退税率；本组用例从空白退税资料开始核对计算。
  state.exportRebate = { rates: [], claims: [] }; state.payables!.bills = [];
  const order = state.orders.find(o => o.code === 'SO-G-2026-017')!, line = state.orderLines.find(l => l.orderId === order.id)!;
  const customs = state.fulfillment.customs.find(c => state.fulfillment.shipments.find(s => s.id === c.shipmentId)?.state === 'departed')!;
  const po = { ...state.fulfillment.purchases[0], id: 'po-017', code: 'PC-017', orderId: order.id, lineId: line.id, kind: 'finished' as const, state: 'approved' as const };
  state.fulfillment.purchases.push(po);
  const bill = (id: string, invoiceNo: string, amount: number, taxAmount: number, extra: Partial<SupplierBill> = {}): SupplierBill => ({ invoiceType:'vat-special',id, code: 'AP-' + id, supplierId: po.supplierId, supplier: po.supplier, invoiceNo, invoiceDate: '2026-10-10', currency: 'CNY', amount, taxAmount, taxRate: '13%', lines: [{ purchaseId: po.id, purchaseCode: po.code, kind: 'finished', amount }], terms: [], due: '2026-11-10', dueBasis: '月结', fileIds: ['vat-original'], note: '', state: 'open', registeredAt: ctx.now, registeredBy: '林舒', ...extra });
  state.files.push({id:'vat-original',name:'supplier-invoice.pdf',mimeType:'application/pdf',size:10,storageKey:'test/vat-original',createdAt:ctx.now});
  state.payables!.bills.push(bill('b1', '0451001', 113000, 13000), bill('b2', '0451002', 56500, 6500), bill('b3', '0451003', 10000, 0), bill('b4', '0451004', 1130, 130, { currency: 'USD' }));
  state.receipts.push({ id: 'r-tax', code: 'BR-TAX-01', date: '2026-10-16', payer: '国家金库上海分库', amount: 19500, remaining: 19500, currency: 'CNY', ref: '出口退税', state: 'unmatched' });
  const run = (command: MistCommand) => { const out = applyMistCommand(state, command, ctx); state = out.state; return out.result as { id: string }; };
  return { get state() { return state; }, run, customs, order };
}

describe('出口退税', () => {
  it.each(['header','items'] as const)('低征收率专票的%s测算和申报不能超过对应进项税额',mode=>{
    const f=setup(),bill=f.state.payables!.bills[0],purchase=f.state.fulfillment.purchases.find(p=>p.id===bill.lines[0].purchaseId)!;
    bill.amount=10300;bill.taxAmount=300;bill.taxRate='3%';bill.lines[0].amount=10300;
    if(mode==='items')f.customs.items=[{no:1,hsCode:f.customs.hsCode,lineKeys:[purchase.lineId+':one']}] as any;else delete f.customs.items;
    f.run({type:'rebate.rate.save',payload:{hsCode:f.customs.hsCode,rate:'13',effectiveFrom:'2020-01-01',basis:'适用文库税率'}});
    const plan=rebatePlan(f.state,f.customs,'2026-10-13',[bill]);expect(plan.rebate).toBe(30000);expect(plan.bills[0]).toMatchObject({inputTaxCap:30000,taxLimited:true});
    const id=f.run({type:'rebate.claim.file',payload:{customsId:f.customs.id,billIds:[bill.id],filedAt:'2026-10-17',batchRef:'TAX-LOW-RATE',fileIds:['vat-original']}}).id;
    const claim=readRebate(f.state).claims.find(c=>c.id===id)!;expect(claim.expected).toBe(300);expect(claim.lines[0]).toMatchObject({inputTaxCap:300,taxLimited:true});
    expect(()=>f.run({type:'rebate.claim.approve',payload:{id,date:'2026-10-17',amount:1300,ref:'ADJ',reason:'超出本票进项税额'}})).toThrow(/不能超过/);
  });
  it.each(['header','items'] as const)('专票货物另有出运时（%s）明确拒绝，不整票计入本报关单',mode=>{
    const f=setup(),bill=f.state.payables!.bills[0],purchase=f.state.fulfillment.purchases.find(p=>p.id===bill.lines[0].purchaseId)!;
    const shipment=f.state.fulfillment.shipments.find(s=>s.id===f.customs.shipmentId)!;
    if(mode==='items')f.customs.items=[{no:1,hsCode:f.customs.hsCode,lineKeys:[purchase.lineId+':one']}] as any;else delete f.customs.items;
    f.run({type:'rebate.rate.save',payload:{hsCode:f.customs.hsCode,rate:'13',effectiveFrom:'2020-01-01',basis:'文库'}});
    expect(rebatePlan(f.state,f.customs,'2026-10-13',[bill]).blockers).toEqual([]);
    f.state.fulfillment.shipments.push({...shipment,id:'second-batch',code:'SHP-SECOND',state:'preparing',lines:[{lineId:purchase.lineId,orderId:purchase.orderId,quantity:1,factoryConfirmedAt:''}]});
    expect(rebatePlan(f.state,f.customs,'2026-10-13',[bill]).blockers).toEqual([expect.stringContaining('SHP-SECOND')]);
    expect(()=>f.run({type:'rebate.claim.file',payload:{customsId:f.customs.id,billIds:[bill.id],filedAt:'2026-10-17',batchRef:'SPLIT',fileIds:['vat-original']}})).toThrow(/整票对应一张报关单/);
    f.state.fulfillment.shipments.find(s=>s.id==='second-batch')!.state='cancelled';
    expect(rebatePlan(f.state,f.customs,'2026-10-13',[bill]).blockers).toEqual([]);
  });
  it('多商品项按各自进项税额封顶，未出口行与零退税率行不能抬高其他商品的可退额度',()=>{
    const f=setup(),bill=f.state.payables!.bills[0],purchase=f.state.fulfillment.purchases.find(p=>p.id===bill.lines[0].purchaseId)!;
    const other={...purchase,id:'other-purchase',lineId:'other-line',code:'PC-OTHER'};f.state.fulfillment.purchases.push(other);
    bill.amount=10300;bill.taxAmount=300;bill.taxRate='3%';bill.lines=[{...bill.lines[0],amount:5150},{purchaseId:other.id,purchaseCode:other.code,kind:'finished',amount:5150}];
    f.customs.items=[{no:1,hsCode:'620331',lineKeys:[purchase.lineId+':one']},{no:2,hsCode:'620432',lineKeys:[other.lineId+':two']}] as any;
    for(const[hsCode,rate]of[['620331','13'],['620432','0']])f.run({type:'rebate.rate.save',payload:{hsCode,rate,effectiveFrom:'2020-01-01',basis:'文库'}});
    let plan=rebatePlan(f.state,f.customs,'2026-10-13',[bill]);expect(plan.rebate).toBe(15000);expect(plan.bills[0].parts.map(p=>p.rebate)).toEqual([150,0]);
    f.customs.items.pop();plan=rebatePlan(f.state,f.customs,'2026-10-13',[bill]);expect(plan.rebate).toBe(15000);expect(plan.bills[0].inputTaxCap).toBe(15000);expect(plan.bills[0].excluded).toBe(500000);
  });
  it('同一商品项跨采购合同先合计再计算，分拆结果保留合法的一分退税',()=>{
    const f=setup(),bill=f.state.payables!.bills[0],purchase=f.state.fulfillment.purchases.find(p=>p.id===bill.lines[0].purchaseId)!;
    const purchases=[purchase,...[1,2].map(n=>({...purchase,id:'round-po-'+n,code:'PO-R-'+n}))];f.state.fulfillment.purchases.push(...purchases.slice(1));
    bill.amount=.09;bill.taxAmount=.01;bill.lines=purchases.map(p=>({purchaseId:p.id,purchaseCode:p.code,kind:'finished',amount:.03}));
    f.customs.items=[{no:1,hsCode:f.customs.hsCode,lineKeys:[purchase.lineId+':one']}] as any;f.run({type:'rebate.rate.save',payload:{hsCode:f.customs.hsCode,rate:'13',effectiveFrom:'2020-01-01',basis:'文库'}});
    const plan=rebatePlan(f.state,f.customs,'2026-10-13',[bill]);expect(plan.rebate).toBe(1);expect(plan.bills[0].parts.reduce((sum,part)=>sum+Math.round(part.rebate*100),0)).toBe(1);expect(plan.bills[0].inputTaxCap).toBe(1);
  });
  it('演示数据：已离港报关单有一张可配单的 13% 专票与退税率，预计应退 26,000 元', () => {
    const state = createMistState({ id: (() => { let n = 0; return () => `d-${++n}`; })(), now: '2026-10-17T04:00:00Z', actorName: '林舒' }, 'demo');
    const customs = state.fulfillment.customs.find(c => state.fulfillment.shipments.find(s => s.id === c.shipmentId)?.state === 'departed')!;
    const bills = rebateCandidateBills(state, customs);
    expect(bills.map(b => [b.amount, b.taxAmount])).toEqual([[226000, 26000]]);
    expect(rebateRateFor(state, customs.hsCode, '2026-10-13')?.rate).toBe('13');
  });
  it('财务权限：登记与申报用开票权，到账勾稽用核销权', () => {
    expect(mistCommandPermission({ type: 'rebate.rate.save', payload: { hsCode: '620331', rate: '13', effectiveFrom: '2020-03-20', basis: 'x' } })).toBe('invoices:write');
    expect(mistCommandPermission({ type: 'rebate.claim.receive', payload: { id: 'x', receiptId: 'y', amount: 1 } })).toBe('invoices:reconcile');
  });

  it('退税率按出口日期取最新生效版本，编码最长前缀优先，作废版本不参与', () => {
    const f = setup();
    f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203', rate: '9', effectiveFrom: '2019-01-01', basis: '旧公告' } });
    f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203.31', rate: '10', effectiveFrom: '2019-04-01', basis: '公告 A' } });
    const v13 = f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203.31', rate: '13', effectiveFrom: '2020-03-20', basis: '公告 B' } }).id;
    expect(rebateRateFor(f.state, '6203.3100', '2020-03-19')?.rate).toBe('10');
    expect(rebateRateFor(f.state, '6203.3100', '2026-10-13')?.rate).toBe('13');
    expect(rebateRateFor(f.state, '6204.11', '2026-10-13')).toBeUndefined();
    expect(() => f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203.31', rate: '13', effectiveFrom: '2020-03-20', basis: '重复' } })).toThrow('已有生效版本');
    expect(() => f.run({ type: 'rebate.rate.save', payload: { hsCode: '62AB', rate: '13', effectiveFrom: '2020-03-20', basis: 'x' } })).toThrow('HS 编码');
    expect(() => f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203', rate: '18', effectiveFrom: '2020-03-20', basis: 'x' } })).toThrow('0–17');
    f.run({ type: 'rebate.rate.void', payload: { id: v13, reason: '登错生效日' } });
    expect(rebateRateFor(f.state, '6203.3100', '2026-10-13')?.rate).toBe('10');
  });

  it('配单申报 → 核准调减 → 分次到账勾稽占用流水 → 冲回释放 → 少收写原因结清', () => {
    const f = setup();
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b1'], filedAt: '2026-10-16', batchRef: 'SB-01' } })).toThrow('请先登记退税率版本');
    const rate = f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203.31', rate: '13', effectiveFrom: '2020-03-20', basis: '财政部 税务总局公告 2020 年第 15 号' } }).id;
    // 候选只含本票订单的人民币专票；零税额票据与外币票不在其中。
    expect(rebateCandidateBills(f.state, f.customs).map(b => b.id)).toEqual(['b1', 'b2']);
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b3'], filedAt: '2026-10-16', batchRef: 'SB-01' } })).toThrow('税额为零');
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b4'], filedAt: '2026-10-16', batchRef: 'SB-01' } })).toThrow('不是人民币');
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b1'], filedAt: '2026-10-18', batchRef: 'SB-01' } })).toThrow('未来');
    const id = f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b1', 'b2'], filedAt: '2026-10-16', batchRef: 'SB-01' } }).id;
    let claim = readRebate(f.state).claims.find(c => c.id === id)!;
    // 计税金额 100000 + 50000，× 13% = 19500
    expect([claim.taxable, claim.expected, claim.state]).toEqual([150000, 19500, 'filed']);
    expect(orderRebate(f.state, f.order.id)).toEqual({ expected: 19500, approved: 19500, received: 0 });
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b1'], filedAt: '2026-10-16', batchRef: 'SB-02' } })).toThrow('已在');
    expect(() => f.run({ type: 'rebate.rate.void', payload: { id: rate, reason: 'x' } })).toThrow('已按该版本申报');

    expect(() => f.run({ type: 'rebate.claim.approve', payload: { id, date: '2026-10-16', amount: 19000, ref: '核准通知 01' } })).toThrow('差异原因');
    f.run({ type: 'rebate.claim.approve', payload: { id, date: '2026-10-16', amount: 19000, ref: '核准通知 01', reason: '一张发票部分品名不符，审核调减 500' } });
    claim = readRebate(f.state).claims.find(c => c.id === id)!;
    expect([claim.state, rebateClaimTotals(claim).open]).toEqual(['approved', 19000]);

    expect(() => f.run({ type: 'rebate.claim.receive', payload: { id, receiptId: 'r-tax', amount: 19500 } })).toThrow('超过本申报待到账金额');
    const first = f.run({ type: 'rebate.claim.receive', payload: { id, receiptId: 'r-tax', amount: 10000 } }).id;
    expect(f.state.receipts.find(r => r.id === 'r-tax')!.remaining).toBe(9500);
    f.run({ type: 'rebate.claim.reverseReceipt', payload: { id, entryId: first, reason: '勾错流水' } });
    expect(f.state.receipts.find(r => r.id === 'r-tax')!.remaining).toBe(19500);
    expect(() => f.run({ type: 'rebate.claim.receive', payload: { id, receiptId: 'r-tax', amount: 18800, settle: true } })).toThrow('少收原因');
    f.run({ type: 'rebate.claim.receive', payload: { id, receiptId: 'r-tax', amount: 18800, settle: true, reason: '税务机关扣抵滞纳金 200' } });
    claim = readRebate(f.state).claims.find(c => c.id === id)!;
    expect([claim.state, rebateClaimTotals(claim).received, rebateClaimTotals(claim).open, rebateClaimTotals(claim).difference]).toEqual(['received', 18800, 0, -700]);
    expect(f.state.receipts.find(r => r.id === 'r-tax')!.remaining).toBe(700);
    expect(orderRebate(f.state, f.order.id)).toEqual({ expected: 19500, approved: 19000, received: 18800 });
    expect(() => f.run({ type: 'rebate.claim.withdraw', payload: { id, reason: 'x' } })).toThrow('先冲回到账');
  });

  it('到账合计达到核准额自动结清；撤回释放发票后可重新申报', () => {
    const f = setup();
    f.run({ type: 'rebate.rate.save', payload: { hsCode: '620331', rate: '13', effectiveFrom: '2020-03-20', basis: '公告' } });
    const id = f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b2'], filedAt: '2026-10-16', batchRef: 'SB-01' } }).id;
    f.run({ type: 'rebate.claim.receive', payload: { id, receiptId: 'r-tax', amount: 6500 } });
    expect(readRebate(f.state).claims[0].state).toBe('received');
    const entry = readRebate(f.state).claims[0].receipts[0].id;
    f.run({ type: 'rebate.claim.reverseReceipt', payload: { id, entryId: entry, reason: '银行退回' } });
    expect(readRebate(f.state).claims[0].state).toBe('filed');
    f.run({ type: 'rebate.claim.withdraw', payload: { id, reason: '漏配一张专票，撤回重报' } });
    expect(rebateCandidateBills(f.state, f.customs).map(b => b.id)).toEqual(['b1', 'b2']);
    const again = f.run({ type: 'rebate.claim.file', payload: { customsId: f.customs.id, billIds: ['b1', 'b2'], filedAt: '2026-10-17', batchRef: 'SB-02' } }).id;
    expect(readRebate(f.state).claims.find(c => c.id === again)!.expected).toBe(19500);
  });

  it('未放行或未离港的报关单不能申报', () => {
    const f = setup();
    f.run({ type: 'rebate.rate.save', payload: { hsCode: '620331', rate: '13', effectiveFrom: '2020-03-20', basis: '公告' } });
    const state = f.state as MistState; const customs = state.fulfillment.customs.find(c => c.id === f.customs.id)!;
    customs.status = 'submitted';
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: customs.id, billIds: ['b1'], filedAt: '2026-10-16', batchRef: 'SB' } })).toThrow('尚未海关放行');
  });
  it('报关单已生成商品项：专票每行经采购 → 订单条目 → 商品项取各自 HS 的退税率逐项计算；不在商品项的行不计', () => {
    const f = setup();
    f.run({ type: 'rebate.rate.save', payload: { hsCode: '6203.31', rate: '13', effectiveFrom: '2020-03-20', basis: '公告' } });
    const state = f.state as MistState, customs = state.fulfillment.customs.find(c => c.id === f.customs.id)!;
    const line = state.orderLines.find(l => l.orderId === f.order.id)!;
    const other = state.orderLines.find(l => l.orderId !== f.order.id)!;
    const po2 = { ...state.fulfillment.purchases.find(p => p.id === 'po-017')!, id: 'po-lining', code: 'PC-LINING', lineId: line.id + '-x' };
    const po3 = { ...po2, id: 'po-other', code: 'PC-OTHER', lineId: other.id, orderId: other.orderId };
    state.fulfillment.purchases.push(po2, po3);
    const item = (no: number, hsCode: string, key: string) => ({ no, classificationId: 'c' + no, lineKeys: [key], styles: [], hsCode, declaredName: 'x', elements: '', quantity: 1, unit: '件', legalQty: 1, legalUnit: '件', secondQty: null, secondUnit: '', unitPrice: 1, amount: 1, currency: 'USD', origin: 'CN', destination: 'US' });
    customs.items = [item(1, '6203.3100', `${line.id}:`), item(2, '6204.6200', `${line.id}-x:p1`)] as never;
    const bill = state.payables!.bills.find(b => b.id === 'b1')!;
    // 价税合计 113000（税 13000）：三行 56500 / 33900 / 22600 → 计税 50000 / 30000 / 20000
    bill.lines = [{ purchaseId: 'po-017', purchaseCode: 'PC-017', kind: 'finished', amount: 56500 }, { purchaseId: 'po-lining', purchaseCode: 'PC-LINING', kind: 'finished', amount: 33900 }, { purchaseId: 'po-other', purchaseCode: 'PC-OTHER', kind: 'finished', amount: 22600 }];
    const exportDate = '2026-10-13';
    let plan = rebatePlan(state, customs, exportDate, [bill]);
    expect(plan.mode).toBe('items');
    expect(plan.blockers[0]).toContain('商品项 2（HS 6204.6200）没有适用');
    expect(() => f.run({ type: 'rebate.claim.file', payload: { customsId: customs.id, billIds: ['b1'], filedAt: '2026-10-16', batchRef: 'SB-I' } })).toThrow('商品项 2');
    const r9 = f.run({ type: 'rebate.rate.save', payload: { hsCode: '6204.62', rate: '9', effectiveFrom: '2020-03-20', basis: '公告' } }).id;
    plan = rebatePlan(f.state, f.state.fulfillment.customs.find(c => c.id === customs.id)!, exportDate, [f.state.payables!.bills.find(b => b.id === 'b1')!]);
    expect(plan.blockers).toEqual([]);
    expect([plan.taxable, plan.rebate]).toEqual([8000000, 650000 + 270000]);
    expect(plan.bills[0].excluded).toBe(2000000);
    const id = f.run({ type: 'rebate.claim.file', payload: { customsId: customs.id, billIds: ['b1'], filedAt: '2026-10-16', batchRef: 'SB-I' } }).id;
    const claim = readRebate(f.state).claims.find(c => c.id === id)!;
    expect(claim).toMatchObject({ byItems: true, rate: '9/13', taxable: 80000, expected: 9200, hsCode: '6203.3100、6204.6200' });
    expect(claim.lines[0].parts!.map(p => [p.itemNo, p.rate, p.taxable, p.rebate])).toEqual([[1, '13', 50000, 6500], [2, '9', 30000, 2700]]);
    expect(claim.lines[0].excluded).toBe(20000);
    expect(orderRebate(f.state, f.order.id).expected).toBe(9200);
    expect(orderRebate(f.state, other.orderId).expected).toBe(0);
    expect(() => f.run({ type: 'rebate.rate.void', payload: { id: r9, reason: 'x' } })).toThrow('已按该版本申报');
  });
});

it('does not treat a taxed ordinary invoice or an unclassified bill as a VAT special invoice',()=>{
 const f=setup();
 f.run({type:'rebate.rate.save',payload:{hsCode:'6203.31',rate:'13',effectiveFrom:'2020-03-20',basis:'文库'}});
 const bill=f.state.payables!.bills.find(b=>b.id==='b1')!;
 const file=()=>f.run({type:'rebate.claim.file',payload:{customsId:f.customs.id,billIds:[bill.id],filedAt:'2026-10-16',batchRef:'NEGATIVE'}});
 bill.invoiceType='vat-general';expect(rebateCandidateBills(f.state,f.customs).some(b=>b.id===bill.id)).toBe(false);expect(file).toThrow('未核对为增值税专用发票');
 delete bill.invoiceType;expect(rebateCandidateBills(f.state,f.customs).some(b=>b.id===bill.id)).toBe(false);expect(file).toThrow('未核对为增值税专用发票');
 bill.invoiceType='vat-special';bill.fileIds=[];expect(file).toThrow('缺少专票原件');
});

it('freezes the source invoice category and cancellation after filing until the declaration is withdrawn',()=>{
 const f=setup();f.run({type:'rebate.rate.save',payload:{hsCode:'6203.31',rate:'13',effectiveFrom:'2020-03-20',basis:'核对文库'}});
 const claim=f.run({type:'rebate.claim.file',payload:{customsId:f.customs.id,billIds:['b1'],filedAt:'2026-10-16',batchRef:'REFUND-1'}}).id;
 const classify={type:'payable.bill.classify' as const,payload:{id:'b1',invoiceType:'vat-general' as const,reason:'更正票种',fileIds:['vat-original']}};
 expect(()=>f.run(classify)).toThrow('退税申报');expect(()=>f.run({type:'payable.bill.void',payload:{id:'b1',reason:'更正'}})).toThrow('退税申报');
 f.run({type:'rebate.claim.withdraw',payload:{id:claim,reason:'更正进货凭证'}});f.run(classify);
 expect(f.state.payables!.bills.find(b=>b.id==='b1')!.invoiceType).toBe('vat-general');expect(rebateCandidateBills(f.state,f.customs).some(b=>b.id==='b1')).toBe(false);
});
