#!/usr/bin/env node
/**
 * 把 wiki/pages/*.md 生成一份可离线打开的 HTML 说明书。
 *
 *   npm run wiki:build
 * 产物：wiki/site/index.html + wiki/site/assets/**（构建产物，不入库）
 *
 * 设计取舍：
 * - 单页 HTML：侧栏目录 + 全文搜索 + 打印样式，员工双击即可阅读，不需要服务器；
 * - 每章标题旁显示核验徽标（已核验 / 需复核 / 草稿），版本信息来自 registry 同一套判定；
 * - 图片统一渲染成 figure + 图注，动图（GIF）与静图走同一路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { WIKI, SITE, PART_ORDER, STATUS_LABEL, VERDICT_LABEL, snapshot } from './wiki-lib.mjs';

marked.setOptions({ gfm: true, breaks: false });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => s.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');

/** 图片 → figure + 图注；标题 → 可跳转锚点。 */
function polish(html) {
  return html
    .replace(/<p>\s*<img([^>]*?)>\s*<\/p>/g, (_m, attrs) => {
      const alt = /alt="([^"]*)"/.exec(attrs)?.[1] || '';
      return `<figure><img${attrs} loading="lazy" decoding="async">${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
    })
    .replace(/<img(?![^>]*loading=)([^>]*?)>/g, '<img$1 loading="lazy" decoding="async">')
    .replace(/<h([23])>(.*?)<\/h\1>/g, (_m, level, inner) => {
      const id = slugify(inner.replace(/<[^>]+>/g, ''));
      return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="本节链接">#</a></h${level}>`;
    })
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

const snap = snapshot();
const { version, head, branch, chapters, modules, missingModules } = snap;
const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
const tally = chapters.reduce((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] || 0) + 1 }), {});

const badge = c => c.verdict === 'current' ? '' : `<span class="badge warn">${c.verdict === 'stale' ? '待复核' : '整理中'}</span>`;

const byPart = PART_ORDER.map(part => ({ part, items: chapters.filter(c => c.part === part) }))
  .concat([{ part: '其他', items: chapters.filter(c => !PART_ORDER.includes(c.part)) }])
  .filter(g => g.items.length);

const nav = byPart
  .map(g => `<div class="nav-part"><div class="nav-part-title">${esc(g.part)}</div>${g.items
    .map(c => `<a class="nav-item" href="#${esc(c.slug)}" data-target="${esc(c.slug)}">${esc(c.title)}${c.verdict === 'stale' ? '<i class="dot"></i>' : ''}</a>`)
    .join('')}</div>`)
  .join('');

const sections = chapters
  .map(c => `<section id="${esc(c.slug)}" class="chapter">
  <div class="chapter-head">
    <h1>${esc(c.title)}</h1>
    ${badge(c)}
  </div>
  ${polish(marked.parse(c.body))}
</section>`)
  .join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bambook 员工使用手册 · v${esc(version)}</title>
<style>
:root{
  --ink:#242a33; --ink-2:#525e6d; --ink-3:#718091; --line:#e6eaf0; --bg:#ffffff; --bg-2:#f5f7fa;
  --accent:#4b6a82; --ok:#35765b; --warn:#8a6839; --radius:12px;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--sans);color:var(--ink);background:var(--bg);font-size:15.5px;line-height:1.85;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
code{font-family:var(--mono);font-size:.88em;background:var(--bg-2);padding:.12em .38em;border-radius:4px;color:#24292f}
pre{background:var(--bg-2);padding:14px 16px;border-radius:var(--radius);overflow:auto}
pre code{background:none;padding:0}

/* 顶栏 */
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;height:64px;padding:0 28px;
  background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.topbar .brand{font-weight:650;letter-spacing:.02em}
.topbar .ver{font-family:var(--mono);font-size:12px;color:var(--ink-3);padding:3px 8px;background:var(--bg-2);border-radius:6px}
.topbar .spacer{flex:1}
.topbar .search{width:260px;padding:8px 14px;border:1px solid var(--line);border-radius:10px;font:inherit;font-size:13px;background:var(--bg-2)}
.topbar .search:focus{outline:2px solid rgba(31,111,235,.25);border-color:var(--accent);background:#fff}

/* 布局 */
.layout{display:grid;grid-template-columns:264px minmax(0,1fr);max-width:1260px;margin:0 auto}
nav.toc{position:sticky;top:64px;height:calc(100vh - 64px);overflow:auto;padding:28px 14px 60px 24px;border-right:1px solid var(--line)}
.nav-part{margin-bottom:16px}
.nav-part-title{font-size:11px;letter-spacing:.12em;color:var(--ink-3);text-transform:uppercase;margin:0 0 6px 8px}
.nav-item{display:block;padding:5px 10px;border-radius:6px;color:var(--ink-2);font-size:13.5px;position:relative}
.nav-item:hover{background:var(--bg-2);color:var(--ink)}
.nav-item.active{background:#edf2f4;color:#34566b;font-weight:600}
.nav-item .dot{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:5px;height:5px;border-radius:50%;background:var(--warn)}

main{padding:48px clamp(28px,5vw,76px) 120px;min-width:0;max-width:900px}
.chapter{padding-bottom:48px;margin-bottom:40px;border-bottom:1px solid var(--line)}
.chapter:last-child{border-bottom:0}
.chapter-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.chapter-head h1{font-size:clamp(26px,3vw,32px);line-height:1.3;margin:0;letter-spacing:-.02em}
.badge{font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--ink-3);white-space:nowrap}
.badge.ok{color:var(--ok);border-color:#cfe8d5;background:#f2fbf4}
.badge.warn{color:var(--warn);border-color:#f0e0b8;background:#fdf8ec}
h2{font-size:19px;margin:38px 0 12px;padding-top:6px;line-height:1.45}
h3{font-size:16px;margin:22px 0 8px}
.anchor{opacity:0;margin-left:6px;color:var(--ink-3);font-weight:400;text-decoration:none}
h2:hover .anchor,h3:hover .anchor{opacity:1}
p{margin:10px 0}
ul,ol{padding-left:22px}
li{margin:8px 0;padding-left:4px}
blockquote{margin:14px 0;padding:8px 16px;border-left:3px solid var(--line);color:var(--ink-2);background:var(--bg-2);border-radius:0 6px 6px 0}
figure{margin:18px 0;text-align:center}
figure img{max-width:100%;border:1px solid var(--line);border-radius:var(--radius);display:block;margin:0 auto}
figcaption{font-size:12.5px;color:var(--ink-3);margin-top:8px}
.table-wrap{overflow:auto;margin:18px 0;border:1px solid var(--line);border-radius:var(--radius)}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
thead th{background:var(--bg-2);font-weight:600;color:var(--ink-2)}
tbody tr:last-child td{border-bottom:0}
tbody th{background:var(--bg-2);width:180px;font-weight:600;color:var(--ink-2)}
.empty{color:var(--ink-3);padding:24px 0}
mark{background:#fff3b0;padding:0 2px}
.mobile-nav{display:none}

@media (max-width:900px){
  .layout{grid-template-columns:1fr}
  nav.toc{display:none}
  .mobile-nav{display:block;margin:16px 20px 0;border:1px solid var(--line);border-radius:var(--radius);padding:8px 14px}
  .mobile-nav summary{cursor:pointer;color:var(--ink-2);font-weight:600}
  .mobile-nav .nav-part{margin-top:12px}
  main{padding:28px 20px 80px}
  .topbar{padding:0 16px;gap:8px}
  .topbar .search{width:min(36vw,180px)}
}
@media print{
  .topbar,nav.toc{display:none}
  .layout{display:block;max-width:none}
  main{padding:0}
  .chapter{page-break-after:always;border-bottom:0;margin:0;padding-bottom:0}
  figure img{border:0}
  a{color:var(--ink)}
}
</style>
</head>
<body>
<header class="topbar">
  <span class="brand">Bambook 员工使用手册</span>
  <span class="spacer"></span>
  <input class="search" id="q" type="search" aria-label="搜索手册" placeholder="搜索操作…" autocomplete="off">
</header>
<details class="mobile-nav"><summary>查看目录</summary>${nav}</details>
<div class="layout">
  <nav class="toc">
    ${nav}
  </nav>
  <main id="content">
    ${sections}
  </main>
</div>
<script>
const q = document.getElementById('q');
const items = [...document.querySelectorAll('.nav-item')];
const sections = [...document.querySelectorAll('.chapter')];
q.addEventListener('input', () => {
  const term = q.value.trim().toLowerCase();
  let hits = 0;
  for (const s of sections) {
    const hit = !term || s.textContent.toLowerCase().includes(term);
    s.hidden = !hit;
    if (hit) hits++;
  }
  for (const a of items) {
    const s = document.getElementById(a.dataset.target);
    a.hidden = !!(term && s && s.hidden);
  }
  for (const g of document.querySelectorAll('.nav-part')) {
    g.hidden = ![...g.querySelectorAll('.nav-item')].some(a => !a.hidden);
  }
  if (term && !hits) {
    if (!document.getElementById('no-hit')) {
      const p = document.createElement('p');
      p.id = 'no-hit'; p.className = 'empty'; p.textContent = '没有匹配的章节。试试更短的关键词，或用界面上的按钮名称搜索。';
      document.getElementById('content').prepend(p);
    }
  } else document.getElementById('no-hit')?.remove();
});
const spy = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    for (const a of items) a.classList.toggle('active', a.dataset.target === e.target.id);
  }
}, { rootMargin: '-64px 0px -70% 0px' });
for (const s of sections) spy.observe(s);
</script>
</body>
</html>`;

fs.mkdirSync(SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'index.html'), html);
const assets = path.join(WIKI, 'assets');
if (fs.existsSync(assets)) fs.cpSync(assets, path.join(SITE, 'assets'), { recursive: true });

const kb = (fs.statSync(path.join(SITE, 'index.html')).size / 1024).toFixed(0);
console.log(`✓ wiki/site/index.html（${kb} KB · ${chapters.length} 章 · ${missingModules.length} 个页面未登记）`);
console.log(`  版本 v${version} · ${branch}@${head} · 生成于 ${generatedAt}`);
