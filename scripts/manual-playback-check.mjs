#!/usr/bin/env node
/**
 * 在真实浏览器里核验一门课程的播放（只读，不连接业务库）：
 *
 *   npm run dev:mist                                   # 提供 /manual/
 *   node scripts/manual-playback-check.mjs tutorial-settlement [--out /tmp/manual-check] [--register]
 *
 * 逐项检查：宽屏/窄屏、明/暗配色下图片实际加载；每步热点在画面内；演示从第一步自动播到结果；
 * 练习点热点逐步完成；键盘（Tab/Enter/Space）可操作；目录链接与搜索；单张图片失败时显示重载并可恢复；
 * 控制台无脚本错误。输出 JSON 报告与截图，供人工目视复核。脚本通过 ≠ 员工验收。
 * --register：全部通过、且播放器与课程源码已提交时，把 verification.playback 写回课程（提交号、内容摘要、时间）。
 * 只在人工看过截图后使用；员工认可（verification.employee）只能按实际培训结果另行登记。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLessonCatalog } from './manual-catalog.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [lessonId, ...rest] = process.argv.slice(2);
if (!lessonId) throw new Error('用法：node scripts/manual-playback-check.mjs <课程ID> [--out 目录] [--base http://127.0.0.1:3001/manual/]');
const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const BASE = opt('--base') || 'http://127.0.0.1:3001/manual/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(BASE)) throw new Error('只核验本机提供的手册页面');
const OUT = opt('--out') || path.join(process.env.TMPDIR || '/tmp', 'manual-check', lessonId);
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' · ' + detail : ''}`); };
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function open({ width, height, colorScheme = 'light', block } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, locale: 'zh-CN', deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (block) await page.route(block, route => route.abort());
  await page.goto(BASE + '#' + lessonId);
  const root = page.locator(`[id="${lessonId}"]`);
  await root.waitFor({ state: 'visible', timeout: 15000 });
  return { context, page, errors, root };
}
const imageReady = root => root.locator('[data-img]').evaluate(img => img.complete && img.naturalWidth > 0 ? img.getAttribute('src') : null);
const waitImage = async (root, timeout = 10000) => { const end = Date.now() + timeout; let src = null; while (Date.now() < end && !(src = await imageReady(root))) await new Promise(r => setTimeout(r, 150)); await root.locator('[data-play]:not([disabled])').waitFor({ timeout: 5000 }).catch(() => {}); return src; };

try {
  // 1. 宽屏亮色：逐步画面与热点
  {
    const { context, page, errors, root } = await open({ width: 1440, height: 900 });
    const steps = await root.locator('[data-step]').count();
    check('宽屏 · 课程打开并列出步骤', steps > 0, `${steps} 步`);
    for (let i = 0; i < steps; i++) {
      await root.locator(`[data-step="${i}"]`).click();
      const src = await waitImage(root);
      const hot = await root.locator('[data-hotspot]').boundingBox(), shot = await root.locator('[data-shot]').boundingBox();
      const inside = hot && shot && hot.x >= shot.x - 1 && hot.y >= shot.y - 1 && hot.x + hot.width <= shot.x + shot.width + 1 && hot.y + hot.height <= shot.y + shot.height + 1;
      check(`宽屏 · 第 ${i + 1} 步画面加载且热点在画面内`, src?.includes(`/${String(i + 1).padStart(2, '0')}.webp`) && inside, src || '图片未加载');
    }
    await root.locator('[data-step="0"]').click(); await waitImage(root);
    await page.screenshot({ path: path.join(OUT, 'wide-light-step1.png') });

    // 2. 演示：从第一步自动播到结果
    const started = Date.now();
    await root.locator('[data-play]').click();
    await root.locator('[data-lesson-done]').waitFor({ state: 'visible', timeout: steps * 12000 });
    const resultSrc = await waitImage(root);
    check('演示 · 自动播放到结果画面', resultSrc?.includes('/result.webp'), `${((Date.now() - started) / 1000).toFixed(1)} 秒`);
    check('演示 · 显示本课已完成', (await root.locator('[data-player-state]').textContent())?.includes('本课已完成'));
    await page.screenshot({ path: path.join(OUT, 'wide-light-result.png') });

    // 3. 练习：画面外点击只提示；点热点完成并前进
    await root.locator('[data-lesson-restart]').click().catch(() => root.locator('[data-step="0"]').click());
    await root.locator('[data-step="0"]').click(); await waitImage(root);
    const box = await root.locator('[data-shot]').boundingBox();
    await page.mouse.click(box.x + 4, box.y + box.height - 4);
    check('练习 · 点错位置只提示', (await root.locator('[data-hint]').textContent())?.includes('点击亮起的位置') && !(await root.locator('[data-step="0"]').evaluate(el => el.classList.contains('done'))));
    for (let i = 0; i < steps; i++) {
      await root.locator(`[data-step="${i}"]`).click(); await waitImage(root);
      await root.locator('[data-hotspot]').click(); await page.waitForTimeout(150);
      const done = await root.locator(`[data-step="${i}"]`).evaluate(el => el.classList.contains('done'));
      if (!done) { check(`练习 · 第 ${i + 1} 步点热点后完成`, false); }
    }
    check('练习 · 每步点亮起位置后完成', results.every(r => !r.name.startsWith('练习 · 第')));

    // 4. 键盘：Tab 到播放键、Enter 切换；热点 Space 完成
    await root.locator('[data-step="0"]').click(); await waitImage(root);
    await root.locator('[data-play]').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const playing = await root.locator('[data-play]').getAttribute('aria-label');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const paused = await root.locator('[data-play]').getAttribute('aria-label');
    check('键盘 · 播放键可用 Enter 播放与暂停', playing === '暂停' && paused === '继续', `${playing} → ${paused}`);
    await root.locator('[data-step="1"]').focus(); await page.keyboard.press('Enter'); await waitImage(root);
    await root.locator('[data-hotspot]').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(200);
    check('键盘 · 热点可聚焦并用 Space 完成', await root.locator('[data-step="1"]').evaluate(el => el.classList.contains('done')));

    // 5. 目录链接与搜索
    const anchors = await page.$$eval('a[href^="#"]', links => links.map(a => decodeURIComponent(a.getAttribute('href').slice(1))).filter(Boolean));
    const missing = await page.evaluate(ids => ids.filter(id => !document.getElementById(id)), [...new Set(anchors)]);
    check('目录 · 页内链接都有目标', missing.length === 0, missing.join('、'));
    const title = (await root.locator('h1, h2').first().textContent())?.trim();
    await page.fill('#q', title); await page.waitForTimeout(200);
    check('搜索 · 按课程名能找到本课', await root.isVisible(), title);
    await page.fill('#q', '这串不会出现的词zzz'); await page.waitForTimeout(200);
    check('搜索 · 无结果时给出提示', await page.locator('#no-hit').isVisible());
    await page.fill('#q', ''); await page.waitForTimeout(200);
    check('无脚本错误（宽屏）', errors.length === 0, errors.join('；') || title);
    await context.close();
  }

  // 6. 窄屏 + 暗色
  for (const [label, colorScheme] of [['窄屏亮色', 'light'], ['窄屏暗色', 'dark']]) {
    const { context, page, errors, root } = await open({ width: 390, height: 844, colorScheme });
    const src = await waitImage(root);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const shot = await root.locator('[data-shot]').boundingBox();
    check(`${label} · 图片加载、无横向滚动、画面在视口内`, !!src && overflow <= 1 && shot && shot.x >= -1 && shot.x + shot.width <= 391, `溢出 ${overflow}px`);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && bg !== 'rgb(255, 255, 255)';
    check(`${label} · 页面配色跟随深浅色`, colorScheme === 'dark' ? dark : bg === 'rgb(255, 255, 255)', bg);
    await page.screenshot({ path: path.join(OUT, `${colorScheme === 'dark' ? 'narrow-dark' : 'narrow-light'}.png`), fullPage: false });
    check(`无脚本错误（${label}）`, errors.length === 0, errors.join('；'));
    await context.close();
  }
  {
    const { context, page, root } = await open({ width: 1440, height: 900, colorScheme: 'dark' });
    await waitImage(root); await page.screenshot({ path: path.join(OUT, 'wide-dark.png') });
    await context.close();
  }

  // 7. 图片失败与重载
  {
    let fail = true;
    const { context, page, root } = await open({ width: 1440, height: 900 });
    await page.route(/\/03\.webp/, route => fail ? route.abort() : route.continue());
    await root.locator('[data-step="2"]').click();
    await root.locator('[data-media-error]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    const shown = await root.locator('[data-media-error]').isVisible();
    check('图片失败 · 显示错误且不能前进', shown && await root.locator('[data-lesson-next]').isDisabled());
    await page.screenshot({ path: path.join(OUT, 'media-error.png') });
    fail = false;
    await root.locator('[data-media-reload]').click();
    await page.waitForLoadState('load');
    const again = page.locator(`[id="${lessonId}"]`);
    await again.locator('[data-step="2"]').click().catch(() => {});
    check('图片失败 · 重新加载后恢复', !!(await waitImage(again, 15000)));
    await context.close();
  }
} finally {
  await browser.close();
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ lessonId, base: BASE, checkedAt: new Date().toISOString(), passed: !failed.length, results }, null, 2) + '\n');
  console.log(`\n${failed.length ? `✗ ${failed.length} 项未通过` : '✓ 全部检查通过'} · 报告 ${path.join(OUT, 'report.json')}`);
  process.exitCode = failed.length ? 1 : 0;
  if (!failed.length && rest.includes('--register')) register();
}

function register() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const row = readLessonCatalog().lessons.find(entry => entry.id === lessonId);
  if (!row) throw new Error(`课程 ${lessonId} 不存在`);
  const sources = ['scripts/manual-lesson.mjs', 'scripts/manual-navigation.mjs', 'scripts/manual-catalog.mjs', 'scripts/manual-site.ts', 'scripts/wiki-build.mjs', row.file, path.dirname(row.captureFile)];
  const dirty = git(['status', '--porcelain', '--', ...sources]);
  if (dirty) { console.log('未登记：播放器或课程源码有未提交改动\n' + dirty); process.exitCode = 1; return; }
  const file = path.join(ROOT, row.file), lesson = JSON.parse(fs.readFileSync(file, 'utf8'));
  lesson.verification = { ...(lesson.verification || {}), playback: { status: 'passed', checkedAt: new Date().toISOString(), softwareCommit: git(['rev-parse', 'HEAD']), contentSha256: row.contentSha256 } };
  fs.writeFileSync(file, JSON.stringify(lesson, null, 2) + '\n');
  console.log(`已登记播放核验 → ${row.file}`);
}
