// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByRole, getByText, queryByRole } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../components/mist';
import { applyMistCommand, createMistState, type MistState } from '../../../../server/src/shared/mistWorkspace';
const store = vi.hoisted(() => ({ state: null as MistState | null, workspace: { id: 'workspace', ownerId: 'fabric-owner' }, loading: false, saving: false, pending: null as object | null, run: vi.fn() }));
const auth = vi.hoisted(() => ({ sessionKey: 'session', user: { id: 'garment-owner', displayName: '成衣负责人' }, hasPermission: vi.fn(() => true) }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => store }));
vi.mock('../runtime/auth', () => ({ useOptionalMistSession: () => auth }));
import { InternalFabricPanel } from './InternalFabricPanel';
import { materialDeliveryFixture } from '../../../../server/src/mist/__tests__/materialDelivery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, orderId: string, lineId: string, fabricOrderId: string, fabricLineId: string, sequence = 0;
const go = vi.fn();
const members = [{ id: 'fabric-owner', name: '面料负责人', active: true, groups: ['fabric' as const] }, { id: 'garment-owner', name: '成衣负责人', active: true, groups: ['garment' as const] }];
const context = { id: () => `fabric-ui-${++sequence}`, now: '2026-10-24T00:00:00Z', actorId: 'garment-owner', actorName: '成衣负责人', members, authority: { supplier: {}, orderReviewerIds: { fabric: ['leader'], garment: ['leader'] } } };
function render(source = false) { const order = store.state!.orders.find(row => row.id === (source ? fabricOrderId : orderId))!, line = store.state!.orderLines.find(row => row.id === (source ? fabricLineId : lineId))!; act(() => root.render(<MistRoot><ToastProvider><InternalFabricPanel order={order} line={line} go={go} /></ToastProvider></MistRoot>)); }
async function click(name: string) { await act(async () => getByRole(document.body, 'button', { name, exact: true }).click()); }
async function input(value: string) { const node = getByRole(host, 'spinbutton', { name: '分配米数' }) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function chooseSource() { const node = getByRole(host, 'combobox', { name: '内部面料' }) as HTMLSelectElement; await act(async () => { node.value = fabricLineId; node.dispatchEvent(new Event('change', { bubbles: true })); }); }
beforeEach(() => {
  sequence = 0; go.mockReset(); store.run.mockReset(); store.pending = null; store.saving = false; store.workspace = { id: 'workspace', ownerId: 'fabric-owner' }; auth.sessionKey = 'session'; auth.user = { id: 'garment-owner', displayName: '成衣负责人' }; auth.hasPermission.mockReturnValue(true);
  let state = createMistState(context, 'empty');
  state.members = members.map(member => ({ userId: member.id, name: member.name, addedBy: 'fabric-owner', addedByName: '面料负责人', addedAt: context.now })); state.memberGroups = members.map(member => ({ userId: member.id, name: member.name, groups: member.groups, updatedAt: context.now, updatedBy: 'fabric-owner' }));
  const fabricContext = { ...context, actorId: 'fabric-owner', actorName: '面料负责人' };
  let result = applyMistCommand(state, { type: 'order.create', payload: { type: 'fabric', ownerId: 'fabric-owner', customerId: '', currency: 'CNY', season: 'AW27', due: '2026-11-01', governance: { kind: 'internal', internalPurpose: '成衣用料', internalSupply: { group: 'garment', receiverId: 'garment-owner' }, receiver: '', poNumber: '', confirmationFileIds: [], paymentMethod: 'TT', depositPercent: 0, paymentNote: '内部结算', incoterm: 'EXW', deliveryPlace: '样品室' }, lines: [{ name: '精纺面料', style: 'FAB-01', img: 'clay', qty: 100.0001, unit: '米', price: 20 }] } }, fabricContext);
  state = result.state; fabricOrderId = result.result.orderId!; fabricLineId = state.orderLines[0].id;
  state = applyMistCommand(state, { type: 'order.governance.submit', payload: { orderId: fabricOrderId } }, fabricContext).state;
  state = applyMistCommand(state, { type: 'order.governance.decide', payload: { id: fabricOrderId, decision: 'approved', note: '确认内部用料' } }, { ...fabricContext, actorId: 'leader' }).state;
  result = applyMistCommand(state, { type: 'order.create', payload: { type: 'garment', ownerId: 'garment-owner', customerId: '', currency: 'USD', season: 'AW27', due: '2026-11-01', governance: { kind: 'internal', internalPurpose: '陈列', receiver: '样品室', poNumber: '', confirmationFileIds: [], paymentMethod: 'TT', depositPercent: 0, paymentNote: '内部结算', incoterm: 'EXW', deliveryPlace: '样品室' }, lines: [{ name: '羊毛外套', style: 'GAR-01', img: 'coat', qty: 20, unit: '件', price: 100, fulfillmentMode: 'full_package', cmtIncludedItems: [] }] } }, context);
  store.state = result.state; orderId = result.result.orderId!; lineId = store.state.orderLines.find(row => row.orderId === orderId)!.id;
  store.run.mockImplementation(async command => { const result = applyMistCommand(store.state!, command, context); store.state = result.state; render(); return { requestId: 'request', revision: 1, result: result.result }; });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete (store.workspace as any).scopedFabricAccess; });

it('offers a recipient-only source hint without exposing the underlying order',async()=>{
 const source=store.state!.orders.find(o=>o.id===fabricOrderId)!;const sourceLine=store.state!.orderLines.find(l=>l.id===fabricLineId)!;
 (store.workspace as any).scopedFabricAccess={[lineId]:{candidates:[{fabricOrderId,fabricLineId,orderCode:source.code,lineName:`${sourceLine.style} · ${sourceLine.name}`,quantity:'100',allocated:'0',remaining:'100'}],blocker:'',deliveries:[]}};
 store.state!.orders=store.state!.orders.filter(o=>o.id!==fabricOrderId);store.state!.orderLines=store.state!.orderLines.filter(l=>l.id!==fabricLineId);
 render();await click('分配面料');expect(getByRole(host,'combobox',{name:'内部面料'}).textContent).toContain(source.code);
});

it('allocates exact metres, updates the same versioned record and cancels without losing history', async () => {
  render(); await click('分配面料'); await chooseSource(); await input('33.3333'); await click('保存分配');
  expect(store.run).toHaveBeenLastCalledWith({ type: 'order.fabric.allocate', payload: { orderId, lineId, fabricOrderId, fabricLineId, metres: '33.3333', expectedRevision: 0 } });
  expect(host.textContent).toContain('66.6668 米');
  await click('查看面料来源'); expect(go).toHaveBeenLastCalledWith('orders/detail', fabricOrderId, { orderLineId: fabricLineId, section: 'fabric' });
  await click('调整分配'); expect(getByText(host, '可分配').parentElement?.textContent).toContain('100.0001 米'); await input('50.0001'); await click('保存分配');
  expect(store.run.mock.calls.at(-1)![0].payload.expectedRevision).toBe(1);
  await click('取消分配'); await click('确认取消分配');
  expect(store.run).toHaveBeenLastCalledWith({ type: 'order.fabric.cancel', payload: { id: store.state!.internalFabricAllocations![0].id, expectedRevision: 2 } });
  expect(store.state!.internalFabricAllocations![0]).toMatchObject({ status: 'cancelled', revision: 3, history: expect.any(Array) });
  await click('分配面料'); await chooseSource(); await input('20'); await click('保存分配'); expect(store.run.mock.calls.at(-1)![0].payload.expectedRevision).toBe(3);
});

it('preserves the requested amount after an over-allocation rejection', async () => {
  render(); await click('分配面料'); await chooseSource(); await input('100.0002'); await click('保存分配');
  expect(host.textContent).toContain('分配米数超过可用余量'); expect((getByRole(host, 'spinbutton', { name: '分配米数' }) as HTMLInputElement).value).toBe('100.0002'); expect(store.state!.internalFabricAllocations || []).toHaveLength(0);
});

it('has an empty state when no approved internal supply is available', async () => {
  store.state!.orders.find(row => row.id === fabricOrderId)!.governance!.status = 'draft'; render(); await click('分配面料'); expect(host.textContent).toContain('暂无可用内部面料'); expect(queryByRole(host, 'combobox', { name: '内部面料' })).toBeNull(); expect((getByRole(host, 'button', { name: '保存分配' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(['cmt', 'trims_cmt'] as const)('offers existing internal fabric to a %s processing order', async mode => {
  store.state!.orderLines.find(row => row.id === lineId)!.fulfillmentMode = mode;
  render(); await click('分配面料'); await chooseSource(); await input('20'); await click('保存分配');
  expect(store.state!.internalFabricAllocations?.[0]).toMatchObject({ orderId, lineId, fabricLineId, metres: '20', status: 'active' });
});

it('shows source totals and returns to the exact garment line', async () => {
  store.state = applyMistCommand(store.state!, { type: 'order.fabric.allocate', payload: { orderId, lineId, fabricOrderId, fabricLineId, metres: '0.0001', expectedRevision: 0 } }, context).state;
  render(true); expect(getByText(host, '已分配').parentElement?.textContent).toContain('0.0001 米'); expect(getByText(host, '剩余').parentElement?.textContent).toContain('100 米'); await click('查看成衣条目'); expect(go).toHaveBeenCalledWith('orders/detail', orderId, { orderLineId: lineId, section: 'garment' });
});

it('locks changes during approval and hides controls without order write permission', () => {
  store.state!.orders.find(row => row.id === orderId)!.governance!.status = 'pending'; render(); expect((getByRole(host, 'button', { name: '分配面料' }) as HTMLButtonElement).disabled).toBe(true);
  auth.hasPermission.mockReturnValue(false); render(); expect(queryByRole(host, 'button', { name: '分配面料' })).toBeNull(); expect(store.run).not.toHaveBeenCalled();
});

it('ignores an old request failure after account switching', async () => {
  let reject!: (error: Error) => void; store.run.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(); await click('分配面料'); await chooseSource(); await input('20'); await click('保存分配');
  auth.sessionKey = 'next-session'; auth.user = { id: 'fabric-owner', displayName: '面料负责人' }; render(); await act(async () => reject(new Error('旧账号失败')));
  expect(host.textContent).not.toContain('旧账号失败'); expect(queryByRole(host, 'spinbutton', { name: '分配米数' })).toBeNull();
});

it('keeps source quantities visible without offering an inaccessible garment link',()=>{
 store.state=applyMistCommand(store.state!,{type:'order.fabric.allocate',payload:{orderId,lineId,fabricOrderId,fabricLineId,metres:'80',expectedRevision:0}},context).state;
 store.state.orders=store.state.orders.filter(row=>row.id===fabricOrderId);store.state.orderLines=store.state.orderLines.filter(row=>row.orderId===fabricOrderId);
 auth.user={id:'fabric-owner',displayName:'面料负责人'};render(true);
 expect(host.textContent).toContain('80 米');expect(host.textContent).toContain('20.0001 米');
 expect(queryByRole(host,'button',{name:'查看成衣条目'})).toBeNull();
});

it('records the resolved shortage without changing the original allocation',async()=>{
 const f=materialDeliveryFixture(20),id=f.issue(20);
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:16,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Counted'}},'garment');
 f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'Hold A',person:'factory',note:'Return'}});
 store.state=f.state;orderId=f.target.orderId;lineId=f.target.lineId;fabricOrderId=f.source.orderId;fabricLineId=f.source.lineId;auth.user={id:'garment',displayName:'Garment'};
 store.run.mockImplementation(async command=>{f.run(command,'garment');store.state=f.state;render();return {requestId:'request',revision:1,result:{}};});
 render();await click('确认短料不补发');const dialog=getByRole(document.body,'dialog',{name:'确认短料不补发'});
 const area=getByRole(dialog,'textbox',{name:'不补发依据'}) as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Confirmed no replacement');area.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('确认结案');expect(store.run).toHaveBeenCalledWith({type:'order.fabric.shortClose',payload:{id:f.state.internalFabricAllocations![0].id,expectedRevision:1,reason:'Confirmed no replacement'}});
 expect(host.textContent).toContain('短结不补发');expect(host.textContent).toContain('4 米 · 实收 16 米');
});

it('does not offer shortage closure from returned deliveries of the previous allocation',()=>{
 const f=materialDeliveryFixture(20),id=f.issue(4);
 f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,acceptedQuantity:0,rejectedQuantity:4,expectedReceivingRevision:0,evidence:'Rejected'}},'garment');
 f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',issueId:id,quantity:4,location:'Hold',person:'factory',note:'Returned'}});
 const replacement=f.create('fabric');f.run({type:'order.fabric.allocate',payload:{...f.target,fabricOrderId:replacement.orderId,fabricLineId:replacement.lineId,metres:'4',expectedRevision:1}},'garment');
 store.state=f.state;orderId=f.target.orderId;lineId=f.target.lineId;auth.user={id:'garment',displayName:'Garment'};render();
 expect(queryByRole(host,'button',{name:'确认短料不补发'})).toBeNull();
});
