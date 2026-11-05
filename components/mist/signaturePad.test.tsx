// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Field, SignaturePad, signatureSvg, type SignatureValue } from './index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.useRealTimers(); });
async function render(onChange: (value: SignatureValue | null) => void, disabled = false) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Field label="批准签字"><SignaturePad onChange={onChange} disabled={disabled} /></Field>));
  const pad = host.querySelector('.mist-signature-pad') as HTMLDivElement;
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 168, right: 480, bottom: 168, x: 0, y: 0, toJSON: () => ({}) });
  return { pad, clear: host.querySelector('.mist-signature-clear') as HTMLButtonElement };
}
const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 });
async function stroke(pad: HTMLElement, points: Array<[number, number]>) {
  await act(async () => { pad.dispatchEvent(pointer('pointerdown', ...points[0])); });
  for (const [x, y] of points.slice(1)) await act(async () => { pad.dispatchEvent(pointer('pointermove', x, y)); });
  await act(async () => { pad.dispatchEvent(pointer('pointerup', ...points.at(-1)!)); });
  // Browsers follow a stroke with a click; inside a <label> it must not reach the 重签 button.
  await act(async () => { pad.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: points.at(-1)![0], clientY: points.at(-1)![1] })); });
}

it('emits an archivable SVG after each stroke and nothing before', async () => {
  const onChange = vi.fn();
  const { pad, clear } = await render(onChange);
  expect(pad.getAttribute('aria-label')).toBe('手写签字：未签');
  expect(clear.disabled).toBe(true);
  await stroke(pad, [[60, 100], [90, 80], [130, 110], [170, 70], [210, 105]]);
  const value = onChange.mock.calls.at(-1)![0] as SignatureValue;
  expect(value.strokes).toBe(1);
  expect(value.points).toBeGreaterThan(2);
  expect(value.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+" width="[\d.]+" height="[\d.]+" fill="none" stroke="#[0-9A-F]{6}"/);
  expect(onChange.mock.calls.every(call => call[0] !== null)).toBe(true);
  expect(value.svg).not.toMatch(/script|href|on[a-z]+=/i);
  expect(pad.getAttribute('aria-label')).toBe('手写签字：已签');
  expect(clear.disabled).toBe(false);
});

it('rewinds the ink on 重签 and reports an empty pad', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const onChange = vi.fn();
  const { pad, clear } = await render(onChange);
  await stroke(pad, [[60, 100], [120, 90], [180, 110]]);
  await act(async () => clear.click());
  while (frames.length) { now += 400; const cb = frames.shift()!; await act(async () => cb(now)); }
  expect(onChange.mock.calls.at(-1)![0]).toBeNull();
  expect(pad.getAttribute('aria-label')).toBe('手写签字：未签');
  vi.unstubAllGlobals();
});

it('ignores input while disabled', async () => {
  const onChange = vi.fn();
  const { pad } = await render(onChange, true);
  await stroke(pad, [[60, 100], [120, 90]]);
  expect(onChange).not.toHaveBeenCalled();
});

it('crops the exported SVG to the written area', () => {
  const svg = signatureSvg([[{ x: 100, y: 60, w: 2 }, { x: 140, y: 80, w: 3 }]]);
  expect(svg).toContain('viewBox="92.0 52.0 56.0 36.0"');
  expect(signatureSvg([])).toBe('');
});

it('records nothing while the pad has no measured size', async () => {
  const onChange = vi.fn();
  const { pad } = await render(onChange);
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  await stroke(pad, [[60, 100], [120, 90], [180, 110]]);
  expect(onChange).not.toHaveBeenCalled();
  expect(pad.getAttribute('aria-label')).toBe('手写签字：未签');
});
