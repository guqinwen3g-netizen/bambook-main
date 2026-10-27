// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog, Field, MistRoot, TextInput } from './index';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
function render(node: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  act(() => root.render(node)); cleanups.push(() => { act(() => root.unmount()); host.remove(); }); return host;
}
function click(element: Element) { act(() => (element as HTMLElement).click()); }
function key(element: EventTarget, value: string) { act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }
afterEach(() => { cleanups.splice(0).reverse().forEach(clean => clean()); document.body.replaceChildren(); vi.restoreAllMocks(); });

it('selects a valid date through a themed calendar while keeping the native change contract', () => {
  const changed = vi.fn();
  function Example() { const [date, setDate] = React.useState('2026-02-14'); return <MistRoot><Field label="交期"><TextInput aria-label="交期" type="date" min="2026-02-01" max="2026-02-28" value={date} onChange={event => { changed(event.target.value); setDate(event.target.value); }} /></Field></MistRoot>; }
  const host = render(<Example />), input = host.querySelector<HTMLInputElement>('input[type="date"]')!;
  click(host.querySelector('[aria-label="选择日期"]')!);
  const picker = host.querySelector<HTMLElement>('[data-mist-date-picker]')!;
  expect(picker.closest('.mist-root')).not.toBeNull();
  click(picker.querySelector('[aria-label="2026-02-28"]')!);
  expect(changed).toHaveBeenCalledExactlyOnceWith('2026-02-28');
  expect(input.value).toBe('2026-02-28'); expect(host.querySelector('[data-mist-date-picker]')).toBeNull();
});

it('does not invent a time when selecting an empty date-time', () => {
  const changed = vi.fn();
  function Example() { const [value, setValue] = React.useState(''); return <MistRoot><TextInput aria-label="离港时间" type="datetime-local" value={value} onChange={event => { changed(event.target.value); setValue(event.target.value); }} /></MistRoot>; }
  const host = render(<Example />); click(host.querySelector('[aria-label="选择日期"]')!);
  const picker = host.querySelector<HTMLElement>('[data-mist-date-picker]')!;
  click(picker.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)')!);
  expect(changed).not.toHaveBeenCalled(); expect(picker.querySelector<HTMLButtonElement>('[data-date-apply]')?.disabled).toBe(true);
});

it('closes the calendar before its parent dialog on Escape', () => {
  const close = vi.fn();
  const host = render(<MistRoot><Dialog open onClose={close} title="日期"><TextInput aria-label="交期" type="date" value="2026-02-14" onChange={() => {}} /></Dialog></MistRoot>);
  click(host.querySelector('[aria-label="选择日期"]')!);
  const picker = host.querySelector<HTMLElement>('[data-mist-date-picker]')!;
  key(picker.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)')!, 'Escape');
  expect(close).not.toHaveBeenCalled(); expect(host.querySelector('[data-mist-date-picker]')).toBeNull();
});

it('moves between days with arrow keys and returns Tab to the next dialog field', () => {
  const host = render(<MistRoot><Dialog open onClose={() => {}} title="日期"><TextInput aria-label="交期" type="date" value="2026-02-14" onChange={() => {}} /><input aria-label="下一个字段" /></Dialog></MistRoot>);
  click(host.querySelector('[aria-label="选择日期"]')!);
  const picker = host.querySelector<HTMLElement>('[data-mist-date-picker]')!, current = picker.querySelector<HTMLButtonElement>('[aria-label="2026-02-14"]')!;
  key(current, 'ArrowRight'); expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-02-15');
  const clear = Array.from(picker.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '清除')!;
  act(() => clear.focus()); key(clear, 'Tab'); expect(document.activeElement).toBe(host.querySelector('[aria-label="下一个字段"]')); expect(host.querySelector('[data-mist-date-picker]')).toBeNull();
});

it('can clear an existing optional date without inventing another value', () => {
  const changed = vi.fn();
  function Example() { const [value, setValue] = React.useState('2026-02-14'); return <MistRoot><TextInput aria-label="交期" type="date" value={value} onChange={event => { changed(event.target.value); setValue(event.target.value); }} /></MistRoot>; }
  const host = render(<Example />); click(host.querySelector('[aria-label="选择日期"]')!);
  const clear = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '清除')!; click(clear);
  expect(changed).toHaveBeenCalledExactlyOnceWith(''); expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('');
});

it('keeps the month value format when selecting a month', () => {
  const changed = vi.fn();
  function Example() { const [value, setValue] = React.useState('2026-02'); return <MistRoot><TextInput aria-label="月份" type="month" value={value} onChange={event => { changed(event.target.value); setValue(event.target.value); }} /></MistRoot>; }
  const host = render(<Example />); click(host.querySelector('[aria-label="选择月份"]')!);
  click(host.querySelector('[data-month="2026-03"]')!);
  expect(changed).toHaveBeenCalledExactlyOnceWith('2026-03');
  expect(host.querySelector<HTMLInputElement>('input[type="month"]')?.value).toBe('2026-03');
});

it('requires an explicit valid time before applying a time-only value', () => {
  const changed = vi.fn();
  function Example() { const [value, setValue] = React.useState(''); return <MistRoot><TextInput aria-label="安排时间" type="time" value={value} onChange={event => { changed(event.target.value); setValue(event.target.value); }} /></MistRoot>; }
  const host = render(<Example />); click(host.querySelector('[aria-label="选择时间"]')!);
  const picker = host.querySelector<HTMLElement>('[data-mist-date-picker]')!, apply = picker.querySelector<HTMLButtonElement>('[data-date-apply]')!;
  expect(apply.disabled).toBe(true); expect(changed).not.toHaveBeenCalled();
  const time = picker.querySelector<HTMLInputElement>('input[aria-label="时间"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(time, '09:30'); time.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(apply.disabled).toBe(false); click(apply);
  expect(changed).toHaveBeenCalledExactlyOnceWith('09:30');
});
