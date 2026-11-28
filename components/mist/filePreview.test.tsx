// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {screen} from '@testing-library/dom';
const pdfMock = vi.hoisted(() => ({ getDocument: vi.fn(), options: { workerSrc: '' } }));
vi.mock('pdfjs-dist', () => ({ getDocument: pdfMock.getDocument, GlobalWorkerOptions: pdfMock.options }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));
import { FilePreview, previewKind, formatFileSize, type PreviewFile } from './filePreview';
import { Dialog } from './overlays';

let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); (URL as any).createObjectURL ??= () => 'blob:mock'; (URL as any).revokeObjectURL ??= () => {}; });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
function mount(files: PreviewFile[], load: (f: PreviewFile) => Promise<Blob>, extra: { onDownload?: (f: PreviewFile) => void; initialPdfPage?:number; initialSheetName?:string; initialSheetRow?:number; displayNames?:readonly string[] } = {}) {
  let index = 0; const onClose = vi.fn();
  const render = () => act(() => root.render(<FilePreview files={files} index={index} onIndex={i => { index = i; render(); }} onClose={onClose} load={load} onDownload={extra.onDownload} initialPdfPage={extra.initialPdfPage} initialSheetName={extra.initialSheetName} initialSheetRow={extra.initialSheetRow} displayNames={extra.displayNames} />));
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

it.each([[22,21], [90,22], [-6,0], [1.5,0], [undefined,0]])('positions a requested PDF page once (%s)',async(initialPdfPage,pageOffset)=>{
  const mockWidth=vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(640);
  const canvas=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const layout=vi.spyOn(HTMLElement.prototype,'offsetTop','get').mockImplementation(function(this:HTMLElement){
    return this.classList.contains('mist-viewer-page')?[...this.parentElement!.children].indexOf(this)*100:0;
  });
  const bounds=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    if(!this.classList.contains('mist-viewer-page'))return new DOMRect(0,77,640,800);
    return new DOMRect(0,77+(this.offsetTop-this.parentElement!.scrollTop)*0.98,620,90);
  });
  try {
    const pdfPage={getViewport:({scale}: {scale:number})=>({width:600*scale,height:850*scale}),render:()=>({promise:Promise.resolve(),cancel:vi.fn()})};
    pdfMock.getDocument.mockReturnValue({promise:Promise.resolve({numPages:23,getPage:vi.fn(async()=>pdfPage),destroy:vi.fn(async()=>{})})});
    const blob=new Blob(['%PDF-1.4'],{type:'application/pdf'});(blob as any).arrayBuffer??=async()=>new ArrayBuffer(0);
    mount([{id:'pdf',name:'验货报告.pdf'}],async()=>blob,{initialPdfPage});
    await flush();
    const scroll=document.querySelector<HTMLElement>('.mist-viewer-pages')!;
    expect(scroll.scrollTop).toBe(Number(pageOffset)*100);
    const pageLabel = () => document.querySelector('.mist-viewer-title .mist-muted')?.textContent;
    expect(pageLabel()).toContain(`第 ${Number(pageOffset)+1} 页，共 23 页`);
    await act(async () => {
      scroll.scrollTop=1234;
      scroll.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    expect(pageLabel()).toContain('第 13 页，共 23 页');
    await act(async()=>btn('放大').click());
    await flush();
    expect(scroll.scrollTop).toBe(1234);
  } finally { bounds.mockRestore();layout.mockRestore();canvas.mockRestore();mockWidth.mockRestore(); }
});

it('jumps from the PDF page count without reopening the original',async()=>{
 const width=vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(640);
 const canvas=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const offsets=vi.spyOn(HTMLElement.prototype,'offsetTop','get').mockImplementation(function(this:HTMLElement){
  return this.classList.contains('mist-viewer-page')?[...this.parentElement!.children].indexOf(this)*100:0;
 });
 try {
  const page={getViewport:()=>({width:600,height:800}),render:()=>({promise:Promise.resolve(),cancel:vi.fn()})};
  pdfMock.getDocument.mockReturnValue({promise:Promise.resolve({numPages:23,getPage:vi.fn(async()=>page),destroy:vi.fn(async()=>{})})});
  const blob=new Blob(['%PDF-1.4']);(blob as any).arrayBuffer??=async()=>new ArrayBuffer(0);
  const load=vi.fn(async()=>blob);
  const view=mount([{id:'pdf',name:'验货报告.pdf'}],load,{initialPdfPage:22});
  await flush();
  const opener=btn('第 22 页，共 23 页');
  expect(opener).toBeTruthy();
  await act(async()=>opener.click());
  const input=() => document.querySelector<HTMLInputElement>('input[aria-label="PDF 页码"]')!;
  expect(document.activeElement).toBe(input());
  const enter=async (text:string)=>act(async()=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input(),text);
   input().dispatchEvent(new Event('input',{bubbles:true}));
   input().closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  await enter('24');
  expect(input().getAttribute('aria-invalid')).toBe('true');
  expect(document.querySelector<HTMLElement>('.mist-viewer-pages')!.scrollTop).toBe(2100);
  await enter('5');
  expect(input()).toBeNull();
  expect(document.querySelector<HTMLElement>('.mist-viewer-pages')!.scrollTop).toBe(400);
  const current=btn('第 5 页，共 23 页');
  expect(document.activeElement).toBe(current);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async()=>current.click());
  await act(async()=>input().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(view.onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(current);
  expect(input()).toBeNull();
 }finally{width.mockRestore();canvas.mockRestore();offsets.mockRestore();}
});

it.each(['wheel', 'touch', 'keyboard', 'scrollbar'])('keeps the requested page aligned during lazy layout until %s navigation', async (input) => {
  const pdfPage = (height: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: height * scale }) });
  const pendingFirst = Promise.withResolvers<ReturnType<typeof pdfPage>>();
  const pendingSecond = Promise.withResolvers<ReturnType<typeof pdfPage>>();
  let firstReads = 0;
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const layout = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function(this: HTMLElement) {
    if (!this.classList.contains('mist-viewer-page')) return 0;
    const siblings = [...this.parentElement!.children] as HTMLElement[];
    return siblings.slice(0, siblings.indexOf(this)).reduce((sum, page) => sum + Number.parseFloat(page.style.height), 0);
  });
  try {
    pdfMock.getDocument.mockReturnValue({ promise: Promise.resolve({
      numPages: 4,
      getPage: vi.fn(async (page: number) => {
        if (page === 2) return pendingSecond.promise;
        if (page === 1 && ++firstReads > 1) return pendingFirst.promise;
        return pdfPage(300);
      }),
      destroy: vi.fn(async () => {}),
    }) });
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    (blob as any).arrayBuffer ??= async () => new ArrayBuffer(0);
    mount([{ id: 'pdf', name: '验货报告.pdf' }], async () => blob, { initialPdfPage: 3 });
    await flush();
    const pane = document.querySelector<HTMLElement>('.mist-viewer-pages')!;
    expect(pane.scrollTop).toBe(600);
    await act(async () => { pendingSecond.resolve(pdfPage(700)); });
    await act(async () => { await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())); });
    expect(pane.scrollTop).toBe(1000);
    await act(async () => {
      if (input === 'wheel') pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      if (input === 'touch') pane.dispatchEvent(new Event('touchstart', { bubbles: true }));
      if (input === 'keyboard') pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
      pane.scrollTop = 450;
      if (input === 'scrollbar') pane.dispatchEvent(new Event('scroll'));
      pendingFirst.resolve(pdfPage(500));
    });
    await act(async () => { await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())); });
    expect(pane.scrollTop).toBe(450);
    await act(async () => btn('放大').click());
    await flush();
    expect(pane.scrollTop).toBe(450);
  } finally { layout.mockRestore(); canvas.mockRestore(); width.mockRestore(); }
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
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))); await flush();
    expect(view.index).toBe(0); expect(load).toHaveBeenCalledTimes(2);
  });
  it('附件快捷键只在前台预览内生效，保留浏览器组合键', async () => {
    const files = [{ id: 'a', name: '正面.png' }, { id: 'b', name: '背面.png' }];
    const load = async () => new Blob(['image'], { type: 'image/png' });
    const onIndex = vi.fn();
    let covered = false;
    const draw = () => root.render(<><FilePreview files={files} index={0} load={load} onIndex={onIndex} onClose={() => {}}/>
      <Dialog title="上层窗口" open={covered} onClose={() => { covered = false; draw(); }}/></>);
    const press = (key: string, options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
      act(() => { document.activeElement?.dispatchEvent(event); });
      return event;
    };
    act(draw); await flush();
    act(() => { covered = true; draw(); });
    press('ArrowRight');
    press('+');
    expect(onIndex).not.toHaveBeenCalled();
    expect(document.querySelector('.mist-viewer-zoom')?.textContent).toBe('适应');
    press('Escape');
    expect(press('ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(press('+', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.querySelector('.mist-viewer-zoom')?.textContent).toBe('适应');
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(onIndex).toHaveBeenCalledExactlyOnceWith(1);
    press('+');
    expect(document.querySelector('.mist-viewer-zoom')?.textContent).not.toBe('适应');
  });
  it('同名附件的标题保留显示编号，读取与下载仍传原件', async () => {
    const files = [{ id: 'a', name: '条款.txt' }, { id: 'b', name: '条款.txt' }];
    const load = vi.fn(async (file: PreviewFile) => new Blob([file.id], { type: 'text/plain' }));
    const onDownload = vi.fn();
    const title = () => document.querySelector('.mist-viewer-title .mist-h2')!;
    mount(files, load, { displayNames: ['条款.txt（1）', '条款.txt（2）'], onDownload });
    await flush();
    expect(title().textContent).toBe('条款.txt（1）');
    await act(async () => btn('下一个附件').click());
    await flush();
    expect(title().textContent).toBe('条款.txt（2）');
    expect(title().getAttribute('title')).toBe('条款.txt（2）');
    expect(load).toHaveBeenLastCalledWith(files[1]);
    await act(async () => btn('下载').click());
    expect(onDownload).toHaveBeenCalledExactlyOnceWith(files[1]);
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
  it('Excel：保留稀疏区域的物理行号并标记引用行', async () => {
    const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(sheet,[['first-physical-row']],{origin:'B23'});
    XLSX.utils.sheet_add_aoa(sheet,[['verified-row']],{origin:'B47'});
    sheet['!ref']='B23:B47';
    XLSX.utils.book_append_sheet(book,sheet,'报价');
    const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    mount([{id:'s',name:'报价.xlsx'}],async()=>blob,{initialSheetName:'报价',initialSheetRow:47});
    await flush();
    const target=await screen.findByRole('cell',{name:'verified-row'});
    expect(target.closest('tr')?.getAttribute('aria-current')).toBe('location');
    expect(target.closest('tr')?.querySelector('th')?.textContent).toBe('47');
    expect(screen.getByRole('columnheader',{name:'B'})).toBeTruthy();
  });

  it('Excel：给末行引用留出居中空间，切换到其他表后清除', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['开头'], ['末行']]), '报价');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['其它']]), '规格');
    const blob = new Blob([XLSX.write(book, { type: 'array', bookType: 'xlsx' })]);
    const original = HTMLElement.prototype.getBoundingClientRect;
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('.mist-viewer-scroll')) return new DOMRect(0, 100, 300, 300);
      if (this.matches('table')) return new DOMRect(0, 100, 300, 520);
      if (this.matches('tr[data-cited]')) return new DOMRect(0, 590, 300, 28);
      return original.call(this);
    });
    try {
      mount([{ id: 's', name: '报价.xlsx' }], async () => blob, { initialSheetName: '报价', initialSheetRow: 2 });
      await screen.findByRole('cell', { name: '末行' });
      const pane = document.querySelector<HTMLElement>('.mist-viewer-scroll')!;
      expect(pane.style.getPropertyValue('--mist-sheet-citation-space')).toBe('134px');
      expect(pane.scrollTop).toBe(354);
      await act(async () => screen.getByRole('tab', { name: '规格' }).click());
      expect(pane.style.getPropertyValue('--mist-sheet-citation-space')).toBe('');
    } finally { geometry.mockRestore(); }
  });

  it.each([
    ['辅料', '辅料'],
    ['内部草稿', '尺寸表'],
    ['内部备注', '尺寸表'],
    [' 辅料', '尺寸表'],
  ])('Excel：定位到精确匹配的可见工作表（%s）', async (initialSheetName, expected) => {
    const book = XLSX.utils.book_new();
    for (const name of ['内部草稿', '尺寸表', '辅料', '内部备注']) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[name + '内容']]), name);
    }
    XLSX.utils.book_set_sheet_visibility(book, '内部草稿', 1);
    XLSX.utils.book_set_sheet_visibility(book, '内部备注', 2);
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([bytes]);
    blob.arrayBuffer ??= async () => bytes;
    mount([{ id: 's', name: '用量.xlsx' }], async () => blob, { initialSheetName });
    await flush();

    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(expected);
    expect(document.querySelector('table.mist-viewer-table')?.textContent).toContain(expected + '内容');

    const other = expected === '尺寸表' ? '辅料' : '尺寸表';
    await act(async () => btn(other).click());
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(other);
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
  it('retries the same original in the open preview after a temporary read failure', async () => {
    const file = { id: 'report', name: '原件.png' };
    const load = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
    load.mockRejectedValueOnce(new Error('附件读取失败'));
    const view = mount([file], load);
    await flush();
    const dialog = document.querySelector('[data-file-preview="report"]')!;
    await act(async () => btn('重试').click());
    await flush();
    expect(load.mock.calls).toEqual([[file], [file]]);
    expect(document.querySelector('[data-file-preview="report"]')).toBe(dialog);
    expect(dialog.querySelector('img')?.alt).toBe(file.name);
    expect(view.onClose).not.toHaveBeenCalled();
  });
  it('关闭按钮回调 onClose', async () => {
    const view = mount([{ id: 'a', name: 'a.png' }], async () => new Blob(['x'])); await flush();
    await act(async () => btn('关闭').click()); expect(view.onClose).toHaveBeenCalled();
  });
});


it.each([['UnknownErrorException','预览加载失败，请刷新后重试'],['InvalidPDFException','PDF 无法解析，文件可能已损坏']])('distinguishes PDF loading errors (%s) from invalid original files',async(name,message)=>{
  pdfMock.options.workerSrc='';pdfMock.getDocument.mockImplementation(()=>({promise:Promise.reject(Object.assign(new Error('load failed'),{name}))}));
  mount([{id:'pdf',name:'purchase.pdf',mimeType:'application/pdf'}],async()=>new Blob(['%PDF-1.4'],{type:'application/pdf'}));
  await flush();expect(document.body.textContent).toContain(message);
  expect(pdfMock.options.workerSrc).toBe('/assets/pdf.worker.mjs?module=1');
  if(name==='UnknownErrorException')expect(document.body.textContent).not.toContain('文件可能已损坏');
});
