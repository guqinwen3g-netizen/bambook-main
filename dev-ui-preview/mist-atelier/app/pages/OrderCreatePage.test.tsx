// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getAllByLabelText, getByLabelText, getByRole, getByText } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../components/mist';
import { applyMistCommand, createMistState, type MistState } from '../../../../server/src/shared/mistWorkspace';
import { Nav } from '../nav';
const store = vi.hoisted(() => ({ state: null as MistState | null, loading: false, error: '', workspace:{id:'a',ownerId:'sales'} as {id:string;ownerId?:string}, run: vi.fn() }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => store }));
vi.mock('../runtime/auth', () => { const useMistSession = () => ({ status: 'authenticated', sessionKey: 's', user: { id: 'sales', displayName: '业务员甲' }, hasPermission: () => true }); return { useMistSession, useOptionalMistSession: useMistSession }; });
import { OrderCreatePage } from './OrderCreatePage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root;
const go = vi.fn();
let sequence = 0;
const context = { id: () => `amount-${++sequence}`, now: '2026-10-13T02:00:00.000Z', actorName: '业务员甲', actorId: 'sales' };
function input(label: string, value: string) {
  const node = getByLabelText(host, new RegExp(`^${label}\\s*\\*?$`)) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
  if (node instanceof HTMLSelectElement) return choose(node, label, value);
  act(() => { Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
/** 常用选项下拉：有该选项直接选；没有时走「其他（手动填写）」再录入原文。 */
function choose(node: HTMLSelectElement, label: string, value: string) {
  const has = (option: string) => Array.from(node.options).some(item => item.value === option), preset = has(value);
  if (!preset && !has('__custom__')) throw new Error(`${label} 没有选项 ${value}`);
  act(() => { node.value = preset ? value : '__custom__'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  if (!preset) input(`${label}（手动填写）`, value);
}
async function next() { await act(async () => getByRole(host, 'button', { name: '下一步' }).click()); }
async function enterLine(qty: string, price: string) {
  input('季节 / 批次', 'AW28'); await next();
  input('品名', '精确金额条目'); input('款号 / 品号', 'ROUND-01'); input('数量', qty); input('单价 USD', price);
}
function amount(label: string) { return getByText(host, label, { selector: 'dt' }).nextElementSibling?.textContent; }
beforeEach(() => {
  sequence = 0; store.workspace={id:'a',ownerId:'sales'}; store.state = createMistState(context, 'empty');
  store.state.customers.push({ id: 'customer-a', code: 'C-A', name: '客户甲', country: '', city: '', industry: '', owner: '业务员甲', grade: 'A', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '2026-01-01' });
  store.run.mockReset(); go.mockReset();
  store.run.mockImplementation(async command => {
    const result = applyMistCommand(store.state!, command, context); store.state = result.state;
    return { requestId: 'request-a', revision: 2, result: result.result };
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<MistRoot><ToastProvider><Nav.Provider value={{ route: { view: 'orders/new', customerId: 'customer-a' }, go, openAI: vi.fn(), theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn() }}><OrderCreatePage /></Nav.Provider></ToastProvider></MistRoot>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('shows the same half-cent rounded line and total as the server through submission', async () => {
  await enterLine('1.005', '1'); await next(); input('交期', '2026-10-30'); await next();
  expect(amount('订单总金额')).toBe('1.01 USD');
  expect(amount('ROUND-01 · 精确金额条目')).toBe('1.005 件 × 1.00 = 1.01 USD');
  await next(); expect(amount('总金额')).toBe('1.01 USD');
  await act(async () => getByRole(host, 'button', { name: '创建订单草稿' }).click());
  expect(store.state!.orders[0].amount).toBe(1.01);
  expect(store.run).toHaveBeenCalledOnce(); expect(go).toHaveBeenCalledWith('orders/detail', store.state!.orders[0].id,{customerId:'customer-a',section:'garment'});
});

it('rounds each line before accumulating the total in cents', async () => {
  await enterLine('1.005', '1');
  await act(async () => getByRole(host, 'button', { name: '添加条目' }).click());
  const fields = (label: string) => getAllByLabelText(host, new RegExp(`^${label}\\s*\\*?$`)) as HTMLInputElement[];
  for (const [label, value] of [['品名', '第二个条目'], ['款号 / 品号', 'ROUND-02'], ['数量', '1.005'], ['单价 USD', '1']]) {
    const node = fields(label)[1];
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  await next(); input('交期', '2026-10-30'); await next();
  expect(amount('订单总金额')).toBe('2.02 USD');
});

it.each([
  ['1.00001', '1', '数量最多支持四位小数'],
  ['1', '1.001', '金额须为最多两位小数的非负数'],
  ['999999999', '999999999999.99', '条目金额超出支持范围'],
])('keeps invalid precision or range editable without a render exception (%s × %s)', async (qty, price, message) => {
  await enterLine(qty, price); await next();
  expect(host.textContent).toContain(message);
  expect((getByLabelText(host, /^数量/) as HTMLInputElement).value).toBe(qty);
  expect(store.run).not.toHaveBeenCalled();
  input('数量', '1.005'); input('单价 USD', '1'); await next();
  expect(getByLabelText(host, /^交期/)).toBeTruthy();
});
it('preserves entered units and quantities when the business type is changed',async()=>{await enterLine('5','2');await act(async()=>getByRole(host,'button',{name:'上一步'}).click());const select=getByRole(host,'combobox',{name:'订单类型'}) as HTMLSelectElement;act(()=>{select.value='fabric';select.dispatchEvent(new Event('change',{bubbles:true}));});await next();expect((getByLabelText(host,/^单位/) as HTMLInputElement).value).toBe('件');expect((getByLabelText(host,/^数量/) as HTMLInputElement).value).toBe('5');});
it('does not navigate from an old create acknowledgement after switching workspaces',async()=>{await enterLine('1','2');await next();input('交期','2026-10-30');await next();await next();let finish!:(value:unknown)=>void;store.run.mockReturnValue(new Promise(resolve=>finish=resolve));await act(async()=>getByRole(host,'button',{name:'创建订单草稿'}).click());store.workspace={id:'b'};act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'orders/new',customerId:'customer-a'},go,openAI:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn()}}><OrderCreatePage/></Nav.Provider></ToastProvider></MistRoot>));await act(async()=>finish({result:{id:'old-order'}}));expect(go).not.toHaveBeenCalled();expect(getByRole(host,'button',{name:'下一步'})).toBeTruthy();expect((getByLabelText(host,/^季节/) as HTMLInputElement).value).toBe('');});

it('creates only a governed draft and preserves uploaded customer contract evidence',async()=>{
  (store as any).uploadFile=vi.fn(async(file:File)=>{const stored={id:'customer-po',name:file.name,mimeType:file.type,size:file.size,storageKey:'workspace/customer-po',createdAt:context.now};store.state!.files.push(stored);return stored;});
  input('PO / 合同号','PO-2026-10');await enterLine('10','10');await next();input('交期','2026-12-01');input('付款条款','T/T 30% 定金，70% 发货前付清');input('定金比例（%）','30');input('贸易术语','FOB');input('指定地点 / 港口','上海');
  await act(async()=>{const picker=host.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(picker,'files',{value:[new File(['confirmed purchase order'],'customer-po.pdf',{type:'application/pdf'})],configurable:true});picker.dispatchEvent(new Event('change',{bubbles:true}));});
  await next();await next();await act(async()=>getByRole(host,'button',{name:'创建订单草稿'}).click());
  expect(store.state!.orders[0].governance).toMatchObject({status:'draft',contract:{kind:'external',poNumber:'PO-2026-10',confirmationFileIds:['customer-po'],paymentMethod:'TT',depositPercent:30,paymentNote:'T/T 30% 定金，70% 发货前付清',incoterm:'FOB',deliveryPlace:'上海'}});expect(store.state!.orders[0].state).toBe('订单草稿');
});


it('submits the chosen garment mode and the explicit CMT scope from real controls',async()=>{
  await enterLine('10','20');const mode=getByRole(host,'combobox',{name:'履约模式'}) as HTMLSelectElement;
  expect(mode.value).toBe('');await act(async()=>{mode.value='full_package';mode.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>getByRole(host,'checkbox',{name:'包装'}).click());
  await next();input('交期','2026-10-30');await next();await next();
  expect(host.textContent).toContain('全包 · CMT 包含：包装');await act(async()=>getByRole(host,'button',{name:'创建订单草稿'}).click());
  expect(store.run.mock.calls[0][0].payload.lines[0]).toMatchObject({fulfillmentMode:'full_package',cmtIncludedItems:['packaging']});
  expect(store.state!.orderLines[0]).toMatchObject({fulfillmentMode:'full_package',cmtIncludedItems:['packaging']});
});

it('selects the receiving garment member by account ID for an internal fabric order',async()=>{
  store.state!.members=[{userId:'garment-owner',name:'成衣负责人',addedBy:'sales',addedByName:'业务员甲',addedAt:context.now},{userId:'fabric-other',name:'面料成员',addedBy:'sales',addedByName:'业务员甲',addedAt:context.now}];
  store.state!.memberGroups=[{userId:'garment-owner',name:'成衣负责人',groups:['garment'],updatedAt:context.now,updatedBy:'sales'},{userId:'fabric-other',name:'面料成员',groups:['fabric'],updatedAt:context.now,updatedBy:'sales'}];
  const select=async(name:string,value:string)=>{const node=getByRole(host,'combobox',{name}) as HTMLSelectElement;await act(async()=>{node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));});};
  await select('订单类型','fabric');await select('订单用途','internal');await act(async()=>getByRole(host,'checkbox',{name:'供给成衣订单'}).click());
  const receiver=getByRole(host,'combobox',{name:'成衣接收负责人'});expect(receiver.textContent).toContain('成衣负责人');expect(receiver.textContent).toContain('面料成员');
  await select('成衣接收负责人','garment-owner');input('内部用途','成衣用料');await enterLine('100','20');await next();expect(host.textContent).toContain('交接约定');expect(host.textContent).not.toContain('定金比例');input('交期','2026-10-30');await next();await next();
  store.run.mockResolvedValue({result:{orderId:'internal-fabric'}});await act(async()=>getByRole(host,'button',{name:'创建订单草稿'}).click());
  expect(store.run.mock.calls[0][0].payload.governance).toMatchObject({kind:'internal',paymentMethod:'OTHER',depositPercent:0,preShipmentPercent:0,internalSupply:{group:'garment',receiverId:'garment-owner'}});
  expect(store.run.mock.calls[0][0].payload.lines[0]).not.toHaveProperty('fulfillmentMode');
});

it('captures TT cumulative pre-shipment payment in creation and review without default teaching notes',async()=>{
 await enterLine('100','69.8');await next();input('交期','2026-11-20');input('定金比例（%）','30');input('出运前累计收款（%）','100');expect(host.textContent).not.toContain('未填表示尚未配置');expect(host.textContent).not.toContain('可以先保存草稿');await next();await next();expect(amount('出运前累计收款')).toBe('100%');await act(async()=>getByRole(host,'button',{name:'创建订单草稿'}).click());expect(store.run).toHaveBeenCalledWith(expect.objectContaining({type:'order.create',payload:expect.objectContaining({governance:expect.objectContaining({depositPercent:30,preShipmentPercent:100})})}));
});

it('blocks a frozen customer before entering products and allows choosing another active customer',async()=>{
 const state=store.state!;state.market.relations.push({id:'held-customer',name:'客户甲',customerId:'customer-a',supplierId:'',hold:{reason:'逾期款待财务核对，不应成为创建页教学说明',actor:'主管',at:context.now}} as any);state.customers.push({...state.customers[0],id:'customer-b',name:'客户乙'});act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'orders/new',customerId:'customer-a'},go,openAI:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn()}}><OrderCreatePage/></Nav.Provider></ToastProvider></MistRoot>));
 input('季节 / 批次','AW27');expect(host.textContent).toContain('客户往来已冻结');expect(host.textContent).not.toContain('创建页教学说明');expect((getByRole(host,'button',{name:'下一步'}) as HTMLButtonElement).disabled).toBe(true);await next();expect(store.run).not.toHaveBeenCalled();
 const customer=getByRole(host,'combobox',{name:/^客户/}) as HTMLSelectElement;act(()=>{customer.value='customer-b';customer.dispatchEvent(new Event('change',{bubbles:true}));});expect((getByRole(host,'button',{name:'下一步'}) as HTMLButtonElement).disabled).toBe(false);await next();expect(getByLabelText(host,/^品名/)).toBeTruthy();expect(store.run).not.toHaveBeenCalled();
});
it('blocks a newly frozen customer at final review without discarding the draft or sending a create command',async()=>{
 await enterLine('10','42');await next();input('交期','2026-11-30');await next();await next();
 const paint=()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'orders/new',customerId:'customer-a'},go,openAI:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn()}}><OrderCreatePage/></Nav.Provider></ToastProvider></MistRoot>);
 store.state!.market.relations.push({id:'held-at-review',name:'客户甲',customerId:'customer-a',supplierId:'',hold:{reason:'暂停新增',actor:'主管',at:context.now}} as any);act(paint);expect((getByRole(host,'button',{name:'创建订单草稿'}) as HTMLButtonElement).disabled).toBe(true);expect(amount('总金额')).toBe('420.00 USD');await act(async()=>getByRole(host,'button',{name:'创建订单草稿'}).click());expect(store.run).not.toHaveBeenCalled();
 store.state!.market.relations=[];act(paint);expect((getByRole(host,'button',{name:'创建订单草稿'}) as HTMLButtonElement).disabled).toBe(false);expect(amount('总金额')).toBe('420.00 USD');expect(store.run).not.toHaveBeenCalled();
});

it('keeps cleared quantity and price blank while editing, and replaces the initial zero', async () => {
  input('季节 / 批次', 'AW28'); await next();
  const quantity = getByLabelText(host, /^数量/) as HTMLInputElement;
  const price = getByLabelText(host, /^单价 USD/) as HTMLInputElement;
  input('数量', ''); input('单价 USD', '');
  expect(quantity.value).toBe(''); expect(price.value).toBe('');
  input('数量', '025'); input('单价 USD', '012.50');
  expect(quantity.value).toBe('25'); expect(price.value).toBe('12.50');
  input('单价 USD', '0.05'); expect(price.value).toBe('0.05');
});
