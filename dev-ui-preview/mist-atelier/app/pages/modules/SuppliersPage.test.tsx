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
  bridge.current = { state, workspace:{id:'workspace',revision:7}, run: vi.fn(async () => ({ result: { id: 'saved' } })), error: '', refresh: vi.fn(), loading: false, saving: false, pending: null, upload: vi.fn() };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.useRealTimers(); });
async function mount(id?: string, detail?: 'full') { host = document.createElement('div'); document.body.append(host); root = createRoot(host); const Page = MARKET_PAGES.suppliers; await act(async () => root!.render(<Nav.Provider value={{ route: { view: 'suppliers', id, detail }, go, theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn(), openAI: vi.fn() }}><Page /></Nav.Provider>)); }
const button = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => b!.click()); }
async function repaint(id:string){const Page=MARKET_PAGES.suppliers;await act(async()=>root!.render(<Nav.Provider value={{route:{view:'suppliers',id,detail:'full'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><Page/></Nav.Provider>));}
async function fillProfile(label:string,value:string){const input=document.querySelector(`[role="dialog"] [aria-label="${label}"]`)as HTMLInputElement|HTMLTextAreaElement;expect(input).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}

it.each(['name','type','country','address','capabilities','capacity','capacityUnit','leadDays','note','handlers','removed'])('refuses stale supplier profile fields and keeps input: %s',async field=>{
 const supplier=state.market.suppliers[0];await mount(supplier.id,'full');await click('编辑档案');await fillProfile('备注','我的补充');const patch=field==='handlers'?{handlers:{fabric:{id:'peer',name:'同事'}}}:field==='capacity'||field==='leadDays'?{[field]:999}:field==='type'?{type:'服务商'}:{[field]:'同事更新'};
 state={...state,market:{...state.market,suppliers:field==='removed'?state.market.suppliers.filter(s=>s.id!==supplier.id):state.market.suppliers.map(s=>s.id===supplier.id?{...s,...patch}:s)}}as MistState;bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:8}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('供应商档案已更新，请重新打开后核对');expect((document.querySelector('[aria-label="备注"]')as HTMLTextAreaElement).value).toBe('我的补充');
});
it('keeps newer attachments and non-profile records while binding the checked revision',async()=>{
 const supplier=state.market.suppliers[0];await mount(supplier.id,'full');await click('编辑档案');await fillProfile('备注','我的补充');const current={...supplier,fileIds:['peer-file'],contacts:[...supplier.contacts,{id:'peer-contact',name:'同事',role:'',email:'',phone:'',primary:false}],ratings:[...(supplier.ratings||[]),{id:'peer-rating',grade:'B' as const,period:'本季',note:'履约记录',at:'2026-10-14T03:00:00Z',actor:'主管'}]};state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?current:s)}};bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:9}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.supplier.save',payload:expect.objectContaining({input:expect.objectContaining({note:'我的补充',fileIds:['peer-file']})})}),{expectedRevision:9});
});
it.each(['workspace','unread','revision'])('does not submit a supplier draft after source availability changes: %s',async kind=>{
 const supplier=state.market.suppliers[0];await mount(supplier.id,'full');await click('编辑档案');await fillProfile('备注','保留输入');bridge.current={...bridge.current,state:kind==='unread'?null:state,workspace:{id:kind==='workspace'?'another':'workspace',revision:kind==='revision'?undefined:8}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

async function editContact(supplier:typeof state.market.suppliers[number]){await mount(supplier.id,'full');const row=[...document.querySelectorAll('.mist-quote-line')].find(e=>e.textContent?.includes(supplier.contacts[0].name)&&[...e.querySelectorAll('button')].some(b=>b.textContent==='编辑'))!;await act(async()=>[...row.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='编辑')!.click());await fillProfile('岗位','我的岗位补充');}
it.each(['name','role','email','phone','primary','removed'])('refuses stale supplier contact data without losing input: %s',async field=>{
 const supplier=state.market.suppliers.find(s=>s.contacts.length)!,contact=supplier.contacts[0];await editContact(supplier);const contacts=field==='removed'?supplier.contacts.filter(c=>c.id!==contact.id):supplier.contacts.map(c=>c.id===contact.id?{...c,[field]:field==='primary'?!contact.primary:'同事更新'}:c);state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,contacts}:s)}}as MistState;bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:8}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('联系人资料已更新，请重新打开后核对');expect((document.querySelector('[aria-label="岗位"]')as HTMLInputElement).value).toBe('我的岗位补充');
});
it('does not delete a supplier contact updated after confirmation opened',async()=>{
 const supplier=state.market.suppliers.find(s=>s.contacts.length)!,contact=supplier.contacts[0];await mount(supplier.id,'full');const row=[...document.querySelectorAll('.mist-quote-line')].find(e=>e.textContent?.includes(contact.name)&&[...e.querySelectorAll('button')].some(b=>b.textContent==='删除'))!;await act(async()=>[...row.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='删除')!.click());state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,contacts:s.contacts.map(c=>c.id===contact.id?{...c,phone:'0001'}:c)}:s)}};bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:8}};await repaint(supplier.id);await act(async()=>getByRole(getByRole(document.body,'dialog'),'button',{name:'删除',exact:true}).click());expect(bridge.current.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('联系人资料已更新，请重新打开后核对');
});
it('allows unrelated supplier profile changes while using the checked revision for contact edits',async()=>{
 const supplier=state.market.suppliers.find(s=>s.contacts.length)!;await editContact(supplier);state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,address:'同事新地址'}:s)}};bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:9}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.contact.save',payload:expect.objectContaining({kind:'supplier',parentId:supplier.id,role:'我的岗位补充'})}),{expectedRevision:9});
});
it('does not replace a primary contact newly assigned by a colleague from an older form',async()=>{
 const supplier=state.market.suppliers.find(s=>s.contacts.length)!,first={...supplier.contacts[0],primary:false},second={...first,id:'second-contact',name:'其他联系人'};supplier.contacts=[first,second];await editContact(supplier);await act(async()=>getByRole(document.body,'checkbox',{name:'主联系人'}).click());state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,contacts:s.contacts.map(c=>c.id===second.id?{...c,primary:true}:c)}:s)}};bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:8}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('主联系人已更新，请重新打开后核对');
});

async function openCertificate(supplier:typeof state.market.suppliers[number],label='更新'){await mount(supplier.id,'full');const cert=supplier.certificates![0],row=[...document.querySelectorAll('[data-supplier-certs] [role="listitem"]')].find(e=>e.textContent?.includes(cert.name))!;await act(async()=>[...row.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!.click());return cert;}
it.each(['name','number','issuer','validUntil','fileIds','removed'])('refuses changed supplier certification source: %s',async field=>{
 const supplier=state.market.suppliers.find(s=>s.certificates?.length)!,cert=await openCertificate(supplier);await fillProfile('证书编号','我的补充编号');state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,certificates:field==='removed'?s.certificates!.filter(c=>c.id!==cert.id):s.certificates!.map(c=>c.id===cert.id?{...c,[field]:field==='fileIds'?['peer-file']:field==='validUntil'?'2028-12-31':'同事更新'}:c)}:s)}}as MistState;bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:8}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('认证资料已更新，请重新打开后核对');expect((document.querySelector('[aria-label="证书编号"]')as HTMLInputElement).value).toBe('我的补充编号');
});
it('refuses deleting a certification updated after its confirmation opened',async()=>{
 const supplier=state.market.suppliers.find(s=>s.certificates?.length)!,cert=await openCertificate(supplier,'删除');state={...state,market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,certificates:s.certificates!.map(c=>c.id===cert.id?{...c,issuer:'同事机构'}:c)}:s)}};bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:8}};await repaint(supplier.id);await act(async()=>getByRole(getByRole(document.body,'dialog'),'button',{name:'删除',exact:true}).click());expect(bridge.current.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('认证资料已更新，请重新打开后核对');
});
it('allows profile/contact refresh and a newly uploaded file while binding certification to the checked revision',async()=>{
 const supplier=state.market.suppliers.find(s=>s.certificates?.length)!;await openCertificate(supplier);await fillProfile('证书编号','我的补充编号');state={...state,files:[...state.files,{id:'new-upload',name:'证据.pdf',size:1,mimeType:'application/pdf',storageKey:'new-upload',createdAt:'2026-10-14T03:00:00Z'}],market:{...state.market,suppliers:state.market.suppliers.map(s=>s.id===supplier.id?{...s,address:'同事新地址'}:s)}};bridge.current={...bridge.current,state,workspace:{id:'workspace',revision:9}};await repaint(supplier.id);await click('保存');expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.supplier.certificate.save',payload:expect.objectContaining({supplierId:supplier.id,number:'我的补充编号'})}),{expectedRevision:9});
});

describe('供应商管理', () => {
  it('excludes a confirmed final short closure from open work while preserving original quantity and delivery KPIs', async () => {
    const supplier = named('华盛毛纺'), po = supplierPerformance(state, supplier.id).open[0];
    po.state = 'approved';
    const before = supplierPerformance(state, supplier.id), originalQuantity = po.quantity;
    state.payables.settlements.push({ id: 'final-short', purchaseId: po.id, final: true, state: 'confirmed' } as any);
    const after = supplierPerformance(state, supplier.id);
    expect(after.open.some(p => p.id === po.id)).toBe(false);
    expect(after.completed).toEqual(before.completed);
    expect(after.onTime).toBe(before.onTime);
    expect(po.quantity).toBe(originalQuantity);
    await mount(supplier.id, 'full');
    expect(queryByRole(document.body, 'list', { name: '在手采购单' })).toBeNull();
    const closed = getByRole(document.body, 'list', { name: '短交结案采购单' });
    expect(closed.textContent).toContain(po.code);
    expect(closed.textContent).toContain('短交结案');
    expect(closed.textContent).toContain(String(originalQuantity));
    await act(async () => fireEvent.click(getByRole(closed, 'button', { name: '打开', exact: true })));
    expect(go).toHaveBeenCalledWith('procurement', po.id);
  });
  it.each(['pending', 'returned', 'cancelled', 'reversed'] as const)('does not close supplier work for a %s final settlement', status => {
    const supplier = named('华盛毛纺'), po = supplierPerformance(state, supplier.id).open[0];
    state.payables.settlements.push({ id: 'not-final-confirmed', purchaseId: po.id, final: true, state: status } as any);
    expect(supplierPerformance(state, supplier.id).open.some(p => p.id === po.id)).toBe(true);
  });
  it('keeps partial confirmed settlements and other suppliers from closing an open purchase', () => {
    const supplier = named('华盛毛纺'), po = supplierPerformance(state, supplier.id).open[0];
    state.payables.settlements.push({ id: 'partial-confirmed', purchaseId: po.id, final: false, state: 'confirmed' } as any,
      { id: 'different-purchase', purchaseId: 'other-po', final: true, state: 'confirmed' } as any);
    expect(supplierPerformance(state, supplier.id).open.some(p => p.id === po.id)).toBe(true);
  });

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
    expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.supplier.save',payload:expect.objectContaining({input:expect.objectContaining({type:'服务商',address:'上海',capabilities:'出口货运及报关',capacity:0,capacityUnit:'',leadDays:0})})}), {expectedRevision:7});
  });
  it('shows service details and contacts without manufacturing KPIs or a production RFQ action',async()=>{
    const row={...named('华盛毛纺'),id:'service',code:'LOG-001',name:'浦江物流',type:'服务商',capabilities:'出口货运及报关',capacity:0,capacityUnit:'',leadDays:0,certificates:[],ratings:[]};state.market.suppliers.push(row);
    await mount(row.id,'full');const detail=host.querySelector('[data-supplier-detail]')!;
    expect(detail.textContent).toContain('经营地址');expect(detail.textContent).toContain('服务内容');expect(detail.textContent).toContain('主联系人');
    for(const text of ['月产能','准交率','通常交付周期','来料无退货'])expect(detail.textContent).not.toContain(text);
    expect(button('询价比价')).toBeUndefined();expect(button('编辑档案')).toBeTruthy();
    expect(button('登记认证')).toBeTruthy();
  });

  it('shows the open payable balance in currency units, not minor units', async () => {
    const row = named('华盛毛纺');
    (state as any).payables = { ...((state as any).payables || {}), bills: [{ id: 'bill-x', code: 'AP-X', supplierId: row.id, supplier: row.name, invoiceNo: 'INV-1', invoiceDate: '2026-10-01', currency: 'CNY', amount: 1860, taxAmount: 0, taxRate: '', lines: [], terms: [], due: '2026-12-31', dueBasis: '', fileIds: [], note: '', state: 'open', registeredAt: '2026-10-01T00:00:00Z', registeredBy: '林舒' }], payments: (state as any).payables?.payments || [], allocations: (state as any).payables?.allocations || [] };
    await mount(row.id, 'full');
    const detail = host.querySelector('[data-supplier-detail]')!;
    expect(detail.textContent).toContain('未付 1,860.00');
    expect(detail.textContent).not.toContain('未付 18.6');
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
 expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.supplier.save',payload:expect.objectContaining({input:expect.objectContaining({name:'新供应商',type,capabilities:'',capacity:0,capacityUnit:'',leadDays:0})})}), {expectedRevision:7});
 expect(bridge.current.run.mock.calls[0][0].payload.input.code).toBeUndefined();
});
