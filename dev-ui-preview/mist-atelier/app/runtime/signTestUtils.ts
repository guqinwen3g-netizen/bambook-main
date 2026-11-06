import { act } from 'react';
import { expect } from 'vitest';

/** Draw one short stroke on every signature pad inside `root`, as a user signing with a pointer would. */
export async function signPads(root: ParentNode = document.body) {
  for (const pad of Array.from(root.querySelectorAll<HTMLDivElement>('.mist-signature-pad'))) {
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 168, right: 480, bottom: 168, x: 0, y: 0, toJSON: () => ({}) });
    const at = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 });
    await act(async () => { pad.dispatchEvent(at('pointerdown', 60, 100)); });
    for (const [x, y] of [[100, 80], [150, 110], [200, 76]]) await act(async () => { pad.dispatchEvent(at('pointermove', x, y)); });
    await act(async () => { pad.dispatchEvent(at('pointerup', 200, 76)); });
    await act(async () => { pad.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 76 })); });
  }
}

export const SIGNED = { signature: { svg: expectSvg() } };
function expectSvg() { return expect.stringMatching(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/) as unknown as string; }
