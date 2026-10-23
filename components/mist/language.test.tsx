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
