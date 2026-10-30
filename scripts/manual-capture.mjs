#!/usr/bin/env node
/**
 * 从本地真实 Mist 界面采集教学素材：每一步截一张高清图，并记下要点击 / 填写的控件位置。
 *
 *   npm run dev:mist                     # 先启动本地独立服务（演示种子，不连公司库或共享服务器）
 *   node scripts/manual-capture.mjs settlement
 *
 * 产物：wiki/assets/lessons/<课程>/NN.webp + capture.json（入库，供 wiki:build 生成引导式演示）。
 * 只允许连接 127.0.0.1 的本地服务；采集会在本地工作区真实执行一遍操作，重采前先重置本地数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:3001';
const VIEWPORT = { width: 1440, height: 900 };

async function session(page, profileId) {
  const res = await page.evaluate(async id => (await fetch('/api/mist/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: id }) })).json(), profileId);
  if (res?.mode !== 'local') throw new Error('只能在本地独立 Mist 服务上采集（mode=local）。');
  await page.reload(); await page.waitForTimeout(2500);
}
async function nav(page, group, item) {
  const head = page.locator('.mist-nav-head', { hasText: group });
  if (await head.getAttribute('aria-expanded') === 'false') { await head.click(); await page.waitForTimeout(300); }
  return page.locator('.mist-nav-group', { hasText: group }).getByText(item, { exact: true });
}
const dialog = (page, name) => page.getByRole('dialog', { name });

/** 每步：prepare 只做准备（不展示），target 指向本步操作的控件，act 执行与员工相同的操作。 */
const LESSONS = {
  settlement: [
    { profile: 'demo-buyer', target: p => nav(p, '财务与成本', '财务管理'), act: l => l.click() },
    { target: p => p.getByRole('tab', { name: '应付待办' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '提交结算' }), act: l => l.click() },
    { target: p => dialog(p, '提交结算').getByLabel('结算合同'), act: l => l.selectOption({ label: 'PO-2026-00001 · 华盛毛纺' }), value: 'PO-2026-00001 · 华盛毛纺' },
    { target: p => dialog(p, '提交结算').locator('[data-settle-receipt]').first().getByRole('checkbox'), act: l => l.check({ force: true }) },
    { target: p => dialog(p, '提交结算').getByLabel('结算说明'), act: l => l.fill('首批到货 2,380 米验收合格，按合同单价结算；色差 20 米已退回，待供应商确认补发。'), value: '首批到货 2,380 米验收合格，按合同单价结算；色差 20 米已退回，待供应商确认补发。' },
    { target: p => dialog(p, '提交结算').getByRole('button', { name: '提交复核' }), act: l => l.click() },
  ],
  'settlement-confirm': [
    { profile: 'demo-finance', target: p => p.getByText(/ST-\d{4}-\d{4} · 待财务复核/).last(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '确认结算' }).first(), act: l => l.click() },
    { target: p => dialog(p, '确认结算').getByLabel('复核意见'), act: l => l.fill('实收 2,380 米与入库记录一致，按合同单价确认。'), value: '实收 2,380 米与入库记录一致，按合同单价确认。' },
    { target: p => dialog(p, '确认结算').getByRole('button', { name: '确认结算' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '按结算登记票据' }).first(), act: l => l.click() },
  ],
};

async function shot(page, file) {
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(file + '.png', png);
  execFileSync('python3', ['-I', '-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]);im.save(sys.argv[2],"WEBP",quality=82,method=6)', file + '.png', file + '.webp']);
  fs.rmSync(file + '.png');
}

async function capture(name) {
  const steps = LESSONS[name]; if (!steps) throw new Error(`未知课程：${name}（可选 ${Object.keys(LESSONS).join(' / ')}）`);
  const out = path.join(ROOT, 'wiki/assets/lessons', name); fs.mkdirSync(out, { recursive: true });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE); await page.waitForTimeout(1500);
    const frames = [];
    for (const [i, step] of steps.entries()) {
      if (step.profile) await session(page, step.profile);
      const target = await step.target(page); await target.waitFor({ state: 'visible', timeout: 10000 });
      await target.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0); await page.waitForTimeout(400);
      const box = await target.boundingBox(); if (!box) throw new Error(`第 ${i + 1} 步找不到目标控件`);
      const image = String(i + 1).padStart(2, '0'); await shot(page, path.join(out, image));
      frames.push({ image: image + '.webp', target: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])), ...(step.value ? { value: step.value } : {}) });
      await step.act(target); await page.waitForTimeout(1200);
    }
    await page.mouse.move(0, 0); await page.waitForTimeout(600); await shot(page, path.join(out, 'result'));
    if (errors.length) throw new Error('页面脚本错误：' + errors.join('；'));
    fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ viewport: VIEWPORT, frames, result: 'result.webp' }, null, 2) + '\n');
    console.log(`✓ ${name}：${frames.length} 步 → ${path.relative(ROOT, out)}`);
  } finally { await browser.close(); }
}

for (const name of process.argv.slice(2)) await capture(name);
