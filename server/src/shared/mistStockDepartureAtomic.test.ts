import {expect,it} from 'vitest';
import {stockDepartureAtomicFixture} from '../mist/__tests__/stockDepartureAtomic';
import {applyMistCommand} from './mistWorkspace';

it('rejects insufficient free stock through the outer command and preserves shipment, sample and unused release',()=>{
 const x=stockDepartureAtomicFixture();x.f.run({type:'fulfillment.stock.reserve',payload:{stockId:x.stockId,orderId:x.otherOrderId,lineId:x.otherLineId,quantity:8,purpose:'另一条目正常预留'}});const before=structuredClone(x.f.state);
 expect(()=>applyMistCommand(x.f.state,x.depart,x.warehouse)).toThrow(/库存.*不足/);expect(x.f.state).toEqual(before);expect(x.f.state.fulfillment.shipments.find(s=>s.id===x.shipmentId)?.state).toBe('ready');expect(x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)?.available).toBe(4);expect(x.f.state.platform.risks.find(r=>r.id===x.riskId)?.release?.shipmentId).toBeUndefined();
});
it('still departs the full quantity, consumes the included sample and release exactly once when stock is sufficient',()=>{
 const x=stockDepartureAtomicFixture(),result=applyMistCommand(x.f.state,x.depart,x.warehouse),stock=result.state.fulfillment.stock.find(s=>s.id===x.stockId)!;
 expect(stock).toMatchObject({quantity:10,available:0});expect(result.state.fulfillment.stockMovements.filter(m=>m.kind==='issue'&&m.shipmentLink?.shipmentId===x.shipmentId).reduce((n,m)=>n+m.quantity,0)).toBe(10);expect(result.state.fulfillment.samples.find(s=>s.id===x.sampleId)?.available).toBe(0);expect(result.state.platform.risks.find(r=>r.id===x.riskId)?.release?.shipmentId).toBe(x.shipmentId);
});
it('retains legitimate processing service handover without inventing any warehouse inventory',()=>{
 const x=stockDepartureAtomicFixture(true);expect(x.f.state.fulfillment.receipts.find(r=>r.purchaseId===x.purchaseId)).toMatchObject({destination:'supplier',quantity:10});expect(x.f.state.fulfillment.stock).toEqual([]);
 const result=applyMistCommand(x.f.state,x.depart,x.warehouse);expect(result.state.fulfillment.stock).toEqual([]);expect(result.state.fulfillment.stockMovements.filter(m=>m.kind==='issue')).toEqual([]);expect(result.state.fulfillment.shipments.find(s=>s.id===x.shipmentId)?.state).toBe('departed');expect(result.state.fulfillment.samples.find(s=>s.id===x.sampleId)?.available).toBe(0);
});
it.each(['depleted','unit','missing-row','unrelated-only'] as const)('rejects a %s warehouse source instead of silently departing without its inventory',problem=>{
 const x=stockDepartureAtomicFixture();if(problem==='depleted'){const stock=x.f.state.fulfillment.stock.find(s=>s.id===x.stockId)!;stock.available=0;stock.positions=[{location:stock.location,available:0}];}if(problem==='unit')x.f.state.fulfillment.stock.find(s=>s.id===x.stockId)!.unit='米';if(problem==='missing-row')x.f.state.fulfillment.stock=[];if(problem==='unrelated-only'){const stock=x.f.state.fulfillment.stock[0];stock.purchaseId='another-purchase';stock.orderId=x.otherOrderId;stock.lineId=x.otherLineId;}const before=structuredClone(x.f.state);expect(()=>applyMistCommand(x.f.state,x.depart,x.warehouse)).toThrow(/库存.*不足/);expect(x.f.state).toEqual(before);
});
