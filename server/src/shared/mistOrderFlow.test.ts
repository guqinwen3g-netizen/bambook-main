import { describe, expect, it } from 'vitest';
import type { MistEvent } from './mistWorkspace';
import { projectOrderFlowEvents, visibleOrderFlow } from './mistOrderFlow';
const event=():MistEvent=>({id:'e',entityType:'order',entityId:'source',actor:'业务员',at:'2026-11-18T04:00:00Z',text:'拆分订单：A 4 米；按批次交付',fileIds:[],orderFlow:{action:'split',sourceOrderId:'source',targetOrderId:'target',lines:[{sourceLineId:'a',targetLineId:'copy-a',quantity:4,unit:'米'},{sourceLineId:'b',targetLineId:'b',quantity:20,unit:'码'}]}});
const orders=[{id:'source'},{id:'target'}];
describe('trusted visible order movement references',()=>{
 it('preserves partial-copy and whole-move snapshots in both directions without mutating raw',()=>{
  const source=event(),target={...structuredClone(source),id:'peer-event',entityId:'target'},raw=structuredClone([source,target]);
  const result=projectOrderFlowEvents([source,target],orders);expect(result.map(e=>e.orderFlow)).toEqual([source.orderFlow,source.orderFlow]);expect(result[0].orderFlow).not.toBe(source.orderFlow);expect([source,target]).toEqual(raw);
 });
 it('does not backfill a legacy event even when its prose names a current visible order',()=>{
  const legacy=event();delete legacy.orderFlow;legacy.text='移至 target / SO-PEER；按批次';const raw=structuredClone(legacy);expect(projectOrderFlowEvents([legacy],orders)).toEqual([raw]);expect(legacy).toEqual(raw);
 });
 it('drops a packet whose counterpart disappeared, is ambiguous or no longer belongs to this record',()=>{
  const e=event(),raw=structuredClone(e);expect(projectOrderFlowEvents([e],[{id:'source'}])[0].orderFlow).toBeUndefined();expect(visibleOrderFlow(e,[...orders,{id:'target'}])).toBeUndefined();expect(visibleOrderFlow({...e,entityId:'unrelated'},orders)).toBeUndefined();expect(e).toEqual(raw);
 });
 it.each([
  (e:MistEvent)=>{e.orderFlow!.sourceOrderId=e.orderFlow!.targetOrderId;},
  (e:MistEvent)=>{e.orderFlow!.lines[0].quantity=0;},
  (e:MistEvent)=>{e.orderFlow!.lines[0].quantity=Infinity;},
  (e:MistEvent)=>{e.orderFlow!.lines[0].quantity=.12345;},
  (e:MistEvent)=>{e.orderFlow!.lines.push({...e.orderFlow!.lines[0]});},
  (e:MistEvent)=>{e.orderFlow!.lines[0].unit='';},
  (e:MistEvent)=>{e.orderFlow!.action='merge';},
 ])('rejects malformed movement facts without substituting another visible order',change=>{const e=event();change(e);expect(visibleOrderFlow(e,orders)).toBeUndefined();});
 it('accepts a merge only with the same moved line identity and strips unrelated money fields',()=>{
  const e=event();e.orderFlow!.action='merge';e.orderFlow!.lines=e.orderFlow!.lines.slice(1);(e.orderFlow as any).amount=900;(e.orderFlow!.lines[0] as any).cost=90;
  expect(visibleOrderFlow(e,orders)).toEqual({action:'merge',sourceOrderId:'source',targetOrderId:'target',lines:[{sourceLineId:'b',targetLineId:'b',quantity:20,unit:'码'}]});
 });
});
