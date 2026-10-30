#!/usr/bin/env node
/**
 * 从 server/src/shared/*.ts 的类型声明生成 Mist 命令目录，供 MCP 接口告诉 Agent 有哪些命令、payload 长什么样。
 *
 *   node scripts/gen-mist-command-catalog.mjs          # 写入 server/src/mist/agentCommandCatalog.ts
 *   node scripts/gen-mist-command-catalog.mjs --check  # 只比对，不一致时退出码 1（测试也会比对）
 *
 * payload 原样取自源码的类型字面量（压成一行），引用的命名类型不展开；真正的校验仍由命令执行时的业务规则完成。
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

export function buildCatalog() {
  const found = new Map();
  for (const file of fs.readdirSync(SHARED).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
    const text = fs.readFileSync(path.join(SHARED, file), 'utf8');
    for (const match of text.matchAll(/\{\s*type:\s*'([a-z][\w]*(?:\.[\w]+)+)'\s*;\s*payload\??:\s*/g)) {
      const at = match.index + match[0].length;
      const payload = text[at] === '{' ? balanced(text, at) : (text.slice(at).match(/^[\w.<>[\]|' ]+/) || [''])[0].trim();
      if (!payload || found.has(match[1])) continue;
      found.set(match[1], { type: match[1], payload: payload.replace(/\s+/g, ' ').slice(0, 1500), source: `server/src/shared/${file}` });
    }
  }
  return [...found.values()].sort((a, b) => a.type.localeCompare(b.type));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = buildCatalog();
  const next = `// 由 scripts/gen-mist-command-catalog.mjs 生成，请勿手改。\nexport const MIST_COMMAND_CATALOG: ReadonlyArray<{ type: string; payload: string; source: string }> = ${JSON.stringify(entries, null, 1)};\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(CATALOG) ? fs.readFileSync(CATALOG, 'utf8') : '';
    if (current !== next) { console.error('命令目录与源码不一致，请运行 node scripts/gen-mist-command-catalog.mjs'); process.exit(1); }
    console.log('✓ 命令目录与源码一致');
  } else { fs.writeFileSync(CATALOG, next); console.log(`✓ ${entries.length} 个命令 → ${path.relative(ROOT, CATALOG)}`); }
}
