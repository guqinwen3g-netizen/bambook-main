// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_PAGES } from './MarketPages';
import { supplierFlags, supplierPerformance } from './SuppliersPage';
import { fireEvent, getByRole, queryByRole } from '@testing-library/dom';
import { Nav } from '../../nav';
import { createMistState, type MistContext, type MistState } from '../../../../../server/src/shared/mistWorkspace';

const bridge = vi.hoisted(() => ({ current: null as any }));
vi.mock('../../runtime/workspace', () => ({ useMistWorkspace: () => bridge.current }));
vi.mock('../../runtime/auth', () => { const useMistSession = () => ({ user: { id: 'demo-buyer', displayName: '沈禾' }, hasPermission: () => true, hasRole: () => false, canAccessView: () => true }); return { useMistSession, useOptionalMistSession: useMistSession }; });
let host: HTMLDivElement, root: Root | undefined, state: MistState; const go = vi.fn();
const named = (n: string) => state.market.suppliers.find(s => s.name === n)!;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; go.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  let n = 0; const ctx: MistContext = { id: () => `s-test-${++n}`, actorName: '演示', now: '2026-10-14T02:00:00.000Z' };
  state = createMistState(ctx, 'demo');
  bridge.current = { state, run: vi.fn(async () => ({ result: { id: 'saved' } })), error: '', refresh: vi.fn(), loading: false, saving: false, pending: null, upload: vi.fn() };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.useRealTimers(); });
async function mount(id?: string, detail?: 'full') { host = document.createElement('div'); document.body.append(host); root = createRoot(host); const Page = MARKET_PAGES.suppliers; await act(async () => root!.render(<Nav.Provider value={{ route: { view: 'suppliers', id, detail }, go, theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn(), openAI: vi.fn() }}><Page /></Nav.Provider>)); }
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => b!.click()); }

describe('供应商管理', () => {
  it('switches a service provider form to service details and submits no factory capacity',async()=>{
    await mount();await click('新增供应商');
    const type=getByRole(document.body,'combobox',{name:'供应商类型'});
    await act(async()=>fireEvent.change(type,{target:{value:'服务商'}}));
    expect(queryByRole(document.body,'spinbutton',{name:'月产能'})).toBeNull();
    expect(queryByRole(document.body,'textbox',{name:'产能单位'})).toBeNull();
    expect(queryByRole(document.body,'textbox',{name:'工艺与生产能力'})).toBeNull();
    for(const [name,value] of [['名称','浦江物流'],['经营地址','上海'],['服务内容','出口货运及报关']]){
      await act(async()=>fireEvent.change(getByRole(document.body,'textbox',{name,exact:true}),{target:{value}}));
    }
    await click('保存');
    expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.supplier.save',payload:expect.objectContaining({input:expect.objectContaining({type:'服务商',address:'上海',capabilities:'出口货运及报关',capacity:0,capacityUnit:'',leadDays:0})})}));
  });
  it('shows service details and contacts without manufacturing KPIs or a production RFQ action',async()=>{
    const row={...named('华盛毛纺'),id:'service',code:'LOG-001',name:'浦江物流',type:'服务商',capabilities:'出口货运及报关',capacity:0,capacityUnit:'',leadDays:0,certificates:[],ratings:[]};state.market.suppliers.push(row);
    await mount(row.id,'full');const detail=host.querySelector('[data-supplier-detail]')!;
    expect(detail.textContent).toContain('经营地址');expect(detail.textContent).toContain('服务内容');expect(detail.textContent).toContain('主联系人');
    for(const text of ['月产能','准交率','通常交付周期','来料无退货'])expect(detail.textContent).not.toContain(text);
    expect(button('询价比价')).toBeUndefined();expect(button('编辑档案')).toBeTruthy();
    expect(button('登记认证')).toBeTruthy();
  });

  it('交付表现与提醒由采购、到货与认证记录推出', () => {
    const huasheng = supplierPerformance(state, named('华盛毛纺').id);
    expect(huasheng.completed.length).toBe(1); expect(huasheng.onTime).toBe(1); expect(huasheng.open.length).toBe(1);
    expect(huasheng.receipts).toBe(1); expect(huasheng.clean).toBe(0);
    expect(supplierFlags(named('华盛毛纺'), '2026-10-14').map(f => f.label)).toContain('认证 30 天内到期');
    expect(supplierFlags(named('江南成衣'), '2026-10-14').map(f => f.key)).toContain('certExpired');
    expect(supplierFlags(named('远山服装'), '2026-10-14').map(f => f.key)).toEqual(['noCert', 'unrated']);
  });
  it('列表显示评级、认证提醒、在手单与暂停状态', async () => {
    await mount();
    const list = host.querySelector('[aria-label="供应商列表"]')!;
    expect(list.textContent).toContain('恒彩印花'); expect(list.textContent).toContain('已暂停');
    expect(list.textContent).toContain('已过期 5 天'); expect(list.textContent).toContain('20 天后到期');
    expect(list.textContent).toContain('100%');
  });
  it('列表预览只给摘要，打开供应商档案进入完整详情并可返回原列表', async () => {
    const id = named('江南成衣').id; await mount(id);
    const preview = host.querySelector('aside.mist-preview')!;
    expect(preview.textContent).toContain('江南成衣'); expect(preview.querySelector('[data-supplier-detail]')).toBeNull(); expect(preview.textContent).not.toContain('评级历史');
    await click('打开供应商档案'); expect(go).toHaveBeenLastCalledWith('suppliers', id, { detail: 'full' });
    root!.unmount(); host.remove(); await mount(id, 'full');
    expect(host.querySelector('[data-list-detail-page] [data-supplier-detail]')).not.toBeNull(); expect(host.querySelector('[role="row"]')).toBeNull();
    await click('返回供应商管理'); expect(go).toHaveBeenLastCalledWith('suppliers', id, {}, { keepScroll: true });
  });
  it('认证过期的供应商：详情提示、认证有效期、评级历史；询价比价带供应商进入采购询价', async () => {
    await mount(named('江南成衣').id, 'full');
    const detail = host.querySelector('[data-supplier-detail]')!;
    expect(detail.textContent).toContain('有认证已过期');
    expect(host.querySelector('[data-supplier-certs]')!.textContent).toMatch(/BSCI.*已过期 5 天.*ISO 9001/);
    expect(detail.textContent).toMatch(/A · 2026 Q3.*B · 2026 Q2/);
    await click('询价比价');
    expect(go).toHaveBeenLastCalledWith('procurement', undefined, { section: 'rfq:' + named('江南成衣').id });
  });
  it('已暂停的供应商显示原因与生效日，只能恢复合作', async () => {
    await mount(named('恒彩印花').id, 'full');
    const detail = host.querySelector('[data-supplier-detail]')!;
    expect(detail.textContent).toContain('已暂停 · 2026-10-14 起');
    expect(detail.textContent).toContain('色牢度两批不达标');
    expect(button('恢复合作')).toBeTruthy(); expect(button('暂停合作')).toBeUndefined();
    expect(button('询价比价')!.disabled).toBe(true); expect(detail.textContent).toContain('供应商当前不可合作，不能邀请报价');
  });
  it('暂停前列出在手业务，说明继续执行与如何转给其他供应商', async () => {
    await mount(named('华盛毛纺').id, 'full');
    const lining = state.fulfillment.purchases.find(p => p.description.includes('里布'))!;
    expect(host.querySelector('[data-supplier-detail]')!.textContent).toContain(lining.code);
    await click('暂停合作');
    expect(document.body.textContent).toContain(`在手业务 1 单（${lining.code}）不受影响`);
    expect(document.body.textContent).toContain('转给其他供应商”（仅限已批准、尚未收货的合同');
    expect(bridge.current.run).not.toHaveBeenCalled();
  });
});

it.each(['成衣加工','服务商'])('creates %s with only name and type and no manual code field',async type=>{
 await mount();await click('新增供应商');
 expect(queryByRole(document.body,'textbox',{name:'供应商编码'})).toBeNull();
 await act(async()=>fireEvent.change(getByRole(document.body,'textbox',{name:'名称',exact:true}),{target:{value:'新供应商'}}));
 await act(async()=>fireEvent.change(getByRole(document.body,'combobox',{name:'供应商类型'}),{target:{value:type}}));
 await click('保存');
 expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.supplier.save',payload:expect.objectContaining({input:expect.objectContaining({name:'新供应商',type,capabilities:'',capacity:0,capacityUnit:'',leadDays:0})})}));
 expect(bridge.current.run.mock.calls[0][0].payload.input.code).toBeUndefined();
});
