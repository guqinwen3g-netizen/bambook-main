// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {CustomerPage} from './CustomerPage';
import {Nav} from '../nav';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
const bridge=vi.hoisted(()=>({current:null as any,canCreate:true,canAdmin:true,canCredit:true,localMode:true}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>bridge.current}));
vi.mock('../runtime/auth', () => { const useMistSession = ()=>({user:{id:'local',displayName:'本地操作员'},localMode:bridge.localMode,hasPermission:(scope:string)=>scope==='relations:admin'?bridge.canAdmin:scope==='risk:admin'?bridge.canCredit:scope.endsWith(':read')||bridge.canCreate,canAccessView:()=>true}); return { useMistSession, useOptionalMistSession: useMistSession }; });
let host:HTMLDivElement,root:Root|undefined;const go=vi.fn(),openAI=vi.fn();
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;go.mockReset();openAI.mockReset();bridge.canCreate=true;bridge.canAdmin=true;bridge.canCredit=true;bridge.localMode=true;const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T08:00:00Z',actorName:'本地操作员'},'empty');bridge.current={state,workspace:{id:'w',ownerId:'local',revision:0,state},loading:false,saving:false,pending:null,pendingCreate:null,error:'',run:vi.fn(async()=>({requestId:'saved',revision:1,result:{id:'created-customer',customerId:'created-customer'}})),refresh:vi.fn(),downloadFile:vi.fn()};});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();});
async function mount(id?:string){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Nav.Provider value={{route:{view:'crm',id},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI}}><CustomerPage/></Nav.Provider>));}
async function click(label:string){await act(async()=>getByRole(host,'button',{name:label}).click());}
async function fill(label:string,value:string){const element=host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement|HTMLSelectElement;expect(element,label).toBeTruthy();await act(async()=>{const proto=element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));});}
async function complete(){await click('新建客户');await fill('客户名称','新客户贸易公司');await fill('国家','中国');await fill('城市','上海');await click('下一步');await fill('付款条款','T/T 30% 定金，70% 发货前付清');await fill('贸易术语','FOB');await fill('贸易术语指定地点','上海');await fill('合作起始日','2026-10-13');await click('下一步');await fill('信用额度（结算币种）','1000');await click('下一步');}
const customer=(id:string)=>({id,code:'CUS-'+id,name:'客户-'+id,country:'CN',city:'上海',industry:'服装',owner:'本地操作员',grade:'A',currency:'USD',terms:'T/T',incoterm:'FOB',categories:'成衣',creditLimit:0,since:'2026-10-13'});
describe('Mist customer creation and selection',()=>{
 it('offers first-customer creation from an empty workspace and navigates by the saved customer ID',async()=>{await mount();expect(host.textContent).toContain('还没有客户档案');await complete();await click('创建客户档案');expect(bridge.current.run).toHaveBeenCalledWith({type:'market.customer.create',payload:{input:expect.objectContaining({name:'新客户贸易公司',ownerId:'local',currency:'USD',country:'中国',city:'上海',terms:'T/T 30% 定金，70% 发货前付清',incoterm:'FOB 上海',since:'2026-10-13',creditLimit:1000})}});expect(go).toHaveBeenCalledWith('crm','created-customer',{customerId:'created-customer'});});
 it('keeps the new customer form and entered values after a failed save',async()=>{bridge.current.run.mockRejectedValueOnce(new Error('本地保存失败'));await mount();await complete();await click('创建客户档案');expect(host.textContent).toContain('本地保存失败');expect(go).not.toHaveBeenCalled();await click('上一步');expect((host.querySelector('[aria-label="信用额度（结算币种）"]') as HTMLInputElement).value).toBe('1000');await click('上一步');expect((host.querySelector('[aria-label="贸易术语"]') as HTMLSelectElement).value).toBe('FOB');expect((host.querySelector('[aria-label="贸易术语指定地点"]') as HTMLSelectElement).value).toBe('上海');await click('上一步');expect((host.querySelector('[aria-label="客户名称"]') as HTMLInputElement).value).toBe('新客户贸易公司');});
 it('preserves the T7 detail layout and selects an exact different customer',async()=>{bridge.current.state.customers=[customer('a'),customer('b')];await mount('a');expect(host.querySelector('.mist-detail[data-layout="main-rail"]')).not.toBeNull();expect(host.textContent).toContain('客户-a');await fill('选择客户','b');expect(go).toHaveBeenCalledWith('crm','b',{customerId:'b'});expect(bridge.current.run).not.toHaveBeenCalled();});
 it('does not silently substitute the first customer for a missing requested ID',async()=>{bridge.current.state.customers=[customer('a')];await mount('deleted');expect(host.textContent).toContain('没有找到指定客户');expect(host.querySelector('.mist-detail')).toBeNull();expect(queryByRole(host,'button',{name:'新建客户'})).not.toBeNull();});
 it('hides creation without customer-write permission',async()=>{bridge.canCreate=false;await mount();expect(queryByRole(host,'button',{name:'新建客户'})).toBeNull();expect(bridge.current.run).not.toHaveBeenCalled();});
});

describe('CRM relation and contact command routing',()=>{
 it('preserves a primary contact and keeps the dialog open after a failed synchronized save',async()=>{
  bridge.current.state.customers=[customer('a')];bridge.current.state.contacts=[{id:'contact-a',customerId:'a',name:'采购甲',role:'采购',email:'old@example.com',phone:'123',tone:'neutral'}];bridge.current.state.market.relations=[{id:'relation-a',customerId:'a',supplierId:'',category:'Customer',name:'客户-a',country:'CN',address:'',aliases:[],status:'active',contacts:[{id:'contact-a',name:'采购甲',role:'采购',email:'old@example.com',phone:'123',primary:true}],fileIds:[],note:'',createdAt:'',updatedAt:''}];bridge.current.run.mockRejectedValueOnce(new Error('联系人未同步'));
  await mount('a');const contact=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.includes('采购甲'))!;await act(async()=>contact.click());const dialog=getByRole(document.body,'dialog',{name:'编辑联系人'}),email=dialog.querySelector<HTMLInputElement>('input[type="email"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(email,'new@example.com');email.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>getByRole(dialog,'button',{name:'保存',exact:true} as any).click());
  expect(bridge.current.run).toHaveBeenCalledWith({type:'market.contact.save',payload:expect.objectContaining({kind:'customer',parentId:'a',id:'contact-a',email:'new@example.com',primary:true})},{expectedRevision:0});expect(dialog.textContent).toContain('联系人未同步');expect(email.value).toBe('new@example.com');
 });
});

describe('truthful customer utility actions',()=>{
 it('disables mail without an address and tells the user it uses the local mail application',async()=>{
  bridge.current.state.customers=[customer('a')];await mount('a');const button=getByRole(host,'button',{name:'写邮件'}) as HTMLButtonElement;expect(button.disabled).toBe(true);expect(button.title).toContain('有效邮箱');
 });
 it('opens insights with the actual current customer facts and counts business events accurately',async()=>{
  bridge.current.state.customers=[customer('a')];bridge.current.state.events=[{id:'event-a',entityType:'customer',entityId:'a',actor:'业务员',at:new Date().toISOString(),text:'更新客户资料',fileIds:[]},{id:'old-event',entityType:'customer',entityId:'a',actor:'业务员',at:'2020-01-01T00:00:00Z',text:'历史动态',fileIds:[]}];await mount('a');await click('展开');expect(openAI).toHaveBeenCalledWith(expect.stringContaining('0 个在途订单，0 个开发案'));
  await act(async()=>getByRole(host,'button',{name:'业务动态统计'}).click());const dialog=getByRole(document.body,'dialog',{name:'业务动态统计'});expect(dialog.textContent).toContain('全部业务动态');expect(dialog.textContent).toContain('最近 30 天业务动态');expect(dialog.textContent).toContain('2');expect(dialog.textContent).toContain('1');
 });
});

describe('customer default currency',()=>{
 it('uses the workspace currency only for a new customer',async()=>{
  bridge.current.state.settings.companyProfile={defaultCurrency:'JPY'};await mount();await click('新建客户');await fill('客户名称','日本客户');await click('下一步');expect((host.querySelector('[aria-label="结算币种"]') as HTMLSelectElement).value).toBe('JPY');
 });
 it('keeps an existing customer currency when workspace currency differs',async()=>{
  bridge.current.state.settings.companyProfile={defaultCurrency:'CNY'};bridge.current.state.customers=[{...customer('a'),currency:'JPY'}];await mount('a');await act(async()=>getByRole(host,'button',{name:'编辑客户资料'}).click());const dialog=getByRole(document.body,'dialog',{name:'编辑客户资料'});expect((dialog.querySelector('select[aria-label="结算币种"]') as HTMLSelectElement|null)?.value).toBe('JPY');
 });
});

it('keeps customer and contact details read-only without write access',async()=>{bridge.canCreate=false;bridge.current.state.customers=[customer('a')];bridge.current.state.contacts=[{id:'contact-read',customerId:'a',name:'客户联系人',role:'采购',email:'contact@example.invalid',phone:'123'}];await mount('a');expect(queryByRole(host,'button',{name:'编辑客户资料'})).toBeNull();expect(queryByRole(host,'button',{name:'添加联系人'})).toBeNull();expect(queryByRole(host,'button',{name:'新建开发案'})).toBeNull();const contact=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('客户联系人'))!;await act(async()=>contact.click());const dialog=getByRole(document.body,'dialog',{name:'联系人'});expect(queryByRole(dialog,'button',{name:'保存'})).toBeNull();expect(queryByRole(dialog,'button',{name:'删除'})).toBeNull();expect([...dialog.querySelectorAll<HTMLInputElement>('input')].every(input=>input.readOnly)).toBe(true);expect(bridge.current.run).not.toHaveBeenCalled();});

it('keeps the customer owner selector disabled without customer-management permission',async()=>{bridge.canAdmin=false;bridge.localMode=false;bridge.current.state.customers=[{...customer('a'),ownerId:'local'}];await mount('a');await click('编辑客户资料');const dialog=getByRole(document.body,'dialog',{name:'编辑客户资料'});expect((getByRole(dialog,'combobox',{name:'客户经理'}) as HTMLSelectElement).disabled).toBe(true);});

it('keeps another customer archive readable without offering maintenance to a salesperson',async()=>{bridge.canAdmin=false;bridge.localMode=false;bridge.current.state.customers=[{...customer('a'),ownerId:'another'}];await mount('a');expect(host.textContent).toContain('客户-a');expect(queryByRole(host,'button',{name:'编辑客户资料'})).toBeNull();expect(queryByRole(host,'button',{name:'添加联系人'})).toBeNull();});

it('uses the server customer-maintenance scope for a department manager',async()=>{bridge.localMode=false;bridge.current.workspace.access={role:'member',canManageMembers:false,hidden:[],manageableCustomerIds:[]};bridge.current.state.customers=[{...customer('a'),ownerId:'another'}];await mount('a');expect(queryByRole(host,'button',{name:'编辑客户资料'})).toBeNull();});

async function rerenderCustomer(id:string){await act(async()=>root!.render(<Nav.Provider value={{route:{view:'crm',id},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI}}><CustomerPage/></Nav.Provider>));}
const occurrences=(text:string)=>document.body.textContent?.split(text).length!-1;
it('owns a confirmed profile failure only in the active drawer and clears it on close',async()=>{
  bridge.current.state.customers=[customer('a')];bridge.current.dismissError=vi.fn();bridge.current.run.mockRejectedValueOnce(new Error('信用额度校验失败'));
  await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});
  await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());
  expect(bridge.current.dismissError).toHaveBeenCalledWith('信用额度校验失败');expect(occurrences('信用额度校验失败')).toBe(1);
  await act(async()=>getByRole(d,'button',{name:'关闭',exact:true}).click());expect(occurrences('信用额度校验失败')).toBe(0);
});
it('preserves pending acknowledgement recovery instead of dismissing its original error',async()=>{
  bridge.current.state.customers=[customer('a')];bridge.current.dismissError=vi.fn();
  bridge.current.run.mockImplementationOnce(async()=>{bridge.current.pending={kind:'command',requestId:'original',workspaceId:'w'};throw Object.assign(new Error('回执尚未确认'),{mistPendingCommand:bridge.current.pending});});
  await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());
  expect(bridge.current.dismissError).not.toHaveBeenCalled();expect(bridge.current.pending.requestId).toBe('original');expect(queryByRole(document.body,'dialog',{name:'编辑客户资料'})).not.toBeNull();
});
it('does not let an old customer rejection clear the next customer error',async()=>{
  bridge.current.state.customers=[customer('a'),customer('b')];bridge.current.dismissError=vi.fn();let reject!:(error:Error)=>void;
  bridge.current.run.mockReturnValueOnce(new Promise((_yes,no)=>reject=no));await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());
  await rerenderCustomer('b');bridge.current.error='新客户当前错误';await act(async()=>reject(new Error('原客户迟到失败')));
  expect(bridge.current.dismissError).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('资料未保存');expect(bridge.current.error).toBe('新客户当前错误');expect(document.body.textContent).not.toContain('原客户迟到失败');
});
it('keeps a contact deletion failure inside its active confirmation rather than under the overlay',async()=>{
  bridge.current.state.customers=[customer('a')];bridge.current.state.contacts=[{id:'contact-a',customerId:'a',name:'采购甲',role:'采购',email:'a@example.invalid',phone:'123',tone:'neutral'}];bridge.current.dismissError=vi.fn();bridge.current.run.mockRejectedValueOnce(new Error('联系人已变化'));
  await mount('a');const contact=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.includes('采购甲'))!;await act(async()=>contact.click());
  const drawer=getByRole(document.body,'dialog',{name:'编辑联系人'});await act(async()=>getByRole(drawer,'button',{name:'删除',exact:true}).click());const d=getByRole(document.body,'dialog',{name:'删除联系人？'});await act(async()=>getByRole(d,'button',{name:'删除联系人',exact:true}).click());
  expect(d.textContent).toContain('联系人已变化');expect(occurrences('联系人已变化')).toBe(1);expect(bridge.current.dismissError).toHaveBeenCalledWith('联系人已变化');
});

it('rejects a synchronized credit change instead of carrying the old whole customer profile into a newer revision',async()=>{
  bridge.current.state.customers=[customer('a')];await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});
  const next={...bridge.current.state,customers:[{...customer('a'),creditLimit:12500.5,city:'Manchester'}]};bridge.current={...bridge.current,state:next,workspace:{id:'w',ownerId:'local',revision:1,state:next}};await rerenderCustomer('a');
  const city=getByRole(d,'textbox',{name:'城市',exact:true})as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(city,'York');city.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());expect(bridge.current.run).not.toHaveBeenCalled();expect(d.textContent).toContain('客户资料已更新');expect(city.value).toBe('York');expect(bridge.current.state.customers[0].creditLimit).toBe(12500.5);
});
it('saves through an unrelated refresh using the exact checked workspace revision',async()=>{
  bridge.current.state.customers=[customer('a')];await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});
  const next={...bridge.current.state,events:[{id:'unrelated',entityId:'another',text:'无关动态'}]};bridge.current={...bridge.current,state:next,workspace:{id:'w',ownerId:'local',revision:2,state:next}};await rerenderCustomer('a');
  await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.customer.update',payload:expect.objectContaining({id:'a',patch:expect.objectContaining({creditLimit:0})})}),{expectedRevision:2});
});

function contactFixture(){bridge.current.state.customers=[customer('a')];bridge.current.state.contacts=[{id:'contact-a',customerId:'a',name:'采购甲',role:'采购',email:'a@example.invalid',phone:'111',tone:'neutral'}];bridge.current.state.market.relations=[{id:'relation-a',customerId:'a',contacts:[{id:'contact-a',name:'采购甲',role:'采购',email:'a@example.invalid',phone:'111',primary:true}]}];}
async function openContact(){const b=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.includes('采购甲'))!;await act(async()=>b.click());return getByRole(document.body,'dialog',{name:'编辑联系人'});}
it.each(['phone','primary'])('rejects a synchronized contact %s change without overwriting the peer source',async key=>{
  contactFixture();await mount('a');const d=await openContact(),next=structuredClone(bridge.current.state);
  if(key==='phone'){next.contacts[0].phone='222';next.market.relations[0].contacts[0].phone='222';}else next.market.relations[0].contacts[0].primary=false;
  bridge.current={...bridge.current,state:next,workspace:{id:'w',ownerId:'local',revision:1,state:next}};await rerenderCustomer('a');
  await act(async()=>getByRole(d,'button',{name:'保存',exact:true}).click());expect(bridge.current.run).not.toHaveBeenCalled();expect(d.textContent).toContain('联系人资料已更新');
});
it('does not delete a contact whose source changed while its drawer was open',async()=>{
  contactFixture();await mount('a');const drawer=await openContact(),next=structuredClone(bridge.current.state);next.contacts[0].phone='222';next.market.relations[0].contacts[0].phone='222';bridge.current={...bridge.current,state:next,workspace:{id:'w',ownerId:'local',revision:1,state:next}};await rerenderCustomer('a');
  await act(async()=>getByRole(drawer,'button',{name:'删除',exact:true}).click());const d=getByRole(document.body,'dialog',{name:'删除联系人？'});await act(async()=>getByRole(d,'button',{name:'删除联系人',exact:true}).click());expect(bridge.current.run).not.toHaveBeenCalled();expect(d.textContent).toContain('联系人资料已更新');
});
it('keeps a late contact failure out of the next workspace',async()=>{
  contactFixture();bridge.current.dismissError=vi.fn();let reject!:(error:Error)=>void;bridge.current.run.mockReturnValueOnce(new Promise((_yes,no)=>reject=no));await mount('a');const d=await openContact();await act(async()=>getByRole(d,'button',{name:'保存',exact:true}).click());
  bridge.current.workspace={id:'other',ownerId:'local',revision:0,state:bridge.current.state};await rerenderCustomer('a');bridge.current.error='新公司错误';await act(async()=>reject(new Error('旧联系人失败')));
  expect(bridge.current.dismissError).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('旧联系人失败');expect(bridge.current.error).toBe('新公司错误');
});
it('owns a confirmed rejection even when rendered pending has not caught up with the cleared durable intent',async()=>{
  bridge.current.state.customers=[customer('a')];bridge.current.dismissError=vi.fn();
  bridge.current.run.mockImplementationOnce(async()=>{bridge.current.pending={kind:'command',requestId:'transient',workspaceId:'w'};await rerenderCustomer('a');bridge.current.pending=null;throw new Error('已确认拒绝');});
  await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());expect(bridge.current.dismissError).toHaveBeenCalledWith('已确认拒绝');expect(occurrences('已确认拒绝')).toBe(1);
});
it('reveals a new drawer failure in its own scroll area',async()=>{
  const prior=HTMLElement.prototype.scrollIntoView,scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
  try{bridge.current.state.customers=[customer('a')];bridge.current.dismissError=vi.fn();bridge.current.run.mockRejectedValueOnce(new Error('滚入当前抽屉'));
    await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());expect(scroll).toHaveBeenCalledWith({block:'nearest'});expect(scroll.mock.instances.some(node=>d.contains(node)&&node.textContent?.includes('滚入当前抽屉'))).toBe(true);
  }finally{if(prior)HTMLElement.prototype.scrollIntoView=prior;else delete(HTMLElement.prototype as any).scrollIntoView;}
});

it('keeps grade, positive credit and its denomination read-only for an ordinary owner while saving normal fields',async()=>{
  bridge.canAdmin=false;bridge.canCredit=false;bridge.localMode=false;bridge.current.state.customers=[{...customer('a'),ownerId:'local',creditLimit:1000}];await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});
  expect((getByRole(d,'combobox',{name:'等级',exact:true})as HTMLSelectElement).disabled).toBe(true);expect((getByRole(d,'spinbutton',{name:'信用额度（结算币种）',exact:true})as HTMLInputElement).readOnly).toBe(true);expect((getByRole(d,'combobox',{name:'结算币种',exact:true})as HTMLSelectElement).disabled).toBe(true);
  await act(async()=>getByRole(d,'button',{name:'保存资料'}).click());expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.customer.update',payload:expect.objectContaining({patch:expect.objectContaining({grade:'A',creditLimit:1000,currency:'USD'})})}),{expectedRevision:0});
});
it('does not expose initial grade or credit grants on the ordinary creation wizard',async()=>{
  bridge.canAdmin=false;bridge.canCredit=false;bridge.localMode=false;await mount();await click('新建客户');await fill('客户名称','Unrated customer');
  for(let n=0;n<4&&queryByRole(host,'button',{name:'下一步',exact:true});n++){expect(host.querySelector('[aria-label="等级"]')).toBeNull();expect(host.querySelector('[aria-label="信用额度（结算币种）"]')).toBeNull();await click('下一步');}
  await click('创建客户档案');expect(bridge.current.run).toHaveBeenCalledWith(expect.objectContaining({type:'market.customer.create',payload:{input:expect.objectContaining({grade:'',creditLimit:0})}}));
});
it('allows a grade manager to rate without exposing credit grant controls',async()=>{
  bridge.canAdmin=true;bridge.canCredit=false;bridge.localMode=false;bridge.current.state.customers=[{...customer('a'),ownerId:'local',creditLimit:1000}];await mount('a');await click('编辑客户资料');const d=getByRole(document.body,'dialog',{name:'编辑客户资料'});expect((getByRole(d,'combobox',{name:'等级',exact:true})as HTMLSelectElement).disabled).toBe(false);expect((getByRole(d,'spinbutton',{name:'信用额度（结算币种）',exact:true})as HTMLInputElement).readOnly).toBe(true);
});
