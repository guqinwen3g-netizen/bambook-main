import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMarketStore, exaCall, fetchMarketSnapshot, MarketQuoteWorker, MATERIALS, parseBocFx, parseExaHits, pickMaterial } from './marketQuotes';

const boc = `| 货币名称 | 现汇买入价 | 现钞买入价 | 现汇卖出价 | 现钞卖出价 | 中行折算价 | 发布日期 | 发布时间 |
| 欧元 | 743.9 | 743.9 | 749.35 | 749.35 | 747.6 | 2026/11/03 17:19:19 | 17:19:19 |
| 日元 | 4.2052 | 4.2052 | 4.2377 | 4.2377 | 4.2357 | 2026/11/03 17:19:19 | 17:19:19 |
| 美元 | 666.03 | 666.03 | 668.83 | 668.83 | 671.5 | 2026/11/03 17:19:19 | 17:19:19 |`;
const sse = (text: string) => `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text }] } })}\n`;

describe('market reference quotes', () => {
  it('reads the Bank of China settlement (现汇买入) rate per unit, keeping the central reference apart', () => {
    const fx = parseBocFx(boc);
    expect(fx.find(q => q.currency === 'USD')).toMatchObject({ settlementBuy: 6.6603, centralReference: 6.715, publishedAt: '2026-11-03T17:19:19+08:00' });
    expect(fx.find(q => q.currency === 'JPY')!.settlementBuy).toBe(0.042052);
    expect(fx.some(q => q.currency === 'GBP')).toBe(false);
  });
  it('takes material prices only from dated pages that state a transaction price', () => {
    const hits = parseExaHits(['Title: 旧闻\nURL: https://a/1\nPublished: 2026-10-01T00:00:00.000Z\n3128B棉花价格指数报 15000 元/吨', 'Title: 今日\nURL: https://a/2\nPublished: 2026-11-03T00:00:00.000Z\n3128B棉花价格指数报 16773 元/吨', 'Title: 期货\nURL: https://a/3\nPublished: 2026-11-03T00:00:00.000Z\n棉花期货主力合约收报 13600'].join('\n---\n'));
    expect(pickMaterial(hits, MATERIALS[0], '2026-11-03')).toMatchObject({ price: 16773, date: '2026-11-03', url: 'https://a/2' });
    expect(pickMaterial(hits.slice(0, 1), MATERIALS[0], '2026-11-03')).toBeNull();
  });
  it('records missing values instead of guessing when a source fails', async () => {
    const calls: string[] = [];
    const fake = (async (_url: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); calls.push(body.params.name); return new Response(body.params.name === 'web_fetch_exa' ? sse(boc) : sse('Title: x\nURL: https://x\nPublished: 2026-11-03\n无价格'), { status: 200 }); }) as typeof fetch;
    const snap = await fetchMarketSnapshot(new Date('2026-11-03T03:00:00Z'), fake);
    expect(snap.fx.map(q => q.currency).sort()).toEqual(['EUR', 'JPY', 'USD']);
    expect(snap.missing).toEqual(expect.arrayContaining(['GBP 现汇买入价', '棉花 3128B 现货成交价']));
    expect(calls[0]).toBe('web_fetch_exa');
    await expect(exaCall('web_fetch_exa', {}, (async () => new Response('', { status: 502 })) as typeof fetch)).rejects.toThrow('EXA_HTTP_502');
  });
  it('refreshes once per Beijing day after the morning quotation and keeps history in a private file', async () => {
    const store = createMarketStore(mkdtempSync(path.join(tmpdir(), 'market-')));
    let now = new Date('2026-11-03T01:00:00Z'), fetched = 0;
    const fake = (async (_u: string, init: RequestInit) => { fetched++; const b = JSON.parse(String(init.body)); return new Response(b.params.name === 'web_fetch_exa' ? sse(boc) : sse(''), { status: 200 }); }) as typeof fetch;
    const worker = new MarketQuoteWorker(store, { now: () => now, fetchImpl: fake });
    await worker.tick(); expect(fetched).toBe(0);
    now = new Date('2026-11-03T03:00:00Z'); await worker.tick(); expect(store.latest()!.fx.length).toBe(3);
    const before = fetched; await worker.tick(); expect(fetched).toBe(before);
    now = new Date('2026-11-04T03:00:00Z'); await worker.tick(); expect(store.history().length).toBe(2);
  });
});
