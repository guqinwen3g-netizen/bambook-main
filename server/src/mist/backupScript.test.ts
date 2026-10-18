import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../scripts/mist-backup.mjs');
const temps: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mist-bk-')); temps.push(d); return d; };
afterEach(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const run = (args: string[], env: Record<string, string> = {}) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: os.tmpdir(), ...env } }); return { code: r.status, out: r.stdout + r.stderr }; };
function localWorkspace() {
  const dir = path.join(tmp(), 'mist-local');
  fs.mkdirSync(path.join(dir, 'files', 'ws-1'), { recursive: true }); fs.mkdirSync(path.join(dir, 'mail-credentials'));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ schemaVersion: 1, workspaces: { 'ws-1': { id: 'ws-1', revision: 7 }, 'ws-2': { id: 'ws-2', revision: 1 } }, receipts: {}, businessSequences: {} }));
  fs.writeFileSync(path.join(dir, 'files', 'ws-1', 'f-1'), 'PDF-模拟附件');
  fs.writeFileSync(path.join(dir, 'files', 'ws-1', 'f-2'), Buffer.alloc(2048, 7));
  fs.writeFileSync(path.join(dir, 'session.key'), Buffer.alloc(32, 1)); fs.writeFileSync(path.join(dir, 'mail-credentials', 'm.json'), '{"secret":"x"}');
  return dir;
}
const only = (dir: string) => fs.readdirSync(dir).filter(n => /^mist-/.test(n)).map(n => path.join(dir, n));

describe('Mist 备份与恢复脚本', () => {
  it('本地存储：备份 store.json 与附件（不含邮箱凭据与会话密钥）→ 核验 → 恢复到新目录，内容一致', () => {
    const src = localWorkspace(), out = tmp();
    const b = run(['backup', '--mode=local', `--local-dir=${src}`, `--out=${out}`]);
    expect(b.code, b.out).toBe(0);
    const [dir] = only(out); expect(path.basename(dir)).toMatch(/^mist-local-\d{8}-\d{6}$/);
    expect(fs.readdirSync(dir).sort()).toEqual(['files.tar.gz', 'manifest.json', 'store.json']);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ mode: 'local', artifacts: { 'store.json': { workspaces: 2 }, 'files.tar.gz': { files: 2 } } });
    expect(run(['verify', dir]).out).toContain('核验通过');
    const target = path.join(tmp(), 'restored');
    const r = run(['restore', dir, `--local-dir=${target}`]); expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(path.join(target, 'store.json'), 'utf8')).toBe(fs.readFileSync(path.join(src, 'store.json'), 'utf8'));
    expect(fs.readFileSync(path.join(target, 'files', 'ws-1', 'f-1'), 'utf8')).toBe('PDF-模拟附件');
    expect(fs.statSync(path.join(target, 'files', 'ws-1', 'f-2')).size).toBe(2048);
    expect(fs.existsSync(path.join(target, 'session.key'))).toBe(false); expect(fs.existsSync(path.join(target, 'mail-credentials'))).toBe(false);
  });

  it('拒绝覆盖已有数据（除非 --replace，原目录改名保留）；校验和不符即判损坏', () => {
    const src = localWorkspace(), out = tmp();
    expect(run(['backup', '--mode=local', `--local-dir=${src}`, `--out=${out}`]).code).toBe(0);
    const [dir] = only(out);
    const refused = run(['restore', dir, `--local-dir=${src}`]);
    expect(refused.code).toBe(2); expect(refused.out).toContain('--replace');
    const replaced = run(['restore', dir, `--local-dir=${src}`, '--replace']); expect(replaced.code, replaced.out).toBe(0);
    const aside = fs.readdirSync(path.dirname(src)).find(n => n.startsWith('mist-local.before-restore-'))!;
    expect(fs.existsSync(path.join(path.dirname(src), aside, 'session.key'))).toBe(true);
    fs.appendFileSync(path.join(dir, 'store.json'), ' ');
    const bad = run(['verify', dir]); expect(bad.code).toBe(1); expect(bad.out).toContain('校验和不符');
  });

  it('PostgreSQL：调用 pg_dump / pg_restore，附件一并打包；恢复须显式目标库且为空库，不读 DATABASE_URL；日志不含连接串', () => {
    const bin = tmp(), files = path.join(tmp(), 'mist-files'), out = tmp(), log = path.join(bin, 'calls.log');
    fs.mkdirSync(path.join(files, 'ws'), { recursive: true }); fs.writeFileSync(path.join(files, 'ws', 'a'), 'x');
    const stub = (name: string, body: string) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
    stub('pg_dump', 'for a in "$@"; do case "$a" in --file=*) printf DUMP > "${a#--file=}";; esac; done');
    stub('pg_restore', '[ "$1" = "--list" ] && { echo "1; 0 0 TABLE DATA public MistWorkspace x"; echo "2; 0 0 TABLE DATA public UserAccount x"; }; exit 0');
    stub('psql', 'echo "${TABLES:-0}"');
    const env = { PATH: `${bin}:${process.env.PATH}`, DATABASE_URL: 'postgresql://u:secret-pass@db.local:5432/bambook?schema=public', MIST_FILES_DIR: files };
    const b = run(['backup', `--out=${out}`], env); expect(b.code, b.out).toBe(0);
    expect(b.out).not.toContain('secret-pass');
    expect(fs.readFileSync(log, 'utf8')).toContain('pg_dump postgresql://u:secret-pass@db.local:5432/bambook --format=custom');
    const [dir] = only(out); expect(path.basename(dir)).toMatch(/^mist-pg-/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).artifacts).toMatchObject({ 'database.dump': { tableData: 2 }, 'files.tar.gz': { files: 1 } });
    const noTarget = run(['restore', dir, `--files-dir=${tmp()}/f`], env); expect(noTarget.code).toBe(2); expect(noTarget.out).toContain('--target-database-url');
    const busy = run(['restore', dir, '--target-database-url=postgresql://u@db.local/restore_1', `--files-dir=${tmp()}/f`], { ...env, TABLES: '3' });
    expect(busy.code).toBe(2); expect(busy.out).toContain('不是空库');
    const target = path.join(tmp(), 'f'), ok = run(['restore', dir, '--target-database-url=postgresql://u@db.local/restore_1', `--files-dir=${target}`], env);
    expect(ok.code, ok.out).toBe(0);
    expect(fs.readFileSync(log, 'utf8')).toContain('pg_restore --no-owner --no-acl --exit-on-error --dbname=postgresql://u@db.local/restore_1');
    expect(fs.readFileSync(path.join(target, 'ws', 'a'), 'utf8')).toBe('x');
  });
  it('保留策略只清理本脚本命名、超过保留天数的备份目录', () => {
    const src = localWorkspace(), out = tmp(), old = path.join(out, 'mist-local-20200101-000000'), other = path.join(out, 'manual-copy');
    fs.mkdirSync(old); fs.mkdirSync(other); const past = new Date('2020-01-01'); fs.utimesSync(old, past, past); fs.utimesSync(other, past, past);
    const b = run(['backup', '--mode=local', `--local-dir=${src}`, `--out=${out}`, '--retention-days=7']); expect(b.code, b.out).toBe(0);
    expect(fs.existsSync(old)).toBe(false); expect(fs.existsSync(other)).toBe(true); expect(b.out).toContain('清理过期备份 1 份');
  });
});
