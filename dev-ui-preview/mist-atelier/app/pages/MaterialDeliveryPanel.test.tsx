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
const fill = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const directDelivery = () => {
  f = materialDeliveryFixture(100.3, false);
  deliveryId = f.run({ type: 'fulfillment.materials.deliver', payload: { id: f.purchaseId, targetProductionId: f.productionId, quantity: 20, rejected: 0, location: 'Factory', date: '2026-10-24', evidence: 'Original dispatch', fileIds: [] } }).id!;
  store.state = f.state;
};

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

it('asks for explicit accepted and rejected quantities on direct delivery and submits the receiving revision', async () => {
  directDelivery(); render();
  await act(async () => getByRole(host, 'button', { name: '登记点收' }).click());
  const dialog = getByRole(document.body, 'dialog', { name: '物料点收' });
  const accepted = getByRole(dialog, 'spinbutton', { name: '接收数量' }) as HTMLInputElement;
  expect(accepted.value).toBe('');
  await fill(accepted, '10'); await fill(getByRole(dialog, 'spinbutton', { name: '拒收数量' }) as HTMLInputElement, '4');
  await fill(getByRole(dialog, 'textbox', { name: '工厂点收依据' }) as HTMLTextAreaElement, 'Factory counted 10m; rejected 4m');
  await act(async () => getByRole(dialog, 'button', { name: '保存点收' }).click());
  expect(store.run).toHaveBeenCalledWith({ type: 'fulfillment.materials.confirm', payload: { id: deliveryId, kind: 'direct', acceptedQuantity: 10, rejectedQuantity: 4, expectedReceivingRevision: 0, evidence: 'Factory counted 10m; rejected 4m' } });
});

it('shows partial quantities and preserves the original dispatch and each receiving record', async () => {
  directDelivery();
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'direct', id: deliveryId, acceptedQuantity: 10, rejectedQuantity: 4, expectedReceivingRevision: 0, evidence: 'Short count verified' } }, 'garment');
  store.state = f.state; render();
  expect(host.textContent).toContain('部分点收'); expect(host.textContent).toContain('20 米'); expect(host.textContent).toContain('10 米'); expect(host.textContent).toContain('4 米'); expect(host.textContent).toContain('6 米');
  await act(async () => getByRole(host, 'button', { name: /交接记录/ }).click());
  expect(host.textContent).toContain('Original dispatch'); expect(host.textContent).toContain('Short count verified');
  await act(async () => getByRole(host, 'button', { name: '登记点收' }).click());
  const dialog = getByRole(document.body, 'dialog', { name: '物料点收' });
  await fill(getByRole(dialog, 'spinbutton', { name: '接收数量' }) as HTMLInputElement, '7');
  await fill(getByRole(dialog, 'textbox', { name: '工厂点收依据' }) as HTMLTextAreaElement, 'Too many');
  await act(async () => getByRole(dialog, 'button', { name: '保存点收' }).click());
  expect(store.run).not.toHaveBeenCalled(); expect(dialog.textContent).toContain('超过待接收数量');
});

it('does not offer another count after the direct delivery is fully disposed', () => {
  directDelivery();
  f.run({ type: 'fulfillment.materials.confirm', payload: { kind: 'direct', id: deliveryId, acceptedQuantity: 16, rejectedQuantity: 4, expectedReceivingRevision: 0, evidence: 'Counted all' } }, 'garment');
  store.state = f.state; render(); expect(host.textContent).toContain('部分接收');
  expect(queryByRole(host, 'button', { name: '登记点收' })).toBeNull();
});
