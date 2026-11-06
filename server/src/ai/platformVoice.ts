/** Platform-owned speech connection. Provider secrets are write-only to callers. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { voiceConfig, type VoiceConfig } from '../mist/voice/protocol';
import { MistApiError } from '../mist/errors';

type Stored = { schema: 1; revision: number; enabled: boolean; apiKey: string; voice: string; speed: number; loudness: number };
export type PlatformVoiceView = { revision: number; enabled: boolean; hasKey: boolean; configured: boolean; voice: string; speed: number; loudness: number };
export function createPlatformVoiceStore(options: { dir?: string; env?: NodeJS.ProcessEnv } = {}) {
  const env = options.env ?? process.env;
  const dir = options.dir ?? (env.BAMBOOK_AI_SUBSCRIPTION_DIR?.trim() || path.resolve(__dirname, '../../private/ai-subscriptions'));
  const file = path.join(dir, 'platform-voice.json');
  let pending: Stored | null | undefined;
  let queue: Promise<void> = Promise.resolve();
  const read = (): Stored | null => {
    let data: any;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e: any) { if (e.code === 'ENOENT') return null; throw new MistApiError('VOICE_CONFIG_UNAVAILABLE', '实时语音配置无法读取，请检查服务器配置', 503); }
    if (data?.schema !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || typeof data.enabled !== 'boolean' || typeof data.apiKey !== 'string' || !/^[\x21-\x7e]{0,1024}$/.test(data.apiKey) || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.voice) || ![data.speed, data.loudness].every((n: unknown) => Number.isInteger(n) && Number(n) >= -50 && Number(n) <= 100)) throw new MistApiError('VOICE_CONFIG_UNAVAILABLE', '实时语音配置无法读取，请检查服务器配置', 503);
    return data;
  };
  const config = (stored: Stored | null) => stored ? stored.enabled && stored.apiKey ? { apiKey: stored.apiKey, voice: stored.voice, speed: stored.speed, loudness: stored.loudness } : null : voiceConfig(env);
  const view = (stored: Stored | null): PlatformVoiceView => {
    const fallback = voiceConfig(env), active = config(stored);
    return { revision: stored?.revision ?? 0, enabled: stored?.enabled ?? !!fallback, hasKey: !!(stored ? stored.apiKey : fallback?.apiKey), configured: !!active, voice: stored?.voice ?? fallback?.voice ?? 'zh_female_qingchezizi_uranus_bigtts', speed: stored?.speed ?? fallback?.speed ?? 0, loudness: stored?.loudness ?? fallback?.loudness ?? 0 };
  };
  const write = (next: Stored) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { try { fs.unlinkSync(temporary); } catch { /* Atomic rename already removed the temporary path. */ } }
  };
  const store = {
    view: () => view(pending !== undefined ? pending : read()),
    runtime: (): VoiceConfig | null => { try { return config(pending !== undefined ? pending : read()); } catch { return null; } },
    save(input: Record<string, unknown>) {
      if (!input || Object.keys(input).some(k => !['revision', 'enabled', 'apiKey', 'clearKey', 'voice', 'speed', 'loudness'].includes(k))) throw new MistApiError('INVALID_INPUT', '语音配置字段无效', 400);
      const old = read(), current = view(old);
      if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new MistApiError('VOICE_CONFIG_CHANGED', '语音配置已变化，请刷新后重试', 409);
      if (typeof input.enabled !== 'boolean' || typeof input.voice !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.voice) || ![input.speed, input.loudness].every(n => Number.isInteger(n) && Number(n) >= -50 && Number(n) <= 100) || input.clearKey !== undefined && typeof input.clearKey !== 'boolean' || input.apiKey !== undefined && (typeof input.apiKey !== 'string' || !/^[\x20-\x7e]{0,1024}$/.test(input.apiKey))) throw new MistApiError('INVALID_INPUT', '请核对音色、语速、音量和 API Key', 400);
      if (input.clearKey && input.apiKey) throw new MistApiError('INVALID_INPUT', '不能同时填写和移除 API Key', 400);
      const apiKey = input.clearKey ? '' : typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : old?.apiKey ?? voiceConfig(env)?.apiKey ?? '';
      if (apiKey && !/^[\x21-\x7e]{1,1024}$/.test(apiKey)) throw new MistApiError('INVALID_INPUT', 'API Key 格式无效', 400);
      if (input.enabled && !apiKey) throw new MistApiError('INVALID_INPUT', '请先填写豆包实时语音 API Key', 400);
      const next: Stored = { schema: 1, revision: current.revision + 1, enabled: input.enabled, apiKey, voice: input.voice, speed: Number(input.speed), loudness: Number(input.loudness) };
      write(next);
      return view(next);
    },
    async update(input: Record<string, unknown>, audit: (view: PlatformVoiceView) => Promise<void>) {
      let release!: () => void;
      const before = queue; queue = new Promise<void>(resolve => { release = resolve; }); await before;
      let old: Stored | null = null, written = false;
      try {
        old = read(); pending = old;
        const next = store.save(input); written = true;
        await audit(next); return next;
      } catch (error) {
        if (written) { if (old) write(old); else fs.unlinkSync(file); }
        throw error;
      } finally { pending = undefined; release(); }
    },
  };
  return store;
}
export type PlatformVoiceStore = ReturnType<typeof createPlatformVoiceStore>;
