// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog, MistRoot, TextInput } from './index';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
function render(node: React.ReactNode) { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); act(() => root.render(node)); cleanups.push(() => { act(() => root.unmount()); host.remove(); }); return host; }
function key(target: EventTarget, value: string) { act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }
afterEach(() => { cleanups.splice(0).reverse().forEach(clean => clean()); document.body.replaceChildren(); });

it('shows themed suggestions and writes a selected value through the input change handler', () => {
  const changed = vi.fn();
  function Example() { const [value, setValue] = React.useState(''); return <MistRoot><TextInput aria-label="收件人" list="contacts" value={value} onChange={event => { changed(event.target.value); setValue(event.target.value); }} /><datalist id="contacts"><option value="person@example.test">联系人</option></datalist></MistRoot>; }
  const host = render(<Example />), input = host.querySelector<HTMLInputElement>('input')!;
  act(() => input.focus());
  expect(input.hasAttribute('list')).toBe(false);
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  key(input, 'ArrowDown'); key(input, 'Enter');
  expect(changed).toHaveBeenCalledExactlyOnceWith('person@example.test'); expect(input.value).toBe('person@example.test');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('closes suggestions on Escape without closing their parent dialog', () => {
  const close = vi.fn();
  const host = render(<MistRoot><Dialog open title="联系人" onClose={close}><TextInput aria-label="人员" list="people" /><datalist id="people"><option value="甲" /></datalist></Dialog></MistRoot>);
  const input = host.querySelector<HTMLInputElement>('input')!;
  act(() => input.focus()); expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  key(input, 'Escape'); expect(close).not.toHaveBeenCalled(); expect(host.querySelector('[role="listbox"]')).toBeNull();
});
