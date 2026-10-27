// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMistState, applyMistCommand, type MistCommand } from '../../../../server/src/shared/mistWorkspace';
import { MistRoot, ToastProvider } from '../../../../components/mist';
const seam = vi.hoisted(() => ({ value: null as any, nav: null as any, session: { sessionKey: 'one', user: { id: 'owner', displayName: '认证姓名' }, hasRole: () => false, hasPermission: () => false, canAccessView: () => true } as any }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => seam.value }));
vi.mock('../runtime/auth', () => { const useMistSession = () => seam.session; return { useMistSession, useOptionalMistSession: useMistSession }; });
vi.mock('../nav', () => ({ useNav: () => seam.nav }));
import { SettingsPage } from './SettingsPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLElement, sequence = 0;
const ctx = () => ({ id: () => `record-${++sequence}`, now: new Date().toISOString(), actorName: '认证姓名' });
function paint() { root!.render(<MistRoot><ToastProvider><SettingsPage /></ToastProvider></MistRoot>); }
function render() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(paint); }
function button(text: string) { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); expect(found).toBeDefined(); return found!; }
async function click(item: HTMLElement) { await act(async () => item.click()); }
function input(label: string, value: string) { const field = host.querySelector<HTMLInputElement | HTMLSelectElement>(`input[aria-label="${label}"],select[aria-label="${label}"]`)!; act(() => { if (field instanceof HTMLSelectElement) { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); return; } Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); return field; }
async function blur(field: HTMLElement) { await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); }
beforeEach(() => {
  localStorage.removeItem('bambook.device.locale');
  vi.clearAllMocks(); sequence = 0; seam.nav = null; seam.session = { sessionKey: 'one', user: { id: 'owner', displayName: '认证姓名' }, hasRole: () => false, hasPermission: () => false, canAccessView: () => true } as any;
  seam.value = { state: createMistState(ctx(), 'empty'), workspace: { id: 'workspace-one', name: '第一公司',ownerId:'owner' }, loading: false, saving: false, pending: null, error: '', refresh: vi.fn(), recover: vi.fn(),archivedWorkspaces:[],refreshArchived:vi.fn().mockResolvedValue(undefined),archiveWorkspace:vi.fn().mockResolvedValue(undefined),restoreWorkspace:vi.fn().mockResolvedValue(undefined),
    run: vi.fn(async (command: MistCommand) => { seam.value.state = applyMistCommand(seam.value.state, command, ctx()).state; paint(); return { requestId: 'request', revision: 1, result: {} }; }) };
});
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; });
describe('original Mist settings with server workspace commands', () => {
  it('shows the company profile footer only in its section', async () => {
    render(); expect(button('保存公司资料')).toBeTruthy();
    await click(button('通知')); expect([...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '保存公司资料')).toBe(false);
    await click(button('公司资料')); expect(button('保存公司资料')).toBeTruthy();
  });
  it('does not expose workspace archive or switching actions in company settings',async()=>{render();expect(host.textContent).not.toContain('回收站');expect(host.textContent).not.toContain('恢复公司');expect(seam.value.archiveWorkspace).not.toHaveBeenCalled();expect(seam.value.refreshArchived).not.toHaveBeenCalled();});

  it('keeps only company sections and no personal appearance or security controls', () => {
    render(); expect(host.querySelector('.mist-wizard')).toBeTruthy();
    const labels=[...host.querySelectorAll('.mist-vsteps button')].map(item=>item.textContent);
    expect(labels).toEqual(['公司资料','数据访问','通知','设置记录']);
    expect(host.querySelector('[aria-label="界面语言"]')).toBeNull();
    expect(host.textContent).not.toContain('查看账号安全');
  });
  it('persists notification switches with the shared field names', async () => {
    render(); await click(button('通知')); const controls = host.querySelectorAll<HTMLInputElement>('input[role="switch"]');
    await click(controls[1]); expect(seam.value.run).toHaveBeenCalledWith({ type: 'settings.update', payload: { notifications: { qc: true, shipping: false, suggestions: true, digest: false } } });
    expect(host.textContent).not.toContain('不发送邮件');
  });
  it.each(['account','appearance','security'])('redirects the old %s link to personal settings without writing company data', section => {
    seam.nav={route:{section},go:vi.fn()}; render();
    expect(seam.value.run).not.toHaveBeenCalled();
    expect(seam.nav.go).toHaveBeenCalledWith('account',undefined,{section:section==='account'?'profile':section});
    expect(host.querySelector('input[aria-label="显示姓名"]')).toBeNull();
  });
  it('retains typed edits after failed persistence and resets them on workspace replacement', async () => {
    seam.value.run.mockRejectedValue(new Error('保存失败，请重试')); render(); 
    const field = input('公司显示名称', '未保存的名称'); await blur(field);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="公司显示名称"]')?.value).toBe('未保存的名称'); expect(host.textContent).toContain('保存失败，请重试');
    const state = createMistState(ctx(), 'empty'); state.settings.workspaceName = '第二公司'; seam.value = { ...seam.value, state, workspace: { id: 'workspace-two', name: '第二公司' } };
    await act(async () => paint()); expect(host.querySelector<HTMLInputElement>('input[aria-label="公司显示名称"]')?.value).toBe('第二公司'); expect(host.textContent).not.toContain('未保存的名称');
  });
  it('does not offer company deletion from security settings', async () => {render();expect(host.textContent).not.toContain('移入回收站');expect(host.textContent).not.toContain('删除公司');expect(seam.value.archiveWorkspace).not.toHaveBeenCalled();});
});

describe('workspace default currency and local-only settings',()=>{
 it('saves the currency through the complete company profile without erasing business details',async()=>{
  seam.value.state.settings.companyProfile={legalName:'公司甲',englishName:'Company A',address:'上海',englishAddress:'Shanghai',phone:'123',email:'office@example.com',taxId:'TAX',customsCode:'CUSTOMS',bankName:'银行',bankAccount:'ACCOUNT',swift:'SWIFT',defaultCurrency:'USD'};
  render();const select=host.querySelector<HTMLSelectElement>('select[aria-label="默认币种"]')!;expect(select.disabled).toBe(false);await act(async()=>{select.value='EUR';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(seam.value.run).toHaveBeenCalledWith({type:'settings.update',payload:{companyProfile:{defaultCurrency:'EUR'}}});expect(seam.value.state.settings.companyProfile).toMatchObject({legalName:'公司甲',taxId:'TAX',swift:'SWIFT'});expect(seam.value.state.settings.companyProfile.bankAccount).toBe('ACCOUNT');expect(seam.value.state.settings.companyProfile.defaultCurrency).toBe('EUR');
 });
 it('starts with USD when the optional company profile has no currency and preserves failure feedback',async()=>{
  seam.value.run.mockRejectedValueOnce(new Error('币种保存失败'));render();const select=host.querySelector<HTMLSelectElement>('select[aria-label="默认币种"]')!;expect(select.value).toBe('USD');await act(async()=>{select.value='CNY';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(host.textContent).toContain('币种保存失败');expect(seam.value.state.settings.companyProfile).toBeUndefined();
 });
 it('keeps local identity controls out of company settings',async()=>{
  seam.session={...seam.session,localMode:true} as any;render();expect(host.textContent).not.toContain('两步验证');expect(host.textContent).not.toContain('设备会话管理不适用');expect(host.textContent).not.toContain('退出所有设备');
 });
});

describe('company profile maintenance in system settings',()=>{
 const full={legalName:'示例公司',englishName:'Sample Co',address:'示例地址',englishAddress:'Sample Address',registeredAddress:'注册地址',registeredEnglishAddress:'Registered Address',phone:'000',email:'ops@example.com',taxId:'TAX-SAMPLE',customsCode:'CUS-SAMPLE',bankName:'示例银行',bankAddress:'Bank Address',bankAccount:'0000',swift:'SAMPLEXX',defaultCurrency:'USD'};
 const value=(label:string)=>host.querySelector<HTMLInputElement|HTMLSelectElement>(`input[aria-label="${label}"],select[aria-label="${label}"]`)!.value;
 const open=async()=>{render();await click(button('公司资料'));};
 it('shows an empty state, saves all twelve fields and reads them back after a fresh mount',async()=>{
  await open();expect(host.textContent).toContain('尚未填写公司资料');
  const labels:[string,string][]=[['公司中文抬头',full.legalName],['公司英文抬头',full.englishName],['中文联系地址',full.address],['英文联系地址',full.englishAddress],['中文注册地址',full.registeredAddress],['英文注册地址',full.registeredEnglishAddress],['联系电话',full.phone],['公司联系邮箱',full.email],['税务登记编号',full.taxId],['海关登记编码',full.customsCode],['收款银行名称',full.bankName],['银行地址',full.bankAddress],['收款账号',full.bankAccount],['SWIFT / BIC',full.swift],['常用结算币种','USD']];
  for(const [label,v] of labels)input(label,v);await click(button('保存公司资料'));
  expect(seam.value.run).toHaveBeenCalledWith({type:'settings.update',payload:{companyProfile:full}});expect(seam.value.state.settings.companyProfile).toEqual(full);
  act(()=>root!.unmount());host.remove();await open();for(const [label] of labels)expect(value(label)).toBe(label==='常用结算币种'?'USD':full[Object.keys(full)[labels.findIndex(x=>x[0]===label)] as keyof typeof full]);expect(host.textContent).not.toContain('尚未填写公司资料');
 });
 it('submits only the edited field so the other fields and the currency are kept',async()=>{
  seam.value.state.settings.companyProfile={...full};await open();input('联系电话','111');await click(button('保存公司资料'));
  expect(seam.value.run).toHaveBeenLastCalledWith({type:'settings.update',payload:{companyProfile:{phone:'111'}}});expect(seam.value.state.settings.companyProfile).toEqual({...full,phone:'111'});
  input('常用结算币种','EUR');await click(button('保存公司资料'));expect(seam.value.state.settings.companyProfile).toEqual({...full,phone:'111',defaultCurrency:'EUR'});
 });
 it('blocks invalid email and currency with field-level guidance before sending',async()=>{
  seam.value.state.settings.companyProfile={...full};await open();input('公司联系邮箱','not-mail');await click(button('保存公司资料'));
  expect(host.textContent).toContain('name@example.com');expect(seam.value.run).not.toHaveBeenCalled();
  const currency=host.querySelector<HTMLSelectElement>('select[aria-label="常用结算币种"]')!;expect([...currency.options].map(option=>option.value).filter(Boolean).every(code=>/^[A-Z]{3}$/.test(code))).toBe(true);expect([...currency.options].some(option=>option.value==='__custom__')).toBe(false);
 });
 it('keeps the draft after a failed save and can retry it',async()=>{
  seam.value.state.settings.companyProfile={...full};seam.value.run.mockRejectedValueOnce(new Error('网络中断'));await open();input('收款银行名称','新的示例银行');await click(button('保存公司资料'));
  expect(host.textContent).toContain('网络中断');expect(host.textContent).toContain('公司资料未保存');expect(value('收款银行名称')).toBe('新的示例银行');expect(seam.value.state.settings.companyProfile.bankName).toBe(full.bankName);
  await click(button('保存公司资料'));expect(seam.value.state.settings.companyProfile).toEqual({...full,bankName:'新的示例银行'});
 });
 it('keeps member fields read-only and gives a short recovery path for missing company details',async()=>{
  seam.value.workspace={...seam.value.workspace,access:{role:'member'}};await open();expect(host.textContent).toContain('公司资料待补全');expect(host.textContent).toContain('请联系管理员');expect(host.textContent).toContain('只读');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="公司中文抬头"]')!.disabled).toBe(true);expect([...host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='保存公司资料')).toBe(false);
 });
 it('drops an unsaved draft when the account or workspace changes',async()=>{
  seam.value.state.settings.companyProfile={...full};await open();input('公司中文抬头','未保存的抬头');
  const state=createMistState(ctx(),'empty');state.settings.companyProfile={...full,legalName:'第二空间公司'};seam.value={...seam.value,state,workspace:{id:'workspace-two',name:'第二公司'}};await act(async()=>paint());
  expect(value('公司中文抬头')).toBe('第二空间公司');expect(host.textContent).not.toContain('未保存的抬头');
  seam.session={...seam.session,sessionKey:'two',user:{id:'other',displayName:'另一账号'}} as any;seam.value={...seam.value,state:createMistState(ctx(),'empty')};await act(async()=>paint());expect(value('公司中文抬头')).toBe('');
 });
 it('opens on the company section from a quotation and returns to that quotation',async()=>{
  seam.nav={route:{view:'settings',id:'quote-1',section:'company'},go:vi.fn()};render();expect(host.querySelector('[data-company-profile]')?.closest('[hidden]')).toBeNull();
  input('公司中文抬头','示例公司');await click(button('保存公司资料'));expect(seam.value.state.settings.companyProfile.legalName).toBe('示例公司');
  await click(button('返回报价'));expect(seam.nav.go).toHaveBeenCalledWith('quotations','quote-1');
 });
});

it('puts accounts, 岗位 and company settings in one page, leaves HR to its own page and hides platform management',async()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 try{
  seam.session={...seam.session,hasPermission:(p:string)=>['users:admin','hr:read'].includes(p)} as any;seam.nav={route:{view:'admin-panel',section:'roles'},go:vi.fn()};render();
  expect([...host.querySelectorAll('.mist-vsteps button')].map(item=>item.textContent)).toEqual(['账号','岗位与权限','审批资格','公司资料','数据访问','通知','设置记录','审计日志']);
  expect(host.textContent).toContain('只读');
  expect(host.textContent).not.toContain('平台设置');expect(seam.nav.go).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
it('keeps device display choices out of the company settings history',async()=>{render();await click(button('设置记录'));expect(host.textContent).not.toContain('更新列表密度');expect(host.textContent).not.toContain('外观与语言');expect(host.textContent).not.toContain('列表密度');expect(seam.value.run).not.toHaveBeenCalled();});
