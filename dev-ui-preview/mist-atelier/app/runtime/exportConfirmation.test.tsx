// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import { Button, MistRoot } from '../../../../components/mist';
import { downloadMistCsv } from '../pages/OrderListPage';
import { downloadModuleCsv } from '../pages/modules/ModuleWorkbench';
import { ExportConfirmHost } from './ExportConfirmHost';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, openUrl: ReturnType<typeof vi.fn>, clickAnchor: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  openUrl = vi.fn((_blob: Blob) => 'blob:generated'); URL.createObjectURL = openUrl; URL.revokeObjectURL = vi.fn();
  clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function render(scope = 'company-a') {
  act(() => root.render(<MistRoot><ExportConfirmHost scope={scope} /><Button onClick={() => downloadModuleCsv('测试报表.csv', ['项目', '说明'], [['样本', '=1+1']])}>导出报表</Button><Button onClick={() => downloadMistCsv('已有草稿.csv', ['项目'], [['样本']], { direct: true })}>下载草稿</Button></MistRoot>));
}
function click(element: HTMLElement) { act(() => element.click()); }

it('waits for confirmation and exports the displayed rows only after approval', async () => {
  render(); click(getByRole(host, 'button', { name: '导出报表' }));
  const dialog = getByRole(host, 'dialog', { name: '确认导出' });
  expect(dialog.textContent).toContain('测试报表.csv'); expect(dialog.textContent).toContain('1 条记录');
  expect(openUrl).not.toHaveBeenCalled(); expect(clickAnchor).not.toHaveBeenCalled();
  click(getByRole(dialog, 'button', { name: '导出' }));
  expect(openUrl).toHaveBeenCalledTimes(1); expect(clickAnchor).toHaveBeenCalledTimes(1);
  const blob = openUrl.mock.calls[0][0] as Blob;
  const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob); });
  expect(content.replace(/^\uFEFF/, '')).toBe('"项目","说明"\r\n"样本","\'=1+1"');
  expect(queryByRole(host, 'dialog', { name: '确认导出' })).toBeNull();
});

it('cancels generated exports without affecting direct file downloads', () => {
  render(); click(getByRole(host, 'button', { name: '导出报表' }));
  click(getByRole(getByRole(host, 'dialog', { name: '确认导出' }), 'button', { name: '取消' }));
  expect(openUrl).not.toHaveBeenCalled(); expect(clickAnchor).not.toHaveBeenCalled();
  click(getByRole(host, 'button', { name: '下载草稿' }));
  expect(clickAnchor).toHaveBeenCalledTimes(1); expect(queryByRole(host, 'dialog', { name: '确认导出' })).toBeNull();
});

it('starts only one download when confirmation is clicked twice', () => {
  render(); click(getByRole(host, 'button', { name: '导出报表' }));
  const confirm = getByRole(getByRole(host, 'dialog', { name: '确认导出' }), 'button', { name: '导出' });
  act(() => { confirm.click(); confirm.click(); });
  expect(openUrl).toHaveBeenCalledTimes(1); expect(clickAnchor).toHaveBeenCalledTimes(1);
});

it('discards a pending export after its company or page scope changes', () => {
  render(); click(getByRole(host, 'button', { name: '导出报表' }));
  expect(queryByRole(host, 'dialog', { name: '确认导出' })).not.toBeNull();
  render('company-b');
  expect(queryByRole(host, 'dialog', { name: '确认导出' })).toBeNull(); expect(clickAnchor).not.toHaveBeenCalled();
});

it('keeps the dialog open with a retry message if starting the download fails', () => {
  render(); openUrl.mockImplementation(() => { throw new Error('unavailable'); });
  click(getByRole(host, 'button', { name: '导出报表' }));
  const dialog = getByRole(host, 'dialog', { name: '确认导出' }); click(getByRole(dialog, 'button', { name: '导出' }));
  expect(getByRole(dialog, 'alert').textContent).toContain('导出未能开始'); expect(clickAnchor).not.toHaveBeenCalled();
});

it('does not download without an active confirmation host', () => {
  expect(() => downloadModuleCsv('测试报表.csv', ['项目'], [['样本']])).toThrow('导出确认不可用');
  expect(openUrl).not.toHaveBeenCalled(); expect(clickAnchor).not.toHaveBeenCalled();
});
