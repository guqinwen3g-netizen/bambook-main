import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type LlmProviderCooldownStore = {
  active(keys: readonly string[], now: number): Promise<ReadonlyMap<string, number>>;
  remember(key: string, until: number, now: number): Promise<void>;
};

const PROVIDER_KEY = /^[a-f0-9]{64}$/;
const MARKER_NAME = /^([a-f0-9]{64})\.([1-9][0-9]{0,15})$/;
const isFileError = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code;

export function createProviderCooldownStore(platformDirectory: string): LlmProviderCooldownStore {
  const directory = path.join(platformDirectory, 'agent-task-cooldowns');
  return {
    async active(keys, now) {
      const selected = new Set(keys);
      const active = new Map<string, number>();
      if (!selected.size) return active;
      let markers: string[];
      try {
        markers = await readdir(directory);
      } catch (error) {
        if (!isFileError(error, 'ENOENT')) throw error;
        // A fresh store may have no markers. A missing private mount is unavailable.
        if (!(await stat(platformDirectory)).isDirectory()) throw error;
        return active;
      }
      const expired: string[] = [];
      for (const name of markers) {
        const marker = MARKER_NAME.exec(name);
        if (!marker) continue;
        const [, key, deadline] = marker;
        const until = Number(deadline);
        if (!Number.isSafeInteger(until)) continue;
        if (until <= now) expired.push(name);
        else if (selected.has(key)) active.set(key, Math.max(active.get(key) ?? 0, until));
      }
      await Promise.all(expired.map(name => unlink(path.join(directory, name)).catch(() => {})));
      return active;
    },
    async remember(key, until, now) {
      if (!PROVIDER_KEY.test(key) || !Number.isSafeInteger(until)) throw new Error('Invalid cooldown marker');
      if (until <= now) return;
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (!isFileError(error, 'EEXIST')) throw error;
      }
      // A deadline is immutable. Concurrent reports cannot replace a later deadline with an earlier one.
      try {
        await writeFile(path.join(directory, `${key}.${until}`), '', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (!isFileError(error, 'EEXIST')) throw error;
      }
    },
  };
}
