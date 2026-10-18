#!/usr/bin/env node
/**
 * Mist 工作区数据与附件的备份 / 核验 / 恢复（2026-10-18）。
 *
 * 两种存储：
 *   - pg：PostgreSQL（正式与开发环境）。备份 = pg_dump 自定义格式（含 MistWorkspace / 回执 / 账号等全部表）+ 附件目录打包。
 *         附件目录 MIST_FILES_DIR（默认 server/private/mist-files）。
 *   - local：本地文件存储（MIST_LOCAL_WORKSPACE=1，单人本机）。备份 = store.json + files/ 打包。
 * 顺序：先数据库 / store.json，后附件。备份期间新上传的附件只会“多出”，不会出现记录引用了却缺文件。
 * 不备份：邮箱授权凭据（mail-credentials）与本地会话密钥（session.key）——属于密钥，恢复后重新授权邮箱 / 重新进入即可。
 *
 * 用法：
 *   node server/scripts/mist-backup.mjs backup [--mode=pg|local] [--out=DIR] [--retention-days=14]
 *        pg 读 DATABASE_URL；local 读 --local-dir（默认 server/private/mist-local）。
 *        输出 DIR/mist-<mode>-YYYYMMDD-HHMMSS/：database.dump 或 store.json、files.tar.gz、manifest.json（sha256 与计数）。
 *        默认 DIR = BAMBOOK_BACKUP_DIR 或 server/private/backups；只清理 DIR 下本脚本命名的过期目录。
 *   node server/scripts/mist-backup.mjs verify <备份目录>
 *        重算校验和、检查 dump 目录可读（pg_restore --list）/ store.json 可解析、附件条数与清单一致。
 *   node server/scripts/mist-backup.mjs restore <备份目录> --target-database-url=URL --files-dir=DIR     （pg）
 *   node server/scripts/mist-backup.mjs restore <备份目录> --local-dir=DIR [--replace]                    （local）
 *        恢复前先 verify。pg：目标库必须显式给出（不读 DATABASE_URL）且为空库；附件目录必须不存在或为空。
 *        local：目标目录已有数据时须 --replace，原目录整体改名为 <DIR>.before-restore-<时间> 保留，不删除。
 * 日志不打印连接串与密码。退出码：0 成功；1 失败；2 参数错误或拒绝执行。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^mist-(pg|local)-\d{8}-\d{6}$/;
const say = (m) => console.log(`[mist-backup] ${m}`);
class Refuse extends Error {}
const refuse = (m) => { throw new Refuse(m); };

function args(argv) {
  const out = { _: [] };
  for (const a of argv) { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (m) out[m[1]] = m[2] ?? true; else out._.push(a); }
  return out;
}
function run(cmd, list, opts = {}) {
  const r = spawnSync(cmd, list, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.error) throw new Error(`${cmd} 无法执行：${r.error.code || r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} 失败（退出码 ${r.status}）：${(r.stderr || '').trim().split('\n').slice(-3).join(' ')}`);
  return r.stdout;
}
/** Prisma 的 ?schema= 参数 libpq 不认，去掉；其余参数保留。 */
function cleanUrl(raw, label) {
  let u; try { u = new URL(raw); } catch { refuse(`${label} 不是有效的 PostgreSQL 连接串`); }
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.pathname.slice(1)) refuse(`${label} 须为 postgresql://…/库名`);
  u.searchParams.delete('schema'); return u.toString();
}
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
function countFiles(dir) { let n = 0, bytes = 0; if (!fs.existsSync(dir)) return { count: 0, bytes: 0 }; for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) { n++; bytes += fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size; } return { count: n, bytes }; }
const isEmptyDir = (dir) => !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
/** 打包附件目录内容（目录不存在时打一个空包），返回包内文件条数。 */
function packFiles(dir, out) {
  const src = fs.existsSync(dir) ? dir : fs.mkdtempSync(path.join(path.dirname(out), '.empty-'));
  run('tar', ['-czf', out, '-C', src, '.']);
  if (src !== dir) fs.rmSync(src, { recursive: true });
  return tarCount(out);
}
const tarCount = (file) => run('tar', ['-tzf', file]).split('\n').filter((l) => l && !l.endsWith('/')).length;

function backup(o) {
  const mode = o.mode || (process.env.MIST_LOCAL_WORKSPACE === '1' ? 'local' : 'pg');
  if (mode !== 'pg' && mode !== 'local') refuse('--mode 只能是 pg 或 local');
  const root = path.resolve(o.out || process.env.BAMBOOK_BACKUP_DIR || path.join(SERVER, 'private/backups'));
  const keep = Number(o['retention-days'] ?? process.env.BAMBOOK_BACKUP_RETENTION_DAYS ?? 14);
  if (!Number.isInteger(keep) || keep < 1) refuse('--retention-days 须为正整数');
  let name = `mist-${mode}-${stamp()}`, dir = path.join(root, name);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.existsSync(dir)) refuse(`备份目录已存在：${dir}`);
  const work = path.join(root, `.${name}.partial`); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { mode: 0o700 });
  const manifest = { format: 1, mode, createdAt: new Date().toISOString(), artifacts: {}, excluded: ['mail-credentials（邮箱授权凭据）', 'session.key（本地会话密钥）'] };
  try {
    if (mode === 'pg') {
      if (!process.env.DATABASE_URL) refuse('pg 模式需要 DATABASE_URL');
      const url = cleanUrl(process.env.DATABASE_URL, 'DATABASE_URL'), dump = path.join(work, 'database.dump');
      say('导出数据库（pg_dump -Fc）…');
      run('pg_dump', [url, '--format=custom', '--no-owner', '--no-acl', `--file=${dump}`]);
      const entries = run('pg_restore', ['--list', dump]).split('\n').filter((l) => / TABLE DATA /.test(l)).length;
      manifest.artifacts['database.dump'] = { sha256: sha256(dump), bytes: fs.statSync(dump).size, tableData: entries };
      const filesDir = path.resolve(o['files-dir'] || process.env.MIST_FILES_DIR || path.join(SERVER, 'private/mist-files'));
      say('打包附件…'); const count = packFiles(filesDir, path.join(work, 'files.tar.gz'));
      manifest.artifacts['files.tar.gz'] = { sha256: sha256(path.join(work, 'files.tar.gz')), files: count, sourceBytes: countFiles(filesDir).bytes };
    } else {
      const localDir = path.resolve(o['local-dir'] || path.join(SERVER, 'private/mist-local')), store = path.join(localDir, 'store.json');
      if (!fs.existsSync(store)) refuse(`本地工作区没有 store.json：${localDir}`);
      fs.copyFileSync(store, path.join(work, 'store.json'));
      const parsed = JSON.parse(fs.readFileSync(path.join(work, 'store.json'), 'utf8'));
      manifest.artifacts['store.json'] = { sha256: sha256(path.join(work, 'store.json')), bytes: fs.statSync(store).size, workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.length : Object.keys(parsed.workspaces || {}).length };
      say('打包附件…'); const count = packFiles(path.join(localDir, 'files'), path.join(work, 'files.tar.gz'));
      manifest.artifacts['files.tar.gz'] = { sha256: sha256(path.join(work, 'files.tar.gz')), files: count };
    }
    fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(work, dir);
  } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw e; }
  say(`备份完成：${dir}`);
  // 保留策略：只删除本脚本命名、早于保留天数的目录。
  const cutoff = Date.now() - keep * 86400000; let removed = 0;
  for (const n of fs.readdirSync(root)) if (NAME.test(n) && n !== name && fs.statSync(path.join(root, n)).mtimeMs < cutoff) { fs.rmSync(path.join(root, n), { recursive: true }); removed++; }
  say(`保留 ${keep} 天，清理过期备份 ${removed} 份`);
  return dir;
}

function verify(dir) {
  if (!dir) refuse('请指定备份目录');
  dir = path.resolve(dir);
  const mf = path.join(dir, 'manifest.json'); if (!fs.existsSync(mf)) refuse(`不是备份目录（缺 manifest.json）：${dir}`);
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  for (const [file, meta] of Object.entries(manifest.artifacts || {})) {
    const p = path.join(dir, file); if (!fs.existsSync(p)) throw new Error(`缺少 ${file}`);
    if (sha256(p) !== meta.sha256) throw new Error(`${file} 校验和不符，备份已损坏或被改动`);
  }
  const files = manifest.artifacts['files.tar.gz']; if (!files) throw new Error('清单缺附件包');
  const n = tarCount(path.join(dir, 'files.tar.gz')); if (n !== files.files) throw new Error(`附件条数不符：清单 ${files.files}，包内 ${n}`);
  if (manifest.mode === 'pg') { const t = run('pg_restore', ['--list', path.join(dir, 'database.dump')]).split('\n').filter((l) => / TABLE DATA /.test(l)).length; if (t !== manifest.artifacts['database.dump'].tableData) throw new Error(`数据表条目不符：清单 ${manifest.artifacts['database.dump'].tableData}，dump 内 ${t}`); }
  else if (JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')).schemaVersion !== 1) throw new Error('store.json 格式版本不符');
  say(`核验通过：${path.basename(dir)}（${manifest.mode}，附件 ${files.files} 个）`);
  return manifest;
}

function restore(dir, o) {
  const manifest = verify(dir); dir = path.resolve(dir);
  if (manifest.mode === 'pg') {
    if (!o['target-database-url'] || o['target-database-url'] === true) refuse('pg 恢复须显式给出 --target-database-url（不读 DATABASE_URL，避免误覆盖在用的库）');
    if (!o['files-dir'] || o['files-dir'] === true) refuse('pg 恢复须给出 --files-dir（附件恢复到的目录）');
    const url = cleanUrl(o['target-database-url'], '--target-database-url'), filesDir = path.resolve(o['files-dir']);
    const tables = Number(run('psql', [url, '-At', '-c', "select count(*) from information_schema.tables where table_schema='public'"]).trim());
    if (!(tables === 0)) refuse(`目标库不是空库（public 下已有 ${tables} 张表）；请新建空库后再恢复`);
    if (!isEmptyDir(filesDir)) refuse(`附件目录不为空：${filesDir}`);
    say('恢复数据库（pg_restore）…');
    run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', `--dbname=${url}`, path.join(dir, 'database.dump')]);
    fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 }); run('tar', ['-xzf', path.join(dir, 'files.tar.gz'), '-C', filesDir]);
    say(`恢复完成：数据库与 ${manifest.artifacts['files.tar.gz'].files} 个附件。请把服务的 DATABASE_URL / MIST_FILES_DIR 指向恢复目标后重启，并重新授权邮箱。`);
    return;
  }
  if (!o['local-dir'] || o['local-dir'] === true) refuse('local 恢复须给出 --local-dir');
  const target = path.resolve(o['local-dir']);
  if (!isEmptyDir(target)) {
    if (!o.replace) refuse(`目标目录已有数据：${target}；确认覆盖请加 --replace（原目录会改名保留）`);
    const aside = `${target}.before-restore-${stamp()}`; fs.renameSync(target, aside); say(`原目录已改名保留：${aside}`);
  }
  fs.mkdirSync(path.join(target, 'files'), { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(dir, 'store.json'), path.join(target, 'store.json')); fs.chmodSync(path.join(target, 'store.json'), 0o600);
  run('tar', ['-xzf', path.join(dir, 'files.tar.gz'), '-C', path.join(target, 'files')]);
  say(`恢复完成：${manifest.artifacts['store.json'].workspaces} 个工作区与 ${manifest.artifacts['files.tar.gz'].files} 个附件。重启本地服务后重新进入。`);
}

const o = args(process.argv.slice(2)), [cmd, target] = o._;
try {
  if (cmd === 'backup') backup(o);
  else if (cmd === 'verify') verify(target);
  else if (cmd === 'restore') restore(target, o);
  else refuse('用法：mist-backup.mjs backup|verify|restore …（见文件头说明）');
} catch (e) {
  console.error(`[mist-backup] ${e instanceof Refuse ? '拒绝执行' : '失败'}：${e.message}`);
  process.exit(e instanceof Refuse ? 2 : 1);
}
