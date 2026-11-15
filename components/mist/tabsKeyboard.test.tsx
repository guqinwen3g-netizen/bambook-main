// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tabs } from './primitives';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const options = [{ value: 'orders', label: '订单' }, { value: 'payments', label: '付款' }, { value: 'history', label: '历史' }];
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const key = async (button: HTMLElement, value: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
  await act(async () => button.dispatchEvent(event)); return event;
};

it('keeps a single sequential tab stop and focuses the selected entry when the list is re-entered', async () => {
  await act(async () => root.render(<><Tabs options={options} value="payments" onChange={() => {}} /><input aria-label="搜索" /></>));
  expect(buttons().map(b => b.tabIndex)).toEqual([-1, 0, -1]);
  await act(async () => buttons()[1].focus()); await key(buttons()[1], 'ArrowLeft');
  expect(document.activeElement).toBe(buttons()[0]); expect(buttons().map(b => b.tabIndex)).toEqual([0, -1, -1]);
  await act(async () => host.querySelector('input')!.focus());
  expect(buttons().map(b => b.tabIndex)).toEqual([-1, 0, -1]);
});

it('moves and wraps focus with arrows/Home/End without selecting or running the page action', async () => {
  const change = vi.fn(); await act(async () => root.render(<Tabs options={options} value="orders" onChange={change} />));
  await act(async () => buttons()[0].focus());
  for (const [press, next] of [['ArrowRight', 1], ['End', 2], ['ArrowRight', 0], ['ArrowLeft', 2], ['Home', 0]] as const) {
    expect((await key(document.activeElement as HTMLElement, press)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons()[next]); expect(buttons().filter(b => b.tabIndex === 0)).toEqual([buttons()[next]]);
    expect(buttons().map(b => b.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  }
  expect(change).not.toHaveBeenCalled();
  // Native buttons retain Enter/Space activation; browser acceptance covers those real default actions.
  await act(async () => buttons()[2].click()); expect(change.mock.calls).toEqual([['history']]);
});

it('does not steal focus on controlled page changes and derives a valid stop when options change', async () => {
  const change = vi.fn();
  const paint = async (value: string, items = options) => act(async () => root.render(<><Tabs options={items} value={value} onChange={change} /><input aria-label="搜索" /></>));
  await paint('orders'); const input = host.querySelector('input')!; await act(async () => input.focus());
  await paint('history'); expect(document.activeElement).toBe(input); expect(buttons().map(b => b.tabIndex)).toEqual([-1, -1, 0]);
  await paint('history', [options[1], options[0]]); expect(buttons().map(b => b.tabIndex)).toEqual([0, -1]); expect(change).not.toHaveBeenCalled();
});

it('leaves vertical scrolling, modifier shortcuts and other keys to the browser', async () => {
  const change = vi.fn(); await act(async () => root.render(<Tabs options={options} value="orders" onChange={change} />));
  await act(async () => buttons()[0].focus());
  for (const value of ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Tab']) expect((await key(buttons()[0], value)).defaultPrevented).toBe(false);
  expect((await key(buttons()[0], 'ArrowRight', { ctrlKey: true })).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(buttons()[0]); expect(change).not.toHaveBeenCalled();
});
