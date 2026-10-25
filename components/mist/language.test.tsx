// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSetting } from './LanguageSetting';
import { readDevice, writeDevice } from '../../dev-ui-preview/mist-atelier/app/runtime/devicePreferences';
import { interfaceLocale, localizedPageTitle, ui, uiText, useInterfaceLanguage } from '../../services/interfaceLanguage';
import english from '../../services/locales/en-US.json';
import { reviewedEnglish } from '../../services/locales/en-US-reviewed';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
function Example() {
  useInterfaceLanguage();
  const [draft, setDraft] = React.useState('雾织贸易 · Original customer wording');
  return <><LanguageSetting /><h1>{uiText('订单管理')}</h1><input aria-label="Business name" value={draft} onChange={e => setDraft(e.target.value)} /><span>{draft}</span></>;
}
function mount() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<Example />)); }
function choose(value: string) { act(() => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }
beforeEach(() => { localStorage.clear(); });
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); localStorage.clear(); vi.restoreAllMocks(); });

describe('device-local interface language', () => {
  it('preserves all interpolation slots in the English catalogue', () => {
    const slots = (text: string) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
    for (const [source, translated] of Object.entries({ ...english, ...reviewedEnglish })) {
      expect(slots(translated), source).toEqual(slots(source));
    }
  });
  it('defaults to Chinese independently of the device language and rejects malformed preferences', () => {
    expect(interfaceLocale()).toBe('zh-CN');
    for (const raw of ['"de-DE"', 'true', '{', 'null']) {
      localStorage.setItem('bambook.device.locale', raw);
      expect(readDevice('locale')).toBe('zh-CN');
    }
    mount(); expect(host.querySelector('h1')?.textContent).toBe('订单管理');
  });
  it('switches immediately, persists on remount, preserves input, and never calls the server', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    mount();
    const input = host.querySelector('input')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Customer 订单管理'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    choose('en-US');
    expect(host.querySelector('h1')?.textContent).toBe('Orders');
    expect(host.textContent).toContain('Interface language');
    expect(input.value).toBe('Customer 订单管理');
    expect(document.documentElement.lang).toBe('en-US');
    expect(localStorage.getItem('bambook.device.locale')).toBe('"en-US"');
    expect(fetch).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove(); mount();
    expect(host.querySelector('h1')?.textContent).toBe('Orders');
    choose('zh-CN'); expect(host.querySelector('h1')?.textContent).toBe('订单管理');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
  it('updates another open tab from the storage event', () => {
    mount();
    act(() => { localStorage.setItem('bambook.device.locale', '"en-US"'); window.dispatchEvent(new StorageEvent('storage', { key: 'bambook.device.locale', newValue: '"en-US"' })); });
    expect(host.querySelector('h1')?.textContent).toBe('Orders');
  });
  it('offers device language first and resolves it without saving a company preference', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB']);
    const fetch = vi.spyOn(globalThis, 'fetch');
    mount();
    expect([...host.querySelectorAll('option')].map(option => option.value)).toEqual(['system', 'zh-CN', 'en-US']);
    choose('system');
    expect(readDevice('locale')).toBe('system');
    expect(interfaceLocale()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(host.querySelector('h1')?.textContent).toBe('Orders');
    expect(localStorage.getItem('bambook.device.locale')).toBe('"system"');
    expect(fetch).not.toHaveBeenCalled();
    act(() => root.unmount()); host.remove(); mount();
    expect(host.querySelector('h1')?.textContent).toBe('Orders');
  });
  it('follows device language changes while preserving an explicit choice', () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB']);
    mount(); choose('system');
    languages.mockReturnValue(['zh-TW', 'en-US']);
    act(() => window.dispatchEvent(new Event('languagechange')));
    expect(interfaceLocale()).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(host.querySelector('h1')?.textContent).toBe('订单管理');
    choose('en-US');
    act(() => window.dispatchEvent(new Event('languagechange')));
    expect(host.querySelector('h1')?.textContent).toBe('Orders');
    expect(interfaceLocale()).toBe('en-US');
  });
  it('uses English for unsupported device languages and the browser language when the list is empty', () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    writeDevice('locale', 'system');
    expect(interfaceLocale()).toBe('en-US');
    languages.mockReturnValue([]);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
    expect(interfaceLocale()).toBe('zh-CN');
  });
  it('keeps a session preference when browser storage is unavailable', () => {
    mount(); const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
    choose('en-US'); expect(host.querySelector('h1')?.textContent).toBe('Orders');
    setter.mockRestore(); act(() => writeDevice('locale', 'zh-CN'));
  });
  it('translates page titles and leaves unknown text and interpolation values intact', () => {
    writeDevice('locale', 'en-US');
    expect(localizedPageTitle('Bambook · 订单管理')).toBe('Bambook · Orders');
    expect(uiText('雾织贸易')).toBe('雾织贸易');
    expect(uiText('  订单管理  ')).toBe('  Orders  ');
    expect(ui`Company ${'雾织贸易'} / ${'订单管理'}`).toBe('Company 雾织贸易 / 订单管理');
  });
});

it('adapts new trading and handover copy while preserving record names and leaving the server untouched',()=>{
 const fetch=vi.spyOn(globalThis,'fetch');writeDevice('locale','en-US');for(const [source,expected] of [['客户往来已冻结','Customer on hold'],['解冻往来','Restore trading'],['未排数量','Unscheduled quantity'],['未开始','Not started'],['未检验','Not inspected'],['未出运','Not shipped'],['取消已退回','Cancellation declined'],['接手客户','Customer handover']])expect(uiText(source)).toBe(expected);
 expect(ui`${'Maison Lune'} · 当前负责人 ${'林澈'}`).toBe('Maison Lune · Current owner: 林澈');expect(uiText('Maison Lune · 暂停新报价和订单，出运须逐票批准。')).toBe('Maison Lune · New quotes and orders are paused; each shipment requires approval.');expect(uiText('在手业务 → 林澈')).toBe('Business handover → 林澈');expect(fetch).not.toHaveBeenCalled();writeDevice('locale','zh-CN');expect(uiText('客户往来已冻结')).toBe('客户往来已冻结');
});

it('translates order readiness labels, quantity summaries and receipts without changing the local Chinese default',()=>{
 writeDevice('locale','en-US');for(const [key,value] of [['草稿待补齐','Draft'],['作废订单','Void order'],['待核对','Pending review'],['拟发范围确认','Shipment scope confirmed'],['收货与贸易条款确认','Consignee and trade terms confirmed'],['收款条件核对','Payment terms checked']])expect(uiText(key)).toBe(value);expect(uiText('2 色 × 3 码')).toBe('2 colours × 3 sizes');expect(uiText('溢装 +0% / 短装 −0%')).toBe('Over +0% / short −0%');expect(uiText('已收 0%')).toBe('Received 0%');writeDevice('locale','zh-CN');expect(interfaceLocale()).toBe('zh-CN');
});
