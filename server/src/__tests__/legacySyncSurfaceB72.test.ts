/**
 * B72 · 遗留 broad-sync 写面（`app.all('/api/orders' …)` + `handleSync` + `legacyWriteGuard` + `sdkAuth`）
 * 已随主 API 旧接口一起删除（2026-11-06）。主 API 只剩 http/liveApiSurface.ts 列出的路径；
 * 本守卫防止这组无 scope 粒度的整表同步面被接回 index.ts。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');

describe('B72 · 遗留 broad-sync 写面不得接回主 API', () => {
  it('index.ts 不再注册 app.all 整表同步面，也不再保留其守卫与处理器', () => {
    expect(SRC).not.toMatch(/\bapp\.all\(/);
    expect(SRC).not.toMatch(/\bhandleSync\b/);
    expect(SRC).not.toMatch(/\blegacyWriteGuard\b/);
    expect(SRC).not.toMatch(/\bsdkAuth\b/);
  });
});
