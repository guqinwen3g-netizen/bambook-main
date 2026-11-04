import {expect,it} from 'vitest';
import {materialDeliveryFixture} from '../../../../server/src/mist/__tests__/materialDelivery';
import {lineStages} from './orderLineTrack';

it('completes material handoff when accepted plus short closure equals allocation, not before',()=>{
 const f=materialDeliveryFixture(20),issue=f.issue(16);
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id:issue,acceptedQuantity:16,rejectedQuantity:0,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
 const stage=()=>{const state=f.state,order=state.orders.find(o=>o.id===f.target.orderId)!,line=state.orderLines.find(l=>l.id===f.target.lineId)!;line.cmtIncludedItems=['trims','packaging'];return lineStages(state,order,line).find(s=>s.key==='material')!;};
 expect(stage().state).toBe('now');
 const allocation=f.state.internalFabricAllocations![0];
 allocation.shortClosure={quantity:'3',accepted:'16',reason:'Partial closure',at:f.context.now,actorId:'garment',actor:'Garment'};
 expect(stage().state).toBe('now');
 const command={type:'order.fabric.shortClose' as const,payload:{id:allocation.id,expectedRevision:allocation.revision,reason:'No replacement required'}};
 expect(()=>f.run(command,'reviewer')).toThrow('当前成衣负责人');
 f.run(command,'garment');expect(stage().state).toBe('done');
 // Stage derivation has no role-dependent writes or authorization effects.
 const before=structuredClone(f.state);stage();expect(f.state).toEqual(before);
});
