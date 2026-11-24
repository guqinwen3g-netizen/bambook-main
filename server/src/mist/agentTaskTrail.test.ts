import { expect, it } from 'vitest';
import { platformTrail } from './agentTaskTrail';

const step = (name: string, args: Record<string, unknown>, result?: unknown) => ({ id: 's', at: '', plan: { name, arguments: args }, ...(result === undefined ? {} : { result }) }) as any;

it('names a record read by its number, and never shows an internal id while the read is still in flight', () => {
  const [done, pending, coded] = platformTrail([
    step('bambook_get', { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' }, { label: 'SO-G-2026-017' }),
    step('bambook_get', { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' }),
    step('bambook_get', { type: 'order', id: 'SO-G-2026-018' }),
  ]);
  expect(done.label).toBe('读取订单 SO-G-2026-017');
  expect(done.completed).toBe(true);
  expect(done.ref?.label).toBe('SO-G-2026-017');
  expect(pending.label).toBe('读取订单');
  expect(pending.completed).toBe(false);
  expect(pending.ref).toBeUndefined();
  expect(coded.label).toBe('读取订单 SO-G-2026-018');
});

it('links a read to the page the record lives on, including parent pages and sections, and names attachment reads by file', () => {
  const [receipt, bill, failed, file] = platformTrail([
    step('bambook_get', { type: 'receipt', id: 'rc1' }, { object: { label: 'rc1', link: 'bambook://open?view=procurement&id=po1' } }),
    step('bambook_get', { type: 'payable_bill', id: 'b1' }, { label: 'AP-1', link: 'bambook://open?view=payment-vouchers&id=b1&section=payables' }),
    step('bambook_get', { type: 'order', id: 'x' }, { error: true, link: 'bambook://open?view=orders%2Fdetail&id=x' }),
    step('bambook_file_text', { fileId: 'f1' }, { file: { id: 'f1', name: '采购合同 PO-12.docx' }, text: '…' }),
  ]);
  expect(receipt.ref).toEqual({ type: 'receipt', id: 'po1', label: 'rc1', view: 'procurement' });
  expect(bill.ref).toEqual({ type: 'payable_bill', id: 'b1', label: 'AP-1', view: 'payment-vouchers', section: 'payables' });
  expect(failed.ref).toBeUndefined();
  expect(file.label).toBe('读取附件 采购合同 PO-12.docx');
});

it('uses the known attachment name and safe failure details for a rejected continuation',()=>{
  const actual=platformTrail([
    step('bambook_file_text',{fileId:'from-record'},{file:{id:'from-record',name:'contract.pdf'},text:'private fixture contents'}),
    step('bambook_file_text',{fileId:'from-record',cursor:'aft1.fixture'},{error:true,message:'附件已变化，请从首段重新读取'}),
    step('bambook_file_text',{fileId:'private'},{error:true,message:'请求错误 private fixture secret'}),
    step('bambook_file_text',{fileId:'unseen'},{error:true,message:'原附件不存在或无权访问'}),
  ],[{id:'private',name:'private.pdf'}]);
  expect(actual[1]).toMatchObject({label:'附件读取失败 contract.pdf',detail:'原件已变化，无法继续读取',failed:true});
  expect(actual[2]).toMatchObject({label:'附件读取失败 private.pdf',failed:true});
  expect(actual[3]).toMatchObject({label:'附件读取失败',detail:'原件不存在或无权访问',failed:true});
  expect(JSON.stringify(actual)).not.toContain('private fixture');
  expect(JSON.stringify(actual)).not.toContain('aft1.');
});

it('names image-only PDF pages even when other pages in the window were readable',()=>{
  const [final,more]=platformTrail([
    step('bambook_file_text',{fileId:'mixed'},{file:{id:'mixed',name:'mixed.pdf'},kind:'pdf',text:'readable content',hasMore:false,range:{pageFrom:21,pageTo:23},pagesWithoutText:[22,22,99,'fixture-secret']}),
    step('bambook_file_text',{fileId:'mixed'},{file:{id:'mixed',name:'mixed.pdf'},kind:'pdf',text:'readable content',hasMore:true,range:{pageFrom:1,pageTo:20},pagesWithoutText:[3]}),
  ]);
  expect(final).toMatchObject({label:'读取附件 mixed.pdf',detail:'本次读取第 21 至 23 页；第 22 页无可提取文字'});
  expect(final.failed).toBeUndefined();
  expect(more.detail).toBe('本次读取第 1 至 20 页；第 3 页无可提取文字；还有后续内容');
});

it('links a completed relationship lookup to its source and indicates partial counts', () => {
  const args = { type: 'order', id: '7639f2bd-15de-4dc0-ba7c-0a1b2c3d4e5f' };
  const object = { ...args, label: 'SO-F-2026-0001', link: 'bambook://open?view=orders%2Fdetail&id=o1', total: 40, truncated: true, related: [{ label: 'private fixture' }] };
  const [done, empty, pending, failed] = platformTrail([
    step('bambook_related', args, { object }),
    step('bambook_related', args, { object: { ...object, total: 0, truncated: false, related: [] } }),
    step('bambook_related', args),
    step('bambook_related', args, { error: true, object }),
  ]);
  expect(done).toMatchObject({ label: '展开订单 SO-F-2026-0001 的关联记录', detail: '部分结果 · 共 40 条', ref: { type: 'order', id: 'o1', view: 'orders/detail' } });
  expect(empty).toMatchObject({ label: '展开订单 SO-F-2026-0001 的关联记录', detail: '0 条关联记录' });
  expect(pending).toMatchObject({ label: '展开订单的关联记录', completed: false });
  expect(failed).toMatchObject({ label: '展开订单的关联记录', failed: true });
  expect(failed.ref).toBeUndefined();
  expect(JSON.stringify(platformTrail([step('bambook_related', args, { object })]))).not.toContain('private fixture');
});
