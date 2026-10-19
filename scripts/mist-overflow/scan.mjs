#!/usr/bin/env node
/**
 * Mist 自适应溢出扫描（全量 / 快速回归）。
 *
 *   npm run mist:overflow            全量：全部主路由、页签、详情（每类第一个对象）、新建页、常用弹窗与抽屉
 *                                     × 16 个宽度 × 浅色 / 深色
 *   npm run mist:overflow:quick      快速回归：代表性页面 × 6 个宽度 × 浅色 / 深色，有溢出即失败
 *
 * 数据：本地独立模式（`npm run dev:mist`，local-file 存储 + 演示种子），以「本地操作员」合成身份登录；
 * 未检测到 http://127.0.0.1:3001 时自动启动本地栈，结束后只关闭本次启动的服务。不连接正式环境与真实数据。
 * 扫描期间把当前工作区主题设为「跟随系统」以便切换浅色 / 深色，结束后恢复原设置。
 * 人事等公司账号页面须使用隔离 PostgreSQL 服务：MIST_OVERFLOW_BASE 指向本机前端，
 * MIST_OVERFLOW_ACCOUNT_FILE 指向私有 JSON {email,password,workspaceId,workspaceName}；凭据与运行证据不入库。
 * 全量扫描须准备对应模拟记录（如一条客诉案件）；缺入口 / 空数据 / 运行错误不再算通过。
 *
 * 选项：--quick  --out <dir>  --widths 360,390  --themes light,dark  --only orders,risks  --workers 4
 *       --report-only（有问题也以 0 退出，用于产出修复前清单）  --selftest（只跑判定自检夹具）
 * 环境：MIST_OVERFLOW_BASE（默认 http://127.0.0.1:3001）、CHROMIUM（浏览器可执行文件路径）
 * 同时检查贴边叠放（detectStacking：相邻卡片 / 提示条等「面」之间没有间距），类型记为 stack-touching，与溢出一样计入问题。
 * 输出：<out>/report.json 与 <out>/report.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { detectOverflow, detectStacking } from './detect.mjs';
import { selfTest } from './selftest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const QUICK = flag('quick');
const ACCOUNT_FILE = process.env.MIST_OVERFLOW_ACCOUNT_FILE;
const account = ACCOUNT_FILE ? JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')) : null;

const BASE = (process.env.MIST_OVERFLOW_BASE || 'http://127.0.0.1:3001').replace(/\/$/, '');
if (account && (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname) || typeof account.email !== 'string' || typeof account.password !== 'string')) throw new Error('公司账号扫描只接受本机隔离服务及有效的私有账号文件');
/**
 * 宽度：窄屏加密；每个断点（640 / 720 / 760 / 1180 / 1320，max-width）取「仍保持宽布局的最窄宽度」+1px，
 * 那是切换布局前最挤的状态；宽屏保留 1440 / 1920 各一个。
 */
const FULL_WIDTHS = [360, 375, 390, 414, 600, 641, 721, 761, 768, 900, 1024, 1181, 1280, 1321, 1440, 1920];
const QUICK_WIDTHS = [360, 390, 761, 1024, 1181, 1440];
const widths = (option('widths') ? option('widths').split(',').map(Number) : QUICK ? QUICK_WIDTHS : FULL_WIDTHS);
const themes = (option('themes') || 'light,dark').split(',');
const only = option('only') ? new Set(option('only').split(',')) : null;
const workers = Number(option('workers', 4));
const outDir = path.resolve(option('out', path.join(ROOT, 'mist-overflow', QUICK ? 'quick' : 'full')));
const reportOnly = flag('report-only');

/** 固定页面清单：侧栏全部主路由 + 侧栏外入口。不做自动点击探索。 */
const VIEWS = ['cockpit', 'calendar', 'relations', 'crm', 'suppliers', 'seasons', 'marketing', 'products', 'development', 'samples', 'quotations', 'orders', 'production-board', 'procurement', 'inventory', 'qc-workbench', 'shipments', 'customs', 'document-center', 'payment-vouchers', 'pricing', 'bom', 'risks', 'claims', 'assistant', 'data-center', 'hr', 'reports', 'business-tools', 'admin-panel', 'design-system', 'states', 'system-settings',
  'approvals', 'notifications', 'search', 'workspace-settings', 'emails', 'invoices', 'dashboard', 'mes'];
/** 有列表的页面再扫第一个对象；详情可能是独立页、预览或抽屉，须核实预期内容。 */
const DETAIL_VIEWS = ['relations', 'crm', 'suppliers', 'seasons', 'marketing', 'products', 'development', 'samples', 'quotations', 'orders', 'production-board', 'procurement', 'inventory', 'qc-workbench', 'shipments', 'customs', 'document-center', 'payment-vouchers', 'pricing', 'bom', 'risks', 'claims', 'hr', 'approvals', 'invoices'];
/** 常用新建弹窗 / 编辑页：点页头第一个「新建 / 登记」类按钮。 */
const CREATE_VIEWS = ['risks', 'claims', 'suppliers', 'procurement', 'shipments', 'quotations', 'samples', 'crm', 'relations', 'invoices'];
const CREATE = /^(?:[+＋]\s*)?(?:新建|新增|手工登记|登记|创建|添加|发起|录入)/;
const DETAIL_SETUP = {
  'production-board': { actions: [{ click: '.mist-kb-card' }], expected: { selector: '[role="dialog"]' } },
  inventory: { expected: { selector: '[data-stock-detail]' } },
  'qc-workbench': { actions: [{ click: '.mist-task[data-workbench-item]' }], expected: { selector: '[data-qc-detail]' } },
  'payment-vouchers': { expected: { text: '此流水核销记录' } },
  pricing: { actions: [{ tab: '参数快照' }, { row: true }], expected: { text: '只读参数快照' } },
  hr: { actions: [{ tab: '全部人员' }, { row: true }], expected: { selector: '[role="dialog"]' } },
  approvals: { actions: [{ tab: '已处理' }, { row: true }], expected: { selector: '[data-approval]' } },
};
const CREATE_BUTTON = { crm: '新建客户', relations: '建立关系档案', invoices: '导入期初应收' };
const STATES = [
  ...VIEWS.map(v => ({ id: v, label: v, url: '?view=' + v })),
  { id: 'development/new', label: '新建开发案', url: '?view=development/new' },
  { id: 'orders/new', label: '新建订单', url: '?view=orders/new' },
  ...DETAIL_VIEWS.map(v => ({ id: v + '#detail', label: v + ' · 第一个对象详情', url: '?view=' + v, actions: [{ row: true }], ...DETAIL_SETUP[v] })),
  ...CREATE_VIEWS.map(v => ({ id: v + '+create', label: v + (v === 'invoices' ? ' · 期初应收导入' : ' · 新建'), url: '?view=' + v, actions: [CREATE_BUTTON[v] ? { button: CREATE_BUTTON[v] } : { create: true }], expected: { selector: '[role="dialog"], .mist-wizard' } })),
  { id: 'cockpit+palette', label: '命令面板', url: '?view=cockpit', actions: [{ press: 'Control+k' }] },
  { id: 'cockpit+account', label: '账号抽屉', url: '?view=cockpit', actions: [{ click: '.mist-me' }] },
  { id: 'cockpit+notifications', label: '通知抽屉', url: '?view=cockpit', actions: [{ click: '.mist-topbar [aria-label="通知"]' }] },
  { id: 'cockpit+assistant', label: '小竹助手抽屉', url: '?view=cockpit', actions: [{ click: '.mist-side-ai' }] },
];
/** 快速回归：宽表 / 列表预览 / 单据详情 / 对象详情 / 模块工作台 / 新建 / 弹窗 / 抽屉各取代表。 */
const QUICK_STATES = new Set(['cockpit', 'orders', 'orders#detail', 'development', 'development#detail', 'development/new', 'risks', 'risks#detail', 'risks+create', 'payment-vouchers', 'quotations', 'shipments', 'crm#detail', 'cockpit+palette', 'cockpit+account', 'cockpit+notifications']);

async function ensureServer() {
  const ok = async () => { try { const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) }); const b = await r.json(); return r.ok && (account ? b.database === 'ok' : b.mode === 'local'); } catch { return false; } };
  if (await ok()) return null;
  if (process.env.MIST_OVERFLOW_BASE) throw new Error(`${BASE} 不可用，且指定了 MIST_OVERFLOW_BASE，不会自动启动`);
  const { startMistDevelopment } = await import(path.join(ROOT, 'scripts/mist-dev.mjs'));
  const running = await startMistDevelopment();
  for (let i = 0; i < 60 && !(await ok()); i++) await new Promise(r => setTimeout(r, 500));
  if (!(await ok())) { await running.close(); throw new Error('本地 Mist 栈未能就绪'); }
  return running;
}

async function signIn(context) {
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  if (account) {
    await page.getByLabel('工作邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.mist-scroll').waitFor({ timeout: 15000 });
    await page.locator('.mist-sync').filter({ hasText: '已保存' }).waitFor({ timeout: 15000 });
    if (account.workspaceId) {
      await page.evaluate(id => { const user = JSON.parse(localStorage.getItem('bambook_auth_user') || 'null'); if (!user?.id) throw new Error('公司账号登录后缺少身份'); localStorage.setItem('bambook.mist.selected-workspace:' + user.id, id); }, account.workspaceId);
      await page.reload();
      await page.locator('.mist-sync').filter({ hasText: '已保存' }).waitFor({ timeout: 15000 });
    }
    return page;
  }
  const status = await page.evaluate(async () => {
    await fetch('/api/mist/session', { credentials: 'include' });
    const r = await fetch('/api/mist/session', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: 'local-operator' }) });
    return r.status;
  });
  if (status !== 200) throw new Error('本地身份登录失败：' + status);
  return page;
}

/** 设置工作区主题；返回原值。 */
async function setTheme(page, theme) {
  return page.evaluate(async ({ theme, server, workspaceId }) => {
    const headers = server ? { Authorization: 'Bearer ' + (localStorage.getItem('bambook_auth_token') || sessionStorage.getItem('bambook_auth_token') || '') } : {};
    const response = await fetch(workspaceId ? '/api/mist/workspaces/' + workspaceId : '/api/mist/workspaces/default', { credentials: 'include', headers });
    if (!response.ok) throw new Error('无法读取扫描工作区 ' + response.status);
    const ws = (await response.json()).workspace;
    const previous = ws.state.settings.theme;
    if (previous !== theme) {
      const r = await fetch(`/api/mist/workspaces/${ws.id}/commands`, { method: 'POST', credentials: 'include', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'overflow-scan-theme-' + Date.now(), expectedRevision: ws.revision, command: { type: 'settings.update', payload: { theme } } }) });
      if (!r.ok) throw new Error('主题设置失败 ' + r.status + ' ' + await r.text());
    }
    return previous;
  }, { theme, server: !!account, workspaceId: account?.workspaceId });
}

const settle = async (page, state) => {
  await page.locator('.mist-scroll').waitFor({ timeout: 10000 });
  // Component/state reference pages do not consume a workspace or render a save status.
  if (!['design-system', 'states'].includes(state.id.split(/[+#]/)[0])) {
    await page.locator('.mist-sync').filter({ hasText: '已保存' }).waitFor({ timeout: 15000 });
    if (account?.workspaceName && await page.locator('.mist-ws b').innerText() !== account.workspaceName) throw new Error('页面未处于指定的隔离验收工作区');
  }
  await page.evaluate(() => document.fonts.ready);
};

async function expectedVisible(page, expected) {
  if (!expected) return false;
  const locator = expected.text ? page.getByText(expected.text, { exact: true }) : page.locator(expected.selector);
  for (let i = 0; i < await locator.count(); i++) if (await locator.nth(i).isVisible()) return true;
  return false;
}

/** 每个状态必须触达真实详情 / 表单；缺入口、空数据或动作无效都登记为覆盖失败。 */
async function replay(page, state) {
  await page.goto(BASE + '/' + state.url); await settle(page, state);
  for (const a of state.actions || []) {
    const before = page.url();
    if (a.tab) await page.getByRole('tab', { name: new RegExp(a.tab) }).click();
    if (a.button) await page.locator('.mist-scroll').getByRole('button', { name: a.button, exact: true }).first().click();
    if (a.press) await page.keyboard.press(a.press);
    if (a.click) { const el = page.locator(a.click).first(); if (!(await el.count()) || !(await el.isVisible())) return false; await el.click(); }
    if (a.row) {
      const row = page.locator('.mist-scroll .mist-tr[data-clickable]').first();
      await row.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (!(await row.count()) || !(await row.isVisible())) return false;
      await row.click();
      await page.waitForTimeout(300);
      // 列表 + 预览布局里单击只选中，双击才进入详情。
      if (page.url() === before && !(await expectedVisible(page, state.expected))) { await row.dblclick().catch(() => {}); await page.waitForTimeout(300); }
      // 第一行若已是选中对象（URL 已带 id），点击不会改变地址，但已经处于详情状态。
      if (page.url() === before && !/[?&]id=/.test(page.url()) && !(await expectedVisible(page, state.expected))) return false;
    }
    if (a.create) {
      const buttons = page.locator('.mist-scroll .mist-page-head button');
      let hit = null;
      for (let i = 0; i < await buttons.count(); i++) { const t = (await buttons.nth(i).innerText()).trim(); if (CREATE.test(t) && await buttons.nth(i).isEnabled()) { hit = buttons.nth(i); break; } }
      if (!hit) return false;
      await hit.click();
    }
    await page.waitForTimeout(500);
  }
  if (state.expected) {
    for (let attempt = 0; attempt < 30 && !(await expectedVisible(page, state.expected)); attempt++) await page.waitForTimeout(100);
    if (!(await expectedVisible(page, state.expected))) return false;
  }
  return true;
}

async function scanState(context, state, theme) {
  const page = await context.newPage();
  const found = [], designed = [], errors = [], checkedWidths = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!(await replay(page, state))) { await page.close(); return { found, designed, errors, checkedWidths, skipped: true, reason: '入口无数据或动作未触达预期详情 / 表单' }; }
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: w < 760 ? 844 : 900 });
      await page.waitForTimeout(260);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const result = await page.evaluate(detectOverflow, {});
      result.issues.push(...(await page.evaluate(detectStacking, {})).issues);
      for (const issue of result.issues) found.push({ state: state.id, label: state.label, url: state.url, actions: state.actions, theme, width: w, ...issue });
      for (const d of result.designed) designed.push({ state: state.id, theme, width: w, ...d });
      checkedWidths.push(w);
    }
  } catch (error) { errors.push(String(error.message || error)); }
  await page.close();
  return { found, designed, errors, checkedWidths };
}

function writeReport(states, issues, designed, errors, ms, executions, plannedStates) {
  fs.mkdirSync(outDir, { recursive: true });
  const sig = i => [i.state, i.kind, i.selector, i.culprit?.selector || ''].join('|');
  const groups = new Map();
  for (const i of issues) { const k = sig(i); const g = groups.get(k) || { ...i, widths: new Set(), themes: new Set(), maxOver: 0, count: 0 }; g.widths.add(i.width); g.themes.add(i.theme); g.maxOver = Math.max(g.maxOver, i.over, i.culprit?.over || 0); g.count++; groups.set(k, g); }
  const grouped = [...groups.values()].map(g => ({ ...g, widths: [...g.widths].sort((a, b) => a - b), themes: [...g.themes] }));
  const designedGroups = new Map();
  for (const d of designed) { const k = d.state + '|' + d.selector; const g = designedGroups.get(k) || { state: d.state, selector: d.selector, widths: new Set(), maxOver: 0 }; g.widths.add(d.width); g.maxOver = Math.max(g.maxOver, d.over); designedGroups.set(k, g); }
  const by = (list, key) => Object.entries(list.reduce((m, i) => { const k = key(i); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const summary = { generatedAt: new Date().toISOString(), base: BASE, quick: QUICK, widths, themes, plannedStates: plannedStates.length, states: states.length, incomplete: executions.filter(e => e.status !== 'complete').length, checkedCombinations: executions.reduce((n,e) => n + e.checkedWidths.length,0), raw: issues.length, unique: grouped.length, durationSec: Math.round(ms / 1000),
    byKind: by(grouped, i => i.kind), byState: by(grouped, i => i.state), byWidth: by(issues, i => String(i.width)), byTheme: by(issues, i => i.theme) };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ summary, issues: grouped, raw: issues, designed: [...designedGroups.values()].map(g => ({ ...g, widths: [...g.widths] })), errors, states, plannedStates, executions }, null, 1));
  const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [`# Mist 溢出扫描${QUICK ? '（快速）' : '（全量）'}`, '', `- 时间：${summary.generatedAt}；耗时 ${summary.durationSec}s；地址 ${BASE}`, `- 页面状态 ${states.length} 个 × 宽度 ${widths.join('/')} × 主题 ${themes.join('/')}`, `- 问题：去重后 **${grouped.length}** 处（原始命中 ${issues.length} 次）`, '',
    '## 执行覆盖', '', `- 计划 ${plannedStates.length} 状态；完成 ${states.length} 状态；实测 ${summary.checkedCombinations} 个主题 / 宽度组合`, ...executions.filter(e => e.status !== 'complete').map(e => `- 未完成：${e.state} / ${e.theme}：${e.reason || e.status}`), '',
    '## 按类型', '', ...summary.byKind.map(([k, n]) => `- ${k}: ${n}`), '', '## 按页面', '', ...summary.byState.map(([k, n]) => `- ${k}: ${n}`), '', '## 按宽度（原始命中）', '', ...summary.byWidth.sort((a, b) => a[0] - b[0]).map(([k, n]) => `- ${k}: ${n}`), '', '## 按主题（原始命中）', '', ...summary.byTheme.map(([k, n]) => `- ${k}: ${n}`), '',
    '## 清单', '', '| 页面 | 类型 | 宽度 | 主题 | 超出 px | 元素 | 突出的子元素 / 文字 | 位置 (x,y,w,h @首个宽度) |', '|---|---|---|---|---|---|---|---|',
    ...grouped.sort((a, b) => a.state.localeCompare(b.state) || b.maxOver - a.maxOver).map(g => `| ${esc(g.label)} | ${g.kind} | ${g.widths.join(',')} | ${g.themes.join(',')} | ${g.maxOver} | \`${esc(g.selector.split(' > ').slice(-3).join(' > '))}\` «${esc(g.text?.slice(0, 24))}» | ${g.culprit ? '`' + esc(g.culprit.selector.split(' > ').slice(-2).join(' > ')) + '` «' + esc(g.culprit.text.slice(0, 24)) + '»' : '—'} | ${g.rect ? [g.rect.x, g.rect.y, g.rect.w, g.rect.h].join(',') : ''} |`),
    '', '## 按设计横向滚动（不计入问题）', '', ...(designedGroups.size ? [...designedGroups.values()].map(g => `- ${g.state}: \`${g.selector.split(' > ').slice(-3).join(' > ')}\`（宽度 ${[...g.widths].sort((a, b) => a - b).join(',')}，最多 ${g.maxOver}px）`) : ['- 无']),
    '', '## 运行错误', '', ...(errors.length ? errors.map(e => '- ' + esc(e)) : ['- 无'])];
  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n') + '\n');
  return { summary, grouped };
}

const started = Date.now();
const launchBrowser = () => chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
{
  // 先自检判定逻辑（不需要本地栈）。
  const probe = await launchBrowser();
  const failures = await selfTest(await probe.newPage());
  await probe.close();
  if (failures.length) { console.error('[overflow] 判定自检失败：\n  - ' + failures.join('\n  - ')); process.exit(2); }
  console.log('[overflow] 判定自检通过');
  if (flag('selftest')) process.exit(0);
}
const running = await ensureServer();
const browser = await launchBrowser();
let exitCode = 0, originalTheme;
try {
  const setup = await browser.newContext();
  const setupPage = await signIn(setup);
  originalTheme = await setTheme(setupPage, 'system');
  let states = STATES;
  if (QUICK) states = states.filter(s => QUICK_STATES.has(s.id));
  if (only) states = states.filter(s => only.has(s.id.split(/[+#]/)[0]) || only.has(s.id));
  console.log(`[overflow] ${states.length} 个页面状态 × ${widths.length} 宽度 × ${themes.length} 主题`);
  const jobs = states.flatMap(s => themes.map(t => [s, t]));
  const issues = [], designed = [], errors = [], skipped = new Set(), executions = [];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.max(1, workers) }, async () => {
    const context = await browser.newContext();
    await (await signIn(context)).close();
    while (next < jobs.length) {
      const [state, theme] = jobs[next++];
      const r = await scanState(context, state, theme);
      const complete = !r.skipped && !r.errors.length && r.checkedWidths.length === widths.length;
      if (!complete) skipped.add(state.id);
      executions.push({state:state.id,theme,status:complete?'complete':r.skipped?'unreached':'error',checkedWidths:r.checkedWidths,reason:r.reason || r.errors.join('; ')});
      issues.push(...r.found); designed.push(...r.designed); errors.push(...r.errors.map(e => `${state.id} ${theme}: ${e}`));
      done++; if (done % 20 === 0 || done === jobs.length) console.log(`[overflow] ${done}/${jobs.length}，累计命中 ${issues.length}`);
    }
    await context.close();
  }));
  const { summary, grouped } = writeReport(states.filter(s => !skipped.has(s.id)), issues, designed, errors, Date.now() - started, executions, states);
  console.log(`[overflow] 去重后 ${grouped.length} 处溢出（原始 ${summary.raw}）；报告 ${path.relative(process.cwd(), path.join(outDir, 'report.md'))}`);
  for (const g of grouped.slice(0, 15)) console.log(`  - ${g.state} ${g.kind} +${g.maxOver}px @${g.widths.join(',')} ${g.selector.split(' > ').slice(-2).join(' > ')}`);
  if (grouped.length && !reportOnly) exitCode = 1;
  if (summary.incomplete || errors.length) { console.error(`[overflow] ${summary.incomplete} 个主题状态未完成，不能判通过`); exitCode = 2; }
  await setTheme(setupPage, originalTheme);
  await setup.close();
} catch (error) {
  console.error('[overflow] 扫描失败：', error); exitCode = 2;
} finally {
  await browser.close();
  if (running) await running.close();
}
process.exit(exitCode);
