// V1 2026-10-01: restore typed business errors across development, samples, procurement and finance;
// original 149-site census is historical. New alias-only writers were corrected, never grandfathered.
/**
 * §9 **B34** · 抛错只带 `code` 不带 `statusCode` ⇒ 会被"兜底文案"吞掉（计量棘轮，只减不增）
 *
 * 机理（一条**结构性陷阱**，不是某个域的个案）：
 *   `resolveError` 判"业务错误"的条件是 `code` 是 string **且** `statusCode` 是 number
 *   （`shared/errorCodes.ts` 的 `isBusinessError`）。只有 `code` 的抛错因此走**未预期分支**：
 *   状态由兜底码查表（查不到就 500），**文案换成兜底文案 ⇒ 服务层那句给用户看的中文校验提示消失**。
 *   而"把路由出口接到真源"这个动作（§9 B22 的收敛）恰恰会让这类抛错第一次经过这条分支
 *   ⇒ **收敛一个域之前，必须先确认该域的抛点带不带 `statusCode`**，否则收口 = 悄悄改坏提示文案。
 *
 * 本批（第 6 域 samples）实测撞到的就是这个形状 ⇒ 记 B34。
 *
 * ★ **本条判据自己的第 1 次误判（2026-09-20 15:20，由独立复核抓到）**：
 *   初版用正则 `Object\.assign\(\s*new Error\([\s\S]{0,240}?\),\s*\{([^}]*)\}\s*\)`，
 *   它**整类漏**两种常见写法：① 属性对象里出现任何 `}`（嵌套对象、`...(cond ? { a: 1 } : {})`）；
 *   ② 实参列表带**尾逗号**（`{…},\n)`）—— `\s*\)` 直接失配。
 *   后果：**基线 121 处 / 31 文件是虚低的**，实测应为 **149 处 / 33 文件**（最大单文件
 *   `shipping/allocationService.ts` 7 → 21）。虚低比虚高更阴 —— 它不会让任何一次"清了一批"看起来失败，
 *   只会让**剩下 28 处从来没进过账**。判据已换成括号配对扫描（`scripts/lib/errorDebtScanners.mjs` 的 `b34Sites`，
 *   与度量脚本共用同一份 ⇒ 两处不可能再给出两个数）。
 *
 * **本文件只计量、不判定可达性**：
 *   计数口径 = 同一文件内 `Object.assign(new Error(…), { … })` 且最后一个实参里没有 `statusCode`。
 *   ⚠️ **盲区（必须写出来，别把计量当结论）**：
 *     ① 这些抛点里有很多被**服务自己的 catch** 转成 `{ok:false, error:{code,message}}` 返回值，
 *        根本走不到路由 ⇒ 不构成缺陷；但"哪些走不到"要按调用链逐处核，文本判据核不出来；
 *        （15:20 独立复核已逐处核过**已收敛的五域**：结论 = **无回归**，全部被服务层 catch 吸收，
 *         且收敛过的出口是逐字打印 `result.error.message`。另记三处"假安全"进 §9 B34 处置栏。）
 *     ② `httpStatus` 等别名**照样计入** —— 这是对的：`isBusinessError` 只认 `statusCode`，写别名同样是缺陷；
 *     ③ 自定义 Error 子类里带 statusCode 的看不见（只扫 `Object.assign` 形状）。
 *
 * 基线取样：2026-09-20 15:35（判据修正后重测）⇒ **33 个文件 / 149 处**。只许减不许增。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { b34Sites, countByFile, scanSources, stripComments } from '../../../scripts/lib/errorDebtScanners.mjs';
import { classifyPrivateSymbolRefusals } from '../../../../scripts/lib/tierMessageSources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', '..', '..');

/** 初版那条**会漏数**的正则，只为反面对照留在测试里（生产判据是 lib 的 b34Sites）。 */
const LEGACY_ASSIGN_RE = /Object\.assign\(\s*new Error\([\s\S]{0,240}?\),\s*\{([^}]*)\}\s*\)/g;
const legacyCount = (s: string) => [...s.matchAll(LEGACY_ASSIGN_RE)].filter((m) => !/\bstatusCode\b/.test(m[1])).length;
// A private marker is not a public code-only business error. It is classified
// separately only when the actual finite producer AND catch consumer are proved.
// Any incomplete/changed witness remains in the old debt inventory and cap.
const debtSites = (src: string) => {
  const internal = new Set(classifyPrivateSymbolRefusals(src).map((site: { index: number }) => site.index));
  return b34Sites(src).filter((site: { index: number }) => !internal.has(site.index));
};
const legacyDebtCount = (src: string) => {
  const internal = new Set(classifyPrivateSymbolRefusals(src).map((site: { index: number }) => site.index));
  return [...src.matchAll(LEGACY_ASSIGN_RE)]
    .filter(match => !/\bstatusCode\b/.test(match[1]) && !internal.has(match.index!)).length;
};

/** 旧正则整类漏掉的两种真实形状（逐字取自本仓，见下面那条对照用例） */
const MISSED_SHAPES = [
  // ① 尾逗号：`{ … },\n)` —— `\s*\)` 失配
  "throw Object.assign(new Error('已出运，不能再改'), {\n  code: 'SHIPMENT_ALREADY_SHIPPED',\n},);",
  // ② 对象里带嵌套 `}` —— `[^}]*` 截断
  "throw Object.assign(new Error('价差超限'), { code: 'PRICE_DEVIATION_BLOCKED', ...(x.ok ? { id: 1 } : {}) });",
];

function countByFileHere(): Record<string, number> {
  return countByFile(scanSources(SERVER), debtSites) as Record<string, number>;
}

/**
 * 冻结基线（2026-09-20 15:35 实测，33 个文件全量）。给抛点补上 `statusCode` 就删掉那一行并同步改小总数。
 * ⚠️ 这张表初版只写了前 14 大 ⇒ 守卫当场把另外 17 个报成"新长出"（**虚报，不是缺陷**）：
 *    总数与文件数一开始就对得上，是明细不全。**报"某文件涨了"之前必须先核对明细是否全量** —— 已写在这里防下次再犯。
 */
const BASELINE: Record<string, number> = {
  // 2026-11-06：删除旧主 API 死代码时一并移除已删除文件的行（只减不增）。
  'src/internalTrade/internalTransferService.ts': 1,
  'src/orderChanges/orderChangeRequestService.ts': 2,
  'src/orders/toleranceCore.ts': 2,
  'src/quotations/quotationService.ts': 2, // two native typed refusals retired; remaining two stay debt.
  'src/relations/relationMutationService.ts': 1,
  'src/shipping/allocationService.ts': 21,
};

describe('B34 · 抛点缺 statusCode 的计量（只减不增）', () => {
  const actual = countByFileHere();

  it('★ 总数与文件数等于基线；任一文件涨了当场红', () => {
    const total = Object.values(actual).reduce((a, b) => a + b, 0);
    // Fixed c9ab5189: original toolRuntime four and quotationService two
    // retired; new quotationApproval/packing sites were fixed in production,
    // never grandfathered. Original scanner and every negative control remain.
    expect(total, `全仓公开「抛点缺 statusCode」总数（2026-11-06 删除旧主 API 死代码后，按保留文件的原基线重算）`).toBe(29);
    expect(Object.keys(actual).length, '含此类抛点的文件数').toBe(6);
    const grew = Object.entries(actual)
      .filter(([f, n]) => (BASELINE[f] ?? 0) < n)
      .map(([f, n]) => `${f}: 基线 ${BASELINE[f] ?? 0} → 实际 ${n}`);
    expect(grew, `新长出缺 statusCode 的抛点（收敛过的域里它会吞掉用户文案）：${JSON.stringify(grew)}`).toEqual([]);
    const stale = Object.entries(BASELINE)
      .filter(([f, n]) => (actual[f] ?? 0) < n)
      .map(([f, n]) => `${f}: 基线 ${n} → 实际 ${actual[f] ?? 0}`);
    expect(stale, `补过 statusCode 就同步删掉那一行（留旧数会掩盖下一次回潮）：${JSON.stringify(stale)}`).toEqual([]);
  });

  it('★ 判据修正的正反对照：旧正则漏的两种形状，新判据必须数到', () => {
    for (const src of MISSED_SHAPES) {
      expect(legacyCount(src), `旧正则应当漏掉这一形（否则本对照没有意义）：${src}`).toBe(0);
      expect(b34Sites(src).length, `新判据必须数到：${src}`).toBe(1);
    }
    // 全仓差额 = 判据修正捞回来的量。这个数字本身要能被证伪：它必须**等于**逐文件明细之和的差。
    const legacyTotal = scanSources(SERVER)
      .reduce((sum, { src }) => sum + legacyDebtCount(src), 0);
    expect(legacyTotal, '固定 c9ab5189 旧正则数99，原判据数122（虚低23）；历史100/128保留在来源证据').toBe(99);
    expect(122 - legacyTotal, '虚低量必须显式记账，不能悄悄换基线').toBe(23);
  });

  it('双向对照：带 code 没 statusCode 算、补齐了不算、注释里不算', () => {
    const bad = "throw Object.assign(new Error('非法疵点原因：X'), { code: 'INVALID_DEFECT_CAUSES' });";
    const good = "throw Object.assign(new Error('非法疵点原因：X'), { code: 'INVALID_DEFECT_CAUSES', statusCode: 400 });";
    expect(b34Sites(bad)).toHaveLength(1);
    expect(b34Sites(good)).toHaveLength(0);
    expect(b34Sites(stripComments("// throw Object.assign(new Error('x'), { code: 'C' });"))).toHaveLength(0);
    // 别名不算（`httpStatus` 走不到 isBusinessError ⇒ 同样是缺陷，必须计入）
    expect(b34Sites("throw Object.assign(new Error('x'), { code: 'C', httpStatus: 400 });")).toHaveLength(1);
    // 判据可被满足：唯一能让它变绿的动作就是补 statusCode（上面 good 那条已证）
    // 反向自检：判据不能恒不匹配（恒不匹配会让上面那条"只减不增"永远绿）
    expect(Object.keys(actual).length, '基线为空 = 没有守卫').toBeGreaterThan(0);
  });

  it('★ 真源文件自己就是这条判据的正面样本：isBusinessError 要的是两件套', async () => {
    const { resolveError } = await import('../errorCodes');
    // 只带 code ⇒ 走未预期分支 ⇒ 文案被换掉（这就是 B34 的后果，不是设想）
    const onlyCode = resolveError(Object.assign(new Error('非法疵点原因：X'), { code: 'INVALID_DEFECT_CAUSES' }), 'FEEDBACK_FAILED');
    expect(onlyCode.code).toBe('FEEDBACK_FAILED');
    expect(onlyCode.message, '服务层那句中文校验提示在这里被兜底文案顶掉').not.toContain('非法疵点原因');
    // 两件套齐全 ⇒ 原样透传
    const both = resolveError(Object.assign(new Error('非法疵点原因：X'), { code: 'INVALID_DEFECT_CAUSES', statusCode: 400 }), 'FEEDBACK_FAILED');
    expect(both.status).toBe(400);
    expect(both.message).toContain('非法疵点原因');
  });
});
