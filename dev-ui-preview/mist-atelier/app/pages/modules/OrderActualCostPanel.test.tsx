// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {applyMistCommand,createMistState,type MistCommand,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import {OrderActualCostPanel} from './OrderActualCostPanel';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root,state:MistState;const run=vi.fn();
const ctx={id:(()=>{let i=0;return()=>'c'+(++i);})(),now:'2026-10-18T02:00:00Z',actorName:'财务',actorId:'demo-reviewer'} as any;
function render(canWrite=true){act(()=>root.render(<MistRoot><ToastProvider><OrderActualCostPanel state={state} asOf="2026-10-18" canWrite={canWrite} busy={false} run={run}/></ToastProvider></MistRoot>));}
async function click(node:Element){await act(async()=>(node as HTMLElement).click());}
function type(node:Element,value:string){act(()=>{const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node),'value')!.set!;set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});}
beforeEach(()=>{state=createMistState(ctx,'demo');(state as any).fxPeriodRates=[{id:'fx',currency:'USD',month:'2026-10',rate:'7.100000'},{id:'fx2',currency:'EUR',month:'2026-10',rate:'7.800000'}];run.mockReset();run.mockResolvedValue({result:{id:'x'}});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('lists every effective order with actual revenue, purchase, expenses and margin, and opens the line detail',async()=>{
  state=applyMistCommand(state,{type:'cost.expense.register',payload:{category:'freight',date:'2026-10-15',currency:'USD',amount:800,scope:'shipment',shipmentId:state.fulfillment.shipments[0].id,basis:'volume'}} as MistCommand,ctx).state;
  render();
  const table=getByRole(host,'table',{name:'订单实际核算'});
  expect(table.textContent).toContain('SO-G-2026-017');
  expect(getByRole(host,'table',{name:'费用台账'}).textContent).toContain('FY-2026-0001');
  const row=[...table.querySelectorAll('[role="row"]')].find(r=>r.textContent?.includes('SO-G-2026-017'))!;
  await click(row);
  const detail=document.querySelector('[data-order-cost-detail]') as HTMLElement;
  expect(getByRole(detail,'table',{name:'分摊费用'}).textContent).toContain('海运/空运费');
  expect(getByRole(detail,'table',{name:'采购成本'}).textContent).toContain('PO-2026-00005');
});
it('registers an expense split across picked orders and voids one with a reason',async()=>{
  state=applyMistCommand(state,{type:'cost.expense.register',payload:{category:'bank',date:'2026-10-15',currency:'CNY',amount:30,scope:'orders',orderIds:[state.orders[1].id],basis:'equal'}} as MistCommand,ctx).state;
  render();
  await click(getByRole(host,'button',{name:'登记费用'}));
  const dialog=getByRole(document.body,'dialog',{name:'登记费用'});
  type(getByRole(dialog,'combobox',{name:'分摊范围'}),'orders');
  type(getByRole(dialog,'combobox',{name:'费用类别'}),'commission');
  type(getByRole(dialog,'textbox',{name:'费用金额'}),'500');
  const group=getByRole(dialog,'group',{name:'选择订单'});
  const boxes=group.querySelectorAll('input[type="checkbox"]');
  await click(boxes[1]);await click(boxes[2]);
  await click(getByRole(dialog,'button',{name:'登记并分摊'}));
  expect(run).toHaveBeenCalledWith({type:'cost.expense.register',payload:expect.objectContaining({category:'commission',scope:'orders',basis:'value',amount:'500',orderIds:[state.orders[1].id,state.orders[2].id]})});
  await click(getByRole(host,'button',{name:'作废 FY-2026-0001'}));
  const v=getByRole(document.body,'dialog',{name:/作废 FY-2026-0001/});
  type(getByRole(v,'textbox',{name:'作废原因'}),'重复登记');
  await click(getByRole(v,'button',{name:'作废'}));
  expect(run).toHaveBeenLastCalledWith({type:'cost.expense.void',payload:{id:expect.any(String),reason:'重复登记'}});
});
it('hides registering and voiding for read-only viewers',()=>{
  render(false);
  expect(queryByRole(host,'button',{name:'登记费用'})).toBeNull();
});
it('requires an explicit shipment before an expense can be registered instead of silently using the oldest shipment',async()=>{
  render();await click(getByRole(host,'button',{name:'登记费用'}));const dialog=getByRole(document.body,'dialog',{name:'登记费用'}),shipment=getByRole(dialog,'combobox',{name:'出运'}) as HTMLSelectElement,submit=getByRole(dialog,'button',{name:'登记并分摊'}) as HTMLButtonElement;
  type(getByRole(dialog,'textbox',{name:'费用金额'}),'65');expect(shipment.value).toBe('');expect(submit.disabled).toBe(true);await click(submit);expect(run).not.toHaveBeenCalled();const selected=state.fulfillment.shipments.at(-1)!;type(shipment,selected.id);expect(submit.disabled).toBe(false);await click(submit);expect(run).toHaveBeenCalledWith({type:'cost.expense.register',payload:expect.objectContaining({scope:'shipment',shipmentId:selected.id,amount:'65'})});
});
it('turns an expense into a payable bill and then only shows the bill code',async()=>{
  const supplier=state.market.suppliers[0];
  state=applyMistCommand(state,{type:'cost.expense.register',payload:{category:'freight',vendor:supplier.name,ref:'FW-1',date:'2026-10-15',currency:'USD',amount:800,scope:'shipment',shipmentId:state.fulfillment.shipments[0].id,basis:'volume'}} as MistCommand,ctx).state;
  render();
  await click(getByRole(host,'button',{name:'转应付 FY-2026-0001'}));
  const dialog=getByRole(document.body,'dialog',{name:'转应付 FY-2026-0001'});
  expect((getByRole(dialog,'combobox',{name:'收款供应商'}) as HTMLSelectElement).value).toBe(supplier.id);
  type(dialog.querySelector('input[aria-label="付款到期日"]')!,'2026-11-15');
  await click(getByRole(dialog,'button',{name:'转应付'}));
  expect(run).toHaveBeenCalledWith({type:'cost.expense.payable',payload:{id:state.orderCosts!.expenses[0].id,supplierId:supplier.id,invoiceNo:'FW-1',due:'2026-11-15',taxAmount:''}});
  state=applyMistCommand(state,run.mock.calls[0][0],ctx).state;act(()=>root.unmount());root=createRoot(host);render();
  expect(queryByRole(host,'button',{name:'转应付 FY-2026-0001'})).toBeNull();expect(queryByRole(host,'button',{name:'作废 FY-2026-0001'})).toBeNull();
  expect(getByRole(host,'table',{name:'费用台账'}).textContent).toMatch(/AP-/);
});

it('keeps estimate status and the resolved exchange source visible in the detail',async()=>{
  state.orders.push({...state.orders[0],id:'free',code:'SO-FREE',currency:'USD',amount:0});
  (state as any).orderCosts={expenses:[{id:'fx-expense',code:'FY-FX',category:'freight',date:'2026-10-18',vendor:'物流',ref:'AIR',currency:'USD',amount:65,scope:'orders',basis:'equal',shares:[{orderId:'free',orderCode:'SO-FREE',basisValue:1,amount:65}],createdAt:ctx.now,createdBy:'财务'}]};
  render();const list=getByRole(host,'table',{name:'订单实际核算'}),row=[...list.querySelectorAll('[role="row"]')].find(r=>r.textContent?.includes('SO-FREE'))!;expect(row.textContent).toContain('含暂估');await click(row);
  const detail=document.querySelector('[data-order-cost-detail="free"]')!;const fees=getByRole(detail as HTMLElement,'table',{name:'分摊费用'});
  expect(fees.textContent).toContain('暂估');expect(detail.textContent).toContain('汇率依据');expect(detail.textContent).toContain('2026-10 月末 7.100000');expect(fees.textContent).toContain('461.50');
});
it('opens the order it was sent for',()=>{
  const order=state.orders.find(o=>o.code==='SO-G-2026-017')!;
  act(()=>root.render(<MistRoot><ToastProvider><OrderActualCostPanel state={state} asOf="2026-10-18" canWrite busy={false} run={run} initialOrderId={order.id}/></ToastProvider></MistRoot>));
  expect(document.querySelector(`[data-order-cost-detail="${order.id}"]`)).not.toBeNull();
});

it('shows only visible expense shares when full cost basis is unavailable',()=>{state.partialExpenses=[{id:'e',code:'EX-P',category:'freight',date:'2026-10-18',currency:'USD',shares:[{orderId:'o',orderCode:'SO-OWN',basisValue:1,amount:40}],hiddenCount:1,voided:false}];act(()=>root.render(<MistRoot><ToastProvider><OrderActualCostPanel state={state} asOf="2026-10-18" canWrite={false} busy={false} run={run} materialCostBasis={null}/></ToastProvider></MistRoot>));const list=getByRole(host,'list',{name:'部分可见费用'});expect(list.textContent).toContain('SO-OWN');expect(list.textContent).toContain('40.00');expect(list.textContent).toContain('另有 1 笔其他范围业务');expect(list.textContent).not.toContain('100.00');});
