/**
 * LLM Provider 链 — 批次 2a「LLM 网关备用 provider 配置化」
 *
 * 改造前：createArkLLMCompleter 单 provider（ARK baseUrl + env key 链），
 * 主 provider 不可用时 agentLoop 直接 llm_failure 收尾，无降级通道。
 *
 * 设计：
 *   1. provider 链由 env 声明式配置——主 provider（沿用现有 ARK 语义，向后兼容）
 *      + 最多两组备用（BAMBOOK_LLM_BACKUP_* / BAMBOOK_LLM_BACKUP2_*）。
 *      备用需 URL + KEY 齐备才启用；MODEL 缺省回落全局默认（BAMBOOK_MODEL_NAME）。
 *   2. 失败转移策略：请求级逐个尝试（网络错误 / 非 2xx / 流中断 → 下一个 provider）；
 *      AbortError（用户取消/会话超时/上游 superseded）不转移，直接抛出。
 *   3. 不做后台健康探测——失败转移本身就是探测，避免常驻探针的复杂度与额外配额消耗。
 *   4. 全链失败抛语义化错误 LLM_ALL_PROVIDERS_FAILED（附逐 provider 失败摘要），
 *      上层可观测、可排查。
 *   5. 每次 complete 动态 resolve 链（与改造前读 env 行为一致，支持运行时调整配置）。
 *   6. 平台管理员在「平台设置 › 平台 AI 模型」维护的 API 提供方与平台 ChatGPT 套餐按其设定顺序在前，
 *      env 提供方始终排在最后兜底（见 platformProviders.ts）。
 */

/** The earliest safe time for the next automatic attempt on a busy provider. */
export class LlmProviderRetryError extends Error {
  constructor(message: string, readonly retryNotBefore: number) {
    super(message);
  }
}

/** Every eligible provider is already waiting, so this attempt sent no request. */
export class LlmProviderCooldownError extends LlmProviderRetryError {}

const MAX_PROVIDER_COOLDOWNS = 32;
const TASK_BUSY_RETRY_MS = 20_000;
const HTTP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HTTP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HTTP_DATE = /^(?<weekday>[A-Za-z]{3}), (?<day>\d{2}) (?<month>[A-Za-z]{3}) (?<year>\d{4}) (?<time>\d{2}:\d{2}:\d{2}) GMT$/;
const RFC850_DATE = /^(?<weekday>Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (?<day>\d{2})-(?<month>[A-Za-z]{3})-(?<year>\d{2}) (?<time>\d{2}:\d{2}:\d{2}) GMT$/;
const ASCTIME_DATE = /^(?<weekday>[A-Za-z]{3}) (?<month>[A-Za-z]{3}) (?<day>\d{2}| \d) (?<time>\d{2}:\d{2}:\d{2}) (?<year>\d{4})$/;

function parseHttpDate(value: string, now: number): number {
  const parts = HTTP_DATE.exec(value)?.groups ?? RFC850_DATE.exec(value)?.groups ?? ASCTIME_DATE.exec(value)?.groups;
  if (!parts) return NaN;
  const month = HTTP_MONTHS.indexOf(parts.month), day = Number(parts.day);
  const [hour, minute, second] = parts.time.split(':').map(Number);
  if (month < 0 || day < 1 || hour > 23 || minute > 59 || second > 60) return NaN;

  let year = Number(parts.year);
  if (parts.year.length === 2) {
    // RFC 9110 §5.6.7 uses a rolling 50-year limit for obsolete two-digit years.
    const limit = new Date(now);
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    year += Math.floor(limit.getUTCFullYear() / 100) * 100;
    if (Date.UTC(year, month, day, hour, minute, second) > limit.getTime()) year -= 100;
  }
  if (year < 1900) return NaN;
  const date = new Date(Date.UTC(year, month, day, hour, minute, Math.min(second, 59)));
  if (date.getUTCDate() !== day || HTTP_WEEKDAYS[date.getUTCDay()] !== parts.weekday.slice(0, 3)) return NaN;
  return date.getTime() + (second === 60 ? 1000 : 0);
}

function honorRetryAfter(response: Response, missingRetryAfterMs?: number): void {
  if (response.status !== 429 && response.status !== 503) return;
  const now = Date.now();
  const value = response.headers?.get('retry-after')?.trim() ?? '';
  const at = /^\d+$/.test(value) ? Math.min(Number.MAX_SAFE_INTEGER, now + Number(value) * 1000)
    : parseHttpDate(value, now);
  const retryNotBefore = Number.isSafeInteger(at) && at > now ? at
    : missingRetryAfterMs === undefined ? undefined : now + missingRetryAfterMs;
  if (retryNotBefore === undefined) return;
  // A busy response already establishes a retry time without waiting for its error body.
  void response.body?.cancel().catch(() => {});
  throw new LlmProviderRetryError(`Model API failed with ${response.status}`, retryNotBefore);
}

export type LlmProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type LlmCompletionInput = {
  systemPrompt: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  images?: Array<{ name: string; url: string }>;
  model?: string;
  temperature?: number;
  signal: AbortSignal;
  jsonMode?: boolean;
  onDelta?: (chunk: string) => void;
  /** Recheck caller authority before sending the same input to another provider. */
  beforeFallback?: () => Promise<void>;
};

import { codexSubscriptions, PLATFORM_SUBJECT, type CodexSubscriptionService } from './codexSubscription';
import { platformReasoning, type PlatformAiProfile } from './platformModel';
import { platformProviders, type PlatformApiProvider, type PlatformProviderStore } from './platformProviders';
import { createHash } from 'node:crypto';
import { aiFetch } from './outboundProxy';
import type { LlmProviderCooldownStore } from './providerCooldownStore';

const DEFAULT_LLM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
const DEFAULT_LLM_MODEL = 'ark-code-latest';

function resolvePrimaryApiKey(): string {
  return (
    process.env.ARK_API_KEY ||
    process.env.VOLCENGINE_API_KEY ||
    process.env.TENCENT_API_KEY ||
    process.env.ZHIPU_API_KEY ||
    ''
  ).trim();
}

function resolveGlobalModel(): string {
  return String(process.env.BAMBOOK_MODEL_NAME || DEFAULT_LLM_MODEL).trim();
}

function resolveBackupProvider(envPrefix: 'BAMBOOK_LLM_BACKUP' | 'BAMBOOK_LLM_BACKUP2'): LlmProviderConfig | null {
  const baseUrl = process.env[`${envPrefix}_URL`]?.trim().replace(/\/+$/, '');
  const apiKey = process.env[`${envPrefix}_KEY`]?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    id: envPrefix === 'BAMBOOK_LLM_BACKUP' ? 'backup' : 'backup2',
    baseUrl,
    apiKey,
    model: process.env[`${envPrefix}_MODEL`]?.trim() || resolveGlobalModel(),
  };
}

const platformConfig = (p: PlatformApiProvider): LlmProviderConfig => ({ id: 'platform:' + p.id, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });

/**
 * 全部可用 API provider（不含 ChatGPT 套餐）：平台管理员维护的启用项按设定顺序 → env 兜底。
 * 为空时调用方据此报"未配置"。
 */
export function resolveLlmProviderChain(store: Pick<PlatformProviderStore, 'chain'> = platformProviders()): LlmProviderConfig[] {
  return [...store.chain().flatMap(step => step.kind === 'api' ? [platformConfig(step.provider)] : []), ...resolveEnvProviderChain()];
}

/**
 * 解析 env 声明的有序 provider 链：主 provider（ARK 语义）→ backup → backup2。
 * 主 provider 未配置任何 key 且无备用时返回空数组。
 */
export function resolveEnvProviderChain(): LlmProviderConfig[] {
  const chain: LlmProviderConfig[] = [];
  const primaryApiKey = resolvePrimaryApiKey();
  if (primaryApiKey) {
    chain.push({
      id: 'primary',
      baseUrl: String(process.env.BAMBOOK_MODEL_BASE_URL || DEFAULT_LLM_BASE_URL).replace(/\/+$/, ''),
      apiKey: primaryApiKey,
      model: resolveGlobalModel(),
    });
  }
  const backup = resolveBackupProvider('BAMBOOK_LLM_BACKUP');
  if (backup) chain.push(backup);
  const backup2 = resolveBackupProvider('BAMBOOK_LLM_BACKUP2');
  if (backup2) chain.push(backup2);
  return chain;
}

/**
 * 链式 LLM completer：逐 provider 尝试，AbortError 直抛，全链失败抛
 * LLM_ALL_PROVIDERS_FAILED。同一 provider 内保持"流式优先、流式失败降级非流式"。
 */
export type LlmCompleterOptions = {
  cooldownStore?: LlmProviderCooldownStore;
  /** 平台 AI 功能档位；平台 ChatGPT 订阅已连接时按档位推理强度优先使用。 */
  platformProfile?: PlatformAiProfile;
  subscriptions?: Pick<CodexSubscriptionService, 'isConnected' | 'complete'>;
  platformProviders?: Pick<PlatformProviderStore, 'chain'>;
  validateResponse?: (response: string) => void;
};

// Reserve time for a second provider inside the Agent's overall model deadline.
const AGENT_PROVIDER_ATTEMPT_MS = 45_000;
const KIMI_VISION_ATTEMPT_MS = 25_000;
const ARK_AGENT_PLAN_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3';
const ARK_KIMI = 'kimi-k3.1-pro';
const ARK_DEEPSEEK_FLASH = 'deepseek-v4.1-flash';

export function createLlmCompleter(options: LlmCompleterOptions = {}) {
  const cooldowns = new Map<string, number>();
  const store = options.platformProfile === 'agent-task' ? options.cooldownStore : undefined;
  let reportedStoreError = false;
  const reportStoreError = () => {
    if (reportedStoreError) return;
    reportedStoreError = true;
    console.warn('[platform-agent] PROVIDER_COOLDOWN_STORE_UNAVAILABLE');
  };
  const rememberLocal = (key: string, until: number) => {
    const newest = Math.max(cooldowns.get(key) ?? 0, until);
    cooldowns.delete(key);
    cooldowns.set(key, newest);
    const oldest = cooldowns.keys().next().value;
    if (oldest !== undefined && cooldowns.size > MAX_PROVIDER_COOLDOWNS) cooldowns.delete(oldest);
  };
  return async function complete(input: LlmCompletionInput): Promise<string> {
    const subscriptions = options.subscriptions ?? codexSubscriptions();
    const steps = [
      ...(options.platformProviders ?? platformProviders()).chain().map(step => step.kind === 'subscription' ? step : { kind: 'api' as const, provider: platformConfig(step.provider) }),
      ...resolveEnvProviderChain().map(provider => ({ kind: 'api' as const, provider })),
    ];
    const profile = options.platformProfile;
    const now = Date.now();
    for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
    const cooldownKey = (step: typeof steps[number]) => profile === 'agent-task' && step.kind === 'api'
      ? createHash('sha256').update(JSON.stringify([step.provider.baseUrl, input.model || step.provider.model, step.provider.apiKey])).digest('hex')
      : undefined;
    let storeReadRetryAt = 0;
    if (store) {
      const keys = [...new Set(steps.map(cooldownKey).filter((key): key is string => key !== undefined))];
      if (keys.length) {
        try {
          const saved = await store.active(keys, now);
          for (const key of keys) {
            const until = saved.get(key);
            if (until !== undefined && Number.isSafeInteger(until) && until > Date.now()) rememberLocal(key, until);
          }
        } catch {
          reportStoreError();
          storeReadRetryAt = Date.now() + TASK_BUSY_RETRY_MS;
        }
      }
    }
    const coolingUntil = (key: string | undefined) => key ? Math.max(cooldowns.get(key) ?? 0, storeReadRetryAt) : 0;
    const available = (step: typeof steps[number]) => step.kind === 'api' || (!!profile && subscriptions.isConnected(PLATFORM_SUBJECT));
    const failures: Array<{ providerId: string; error: string }> = [];
    let invalidResponse: Error | undefined;
    let attemptedProvider = false;
    let retryNotBefore: number | undefined;
    for (const [index, step] of steps.entries()) {
      if (!available(step)) continue;
      input.signal.throwIfAborted();
      const key = cooldownKey(step);
      const until = coolingUntil(key);
      if (until > Date.now()) {
        retryNotBefore = Math.max(retryNotBefore ?? 0, until);
        continue;
      }
      if ((attemptedProvider || retryNotBefore !== undefined) && input.beforeFallback) {
        await input.beforeFallback();
        input.signal.throwIfAborted();
        const refreshed = coolingUntil(key);
        if (refreshed > Date.now()) {
          retryNotBefore = Math.max(retryNotBefore ?? 0, refreshed);
          continue;
        }
      }
      attemptedProvider = true;
      const remaining = steps.slice(index + 1).filter(next =>
        available(next) && coolingUntil(cooldownKey(next)) <= Date.now());
      const deadline = profile === 'agent-task' && !input.onDelta && remaining.length ? new AbortController() : undefined;
      const hasDeepseekBackup = remaining.some(next => next.kind === 'api'
        && next.provider.baseUrl === ARK_AGENT_PLAN_URL && next.provider.model === ARK_DEEPSEEK_FLASH);
      const kimiVision = !input.model && input.images?.length && step.kind === 'api'
        && step.provider.baseUrl === ARK_AGENT_PLAN_URL && step.provider.model === ARK_KIMI && hasDeepseekBackup;
      const timer = deadline ? setTimeout(() => deadline.abort(), kimiVision ? KIMI_VISION_ATTEMPT_MS : AGENT_PROVIDER_ATTEMPT_MS) : undefined;
      timer?.unref?.();
      const attempt = deadline ? { ...input, signal: AbortSignal.any([input.signal, deadline.signal]) } : input;
      const providerId = step.kind === 'subscription' ? 'chatgpt-subscription' : step.provider.id;
      try {
        const reply = step.kind === 'api'
          ? await completeWithProvider(step.provider, attempt, profile === 'agent-task' ? TASK_BUSY_RETRY_MS : undefined)
          : await subscriptions.complete(PLATFORM_SUBJECT, attempt, { reasoning: profile && platformReasoning(profile) });
        input.signal.throwIfAborted();
        try {
          options.validateResponse?.(reply);
        } catch (err) {
          invalidResponse ??= err instanceof Error ? err : new Error(String(err));
          continue;
        }
        return reply;
      } catch (err: any) {
        if (input.signal.aborted || (!deadline?.signal.aborted && err?.name === 'AbortError')) throw err;
        if (err instanceof LlmProviderRetryError) {
          retryNotBefore = Math.max(retryNotBefore ?? 0, err.retryNotBefore);
          if (key) {
            rememberLocal(key, err.retryNotBefore);
            if (store) {
              try {
                await store.remember(key, err.retryNotBefore, Date.now());
              } catch {
                reportStoreError();
              }
            }
          }
        }
        const code = step.kind === 'subscription' && typeof err?.code === 'string' ? err.code + ': ' : '';
        failures.push({ providerId, error: deadline?.signal.aborted ? 'PROVIDER_ATTEMPT_TIMEOUT' : code + String(err?.message || err) });
      } finally {
        clearTimeout(timer);
      }
    }
    if (!attemptedProvider && retryNotBefore !== undefined) throw new LlmProviderCooldownError('LLM_PROVIDER_COOLDOWN', retryNotBefore);
    if (!invalidResponse && failures.length === 0) throw new Error('Model API key is not configured on Mac mini');
    const failure = invalidResponse ?? new Error(`LLM_ALL_PROVIDERS_FAILED: ${JSON.stringify(failures)}`);
    // A successful fallback returns above. Only an exhausted chain advises the task scheduler.
    if (retryNotBefore !== undefined) throw new LlmProviderRetryError(failure.message, retryNotBefore);
    throw failure;
  };
}

/** 平台设置「测试连接」：用极短请求验证地址、Key 与模型；错误文字由调用方脱敏后返回。 */
export function testLlmProvider(provider: LlmProviderConfig, signal: AbortSignal): Promise<string> {
  return completeWithProvider(provider, { systemPrompt: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], temperature: 0, signal });
}

async function completeWithProvider(provider: LlmProviderConfig, input: LlmCompletionInput, missingRetryAfterMs?: number): Promise<string> {
  const model = input.model || provider.model;
  // Ark requires temperature=1.0 for Kimi K3.1 Pro on its standard API and Agent Plan.
  const arkKimi = (model === 'kimi-k3-1-pro-261024' && provider.baseUrl === 'https://ark.cn-beijing.volces.com/api/v3')
    || (model === ARK_KIMI && provider.baseUrl === ARK_AGENT_PLAN_URL);
  const temperature = arkKimi ? 1 : input.temperature ?? 0.2;
  const messages = [
    { role: 'system' as const, content: input.systemPrompt },
    ...input.messages,
  ];

  // 流式路径：有 onDelta 时走 stream:true，失败降级非流式（同一 provider 内）
  if (input.onDelta && !input.images?.length) {
    try {
      return await streamChatCompletion({
        baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, messages,
        temperature,
        signal: input.signal, onDelta: input.onDelta, missingRetryAfterMs,
      });
    } catch (streamErr: any) {
      if (streamErr?.name === 'AbortError' || streamErr instanceof LlmProviderRetryError) throw streamErr;
      // 流式失败，降级到非流式后仍由外层链负责转移到下一个 provider
    }
  }

  const body: Record<string, unknown> = {
    model,
    temperature,
    stream: false,
    messages: input.images?.length ? [...messages, {
      role:'user',
      content:input.images.flatMap(image=>[
        {type:'text',text:image.name},
        {type:'image_url',image_url:{url:image.url}},
      ]),
    }] : messages,
  };
  // Limit native JSON output to the verified Agent Plan adapters.
  if (input.jsonMode && provider.baseUrl === ARK_AGENT_PLAN_URL && [ARK_KIMI, ARK_DEEPSEEK_FLASH].includes(model)) {
    body.response_format = { type: 'json_object' };
  }
  const res = await aiFetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    honorRetryAfter(res, missingRetryAfterMs);
    const data: any = await res.json().catch(() => ({}));
    const message = data?.error?.message || data?.message || `Model API failed with ${res.status}`;
    throw new Error(message);
  }
  const data: any = await res.json().catch(() => ({}));
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new Error(`Model API returned empty content (provider ${provider.id})`);
  }
  return text;
}

async function streamChatCompletion(params: {
  baseUrl: string; apiKey: string; model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number; signal: AbortSignal;
  onDelta: (chunk: string) => void;
  missingRetryAfterMs?: number;
}): Promise<string> {
  const res = await aiFetch(`${params.baseUrl}/chat/completions`, {
    method: 'POST', signal: params.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({ model: params.model, temperature: params.temperature, stream: true, messages: params.messages }),
  });
  if (!res.ok) {
    honorRetryAfter(res, params.missingRetryAfterMs);
    throw new Error(`Model API stream failed with ${res.status}`);
  }
  if (!res.body) throw new Error('Model API stream returned no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const chunk: any = JSON.parse(dataStr);
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) { fullText += delta; params.onDelta(delta); }
        } catch { /* skip */ }
      }
    }
  } finally { reader.releaseLock(); }
  const text = fullText.trim();
  if (!text) throw new Error('Model API stream returned no content');
  return text;
}
