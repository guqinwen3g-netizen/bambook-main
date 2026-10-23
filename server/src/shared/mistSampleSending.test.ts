import {expect,it} from 'vitest';
import {createMistState} from './mistWorkspace';
import type {FulfillmentSample,FulfillmentQcTask,FulfillmentQcReport} from './mistFulfillment';
import {sampleConfirmationBlocker,sampleSendBlocker,sampleSendPurpose} from './mistSampleSending';
function fixture(){
 const state=createMistState({id:()=>'',now:'2026-10-08T00:18:00Z',actorName:'QC'},'empty');
 const sample={id:'s',code:'S',quantity:1,available:1,size:'M',qualityRevision:1,source:{kind:'version',devId:'d',versionId:'v'}} as FulfillmentSample;
 state.devs.push({id:'d'} as any);state.versions.push({id:'v',devId:'d',returnedAt:'2026-10-08T00:18:00Z',qc:{result:'pass'}} as any);state.fulfillment.samples=[sample];
 const task={id:'q',source:sample.source,kind:'sample',sampleId:'s',state:'reported',reportIds:['r']} as FulfillmentQcTask;
 const report={id:'r',taskId:'q',result:'pass',scopeRevision:1} as FulfillmentQcReport;return{state,sample,task,report};
}
it('uses an exact current physical report rather than a cached positive version result',()=>{
 const f=fixture();f.state.fulfillment.qcTasks=[f.task];f.state.fulfillment.qcReports=[f.report];expect(sampleConfirmationBlocker(f.state,f.sample)).toBeNull();
 f.task.state='working';expect(sampleConfirmationBlocker(f.state,f.sample)).toContain('QC');f.task.state='reported';f.report.result='reject';expect(sampleConfirmationBlocker(f.state,f.sample)).toContain('QC');
});
it('does not let another form report or an older material revision qualify this item',()=>{
 const f=fixture();f.state.fulfillment.samples.push({...f.sample,id:'other'});f.task.sampleId='other';f.state.fulfillment.qcTasks=[f.task];f.state.fulfillment.qcReports=[f.report];expect(sampleConfirmationBlocker(f.state,f.sample)).toContain('QC');
 f.task.sampleId='s';f.sample.qualityRevision=2;expect(sampleConfirmationBlocker(f.state,f.sample)).toContain('QC');f.report.scopeRevision=2;expect(sampleConfirmationBlocker(f.state,f.sample)).toBeNull();
});
it('does not reopen confirmation shipping for a cancelled case or an abandoned physical version',()=>{
 const f=fixture();f.state.devs[0].closure={kind:'cancelled'} as any;expect(sampleConfirmationBlocker(f.state,f.sample)).toContain('已取消');delete f.state.devs[0].closure;f.state.versions[0].qcDecision={kind:'abandon'} as any;expect(sampleConfirmationBlocker(f.state,f.sample)).toContain('不采用');
});
it('requires explicit context for non-confirmation shipments without treating them as QC approval',()=>{
 const f=fixture();f.state.versions[0].qc!.result='reject';expect(sampleSendBlocker(f.state,f.sample,'confirmation','')).toContain('QC');expect(sampleSendBlocker(f.state,f.sample,'testing','')).toContain('用途说明');expect(sampleSendBlocker(f.state,f.sample,'testing','纤维成分外检')).toBeNull();expect(sampleSendBlocker(f.state,f.sample,'rework','退回改肩型')).toBeNull();expect(f.state.versions[0].qc!.result).toBe('reject');
});
it('uses a safe default for a linked sample and rejects an unknown purpose',()=>{
 const f=fixture();expect(sampleSendPurpose(undefined,f.sample)).toBe('confirmation');expect(()=>sampleSendPurpose('unknown',f.sample)).toThrow('用途无效');
});
