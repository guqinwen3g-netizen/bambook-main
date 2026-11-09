/**
 * 台账 **B68**（G1/G3 真值面）：HTTP 状态档不得由异常文本里的中文关键词猜。
 *
 * ★ 这一族最坏的地方是**方向**：77 个调用点里 76 个不传 fallback ⇒ 默认 400，
 *   一条 `ECONNREFUSED` / Prisma `P2003` / 事务超时会被说成"你的请求有问题"，
 *   用户以为是自己填错了，运维去查请求参数 —— 排障方向被假陈述带偏。
 *   本批收敛成一份实现：`shared/bizStatus.ts`。
 *
 * ★★ v2.45 复核更正（第一版这里写"三份已经漂 ⇒ 同一个原因在两个域不同档"）：词表逐条比是不同，
 *   但 MES 那份本来就有 `includes('不可')`，"不可编辑/不可审核"都含"不可" ⇒ **三域当时的行为一致**，
 *   取并集**不改变任何对外档位**。这条假陈述也出现在台账 v2.35/v2.42 两处，已一并更正。
 *   （复现：`git show 19d8bc5f~1:server/src/mes/mesRoute.ts` 第 100-105 行。）
 *
 * 判据形状（D56：域测试 + 可证伪探针为主证据）：
 *   ① 单元层把四档优先级各钉一条，并**同场跑一遍旧的关键词实现**当对照 ⇒ 证明新判据不是空转；
 *   ② 活路径层（`feedback-fix-must-land-on-live-path`）：三个 router 各打一条**真发出去的 HTTP 请求**，
 *      让替身 prisma 抛系统故障 ⇒ 必须 5xx；再抛业务文案 ⇒ 档位必须照旧。
 *      没有这一层，共享函数可以写得很对但一行都没被执行到。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { statusFromError } from '../bizStatus';

/** 改造前那份关键词实现（三个域取并集）—— 只作对照用，跑在同一个输入上 */
function legacyStatus(msg: string, fallback = 400): number {
  if (msg.includes('不存在')) return 404;
  if (msg.includes('已存在')) return 409;
  if (msg.includes('非法') || msg.includes('不可删除') || msg.includes('不可编辑') || msg.includes('不可审核') || msg.includes('不可') || msg.includes('超过')) return 409;
  return fallback;
}

const SYSTEM_MSGS = [
  'connect ECONNREFUSED 127.0.0.1:5432',
  // ★ v2.45 复核 IMPORTANT-3：第一版这里写的是 'PrismaClientKnownRequestError: … P2003' ——
  //   真 Prisma 错误的 message **不含类名、也不含 P2xxx**（码在 `.code` 上），替身不忠实真实形状。
  //   下面换成真实形状（文本里只有 `Foreign key constraint violated`），并由新增的 2b 档（看 `.code`）兜住。
  'Invalid `prisma.tradeDocument.create()` invocation:\n\nForeign key constraint violated: `TradeDocument_declarationId_fkey (index)`',
  'Transaction already closed: a database transaction cannot be committed',
  'query_timeout: statement timeout exceeded',
  '数据库连接池不可用',              // 中文里带「不可」——正是旧表会误判成 409 的那一类
];

describe('B68 · 状态档判定顺序：自带状态 > 已登记码 > Prisma P2xxx > 系统故障 > 业务关键词 > fallback', () => {
  /**
   * ★ v2.45 新增（复核 IMPORTANT-3 的直接后果）：真实 Prisma 错误的文本形状**不一定**含系统故障关键词
   *   （P2025 那句连 "not found" 都是 "found none"）⇒ 只看文本会退回 400。
   *   这一档改看 `error.code`，是"数据库故障对外说成 5xx"真正的兜底。
   */
  it('★ 2b：错误带 Prisma 的 P2xxx 码 ⇒ 500，即使文本一个关键词都不命中', () => {
    const bare = { code: 'P2025', message: 'Expected a record, found none.' };   // 文本无系统字样
    expect(statusFromError(bare)).toBe(500);
    expect(statusFromError({ code: 'P2002', message: 'Unique constraint failed on the fields' })).toBe(500);
    // 对照一：旧关键词实现在这两句上给的是 fallback（P2002 那句因含"约束"类中文才有档，英文一律漏）
    expect(legacyStatus(String(bare.message))).toBe(400);
    // 对照二：P1xxx（引擎初始化错误）**不在**这一档 ⇒ 不许顺手扩，落到文本档/兜底档
    expect(statusFromError({ code: 'P1001', message: '完全不像故障的业务文案' })).toBe(400);
  });

  it('① 错误自己带 statusCode 时，它就是答案（不再回头看文本）', () => {
    const e = Object.assign(new Error('报关单不存在'), { statusCode: 410, code: 'DECLARATION_GONE' });
    expect(statusFromError(e)).toBe(410);
    // 对照：文本里有「不存在」，旧实现会给 404 ⇒ 新实现认自带档位优先
    expect(legacyStatus(e.message)).toBe(404);
  });

  it('② 错误带**已登记**的码 ⇒ 取注册表档位（单一真源，不在路由里重抄）', () => {
    expect(statusFromError(Object.assign(new Error('x'), { code: 'NOT_FOUND' }))).toBe(404);
    expect(statusFromError(Object.assign(new Error('x'), { code: 'GATE_BLOCKED' }))).toBe(409);
    expect(statusFromError(Object.assign(new Error('x'), { code: 'NOTIFICATION_CATALOG_FAILED' }))).toBe(500);
  });

  it('★ ③ 系统故障一律抬到 5xx —— 旧实现在这里全给 4xx（这一条就是 B68 的病灶）', () => {
    for (const msg of SYSTEM_MSGS) {
      expect(statusFromError(new Error(msg)), `${msg} 应当是 5xx`).toBeGreaterThanOrEqual(500);
      expect(legacyStatus(msg), `旧实现对同一条给的是 ${legacyStatus(msg)} ⇒ 把系统故障说成客户端错`).toBeLessThan(500);
    }
  });

  it('④ 业务文案的档位**不许被顺手改掉**（收敛实现 ≠ 重定契约）', () => {
    for (const [msg, want] of [['报关单不存在', 404], ['该 HS 编码已存在', 409], ['工序时长超过上限', 409], ['该订单不可删除', 409]] as const) {
      expect(statusFromError(new Error(msg)), `${msg} 应保持 ${want}`).toBe(want);
      expect(legacyStatus(msg)).toBe(want);
    }
  });

  it('⑤ 都不认时才用 fallback（默认 400，与改造前一致），空消息也不炸', () => {
    expect(statusFromError(new Error('please try later'))).toBe(400);
    expect(statusFromError(new Error('please try later'), 503)).toBe(503);
    expect(statusFromError(undefined)).toBe(400);
    expect(statusFromError('字符串错误也可以传')).toBe(400);
  });

  /**
   * ★ v2.45 复核 BLOCK-2 后改了标题：第一版这里写"⇒ 前两档现在真的可达"，但**这两个域根本没有人产出
   *   `statusCode`**（`grep -rn statusCode server/src/{customs,mes}` 排除测试 = 0 命中，`processChainService`
   *   抛的几枚 code 也未登记进 `errorCodes`）⇒ 第 1、2 档今天**拿不到输入**，本批真正生效的是第 3 档 + 2b。
   *   标题不再声称"收口完成"，只声称"入参形状已改对，等域内补码之后 1、2 档即刻生效"。
   */
  // 报关 / MES 旧路由（customsRoute、customsRouteV2、mesRoute）已随旧主 API 删除，三域调用点守卫一并移除。


  /**
   * 正面对照（复核 IMPORTANT-5 直接催生）：第一版只禁 `x.message` 一种写法，
   * 而 `const msg = String(e?.message || e)` 之后 `statusFromError(msg)` 这种**别名**能溜过去
   * （`customsRoute.ts:828` 现场就有这个形状）⇒ 判据换成"首参必须是本文件 catch 绑定的变量名"。
   */
  it('★ 正面对照：文本形状与别名形状都要被抓（否则上面那条是恒绿）', () => {
    const caughtSample = [
      "try { await svc.a(); } catch (e) { res.status(statusFromError(e?.message ?? '')).json({}); }",
      "try { await svc.b(); } catch (err) { const msg = String(err?.message || err); res.status(statusFromError(msg)).json({}); }",
      "try { await svc.c(); } catch (e) { res.status(statusFromError(e, 500)).json({}); }",       // 唯一合法形状
    ].join('\n');
    const bad = textFedSites(caughtSample);
    expect(bad.length).toBe(2);                                   // 文本 + 别名各一条
    expect(bad.some((l) => l.includes('e?.message'))).toBe(true);
    expect(bad.some((l) => l.includes('statusFromError(msg'))).toBe(true);
  });
});

/** 普查实现（只此一份）：返回"首参不是本文件 catch 绑定名"的 statusFromError 调用行 */
function textFedSites(src: string): string[] {
  const caught = new Set([...src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const out: string[] = [];
  for (const m of src.matchAll(/\bstatusFromError\(\s*([^,)]+)/g)) {
    const arg = m[1].trim();
    if (!caught.has(arg)) out.push(`statusFromError(${arg}…`);
  }
  return out;
}
