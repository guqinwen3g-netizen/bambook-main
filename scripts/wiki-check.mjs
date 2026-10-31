#!/usr/bin/env node
/**
 * 员工使用手册（wiki/）的版本登记与守门脚本。
 *
 * 解决的问题：手册会随版本漂移 —— 页面改了、手册没改，员工照旧操作就会出错。
 * 入口列表参考 components/moduleRegistry.ts；核验必须明确列出当前运行源码，不能用旧 Manager 自动推断。
 *
 *   node scripts/wiki-check.mjs           # 体检报告
 *   node scripts/wiki-check.mjs --write   # 生成 wiki/registry.json、目录.md、版本登记.md
 *   node scripts/wiki-check.mjs --strict  # 未登记页面 / 需复核 / 未核验 / 缺图 → 退出码 1
 */
import fs from 'node:fs';
import path from 'node:path';
import { WIKI, STATUS_LABEL, VERDICT_LABEL, snapshot } from './wiki-lib.mjs';
import { readLessonCatalog, publicManualCatalog } from './manual-catalog.mjs';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const STRICT = argv.includes('--strict');
const STRICT_LESSONS = argv.includes('--strict-lessons');
const courses = readLessonCatalog();

const snap = snapshot();
const { version, head, branch, modules, chapters, covered, missingModules, orphans, badMedia } = snap;
const tally = chapters.reduce((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] || 0) + 1 }), {});
const unverified = chapters.filter(c => c.verdict === 'unverified' || c.verdict === 'unknown-commit');
const stale = chapters.filter(c => c.verdict === 'stale');

console.log('Bambook 员工使用手册 · 版本体检');
console.log(`  主线 ${branch} @ ${head} · 产品版本 ${version}`);
console.log(`  引导课程 ${courses.totals.lessons} 课 · ${courses.totals.steps} 步 · ${courses.totals.images} 张图片`);
for (const track of courses.tracks) console.log(`    ${track.name}：${track.lessons} 课 / ${track.steps} 步`);
console.log(`  采集软件版本：已登记 ${courses.verification.provenanceRegistered || 0} · 未登记 ${courses.verification.provenanceUnknown || 0}`);
console.log(`  播放核验声明：通过 ${courses.verification.playback?.passed || 0} · 待核验/未知 ${(courses.verification.playback?.pending || 0) + (courses.verification.playback?.unknown || 0)} · 未通过 ${courses.verification.playback?.failed || 0} · 需复核 ${courses.verification.playback?.stale || 0}`);
console.log(`  员工验收声明：已认可 ${courses.verification.employee?.accepted || 0} · 待验收/未知 ${(courses.verification.employee?.pending || 0) + (courses.verification.employee?.unknown || 0)} · 需改进 ${courses.verification.employee?.['changes-requested'] || 0} · 需复核 ${courses.verification.employee?.stale || 0}`);
for (const issue of courses.issues) console.log(`  [课程结构错误] ${issue.lessonId} · ${issue.message} · ${issue.file}`);
console.log('\n旧 Markdown 参考章节登记（不统计上述引导课程，不代表新版课程完成率）：');
console.log(`  模块入口清单 ${modules.length} 个 · 已登记 ${covered.size} · 未登记 ${missingModules.length}`);
console.log(`  章节 ${chapters.length} 篇 · ` + Object.entries(VERDICT_LABEL).map(([k, v]) => `${v} ${tally[k] || 0}`).join(' · '));

if (missingModules.length) {
  console.log('\n未登记的模块页面（手册缺口）：');
  for (const m of missingModules) console.log(`  - ${m.label} (${m.id})`);
}
if (orphans.length) {
  console.log('\n登记了但代码里已不存在的模块（章节过期）：');
  for (const c of orphans) console.log(`  - ${c.file} → module: ${c.module}`);
}
if (stale.length) {
  console.log('\n需复核的章节（核验后代码有改动）：');
  for (const c of stale) console.log(`  - ${c.title} · 自 ${c.verifiedCommit} 起 ${c.commits} 次提交 · ${c.file}`);
}
if (unverified.length) {
  console.log('\n未核验 / 版本不可考的章节：');
  for (const c of unverified) console.log(`  - ${c.title}（${VERDICT_LABEL[c.verdict]}）· ${c.file}`);
}
if (badMedia.length) {
  console.log('\n声明了但缺失的图：');
  for (const m of badMedia) console.log(`  - ${m}`);
}

if (WRITE) {
  if (courses.issues.length) throw new Error('课程结构异常，未更新手册登记文件；修正后再运行 --write');
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const registry = {
    product: 'Bambook',
    productVersion: version,
    mainCommit: head,
    branch,
    generatedAt,
    generatedBy: 'scripts/wiki-check.mjs',
    sourceOfTruth: 'components/moduleRegistry.ts#BAMBOOK_MODULES',
    coverage: { modules: modules.length, registered: covered.size, chapters: chapters.length },
    teaching: publicManualCatalog(courses, { commit: head, productVersion: version, generatedAt }),
    modules: modules.map(m => {
      const c = chapters.find(x => x.module === m.id);
      return {
        id: m.id, label: m.label, group: m.group, entry: m.entry, subViews: m.subViews,
        chapter: c ? c.file : null,
        status: c ? c.status : null,
        verdict: c ? c.verdict : 'unregistered',
        verifiedCommit: c ? c.verifiedCommit : null,
      };
    }),
    chapters: chapters.map(c => ({
      slug: c.slug, title: c.title, module: c.module, part: c.part, status: c.status,
      file: c.file, verifiedCommit: c.verifiedCommit, verifiedAt: c.verifiedAt,
      verdict: c.verdict, commitsSinceVerified: c.commits, missingMedia: c.missingMedia,
    })),
  };
  fs.mkdirSync(WIKI, { recursive: true });
  fs.writeFileSync(path.join(WIKI, 'registry.json'), JSON.stringify(registry, null, 2) + '\n');

  fs.writeFileSync(
    path.join(WIKI, '目录.md'),
    [
      '# Bambook 员工使用手册 · 目录',
      '',
      `> 自动生成，勿手改。来源：各章 front-matter。产品版本 ${version} · 主线 ${head} · ${generatedAt}`,
      '',
      '| 章节 | 模块 | 状态 | 核验版本 | 有效性 |',
      '|---|---|---|---|---|',
      ...chapters.map(c => {
        const m = modules.find(x => x.id === c.module);
        return `| [${c.title}](${path.relative(WIKI, path.join(WIKI, '..', c.file))}) | ${m ? m.label : '—'} | ${STATUS_LABEL[c.status] || c.status} | ${c.verifiedCommit || '—'} | ${VERDICT_LABEL[c.verdict]} |`;
      }),
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(WIKI, '版本登记.md'),
    [
      '# 手册版本登记',
      '',
      '> 自动生成，勿手改。由 `node scripts/wiki-check.mjs --write` 依据各章 front-matter 与 Git 现状生成。',
      '',
      '| 登记项 | 当前值 |',
      '|---|---|',
      `| 产品版本 | ${version} |`,
      `| 主线分支 / 提交 | ${branch} @ ${head} |`,
      `| 页面真源 | \`components/moduleRegistry.ts\`（${modules.length} 个模块入口） |`,
      `| 手册章节 | ${chapters.length} 篇（已核验 ${tally.current || 0} · 需复核 ${tally.stale || 0} · 未核验 ${unverified.length}） |`,
      `| 页面登记覆盖 | ${covered.size} / ${modules.length} |`,
      `| 生成时间 | ${generatedAt} |`,
      '',
      '## 待复核章节',
      '',
      ...(stale.length
        ? ['| 章节 | 核验版本 | 之后改动 |', '|---|---|---|', ...stale.map(c => `| ${c.title} | ${c.verifiedCommit} | ${c.commits} 次提交 |`)]
        : ['无。']),
      '',
      '## 未登记页面',
      '',
      ...(missingModules.length
        ? ['| 模块 | 入口组件 |', '|---|---|', ...missingModules.map(m => `| ${m.label} (${m.id}) | \`${m.entry}\` |`)]
        : ['无。']),
      '',
    ].join('\n')
  );

  console.log('\n已生成：wiki/registry.json、wiki/目录.md、wiki/版本登记.md');
}

if (STRICT) {
  const problems = missingModules.length + orphans.length + stale.length + unverified.length + badMedia.length + courses.issues.length;
  if (problems) {
    console.log(`\n[strict] ${problems} 项未收口，退出码 1。`);
    process.exit(1);
  }
  console.log('\n[strict] 全部收口。');
}

if (STRICT_LESSONS) {
  if (courses.issues.length) {
    console.log(`\n[strict-lessons] ${courses.issues.length} 项课程结构错误，退出码 1。`);
    process.exitCode = 1;
  } else console.log('\n[strict-lessons] 课程结构完整；播放核验和员工验收声明仍按上方单列，不自动认定通过。');
}
