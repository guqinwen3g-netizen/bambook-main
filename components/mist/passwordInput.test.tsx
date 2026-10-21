// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { Field, PasswordInput } from './index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; });
async function render(element: React.ReactNode) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(element));
  return { input: host.querySelector('input')!, toggle: host.querySelector('button.mist-input-reveal') as HTMLButtonElement };
}

it('toggles between hidden and visible text with an accessible button', async () => {
  const { input, toggle } = await render(<Field label="密码"><PasswordInput aria-label="密码" defaultValue="secret" /></Field>);
  expect(input.type).toBe('password');
  expect(toggle.getAttribute('aria-label')).toBe('显示密码');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  await act(async () => toggle.click());
  expect(input.type).toBe('text');
  expect(toggle.getAttribute('aria-label')).toBe('隐藏密码');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  await act(async () => toggle.click());
  expect(input.type).toBe('password');
  expect(input.value).toBe('secret');
});

it('keeps focus in the field when the toggle is pressed', async () => {
  const { input, toggle } = await render(<PasswordInput aria-label="密码" />);
  input.focus();
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  toggle.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
});

it('disables the toggle with the field', async () => {
  const { input, toggle } = await render(<PasswordInput aria-label="密码" disabled />);
  expect(input.disabled).toBe(true);
  expect(toggle.disabled).toBe(true);
});
