import {materialDeliveryFixture} from './materialDelivery';
import {applyMistCommand,type MistCommand,type MistState} from '../../shared/mistWorkspace';

/** Fully synthetic current-scope completion/QC facts; no company database or backup is read. */
export function internalDeliveryFixture(){
 const f=materialDeliveryFixture(20),context={...f.context,now:'2026-10-30T08:00:00Z'},state=structuredClone(f.state);
 const line=state.orderLines.find(l=>l.id===f.target.lineId)!;
 line.breakdown={kind:'garment',sizes:['M'],rows:[{color:'Blue',quantities:[10]}]};
 state.orders.find(o=>o.id===f.target.orderId)!.governance!.approvedSnapshot!.lines.find(l=>l.id===line.id)!.breakdown=structuredClone(line.breakdown);
 const branch=state.productions.find(p=>p.id===f.productionId)!,fact=state.fulfillment.productionFacts.find(p=>p.productionId===branch.id)!;
 fact.sizes=[{size:'M',quantity:10}];fact.release={at:context.now,actor:'Garment',note:'Approved'};
 fact.completion={id:'completion',quantity:10,sizeQuantities:[],date:'2026-10-29',at:context.now,actor:'Garment',evidence:'Counted',fileIds:[]};
 branch.pct=100;branch.col='done';
 const purchase=state.fulfillment.purchases.find(p=>p.id===f.processingId)!;purchase.received=10;
 state.fulfillment.receipts.push({id:'finished-receipt',purchaseId:purchase.id,quantity:10,rejected:0,destination:'supplier',location:'Receiving area',date:'2026-10-29',evidence:'Factory handover',fileIds:[],actor:'Garment',createdAt:context.now});
 state.fulfillment.qcTasks.push({id:'finished-qc',code:'QC-FIN',source:{kind:'orderLine',...f.target,productionId:branch.id},domain:'garment',kind:'production',factory:'Factory',location:'Inspection area',contact:'',due:'2026-10-29',requestedBy:'Garment',assignee:'QC',assigneeId:'qc',state:'reported',reportIds:['finished-report'],createdAt:context.now});
 state.fulfillment.qcReports.push({id:'finished-report',taskId:'finished-qc',result:'pass',report:'FINAL',opinion:'Checked',measurements:[],fileIds:[],reviewer:'QC',reviewedAt:context.now,scopeRevision:fact.revision,sizeChecks:[{size:'M',quantity:1,result:'pass',evidence:'Measured'}]});
 let current: MistState=state;
 const run=(command:MistCommand,actorId='garment')=>{const applied=applyMistCommand(current,command,{...context,actorId,actorName:context.members!.find(m=>m.id===actorId)?.name||actorId});current=applied.state;return applied.result;};
 const send=(quantity=10,receiverId='warehouse',source:{kind:'receipt'|'stockIssue';id:string}={kind:'receipt',id:'finished-receipt'})=>run({type:'order.internal.send',payload:{orderId:f.target.orderId,productionId:branch.id,source,quantity,receiverId,location:'Sample room',date:'2026-10-30',evidence:'Internal handover',expectedRevision:(current.internalDeliveries||[]).filter(r=>r.orderId===f.target.orderId).length}}).id!;
 return{...f,context,run,send,get state(){return current;}};
}
