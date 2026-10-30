#!/usr/bin/env node
/**
 * 从 server/src/shared/*.ts 的类型声明生成 Mist 命令目录，供 MCP 接口告诉 Agent 有哪些命令、payload 长什么样。
 *
 *   node scripts/gen-mist-command-catalog.mjs          # 写入 server/src/mist/agentCommandCatalog.ts
 *   node scripts/gen-mist-command-catalog.mjs --check  # 只比对，不一致时退出码 1（测试也会比对）
 *
 * payload 原样取自源码的类型字面量（压成一行）；payload 引用的命名类型（如 OrderGovernanceInput）在 types 中给出定义，展开两层，
 * 否则 Agent 无从得知必填字段。真正的校验仍由命令执行时的业务规则完成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.join(ROOT, 'server/src/shared');
export const CATALOG = path.join(ROOT, 'server/src/mist/agentCommandCatalog.ts');

function balanced(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** 读取 `type Name = …;` 声明的右侧（到顶层分号或顶层换行且下一行不以 | / & 续写为止）。 */
function declaration(text, start) {
  let depth = 0, quote = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote && text[i - 1] !== '\\') quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && text[i + 1] === '/' ) { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl - 1; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
    if ('{([<'.includes(c)) depth++;
    else if ('})]>'.includes(c) && !(c === '>' && text[i - 1] === '=')) depth--;
    else if (depth === 0 && c === ';') return text.slice(start, i);
    else if (depth === 0 && c === '\n' && !/^\s*[|&]/.test(text.slice(i + 1, i + 200))) return text.slice(start, i);
  }
  return null;
}
const stripComments = value => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
export function collectTypes() {
  const types = new Map();
  for (const file of fs.readdirSync(SHARED).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
    const text = fs.readFileSync(path.join(SHARED, file), 'utf8');
    for (const match of text.matchAll(/(?:^|\n)\s*(?:export\s+)?type\s+([A-Z]\w*)(?:<[^=]*>)?\s*=\s*/g)) {
      if (types.has(match[1])) continue;
      const body = declaration(text, match.index + match[0].length);
      if (body) types.set(match[1], stripComments(body).replace(/\s+/g, ' ').trim());
    }
  }
  return types;
}
const BUILTIN = new Set(['Array', 'Record', 'Partial', 'Pick', 'Omit', 'Exclude', 'Extract', 'Required', 'Readonly', 'ReadonlyArray', 'NonNullable', 'Promise']);
function referenced(payload, types, depth = 2, out = new Map()) {
  for (const [name] of payload.matchAll(/\b[A-Z]\w*\b/g)) {
    if (BUILTIN.has(name) || out.has(name) || !types.has(name)) continue;
    const body = types.get(name).slice(0, 1500); out.set(name, body);
    if (depth > 1) referenced(body, types, depth - 1, out);
  }
  return out;
}

export function buildCatalog() {
  const types = collectTypes();
  const found = new Map();
  for (const file of fs.readdirSync(SHARED).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
    const text = fs.readFileSync(path.join(SHARED, file), 'utf8');
    for (const match of text.matchAll(/\{\s*type:\s*'([a-z][\w]*(?:\.[\w]+)+)'\s*;\s*payload\??:\s*/g)) {
      const at = match.index + match[0].length;
      let payload = text[at] === '{' ? balanced(text, at) : (text.slice(at).match(/^[\w.<>[\]|' ]+/) || [''])[0].trim();
      // 联合类型 payload（如 `{ purpose: 'prepayment'… } | { purpose: 'bill'… }`）须收齐全部分支，否则 Agent 只能看到第一种用法。
      if (payload && text[at] === '{') {
        for (let end = at + payload.length; ;) {
          const next = text.slice(end).match(/^\s*\|\s*(?=\{)/);
          if (!next) break;
          const variant = balanced(text, end + next[0].length);
          if (!variant) break;
          payload += ' | ' + variant; end += next[0].length + variant.length;
        }
      }
      if (!payload || found.has(match[1])) continue;
      const flat = payload.replace(/\s+/g, ' ').slice(0, 1500), refs = referenced(flat, types);
      found.set(match[1], { type: match[1], payload: flat, ...(refs.size ? { types: Object.fromEntries([...refs].slice(0, 12)) } : {}), source: `server/src/shared/${file}` });
    }
  }
  return [...found.values()].sort((a, b) => a.type.localeCompare(b.type));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = buildCatalog();
  const next = `// 由 scripts/gen-mist-command-catalog.mjs 生成，请勿手改。\nexport const MIST_COMMAND_CATALOG: ReadonlyArray<{ type: string; payload: string; types?: Record<string, string>; source: string }> = ${JSON.stringify(entries, null, 1)};\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(CATALOG) ? fs.readFileSync(CATALOG, 'utf8') : '';
    if (current !== next) { console.error('命令目录与源码不一致，请运行 node scripts/gen-mist-command-catalog.mjs'); process.exit(1); }
    console.log('✓ 命令目录与源码一致');
  } else { fs.writeFileSync(CATALOG, next); console.log(`✓ ${entries.length} 个命令 → ${path.relative(ROOT, CATALOG)}`); }
}
