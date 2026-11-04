// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataTable, MistRoot } from '.';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('opens a row from the row itself but leaves in-row controls to their own handlers', () => {
  const open = vi.fn(), act1 = vi.fn();
  act(() => root.render(<MistRoot><DataTable ariaLabel="rows" rows={[{ id: 'a' }]} rowKey={r => r.id} onRowClick={open}
    columns={[{ key: 'id', header: 'ID', render: r => <span data-cell>{r.id}</span> }, { key: 'act', header: '', render: () => <button type="button" onClick={act1}>Act</button> }]} /></MistRoot>));
  const row = host.querySelector('[role="row"][data-clickable]') as HTMLElement;
  act(() => (host.querySelector('[data-cell]') as HTMLElement).click());
  expect(open).toHaveBeenCalledTimes(1);
  act(() => (host.querySelector('button') as HTMLElement).click());
  expect(act1).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1);
  act(() => { (host.querySelector('button') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(open).toHaveBeenCalledTimes(1);
  act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(open).toHaveBeenCalledTimes(2);
});
