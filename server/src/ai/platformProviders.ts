/**
 * 平台 API 提供方（平台管理员在「平台设置 › 平台 AI 模型」维护，对所有公司生效）。
 *
 * - 与平台 ChatGPT 订阅凭据同目录（BAMBOOK_AI_SUBSCRIPTION_DIR），目录 0700、文件 0600，原子写入。
 * - API Key 只写不读：对外视图只含尾 4 位提示，Key 只在服务端调用模型时使用。
 * - 调用顺序含特殊项 `chatgpt-subscription`（平台 ChatGPT 套餐），可与 API 提供方互相排序；
 *   服务器环境变量配置的提供方不在此存储，始终排在最后作兜底。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SUBSCRIPTION_SLOT = 'chatgpt-subscription';
export const MAX_PLATFORM_PROVIDERS = 10;

export type PlatformApiProvider = { id: string; name: string; baseUrl: string; model: string; apiKey: string; enabled: boolean; createdAt: string; updatedAt: string };
export type PlatformApiProviderView = Omit<PlatformApiProvider, 'apiKey'> & { keyHint: string };
export type PlatformChainStep = { kind: 'subscription' } | { kind: 'api'; provider: PlatformApiProvider };
type Store = { version: 1; providers: PlatformApiProvider[]; order: string[] };

export class PlatformProviderError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
const invalid = (message: string): never => { throw new PlatformProviderError('INVALID_INPUT', message); };

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(`请填写${label}`);
  const v = value.trim();
  if (v.length > max) invalid(`${label}不能超过 ${max} 个字符`);
  return v;
}

/** OpenAI 兼容接口根地址：https；仅本机地址允许 http；不得带账号密码、查询串或片段。 */
export function normalizeBaseUrl(value: unknown): string {
  const raw = text(value, '接口地址', 300);
  let url: URL;
  try { url = new URL(raw); } catch { return invalid('接口地址不是有效网址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) invalid('接口地址须使用 https（本机地址可用 http）');
  if (url.username || url.password) invalid('接口地址不能包含账号或密码，请在 API Key 中填写');
  if (url.search || url.hash) invalid('接口地址不能包含查询参数');
  return url.toString().replace(/\/+$/, '');
}

function model(value: unknown): string {
  const v = text(value, '模型标识', 120);
  if (!/^[\w.:/@+-]+$/.test(v)) invalid('模型标识只能包含字母、数字及 . : / @ + - _');
  return v;
}

function apiKey(value: unknown): string {
  const v = text(value, 'API Key', 512);
  if (/\s/.test(v)) invalid('API Key 不能包含空格或换行');
  return v;
}

function exact(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('请求内容无效');
  const extra = Object.keys(input).filter(k => !allowed.includes(k));
  if (extra.length) invalid('请求包含不支持的字段：' + extra.join('、'));
  return input as Record<string, unknown>;
}

export const keyHint = (key: string) => '••••' + key.slice(-4);
const view = ({ apiKey: key, ...rest }: PlatformApiProvider): PlatformApiProviderView => ({ ...rest, keyHint: keyHint(key) });

export function createPlatformProviderStore(options: { dir?: string; now?: () => Date } = {}) {
  const dir = options.dir ?? (process.env.BAMBOOK_AI_SUBSCRIPTION_DIR?.trim() || path.resolve(__dirname, '../../private/ai-subscriptions'));
  const file = path.join(dir, 'platform-api-providers.json');
  const now = () => (options.now?.() ?? new Date()).toISOString();

  const read = (): Store => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data?.version === 1 && Array.isArray(data.providers) && Array.isArray(data.order)) return { version: 1, providers: data.providers, order: normalizeOrder(data.order, data.providers) };
    } catch { /* 无配置或损坏均视为没有平台 API 提供方 */ }
    return { version: 1, providers: [], order: [SUBSCRIPTION_SLOT] };
  };
  const write = (store: Store) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(temp, file);
  };
  const find = (store: Store, id: string) => store.providers.find(p => p.id === id) ?? (() => { throw new PlatformProviderError('NOT_FOUND', '该 API 服务已不存在，请刷新后重试', 404); })();

  return {
    list(): { providers: PlatformApiProviderView[]; order: string[] } {
      const store = read();
      return { providers: store.order.filter(id => id !== SUBSCRIPTION_SLOT).map(id => view(find(store, id))), order: store.order };
    },
    /** 有序调用链（不含服务器环境变量兜底）；含 Key，仅供服务端调用模型。停用项不出现在链中。 */
    chain(): PlatformChainStep[] {
      const store = read();
      return store.order.flatMap((id): PlatformChainStep[] => {
        if (id === SUBSCRIPTION_SLOT) return [{ kind: 'subscription' }];
        const provider = store.providers.find(p => p.id === id);
        return provider?.enabled ? [{ kind: 'api', provider }] : [];
      });
    },
    get(id: string): PlatformApiProvider { return find(read(), id); },
    create(input: unknown): PlatformApiProviderView {
      const body = exact(input, ['name', 'baseUrl', 'model', 'apiKey']);
      const store = read();
      if (store.providers.length >= MAX_PLATFORM_PROVIDERS) invalid(`最多添加 ${MAX_PLATFORM_PROVIDERS} 个 API 服务`);
      const at = now();
      const provider: PlatformApiProvider = { id: randomUUID(), name: text(body.name, '名称', 60), baseUrl: normalizeBaseUrl(body.baseUrl), model: model(body.model), apiKey: apiKey(body.apiKey), enabled: true, createdAt: at, updatedAt: at };
      write({ version: 1, providers: [...store.providers, provider], order: [...store.order, provider.id] });
      return view(provider);
    },
    /** 留空或不传 apiKey 表示保留原 Key。 */
    update(id: string, input: unknown): { before: PlatformApiProviderView; after: PlatformApiProviderView } {
      const body = exact(input, ['name', 'baseUrl', 'model', 'apiKey', 'enabled']);
      const store = read(), current = find(store, id);
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') invalid('启用状态无效');
      const next: PlatformApiProvider = {
        ...current,
        ...(body.name !== undefined ? { name: text(body.name, '名称', 60) } : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: normalizeBaseUrl(body.baseUrl) } : {}),
        ...(body.model !== undefined ? { model: model(body.model) } : {}),
        ...(body.apiKey === undefined || body.apiKey === '' ? {} : { apiKey: apiKey(body.apiKey) }),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        updatedAt: now(),
      };
      write({ ...store, providers: store.providers.map(p => p.id === id ? next : p) });
      return { before: view(current), after: view(next) };
    },
    remove(id: string): PlatformApiProviderView {
      const store = read(), current = find(store, id);
      write({ version: 1, providers: store.providers.filter(p => p.id !== id), order: store.order.filter(o => o !== id) });
      return view(current);
    },
    reorder(input: unknown): { before: string[]; after: string[] } {
      const body = exact(input, ['order']);
      const store = read();
      const order = body.order;
      const expected = [SUBSCRIPTION_SLOT, ...store.providers.map(p => p.id)];
      if (!Array.isArray(order) || order.length !== expected.length || new Set(order).size !== order.length || !order.every(id => typeof id === 'string' && expected.includes(id)))
        throw new PlatformProviderError('CONFLICT', '调用顺序已变化，请刷新后重试', 409);
      write({ ...store, order: order as string[] });
      return { before: store.order, after: order as string[] };
    },
  };
}

function normalizeOrder(order: unknown[], providers: PlatformApiProvider[]): string[] {
  const ids = new Set(providers.map(p => p.id));
  const out = order.filter((id, i): id is string => typeof id === 'string' && (id === SUBSCRIPTION_SLOT || ids.has(id)) && order.indexOf(id) === i);
  if (!out.includes(SUBSCRIPTION_SLOT)) out.unshift(SUBSCRIPTION_SLOT);
  for (const p of providers) if (!out.includes(p.id)) out.push(p.id);
  return out;
}

export type PlatformProviderStore = ReturnType<typeof createPlatformProviderStore>;
let shared: PlatformProviderStore | null = null;
export function platformProviders(): PlatformProviderStore { return shared ??= createPlatformProviderStore(); }
