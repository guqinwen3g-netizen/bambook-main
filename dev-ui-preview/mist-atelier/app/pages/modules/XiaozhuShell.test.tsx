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


it('adds pasted files once, permits clipboard text, and keeps unavailable drafts unchanged', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host), add = vi.fn(), send = vi.fn();
  const image = new File(['png'], 'image.png', { type: 'image/png' });
  const pdf = new File(['pdf'], 'delivery.pdf', { type: 'application/pdf' });
  const render = (busy: boolean, enabled: boolean) => root.render(<XiaozhuComposer value="已有草稿"
    onChange={() => {}} onSend={send} ready busy={busy} sources={[]} onRemoveSource={() => {}} onAttach={() => {}}
    files={[]} onAddFiles={enabled ? add : undefined} onRemoveFile={() => {}} voice={{ state: 'idle' } as any}
    attachmentRefs={[]} onRemoveAttachmentRef={() => {}} voiceAvailable={false} field={{ current: null }} placeholder="提问" />);
  const paste = async (files: File[], items: Array<{ kind: string; getAsFile: () => File | null }>, text = '') => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, items, getData: () => text } });
    await act(async () => host.querySelector('textarea')!.dispatchEvent(event));
    return event;
  };
  const fileItem = { kind: 'file', getAsFile: () => image };
  try {
    await act(async () => render(false, true));
    expect((await paste([image, pdf], [fileItem])).defaultPrevented).toBe(true);
    expect((await paste([], [fileItem, {kind:'string', getAsFile:()=>null}], '附注')).defaultPrevented).toBe(false);
    expect((await paste([], [], '普通文字')).defaultPrevented).toBe(false);
    expect(add.mock.calls).toEqual([[[image, pdf]], [[image]]]);
    await act(async () => render(true, true));
    expect((await paste([image], [fileItem])).defaultPrevented).toBe(false);
    await act(async () => render(false, false));
    expect((await paste([image], [fileItem])).defaultPrevented).toBe(false);
    expect(add).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});


it('announces submission independently from running tasks and prevents a second send', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host), stop = vi.fn(), send = vi.fn();
  try {
    await act(async () => root.render(<XiaozhuComposer value="上传中的截图" onChange={() => {}} onSend={send}
      ready={false} busy working onStop={stop} submissionStatus="正在提交任务" sources={[]}
      onRemoveSource={() => {}} onAttach={() => {}} files={[]} onRemoveFile={() => {}} voice={{ state:'idle' } as any}
      attachmentRefs={[]} onRemoveAttachmentRef={() => {}} voiceAvailable={false} field={{ current:null }} placeholder="提问" />));
    expect(host.querySelector('[role=status]')?.textContent).toBe('正在提交任务');
    expect(host.querySelector('button[aria-label="停止生成"]')).toBeNull();
    const submit = host.querySelector<HTMLButtonElement>('button[aria-label="发送"]');
    expect(submit?.disabled).toBe(true);
    await act(async () => submit?.click());
    expect(send).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
