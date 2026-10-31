#!/usr/bin/env node
/**
 * 员工教学覆盖矩阵：把业务任务（wiki/matrix/coverage.json）与当前运行源码、课程登记连起来。
 *
 *   node scripts/manual-coverage.mjs           # 校验并打印汇总
 *   node scripts/manual-coverage.mjs --write   # 重新生成 docs/manual-coverage.md
 *   node scripts/manual-coverage.mjs --check   # 校验失败或文档过期 → 退出码 1
 *
 * 教学状态只由证据推导，不手填：
 *   待实现      impl=missing（能力未交付）
 *   未核对      impl=unchecked（还没核对源码与界面）
 *   待录制      能力已核对，但没有真实界面课程
 *   变更后待复核 任一课程的播放或员工核验因内容改动失效（stale）
 *   播放待验    有课程，播放核验未全部通过
 *   员工待验    播放已通过，员工尚未全部认可
 *   已验证      全部课程播放通过且员工认可
 * 文字章节（wiki/pages）单列，不能把纯文字说明算作已录制。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLessonCatalog } from './manual-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATES = ['待实现', '未核对', '待录制', '变更后待复核', '播放待验', '员工待验', '已验证'];
export const IMPL_LABEL = { walked: '界面已走通', source: '源码有页面与命令', missing: '未交付', unchecked: '未核对' };

export function readCommandTypes(rootDir = ROOT) {
  const text = fs.readFileSync(path.join(rootDir, 'server/src/mist/agentCommandCatalog.ts'), 'utf8');
  return new Set(JSON.parse(text.slice(text.indexOf('= [') + 2).replace(/;\s*$/, '')).map(entry => entry.type));
}

export function readViews(rootDir = ROOT) {
  const text = fs.readFileSync(path.join(rootDir, 'dev-ui-preview/mist-atelier/app/pageRegistry.tsx'), 'utf8');
  const views = new Set();
  const block = text.slice(text.indexOf('export const MODULE_VIEWS'), text.indexOf('} as const'));
  for (const m of block.matchAll(/'([\w/-]+)'/g)) views.add(m[1]);
  const pages = text.slice(text.indexOf('export function buildPages'), text.indexOf('/** 页面代码下载失败'));
  for (const m of pages.matchAll(/(?:'([\w/-]+)'|\b([a-z][\w]*))\s*:\s*(?:named|SettingsPage|AccountPage|SaasAdminPage|StatesPage|DesignSystemPage)/g)) views.add(m[1] || m[2]);
  return views;
}

export function deriveState(task, lessonRows) {
  if (task.impl === 'missing') return '待实现';
  if (task.impl === 'unchecked') return '未核对';
  if (!lessonRows.length) return '待录制';
  const status = row => [row.verification.playback.status, row.verification.employee.status];
  if (lessonRows.some(row => status(row).includes('stale'))) return '变更后待复核';
  if (lessonRows.some(row => row.verification.playback.status !== 'passed')) return '播放待验';
  if (lessonRows.some(row => row.verification.employee.status !== 'accepted')) return '员工待验';
  return '已验证';
}

export function buildCoverage({ rootDir = ROOT, matrix, catalog, commands, views } = {}) {
  matrix ??= JSON.parse(fs.readFileSync(path.join(rootDir, 'wiki/matrix/coverage.json'), 'utf8'));
  catalog ??= readLessonCatalog({ wikiDir: path.join(rootDir, 'wiki'), rootDir });
  commands ??= readCommandTypes(rootDir);
  views ??= readViews(rootDir);
  const lessons = new Map(catalog.lessons.map(row => [row.id, row]));
  const issues = [], ids = new Set(), used = new Set();
  const problem = (id, message) => issues.push({ id, message });
  const rows = matrix.tasks.map(task => {
    if (ids.has(task.id)) problem(task.id, '任务 ID 重复');
    ids.add(task.id);
    for (const field of ['stage', 'task']) if (!task[field]) problem(task.id, `缺少 ${field}`);
    if (!IMPL_LABEL[task.impl]) problem(task.id, `impl 只能是 ${Object.keys(IMPL_LABEL).join('/')}`);
    for (const mode of task.modes || []) if (!matrix.modes[mode]) problem(task.id, `未知业务模式 ${mode}`);
    for (const view of task.views || []) if (!views.has(view)) problem(task.id, `页面 ${view} 不在 pageRegistry.tsx`);
    for (const command of task.commands || []) if (!commands.has(command)) problem(task.id, `命令 ${command} 不在命令目录`);
    for (const page of task.pages || []) if (!fs.existsSync(path.join(rootDir, 'wiki/pages', page))) problem(task.id, `文字章节 ${page} 不存在`);
    const lessonRows = (task.lessons || []).map(id => { used.add(id); const row = lessons.get(id); if (!row) problem(task.id, `课程 ${id} 不存在`); return row; }).filter(Boolean);
    if (lessonRows.length && task.impl !== 'walked') problem(task.id, '有真实界面课程的任务应登记为 walked');
    if (task.impl === 'walked' && !lessonRows.length && !task.note) problem(task.id, 'walked 需要课程或走查说明');
    if (task.impl === 'missing' && lessonRows.length) problem(task.id, '未交付能力不能挂课程');
    return { ...task, kind: task.kind || 'main', lessonRows, state: deriveState(task, lessonRows) };
  });
  for (const row of catalog.lessons) if (!used.has(row.id)) problem(row.id, '课程未登记到任何任务');
  const count = list => Object.fromEntries(STATES.map(state => [state, list.filter(row => row.state === state).length]));
  const stages = [...new Set(rows.map(row => row.stage))].map(stage => ({ stage, rows: rows.filter(row => row.stage === stage) }));
  return { rows, stages, totals: count(rows), issues, catalog };
}

const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function renderCoverage({ rows, stages, totals, catalog }, modes) {
  const mode = list => (list || []).map(key => modes[key] || key).join('、');
  const lines = [
    '# 员工教学覆盖矩阵',
    '',
    '> 由 `node scripts/manual-coverage.mjs --write` 从 `wiki/matrix/coverage.json`、命令目录、`pageRegistry.tsx` 与课程登记生成，请勿手改。',
    '> 工程与教学排期用，不进入员工正文。状态只按证据推导；没有播放与员工核验登记的课程一律不算“通过”。',
    '',
    '## 汇总',
    '',
    `业务任务 ${rows.length} 项（主线 ${rows.filter(r => r.kind === 'main').length} · 分支 ${rows.filter(r => r.kind === 'branch').length}）· 真实界面课程 ${catalog.totals.lessons} 课 / ${catalog.totals.steps} 步 / ${catalog.totals.images} 图 · 课程采集提交号已登记 ${catalog.verification.provenanceRegistered || 0} 课、未知 ${catalog.verification.provenanceUnknown || 0} 课`,
    '',
    '| 状态 | 任务数 |',
    '|---|---|',
    ...STATES.map(state => `| ${state} | ${totals[state]} |`),
    '',
    '## 按业务阶段',
    '',
    `| 阶段 | 任务 | ${STATES.join(' | ')} |`,
    `|---|---|${STATES.map(() => '---').join('|')}|`,
    ...stages.map(({ stage, rows: list }) => `| ${stage} | ${list.length} | ${STATES.map(state => list.filter(row => row.state === state).length || '').join(' | ')} |`),
    '',
    '## 明细',
    '',
  ];
  for (const { stage, rows: list } of stages) {
    lines.push(`### ${stage}`, '', '| 任务 | 类型 | 岗位 | 业务模式 | 实现依据 | 课程 | 文字章节 | 教学状态 |', '|---|---|---|---|---|---|---|---|');
    for (const row of list) lines.push(`| ${cell(row.task)}${row.note ? `<br><small>${cell(row.note)}</small>` : ''} | ${row.kind === 'branch' ? '分支' : '主线'} | ${cell(row.roles.join('、'))} | ${cell(mode(row.modes))} | ${IMPL_LABEL[row.impl]} | ${cell(row.lessonRows.map(l => l.title).join('、')) || '—'} | ${cell((row.pages || []).map(p => p.replace(/\.md$/, '')).join('、')) || '—'} | ${row.state} |`);
    lines.push('');
  }
  return lines.join('\n');
}

const DOC = path.join(ROOT, 'docs/manual-coverage.md');
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const coverage = buildCoverage();
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'wiki/matrix/coverage.json'), 'utf8'));
  const doc = renderCoverage(coverage, matrix.modes) + '\n';
  console.log(`教学覆盖矩阵 · ${coverage.rows.length} 项任务`);
  for (const state of STATES) console.log(`  ${state} ${coverage.totals[state]}`);
  for (const issue of coverage.issues) console.log(`  [矩阵错误] ${issue.id} · ${issue.message}`);
  if (process.argv.includes('--write')) { fs.writeFileSync(DOC, doc); console.log(`已写入 ${path.relative(ROOT, DOC)}`); }
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '';
    if (current !== doc) console.log('  [过期] docs/manual-coverage.md 需要重新生成');
    if (coverage.issues.length || current !== doc) process.exit(1);
  }
}
