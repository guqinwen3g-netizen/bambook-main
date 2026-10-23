// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../components/mist';
import { materialDeliveryFixture } from '../../../../server/src/mist/__tests__/materialDelivery';
import { materialDeliveryRows } from '../../../../server/src/shared/mistInternalFabric';
import type { MistState } from '../../../../server/src/shared/mistWorkspace';
const store = vi.hoisted(() => ({ state: null as MistState | null, workspace: { id: 'workspace' }, saving: false, pending: null, run: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: 'garment' }, sessionKey: 'session', hasPermission: vi.fn(() => true) }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => store }));
vi.mock('../runtime/auth', () => ({ useOptionalMistSession: () => auth }));
import { MaterialDeliveryPanel } from './MaterialDeliveryPanel';
let host: HTMLElement, root: Root, f: ReturnType<typeof materialDeliveryFixture>, deliveryId: string;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f = materialDeliveryFixture(); deliveryId = f.issue(20); store.state = f.state; store.run.mockReset(); store.run.mockResolvedValue({ result: {} });
  auth.user.id = 'garment'; auth.hasPermission.mockReturnValue(true); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(<MistRoot><ToastProvider><MaterialDeliveryPanel rows={materialDeliveryRows(store.state!)} /></ToastProvider></MistRoot>));

it('shows the exact destination and lets the designated receiver confirm the actual handover', async () => {
  render(); expect(host.textContent).toContain('20 米'); expect(host.textContent).toContain('待接收');
  await act(async () => getByRole(host, 'button', { name: '确认接收', exact: true }).click());
  const dialog = getByRole(document.body, 'dialog', { name: '确认物料接收' });
  const input = getByRole(dialog, 'textbox', { name: '工厂点收依据' }) as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Factory counted 20m, no shortage'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => getByRole(dialog, 'button', { name: '确认接收', exact: true }).click());
  expect(store.run).toHaveBeenCalledWith({ type: 'fulfillment.materials.confirm', payload: { id: deliveryId, kind: 'issue', evidence: 'Factory counted 20m, no shortage' } });
});
it('is read-only for other people and for users without write permission', () => {
  auth.user.id = 'owner'; render(); expect(queryByRole(host, 'button', { name: '确认接收', exact: true })).toBeNull();
  auth.user.id = 'garment'; auth.hasPermission.mockReturnValue(false); render(); expect(queryByRole(host, 'button', { name: '确认接收', exact: true })).toBeNull();
});
it('shows net material after a return and preserves the original confirmation evidence', () => {
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'issue', id: deliveryId, evidence: 'Counted' } }, 'garment');
  f.run({ type: 'fulfillment.inventory.move', payload: { id: f.state.fulfillment.stock[0].id, kind: 'return', issueId: deliveryId, quantity: 5, location: 'A-01', person: 'factory', note: 'Returned' } });
  store.state = f.state; render(); expect(host.textContent).toContain('15 米'); expect(host.textContent).toContain('已退回'); expect(host.textContent).toContain('已接收');
  expect(queryByRole(host, 'button', { name: '确认接收', exact: true })).toBeNull();
});
it('offers receipt to the current order owner after staff responsibility changes',()=>{
  const order=f.state.orders.find(o=>o.id===f.target.orderId)!;order.ownerId='reviewer';order.owner='Leader';auth.user.id='reviewer';store.state=f.state;render();
  expect(getByRole(host,'button',{name:'确认接收',exact:true})).toBeTruthy();expect(host.textContent).toContain('Leader');
});
