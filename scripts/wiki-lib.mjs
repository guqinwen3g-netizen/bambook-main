/**
 * wiki 手册的共用读取与版本判定逻辑。
 * 被 scripts/wiki-check.mjs（体检/登记）与 scripts/wiki-build.mjs（HTML 成品）共用，
 * 保证"登记看到的"和"成品显示的"是同一套结论。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const WIKI = path.join(root, 'wiki');
export const PAGES = path.join(WIKI, 'pages');
export const SITE = path.join(WIKI, 'site');

export const STATUS_LABEL = { draft: '草稿', written: '已撰写', verified: '已核验' };
export const VERDICT_LABEL = { current: '有效', stale: '需复核', unverified: '未核验', 'unknown-commit': '版本不可考' };
export const PART_ORDER = ['开始使用', '我的事务', '客户与市场', '订单履约', '财务与成本', '平台与管理', '附录'];

const gitRaw = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

export const head = () => gitRaw('rev-parse', '--short', 'HEAD') || 'unknown';
export const branch = () => gitRaw('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown';
export const commitExists = commit => {
  if (!commit) return false;
  try { execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
};
export const commitsSince = (commit, sources) => {
  if (!sources.length) return null;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return Number(execFileSync('git', ['rev-list', '--count', `${commit}..HEAD`, '--', ...sources], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { return null; }
};

export const packageVersion = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/** 页面清单唯一真源：components/moduleRegistry.ts#BAMBOOK_MODULES */
export function readModules() {
  const file = path.join(root, 'components/moduleRegistry.ts');
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const prop = (obj, name) => obj?.properties?.find(p => p.name && p.name.text === name)?.initializer;
  const text = node => (!node ? '' : ts.isStringLiteral(node) ? node.text : node.getText(sf));
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const decl of st.declarationList.declarations) {
      if (decl.name.getText(sf) !== 'BAMBOOK_MODULES') continue;
      return decl.initializer.elements.map(el => {
        const nav = prop(el, 'nav');
        const entry = prop(el, 'entry');
        const subs = prop(el, 'subViews');
        return {
          id: text(prop(el, 'id')),
          label: text(prop(el, 'productLabel')),
          view: text(prop(el, 'view')),
          group: text(prop(nav, 'group')),
          primary: prop(nav, 'primary')?.getText(sf) !== 'false',
          order: Number(text(prop(nav, 'order')) || 999),
          entry: text(prop(entry, 'current')),
          subViews: subs ? subs.elements.map(s => text(prop(s, 'label'))) : [],
        };
      });
    }
  }
  throw new Error('components/moduleRegistry.ts 里找不到 BAMBOOK_MODULES');
}

export function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { data: {}, body: raw };
  const data = {};
  let listKey = null;
  for (const line of raw.slice(3, end).split('\n')) {
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] ||= []).push(item[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    const clean = value.trim();
    listKey = null;
    if (!clean) {
      data[key] = [];
      listKey = key;
    } else if (clean.startsWith('[') && clean.endsWith(']')) {
      data[key] = clean.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      data[key] = clean.replace(/^['"]|['"]$/g, '');
    }
  }
  return { data, body: raw.slice(end + 4) };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) return walk(abs);
    return item.name.endsWith('.md') ? [abs] : [];
  });
}

export function readChapters() {
  return walk(PAGES)
    .map(abs => {
      const { data, body } = parseFrontMatter(fs.readFileSync(abs, 'utf8'));
      const rel = path.relative(root, abs);
      return {
        file: rel,
        slug: path.relative(PAGES, abs).replace(/\.md$/, ''),
        title: data.title || path.basename(abs, '.md'),
        module: data.module && data.module !== 'null' ? data.module : null,
        part: data.part || '其他',
        order: Number(data.order || 999),
        status: data.status || 'draft',
        verifiedCommit: data.verifiedCommit || '',
        verifiedAt: data.verifiedAt || '',
        sources: Array.isArray(data.sources) ? data.sources : data.sources ? [data.sources] : [],
        gifs: Array.isArray(data.gifs) ? data.gifs : data.gifs ? [data.gifs] : [],
        screenshots: Array.isArray(data.screenshots) ? data.screenshots : data.screenshots ? [data.screenshots] : [],
        body,
      };
    })
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

export function verdictFor(chapter, modules) {
  if (!chapter.verifiedCommit) return { verdict: 'unverified', commits: 0 };
  if (!commitExists(chapter.verifiedCommit)) return { verdict: 'unknown-commit', commits: 0 };
  // Registry entries may point at retired Manager components. Never silently certify a chapter using them.
  const sources = chapter.sources;
  if (!sources.length || sources.some(source => !fs.existsSync(path.join(root, source)))) return { verdict: 'unverified', commits: 0 };
  const count = commitsSince(chapter.verifiedCommit, sources);
  if (count === null || !Number.isFinite(count)) return { verdict: 'unverified', commits: 0 };
  try {
    for (const source of sources) execFileSync('git', ['ls-files', '--error-unmatch', '--', source], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...sources], { cwd: root, stdio: 'ignore' });
  } catch (error) {
    return { verdict: 'unverified', commits: count };
  }
  return { verdict: count > 0 ? 'stale' : 'current', commits: count };
}

/** 全量快照：模块、章节、对账结论，一次算清。 */
export function snapshot() {
  const modules = readModules();
  const chapters = readChapters().map(c => {
    const { verdict, commits } = verdictFor(c, modules);
    const missingMedia = [...c.gifs, ...(c.screenshots || [])].filter(f => !fs.existsSync(path.join(WIKI, f)));
    return { ...c, verdict, commits, missingMedia };
  });
  const covered = new Set(chapters.map(c => c.module).filter(Boolean));
  return {
    version: packageVersion(),
    head: head(),
    branch: branch(),
    modules,
    chapters,
    covered,
    missingModules: modules.filter(m => !covered.has(m.id)),
    orphans: chapters.filter(c => c.module && !modules.some(m => m.id === c.module)),
    badMedia: chapters.flatMap(c => c.missingMedia.map(f => `${c.title}: ${f}`)),
  };
}
