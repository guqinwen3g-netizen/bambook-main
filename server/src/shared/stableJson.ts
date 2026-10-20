/**
 * 与对象键顺序无关的 JSON 序列化，用于比较两份数据是否一致。
 * 公司存在 PostgreSQL jsonb 里，存取后对象键会按 jsonb 规则重排；直接比 JSON.stringify 会把没变的数据误判为已变化。
 * 值为 undefined 的键与缺省等同（与 JSON.stringify 一致）。
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => v === undefined ? 'null' : stableJson(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).filter(k => row[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJson(row[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
