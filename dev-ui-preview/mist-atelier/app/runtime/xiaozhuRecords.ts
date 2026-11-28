/** 小竹回答里的编号、客户名自动链到对应记录：只匹配当前账号已读到的记录，不猜。 */
import type { MistState } from '../../../../server/src/shared/mistWorkspace';

import type { AgentTaskTrailItem } from '../../../../server/src/shared/mistAgentTasks';
import type { RouteTarget } from '../nav';

export type RecordRef = { text: string; view: string; id: string; target?: RouteTarget };

/** A report can auto-link a label only when its own verified reads agree on the destination. */
export function taskReportRecordIndex(trail: readonly AgentTaskTrailItem[] | undefined): RecordRef[] {
  const labels = new Map<string, RecordRef | undefined>();
  for (const step of trail ?? []) {
    if (step.kind !== 'read' || step.failed || step.completed === false) continue;
    const refs = step.ref ? [step.ref, ...(step.refs ?? [])] : step.refs ?? [];
    for (const { label, view, id, section } of refs) {
      const text = label.trim();
      if (!view || !id || text.length < 4) continue;
      if (!labels.has(text)) {
        labels.set(text, { text, view, id, ...(section ? { target: { section } } : {}) });
        continue;
      }
      const previous = labels.get(text);
      if (previous && (previous.view !== view || previous.id !== id || previous.target?.section !== (section || undefined))) {
        labels.set(text, undefined);
      }
    }
  }
  return [...labels.values()].filter((ref): ref is RecordRef => ref !== undefined);
}
export function recordIndex(state: MistState | null | undefined): RecordRef[] {
  if (!state) return [];
  const s: any = state, out: RecordRef[] = [], seen = new Set<string>();
  const add = (text: unknown, view: string, id: unknown) => { if (typeof text !== 'string' || typeof id !== 'string') return; const t = text.trim(); if (t.length < 4 || seen.has(t)) return; seen.add(t); out.push({ text: t, view, id }); };
  for (const o of s.orders ?? []) add(o.code, 'orders/detail', o.id);
  for (const d of s.devs ?? []) add(d.code, 'development/detail', d.id);
  for (const c of s.customers ?? []) { add(c.code, 'crm', c.id); add(c.name, 'crm', c.id); }
  for (const p of s.fulfillment?.purchases ?? []) add(p.code, 'procurement', p.id);
  for (const x of s.fulfillment?.shipments ?? []) add(x.code, 'shipments', x.id);
  for (const i of s.invoices ?? []) add(i.code, 'invoices', i.id);
  for (const q of s.market?.quotations ?? []) add(q.code, 'quotations', q.id);
  for (const sp of s.market?.suppliers ?? []) { add(sp.code, 'suppliers', sp.id); add(sp.name, 'suppliers', sp.id); }
  return out.sort((a, b) => b.text.length - a.text.length);
}
export const escapeSourceLabel = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 把已知编号改写成 bambook://r/<序号> 链接；代码片段和已有链接里的不动。 */
export function linkRecords(text: string, index: RecordRef[], attachmentNames: readonly string[] = []): string {
  if (!index.length || !text) return text;
  const filenames = new Set(attachmentNames);
  const names = [...new Set([...index.map(r => r.text), ...filenames])].sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(?<![\\w-])(' + names.map(escapeSourceLabel).join('|') + ')(?![\\w-])', 'g');
  const at = new Map(index.map((r, i) => [r.text, i]));
  let fenced = false;
  return text.split('\n').map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line.split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/).map((part, i) => i % 2 ? part : part.replace(pattern, m => filenames.has(m) ? m : `[${m}](bambook://r/${at.get(m)})`)).join('');
  }).join('\n');
}
