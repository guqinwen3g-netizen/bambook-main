// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,getAllByRole,queryByRole,within} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentQcTask} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const session=vi.hoisted(()=>({id:'qc-a',denied:new Set<string>()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:session.id,displayName:'QC甲'},sessionKey:'s',hasPermission:(p:string)=>!session.denied.has(p),canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
import {QcWorkbenchPage} from './QcWorkbenchPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(id?:string,mode:'full'|'list'=id?'full':'list',source:{versionId?:string}={}){const detail=mode==='full'?mode:undefined;act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'qc-workbench',id,detail,...source},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><QcWorkbenchPage/></Nav.Provider></ToastProvider></MistRoot>));}
async function click(node:HTMLElement){await act(async()=>node.click());}
function choose(select:HTMLSelectElement,value:string){act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function task(id:string,patch:Partial<FulfillmentQcTask>={}):FulfillmentQcTask{return {id,code:id.toUpperCase(),source:{kind:'orderLine',orderId:'o',lineId:'l'},domain:'garment',kind:'sample',factory:'华美制衣',location:'一号车间',contact:'',due:'2026-10-20',requestedBy:'业务员',assignee:'',state:'pending',reportIds:[],createdAt:'2026-10-10T08:00:00Z',...patch};}
beforeEach(()=>{session.id='qc-a';session.denied=new Set();store.state=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'QC甲'},'empty');store.run.mockReset();store.run.mockResolvedValue({result:{}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});

it.each([{domain:'fabric',category:'羊毛混纺斜纹'},{domain:'garment',category:'面料拼接夹克'}] as const)('submits the explicit $domain domain from a returned development, independent of category wording',async({domain,category})=>{
  store.state!.devs.push({id:'dev-domain',code:'DEV-DOMAIN',values:{domain,category}} as any);
  store.state!.versions.push({id:'version-domain',devId:'dev-domain',label:'R1-A',factory:'试样厂',returnedAt:'2026-10-13T08:00:00Z'} as any);
  store.run.mockResolvedValue({result:{id:'new-qc'}});
  render(); await click(getAllByRole(host,'button',{name:'从来源发起QC'})[0]);
  choose(getByRole(host,'combobox',{name:'送检来源'}) as HTMLSelectElement,'version:version-domain');
  await click(getByRole(host,'button',{name:'下一步'}));
  typeInto(getByRole(host,'textbox',{name:'工厂'}) as HTMLInputElement,'试样厂');
  typeInto(getByRole(host,'textbox',{name:'实际检查地点'}) as HTMLInputElement,'样品室');
  await click(getByRole(host,'button',{name:'下一步'}));
  await click(getByRole(host,'button',{name:'发起QC'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.qc.request',payload:expect.objectContaining({source:{kind:'version',devId:'dev-domain',versionId:'version-domain'},domain,kind:'sample'})});
});
it('opens the correct QC domain when arriving from an explicitly typed development version',()=>{
  store.state!.devs.push({id:'dev-domain',code:'DEV-DOMAIN',values:{domain:'fabric',category:'羊毛混纺斜纹'}} as any);
  store.state!.versions.push({id:'version-domain',devId:'dev-domain',label:'R1-A',factory:'试样厂',returnedAt:'2026-10-13T08:00:00Z'} as any);
  render(undefined,'list',{versionId:'version-domain'});
  expect(getByRole(host,'tab',{name:/面料QC/}).getAttribute('aria-selected')).toBe('true');
});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it.each(['resample','abandon'] as const)('locks the %s source, retaining history without counting it as open QC work',disposition=>{
  store.state!.devs.push({id:'disposed-d',code:'DEV-OLD',values:{domain:'fabric'}} as any);
  store.state!.versions.push({id:'disposed-v',devId:'disposed-d',label:'R1-A-1',qcDecision:{kind:disposition}} as any);
  store.state!.fulfillment.qcTasks.push(task('old',{domain:'fabric',state:'blocked',assignee:'QC甲',assigneeId:'qc-a',source:{kind:'version',devId:'disposed-d',versionId:'disposed-v'}}),task('new',{domain:'fabric'}));
  render('old');
  for(const name of ['提交 / 追加复验报告','转交','改期'])expect(queryByRole(host,'button',{name})).toBeNull();
  expect(host.textContent).toContain(disposition==='resample'?'本版已重新打样':'本版已放弃');
  render(undefined,'list');expect(getByRole(host,'tab',{name:/面料QC/}).textContent).toMatch(/待处理样品1.*NOK 待恢复0/);
  expect(host.textContent).toContain('OLD');expect(host.textContent).toContain('NEW');expect(host.querySelector('[data-qc-group]')?.textContent).toContain('1 条待办');
});

it('opens the professional writable fabric domain by default and preserves a manual read-only switch',async()=>{
  session.denied.add('qc:garment_chain:write');
  store.state!.fulfillment.qcTasks.push(task('f-own',{domain:'fabric'}),task('g-read'));
  render();
  expect(getByRole(host,'tab',{name:/面料QC/}).getAttribute('aria-selected')).toBe('true');
  expect(host.textContent).toContain('F-OWN');expect(host.textContent).not.toContain('G-READ');
  await click(getByRole(host,'tab',{name:/成衣QC/}));
  store.state={...store.state!,fulfillment:{...store.state!.fulfillment,qcTasks:[...store.state!.fulfillment.qcTasks]}};
  render();
  expect(getByRole(host,'tab',{name:/成衣QC/}).getAttribute('aria-selected')).toBe('true');
});
it('keeps an explicit garment task source visible read-only even for a fabric-only professional',()=>{
  session.denied.add('qc:garment_chain:write');store.state!.fulfillment.qcTasks.push(task('g-source'));
  render('g-source','list');
  expect(getByRole(host,'tab',{name:/成衣QC/}).getAttribute('aria-selected')).toBe('true');
});

it.each(['fabric','garment'] as const)('shows measurement tolerances with units appropriate to %s QC',domain=>{
  store.state!.fulfillment.qcTasks.push(task('units',{domain,state:'reported',reportIds:['report-units']}));
  store.state!.fulfillment.qcReports.push({id:'report-units',taskId:'units',result:'pass',report:'UNITS',opinion:'',measurements:[{point:domain==='fabric'?'克重（g/m²）':'袖长',standard:300,actual:306,tolerance:15}],fileIds:[],reviewer:'QC甲',reviewedAt:'2026-10-08T00:18:00Z'});
  render('units');
  const label=host.querySelector('.mist-tol')?.getAttribute('aria-label');
  expect(label).toBe(domain==='fabric'?'克重（g/m²） 公差 ±15':'袖长 公差 ±15cm');
});

it('shows separate fabric and garment entry cards with their own pending, open-branch and NOK numbers',async()=>{
  store.state!.fulfillment.qcTasks.push(
    task('g-s1'),task('g-s2',{state:'working',assignee:'QC甲',assigneeId:'qc-a'}),
    task('g-p1',{kind:'production',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p1'},state:'blocked'}),
    task('g-p2',{kind:'production',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p2'},state:'reported'}),
    task('f-s1',{domain:'fabric',state:'awaiting_business'}),
  );
  render();
  const garment=getByRole(host,'tab',{name:/成衣QC/}),fabric=getByRole(host,'tab',{name:/面料QC/});
  expect(garment.getAttribute('aria-selected')).toBe('true');
  expect(garment.textContent).toMatch(/待处理样品2/);expect(garment.textContent).toMatch(/未结生产检验1/);expect(garment.textContent).toMatch(/NOK 待恢复1/);
  expect(fabric.textContent).toMatch(/待处理样品0/);expect(fabric.textContent).toMatch(/NOK 待恢复1/);
  expect(host.textContent).toContain('G-S1');expect(host.textContent).not.toContain('F-S1');
  await click(fabric);
  expect(getByRole(host,'tab',{name:/面料QC/}).getAttribute('aria-selected')).toBe('true');
  expect(host.textContent).toContain('F-S1');expect(host.textContent).not.toContain('G-S1');
});

it('groups tasks by factory and inspection site with open count, earliest date and collapse',async()=>{
  store.state!.fulfillment.qcTasks.push(task('a1',{due:'2026-10-18',contact:'王主管'}),task('a2',{due:'2026-10-15'}),task('a3',{state:'reported'}),task('b1',{factory:'远东面料',location:'仓库'}));
  render();
  const groups=host.querySelectorAll('[data-qc-group]');
  expect(groups).toHaveLength(2);
  const first=groups[0] as HTMLElement;
  expect(first.textContent).toContain('华美制衣 · 一号车间');expect(first.textContent).toContain('2 条待办');expect(first.textContent).toContain('最早 10/15');expect(first.textContent).toContain('联系人 王主管');
  expect(within(first).getAllByRole('button',{name:/^\d{2}\/\d{2}|未排期/}).map(row=>row.textContent?.match(/A\d/)?.[0])).toEqual(['A2','A1','A3']);
  await click(within(first).getByRole('button',{name:/收起 华美制衣/}));
  expect(first.textContent).not.toContain('A1');
  expect(within(first).getByRole('button',{name:/展开 华美制衣/}).getAttribute('aria-expanded')).toBe('false');
});

it('shows a summary preview in the list and the complete task on its own page',()=>{
  store.state!.fulfillment.qcTasks.push(task('q1'));
  render('q1','list');
  const preview=host.querySelector('aside.mist-preview') as HTMLElement;
  expect(preview.textContent).toContain('Q1');expect(preview.querySelector('[data-qc-detail]')).toBeNull();
  act(()=>(getByRole(preview,'button',{name:'打开QC任务'}) as HTMLButtonElement).click());
  expect(go).toHaveBeenLastCalledWith('qc-workbench','q1',{detail:'full'});
  render('q1');
  expect(host.querySelector('[data-list-detail-page] [data-qc-detail="q1"]')).not.toBeNull();expect(host.querySelector('[role="row"]')).toBeNull();
  act(()=>(getByRole(host,'button',{name:/返回QC 工作台/}) as HTMLButtonElement).click());
  expect(go).toHaveBeenLastCalledWith('qc-workbench','q1',{},{keepScroll:true});
});
it('keeps QC actions visible with concrete reasons when another QC owns the task',()=>{
  store.state!.fulfillment.qcTasks.push(task('owned',{state:'working',assignee:'QC乙',assigneeId:'qc-b'}));
  render('owned');
  const detail=host.querySelector('[data-qc-detail="owned"]') as HTMLElement;
  expect((getByRole(detail,'button',{name:'认领任务'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('认领任务：已由 QC乙 认领');
  expect((getByRole(detail,'button',{name:'提交 / 追加复验报告'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('仅当前QC（QC乙）可提交');
  expect((getByRole(detail,'button',{name:'转交'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('仅当前QC（QC乙）可转交');
  expect(detail.textContent).toContain('QC乙');expect(detail.textContent).toContain('检查中');
});
it('lets a read-only viewer inspect a task without claiming or reporting it',()=>{
  session.denied=new Set(['qc:fabric_chain:write','qc:garment_chain:write']);
  store.state!.fulfillment.qcTasks.push(task('readonly'));
  render('readonly');
  expect(host.textContent).toContain('READONLY');
  expect(queryByRole(host,'button',{name:'认领任务'})).toBeNull();
  expect(queryByRole(host,'button',{name:'提交 / 追加复验报告'})).toBeNull();expect(host.textContent).not.toContain('需要成衣QC权限');
  expect(store.run).not.toHaveBeenCalled();
});

it('keeps reinspection available to the assigned QC while hiding completed transfer and schedule actions',()=>{
  store.state!.fulfillment.qcTasks.push(task('finished',{state:'reported',assignee:'QC甲',assigneeId:'qc-a'}));
  render('finished');expect((getByRole(host,'button',{name:'提交 / 追加复验报告'}) as HTMLButtonElement).disabled).toBe(false);
  expect(queryByRole(host,'button',{name:'转交',exact:true})).toBeNull();expect(queryByRole(host,'button',{name:'改期',exact:true})).toBeNull();
  expect(host.textContent).not.toContain('已出结论，不能');expect(store.run).not.toHaveBeenCalled();
});

it.each(['pioneer','pp','shipping','development'] as const)('returns the exact %s physical sample with its source context and visible colour',async role=>{
  const source=role==='development'?{kind:'version' as const,devId:'dev',versionId:'version'}:{kind:'orderLine' as const,orderId:'o',lineId:'l',productionId:'factory'};
  store.state!.fulfillment.samples.push({id:'physical',code:'SMP-EXACT',name:'Coating',category:'面料',form:'米样',unit:'米',quantity:.5,available:.5,color:'炭灰',size:'幅宽150cm',source,...(role==='development'?{}:{role}),...(role==='shipping'?{shipmentId:'ticket'}:{}),location:'Room',fileIds:[],note:'',createdAt:'2026-10-08T08:00:00Z'});
  store.state!.fulfillment.qcTasks.push(task('exact',{source,sampleId:'physical',domain:'fabric'}));render('exact');
  expect(host.textContent).toContain('炭灰');
  await click(getByRole(host,'button',{name:role==='shipping'?'返回本票船样':'返回实物样品'}));
  expect(go).toHaveBeenLastCalledWith('samples','physical',role==='shipping'?{section:'shipment:ticket',productionId:'factory'}:role==='development'?{}:{productionId:'factory'});
  expect(store.run).not.toHaveBeenCalled();
});

it('lets the current QC transfer to a named member and reschedule with reasons',async()=>{
  store.state!.members=[{userId:'qc-b',name:'QC乙'} as any];
  store.state!.fulfillment.qcTasks.push(task('mine',{state:'working',assignee:'QC甲',assigneeId:'qc-a'}));
  render('mine');
  const detail=host.querySelector('[data-qc-detail="mine"]') as HTMLElement;
  await click(getByRole(detail,'button',{name:'转交'}));
  let dialog=getByRole(document.body,'dialog');
  choose(getByRole(dialog,'combobox',{name:/接收QC/}) as HTMLSelectElement,'qc-b');
  typeInto(getByRole(dialog,'textbox',{name:/转交原因/}) as HTMLTextAreaElement,'出差');
  await click(getByRole(dialog,'button',{name:'转交'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.qc.transfer',payload:{id:'mine',domain:'garment',assigneeId:'qc-b',reason:'出差'}});
  await click(getByRole(host.querySelector('[data-qc-detail="mine"]') as HTMLElement,'button',{name:'改期'}));
  dialog=getByRole(document.body,'dialog');
  typeInto(getByRole(dialog,'textbox',{name:/改期原因/}) as HTMLTextAreaElement,'工厂延期');
  await click(getByRole(dialog,'button',{name:'改期'}));
  expect(store.run).toHaveBeenLastCalledWith(expect.objectContaining({type:'fulfillment.qc.reschedule',payload:expect.objectContaining({id:'mine',reason:'工厂延期'})}));
});

it('validates garment size checks and confirms the consequence before appending a report',async()=>{
  store.state!.productions.push({id:'p1',code:'PB-1',orderId:'o',lineId:'l',order:'SO1',name:'衬衫',factory:'华美制衣',qty:20,due:'2026-11-01',pct:50,img:'coat',col:'qc'} as any);
  store.state!.fulfillment.productionFacts.push({productionId:'p1',sizes:[{size:'M',quantity:10},{size:'L',quantity:10}],revision:1} as any);
  store.state!.fulfillment.qcTasks.push(task('prod',{kind:'production',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p1'},state:'working',assignee:'QC甲',assigneeId:'qc-a'}));
  render('prod');
  await click(getByRole(host,'button',{name:'提交 / 追加复验报告'}));
  choose(getByRole(host,'combobox',{name:'本次结论'}) as HTMLSelectElement,'pass');
  typeInto(getByRole(host,'textbox',{name:'报告编号'}) as HTMLInputElement,'R-9');
  typeInto(getByRole(host,'textbox',{name:'专业意见与影响范围'}) as HTMLTextAreaElement,'M码袖长偏长');
  typeInto(getByRole(host,'textbox',{name:'实际检查地点'}) as HTMLInputElement,'上海仓 A-01');
  await click(getByRole(host,'button',{name:'提交报告'}));
  expect(host.textContent).toContain('请至少记录一个本次实际检查尺码');
  choose(getByRole(host,'combobox',{name:'尺码 M · 本次结论'}) as HTMLSelectElement,'reject');
  typeInto(getByRole(host,'spinbutton',{name:'尺码 M · 实际检查件数'}) as HTMLInputElement,'3');
  typeInto(getByRole(host,'textbox',{name:'尺码 M · 检查依据'}) as HTMLInputElement,'袖长实测');
  await click(getByRole(host,'button',{name:'提交报告'}));
  expect(host.textContent).toContain('存在尺码不通过时，总结论必须选择不通过');
  choose(getByRole(host,'combobox',{name:'本次结论'}) as HTMLSelectElement,'reject');
  await click(getByRole(host,'button',{name:'提交报告'}));
  const dialog=getByRole(document.body,'dialog');
  expect(dialog.textContent).toContain('不通过将阻断生产，需复验。');expect(dialog.textContent).toContain('提交后报告不可改写');
  expect(store.run).not.toHaveBeenCalled();
  await click(getByRole(dialog,'button',{name:'确认提交'}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.qc.report',payload:expect.objectContaining({id:'prod',result:'reject',report:'R-9',location:'上海仓 A-01',sizeChecks:[{size:'M',inspected:3,result:'reject',evidence:'袖长实测'}]})}));
});

it('keeps business resume available to business users and absent for QC-only accounts',async()=>{
  store.state!.fulfillment.qcTasks.push(task('resume',{kind:'production',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p1'},state:'awaiting_business',assignee:'QC甲',assigneeId:'qc-a'}));
  render('resume');
  await click(getByRole(host,'button',{name:'确认继续生产'}));
  const dialog=getByRole(document.body,'dialog');
  expect(host.querySelector('[data-list-detail-page]')).not.toBeNull();
  typeInto(getByRole(dialog,'textbox',{name:'业务处理与恢复依据'}) as HTMLTextAreaElement,'整改已复核');
  await click(getByRole(dialog,'button',{name:'确认继续生产'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.qc.continue',payload:{id:'resume',note:'整改已复核'}});
  session.denied=new Set(['orders:write','products:write']);
  render('resume');
  expect(queryByRole(host,'button',{name:'确认继续生产'})).toBeNull();
  expect(host.textContent).not.toContain('由业务员确认恢复');
  render('resume','list');
  expect((getByRole(host,'button',{name:'从来源发起QC'}) as HTMLButtonElement).disabled).toBe(true);
  expect(queryByRole(document.body,'dialog')).toBeNull();
});

it('shows frozen pioneer conditions when the inspector opens a production report',async()=>{
 const sampleChecks=[{sampleId:'stone',sampleCode:'SMP-STONE',color:'Stone',form:'米样',reportId:'sample-report',reportNumber:'PP-STONE',result:'conditional' as const,opinion:'卷边须在首批大货复核'}];
 store.state!.fulfillment.productionFacts.push({productionId:'p',sizes:[],revision:1,release:{at:'2026-10-08',actor:'业务员',note:'已核对',sampleChecks}});
 store.state!.fulfillment.qcTasks.push(task('production-check',{domain:'fabric',kind:'production',state:'working',assigneeId:'qc-a',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'}}));
 render('production-check');
 await click(getByRole(host,'button',{name:'提交 / 追加复验报告'}));
 expect(host.textContent).toContain('样品关注项');expect(host.textContent).toContain('SMP-STONE');expect(host.textContent).not.toContain('卷边须在首批大货复核');await click(getByRole(host,'button',{name:'查看关注项'}));expect(host.textContent).toContain('卷边须在首批大货复核');
});

it.each(['fabric','garment'] as const)('shows size-check tables only for garment production reports: %s',domain=>{
  store.state!.fulfillment.qcTasks.push(task('size-domain',{domain,kind:'production',state:'reported',reportIds:['report-size-domain']}));
  store.state!.fulfillment.qcReports.push({id:'report-size-domain',taskId:'size-domain',result:'pass',report:'SIZE-DOMAIN',location:'Shanghai warehouse',opinion:'Checked',measurements:[],fileIds:[],reviewer:'QC',reviewedAt:'2026-10-08T00:18:00Z'});
  render('size-domain');
  expect(queryByRole(host,'table',{name:'SIZE-DOMAIN · 生产尺码检查'})!==null).toBe(domain==='garment');
  expect(host.textContent).toContain('Shanghai warehouse');
});


it('checks only the actual shipping-set sizes and requires all actual pieces before a pass report',async()=>{
 store.state!.fulfillment.samples.push({id:'ship-set',code:'SMP-SET',name:'Jacket',category:'成衣',form:'船样',unit:'件',quantity:3,available:3,size:'S 1 / M 2',sizeQuantities:[{size:'S',quantity:1},{size:'M',quantity:2}],color:'Blue',location:'Sample room',role:'shipping',shipmentId:'ship',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'},fileIds:[],note:'',createdAt:'2026-10-08T00:18:00Z'});
 store.state!.fulfillment.productionFacts.push({productionId:'p',sizes:[{size:'S',quantity:120},{size:'M',quantity:300},{size:'L',quantity:180}],revision:1});store.state!.fulfillment.qcTasks.push(task('ship-qc',{sampleId:'ship-set',source:{kind:'orderLine',orderId:'o',lineId:'l',productionId:'p'},state:'working',assigneeId:'qc-a',assignee:'QC甲'}));render('ship-qc');await click(getByRole(host,'button',{name:'提交 / 追加复验报告'}));
 expect(getByRole(host,'combobox',{name:'尺码 S · 本次结论'})).toBeTruthy();expect(getByRole(host,'combobox',{name:'尺码 M · 本次结论'})).toBeTruthy();expect(queryByRole(host,'combobox',{name:'尺码 L · 本次结论'})).toBeNull();
 choose(getByRole(host,'combobox',{name:'本次结论'}) as HTMLSelectElement,'pass');typeInto(getByRole(host,'textbox',{name:'报告编号'}) as HTMLInputElement,'QC-SHIP');typeInto(getByRole(host,'textbox',{name:'专业意见与影响范围'}) as HTMLTextAreaElement,'Actual submitted set checked');choose(getByRole(host,'combobox',{name:'尺码 S · 本次结论'}) as HTMLSelectElement,'pass');typeInto(getByRole(host,'spinbutton',{name:'尺码 S · 实际检查件数'}) as HTMLInputElement,'1');typeInto(getByRole(host,'textbox',{name:'尺码 S · 检查依据'}) as HTMLInputElement,'Checked');await click(getByRole(host,'button',{name:'提交报告'}));expect(host.textContent).toContain('请完成本组船样全部尺码与件数的QC');expect(store.run).not.toHaveBeenCalled();
});

it('keeps the permanent report notice without claiming a passed report automatically unlocks the source',async()=>{
 store.state!.fulfillment.qcTasks.push(task('passed',{state:'working',assignee:'QC甲',assigneeId:'qc-a'}));render('passed');await click(getByRole(host,'button',{name:'提交 / 追加复验报告'}));
 choose(getByRole(host,'combobox',{name:'本次结论'}) as HTMLSelectElement,'pass');typeInto(getByRole(host,'textbox',{name:'报告编号'}) as HTMLInputElement,'R-PASS');typeInto(getByRole(host,'textbox',{name:'专业意见与影响范围'}) as HTMLTextAreaElement,'已核对本件样品');await click(getByRole(host,'button',{name:'提交报告'}));
 const dialog=getByRole(document.body,'dialog');expect(dialog.textContent).toContain('提交后报告不可改写');expect(dialog.textContent).not.toContain('解锁');expect(store.run).not.toHaveBeenCalled();
});

it('keeps confirmation and continuation evidence in expandable records',async()=>{
 store.state!.fulfillment.qcTasks.push(task('evidence',{state:'reported',businessConfirmation:{result:'approved',actor:'业务员',at:'2026-10-08',note:'燕麦布样批准依据'},businessContinued:{reportId:'r',actor:'业务员',at:'2026-10-08',note:'本批继续依据'}}));render('evidence');expect(host.textContent).not.toContain('燕麦布样批准依据');expect(host.textContent).not.toContain('本批继续依据');await click(getByRole(host,'button',{name:'需求方确认'}));expect(host.textContent).toContain('燕麦布样批准依据');await click(getByRole(host,'button',{name:'业务继续记录'}));expect(host.textContent).toContain('本批继续依据');
});
