/**
 * Platform market reference data (2026-11-03 user decision): part of the automated platform AI, fetched daily on the server
 * through the Exa MCP endpoint (same public endpoint and JSON-RPC calls OpenBitFun uses), shared by all companies as reference.
 *
 * What is fetched, and why these and not others:
 * - FX: Bank of China foreign exchange quotation page, **现汇买入价** (the bank buys the foreign currency = what an exporter
 *   receives on settlement). Quoted per 100 units; stored per 1 unit. The PBOC central parity is kept only as a comparison,
 *   never as the settlement rate. Cash rates and selling rates are not used.
 * - Raw materials: domestic spot transaction prices (cotton CC Index 3128B, polyester staple fibre benchmark), with market,
 *   grade, unit and the page they came from. Futures, mill list prices and enquiries are not transaction prices.
 * Values are reference only: they prefill pricing and quotations; accounting rates are still registered and confirmed by finance.
 * When a value cannot be read with its source and time, it is recorded as missing instead of being guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mistBusinessDate } from '../shared/mistBusinessClock';

export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
export const BOC_FX_URL = 'https://www.boc.cn/sourcedb/whpj/';
export const FX_CURRENCIES: Record<string, string> = { USD: '美元', EUR: '欧元', GBP: '英镑', JPY: '日元', HKD: '港币', AUD: '澳大利亚元', CAD: '加拿大元' };
export type FxQuote = { currency: string; settlementBuy: number; centralReference: number | null; publishedAt: string; source: string; url: string };
export type MaterialQuote = { key: string; name: string; market: string; spec: string; unit: string; price: number; date: string; source: string; url: string; basis: string };
export type MarketSnapshot = { fetchedAt: string; fx: FxQuote[]; materials: MaterialQuote[]; missing: string[] };
export type MarketStoreFile = { version: 1; snapshots: MarketSnapshot[] };

/** One JSON-RPC tools/call to the Exa MCP endpoint; returns the joined text content. Responses may be JSON or an SSE stream. */
export async function exaCall(tool: 'web_fetch_exa' | 'web_search_exa', args: Record<string, unknown>, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const key = process.env.EXA_API_KEY?.trim(); if (key) headers['x-api-key'] = key;
  const res = await fetchImpl(EXA_MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }), signal });
  if (!res.ok) throw new Error(`EXA_HTTP_${res.status}`);
  const body = await res.text();
  const payloads = body.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6));
  for (const raw of payloads.length ? payloads : [body.trim()]) {
    let data: { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message?: string } };
    try { data = JSON.parse(raw); } catch { continue; }
    if (data.error) throw new Error('EXA_ERROR: ' + String(data.error.message || '').slice(0, 200));
    const text = (data.result?.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
    if (data.result?.isError) throw new Error('EXA_TOOL_ERROR: ' + text.slice(0, 200));
    if (text.trim()) return text;
  }
  throw new Error('EXA_EMPTY');
}

/** Bank of China quotation table (markdown as returned by Exa): rows `| 美元 | 现汇买入 | 现钞买入 | 现汇卖出 | 现钞卖出 | 中行折算价 | 发布日期 | 时间 |`. */
export function parseBocFx(text: string, sourceUrl = BOC_FX_URL): FxQuote[] {
  const out: FxQuote[] = [];
  for (const [code, name] of Object.entries(FX_CURRENCIES)) {
    const row = text.split('\n').find(line => new RegExp(`^\\|\\s*${name}\\s*\\|`).test(line));
    if (!row) continue;
    const cells = row.split('|').slice(1, -1).map(c => c.trim());
    const buy = Number(cells[1]), mid = Number(cells[5]), published = cells[6] || '';
    const at = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(published);
    if (!(buy > 0) || !at) continue;
    // Published in Beijing time; per 100 units of foreign currency.
    out.push({ currency: code, settlementBuy: Math.round(buy / 100 * 1e6) / 1e6, centralReference: mid > 0 ? Math.round(mid / 100 * 1e6) / 1e6 : null, publishedAt: `${at[1]}-${at[2]}-${at[3]}T${at[4]}+08:00`, source: '中国银行外汇牌价 · 现汇买入价', url: sourceUrl });
  }
  return out;
}

type Hit = { title: string; url: string; published: string; text: string };
export function parseExaHits(text: string): Hit[] {
  return text.split(/\n---\n/).map(block => ({
    title: /Title: (.*)/.exec(block)?.[1]?.trim() || '', url: /URL: (.*)/.exec(block)?.[1]?.trim() || '',
    published: /Published(?: Date)?: (\d{4}-\d{2}-\d{2})/.exec(block)?.[1] || '', text: block,
  })).filter(h => h.url);
}
/** Material definitions: what to search for and the exact phrase that carries a transaction price in yuan per tonne. */
export const MATERIALS = [
  { key: 'cotton-3128B', name: '棉花', market: '中国棉花价格指数（CC Index）', spec: '3128B', unit: '元/吨', basis: '国内现货成交价格指数，含税到厂', query: '中国棉花价格指数 CC Index 3128B 今日 报价 元/吨', pattern: /3128B[^0-9]{0,30}?(\d{5})\s*元\/吨/ },
  { key: 'psf-1.4D', name: '涤纶短纤', market: '生意社基准价', spec: '1.4D×38mm 直纺', unit: '元/吨', basis: '国内现货成交基准价', query: '生意社 涤纶短纤基准价 今日 元/吨', pattern: /涤纶短纤基准价为\s*(\d{4,5}(?:\.\d+)?)\s*元\/吨/ },
] as const;
/** Pick a dated hit whose text states the price; the newest dated hit wins, and only hits within maxAgeDays count. */
export function pickMaterial(hits: Hit[], def: typeof MATERIALS[number], today: string, maxAgeDays = 7): MaterialQuote | null {
  const fresh = hits.filter(h => h.published && (Date.parse(today) - Date.parse(h.published)) / 86400000 <= maxAgeDays).sort((a, b) => b.published.localeCompare(a.published));
  for (const h of fresh) {
    const m = def.pattern.exec(h.text);
    if (m && Number(m[1]) > 0) return { key: def.key, name: def.name, market: def.market, spec: def.spec, unit: def.unit, price: Number(m[1]), date: h.published, source: h.title.slice(0, 120), url: h.url, basis: def.basis };
  }
  return null;
}

export async function fetchMarketSnapshot(now: Date, fetchImpl: typeof fetch = fetch): Promise<MarketSnapshot> {
  const missing: string[] = [], today = mistBusinessDate(now);
  let fx: FxQuote[] = [];
  try { fx = parseBocFx(await exaCall('web_fetch_exa', { urls: [BOC_FX_URL], maxCharacters: 20000 }, fetchImpl)); } catch (e) { missing.push('中国银行外汇牌价：' + (e instanceof Error ? e.message : '读取失败')); }
  for (const code of Object.keys(FX_CURRENCIES)) if (!fx.some(q => q.currency === code)) missing.push(`${code} 现汇买入价`);
  const materials: MaterialQuote[] = [];
  for (const def of MATERIALS) {
    try { const q = pickMaterial(parseExaHits(await exaCall('web_search_exa', { query: def.query, numResults: 6 }, fetchImpl)), def, today); if (q) materials.push(q); else missing.push(`${def.name} ${def.spec} 现货成交价`); }
    catch (e) { missing.push(`${def.name}：${e instanceof Error ? e.message : '读取失败'}`); }
  }
  return { fetchedAt: now.toISOString(), fx, materials, missing };
}

/** Kept beside the platform AI settings so a release swap never discards history. */
export function createMarketStore(dir = process.env.BAMBOOK_MARKET_DIR?.trim() || (process.env.BAMBOOK_AI_SUBSCRIPTION_DIR?.trim() ? path.join(path.dirname(process.env.BAMBOOK_AI_SUBSCRIPTION_DIR.trim()), 'market') : path.resolve(__dirname, '../../private/market'))) {
  const file = path.join(dir, 'market-quotes.json');
  const read = (): MarketStoreFile => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d?.version === 1 && Array.isArray(d.snapshots)) return d; } catch { /* none yet */ } return { version: 1, snapshots: [] }; };
  return {
    latest(): MarketSnapshot | null { return read().snapshots.at(-1) || null; },
    history(limit = 30): MarketSnapshot[] { return read().snapshots.slice(-limit); },
    add(snapshot: MarketSnapshot) {
      const store = read(); store.snapshots = [...store.snapshots, snapshot].slice(-120);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(store), { mode: 0o600 }); fs.renameSync(temp, file);
    },
  };
}
export type MarketStore = ReturnType<typeof createMarketStore>;

/** Daily refresh after the Bank of China morning quotation; also on start if today's snapshot is missing. */
export class MarketQuoteWorker {
  private timer?: ReturnType<typeof setInterval>; private running = false;
  constructor(private readonly store: MarketStore, private readonly options: { now?: () => Date; fetchImpl?: typeof fetch; hourBeijing?: number; onError?: (code: string) => void } = {}) {}
  private due(now: Date) {
    const last = this.store.latest(), beijing = new Date(now.getTime() + 8 * 3600000), day = mistBusinessDate(now);
    const lastDay = last ? mistBusinessDate(last.fetchedAt) : '';
    return lastDay !== day && beijing.getUTCHours() >= (this.options.hourBeijing ?? 10);
  }
  async tick() {
    if (this.running) return; const now = this.options.now?.() ?? new Date(); if (!this.due(now)) return;
    this.running = true;
    try { this.store.add(await fetchMarketSnapshot(now, this.options.fetchImpl)); } catch (e) { this.options.onError?.(e instanceof Error ? e.message : 'MARKET_FETCH_FAILED'); } finally { this.running = false; }
  }
  start(intervalMs = 15 * 60 * 1000) { if (this.timer || process.env.BAMBOOK_MARKET_FETCH === '0') return; void this.tick(); this.timer = setInterval(() => void this.tick(), intervalMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
