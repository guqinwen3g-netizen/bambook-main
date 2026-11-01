/**
 * 员工手册里的 SOP 呈现：
 * - 每课「本课 SOP」：只用课程 JSON 中已核验的岗位、开始条件、入口、步骤、结果、交接与出错说明，
 *   按统一栏目（办理岗位 / 开始条件 / 入口 / 操作步骤 / 完成标准 / 交给谁 / 出错与例外 / 业务要点）排列，不补写课程以外的规则；
 * - 「岗位 SOP 总览」：按业务链与岗位汇总现有课程，方便员工按“我是谁、我接哪一棒”查找；
 * - 文字 SOP：`wiki/sop/*.md` 由软件实施 Agent 维护，这里只负责渲染和页内链接，不改写内容。
 */
import fs from 'node:fs';
import path from 'node:path';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 课程 SOP 中归入统一栏目的标题；其余条目作为「业务要点」保留原文。 */
const ROLE_TITLES = ['办理岗位'];
const START_TITLES = ['开始条件', '前提'];
const DONE_TITLES = ['完成标准'];
const STANDARD_TITLES = new Set([...ROLE_TITLES, ...START_TITLES, ...DONE_TITLES]);

const texts = (sop, titles) => (sop || []).filter(row => titles.includes(row.title)).map(row => row.text);
const note = list => list.map(text => `<p class="sop-note">${esc(text)}</p>`).join('');

/** 岗位名去掉括号里的经办说明，用于按岗位归组：「业务员（采购经办）」归入「业务员」。 */
export const roleGroup = role => String(role || '').replace(/[（(].*?[）)]/g, '').trim() || '其他';
const ROLE_ORDER = ['业务员', '主管', '财务', 'QC', '后勤单证', '仓库'];

export function renderLessonSop(lesson) {
  const sop = lesson.sop || [];
  const extra = sop.filter(row => !STANDARD_TITLES.has(row.title));
  const done = texts(sop, DONE_TITLES);
  const failures = lesson.steps.map((step, i) => step.failure ? { ...step.failure, step: i + 1 } : null).filter(Boolean);
  const steps = lesson.steps.map((step, i) => `<tr><th scope="row">${i + 1}</th><td><b>${esc(step.title)}</b><br>${esc(step.do)}${step.fill ? `<br><span class="sop-fill-label">填写</span><span class="lesson-fill">${esc(step.fill)}</span>` : ''}</td><td>${esc(step.see)}</td></tr>`).join('');
  return `<div class="lesson-sop sop-card">
  <div class="sop-head"><h2 id="${esc(lesson.id)}-sop">本课 SOP</h2><button type="button" class="sop-print" data-print>打印本课 SOP</button></div>
  <dl class="sop-grid">
   <dt>办理岗位</dt><dd>${esc(lesson.role)}${note(texts(sop, ROLE_TITLES))}</dd>
   <dt>开始条件</dt><dd>${esc(lesson.prerequisite)}${note(texts(sop, START_TITLES).filter(text => text !== lesson.prerequisite))}</dd>
   <dt>入口</dt><dd>${esc(lesson.entry)}</dd>
   <dt>操作步骤</dt><dd><div class="table-wrap"><table class="sop-steps"><thead><tr><th scope="col">步骤</th><th scope="col">操作</th><th scope="col">应看到的结果</th></tr></thead><tbody>${steps}</tbody></table></div></dd>
   <dt>完成标准</dt><dd>${done.length ? done.map(esc).join('<br>') : esc(lesson.doneTitle)}<p class="sop-note">本课演示结果：${esc(lesson.result)}</p></dd>
   <dt>交给谁</dt><dd>${esc(lesson.handoff)}${lesson.nextLesson ? `<p class="sop-note">接下来：<a href="#${esc(lesson.nextLesson.id)}">${esc(lesson.nextLesson.title)}</a></p>` : ''}</dd>
   ${failures.length ? `<dt>出错与例外</dt><dd><ul class="sop-list">${failures.map(f => `<li><b>${esc(f.title)}</b>（第 ${f.step} 步）：${esc(f.text)}</li>`).join('')}</ul></dd>` : ''}
   ${extra.length ? `<dt>业务要点</dt><dd><ul class="sop-list">${extra.map(row => `<li><b>${esc(row.title)}</b>：${esc(row.text)}</li>`).join('')}</ul></dd>` : ''}
  </dl>
 </div>`;
}

/** 文字 SOP 的阅读顺序与 wiki/README.md 一致；新增文件排在后面按文件名排序。 */
const TEXT_SOP_ORDER = ['platform-ai', 'mail-receiving', 'agent-connections', 'agent-tasks'];

/** 读取 wiki/sop/*.md：第一行一级标题作为章节名，其余为正文。 */
export function readTextSops(wikiDir) {
  const directory = path.join(wikiDir, 'sop');
  if (!fs.existsSync(directory)) return [];
  const rank = name => TEXT_SOP_ORDER.includes(name) ? TEXT_SOP_ORDER.indexOf(name) : TEXT_SOP_ORDER.length;
  return fs.readdirSync(directory).filter(file => file.endsWith('.md')).map(file => {
    const name = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(directory, file), 'utf8').replace(/^\uFEFF/, '');
    const heading = raw.match(/^#\s+(.+)$/m);
    if (!heading) throw new Error(`wiki/sop/${file}：缺少一级标题`);
    return { name, file: `wiki/sop/${file}`, id: `sop-${name}`, title: heading[1].trim(), body: raw.replace(heading[0], '').trim() };
  }).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/** 文字 SOP 之间的相对链接改为页内跳转；指向手册以外的 Markdown 链接保留文字、去掉无效地址。 */
export function linkTextSops(html, sops) {
  const ids = new Map(sops.map(sop => [sop.name, sop.id]));
  return html.replace(/<a href="([^"]+)"/g, (match, href) => {
    const local = href.match(/^(?:\.\/)?(?:sop\/)?([\w-]+)\.md(#[\w-]*)?$/);
    if (local && ids.has(local[1])) return `<a href="#${ids.get(local[1])}"`;
    if (/^(?:https?:|#|mailto:)/.test(href)) return match;
    return '<a';
  });
}

const lessonLink = lesson => `<a href="#${esc(lesson.id)}">${esc(lesson.title)}</a>`;

/** 岗位 SOP 总览：按业务链看先后与交接，按岗位看自己负责的事项。 */
export function renderSopOverview(lessons, trackOf, textSops) {
  const tracks = [...new Set(lessons.map(trackOf))];
  const groups = [...new Set(lessons.map(lesson => roleGroup(lesson.role)))]
    .sort((a, b) => (ROLE_ORDER.includes(a) ? ROLE_ORDER.indexOf(a) : ROLE_ORDER.length) - (ROLE_ORDER.includes(b) ? ROLE_ORDER.indexOf(b) : ROLE_ORDER.length) || a.localeCompare(b));
  const flow = tracks.map(track => {
    const rows = lessons.filter(lesson => trackOf(lesson) === track);
    return `<h3 id="sop-flow-${esc(track)}">${esc(track)}</h3><div class="table-wrap"><table class="sop-table"><thead><tr><th scope="col">顺序</th><th scope="col">任务</th><th scope="col">谁来做</th><th scope="col">开始前</th><th scope="col">完成后交给</th></tr></thead><tbody>${rows.map((lesson, i) => `<tr><td>${i + 1}</td><td>${lessonLink(lesson)}</td><td>${esc(lesson.role)}</td><td>${esc(lesson.prerequisite)}</td><td>${esc(lesson.handoff)}</td></tr>`).join('')}</tbody></table></div>`;
  }).join('');
  const byRole = groups.map(group => {
    const rows = lessons.filter(lesson => roleGroup(lesson.role) === group);
    return `<h3 id="sop-role-${esc(group)}">${esc(group)}<span class="sop-count">${rows.length} 项</span></h3><div class="table-wrap"><table class="sop-table"><thead><tr><th scope="col">任务</th><th scope="col">业务链</th><th scope="col">入口</th><th scope="col">完成后交给</th></tr></thead><tbody>${rows.map(lesson => `<tr><td>${lessonLink(lesson)}</td><td>${esc(trackOf(lesson))}</td><td>${esc(lesson.entry)}</td><td>${esc(lesson.handoff)}</td></tr>`).join('')}</tbody></table></div>`;
  }).join('');
  const common = textSops.length ? `<h2 id="sop-common">通用工作（全部岗位）</h2><p>以下工作按本人账号权限办理，暂无分步演示，按文字 SOP 操作。</p><ul class="sop-list">${textSops.map(sop => `<li><a href="#${esc(sop.id)}">${esc(sop.title)}</a></li>`).join('')}</ul>` : '';
  return `<section id="sop-overview" class="chapter sop-overview">
 <p class="lesson-kicker">岗位 SOP</p>
 <h1>岗位 SOP 总览</h1>
 <p class="start-intro">先找到自己的岗位和手上这一棒，再打开对应课程看完整 SOP：开始条件、入口、步骤、完成标准和下一位接手人。</p>
 <div class="sop-jump"><span>按岗位：</span>${groups.map(group => `<a href="#sop-role-${esc(group)}">${esc(group)}</a>`).join('')}<span>按业务链：</span>${tracks.map(track => `<a href="#sop-flow-${esc(track)}">${esc(track)}</a>`).join('')}</div>
 <h2 id="sop-by-flow">按业务链：先后顺序与交接</h2>${flow}
 <h2 id="sop-by-role">按岗位：我负责的事项</h2>${byRole}
 ${common}
 <p class="lesson-review-note">大货 QC、装箱出运、交单收汇、结汇退税等环节的课程仍在制作，未列出的工作以主管安排和系统提示为准。</p>
</section>`;
}

export const sopStyles = `
.sop-card{margin-top:32px;padding:22px 24px;border:1px solid var(--line);border-radius:14px}
.sop-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.sop-head h2{margin:0;padding:0;font-size:18px}
.sop-print{font:inherit;font-size:13px;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;background:var(--bg-2);color:var(--ink-2)}
.sop-grid{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px 20px;margin:0;font-size:14.5px}
.sop-grid>dt{color:var(--ink-3);font-size:13px;padding-top:2px}.sop-grid>dd{margin:0;min-width:0}
.sop-grid .table-wrap{margin:0}
.sop-note{margin:4px 0 0;color:var(--ink-2);font-size:13.5px}
.sop-steps th[scope=row]{width:52px;text-align:center;background:var(--bg-2);color:var(--ink-3);font-weight:500}
.sop-steps td{font-size:13.5px;line-height:1.7}.sop-steps td b{font-weight:600}
.sop-fill-label{font-size:12px;color:var(--ink-3);margin-right:6px}
.sop-list{margin:0;padding-left:18px}.sop-list li{margin:4px 0}
.sop-table td:first-child{white-space:nowrap}
.sop-count{font-size:12px;font-weight:400;color:var(--ink-3);margin-left:10px}
.sop-jump{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:18px 0 8px;font-size:13.5px}.sop-jump span{color:var(--ink-3)}.sop-jump span+a{margin-left:0}.sop-jump a{padding:4px 10px;border-radius:999px;background:var(--bg-2)}
.chapter h2[id],.chapter h3[id]{scroll-margin-top:80px}
.sop-text .sop-kicker{font-size:13px;letter-spacing:.06em;color:var(--accent);margin:0}
@media(max-width:700px){.sop-card{padding:18px 16px;margin-left:-4px;margin-right:-4px}.sop-grid{grid-template-columns:1fr;gap:2px}.sop-grid>dd{margin-bottom:12px}.sop-table td:first-child{white-space:normal}}
@media print{.mobile-nav,.lesson-rail,.lesson-work,.lesson-footer,.lesson-done,.sop-print,.lesson-review-note{display:none!important}.sop-card{border:0;padding:0}.table-wrap{overflow:visible}}
`;
