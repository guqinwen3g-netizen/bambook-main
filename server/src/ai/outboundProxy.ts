/**
 * 平台 AI 出站代理：中国境内服务器无法直连 chatgpt.com / api.openai.com 时，
 * 设置 BAMBOOK_AI_HTTPS_PROXY（http://[user:pass@]host:port，例如服务器本机的 sing-box mixed 入站 http://127.0.0.1:7890），
 * 发往 OpenAI 域名（*.openai.com、*.chatgpt.com）的请求经代理转发；国内模型服务等其他地址仍直连。
 * 未设置时行为与全局 fetch 完全一致。Node 内置 fetch 不读取 HTTPS_PROXY，因此显式使用 undici ProxyAgent。
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const PROXIED_HOSTS = [/(^|\.)openai\.com$/i, /(^|\.)chatgpt\.com$/i];
let cached: { url: string; agent: ProxyAgent } | null = null;

export function aiProxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.BAMBOOK_AI_HTTPS_PROXY?.trim();
  return value ? value : null;
}

export function needsAiProxy(url: string): boolean {
  try { return PROXIED_HOSTS.some(pattern => pattern.test(new URL(url).hostname)); } catch { return false; }
}

function agentFor(proxy: string): ProxyAgent {
  if (cached?.url === proxy) return cached.agent;
  let parsed: URL;
  try { parsed = new URL(proxy); } catch { throw new Error('BAMBOOK_AI_HTTPS_PROXY 不是有效地址，应为 http://host:port'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('BAMBOOK_AI_HTTPS_PROXY 只支持 http:// 或 https:// 代理');
  void cached?.agent.close();
  cached = { url: proxy, agent: new ProxyAgent(proxy) };
  return cached.agent;
}

/** 与全局 fetch 同签名；仅 OpenAI 域名且配置了代理时经代理发送。 */
export function aiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const proxy = aiProxyUrl();
  if (!proxy || !needsAiProxy(url)) return fetch(input, init);
  return undiciFetch(url, { ...(init as any), dispatcher: agentFor(proxy) }) as unknown as Promise<Response>;
}
