import { describe, it, expect } from 'vitest';
import { parsePeerless } from '../parsers/peerless';
import { ACTUAL_PRICE_LINE, TOTAL_NET_LINE, peerlessHeaderLines } from './helpers/syntheticPdf';

// 依赖开发者本机真实客户 PO 文件的用例已移除（公开仓库不携带真实客户单据/联系人信息）；
// 解析行为由下方合成文本用例覆盖。

// ─────────────────────────────────────────────────────────────────────────────
// S4 处置 · 任务 1（P1）：必填金额行缺失 ⇒ 抛错，**不得静默写 0**
//
// 改前行为（已实测复现）：缺行时 `parseTotals` 返回 0 且不报错；0 会经
// `persistOrders.ts` 的 `parsed.totalActual ?? 0` / `?? null` 一路落库
// （`??` 只挡 null/undefined，挡不住 0）⇒ 生成一份"看起来成功、成交金额为 0"的订单。
//
// 注："缺行"场景必须合成文本覆盖。
// ─────────────────────────────────────────────────────────────────────────────
describe('parsePeerless — 必填金额行缺失 ⇒ 抛错（S4 任务 1）', () => {
  const HEADER = peerlessHeaderLines().join('\n');

  it('阳性对照：两行都在 ⇒ 正常返回数值（证明下面的红不是因为合成本文一律失败）', () => {
    const o = parsePeerless([HEADER, TOTAL_NET_LINE, ACTUAL_PRICE_LINE].join('\n'));
    expect(o.totalNet).toBeCloseTo(103680, 2);
    expect(o.totalActual).toBeCloseTo(103680, 2);
  });

  it('缺「Actual price」行 ⇒ 抛错，且**不是**返回 0', () => {
    const text = [HEADER, TOTAL_NET_LINE].join('\n');
    // 改前：这里返回 totalActual = 0（不抛）⇒ 本行咬红
    expect(() => parsePeerless(text)).toThrow();
    expect(() => parsePeerless(text)).toThrow(/未找到「Actual price」行/);
    expect(() => parsePeerless(text)).toThrow(/无法确定成交金额/);
  });

  it('缺「Tot. net item val. excl. tax」行 ⇒ 抛错（同族一并处理，不只改一半）', () => {
    const text = [HEADER, ACTUAL_PRICE_LINE].join('\n');
    // 改前：这里返回 totalNet = 0（不抛）⇒ 本行咬红
    expect(() => parsePeerless(text)).toThrow(/未找到「Tot\. net item val\. excl\. tax」行/);
    expect(() => parsePeerless(text)).toThrow(/无法确定净金额/);
  });

  it('两行都缺 ⇒ 抛错（不是两个 0）', () => {
    expect(() => parsePeerless(HEADER)).toThrow(/未找到「Tot\. net item val\. excl\. tax」行/);
  });

  it('★ 错误文案是"人话"：中文、可执行、不含正则原文/英文技术串', () => {
    let msg = '';
    try {
      parsePeerless([HEADER, TOTAL_NET_LINE].join('\n'));
    } catch (e: any) {
      msg = String(e?.message ?? e);
    }
    expect(msg).toContain('PO 解析失败');
    expect(msg).toContain('请核对 PDF 或让供应商重新出具');
    // 正则原文/元字符不得上屏（B33/B36/B37 族）
    expect(msg).not.toMatch(/\\s|\\d|\[A-Z\]|\(\[|\.\*|\?/);
    // 英文技术串写法不许照抄
    expect(msg).not.toMatch(/Peerless:.*not found/i);
    expect(msg).not.toMatch(/Actual price\s+\[/);
  });
});
