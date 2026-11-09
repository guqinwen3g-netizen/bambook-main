/** One bilingual print template for generated shipment, order and lookbook documents (pure, versioned, no external resources). */
import { buildServerDocument, esc } from './docPrintBase';
import type { Bilingual, GeneratedDocSnapshot } from '../shared/mistGeneratedDocument';

const t = (b: Bilingual) => `${esc(b.zh)}${b.en ? ` <span class="en">${esc(b.en)}</span>` : ''}`;
const br = (s: string) => esc(s).replace(/\n/g, '<br>');

/**
 * seal：加盖电子公章时的印章图片（服务端由私有文件生成的 data URI）。只叠在第一个签字区（出具方）：约 38mm、半透明正片叠底，压住签字线。
 * 快照本身不含印章，盖章件与草稿出自同一份冻结快照。
 */
export function renderGeneratedDocumentHtml(s: GeneratedDocSnapshot, options: { sealDataUrl?: string; images?: Record<string, string> } = {}): string {
  const c = s.issuer, tb = s.table;
  const table = tb ? `<table class="doc-table"><thead><tr>${tb.columns.map(col => `<th${col.num ? ' class="num"' : ''}>${t(col.label)}</th>`).join('')}</tr></thead>
<tbody>${tb.rows.map(row => `<tr>${tb.columns.map(col => col.image ? `<td class="img">${row[col.key] && options.images?.[row[col.key]] ? `<img class="doc-thumb" src="${esc(options.images[row[col.key]])}" alt="">` : ''}</td>` : `<td${col.num ? ' class="num"' : ''}>${br(row[col.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
${tb.totals ? `<tfoot><tr>${tb.columns.map((col, i) => `<td${col.num ? ' class="num"' : ''}>${i === 0 && !tb.totals![col.key] ? t({ zh: '合计', en: 'Total' }) : br(tb.totals![col.key] ?? '')}</td>`).join('')}</tr></tfoot>` : ''}</table>` : '';
  const body = `<header class="doc-header"><div class="doc-title-block"><div class="issuer-name">${esc(c.legalName)}</div>${c.englishName ? `<div class="issuer-en">${esc(c.englishName)}</div>` : ''}<div class="issuer-detail">${[c.address, c.englishAddress, [c.phone, c.email].filter(Boolean).join(' / ')].filter(Boolean).map(esc).join('<br>')}</div></div>
<div class="doc-meta"><h1>${esc(s.title.zh)}</h1><div class="subtitle">${esc(s.title.en)}</div><div class="doc-no">${esc(s.number)}</div><div>${t({ zh: '日期', en: 'Date' })}：${esc(s.date)}</div></div></header>
${s.parties.length ? `<section class="doc-party-grid">${s.parties.map(p => `<div class="doc-party"><div class="label">${t(p.label)}</div><div class="name">${esc(p.name)}</div><div class="detail">${br(p.detail)}</div></div>`).join('')}</section>` : ''}
${s.facts.length ? `<section class="facts">${s.facts.map(f => `<div><span class="k">${t(f.label)}</span><span class="v">${br(f.value)}</span></div>`).join('')}</section>` : ''}
${table}
${s.amountInWords ? `<p class="words">${esc(s.amountInWords)}</p>` : ''}
${s.paragraphs.map(p => `<section class="doc-section">${p.title ? `<div class="doc-section-title">${t(p.title)}</div>` : ''}<div class="para">${br(p.text)}</div></section>`).join('')}
${s.signatures.length ? `<footer class="doc-footer">${s.signatures.map((sig, i) => `<div class="doc-signature">${i === 0 && options.sealDataUrl ? `<img class="doc-seal" src="${esc(options.sealDataUrl)}" alt="">` : ''}<div class="sig-label">${t(sig.label)}</div><div class="sig-line">${esc(sig.name)}</div></div>`).join('')}</footer>` : ''}
<div class="version-note">${esc(s.number)} · ${esc(s.kind)} · Template v${s.templateVersion}</div>`;
  return buildServerDocument(body, { extraStyles: '@page{size:A4}body{padding:0;font-size:11px}td.img{width:30mm;padding:4px}.doc-thumb{display:block;width:28mm;height:28mm;object-fit:cover;border-radius:2px}.en{font-weight:400;color:#718096;font-size:.85em;text-transform:none;letter-spacing:0}.issuer-name{font-size:15px;font-weight:600}.issuer-en{font-size:11px;color:#4a5568}.issuer-detail{font-size:10px;color:#4a5568;margin-top:4px;overflow-wrap:anywhere}.doc-meta h1{font-size:20px;font-weight:600;letter-spacing:2px}.doc-meta .subtitle{letter-spacing:2px;color:#718096;margin-bottom:6px;text-transform:uppercase}.facts{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:16px}.facts .k{color:#718096;margin-right:6px}.facts .v{overflow-wrap:anywhere}.num{text-align:right!important;white-space:nowrap}.words{font-weight:600;margin:-8px 0 16px}.para{white-space:normal;overflow-wrap:anywhere}.doc-footer,tr{break-inside:avoid}thead{display:table-header-group}.doc-signature{position:relative}.doc-seal{position:absolute;left:12mm;top:-6mm;width:38mm;height:38mm;object-fit:contain;opacity:.88;mix-blend-mode:multiply;pointer-events:none}.version-note{margin-top:16px;font-size:9px;color:#a0aec0;text-align:right}' }).replace('<head>', `<head><title>${esc(s.number)} · ${esc(s.title.zh)}</title>`);
}
