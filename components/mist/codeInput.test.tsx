// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeInput } from './index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; });

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [value, setValue] = React.useState('');
  return <CodeInput value={value} onChange={setValue} onComplete={onComplete} />;
}
async function render(onComplete = vi.fn()) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Harness onComplete={onComplete} />));
  return { boxes: [...host.querySelectorAll('input')] as HTMLInputElement[], onComplete };
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

it('renders six labelled boxes and moves focus forward as digits are typed', async () => {
  const { boxes } = await render();
  expect(boxes).toHaveLength(6);
  expect(boxes[2].getAttribute('aria-label')).toBe('验证码第 3 位');
  await type(boxes[0], '4');
  expect(boxes[0].value).toBe('4');
  expect(document.activeElement).toBe(boxes[1]);
});

it('ignores letters and completes when a whole code is pasted', async () => {
  const { boxes, onComplete } = await render();
  await type(boxes[0], 'x');
  expect(boxes[0].value).toBe('');
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as any;
  paste.clipboardData = { getData: () => '38 14 06' };
  await act(async () => boxes[0].dispatchEvent(paste));
  expect(boxes.map(b => b.value).join('')).toBe('381406');
  expect(onComplete).toHaveBeenCalledWith('381406');
});

it('steps back with Backspace from an empty box', async () => {
  const { boxes } = await render();
  await type(boxes[0], '12');
  expect(document.activeElement).toBe(boxes[2]);
  await act(async () => boxes[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })));
  expect(boxes.map(b => b.value).join('')).toBe('1');
  expect(document.activeElement).toBe(boxes[1]);
});
