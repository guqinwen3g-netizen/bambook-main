// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { XiaozhuComposer } from './XiaozhuShell';

it('selects or drops several files and opens business references with @ in the same draft', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const files = [new File(['pdf'], 'delivery.pdf'), new File(['sheet'], 'quantity.xlsx')];
  const add = vi.fn(), reference = vi.fn(), send = vi.fn();
  try {
    await act(async () => root.render(<XiaozhuComposer value="" onChange={() => {}} onSend={send}
      ready={false} busy={false} sources={[]} onRemoveSource={() => {}} onAttach={reference}
      files={[]} onAddFiles={add} onRemoveFile={() => {}} voice={{ state: 'idle' } as any}
      attachmentRefs={[]} onRemoveAttachmentRef={() => {}}
      voiceAvailable={false} field={{ current: null }} placeholder="向助手提问" />));
    const input = host.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files } });
    await act(async () => host.querySelector('.mist-xz-composer')!.dispatchEvent(drop));
    expect(add.mock.calls).toEqual([[files], [files]]);
    expect(drop.defaultPrevented).toBe(true);
    const textarea = host.querySelector('textarea')!;
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true })));
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(reference).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
