// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { FilePreview, previewKind, formatFileSize, type PreviewFile } from './filePreview';

let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); (URL as any).createObjectURL ??= () => 'blob:mock'; (URL as any).revokeObjectURL ??= () => {}; });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
function mount(files: PreviewFile[], load: (f: PreviewFile) => Promise<Blob>, extra: { onDownload?: (f: PreviewFile) => void } = {}) {
  let index = 0; const onClose = vi.fn();
  const render = () => act(() => root.render(<FilePreview files={files} index={index} onIndex={i => { index = i; render(); }} onClose={onClose} load={load} onDownload={extra.onDownload} />));
  render(); return { onClose, get index() { return index; } };
}
const btn = (label: string) => [...document.body.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) as HTMLButtonElement;

describe('附件预览类型', () => {
  it('按扩展名与 MIME 判断可预览格式，旧版 Word / PPT 给出原因', () => {
    expect(previewKind({ id: '1', name: '合同.PDF' }).kind).toBe('pdf');
    expect(previewKind({ id: '1', name: '照片.jpeg' }).kind).toBe('image');
    expect(previewKind({ id: '1', name: '工艺单.docx' }).kind).toBe('docx');
    expect(previewKind({ id: '1', name: '尺码表.xls' }).kind).toBe('sheet');
    expect(previewKind({ id: '1', name: '明细.csv' }).kind).toBe('sheet');
    expect(previewKind({ id: '1', name: 'note.txt' }).kind).toBe('text');
    expect(previewKind({ id: '1', name: '验货.mp4' }).kind).toBe('video');
    expect(previewKind({ id: '1', name: 'scan', mimeType: 'application/pdf' }).kind).toBe('pdf');
    const doc = previewKind({ id: '1', name: '旧合同.doc' }); expect(doc.kind).toBe('unsupported'); expect(doc.reason).toContain('.docx');
    expect(previewKind({ id: '1', name: 'IMG_1.HEIC', mimeType: 'image/heic' }).kind).toBe('unsupported');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

describe('附件预览浮层', () => {
  it('图片：加载后显示图片，可缩放与旋转，下载走调用方', async () => {
    const load = vi.fn(async () => new Blob(['x'], { type: 'image/png' })), onDownload = vi.fn();
    mount([{ id: 'a', name: '面料照片.png', mimeType: 'image/png', size: 2048 }], load, { onDownload });
    await flush();
    const dialog = document.querySelector('[data-file-preview="a"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog'); expect(dialog.textContent).toContain('面料照片.png'); expect(dialog.textContent).toContain('图片 · 2.0 KB');
    expect(dialog.querySelector('img')!.getAttribute('alt')).toBe('面料照片.png');
    expect(btn('放大')).toBeTruthy(); expect(btn('旋转')).toBeTruthy();
    await act(async () => btn('下载').click()); expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
  it('多个附件：左右切换并显示序号；已读过的不重复读取', async () => {
    const load = vi.fn(async (f: PreviewFile) => new Blob([f.id === 'b' ? '第二个文本' : 'x'], { type: 'text/plain' }));
    const files = [{ id: 'a', name: 'a.png' }, { id: 'b', name: 'b.txt' }];
    const view = mount(files, load); await flush();
    expect(document.body.textContent).toContain('1 / 2');
    await act(async () => btn('下一个附件').click()); await flush();
    expect(view.index).toBe(1); expect(document.querySelector('.mist-viewer-text')!.textContent).toBe('第二个文本');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))); await flush();
    expect(view.index).toBe(0); expect(load).toHaveBeenCalledTimes(2);
  });
  it('Excel：显示工作表切换和单元格，行列号齐全', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['尺码', '胸围'], ['M', 104]]), '尺寸表');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['物料', '用量'], ['主唛', 1]]), '辅料');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([bytes]); (blob as any).arrayBuffer ??= async () => bytes;
    mount([{ id: 's', name: '尺寸表.xlsx' }], async () => blob); await flush();
    const table = document.querySelector('table.mist-viewer-table')!;
    expect(table.textContent).toContain('胸围'); expect(table.textContent).toContain('104'); expect(table.querySelector('thead')!.textContent).toBe('AB');
    const tab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === '辅料') as HTMLButtonElement;
    await act(async () => tab.click());
    expect(document.querySelector('table.mist-viewer-table')!.textContent).toContain('主唛');
  });
  it('不支持的格式不读取原件，说明原因并提供下载', async () => {
    const load = vi.fn(), onDownload = vi.fn();
    mount([{ id: 'd', name: '旧合同.doc' }], load, { onDownload }); await flush();
    expect(load).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('此格式暂不支持在线预览'); expect(document.body.textContent).toContain('另存为 .docx');
    await act(async () => btn('下载原件').click()); expect(onDownload).toHaveBeenCalled();
  });
  it('读取失败时显示原因，不留在加载状态', async () => {
    mount([{ id: 'e', name: '报告.pdf' }], async () => { throw new Error('附件读取失败'); }); await flush();
    expect(document.body.textContent).toContain('预览未能打开'); expect(document.body.textContent).toContain('附件读取失败');
  });
  it('关闭按钮回调 onClose', async () => {
    const view = mount([{ id: 'a', name: 'a.png' }], async () => new Blob(['x'])); await flush();
    await act(async () => btn('关闭').click()); expect(view.onClose).toHaveBeenCalled();
  });
});
