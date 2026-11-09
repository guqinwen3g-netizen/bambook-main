// scripts/ 工具自检：*.test.ts 走 vitest，*.test.mjs / *.test.cjs 是 node:test 文件，走 node --test。
// 用法：npm run test:scripts
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeTests = readdirSync(path.join(root, 'scripts')).filter((f) => /\.test\.(mjs|cjs)$/.test(f)).sort().map((f) => path.join('scripts', f));
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit' }).status ?? 1;

const vitest = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', 'scripts', '--exclude', '**/*.test.{mjs,cjs}', '--exclude', '**/node_modules/**']);
const nodeTest = run(process.execPath, ['--test', ...nodeTests]);
console.log(`\n[test:scripts] vitest ${vitest === 0 ? 'passed' : 'FAILED'} · node:test (${nodeTests.length} files) ${nodeTest === 0 ? 'passed' : 'FAILED'}`);
process.exit(vitest || nodeTest);
