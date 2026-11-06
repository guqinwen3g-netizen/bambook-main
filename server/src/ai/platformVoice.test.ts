import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPlatformVoiceStore } from './platformVoice';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'bambook-voice-config-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const input = { revision: 0, enabled: true, voice: 'zh_female_qingchezizi_uranus_bigtts', speed: 0, loudness: 0, apiKey: 'test-only-private-voice-key' };
it('stores the key privately, returns only configuration status and survives a new process/store instance', async () => {
  const store = createPlatformVoiceStore({ dir, env: {} });
  const saved = store.save(input);
  expect(saved).toMatchObject({ revision: 1, enabled: true, configured: true, hasKey: true });
  expect(JSON.stringify(saved)).not.toContain(input.apiKey);
  expect(createPlatformVoiceStore({ dir, env: {} }).runtime()?.apiKey).toBe(input.apiKey);
  expect((await stat(path.join(dir, 'platform-voice.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  expect(JSON.parse(await readFile(path.join(dir, 'platform-voice.json'), 'utf8')).revision).toBe(1);
});
it('rejects a stale save and preserves the current key when the administrator leaves it blank', () => {
  const store = createPlatformVoiceStore({ dir, env: {} }); store.save(input);
  expect(() => store.save(input)).toThrow('语音配置已变化');
  store.save({ ...input, revision: 1, apiKey: '', speed: 10 });
  expect(store.runtime()).toMatchObject({ apiKey: input.apiKey, speed: 10 });
});
it('disables and removes the connection without silently reviving the environment fallback', () => {
  const store = createPlatformVoiceStore({ dir, env: { BAMBOOK_VOICE_API_KEY: 'environment-private-key' } });
  expect(store.view()).toMatchObject({ configured: true, revision: 0 });
  store.save({ ...input, enabled: false, clearKey: true, apiKey: undefined });
  expect(store.runtime()).toBeNull(); expect(store.view()).toMatchObject({ configured: false, hasKey: false });
  expect(() => store.save({ ...input, revision: 1, apiKey: '' })).toThrow('请先填写');
});
it('fails closed on a damaged configuration and rejects invalid header/control values', async () => {
  const store = createPlatformVoiceStore({ dir, env: { BAMBOOK_VOICE_API_KEY: 'environment-private-key' } });
  expect(() => store.save({ ...input, apiKey: 'x\r\ny' })).toThrow('请核对');
  expect(() => store.save({ ...input, loudness: 101 })).toThrow('请核对');
  expect(() => store.save({ ...input, endpoint: 'http://internal.invalid' })).toThrow('字段无效');
  await writeFile(path.join(dir, 'platform-voice.json'), 'broken');
  expect(store.runtime()).toBeNull(); expect(() => store.view()).toThrow('无法读取');
});
it('keeps the old runtime during audit and restores it if durable audit fails', async () => {
  const store = createPlatformVoiceStore({ dir, env: {} }); store.save(input);
  await expect(store.update({ ...input, revision: 1, apiKey: 'rotated-private-key' }, async next => {
    expect(next.revision).toBe(2); expect(store.runtime()?.apiKey).toBe(input.apiKey); expect(store.view().revision).toBe(1);
    throw new Error('audit unavailable');
  })).rejects.toThrow('audit unavailable');
  expect(store.runtime()?.apiKey).toBe(input.apiKey); expect(store.view().revision).toBe(1);
  expect(createPlatformVoiceStore({ dir, env: {} }).runtime()?.apiKey).toBe(input.apiKey);
});
