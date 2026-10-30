import {expect,it} from 'vitest';
import {internalDeliveryFixture} from '../mist/__tests__/internalDelivery';
import {assertInternalDeliveryIntegrity,internalDeliveryTotals,internalDeliveryRevision} from './mistInternalDelivery';

it('finishes only after the explicitly chosen recipient counts the goods, without financial or external shipment side effects',()=>{
 const f=internalDeliveryFixture(),before=structuredClone(f.state),id=f.send();
 expect(f.state.orders.find(o=>o.id===f.target.orderId)?.state).toBe('待内部接收');
 expect(()=>f.run({type:'order.internal.receive',payload:{id,accepted:10,rejected:0,expectedRevision:0,evidence:'Counted'}},'reviewer')).toThrow('指定接收账号');
 f.run({type:'order.internal.receive',payload:{id,accepted:10,rejected:0,expectedRevision:0,evidence:'Counted'}},'warehouse');
 expect(f.state.orders.find(o=>o.id===f.target.orderId)?.state).toBe('内部交付完成');
 expect(f.state.tasks.find(t=>t.id==='internal-delivery:'+id)?.done).toBe(true);
 expect(f.state.payables).toEqual(before.payables);expect(f.state.fulfillment.shipments).toEqual(before.fulfillment.shipments);
});

it('preserves partial counts, rejection return evidence and re-delivery without double reserving physical goods',()=>{
 const f=internalDeliveryFixture(),id=f.send();
 f.run({type:'order.internal.receive',payload:{id,accepted:6,rejected:4,expectedRevision:0,evidence:'Counted'}},'warehouse');
 expect(f.state.orders.find(o=>o.id===f.target.orderId)?.state).toBe('部分内部交付');
 expect(()=>f.send(4)).toThrow('超过');
 f.run({type:'order.internal.returnRejected',payload:{id,quantity:4,date:'2026-10-30',expectedRevision:1,evidence:'Rejected pieces returned'}});
 const replacement=f.send(4);f.run({type:'order.internal.receive',payload:{id:replacement,accepted:4,rejected:0,expectedRevision:0,evidence:'Replacement counted'}},'warehouse');
 expect(f.state.orders.find(o=>o.id===f.target.orderId)?.state).toBe('内部交付完成');
 const row=f.state.internalDeliveries!.find(r=>r.id===id)!;
 expect(row.returns).toHaveLength(1);expect(internalDeliveryTotals(row)).toMatchObject({accepted:6,rejected:4,returned:4,reserved:6});
 expect(()=>f.run({type:'order.internal.reverseCheck',payload:{id,checkId:row.checks[0].id,expectedRevision:2,reason:'Correction'}},'warehouse')).toThrow('退回记录');
});

it('corrects a receiving record with history, detects stale revisions and restores the pending task',()=>{
 const f=internalDeliveryFixture(),id=f.send();f.run({type:'order.internal.receive',payload:{id,accepted:10,rejected:0,expectedRevision:0,evidence:'Counted'}},'warehouse');
 const check=f.state.internalDeliveries![0].checks[0];
 expect(()=>f.run({type:'order.internal.reverseCheck',payload:{id,checkId:check.id,expectedRevision:0,reason:'Wrong count'}},'warehouse')).toThrow('记录已变化');
 f.run({type:'order.internal.reverseCheck',payload:{id,checkId:check.id,expectedRevision:1,reason:'Wrong count'}},'warehouse');
 expect(f.state.internalDeliveries![0].checks[0].reversed?.evidence).toBe('Wrong count');expect(f.state.tasks.find(t=>t.id==='internal-delivery:'+id)?.done).toBe(false);
 expect(internalDeliveryRevision(f.state.internalDeliveries![0])).toBe(2);
});

it('requires approved internal purpose, current QC, actual completion, delivered source and active recipient',()=>{
 for(const mutate of [
  (f:ReturnType<typeof internalDeliveryFixture>)=>{f.state.fulfillment.productionFacts.find(x=>x.productionId===f.productionId)!.completion=undefined;},
  (f:ReturnType<typeof internalDeliveryFixture>)=>{f.state.fulfillment.qcReports.find(x=>x.id==='finished-report')!.result='reject';},
  (f:ReturnType<typeof internalDeliveryFixture>)=>{f.state.fulfillment.receipts.find(x=>x.id==='finished-receipt')!.quantity=0;},
 ]){const f=internalDeliveryFixture();mutate(f);expect(()=>f.send()).toThrow();}
 const f=internalDeliveryFixture();expect(()=>f.send(10,'non-member')).toThrow();expect(()=>f.send(10.00001)).toThrow('四位');expect(()=>f.send(11)).toThrow('超过');
});

it('keeps warehouse stock and source issue distinct, and prevents an already linked issue from being returned or shipped twice',()=>{
 const f=internalDeliveryFixture(),receipt=f.state.fulfillment.receipts.find(r=>r.id==='finished-receipt')!;receipt.destination='warehouse';
 const stock={...f.state.fulfillment.stock[0],id:'finished-stock',purchaseId:f.processingId,receiptId:receipt.id,...f.target,name:'Jacket',unit:'件',quantity:10,available:0};f.state.fulfillment.stock.push(stock);
 f.state.fulfillment.stockMovements.push({id:'finished-issue',stockId:stock.id,kind:'issue',quantity:10,location:'Dispatch area',person:'Receiver',note:'Issue evidence',at:f.context.now,actor:'Warehouse'});
 const id=f.send(10,'warehouse',{kind:'stockIssue',id:'finished-issue'}),before=structuredClone(f.state);
 expect(()=>f.run({type:'fulfillment.inventory.move',payload:{id:stock.id,kind:'return',issueId:'finished-issue',quantity:1,location:'Warehouse',person:'Receiver',note:'Return'}})).toThrow('来源可交数量');
 expect(f.state).toEqual(before);
 f.run({type:'order.internal.cancel',payload:{id,expectedRevision:0,reason:'Unreceived goods recalled'}});
 expect(internalDeliveryTotals(f.state.internalDeliveries![0]).reserved).toBe(0);
});

it('protects active goods from upstream shrink, specification changes, source removal and external shipment reuse',()=>{
 const f=internalDeliveryFixture();f.send();
 const mutations:Array<(state:typeof f.state)=>void>=[
  state=>{state.fulfillment.receipts.find(r=>r.id==='finished-receipt')!.quantity=9;},
  state=>{state.fulfillment.productionFacts.find(p=>p.productionId===f.productionId)!.completion!.quantity=9;},
  state=>{state.orderLines.find(l=>l.id===f.target.lineId)!.qty=9;},
  state=>{state.orderLines.find(l=>l.id===f.target.lineId)!.style='Different physical item';},
  state=>{const breakdown=state.orderLines.find(l=>l.id===f.target.lineId)!.breakdown!;if(breakdown.kind==='garment')breakdown.rows[0].color='Different color';},
  state=>{state.fulfillment.receipts=state.fulfillment.receipts.filter(r=>r.id!=='finished-receipt');},
  state=>{state.orders.find(o=>o.id===f.target.orderId)!.governance!.status='cancelled';},
  state=>{state.fulfillment.shipments.push({id:'external-alias',state:'preparing',lines:[{productionId:f.productionId}]} as never);},
 ];
 for(const mutate of mutations){const state=structuredClone(f.state);mutate(state);expect(()=>assertInternalDeliveryIntegrity(state)).toThrow();}
 // JSONB storage may reorder keys without changing the approved physical item.
 const reordered=structuredClone(f.state),line=reordered.orderLines.find(l=>l.id===f.target.lineId)!;
 if(line.breakdown?.kind==='garment')line.breakdown={rows:line.breakdown.rows.map(row=>({quantities:row.quantities,color:row.color})),sizes:line.breakdown.sizes,kind:'garment'};
 reordered.orderLines=reordered.orderLines.map(l=>l.id===line.id?Object.fromEntries(Object.entries(line).reverse()) as typeof line:l);
 expect(()=>assertInternalDeliveryIntegrity(reordered)).not.toThrow();
});

it('records rejection under a new quality hold while refusing acceptance, and validates actual dates',()=>{
 const f=internalDeliveryFixture();
 expect(()=>f.run({type:'order.internal.send',payload:{orderId:f.target.orderId,productionId:f.productionId,source:{kind:'receipt',id:'finished-receipt'},quantity:10,receiverId:'warehouse',location:'Sample room',date:'2026-11-01',evidence:'Handover',expectedRevision:0}})).toThrow('晚于今天');
 const id=f.send();
 f.state.fulfillment.qcReports.find(r=>r.id==='finished-report')!.result='reject';
 expect(()=>f.run({type:'order.internal.receive',payload:{id,accepted:1,rejected:0,expectedRevision:0,evidence:'Counted'}},'warehouse')).toThrow('不允许接收');
 f.run({type:'order.internal.receive',payload:{id,accepted:0,rejected:10,expectedRevision:0,evidence:'Actual rejection'}},'warehouse');
 expect(internalDeliveryTotals(f.state.internalDeliveries![0])).toMatchObject({accepted:0,rejected:10,reserved:10});
});
