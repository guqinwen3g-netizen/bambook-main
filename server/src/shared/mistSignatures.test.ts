import { describe, expect, it } from 'vitest';
import { mistCommandRequiresSignature, normalizeSignatureSvg, signatureEntityId } from './mistSignatures';
import { signatureSvg } from '../../../components/mist/SignaturePad';
import { TEST_SIGNATURE_SVG } from '../mist/__tests__/signature';

const approve = (type: string) => ({ type, payload: { id: 'x', decision: 'approved', note: 'ok' } });
const reject = (type: string) => ({ type, payload: { id: 'x', decision: 'rejected', note: 'no' } });
const invalid = { code: 'VALIDATION', status: 422, message: '签字无效，请重新签字' };

describe('签字要求', () => {
  it.each(['order.governance.decide', 'fulfillment.procurement.decide', 'fulfillment.procurement.amend.decide', 'payable.request.decide', 'fulfillment.stock.count.decide'])('%s 仅批准需要签字', type => {
    expect(mistCommandRequiresSignature(approve(type))).toBe(true);
    expect(mistCommandRequiresSignature(reject(type))).toBe(false);
  });
  it('结算复核、退税核准始终需要；核销只在坏账与红冲更正时需要', () => {
    expect(mistCommandRequiresSignature({ type: 'payable.settlement.confirm', payload: { id: 's', prepaymentApplied: 0 } })).toBe(true);
    expect(mistCommandRequiresSignature({ type: 'rebate.claim.approve', payload: { id: 'r' } })).toBe(true);
    for (const kind of ['badDebt', 'correction']) expect(mistCommandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i', kind } })).toBe(true);
    expect(mistCommandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i', kind: 'difference' } })).toBe(false);
    expect(signatureEntityId({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i', kind: 'badDebt' } })).toBe('i');
  });
  it('其他审批与普通命令不需要', () => {
    for (const type of ['market.quotation.decide', 'platform.claim.decide', 'platform.risk.decide', 'fulfillment.qc.concession.decide', 'payable.settlement.return', 'rebate.claim.file', 'order.create', 'fulfillment.documents.issue'])
      expect(mistCommandRequiresSignature(approve(type))).toBe(false);
  });
});

describe('签字 SVG 规范化', () => {
  it('接受签字板的实际输出并按数值重新生成', () => {
    const pad = signatureSvg([[{ x: 40, y: 100, w: 2.7 }, { x: 60.04, y: 80, w: 2.2 }, { x: 90, y: 96, w: 1.8 }], [{ x: 200, y: 60, w: 3 }]]);
    const out = normalizeSignatureSvg(pad);
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="32 52 176 56" width="176" height="56" fill="none" stroke="#0E1A21"/);
    expect(out.match(/<path /g)).toHaveLength(2);
    expect(out).toContain('<circle cx="200" cy="60" r="1.5" fill="#0E1A21"/>');
    expect(normalizeSignatureSvg(out)).toBe(out);
    expect(normalizeSignatureSvg(TEST_SIGNATURE_SVG)).toContain('<path d="M60 90Q72.4 60.2 88.1 75.3" stroke-width="2.7"/>');
  });
  it.each([
    ['脚本', TEST_SIGNATURE_SVG.replace('</svg>', '<script>alert(1)</script></svg>')],
    ['链接', TEST_SIGNATURE_SVG.replace('<circle', '<a href="javascript:alert(1)"><circle').replace('</svg>', '</a></svg>')],
    ['外部引用', TEST_SIGNATURE_SVG.replace('<circle', '<use href="#x"/><circle')],
    ['事件属性', TEST_SIGNATURE_SVG.replace('stroke-width="2.70"/>', 'stroke-width="2.70" onload="x()"/>')],
    ['实体', '<!DOCTYPE svg [<!ENTITY x "y">]>' + TEST_SIGNATURE_SVG],
    ['其他标签', TEST_SIGNATURE_SVG.replace('<circle', '<image href="data:image/png;base64,AAAA"/><circle')],
    ['根属性', TEST_SIGNATURE_SVG.replace('fill="none"', 'fill="none" style="x"')],
    ['非数字路径', TEST_SIGNATURE_SVG.replace('M60.0 90.0', 'M60.0 90.0 L 1e9')],
    ['尾部文字', TEST_SIGNATURE_SVG + 'x'],
    ['空签字', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="#0E1A21" stroke-linecap="round" stroke-linejoin="round"></svg>'],
    ['空串', ''],
    ['非字符串', { svg: TEST_SIGNATURE_SVG }],
  ])('拒绝%s', (_label, input) => { expect(() => normalizeSignatureSvg(input)).toThrow(expect.objectContaining(invalid)); });
  it('拒绝超过 64 KB 或超过 4000 段的签字', () => {
    const seg = '<path d="M1 1Q2 2 3 3" stroke-width="1"/>';
    const head = TEST_SIGNATURE_SVG.slice(0, TEST_SIGNATURE_SVG.indexOf('<path'));
    expect(() => normalizeSignatureSvg(head + seg.repeat(4001) + '</svg>')).toThrow(expect.objectContaining(invalid));
    expect(() => normalizeSignatureSvg(head + seg.repeat(1700) + '</svg>')).toThrow(expect.objectContaining(invalid));
    expect(normalizeSignatureSvg(head + seg.repeat(1500) + '</svg>').match(/<path /g)).toHaveLength(1500);
  });
});
