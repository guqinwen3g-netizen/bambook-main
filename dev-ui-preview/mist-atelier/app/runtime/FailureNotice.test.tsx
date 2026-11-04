// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog, MistRoot } from '../../../../components/mist';
import { FailureNotice } from './FailureNotice';
import { usePageFailureHost, usePageFailures } from './errorPresentation';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Shell({ children }: { children: React.ReactNode }) {
  usePageFailureHost();
  const failures = usePageFailures();
  return <><div data-page>{children}</div><div data-shell-card>{failures.map(item => <p key={item.id}>{item.title} · {item.detail}</p>)}</div></>;
}
const render = (node: React.ReactNode) => act(() => root.render(<MistRoot>{node}</MistRoot>));

it('sends a page failure to the shell card instead of the page', () => {
  render(<Shell><FailureNotice title="库存读取未完成" detail="网络中断" /></Shell>);
  expect(host.querySelector('[data-page]')!.textContent).toBe('');
  expect(host.querySelector('[data-shell-card]')!.textContent).toContain('库存读取未完成 · 网络中断');
});

it('keeps the failure inside an open dialog, behind which the shell card would be hidden', () => {
  render(<Shell><Dialog open onClose={vi.fn()} title="登记出库"><FailureNotice title="出库未保存" detail="数量超过可用" /></Dialog></Shell>);
  expect(document.querySelector('.mist-dialog')!.textContent).toContain('数量超过可用');
  expect(host.querySelector('[data-shell-card]')!.textContent).toBe('');
});

it('stays in place without a shell and withdraws from the card when the failure clears', () => {
  render(<FailureNotice title="票据读取未完成" detail="服务器无响应" />);
  expect(host.textContent).toContain('服务器无响应');
  render(<Shell><FailureNotice title="票据读取未完成" detail="服务器无响应" /></Shell>);
  expect(host.querySelector('[data-shell-card]')!.textContent).toContain('服务器无响应');
  render(<Shell>{null}</Shell>);
  expect(host.querySelector('[data-shell-card]')!.textContent).toBe('');
});
