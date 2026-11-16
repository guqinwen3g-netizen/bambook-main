import {describe,expect,it} from 'vitest';
import {createMistState,type MistContext} from './mistWorkspace';
import {applyFulfillmentCommand,type FulfillmentCommand} from './mistFulfillment';

function fixture(){
 let n=0;const ctx:MistContext={id:()=>`history-${++n}`,now:'2026-11-18T04:00:00.000Z',actorId:'business',actorName:'Business'};let state=createMistState(ctx,'empty');
 state.orders.push({id:'order',code:'SO-HISTORY',type:'garment',ownerId:'business',currency:'CNY'}as any);state.orderLines.push({id:'line',orderId:'order',qty:1,unit:'件',name:'Jacket'}as any);
 state.fulfillment.samples.push({id:'sample',code:'SMP-HISTORY',name:'Jacket PP',category:'成衣',form:'产前样',source:{kind:'orderLine',orderId:'order',lineId:'line'},role:'pp',size:'M',color:'Navy',location:'Site',quantity:1,available:1,unit:'件',note:'',fileIds:[],createdAt:ctx.now,qualityRevision:1});
 state.fulfillment.qcTasks.push({id:'task',code:'QC-HISTORY',domain:'garment',kind:'sample',state:'reported',source:{kind:'orderLine',orderId:'order',lineId:'line'},sampleId:'sample',factory:'Factory',location:'Site',contact:'',requestedBy:'Business',assignee:'QC',assigneeId:'qc',createdAt:ctx.now,reportIds:['first']});
 state.fulfillment.qcReports.push({id:'first',taskId:'task',report:'QC-FIRST',result:'pass',reviewer:'QC',reviewedAt:ctx.now,measurements:[],fileIds:[],opinion:'Inspected',scopeRevision:1});
 const run=(command:FulfillmentCommand,actor=ctx)=>{const next=structuredClone(state);const result=applyFulfillmentCommand(next,command,actor);state=next;return result;};
 const confirm=(note='ORIGINAL_CUSTOMER_BASIS')=>run({type:'fulfillment.qc.confirm',payload:{id:'task',result:'approved',note}});
 const resume=()=>run({type:'fulfillment.qc.continue',payload:{id:'task',note:'ORIGINAL_CONTINUATION_BASIS'}});
 const report=()=>run({type:'fulfillment.qc.report',payload:{id:'task',domain:'garment',result:'pass',report:'QC-RECHECK',opinion:'Checked again',reviewedAt:ctx.now,measurements:[],fileIds:[]}}, {...ctx,actorId:'qc',actorName:'Inspector'});
 return{ctx,run,confirm,resume,report,get state(){return state;},task:()=>state.fulfillment.qcTasks[0]};
}

describe('QC customer and business evidence survives current-decision invalidation',()=>{
 it('keeps the old customer basis when a new decision replaces it, without retaining its old effective continuation',()=>{
  const f=fixture();f.confirm();f.resume();f.run({type:'fulfillment.qc.confirm',payload:{id:'task',result:'rejected',note:'New customer decision'}});
  expect(f.task().businessConfirmation?.result).toBe('rejected');expect(f.task().businessContinued).toBeUndefined();expect(JSON.stringify(f.state)).toContain('ORIGINAL_CUSTOMER_BASIS');
 });
 it('keeps old customer evidence when a new professional report invalidates its approval',()=>{
  const f=fixture();f.confirm();f.resume();f.report();expect(f.task().reportIds).toHaveLength(2);expect(f.task().businessConfirmation).toBeUndefined();expect(f.task().businessContinued).toBeUndefined();expect(JSON.stringify(f.state)).toContain('ORIGINAL_CUSTOMER_BASIS');
 });
 it('keeps the exact old basis when changed physical sample details require a new quality revision',()=>{
  const f=fixture();f.confirm();f.resume();f.run({type:'fulfillment.samples.edit',payload:{id:'sample',color:'Grey',location:'Site',note:'Updated colour',fileIds:[]}});expect(f.state.fulfillment.samples[0].qualityRevision).toBe(2);expect(f.task().businessConfirmation).toBeUndefined();expect(f.task().businessContinued).toBeUndefined();expect(JSON.stringify(f.state)).toContain('ORIGINAL_CUSTOMER_BASIS');
 });
 it('does not change any prior record if an attempted replacement fails validation',()=>{
  const f=fixture();f.confirm();f.resume();const before=structuredClone(f.state);expect(()=>f.run({type:'fulfillment.qc.confirm',payload:{id:'task',result:'rejected',note:''}})).toThrow();expect(f.state).toEqual(before);
 });
 it('binds archived customer and continuation snapshots to their old report, quality revision and original actors',()=>{
  const f=fixture();f.confirm();f.resume();f.report();const h=f.task().businessHistory!;expect(h).toHaveLength(1);expect(h[0]).toMatchObject({reportId:'first',qualityRevision:1,reason:'new_report',confirmation:{result:'approved',note:'ORIGINAL_CUSTOMER_BASIS',reportId:'first',actor:'Business',actorId:'business'},continued:{reportId:'first',note:'ORIGINAL_CONTINUATION_BASIS',actor:'Business',actorId:'business'},archivedBy:'Inspector',archivedById:'qc'});expect(f.task().businessConfirmation).toBeUndefined();expect(f.task().businessContinued).toBeUndefined();
 });
 it('keeps old physical evidence tied to the inspected quality version rather than the new sample version',()=>{
  const f=fixture();f.confirm();f.run({type:'fulfillment.samples.edit',payload:{id:'sample',color:'Grey',location:'Site',note:'Updated',fileIds:[]}});expect(f.task().businessHistory?.[0]).toMatchObject({reportId:'first',qualityRevision:1,reason:'sample_changed'});expect(f.state.fulfillment.samples[0].qualityRevision).toBe(2);
 });
 it('keeps multiple prior decisions in append order without mutating the first archive',()=>{
  const f=fixture();f.confirm();f.resume();f.run({type:'fulfillment.qc.confirm',payload:{id:'task',result:'rejected',note:'Changed customer decision'}});const first=structuredClone(f.task().businessHistory![0]);f.confirm('Reapproved basis');expect(f.task().businessHistory).toHaveLength(2);expect(f.task().businessHistory![0]).toEqual(first);expect(f.task().businessHistory![1].confirmation?.note).toBe('Changed customer decision');expect(f.task().businessConfirmation?.note).toBe('Reapproved basis');
 });
 it('does not trust report or actor identities supplied in the confirmation payload',()=>{
  const f=fixture();f.run({type:'fulfillment.qc.confirm',payload:{id:'task',result:'approved',note:'Customer basis',actor:'Forged',actorId:'other',reportId:'other'}}as any);expect(f.task().businessConfirmation).toMatchObject({actor:'Business',actorId:'business',reportId:'first'});
 });
 it('does not add an empty history or change record shape on first approval and first continuation',()=>{
  const f=fixture();f.confirm();f.resume();expect(f.task().businessHistory).toBeUndefined();
 });
 it('does not mutate direct caller state before a replacement basis passes validation',()=>{
  const f=fixture();f.confirm();f.resume();const before=structuredClone(f.state);expect(()=>applyFulfillmentCommand(f.state,{type:'fulfillment.qc.confirm',payload:{id:'task',result:'rejected',note:''}},f.ctx)).toThrow();expect(f.state).toEqual(before);
 });
 it('retains a prior continuation when the same valid approval receives a new continuation record',()=>{
  const f=fixture();f.confirm();f.resume();f.run({type:'fulfillment.qc.continue',payload:{id:'task',note:'Updated continuation basis'}});expect(f.task().businessHistory?.[0]).toMatchObject({reason:'continuation_changed',continued:{note:'ORIGINAL_CONTINUATION_BASIS',reportId:'first'}});expect(f.task().businessContinued?.note).toBe('Updated continuation basis');expect(f.task().businessConfirmation?.result).toBe('approved');
 });

});
