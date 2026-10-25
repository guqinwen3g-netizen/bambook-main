import {expect,it} from 'vitest';
import {createMistState,normalizeMistState,type MistContext} from './mistWorkspace';
import {fulfillmentProductionColumn,fulfillmentProductionQcPassed} from './mistFulfillment';
import {createOrderGovernance} from './mistOrderGovernance';

function fixture(){
  let sequence=0;const context:MistContext={id:()=>`fixture-${++sequence}`,now:'2026-10-08T08:00:00Z',actorName:'业务员'};
  const state=createMistState(context,'empty'),sizes=[{size:'S',quantity:1},{size:'M',quantity:1}];
  state.orders.push({id:'order',code:'SO-READY',type:'garment',customerId:'buyer',customer:'客户',season:'AW',currency:'CNY',ownerId:'business',owner:'业务员',qty:2,amount:100,lines:1,due:'2026-11-01',progress:100,state:'待终期 QC',tone:'accent',checklist:[],governance:{...createOrderGovernance(context),status:'approved'}} as any);
  state.orderLines.push({id:'line',orderId:'order',name:'短外套',style:'JK-01',qty:2,unit:'件',price:50,img:'coat',made:0,qc:0});
  state.productions.push({id:'production',sourcePurchaseId:'purchase',orderId:'order',lineId:'line',order:'SO-READY',code:'FUL-READY',name:'外套加工',factory:'加工厂',qty:2,pct:100,col:'qc',due:'2026-11-01',img:'coat'});
  state.fulfillment.productionFacts.push({productionId:'production',revision:3,sizes,release:{at:context.now,actor:'业务员',note:'已明确放行',sampleChecks:[]},completion:{id:'completion',quantity:2,sizeQuantities:sizes,date:'2026-10-08',at:context.now,actor:'业务员',evidence:'实际回交点数',fileIds:[]}} as any);
  state.fulfillment.qcTasks.push({id:'task',code:'QC-READY',source:{kind:'orderLine',orderId:'order',lineId:'line',productionId:'production'},domain:'garment',kind:'production',factory:'加工厂',location:'成品区',contact:'',due:'2026-10-08',requestedBy:'业务员',assignee:'QC',assigneeId:'qc',state:'reported',reportIds:['report'],createdAt:context.now});
  state.fulfillment.qcReports.push({id:'report',taskId:'task',result:'pass',report:'QC-R1',scopeRevision:3,measurements:[],sizeChecks:sizes.map(row=>({size:row.size,inspected:1,result:'pass',evidence:'实际核对'})),fileIds:[],opinion:'通过',actor:'QC',actorId:'qc',reviewedAt:context.now,createdAt:context.now} as any);
  return{state,context,order:state.orders[0],branch:state.productions[0],fact:state.fulfillment.productionFacts[0],task:state.fulfillment.qcTasks[0],report:state.fulfillment.qcReports[0]};
}

it('shows shipment preparation after actual completion and current all-size QC even while the legacy column is qc',()=>{
  const f=fixture();normalizeMistState(f.state,f.context);
  expect(f.order.state).toBe('待出运');expect(f.branch.col).toBe('qc');expect(f.state.orderLines[0].qc).toBe(0);
});

it('does not trust a legacy done column when the latest report belongs to an older quantity revision',()=>{
  const f=fixture();f.branch.col='done';f.report.scopeRevision=2;normalizeMistState(f.state,f.context);
  expect(f.order.state).toBe('待终期 QC');expect(f.report.scopeRevision).toBe(2);
});

it('does not turn a percentage or legacy done column into an actual final completion',()=>{
  const f=fixture();f.branch.col='done';delete f.fact.completion;normalizeMistState(f.state,f.context);
  expect(f.order.state).not.toBe('待出运');expect(f.fact.completion).toBeUndefined();
});

it('requires every production size to have a passing current-scope check',()=>{
  const f=fixture();f.branch.col='done';f.report.sizeChecks=f.report.sizeChecks!.filter(row=>row.size==='S');normalizeMistState(f.state,f.context);
  expect(f.order.state).toBe('待终期 QC');
});

it('retains valid checks spread across reports in the same quantity scope',()=>{
  const f=fixture();const second=structuredClone(f.report);second.id='second';second.sizeChecks=second.sizeChecks!.filter(row=>row.size==='M');f.report.sizeChecks=f.report.sizeChecks!.filter(row=>row.size==='S');f.state.fulfillment.qcReports.push(second);f.task.reportIds.push(second.id);normalizeMistState(f.state,f.context);
  expect(f.order.state).toBe('待出运');
});

it('keeps unresolved inspection tasks from being hidden by another passing report',()=>{
  const f=fixture();f.branch.col='done';f.state.fulfillment.qcTasks.push({...structuredClone(f.task),id:'pending',state:'working',reportIds:[]});normalizeMistState(f.state,f.context);
  expect(f.order.state).toBe('待终期 QC');
});

it('preserves an existing shipment phase rather than overwriting it with the production summary',()=>{
  const f=fixture();f.report.result='reject';f.state.fulfillment.shipments.push({id:'shipment',code:'SHP',state:'preparing',lines:[{orderId:'order',lineId:'line',productionId:'production',quantity:2}]} as any);normalizeMistState(f.state,f.context);
  expect(f.order.state).toBe('出运准备中');
});

it('derives read-only QC and lane values without changing any business facts',()=>{
 const f=fixture(),before=structuredClone(f.state);expect(fulfillmentProductionQcPassed(f.state,f.branch)).toBe(true);expect(fulfillmentProductionColumn(f.state,f.branch)).toBe('done');expect(f.state).toEqual(before);
 f.task.reportIds=['missing'];const incomplete=structuredClone(f.state);expect(fulfillmentProductionQcPassed(f.state,f.branch)).toBe(false);expect(fulfillmentProductionColumn(f.state,f.branch)).toBe('qc');expect(f.state).toEqual(incomplete);
});
