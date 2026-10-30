import { expect,it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';
import { internalFabricRemaining,materialDeliveryRows,materialDeliveryTargets,prepareMaterialDelivery } from './mistInternalFabric';

it('closes only an actually resolved shortage, preserves physical facts and prevents further supply',()=>{
 const f=materialDeliveryFixture(20), id=f.issue(20), allocation=f.state.internalFabricAllocations![0];
 const close=()=>f.run({type:'order.fabric.shortClose',payload:{id:allocation.id,expectedRevision:1,reason:'No replacement required'}} as never,'garment');
 expect(()=>close()).toThrow();
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:10,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'First count'}},'garment');
 expect(()=>close()).toThrow();
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:6,rejectedQuantity:0,expectedReceivingRevision:1,evidence:'Second count'}},'garment');
 expect(()=>close()).toThrow();
 f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'Hold A',person:'factory',note:'Rejected'}});
 const issueBefore=structuredClone(f.state.fulfillment.stockMovements.find(m=>m.id===id));
 const before=structuredClone(f.state);
 expect(()=>f.run({type:'order.fabric.shortClose',payload:{id:allocation.id,expectedRevision:1,reason:'not mine'}} as never,'reviewer')).toThrow('当前成衣负责人');
 expect(()=>f.run({type:'order.fabric.shortClose',payload:{id:allocation.id,expectedRevision:0,reason:'stale'}} as never,'garment')).toThrow('已变化');
 expect(f.state).toEqual(before);
 close();
 expect(f.state.internalFabricAllocations![0]).toMatchObject({metres:'20',revision:1,shortClosure:{quantity:'4',accepted:'16',reason:'No replacement required'}});
 expect(materialDeliveryRows(f.state)[0]).toMatchObject({accepted:'16',pending:'0',returned:'4'});
 expect(f.state.fulfillment.stockMovements.find(m=>m.id===id)).toEqual(issueBefore);
 expect(internalFabricRemaining(f.state,f.source.lineId)).toBe('4');
 expect(materialDeliveryTargets(f.state,f.purchaseId)).toEqual([]);
 expect(()=>close()).toThrow();expect(()=>prepareMaterialDelivery(f.state,f.purchaseId,f.productionId,1,f.context)).toThrow();
 f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:1,location:'A-01',person:'factory',note:'Later surplus'}});
 expect(materialDeliveryRows(f.state)[0].accepted).toBe('15');
 expect(internalFabricRemaining(f.state,f.source.lineId)).toBe('4');
 close();expect(f.state.internalFabricAllocations![0]).toMatchObject({shortClosure:{quantity:'5',accepted:'15'},shortHistory:[{quantity:'4',accepted:'16'}]});
 expect(internalFabricRemaining(f.state,f.source.lineId)).toBe('5');
});

it('does not use prior allocation deliveries to short-close a newly selected source',()=>{
 const f=materialDeliveryFixture(20),id=f.issue(4),allocationId=f.state.internalFabricAllocations![0].id;
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:0,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Rejected'}},'garment');
 f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'Hold',person:'factory',note:'Returned'}});
 const replacement=f.create('fabric');f.run({type:'order.fabric.allocate',payload:{...f.target,fabricOrderId:replacement.orderId,fabricLineId:replacement.lineId,metres:'4',expectedRevision:1}},'garment');
 expect(f.state.internalFabricAllocations![0]).toMatchObject({id:allocationId,revision:2});
 expect(()=>f.run({type:'order.fabric.shortClose',payload:{id:allocationId,expectedRevision:2,reason:'Wrong prior delivery'}},'garment')).toThrow('请先完成');
 expect(materialDeliveryRows(f.state).find(r=>r.id===id)?.delivery.allocationRevision).toBe(1);
});
