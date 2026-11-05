/**
 * §9 B33 第 7a 批 · `procurement/materialReturnService.ts`（5 处）收敛后的**执行**覆盖
 *
 * 为什么本批必须补这一份（R3 覆盖派生 / §6 S1）：
 *   7a 批把这 5 处 `fail('X', e?.message || '半截话', 500)` 改成了**字面中文**。
 *   棘轮（`serviceRawEchoRatchet.test.ts`）只数**语法形状**，它变绿只能证明"没有这种写法了"，
 *   **不能证明用户收到的是中文** —— 文案改动若无人执行，按 S1 不得写「已清」。
 *   所以本文件把"用户到底收到什么"钉成可执行断言。
 *
 * 判据来源（外部，不抄实现现值）：
 *   ① 未预期异常 ⇒ 500，且响应体不得含内部原文（G6.5 / RFC 9110 §15.6.1）；
 *   ② 对外文案必须含中文、说清对象与下一步（B31）；
 *   ③ 码名一字不改（前端按 `error.code` 分支，D34）—— 本批只换文案，不换码；
 *   ④ 原文**必须**仍在日志里（否则等于把线索删了：清文案 ≠ 丢证据）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../shared/__tests__/utils/sourceScan';

describe('B33 7a · 源码棘轮与文案质量（防"数字清了、文案还是半截话"）', () => {
  const src = () => stripComments(fs.readFileSync(path.join(__dirname, '..', 'materialReturnService.ts'), 'utf8'));

  it('★ 该文件「原文 || 中文兜底」必须为 0（阳性对照保证判据不是恒假）', () => {
    const re = /[A-Za-z_$][\w$]*\??\.message\s*(?:\|\||\?\?)\s*'/;
    expect(re.test(src()), 'materialReturnService.ts 仍在用原始异常当对外文案').toBe(false);
    // 阳性对照：旧写法必须被抓到
    expect(re.test("return fail('SETTLE_FAILED', e?.message || '结算完成失败', 500);")).toBe(true);
    // 反向：有意透传业务错误自带的文案（不带 || 兜底）不算 B33
    expect(re.test("return fail(e.code, e.message);")).toBe(false);
  });

  it('★ 5 条对外文案逐条合格：含中文、≥20 字、说清对象与下一步，且互不共用同一句', () => {
    const copies = [...src().matchAll(/fail\('(CREATE_FAILED|SHIP_FAILED|CONFIRM_FAILED|SETTLE_FAILED|CANCEL_FAILED)', '([^']*)'/g)]
      .map((m) => ({ code: m[1], copy: m[2] }));
    expect(copies.map((c) => c.code).sort()).toEqual(
      ['CANCEL_FAILED', 'CONFIRM_FAILED', 'CREATE_FAILED', 'SETTLE_FAILED', 'SHIP_FAILED']);
    for (const { code, copy } of copies) {
      expect(copy, `${code} 文案不合格`).toMatch(/[\u4e00-\u9fa5]/);
      expect(copy.length, `${code} 文案过短`).toBeGreaterThanOrEqual(20);
      expect(copy, `${code} 文案没给下一步`).toMatch(/(稍后重试|联系管理员)/);
    }
    expect(new Set(copies.map((c) => c.copy)).size, '5 条文案不得共用一句（共用=用户分不清哪步失败了）').toBe(5);
    // 旧的半截话一处都不许剩
    for (const legacy of ['退换货登记失败', '发运确认失败', '供应商确认失败', '结算完成失败', '取消失败']) {
      expect(src(), `残留旧半截话「${legacy}」`).not.toContain(`'${legacy}'`);
    }
  });

  /**
   * ★ 本批唯一一处**不敢套模板**的文案：`markShipped` 的出库流水在事务**之前**已落库
   *   （幂等防重会兜住重试），所以失败时"没有写入任何数据"是**假话**。
   *   这条断言把"文案不得给业务员假结论"变成可执行的 —— 谁把它改成统一模板，这里就红。
   */
  it('★ 文案不得给假结论：有事务前副作用的出口不许说"没有写入任何数据"', () => {
    const s = src();
    const copyOf = (code: string) =>
      s.match(new RegExp(`fail\\('${code}', '([^']*)'`))?.[1] ?? '';
    // markShipped（事务前有 Outbound 出库）与 confirmReturn（事务前有 exchange Inbound 回冲）：
    // 文案只承诺"状态未变更"
    expect(copyOf('SHIP_FAILED'), 'markShipped 事务前已写出库流水 ⇒ 不得声称零写入').not.toContain('没有写入任何数据');
    expect(copyOf('SHIP_FAILED')).toContain('仍停在待退回状态');
    expect(copyOf('CONFIRM_FAILED'), 'confirmReturn 事务前已写回冲流水 ⇒ 不得声称零写入').not.toContain('没有写入任何数据');
    expect(copyOf('CONFIRM_FAILED')).toContain('仍停在已退回状态');
    // 纯状态流转的三处（登记/结算/取消）：全在事务内 ⇒ "零写入"是可证成立的
    for (const code of ['CREATE_FAILED', 'SETTLE_FAILED', 'CANCEL_FAILED']) {
      expect(copyOf(code), `${code} 全在事务内，应明确告知未写入`).toContain('没有写入任何数据');
    }
  });
});
