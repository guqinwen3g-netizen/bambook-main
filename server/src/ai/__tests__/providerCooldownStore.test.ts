import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProviderCooldownStore } from '../providerCooldownStore';

let directory: string;
const key = 'a'.repeat(64);
const otherKey = 'b'.repeat(64);

beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'provider-cooldown-markers-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('preserves the greatest live deadline across writers and cleans up only expired markers', async () => {
  const first = createProviderCooldownStore(directory);
  const second = createProviderCooldownStore(directory);
  expect(await first.active([key], 10)).toEqual(new Map());
  await Promise.all([
    first.remember(key, 40, 10), second.remember(key, 30, 10), second.remember(key, 40, 10),
    first.remember(otherKey, 50, 10),
  ]);
  expect(await first.active([key], 30)).toEqual(new Map([[key, 40]]));
  expect(await second.active([key, otherKey], 40)).toEqual(new Map([[otherKey, 50]]));
  const markers = path.join(directory, 'agent-task-cooldowns');
  expect(await readdir(markers)).toEqual([`${otherKey}.50`]);
  expect((await stat(markers)).mode & 0o777).toBe(0o700);
  expect((await stat(path.join(markers, `${otherKey}.50`))).mode & 0o777).toBe(0o600);
});

it('distinguishes an absent private directory from a new store', async () => {
  const missing = createProviderCooldownStore(path.join(directory, 'not-mounted'));
  await expect(missing.active([key], 10)).rejects.toHaveProperty('code', 'ENOENT');
  await expect(missing.remember(key, 20, 10)).rejects.toHaveProperty('code', 'ENOENT');
  expect(await readdir(directory)).toEqual([]);
});
