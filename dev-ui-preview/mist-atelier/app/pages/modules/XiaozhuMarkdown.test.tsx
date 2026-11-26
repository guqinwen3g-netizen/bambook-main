// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {expect,it,vi} from 'vitest';
import {XiaozhuMarkdown} from './XiaozhuMarkdown';
it('opens an explicit source link at the exact version and leaves foreign protocols inert',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host),open=vi.fn();document.body.append(host);
 try{await act(async()=>root.render(<XiaozhuMarkdown text={'[来源版本](bambook://open?view=development/detail&id=dev&versionId=old)\n[不可信](bambook://other?view=crm&id=private)\n[脚本](javascript:alert)\n![附件图片](https://example.invalid/track)'} index={[]} onOpen={open}/>));const buttons=host.querySelectorAll('button');expect(buttons).toHaveLength(1);await act(async()=>buttons[0].click());expect(open).toHaveBeenCalledWith('development/detail','dev',{versionId:'old'});expect(host.querySelectorAll('a')).toHaveLength(0);expect(host.querySelectorAll('img')).toHaveLength(0);
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('opens exact report filenames from this task and leaves ambiguous, embedded and supplied links untouched', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host), open = vi.fn(), preview = vi.fn();
  document.body.append(host);
  const attachments = [
    { id: 'pdf', name: 'mixed-scan-qc.pdf', mimeType: 'application/pdf', size: 1200 },
    { id: 'sheet', name: 'SO-1001.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 800 },
    { id: 'image', name: 'sample-tag.png', mimeType: 'image/png', size: 400 },
    { id: 'first-duplicate', name: '重复报价.xlsx', mimeType: 'application/octet-stream', size: 300 },
    { id: 'second-duplicate', name: '重复报价.xlsx', mimeType: 'application/octet-stream', size: 500 },
  ];
  const text = [
    '订单 SO-1001，查看 mixed-scan-qc.pdf、**SO-1001.xlsx** 和 sample-tag.png.',
    '重复报价.xlsx、example-mixed-scan-qc.pdf、dir/mixed-scan-qc.pdf、sample-tag.png.bak、未授权.pdf',
    '`mixed-scan-qc.pdf` [sample-tag.png](https://example.invalid/source) [伪造原件](bambook://task-attachment)',
    '```\nSO-1001.xlsx\n```',
  ].join('\n\n');
  const index = [{ text: 'SO-1001', view: 'orders/detail', id: 'order-1' }];
  try {
    await act(async () => root.render(<XiaozhuMarkdown text={text} index={index} onOpen={open} attachments={attachments} onOpenAttachment={preview} />));
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map(button => button.textContent)).toEqual(['SO-1001', 'mixed-scan-qc.pdf', 'SO-1001.xlsx', 'sample-tag.png']);
    await act(async () => buttons.forEach(button => button.click()));
    expect(open).toHaveBeenCalledExactlyOnceWith('orders/detail', 'order-1');
    expect(preview.mock.calls).toEqual(attachments.slice(0, 3).map(file => [file]));
    expect([...host.querySelectorAll('code')].map(code => code.textContent?.trim())).toEqual(['mixed-scan-qc.pdf', 'SO-1001.xlsx']);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid/source');
    const pdf = buttons[1];
    pdf.focus();
    await act(async () => root.render(<XiaozhuMarkdown text={text} index={index} onOpen={open} attachments={attachments} onOpenAttachment={file => preview(file)} />));
    expect(host.querySelectorAll('button')[1]).toBe(pdf);
    expect(document.activeElement).toBe(pdf);
    await act(async () => root.render(<XiaozhuMarkdown text={text} index={index} onOpen={open} onOpenAttachment={preview} />));
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'mixed-scan-qc.pdf')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
