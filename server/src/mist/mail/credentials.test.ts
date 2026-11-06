import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MistMailCredentials } from './credentials';

describe('邮箱凭据存储（生产前置条件）', () => {
  const dirs: string[] = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
  const dir = async () => { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-cred-')); dirs.push(d); return d; };

  it('refuses to store a password in production without an encryption key or a persistent directory', async () => {
    const root = await dir(); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(MistMailCredentials.productionProblem({ NODE_ENV: 'production', MIST_MAIL_CREDENTIAL_DIR: root })).toContain('MIST_MAIL_CREDENTIAL_KEY');
    expect(MistMailCredentials.productionProblem({ NODE_ENV: 'production', MIST_MAIL_CREDENTIAL_KEY: 'x'.repeat(32) })).toContain('MIST_MAIL_CREDENTIAL_DIR');
    expect(MistMailCredentials.productionProblem({ NODE_ENV: 'production', MIST_MAIL_CREDENTIAL_KEY: 'short', MIST_MAIL_CREDENTIAL_DIR: root })).toContain('至少 32 位');
    const store = new MistMailCredentials(root, undefined, { NODE_ENV: 'production', MIST_MAIL_CREDENTIAL_DIR: root });
    await expect(store.save('ws-1', 'acc-1', { username: 'a', password: 'secret-value' })).rejects.toMatchObject({ code: 'MAIL_CREDENTIAL_STORE_UNAVAILABLE' });
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('encrypts in production with a key, so the password is not on disk in a reversible plain form', async () => {
    const root = await dir(), env = { NODE_ENV: 'production', MIST_MAIL_CREDENTIAL_KEY: 'k'.repeat(48), MIST_MAIL_CREDENTIAL_DIR: root };
    const store = new MistMailCredentials(root, env.MIST_MAIL_CREDENTIAL_KEY, env);
    await store.save('ws-1', 'acc-1', { username: 'a', password: 'secret-value' });
    const raw = await fs.readFile(path.join(root, 'ws-1', 'acc-1.json'), 'utf8');
    expect(raw).not.toContain('secret-value'); expect(JSON.parse(raw)).not.toHaveProperty('plain');
    expect(Buffer.from(JSON.parse(raw).data, 'base64').toString()).not.toContain('secret-value');
    await expect(store.load('ws-1', 'acc-1')).resolves.toEqual({ username: 'a', password: 'secret-value' });
  });

  it('reports a filesystem failure as a store error and logs only the error code', async () => {
    const root = path.join(await dir(), 'file');await fs.writeFile(root, 'not a directory');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MistMailCredentials(root, undefined, { NODE_ENV: 'test' });
    await expect(store.save('ws-1', 'acc-1', { username: 'a', password: 'secret-value' })).rejects.toMatchObject({ code: 'MAIL_CREDENTIAL_STORE_UNAVAILABLE' });
    expect(log).toHaveBeenCalledWith('[mail-credentials] save failed', expect.any(String));
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');expect(JSON.stringify(log.mock.calls)).not.toContain(root);
  });
});
