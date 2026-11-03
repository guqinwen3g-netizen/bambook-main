import {describe,expect,it} from 'vitest';
import {applyMistCommand,getMistReviewTasks,type MistCommand} from './mistWorkspace';
import {assertProductionTransition} from './mistFulfillment';
import {currentQcDisposition,openQcChargebacks} from './mistQcDisposition';
import {fixture} from '../mist/__tests__/professionalFulfillment';

/** Production QC fails, then the order owner chooses rework, a customer-approved concession or a factory chargeback. */
function failed(){
 const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);
 const taskId=f.productionTask(productionId);f.report(taskId,'reject');
 f.state.files.push({id:'buyer-ok',name:'buyer-concession.pdf',mimeType:'application/pdf',size:1,storageKey:'t/buyer',createdAt:f.context.now});
 const as=(actorId:string)=>({...f.context,actorId,actorName:actorId==='reviewer'?'主管':actorId});
 const run=(command:MistCommand,actorId='sales')=>{const r=applyMistCommand(f.state,command,as(actorId));Object.assign(f.state,r.state);return r.result;};
 const task=()=>f.state.fulfillment.qcTasks.find(t=>t.id===taskId)!;
 const branch=()=>f.state.productions.find(p=>p.id===productionId)!;
 return{f,run,taskId,task,branch,productionId,purchaseId};
}
describe('production QC NOK disposition',()=>{
 it('schedules a rework on the task and keeps the gate shut until a passing re-inspection',()=>{
  const t=failed();
  t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'rework',note:'门襟跳针，全检返修',factory:'本地验收工厂',due:'2026-10-20'}});
  expect(currentQcDisposition(t.task())).toMatchObject({kind:'rework',factory:'本地验收工厂',due:'2026-10-20',status:'open'});
  expect(t.task().due).toBe('2026-10-20');expect(t.task().state).toBe('blocked');
  expect(()=>assertProductionTransition(t.f.state,t.branch(),'done',100)).toThrow('质量');
  expect(()=>t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'concession',note:'x',scope:'x',customerEvidence:'x',fileIds:['buyer-ok']}})).toThrow('已选择返工');
 });
 it('sends a concession with the customer written acceptance to the order reviewer, and only approval opens the gate',()=>{
  const t=failed();
  expect(()=>t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'concession',note:'色差 4 级',scope:'M 码 4 件色差 4 级',customerEvidence:'买手邮件同意'}})).toThrow('客户书面同意');
  const r=t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'concession',note:'色差 4 级',scope:'M 码 4 件色差 4 级',customerEvidence:'买手 Olivia 邮件同意按 4 级接收',fileIds:['buyer-ok']}}) as {dispositionId:string};
  const review=getMistReviewTasks(t.f.state).find(x=>x.kind==='qcConcession')!;
  expect(review).toMatchObject({status:'pending',reviewerIds:['reviewer'],requesterId:'sales',entityId:r.dispositionId});
  expect(()=>assertProductionTransition(t.f.state,t.branch(),'done',100)).toThrow('质量');
  expect(()=>t.run({type:'fulfillment.qc.concession.decide',payload:{id:r.dispositionId,decision:'approved',note:'自批'}})).toThrow('审批名单');
  t.run({type:'fulfillment.qc.concession.decide',payload:{id:r.dispositionId,decision:'approved',note:'客户已书面接受，同意放行'}},'reviewer');
  expect(t.task().state).toBe('reported');
  expect(()=>assertProductionTransition(t.f.state,t.branch(),'done',100)).not.toThrow();
  expect(getMistReviewTasks(t.f.state).find(x=>x.kind==='qcConcession')!.status).toBe('approved');
 });
 it('keeps the gate shut after a rejected concession and lets the owner choose again',()=>{
  const t=failed();
  const r=t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'concession',note:'x',scope:'全部',customerEvidence:'邮件',fileIds:['buyer-ok']}}) as {dispositionId:string};
  t.run({type:'fulfillment.qc.concession.decide',payload:{id:r.dispositionId,decision:'rejected',note:'缺陷超出可接受范围'}},'reviewer');
  expect(t.task().state).toBe('blocked');
  t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'rework',note:'改为返工',due:'2026-10-21'}});
  expect(currentQcDisposition(t.task())!.kind).toBe('rework');
 });
 it('records a factory chargeback that the next settlement carries as a dispute line',()=>{
  const t=failed();
  expect(()=>t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'chargeback',note:'返修费由工厂承担',amount:0}})).toThrow('大于零');
  t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'chargeback',note:'返修费由工厂承担',amount:12.5}});
  expect(openQcChargebacks(t.f.state,t.purchaseId)).toHaveLength(1);
  const receipt=t.f.state.fulfillment.receipts.find(r=>r.purchaseId===t.purchaseId)!;
  t.run({type:'payable.settlement.submit',payload:{purchaseId:t.purchaseId,receiptIds:[receipt.id]}});
  const st=t.f.state.payables!.settlements.at(-1)!;
  expect(st.disputes).toEqual([expect.objectContaining({description:'QC 扣款：返修费由工厂承担',amount:12.5})]);
  expect(openQcChargebacks(t.f.state,t.purchaseId)).toHaveLength(0);
 });
 it('only the order owner disposes, and only a failed production task',()=>{
  const t=failed();
  expect(()=>t.run({type:'fulfillment.qc.dispose',payload:{id:t.taskId,kind:'rework',note:'x',due:'2026-10-20'}},'qc-user')).toThrow('订单负责人');
  const f=fixture(),{productionId,purchaseId}=f.released();f.receiveAndComplete(productionId,purchaseId);const passed=f.productionTask(productionId);f.report(passed,'pass');
  expect(()=>applyMistCommand(f.state,{type:'fulfillment.qc.dispose',payload:{id:passed,kind:'rework',note:'x',due:'2026-10-20'}},f.context)).toThrow('没有待处置');
 });
});
import {agentCommandRisk} from './mistAgentProposals';
it('treats NOK disposition and its approval as high-risk Agent commands',()=>{
 expect(agentCommandRisk('fulfillment.qc.dispose')).toBe('high');
 expect(agentCommandRisk('fulfillment.qc.concession.decide')).toBe('high');
});
