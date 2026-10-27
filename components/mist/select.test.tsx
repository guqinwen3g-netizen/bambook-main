// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog, Field, MistRoot, Select } from './index';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
function render(node: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  act(() => root.render(node)); cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
function key(target: EventTarget, value: string, shiftKey = false) { act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))); }
function pointer(target: Element) { act(() => target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))); }
afterEach(() => { cleanups.splice(0).reverse().forEach(clean => clean()); document.body.replaceChildren(); vi.restoreAllMocks(); });

it('opens a themed option list and updates the existing select change contract', () => {
  const changed = vi.fn();
  function Example() {
    const [value, setValue] = React.useState('a');
    return <MistRoot theme="dark"><Field label="币种"><Select aria-label="币种" value={value} options={[{ value: 'a', label: '人民币' }, { value: 'b', label: '美元' }]} onChange={event => { changed(event.target.value); setValue(event.target.value); }} /></Field></MistRoot>;
  }
  const host = render(<Example />), select = host.querySelector('select')!;
  pointer(select);
  const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.closest('.mist-root')?.getAttribute('data-theme')).toBe('dark');
  expect(select.getAttribute('aria-expanded')).toBe('true');
  const options = list.querySelectorAll<HTMLElement>('[role="option"]');
  act(() => options[1].click());
  expect(changed).toHaveBeenCalledExactlyOnceWith('b');
  expect(select.value).toBe('b');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(select);
});

it('keeps Escape inside the menu and Tab moves to the next field in a dialog', () => {
  const close = vi.fn();
  const host = render(<MistRoot><Dialog open onClose={close} title="筛选"><Select aria-label="状态" value="a" options={['a', 'b']} onChange={() => {}} /><input aria-label="下一字段" /></Dialog></MistRoot>);
  const select = host.querySelector('select')!;
  key(select, 'ArrowDown');
  expect(document.activeElement?.getAttribute('role')).toBe('option');
  key(document.activeElement!, 'Escape');
  expect(close).not.toHaveBeenCalled(); expect(document.activeElement).toBe(select);
  key(select, 'ArrowDown'); key(document.activeElement!, 'Tab');
  expect(document.activeElement).toBe(host.querySelector('[aria-label="下一字段"]'));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('does not open a disabled select and preserves native form validation', () => {
  const host = render(<MistRoot><form><Select aria-label="选择" disabled required placeholder="请选择" options={['a']} /></form></MistRoot>);
  const select = host.querySelector('select')!;
  pointer(select); expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(select.required).toBe(true); expect(select.disabled).toBe(true);
});

it('aligns the menu to the outer input width rather than the inset select', () => {
  const host = render(<MistRoot><Select aria-label="币种" value="a" options={['a', 'b']} onChange={() => {}} /></MistRoot>);
  const select = host.querySelector('select')!, outer = select.closest<HTMLElement>('.mist-input')!;
  vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue({ left: 120, top: 80, right: 440, bottom: 122, width: 320, height: 42, x: 120, y: 80, toJSON: () => ({}) });
  pointer(select);
  const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.style.left).toBe('120px'); expect(list.style.width).toBe('320px');
});
