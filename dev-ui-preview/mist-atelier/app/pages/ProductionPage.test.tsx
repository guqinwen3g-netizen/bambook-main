// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {getByLabelText,getByRole,queryByRole,within} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../components/mist';
import {applyMistCommand,createMistState,type MistContext,type MistCommand,type MistState} from '../../../../server/src/shared/mistWorkspace';
import {Nav,type Route} from '../nav';
import {ProductionPage,productionWindow,parseProductionSizes} from './ProductionPage';

const bridge=vi.hoisted(()=>({state:null as MistState|null,loading:false,error:'',run:vi.fn(),refresh:vi.fn()}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>bridge}));
vi.mock('../runtime/auth', () => { const useMistSession = ()=>({hasPermission:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
let host:HTMLDivElement,root:Root|undefined,context:MistContext,orderId:string,firstDue:string,lastDue:string;const go=vi.fn();
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;let sequence=0;context={id:()=>`production-test-${++sequence}`,now:new Date().toISOString(),actorName:'业务员',actorId:'sales',authority:{supplier:{},orderReviewerIds:{garment:['reviewer'],fabric:['reviewer']}}};const year=new Date().getFullYear()+2;firstDue=`${year}-02-10`;lastDue=`${year}-07-20`;const empty=createMistState(context,'empty');empty.customers.push({id:'customer-a',name:'新订单客户',code:'C-A',country:'',city:'',industry:'',owner:'业务员',grade:'A',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:1000,since:'2026-01-01'});const created=applyMistCommand(empty,{type:'order.create',payload:{type:'garment',customerId:'customer-a',season:'AW',currency:'USD',due:lastDue,ownerId:'sales',lines:[{fulfillmentMode:'cmt',cmtIncludedItems:[],name:'未来分支甲',style:'A',img:'coat',qty:10,unit:'件',price:10},{fulfillmentMode:'cmt',cmtIncludedItems:[],name:'未来分支乙',style:'B',img:'coat',qty:20,unit:'件',price:10}]}},context);bridge.state=created.state;orderId=created.result.orderId!;bridge.state.productions=bridge.state.orderLines.map((line,index)=>({id:index?'production-b':'production-a',code:index?'PROD-B':'PROD-A',orderId,lineId:line.id,order:bridge.state!.orders[0].code,name:line.name,factory:'订单工厂',qty:line.qty,due:index?lastDue:firstDue,pct:0,img:line.img,col:'cut'}));bridge.state.files.push({id:'contract',name:'contract.pdf',mimeType:'application/pdf',size:1,storageKey:'test/contract',createdAt:context.now});bridge.state=applyMistCommand(bridge.state,{type:'order.governance.saveDraft',payload:{orderId,input:{kind:'external',poNumber:'TEST',confirmationFileIds:['contract'],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:0,paymentNote:'无定金',incoterm:'FOB',deliveryPlace:'上海'}}},context).state;bridge.state=applyMistCommand(bridge.state,{type:'order.governance.submit',payload:{orderId}},context).state;bridge.state=applyMistCommand(bridge.state,{type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'已核对'}},{...context,actorId:'reviewer'}).state;
for(const branch of bridge.state.productions){const sampleId='pp-'+branch.id,taskId='qc-'+branch.id,reportId='report-'+branch.id;bridge.state.fulfillment.productionFacts.push({productionId:branch.id,sizes:[{size:'M',quantity:branch.qty}],revision:1,release:{at:context.now,actor:'业务员',note:'已核对'}});bridge.state.fulfillment.samples.push({id:sampleId,code:sampleId,name:'产前实物',category:'成衣',form:'实物',unit:'件',quantity:1,available:1,location:'现场',size:'M',color:'蓝',source:{kind:'orderLine',orderId,lineId:branch.lineId,productionId:branch.id},role:'pp',qualityRevision:1,fileIds:[],note:'',createdAt:context.now});bridge.state.fulfillment.qcTasks.push({id:taskId,code:taskId,source:{kind:'orderLine',orderId,lineId:branch.lineId,productionId:branch.id},sampleId,domain:'garment',kind:'sample',factory:'工厂',location:'现场',contact:'',due:firstDue,requestedBy:'业务员',assignee:'QC',state:'reported',reportIds:[reportId],createdAt:context.now,businessConfirmation:{result:'approved',note:'已确认',actor:'业务员',at:context.now},businessContinued:{reportId,actor:'业务员',at:context.now,note:'明确继续'}});bridge.state.fulfillment.qcReports.push({id:reportId,taskId,result:'pass',report:reportId,opinion:'核对通过',measurements:[],fileIds:[],reviewer:'QC',reviewedAt:context.now,scopeRevision:1});}
bridge.loading=false;bridge.error='';bridge.refresh.mockReset();bridge.run.mockReset().mockImplementation(async(command:MistCommand)=>{const result=applyMistCommand(bridge.state!,command,context);bridge.state=result.state;return{requestId:'saved',revision:1,result:result.result};});go.mockReset();});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();});
async function mount(route:Route={view:'production-board'}){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<React.StrictMode><MistRoot><ToastProvider><Nav.Provider value={{route,go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><ProductionPage/></Nav.Provider></ToastProvider></MistRoot></React.StrictMode>));}
async function range(label:string){const group=getByRole(host,'group',{name:'范围'});await act(async()=>within(group).getByRole('button',{name:label}).click());}
async function click(label:string){await act(async()=>getByRole(document.body,'button',{name:label}).click());}
async function fill(label:string,value:string){const field=[...document.querySelectorAll('label')].find(item=>item.querySelector('.mist-field-label')?.textContent===label);const input=field?.querySelector('input') as HTMLInputElement;expect(input).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});return input;}

describe('Mist production complete range',()=>{
 it('keeps calendar week and month windows while deriving All from actual dates',()=>{const now=new Date(2026,9,13,12),week=productionWindow('week',now),month=productionWindow('month',now);expect([week.start.getDate(),week.end.getDate()]).toEqual([12,19]);expect([month.start.getMonth(),month.start.getDate(),month.end.getMonth()]).toEqual([9,1,10]);const source=[{due:'2028-07-20'},{startDate:'2028-01-05',due:'2028-02-10'}];const all=productionWindow('all',now,source);expect([all.start.getFullYear(),all.start.getMonth(),all.start.getDate()]).toEqual([2028,0,5]);expect([all.end.getFullYear(),all.end.getMonth(),all.end.getDate()]).toEqual([2028,6,21]);expect(source[0]).not.toHaveProperty('startDate');});
 it('finds future fresh-order jobs from the empty-state All action without inventing start dates',async()=>{await mount();expect(host.textContent).not.toContain('未来分支甲');await range('本月');expect(host.textContent).not.toContain('未来分支甲');await click('查看全部生产单');expect(host.textContent).toContain('未来分支甲');expect(host.textContent).toContain('未来分支乙');expect(bridge.state!.productions.every(job=>job.startDate===undefined)).toBe(true);expect(bridge.run).not.toHaveBeenCalled();});
 it('edits the exact future production branch and preserves the other branch',async()=>{await mount();await range('全部');await act(async()=>getByRole(host,'button',{name:/未来分支乙/}).click());const drawer=getByRole(document.body,'dialog',{name:'PROD-B'});expect(drawer.textContent).toContain('PROD-B');await fill('生产进度（%）','35');const start=lastDue.slice(0,7)+'-01';await fill('计划开始日',start);await click('保存进度');expect(bridge.run).toHaveBeenCalledWith({type:'production.update',payload:{id:'production-b',pct:35,risk:'',note:'',startDate:start,due:lastDue}});expect(bridge.state!.productions.find(job=>job.id==='production-b')).toMatchObject({pct:35,startDate:start,due:lastDue});expect(bridge.state!.productions.find(job=>job.id==='production-a')).toMatchObject({pct:0,due:firstDue});expect(queryByRole(document.body,'dialog',{name:'PROD-B'})).toBeNull();});
 it('locates route.productionId outside the current month and keeps unknown start empty',async()=>{await mount({view:'production-board',productionId:'production-b'});const group=getByRole(host,'group',{name:'范围'});expect(within(group).getByRole('button',{name:'全部'}).getAttribute('aria-pressed')).toBe('true');expect(getByRole(document.body,'dialog',{name:'PROD-B'})).toBeTruthy();const start=[...document.querySelectorAll('label')].find(item=>item.querySelector('.mist-field-label')?.textContent==='计划开始日')!.querySelector('input')!;expect(start.value).toBe('');await click('打开关联订单');expect(go).toHaveBeenCalledWith('orders/detail',orderId,{orderLineId:bridge.state!.productions[1].lineId,productionId:'production-b'});});
 it('draws unknown starts as distinct due points within the full Gantt date range',async()=>{await mount();await range('全部');await click('甘特图');const first=getByRole(host,'img',{name:`交期 ${firstDue}，未记录开始日`}),last=getByRole(host,'img',{name:`交期 ${lastDue}，未记录开始日`});expect(first.querySelector('line')).toBeNull();expect(last.querySelector('line')).toBeNull();const firstPosition=Number(first.querySelector('circle')!.getAttribute('cx')),lastPosition=Number(last.querySelector('circle')!.getAttribute('cx'));expect(firstPosition).toBeGreaterThanOrEqual(0);expect(lastPosition).toBeLessThan(100);expect(firstPosition).toBeLessThan(lastPosition);});
 it('keeps the exact branch and entered values visible after a rejected update',async()=>{bridge.run.mockRejectedValueOnce(new Error('计划更新被拒绝'));await mount({view:'production-board',productionId:'production-b'});const field=await fill('生产进度（%）','40');await click('保存进度');expect(getByRole(document.body,'dialog',{name:'PROD-B'}).textContent).toContain('计划更新被拒绝');expect(field.value).toBe('40');expect(bridge.state!.productions[1].pct).toBe(0);});
});

it('parses actual size entries without inventing a default size',()=>{expect(parseProductionSizes('M:4\nL：6')).toEqual([{size:'M',quantity:4},{size:'L',quantity:6}]);expect(parseProductionSizes('')).toEqual([]);expect(()=>parseProductionSizes('M = ten')).toThrow('逐行');});


it('shows fabric quantities in their source unit and never asks for garment size planning',async()=>{
 bridge.state!.orders[0].type='fabric';for(const line of bridge.state!.orderLines)line.unit='码';for(const sample of bridge.state!.fulfillment.samples)sample.role='pioneer';const snapshot=(bridge.state!.orders[0] as {governance?:{approvedSnapshot?:{type:string;lines:Array<{unit:string}>}}}).governance?.approvedSnapshot;if(snapshot){snapshot.type='fabric';for(const line of snapshot.lines)line.unit='码';}const branch=bridge.state!.productions[1];bridge.state!.fulfillment.productionFacts.find(fact=>fact.productionId===branch.id)!.release=undefined;
 await mount({view:'production-board',productionId:branch.id});await range('全部');expect(getByRole(host,'button',{name:/未来分支乙/}).textContent).toContain('20 码');expect(queryByRole(document.body,'button',{name:'登记生产尺码'})).toBeNull();expect(document.body.textContent).not.toContain('计划尺码');await click('放行量产');expect(getByRole(document.body,'dialog',{name:'放行量产'})).toBeTruthy();expect(getByRole(document.body,'textbox',{name:'放行依据'})).toBeTruthy();
});
it('records fabric final quantity without a garment size matrix',async()=>{
 bridge.state!.orders[0].type='fabric';bridge.state!.orderLines[1].unit='米';await mount({view:'production-board',productionId:'production-b'});await click('登记最终完工数量');expect(getByRole(document.body,'dialog',{name:'登记最终实际完工'})).toBeTruthy();expect(queryByRole(document.body,'textbox',{name:/各实际尺码数量/})).toBeNull();expect(getByRole(document.body,'spinbutton',{name:/最终实际完工数量/})).toBeTruthy();
});

describe('Mist production gates, delay and pause',()=>{
 it('mirrors the server release gate and keeps release disabled until the exact pre-production sample is confirmed',async()=>{
  const f=bridge.state!.fulfillment;f.productionFacts.find(fact=>fact.productionId==='production-b')!.release=undefined;f.samples=f.samples.filter(sample=>sample.source.kind!=='orderLine'||sample.source.productionId!=='production-b');
  await mount({view:'production-board',productionId:'production-b'});
  const gate=document.querySelector('[data-release-gate]')!;expect(gate.textContent).toContain('主单已批准');expect(gate.textContent).toContain('生产尺码');expect(gate.textContent).toContain('未登记');
  const release=getByRole(document.body,'button',{name:'放行开产'});expect(release.hasAttribute('disabled')).toBe(true);expect(release.getAttribute('title')).toContain('产前样');
  expect(host.querySelector('.mist-sumbar')!.textContent).toContain('待业务放行1');
  expect(queryByRole(document.body,'button',{name:'异常暂停'})).toBeNull();
 });
 it('records a delay with new date, reason and customer notice into the branch risk',async()=>{
  await mount({view:'production-board',productionId:'production-b'});await click('登记延期');
  const due=lastDue.slice(0,4)+'-08-01';const dueInput=getByLabelText(document.body,/^新交期/) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(dueInput,due);dueInput.dispatchEvent(new Event('input',{bubbles:true}));});
  const reason=document.querySelector('textarea') as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(reason,'面料复染');reason.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('保存延期');
  expect(bridge.run).toHaveBeenCalledWith({type:'production.update',payload:{id:'production-b',pct:0,due,risk:`延期 ${lastDue} → ${due}：面料复染（尚未告知客户）`}});
  expect(bridge.state!.productions.find(job=>job.id==='production-b')).toMatchObject({due,risk:`延期 ${lastDue} → ${due}：面料复染（尚未告知客户）`});
 });
 it('pauses a released branch with a category and reason, then resumes it with evidence',async()=>{
  const fill=async(value:string)=>{const area=document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,value);area.dispatchEvent(new Event('input',{bubbles:true}));});};
  await mount({view:'production-board',productionId:'production-b'});await click('异常暂停');await fill('面料色差待复染');await click('确认暂停');
  expect(bridge.run).toHaveBeenCalledWith({type:'fulfillment.production.hold',payload:{productionId:'production-b',category:'quality',reason:'面料色差待复染'}});
  act(()=>root!.unmount());host.remove();await mount({view:'production-board',productionId:'production-b'});expect(document.body.textContent).toContain('生产已异常暂停');expect(queryByRole(document.body,'button',{name:'异常暂停'})).toBeNull();
  await click('恢复生产');await fill('复染合格');await act(async()=>getByRole(getByRole(document.body,'dialog'),'button',{name:'恢复生产'}).click());
  expect(bridge.run).toHaveBeenLastCalledWith({type:'fulfillment.production.resume',payload:{productionId:'production-b',note:'复染合格'}});
 });
});

it('retains frozen conditional sample findings after production is released',async()=>{
 const fact=bridge.state!.fulfillment.productionFacts.find(row=>row.productionId==='production-b')!;
 fact.release!.sampleChecks=[{sampleId:'stone',sampleCode:'SMP-STONE',color:'Stone',form:'米样',reportId:'r',reportNumber:'PP-STONE',result:'conditional',opinion:'卷边须在首批大货复核'}];
 await mount({view:'production-board',productionId:'production-b'});
 expect(document.body.textContent).toContain('样品关注项');expect(document.body.textContent).toContain('SMP-STONE');expect(document.body.textContent).not.toContain('卷边须在首批大货复核');await click('查看关注项');expect(document.body.textContent).toContain('卷边须在首批大货复核');
});

it('keeps release evidence on demand and omits obsolete implementation notes',async()=>{
 const fact=bridge.state!.fulfillment.productionFacts.find(row=>row.productionId==='production-b')!;
 fact.release!.note='完整的放行核对依据';
 await mount({view:'production-board',productionId:'production-b'});
 expect(document.body.textContent).not.toContain('尚未接入');expect(document.body.textContent).not.toContain('完整的放行核对依据');
 await click('放行记录');expect(document.body.textContent).toContain('完整的放行核对依据');
});

it('shows a short paused status and keeps completion evidence out of status values',async()=>{
 const fact=bridge.state!.fulfillment.productionFacts.find(row=>row.productionId==='production-b')!;
 fact.hold={at:context.now,actor:'业务员',category:'quality',reason:'复检中'};
 fact.completion={id:'completion',quantity:20,sizeQuantities:[],date:context.now.slice(0,10),at:context.now,actor:'业务员',evidence:'完整完工交接依据',fileIds:[]};
 await mount({view:'production-board',productionId:'production-b'});
 expect(document.body.textContent).toContain('已暂停');expect(document.body.textContent).toContain('已完工');
 expect(document.body.textContent).not.toContain('完整完工交接依据');
 await click('完工记录');expect(document.body.textContent).toContain('完整完工交接依据');
});

it('keeps fractional metres visible on production cards',async()=>{
  bridge.state!.orders[0].type='fabric';bridge.state!.orderLines[0].unit='米';bridge.state!.productions[0].qty=1359.6;
  await mount();await range('全部');
  const card=getByRole(host,'button',{name:/PROD-A/});expect(card.textContent).toContain('1,359.6 米');expect(card.textContent).not.toContain('1,360 米');
});

it('shows each current PP standard and the actual pending customer step',async()=>{
  const state=bridge.state!,baseSample=state.fulfillment.samples[0],baseTask=state.fulfillment.qcTasks[0],baseReport=state.fulfillment.qcReports[0];
  delete state.fulfillment.productionFacts.find(f=>f.productionId==='production-a')!.release;
  for(const size of ['S','L']){
    const sampleId='pp-'+size,taskId='qc-'+size,reportId='report-'+size;
    state.fulfillment.samples.push({...baseSample,id:sampleId,code:sampleId,size});
    const task={...baseTask,id:taskId,code:taskId,sampleId,reportIds:[reportId],businessContinued:{...baseTask.businessContinued!,reportId}};
    if(size==='L'){delete task.businessConfirmation;delete (task as any).businessContinued;}
    state.fulfillment.qcTasks.push(task);state.fulfillment.qcReports.push({...baseReport,id:reportId,taskId,report:reportId});
  }
  await mount({view:'production-board',productionId:'production-a'});
  const gate=document.querySelector('[data-release-gate]')!;expect(gate.textContent).toContain('产前样 · L');expect(gate.textContent).toContain('待客户确认');expect(gate.textContent).not.toContain('尚未完成准确实物');
  expect((getByRole(document.body,'button',{name:'放行开产'}) as HTMLButtonElement).disabled).toBe(true);
});


it('blocks unknown garment quantity basis and only requests an actual size matrix for an approved size basis',async()=>{
 await mount({view:'production-board',productionId:'production-b'});let button=getByRole(document.body,'button',{name:'登记最终完工数量'});expect(button.hasAttribute('disabled')).toBe(true);expect(button.title).toContain('数量口径');
 await act(async()=>root!.unmount());root=undefined;host.remove();const g=bridge.state!.orders[0].governance!;for(const c of [g.contract,g.approvedSnapshot!.contract]){c.quantityBasis='total';c.quantityBasisNote='客户按总量核验';}
 await mount({view:'production-board',productionId:'production-b'});await click('登记最终完工数量');expect(queryByRole(document.body,'textbox',{name:/各实际尺码数量/})).toBeNull();
 await act(async()=>root!.unmount());root=undefined;host.remove();for(const c of [g.contract,g.approvedSnapshot!.contract])c.quantityBasis='size';
 await mount({view:'production-board',productionId:'production-b'});await click('登记最终完工数量');expect(getByRole(document.body,'textbox',{name:/各实际尺码数量/})).toBeTruthy();
});

it('counts genuine production risks without a wall of ordinary workflow reminders',async()=>{
 bridge.state!.productions[0].risk='待合同确认、产前样与业务开产放行';bridge.state!.productions[1].risk='面料复染延期';
 await mount({view:'production-board'});await click('查看全部生产单');expect(host.querySelector('.mist-sumbar')!.textContent).toContain('生产风险1');expect(host.textContent).not.toContain('待合同确认、产前样与业务开产放行');expect(host.textContent).toContain('面料复染延期');
 await click('查看生产单');expect((getByRole(document.body,'textbox',{name:'风险'}) as HTMLInputElement).value).toBe('面料复染延期');
});
