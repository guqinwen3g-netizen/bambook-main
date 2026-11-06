import type { EmailMessage } from './mistEmail';

export const EMAIL_CATEGORIES = [
  '询价', '订单往来', '样品反馈', '生产进度', '出运单证', '收付款', '其他',
] as const;
export type EmailAnalysisField = { id: string; field: string; value: string; source: 'subject' | 'body'; quote: string };
export type EmailAnalysis = {
  id: string; at: string; actor: string; sourceHash: string; category: string; summary: string;
  fields: EmailAnalysisField[]; warnings: string[]; truncated: boolean; attachmentCount: number;
};
export type EmailExtractionReview = {
  id: string; analysisId: string; at: string; actor: string; actorId?: string; category: string;
  fields: Array<EmailAnalysisField & { corrected: boolean }>; note: string;
};
export type EmailReviewInput = { id: string; analysisId: string; category: string; fields: Array<{ id: string; value: string }>; note?: string };

// Only explicit text is sent. Attachments are not silently represented as read documents.
export function emailAnalysisText(m: Pick<EmailMessage, 'subject' | 'body'>) {
  return { subject: m.subject.slice(0, 500), body: m.body.slice(0, 12000) };
}
function object(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown, max: number, empty = false): v is string { return typeof v === 'string' && (empty || !!v.trim()) && v.length <= max; }
/** Reject invented evidence rather than accepting a syntactically valid model response. */
export function parseEmailAnalysis(raw: string, m: Pick<EmailMessage, 'subject' | 'body'>): Pick<EmailAnalysis, 'category' | 'summary' | 'fields' | 'warnings'> {
  let v: unknown;
  try { v = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')); } catch { throw new Error('邮件整理结果格式无效，请重试'); }
  if (!object(v) || Object.keys(v).some(k => !['category', 'summary', 'fields', 'warnings'].includes(k)) || !EMAIL_CATEGORIES.includes(v.category) || !text(v.summary, 800) || !Array.isArray(v.fields) || v.fields.length > 16 || !Array.isArray(v.warnings) || v.warnings.length > 8 || v.warnings.some((s: unknown) => !text(s, 300))) throw new Error('邮件整理结果格式无效，请重试');
  const source = emailAnalysisText(m), fields: EmailAnalysisField[] = [], dropped: string[] = [];
  for (const f of v.fields) {
    if (!object(f) || Object.keys(f).some(k => !['field', 'value', 'source', 'quote'].includes(k)) || !text(f.field, 60) || !text(f.value, 500) || !text(f.quote, 1000) || !['subject', 'body'].includes(f.source)) throw new Error('邮件整理结果格式无效，请重试');
    // A field whose value or quote is not verbatim in the email is dropped on its own; the verified fields stay usable.
    if (!source[f.source as 'subject' | 'body'].includes(f.quote) || !f.quote.includes(f.value)) { dropped.push(f.field.trim()); continue; }
    fields.push({ id: 'field-' + (fields.length + 1), field: f.field.trim(), value: f.value.trim(), source: f.source, quote: f.quote });
  }
  if (dropped.length && !fields.length) throw new Error('邮件整理的原文依据无法核实，请重试');
  const warnings = dropped.length ? [...v.warnings, `以下条目在原文中找不到一致依据，已略去，请人工核对：${dropped.join('、')}`] : v.warnings;
  return { category: v.category, summary: v.summary.trim(), fields, warnings };
}

export function reviewEmailAnalysis(analysis: EmailAnalysis, input: EmailReviewInput): Pick<EmailExtractionReview, 'category' | 'fields' | 'note'> {
  if (!input || Object.keys(input).some(k => !['id', 'analysisId', 'category', 'fields', 'note'].includes(k)) || input.analysisId !== analysis.id || !EMAIL_CATEGORIES.includes(input.category as any) || !Array.isArray(input.fields) || input.fields.length > 16 || !text(input.note ?? '', 1000, true)) throw new Error('复核内容无效，请重新打开');
  const seen = new Set<string>();
  const fields = input.fields.map(f => {
    const original = object(f) && analysis.fields.find(s => s.id === f.id);
    if (!original || Object.keys(f).some(k => !['id', 'value'].includes(k)) || seen.has(f.id) || !text(f.value, 500)) throw new Error('请选择有效条目并填写复核值');
    seen.add(f.id); return { ...original, value: f.value.trim(), corrected: f.value.trim() !== original.value };
  });
  return { category: input.category, fields, note: (input.note ?? '').trim() };
}
