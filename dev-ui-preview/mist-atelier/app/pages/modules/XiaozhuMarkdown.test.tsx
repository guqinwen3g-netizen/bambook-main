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

it('opens numbered references for both same-name originals without guessing for the bare name',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host),preview=vi.fn();document.body.append(host);
 const first={id:'quote-a',name:'报价单.pdf',mimeType:'application/pdf',size:100};
 const second={...first,id:'quote-b',size:200};
 const text='报价单.pdf。两份来源分别为 **报价单.pdf（1）** 和 `报价单.pdf（2）`。';
 try{
  await act(async()=>root.render(<XiaozhuMarkdown text={text} index={[]} onOpen={vi.fn()} attachments={[first,second]} onOpenAttachment={preview}/>));
  const buttons=[...host.querySelectorAll('button')];
  expect(buttons.map(button=>button.textContent)).toEqual(['报价单.pdf（1）','报价单.pdf（2）']);
  await act(async()=>buttons.forEach(button=>button.click()));
  expect(preview.mock.calls).toEqual([[first],[second]]);
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('opens an explicitly cited checked PDF page and keeps ambiguous or unchecked references at file level',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host),preview=vi.fn();document.body.append(host);
 const first={id:'a',name:'quote.pdf',mimeType:'application/pdf',size:100};
 const second={...first,id:'b',size:200};
 const sheet={id:'c',name:'报价.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:100};
 const text=[
  '**quote.pdf（1）** 第 23 页；`quote.pdf（2）` page 21。',
  'quote.pdf（1）第 21 至 23 页、quote.pdf（1）第 90 页。',
  'quote.pdf（1）第 21 页、quote.pdf（1）第 22 页。',
  '报价.xlsx 第 21 页；quote.pdf 第 23 页。',
  'quote.pdf（1）：共 23 页；末页（第 23 页）载有标识。',
 ].join('\n\n');
 const attachmentReads=[
  {at:'',kind:'read' as const,label:'读取附件',taskAttachmentId:'a',taskAttachmentPageRange:{from:21,to:23},taskAttachmentObservedPages:[22,23]},
  {at:'',kind:'read' as const,label:'读取附件',taskAttachmentId:'b',taskAttachmentPageRange:{from:21,to:21}},
 ];
 try{
  await act(async()=>root.render(<XiaozhuMarkdown text={text} index={[]} onOpen={vi.fn()} attachments={[first,second,sheet]} attachmentReads={attachmentReads} onOpenAttachment={preview}/>));
  const buttons=[...host.querySelectorAll('button')];
  expect(buttons.map(x=>x.textContent)).toEqual(['quote.pdf（1）','quote.pdf（2）','quote.pdf（1）','quote.pdf（1）','quote.pdf（1）','quote.pdf（1）','报价.xlsx','quote.pdf（1）']);
  await act(async()=>buttons.forEach(button=>button.click()));
  expect(preview.mock.calls).toEqual([[first,23],[second,21],[first],[first],[first],[first,22],[sheet],[first,23]]);
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('opens exact observed worksheet names and keeps unread or other-file tabs at workbook level',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host),preview=vi.fn();document.body.append(host);
 const first={id:'first',name:'报价.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:100};
 const second={...first,id:'second'};
 const text=[
  '**报价.xlsx（1）**（工作表：核对结果）',
  '报价.xlsx（1）(worksheet Details)',
  '报价.xlsx（1）（工作表：只在名称列表里）',
  '报价.xlsx（2）（工作表：核对结果）',
 ].join('\n\n');
 const attachmentReads=[
  {at:'',kind:'read' as const,label:'读取附件',taskAttachmentId:first.id,taskAttachmentObservedSheets:['核对结果','Details']},
  {at:'',kind:'read' as const,label:'读取附件',taskAttachmentId:second.id,taskAttachmentObservedSheets:['只在名称列表里']},
 ];
 try{
  await act(async()=>root.render(<XiaozhuMarkdown text={text} index={[]} onOpen={vi.fn()} attachments={[first,second]} attachmentReads={attachmentReads} onOpenAttachment={preview}/>));
  const buttons=[...host.querySelectorAll('button')];
  expect(buttons).toHaveLength(4);
  await act(async()=>buttons.forEach(button=>button.click()));
  expect(preview.mock.calls).toEqual([[first,'核对结果'],[first,'Details'],[first],[second]]);
 }finally{await act(async()=>root.unmount());host.remove();}
});


it('links evidenced pages inside an unambiguous PDF section without guessing for the section heading',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host),preview=vi.fn();document.body.append(host);
 const first={id:'first',name:'quote.pdf',mimeType:'application/pdf',size:100};
 const second={...first,id:'second'};
 const text=[
  '**quote.pdf（1）**',
  '- 第 23 页有交期。\n- **第 22 页**无法核对。\n- 第 22 页至第 23 页不是单页。\n- 第 21 页未核实。\n- 第 23 页见 [另一原件](https://example.invalid/other.pdf)。',
  '### quote.pdf（2）',
  '第 21 页有日期。',
  '### 其他资料',
  '- 第 23 页与上一个原件无关。',
  '**quote.pdf**',
  '- 第 23 页无法区分原件。',
 ].join('\n\n');
 const attachmentReads=[
  {at:'',kind:'read' as const,label:'已读',taskAttachmentId:'first',taskAttachmentObservedPages:[22,23],taskAttachmentPageRange:{from:20,to:23}},
  {at:'',kind:'read' as const,label:'已读',taskAttachmentId:'second',taskAttachmentObservedPages:[21]},
 ];
 try{
  await act(async()=>root.render(<XiaozhuMarkdown text={text} index={[]} onOpen={vi.fn()} attachments={[first,second]} attachmentReads={attachmentReads} onOpenAttachment={preview}/>));
  const buttons=[...host.querySelectorAll('button')];
  expect(buttons.map(button=>button.textContent)).toEqual(['quote.pdf（1）','第 23 页','第 22 页','quote.pdf（2）','第 21 页']);
  await act(async()=>buttons.forEach(button=>button.click()));
  expect(preview.mock.calls).toEqual([[first],[first,23],[first,22],[second],[second,21]]);
 }finally{await act(async()=>root.unmount());host.remove();}
});


it('opens an observed worksheet from separate report details without choosing an ambiguous or unread sheet', async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host),preview=vi.fn();
 document.body.append(host);
 const first={id:'a',name:'报价.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:120};
 const second={...first,id:'b'};
 const text=[
  '### 报价.xlsx（1）',
  '- 工作表：核对结果：报价正确。\n- 工作表：**核对结果 2026**\n- 工作表：核对结果、趋势。\n- 工作表：**核对结果**、趋势。\n- 工作表：内部底表。\n- 工作表：趋势见另一份.xlsx。',
  '**报价.xlsx（2）**',
  'worksheet: Details',
  '**报价.xlsx**',
  '工作表：核对结果。',
 ].join('\n\n');
 const attachmentReads=[
  {at:'',kind:'read' as const,label:'已读',taskAttachmentId:'a',taskAttachmentObservedSheets:['核对结果','核对结果 2026','趋势']},
  {at:'',kind:'read' as const,label:'已读',taskAttachmentId:'b',taskAttachmentObservedSheets:['Details','内部底表']},
 ];
 try {
  await act(async()=>root.render(<XiaozhuMarkdown text={text} index={[]} onOpen={vi.fn()} attachments={[first,second]} attachmentReads={attachmentReads} onOpenAttachment={preview}/>));
  const buttons=[...host.querySelectorAll('button')];
  expect(buttons.map(button=>button.textContent)).toEqual(['报价.xlsx（1）','工作表：核对结果','核对结果 2026','报价.xlsx（2）','worksheet: Details']);
  await act(async()=>buttons.forEach(button=>button.click()));
  expect(preview.mock.calls).toEqual([[first],[first,'核对结果'],[first,'核对结果 2026'],[second],[second,'Details']]);
 } finally {
  await act(async()=>root.unmount());
  host.remove();
 }
});
