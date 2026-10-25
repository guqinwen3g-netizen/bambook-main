// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_PAGES } from './MarketPages';
import { relationBusiness, relationIdentities } from './RelationsPage';
import { Nav } from '../../nav';
import { createMistState, type MistContext, type MistState } from '../../../../../server/src/shared/mistWorkspace';

const bridge = vi.hoisted(() => ({ current: null as any, write:true, admin:true }));
vi.mock('../../runtime/workspace', () => ({ useMistWorkspace: () => bridge.current }));
vi.mock('../../runtime/auth', () => { const useMistSession = () => ({ user: { id: 'demo-buyer', displayName: '沈禾' }, hasPermission: (scope:string) => scope==='relations:write'?bridge.write:scope==='relations:admin'?bridge.admin:true, hasRole: () => false, canAccessView: () => true }); return { useMistSession, useOptionalMistSession: useMistSession }; });
let host: HTMLDivElement, root: Root | undefined, state: MistState; const go = vi.fn();
const named = (n: string) => state.market.relations.find(r => r.name.includes(n))!;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; go.mockReset();bridge.write=true;bridge.admin=true;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  let n = 0; const ctx: MistContext = { id: () => `r-test-${++n}`, actorName: '演示', now: '2026-10-14T02:00:00.000Z' };
  state = createMistState(ctx, 'demo');
  bridge.current = { state, run: vi.fn(async () => ({ result: { id: 'saved' } })), error: '', refresh: vi.fn(), loading: false, saving: false, pending: null, upload: vi.fn() };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.useRealTimers(); });
async function mount(id?: string, mode: 'full' | 'list' = id ? 'full' : 'list') { const detail = mode === 'full' ? mode : undefined; host = document.createElement('div'); document.body.append(host); root = createRoot(host); const Page = MARKET_PAGES.relations; await act(async () => root!.render(<Nav.Provider value={{ route: { view: 'relations', id, detail }, go, theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn(), openAI: vi.fn() }}><Page /></Nav.Provider>)); }
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => b!.click()); }


describe('关系智库', () => {
  it('同一组织同时是客户和供应商；冻结与在手业务由记录推出', () => {
    const boyuan = named('博远');
    expect(relationIdentities(boyuan)).toEqual(['customer', 'supplier']);
    expect(state.market.relations.filter(r => r.name.includes('博远')).length).toBe(1);
    const lune = state.market.relations.find(r => r.hold)!;
    expect(lune.hold!.reason).toContain('尾款逾期');
    expect(relationBusiness(state, lune).total).toBeGreaterThan(0);
  });
  it('列表预览只显示摘要，打开组织档案进入独立详情页，返回关系智库', async () => {
    const id = named('博远').id; await mount(id, 'list');
    const preview = host.querySelector('aside.mist-preview')!;
    expect(preview.textContent).toContain('博远'); expect(preview.querySelector('[data-relation-detail]')).toBeNull();
    await click('打开组织档案'); expect(go).toHaveBeenLastCalledWith('relations', id, { detail: 'full' });
    await act(async () => root!.unmount()); host.remove(); await mount(id, 'full');
    expect(host.querySelector('[data-list-detail-page] [data-relation-detail]')).not.toBeNull(); expect(host.querySelector('[role="row"]')).toBeNull();
    await click('返回关系智库'); expect(go).toHaveBeenLastCalledWith('relations', id, {}, { keepScroll: true });
  });
  it('列表把冻结的组织排在最前，按身份计数（双重身份两边都计）', async () => {
    await mount();
    const rows = [...host.querySelectorAll<HTMLElement>('[role="row"][tabindex]')];
    expect(rows[0].textContent).toContain('已冻结');
    expect(host.textContent).toMatch(/客户\s*6/); expect(host.textContent).toMatch(/供应商\s*6/);
  });
  it('冻结的客户：显示原因与影响，只能解冻；有在手业务时不能归档', async () => {
    const lune = state.market.relations.find(r => r.hold)!;
    await mount(lune.id);
    const detail = host.querySelector('[data-relation-detail]')!;
    expect(detail.textContent).toContain('往来已冻结');
    expect(detail.textContent).toContain(lune.hold!.reason);
    expect(button('解冻')).toBeTruthy(); expect(button('冻结往来')).toBeUndefined();
    expect(button('归档')!.disabled).toBe(true);
    expect(detail.textContent).toMatch(/还有在手业务 \d+ 项/);
  });
  it('双重身份：客户联系人与供应商联系人分开维护，不再提供关联', async () => {
    await mount(named('博远').id);
    const detail = host.querySelector('[data-relation-detail]')!;
    expect([...detail.querySelectorAll('.mist-pill')].map(row=>row.textContent)).toEqual(expect.arrayContaining(['客户','供应商']));
    expect(detail.textContent).toMatch(/供应商联系人 · 1.*何静/);
    expect(button('关联供应商身份')).toBeUndefined();
    expect(button('打开供应商')).toBeTruthy(); expect(button('打开客户业务')).toBeTruthy();
  });
  it('普通客户可关联供应商身份；主管可交接在手业务（默认勾选在手订单与商机，选新负责人并写原因）', async () => {
    bridge.current.workspace = { ownerId: 'demo-sales' }; (state as any).members = [{ userId: 'demo-new', name: '林舟' }];
    await mount(named('Cedar').id);
    expect(button('关联供应商身份')!.disabled).toBe(false);
    expect(host.querySelector('[data-relation-detail]')!.textContent).toMatch(/联系人 · 3.*Emma Clarke/);
    await click('在手业务交接');
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('当前负责人 顾言');
    const owner = dialog.querySelector('select') as HTMLSelectElement;
    expect([...owner.options].map(o => o.value)).toEqual(['', 'demo-new']);
    expect([...dialog.querySelectorAll('input[type="checkbox"]')].map(c => (c as HTMLInputElement).checked)).toEqual([true, true, true]);
    await act(async () => { owner.value = 'demo-new'; owner.dispatchEvent(new Event('change', { bubbles: true })); });
    const reason = dialog.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '顾言调岗'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('确认交接');
    expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({ type: 'handover.customer', payload: expect.objectContaining({ customerId: named('Cedar').customerId, toUserId: 'demo-new', reason: '顾言调岗', orderIds: state.orders.filter(o => o.customerId === named('Cedar').customerId && o.state !== '履约完成').map(o => o.id), opportunityIds: [] }) }));
    bridge.current.run.mockClear();
    await click('冻结往来');
    expect(document.body.textContent).toContain('出运须逐票批准');expect(document.body.textContent).not.toContain('不受影响，继续执行');
    expect(bridge.current.run).not.toHaveBeenCalled();
  });
});

it.each([{write:true,held:true},{write:true,held:false},{write:false,held:true}])('hides hold controls from a non-admin archive reader/editor ($write, $held)',async({write,held})=>{
 bridge.write=write;bridge.admin=false;await mount(state.market.relations.find(row=>row.customerId&&!!row.hold===held)!.id);expect(button('解冻')).toBeUndefined();expect(button('冻结往来')).toBeUndefined();expect(button('在手业务交接')).toBeUndefined();expect(!!button('编辑档案')).toBe(write);expect(document.body.textContent).not.toContain('没有关系档案写权限');expect(button('打开客户业务')).toBeTruthy();expect(bridge.current.run).not.toHaveBeenCalled();
});
it('lets relation administration restore a hold without implying archive edit permission',async()=>{
 bridge.write=false;bridge.admin=true;const relation=state.market.relations.find(row=>row.hold)!;await mount(relation.id);expect(button('编辑档案')).toBeUndefined();expect(button('解冻')!.disabled).toBe(false);await click('解冻');const input=document.body.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'原回款已核销');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>{[...document.body.querySelector('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent?.trim()==='解冻')!.click();});expect(bridge.current.run).toHaveBeenCalledWith({type:'market.relation.hold',payload:{id:relation.id,frozen:false,reason:'原回款已核销'}});
});

it('closes an administrative hold form after authority is revoked and does not resurrect it',async()=>{
 const relation=state.market.relations.find(row=>row.hold)!;await mount(relation.id);await click('解冻');expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();const Page=MARKET_PAGES.relations;
 const paint=()=>root!.render(<Nav.Provider value={{route:{view:'relations',id:relation.id,detail:'full'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><Page/></Nav.Provider>);
 bridge.admin=false;await act(async()=>paint());expect(document.body.querySelector('[role="dialog"]')).toBeNull();expect(button('解冻')).toBeUndefined();bridge.admin=true;await act(async()=>paint());expect(document.body.querySelector('[role="dialog"]')).toBeNull();expect(bridge.current.run).not.toHaveBeenCalled();
});

it('offers the current customer owner when selected in-progress orders still belong to another member',async()=>{
 const relation=named('Cedar'),customer=state.customers.find(row=>row.id===relation.customerId)!,orders=state.orders.filter(row=>row.customerId===customer.id&&row.state!=='履约完成');expect(orders.length).toBeGreaterThan(0);for(const order of orders){order.ownerId=customer.ownerId;order.owner=customer.owner;if(order.governance)order.governance.status='approved';}const selected=orders[0];selected.ownerId='demo-buyer';selected.owner='沈禾';bridge.current.workspace={ownerId:customer.ownerId};(state as any).members=[{userId:'demo-buyer',name:'沈禾'}];await mount(relation.id);await click('在手业务交接');const dialog=document.body.querySelector('[role="dialog"]')!,select=dialog.querySelector('select')!;expect([...select.options].map(row=>row.value)).toContain(customer.ownerId);expect(dialog.textContent).toContain('负责人 沈禾');
 await act(async()=>{select.value=customer.ownerId;select.dispatchEvent(new Event('change',{bubbles:true}));for(const input of [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].slice(1))if(input.checked)input.click();const reason=dialog.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(reason,'原成衣单由现客户负责人接续');reason.dispatchEvent(new Event('input',{bubbles:true}));});await click('确认交接');expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'handover.customer',payload:expect.objectContaining({customerId:customer.id,toUserId:customer.ownerId,orderIds:[selected.id],opportunityIds:[]})}));
});

it('keeps a 100-percent order in current business until fulfilled and excludes void/cancelled records',async()=>{
 const relation=state.market.relations.find(row=>row.hold)!,order=state.orders.find(row=>row.customerId===relation.customerId)!;order.progress=100;order.state='已批准待履约';if(order.governance)order.governance.status='approved';
 for(const [id,status,label] of [['void-row','void','已作废'],['cancelled-row','cancelled','已取消'],['fulfilled-row','approved','履约完成']] as const){state.orders.push({...structuredClone(order),id,code:id,progress:status==='approved'?100:0,state:label,governance:{...structuredClone(order.governance!),status}});}
 expect(relationBusiness(state,relation).orders.map(row=>row.id)).toContain(order.id);for(const id of ['void-row','cancelled-row','fulfilled-row'])expect(relationBusiness(state,relation).orders.map(row=>row.id)).not.toContain(id);
 await mount(relation.id);const detail=host.querySelector('[data-relation-detail]')!;expect(detail.textContent).toContain(order.code);await click('打开');expect(go.mock.calls.at(-1)?.slice(0,2)).toEqual(['orders/detail',order.id]);
});
