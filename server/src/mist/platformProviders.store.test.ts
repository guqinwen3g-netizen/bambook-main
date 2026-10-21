import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlatformProviderStore, SUBSCRIPTION_SLOT, MAX_PLATFORM_PROVIDERS } from '../ai/platformProviders';
import { createLlmCompleter, resolveLlmProviderChain } from '../ai/llmProviders';

const ENV_KEYS = ['ARK_API_KEY', 'VOLCENGINE_API_KEY', 'TENCENT_API_KEY', 'ZHIPU_API_KEY', 'BAMBOOK_MODEL_BASE_URL', 'BAMBOOK_MODEL_NAME', 'BAMBOOK_LLM_BACKUP_URL', 'BAMBOOK_LLM_BACKUP_KEY', 'BAMBOOK_LLM_BACKUP2_URL', 'BAMBOOK_LLM_BACKUP2_KEY'];
const saved: Record<string, string | undefined> = {};
let dir: string;
const input = { name: '火山方舟', baseUrl: 'https://ark.example.test/api/v3/', model: 'doubao-pro', apiKey: 'sk-secret-ABCD' };
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bambook-providers-'));
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(async () => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe('platform provider store', () => {
  it('saves a provider privately and never exposes the key', async () => {
    const store = createPlatformProviderStore({ dir });
    const created = store.create(input);
    expect(created).toMatchObject({ name: '火山方舟', baseUrl: 'https://ark.example.test/api/v3', model: 'doubao-pro', enabled: true, keyHint: '••••ABCD' });
    expect(JSON.stringify(created)).not.toContain('sk-secret');
    expect(JSON.stringify(store.list())).not.toContain('sk-secret');
    expect(store.list().order).toEqual([SUBSCRIPTION_SLOT, created.id]);
    const file = path.join(dir, 'platform-api-providers.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).toContain('sk-secret-ABCD');
  });

  it.each([
    [{ ...input, baseUrl: 'http://ark.example.test/v3' }, 'https'],
    [{ ...input, baseUrl: 'https://user:pass@ark.example.test/v3' }, '账号或密码'],
    [{ ...input, baseUrl: 'https://ark.example.test/v3?key=1' }, '查询参数'],
    [{ ...input, model: 'bad model' }, '模型标识'],
    [{ ...input, apiKey: 'sk with space' }, '空格'],
    [{ ...input, name: '' }, '名称'],
    [{ ...input, extra: 1 }, '不支持的字段'],
  ])('rejects invalid input %#', (body, message) => {
    expect(() => createPlatformProviderStore({ dir }).create(body)).toThrow(message);
  });

  it('allows plain http only for a local model server', () => {
    expect(createPlatformProviderStore({ dir }).create({ ...input, baseUrl: 'http://127.0.0.1:11434/v1' }).baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('keeps the stored key when an edit leaves it blank and replaces it when given', () => {
    const store = createPlatformProviderStore({ dir });
    const { id } = store.create(input);
    store.update(id, { name: '方舟主线', apiKey: '' });
    expect(store.get(id)).toMatchObject({ name: '方舟主线', apiKey: 'sk-secret-ABCD' });
    const { after } = store.update(id, { apiKey: 'sk-new-WXYZ', enabled: false });
    expect(after).toMatchObject({ keyHint: '••••WXYZ', enabled: false });
    expect(store.get(id).apiKey).toBe('sk-new-WXYZ');
  });

  it('orders the ChatGPT plan and API providers together and skips disabled ones', () => {
    const store = createPlatformProviderStore({ dir });
    const a = store.create(input), b = store.create({ ...input, name: 'OpenAI', baseUrl: 'https://api.openai.example.test/v1' });
    store.reorder({ order: [b.id, SUBSCRIPTION_SLOT, a.id] });
    expect(store.chain().map(s => s.kind === 'api' ? s.provider.name : s.kind)).toEqual(['OpenAI', 'subscription', '火山方舟']);
    store.update(b.id, { enabled: false });
    expect(store.chain().map(s => s.kind === 'api' ? s.provider.name : s.kind)).toEqual(['subscription', '火山方舟']);
  });

  it('refuses a stale or incomplete order', () => {
    const store = createPlatformProviderStore({ dir });
    const a = store.create(input);
    expect(() => store.reorder({ order: [a.id] })).toThrow('调用顺序已变化');
    expect(() => store.reorder({ order: [a.id, a.id] })).toThrow('调用顺序已变化');
  });

  it('removes a provider from the order and limits the number of providers', () => {
    const store = createPlatformProviderStore({ dir });
    const a = store.create(input);
    store.remove(a.id);
    expect(store.list()).toEqual({ providers: [], order: [SUBSCRIPTION_SLOT] });
    for (let i = 0; i < MAX_PLATFORM_PROVIDERS; i++) store.create({ ...input, name: 'p' + i });
    expect(() => store.create(input)).toThrow(`最多添加 ${MAX_PLATFORM_PROVIDERS} 个`);
  });
});

describe('platform AI call chain', () => {
  it('lists platform providers before the server environment fallback', () => {
    process.env.ARK_API_KEY = 'env-key';
    const store = createPlatformProviderStore({ dir });
    store.create(input);
    expect(resolveLlmProviderChain(store).map(p => p.id.startsWith('platform:') ? 'platform' : p.id)).toEqual(['platform', 'primary']);
  });

  it('calls providers in the admin order and falls back to the environment last', async () => {
    process.env.ARK_API_KEY = 'env-key';
    const store = createPlatformProviderStore({ dir });
    const api = store.create(input);
    store.reorder({ order: [api.id, SUBSCRIPTION_SLOT] });
    const hits: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { hits.push(new URL(url).host); return hits.length === 1 ? new Response('{}', { status: 500 }) : ok('fallback answer'); }));
    const subscriptions = { isConnected: vi.fn(() => true), complete: vi.fn(async () => { throw new Error('quota exceeded'); }) };
    const answer = await createLlmCompleter({ platformProfile: 'assistant-chat', subscriptions: subscriptions as any, platformProviders: store })({ systemPrompt: 's', messages: [{ role: 'user', content: 'q' }], signal: new AbortController().signal });
    expect(answer).toBe('fallback answer');
    expect(hits[0]).toBe('ark.example.test');
    expect(subscriptions.complete).toHaveBeenCalledTimes(1);
    expect(hits).toHaveLength(2);
  });

  it('skips the ChatGPT plan for callers outside the platform AI profiles', async () => {
    const store = createPlatformProviderStore({ dir });
    store.create(input);
    vi.stubGlobal('fetch', vi.fn(async () => ok('api answer')));
    const subscriptions = { isConnected: vi.fn(() => true), complete: vi.fn() };
    const answer = await createLlmCompleter({ subscriptions: subscriptions as any, platformProviders: store })({ systemPrompt: 's', messages: [{ role: 'user', content: 'q' }], signal: new AbortController().signal });
    expect(answer).toBe('api answer');
    expect(subscriptions.complete).not.toHaveBeenCalled();
  });
});
