import {describe,expect,it} from 'vitest';
import {createMistState,type MistProduction} from '../../../../server/src/shared/mistWorkspace';
import {productionReleaseGate} from './productionGate';

function fixture(stoneConfirmed=false){
 const state=createMistState({id:()=>'',now:'2026-10-08T00:00:00Z',actorName:'测试'},'empty');
 state.orders=[{id:'o',type:'fabric'}] as any;
 state.orderLines=[{id:'l',orderId:'o',breakdown:{kind:'fabric',rows:[{color:'Navy',quantity:1},{color:'Stone',quantity:1}]}}] as any;
 const branch={id:'p',orderId:'o',lineId:'l'} as MistProduction;
 for(const color of ['Navy','Stone']){
  const source={kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'};
  state.fulfillment.samples.push({id:color,code:color,color,form:'米样',source,role:'pioneer',qualityRevision:1} as any);
  state.fulfillment.qcTasks.push({id:'q-'+color,sampleId:color,source,kind:'sample',state:'reported',reportIds:['r-'+color],businessConfirmation:color==='Navy'||stoneConfirmed?{result:'approved'}:undefined,businessContinued:{reportId:'r-'+color}} as any);
  state.fulfillment.qcReports.push({id:'r-'+color,taskId:'q-'+color,result:color==='Navy'?'pass':'conditional',opinion:color==='Stone'?'卷边，首批复核':'符合要求',scopeRevision:1} as any);
 }
 return {state,branch};
}
describe('fabric production gate',()=>{
 it('shows a missing garment material plan with a return to the exact order',()=>{
  const {state,branch}=fixture();state.orders[0].type='garment';
  const gate=productionReleaseGate(state,branch).find(item=>item.key==='material');
  expect(gate).toMatchObject({ok:false,target:{view:'orders/detail',id:'o'}});
  expect(gate?.detail).toContain('履约模式');
 });
 it('shows each ordered colour and leaves an unconfirmed colour blocked',()=>{
  const {state,branch}=fixture();const rows=productionReleaseGate(state,branch).filter(item=>item.key.startsWith('sample'));
  expect(rows).toHaveLength(2);
  expect(rows.find(item=>item.label.includes('Navy'))?.ok).toBe(true);
  expect(rows.find(item=>item.label.includes('Stone'))?.ok).toBe(false);
 });
 it('keeps a condition visible after both colours are adopted',()=>{
  const {state,branch}=fixture(true);const rows=productionReleaseGate(state,branch).filter(item=>item.key.startsWith('sample'));
  expect(rows.every(item=>item.ok)).toBe(true);
  expect(rows.find(item=>item.label.includes('Stone'))?.detail).toContain('有保留通过');
 });
});
