// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { IncotermPlaceInput, OptionInput } from './OptionInput';

const OPTIONS = [{ value: '月结 30 天', label: '月结 30 天' }, { value: '款到发货', label: '款到发货' }];
let root: Root, host: HTMLDivElement, value = '';
function Harness({ initial, strict }: { initial: string; strict?: boolean }) {
  const [current, setCurrent] = React.useState(initial);
  value = current;
  return <OptionInput ariaLabel="付款条件" options={OPTIONS} strict={strict} value={current} onChange={next => { value = next; setCurrent(next); }} />;
}
function Place({ initial }: { initial: string }) {
  const [current, setCurrent] = React.useState(initial);
  value = current;
  return <IncotermPlaceInput value={current} onChange={next => { value = next; setCurrent(next); }} />;
}
const render = async (node: React.ReactNode) => act(async () => root.render(node));
const select = (label: string) => host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
const input = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null;
async function choose(element: HTMLSelectElement, next: string) {
  await act(async () => { element.value = next; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function type(element: HTMLInputElement, next: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, next); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); value = ''; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('picks a preset, or switches to typing a custom value', async () => {
  await render(<Harness initial="" />);
  expect([...select('付款条件').options].map(option => option.textContent)).toEqual(['请选择', '月结 30 天', '款到发货', '其他（手动填写）']);
  await choose(select('付款条件'), '款到发货');
  expect(value).toBe('款到发货');
  expect(input('付款条件（手动填写）')).toBeNull();
  await choose(select('付款条件'), '__custom__');
  expect(value).toBe('');
  await type(input('付款条件（手动填写）')!, '验货后 15 天');
  expect(value).toBe('验货后 15 天');
  expect(select('付款条件').value).toBe('__custom__');
});

it('shows an existing non-preset value as typed text instead of clearing it', async () => {
  await render(<Harness initial="验货后 15 天" />);
  expect(select('付款条件').value).toBe('__custom__');
  expect(input('付款条件（手动填写）')!.value).toBe('验货后 15 天');
});

it('keeps an existing value in a strict list without offering custom entry', async () => {
  await render(<Harness initial="旧写法" strict />);
  const options = [...select('付款条件').options].map(option => option.value);
  expect(options).toContain('旧写法');
  expect(options).not.toContain('__custom__');
  expect(select('付款条件').value).toBe('旧写法');
});

it('combines the Incoterm code and named place into one value', async () => {
  await render(<Place initial="" />);
  await choose(select('贸易术语'), 'FOB');
  expect(value).toBe('FOB');
  await choose(select('贸易术语指定地点'), '宁波');
  expect(value).toBe('FOB 宁波');
  await choose(select('贸易术语'), 'CIF');
  expect(value).toBe('CIF 宁波');
  // C 组列目的港，宁波不在其中，按手动填写保留
  expect(select('贸易术语指定地点').value).toBe('__custom__');
});
