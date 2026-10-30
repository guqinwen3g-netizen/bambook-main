// @vitest-environment jsdom
import {materialDeliveryFixture} from '../../../../../server/src/mist/__tests__/materialDelivery';
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import {applyDataScope,scopedMaterialIssueTargets} from '../../../../../server/src/shared/mistDataScope';
import type {FulfillmentStock,FulfillmentStockMovement} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,workspace:null as any,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
const session=vi.hoisted(()=>({denied:new Set<string>()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth', () => { const useMistSession = ()=>({user:{id:'biz',displayName:'经办人'},sessionKey:'s',hasPermission:(p:string)=>!session.denied.has(p),canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
vi.mock('../../../../../services/apiService',()=>({apiService:{}}));
import {InventoryPage} from './InventoryPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const go=vi.fn();
function render(id?:string){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'inventory',id},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><InventoryPage/></Nav.Provider></ToastProvider></MistRoot>));}
async function click(node:HTMLElement){await act(async()=>node.click());}
function choose(select:HTMLSelectElement,value:string){act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
function typeInto(input:HTMLInputElement|HTMLTextAreaElement,value:string){act(()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
const stock=(id:string,patch:Partial<FulfillmentStock>={}):FulfillmentStock=>({id,sourceKind:'purchase',purchaseId:'po',receiptId:'rc',orderId:'og',lineId:'lg',name:'主唛',unit:'个',quantity:100,available:100,location:'A-1',owner:'公司货权',warehouseId:'wh',createdAt:'2026-10-10T08:00:00Z',...patch});
const movement=(id:string,stockId:string,kind:FulfillmentStockMovement['kind'],quantity:number,patch:Partial<FulfillmentStockMovement>={}):FulfillmentStockMovement=>({id,stockId,kind,quantity,location:'嘉兴厂',person:'江南成衣',note:'供料',at:'2026-10-11T08:00:00Z',actor:'经办人',...patch});
beforeEach(()=>{session.denied=new Set();store.workspace=null;const s=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T10:00:00Z',actorName:'经办人'},'empty');
  s.orders.push({id:'og',code:'SO-G',type:'garment',customerId:'c',currency:'USD'} as any,{id:'of',code:'SO-F',type:'fabric',customerId:'c',currency:'USD'} as any);
  s.orderLines.push({id:'lg',orderId:'og',name:'风衣',style:'TR-1',img:'coat',qty:100,unit:'件',price:10,made:0,qc:0},{id:'lf',orderId:'of',name:'府绸',style:'F-1',img:'fabric',qty:500,unit:'米',price:3,made:0,qc:0});
  s.fulfillment.warehouses.push({id:'wh',code:'WH-1',name:'松江仓',address:'上海',active:true});
  store.state=s;store.run.mockReset();store.run.mockResolvedValue({result:{}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('summarises each business group per unit without ever adding different units together',async()=>{
  store.state!.fulfillment.stock.push(stock('a',{available:400}),stock('b',{name:'里布',unit:'米',available:860,quantity:860}),stock('c',{name:'主唛补单',available:20}),stock('f',{orderId:'of',lineId:'lf',name:'府绸坯布',unit:'米',available:300,quantity:300}));
  render();
  const tabs=getByRole(host,'tablist',{name:'库存业务板块'}),garment=getByRole(tabs,'tab',{name:/成衣库存/}),fabric=getByRole(tabs,'tab',{name:/面料库存/});
  expect(garment.getAttribute('aria-selected')).toBe('true');
  expect(garment.textContent).toContain('3 个批次');
  expect(garment.textContent).toContain('860米');expect(garment.textContent).toContain('420个');expect(garment.textContent).not.toContain('1280');
  expect(getByRole(host,'table',{name:'库存批次列表'}).textContent).not.toContain('府绸坯布');
  await click(fabric);
  expect(fabric.getAttribute('aria-selected')).toBe('true');
  expect(fabric.textContent).toContain('300米');
  expect(getByRole(host,'table',{name:'库存批次列表'}).textContent).toContain('府绸坯布');
});

it('puts isolated returns first, filters by recorded state and keeps the exact quantity wording',async()=>{
  store.state!.fulfillment.stock.push(stock('ok',{name:'可用批次'}),stock('ret',{sourceKind:'claimReturn',purchaseId:undefined,receiptId:undefined,name:'退回大衣',unit:'件',quantity:2,available:0,onHand:2,locked:2,batchNumber:'RET-1'}),stock('gone',{name:'已出库批次',available:0}));
  store.state!.fulfillment.stockMovements.push(movement('m1','gone','issue',100));
  render();
  const table=getByRole(host,'table',{name:'库存批次列表'}),rows=getAllByRole(table,'row').slice(1);
  expect(rows[0].textContent).toContain('退回大衣');expect(rows[0].textContent).toContain('可用 0 / 现存 2 / 隔离 2 件');expect(rows[0].textContent).toContain('隔离中');
  expect(rows[2].textContent).toContain('已出库批次');expect(rows[2].textContent).toContain('已出库 100 个');
  await click(getByRole(host,'button',{name:/隔离待处置/}));
  expect(getByRole(host,'table',{name:'库存批次列表'}).textContent).not.toContain('可用批次');
  choose(getByRole(host,'combobox',{name:'仓库筛选'}) as HTMLSelectElement,'wh');
  expect(getByRole(host,'table',{name:'库存批次列表'}).textContent).toContain('退回大衣');
});

it('explains blocked movements and records a return against the original issue in a dialog over the ledger',async()=>{
  store.state!.fulfillment.stock.push(stock('gone',{available:0}));
  store.state!.fulfillment.stockMovements.push(movement('m1','gone','issue',100),movement('m2','gone','return',30,{issueId:'m1'}));
  render('gone');
  const detail=host.querySelector('[data-stock-detail="gone"]') as HTMLElement;
  expect(detail.textContent).toContain('已全部出库 · 70 个');
  expect((getByRole(detail,'button',{name:'登记出库'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('登记出库：当前没有可用数量');
  expect(detail.textContent).not.toContain('服务端');
  expect(getByRole(detail,'table',{name:'出库去向'}).textContent).toContain('70 个');
  await click(getByRole(detail,'button',{name:'按原出库退回'}));
  const dialog=getByRole(document.body,'dialog');
  expect(getByRole(host,'table',{name:'库存批次列表'})).toBeTruthy();
  choose(getByRole(dialog,'combobox',{name:'原出库'}) as HTMLSelectElement,'m1');
  typeInto(getByRole(dialog,'spinbutton',{name:'数量（个）'}) as HTMLInputElement,'20');
  typeInto(getByRole(dialog,'textbox',{name:'交接地点'}) as HTMLInputElement,'A-1');
  typeInto(getByRole(dialog,'textbox',{name:'接收 / 交付方'}) as HTMLInputElement,'仓库');
  typeInto(getByRole(dialog,'textbox',{name:'交接依据'}) as HTMLTextAreaElement,'工厂退回余料实点');
  await click(getByRole(dialog,'button',{name:'登记退回'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.inventory.move',payload:expect.objectContaining({id:'gone',kind:'return',quantity:20,issueId:'m1',note:'工厂退回余料实点'})});
});

it('distinguishes same-person same-quantity issues by their recorded handover evidence',async()=>{
  store.state!.fulfillment.stock.push(stock('gone',{available:0}));
  store.state!.fulfillment.stockMovements.push(movement('a','gone','issue',2,{note:'批次 A',at:'2026-10-11T08:00:00Z'}),movement('b','gone','issue',2,{note:'批次 B',at:'2026-10-11T08:01:00Z'}));
  render('gone');await click(getByRole(host,'button',{name:'按原出库退回'}));
  const select=getByRole(document.body,'combobox',{name:'原出库'}) as HTMLSelectElement;
  expect([...select.options].find(o=>o.value==='a')?.textContent).toContain('批次 A');
  expect([...select.options].find(o=>o.value==='b')?.textContent).toContain('批次 B');
});

it('links an existing stock issue to its exact shipment with a required evidence field',async()=>{
  store.state!.fulfillment.stock.push(stock('gone',{available:0}));
  store.state!.fulfillment.stockMovements.push(movement('m1','gone','issue',100));
  store.state!.productions.push({id:'p',sourcePurchaseId:'po',orderId:'og',lineId:'lg'} as any);
  store.state!.fulfillment.shipments.push({id:'s',code:'SHP-1',state:'departed',lines:[{orderId:'og',lineId:'lg',productionId:'p',quantity:100}]} as any);
  render('gone'); await click(getByRole(host,'button',{name:'关联出运'}));
  const dialog=getByRole(document.body,'dialog',{name:'关联出运'});
  expect((getByRole(dialog,'combobox',{name:'出运单'}) as HTMLSelectElement).value).toBe('s');
  typeInto(getByRole(dialog,'textbox',{name:'核对依据'}) as HTMLTextAreaElement,'对照原出库单和装箱单');
  await click(getByRole(dialog,'button',{name:'确认关联'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.inventory.shipment.link',payload:{issueId:'m1',shipmentId:'s',evidence:'对照原出库单和装箱单'}});
});

it('keeps isolated return batches out of generic issue and move actions',()=>{
  store.state!.fulfillment.stock.push(stock('ret',{sourceKind:'claimReturn',purchaseId:undefined,receiptId:undefined,name:'退回大衣',unit:'件',quantity:2,available:0,onHand:2,locked:2,batchNumber:'RET-1'}));
  store.state!.fulfillment.receivedRecords.push({id:'rr',returnReceiptId:'rt',goodsId:'g',stockId:'ret',source:{shipmentId:'x'} as any,quantity:2,unit:'件',warehouseId:'wh',batchNumber:'RET-1',location:'R-1',ownership:'Owned',ownershipDate:'2026-10-12',ownershipEvidence:'确认',receivedAt:'2026-10-12',basis:'实点',fileIds:[],at:'2026-10-12T08:00:00Z',actorId:'biz',actor:'经办人',inboundMovementId:'i',holdMovementId:'h'});
  render('ret');
  const detail=host.querySelector('[data-stock-detail="ret"]') as HTMLElement;
  expect(detail.textContent).toContain('退回隔离库存');
  expect(queryByRole(detail,'button',{name:'登记出库'})).toBeNull();
  expect(queryByRole(detail,'button',{name:'登记移位'})).toBeNull();
  expect(detail.textContent).toContain('隔离数量');
});

it('shows rejected warehouse material as isolated and warns before return',async()=>{
  const f=materialDeliveryFixture(20),id=f.issue(20);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
  store.state=f.state;render(store.state.fulfillment.stock[0].id);
  await click(getByRole(host,'button',{name:'按原出库退回'}));
  expect(getByRole(document.body,'dialog').textContent).toContain('拒收料优先退回并隔离');
  await click(getByRole(document.body,'button',{name:'取消'}));
  f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'A-01',person:'factory',note:'Rejected'}});
  store.state=f.state;render(store.state.fulfillment.stock[0].id);
  const detail=host.querySelector('[data-stock-detail]') as HTMLElement;
  expect(detail.textContent).toContain('隔离待处置 4 米');expect(detail.textContent).toContain('隔离 4米');
  expect((getByRole(detail,'button',{name:'登记出库'}) as HTMLButtonElement).disabled).toBe(true);
});

it('starts inspection for the exact isolated return and requires its passing report for release',async()=>{
  const f=materialDeliveryFixture(20),id=f.issue(20);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
  const ret=f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'Hold A',person:'factory',note:'Rejected'}}).id!;
  store.state=f.state;render(store.state.fulfillment.stock[0].id);
  await click(getByRole(host,'button',{name:'送复检'}));
  const dialog=getByRole(document.body,'dialog',{name:'隔离料送复检'});await click(getByRole(dialog,'button',{name:'发起复检'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.inventory.quarantine.request',payload:{returnId:ret,due:expect.any(String)}});
  expect(queryByRole(host,'button',{name:'恢复可用'})).toBeNull();
});

it('shows failed quarantine disposal choices and records their evidence on the exact return',async()=>{
  const f=materialDeliveryFixture(20); f.context.members!.push({id:'qc',name:'QC',active:true,groups:[]});const id=f.issue(20);
  f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
  const ret=f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'Hold A',person:'factory',note:'Rejected'}}).id!;
  const task=f.run({type:'fulfillment.inventory.quarantine.request',payload:{returnId:ret,due:'2026-10-24'}}).id!;
  f.run({type:'fulfillment.qc.claim',payload:{id:task,domain:'fabric'}},'qc');
  f.run({type:'fulfillment.qc.report',payload:{id:task,domain:'fabric',result:'reject',report:'FAIL-1',opinion:'Defect',location:'Hold A',reviewedAt:f.context.now,measurements:[],fileIds:[]}},'qc');
  store.state=f.state;render(f.state.fulfillment.stock[0].id);
  expect(getByRole(host,'button',{name:'报废'})).toBeTruthy();await click(getByRole(host,'button',{name:'退供应商'}));
  const dialog=getByRole(document.body,'dialog',{name:'登记退供应商'});typeInto(getByRole(dialog,'textbox',{name:'供应商接收依据'}) as HTMLTextAreaElement,'模拟供应商确认收回');await click(getByRole(dialog,'button',{name:'确认登记'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId:ret,decision:'supplierReturn',evidence:'模拟供应商确认收回'}});
});

it('allows an evidence-based correction of a departed link while displaying the original record',async()=>{
  store.state!.fulfillment.stock.push(stock('gone',{available:0}));
  store.state!.fulfillment.stockMovements.push(movement('m1','gone','issue',100,{shipmentLink:{shipmentId:'s',productionId:'p',evidence:'原依据',actor:'经办人',at:'2026-10-12'}}));
  store.state!.productions.push({id:'p',sourcePurchaseId:'po',orderId:'og',lineId:'lg'} as any);
  store.state!.fulfillment.shipments.push({id:'s',code:'SHP-1',state:'departed',lines:[{orderId:'og',lineId:'lg',productionId:'p',quantity:100}]} as any);
  render('gone');await click(getByRole(host,'button',{name:'更正'}));const dialog=getByRole(document.body,'dialog',{name:'更正已离港关联'});
  typeInto(getByRole(dialog,'textbox',{name:'更正原因'}) as HTMLTextAreaElement,'补充核对信息');typeInto(getByRole(dialog,'textbox',{name:'核对依据'}) as HTMLTextAreaElement,'复核交接单');await click(getByRole(dialog,'button',{name:'确认更正'}));
  expect(store.run).toHaveBeenCalledWith({type:'fulfillment.inventory.shipment.correct',payload:{issueId:'m1',shipmentId:'s',reason:'补充核对信息',evidence:'复核交接单'}});
});

it('stays readable without inventory authority and says why movements are unavailable',()=>{
  session.denied.add('inventory:write');
  store.state!.fulfillment.stock.push(stock('a'));
  render('a');
  expect(host.textContent).not.toContain('你的账号没有库存写权限');
  expect(queryByRole(host,'button',{name:'新增仓库'})).toBeNull();
  const detail=host.querySelector('[data-stock-detail="a"]') as HTMLElement;
  expect((getByRole(detail,'button',{name:'登记出库'}) as HTMLButtonElement).disabled).toBe(true);
  expect(detail.textContent).toContain('登记出库：需要库存写权限');
  expect(store.run).not.toHaveBeenCalled();
});

it('binds a material issue to the existing processing branch instead of a free-text destination',async()=>{
  const f=materialDeliveryFixture();store.state=f.state;store.state.memberGroups!.push({userId:'biz',name:'Business',groups:['fabric'],updatedAt:'',updatedBy:'owner'});
  const stock=store.state.fulfillment.stock[0];render(stock.id);await click(getByRole(host,'button',{name:'登记出库',exact:true}));
  const dialog=getByRole(document.body,'dialog',{name:'登记发料'});expect((getByRole(dialog,'combobox',{name:'接收加工单'}) as HTMLSelectElement).value).toBe(f.productionId);
  typeInto(getByRole(dialog,'textbox',{name:'交接地点'}) as HTMLInputElement,'Factory');typeInto(getByRole(dialog,'textbox',{name:'交接联系人'}) as HTMLInputElement,'Factory receiver');typeInto(getByRole(dialog,'textbox',{name:'交接依据'}) as HTMLTextAreaElement,'Delivery note');
  await click(getByRole(dialog,'button',{name:'登记发料',exact:true}));
  expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'fulfillment.materials.issue',payload:expect.objectContaining({id:stock.id,targetProductionId:f.productionId,quantity:100.3})}));
});
it('uses the minimal authorized destination hint when the other team order is hidden',async()=>{
 const f=materialDeliveryFixture(20),scope={userIds:['owner'],teamIds:[]},stock=f.state.fulfillment.stock[0];
 store.workspace={materialIssueTargets:scopedMaterialIssueTargets(f.state,scope)};store.state=applyDataScope(f.state,scope,'owner');
 expect(store.state.orders.some(o=>o.id===f.target.orderId)).toBe(false);
 render(stock.id);await click(getByRole(host,'button',{name:'登记出库',exact:true}));
 const dialog=getByRole(document.body,'dialog',{name:'登记发料'});expect((getByRole(dialog,'combobox',{name:'接收加工单'}) as HTMLSelectElement).value).toBe(f.productionId);
});
it('lets a garment-line account handle internal fabric stock (P4: no line restriction)',()=>{
  const f=materialDeliveryFixture();store.state=f.state;store.state.memberGroups!.push({userId:'biz',name:'Business',groups:['garment'],updatedAt:'',updatedBy:'owner'});render(store.state.fulfillment.stock[0].id);
  expect((getByRole(host,'button',{name:'登记出库',exact:true}) as HTMLButtonElement).disabled).toBe(false);
});
