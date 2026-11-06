/** 报价截止日默认今天起 3 个工作日（跳过周六日）。 */
const plusWorkdays = (day: string, n: number) => { const d = new Date(day + 'T00:00:00Z'); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } return d.toISOString().slice(0, 10); };
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 采购管理 · 询价比价：按订单条目向多家供应商询价，逐家登记报价或谢绝，按折人民币单价比价并定标；定标生成采购草稿，仍走采购审批。 */
import React from 'react';
import { Award, Ban, Download, MessageSquareQuote, Plus, Scale, SearchX, Send, UserPlus, XCircle } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, EmptyState, Facts, Mono, Pill, TextLink, type Column, type Tone } from '../../../../../components/mist';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { fulfillmentSourceLabel, type FulfillmentPurchase } from '../../../../../server/src/shared/mistFulfillment';
import { RFQ_STATE_LABEL, readRfqs, rfqAwardFlags, rfqComparison, rfqCurrentQuotes, type MistRfq, type RfqComparisonRow } from '../../../../../server/src/shared/mistSourcing';
import { productionSupplierUnavailableReason } from '../../../../../server/src/shared/mistSupplierStatus';
import { developmentDomain } from '../../../../../server/src/shared/mistDevelopmentDomain';
import { downloadModuleXlsx, type ModuleEditorSpec } from './ModuleWorkbench';
import { setComposeIntent } from '../../runtime/composeIntent';
import { useNav } from '../../nav';
import { choiceField, emptyOption, Events, field, parseSource, sourceOptions, text, today } from './fulfillmentKit';
import { parsePurchaseContent, purchaseChoices, purchaseContent, sourceOrderBlocker } from './purchaseContent';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen, type ReasonedAction } from './pageKit';
import { CURRENCIES, SUPPLIER_PAYMENT_TERMS, UNITS } from '../../runtime/tradeOptions';
import { platformBusinessDate } from '../../../../../server/src/shared/mistPlatform';

const STATE_TONE: Record<MistRfq['state'], Tone> = { open: 'accent', awarded: 'ok', cancelled: 'neutral' };

const num = (v: Record<string, unknown>, key: string) => String(v[key] ?? '').trim();
const price = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function RfqLedger({ state, day, domain, needle, can, locked, loading, open, run, presetSupplierId, sourceLineId, blockedSource, onPurchase, onSupplier }: {
  state: MistState | undefined; day: string; domain: FulfillmentPurchase['domain']; needle: string; can: boolean; locked: boolean; loading: boolean; presetSupplierId?: string; sourceLineId?: string; blockedSource?: string;
  open: (spec: ModuleEditorSpec) => void; run: (command: MistCommand) => Promise<unknown>; onPurchase: (id: string) => void; onSupplier: (id: string) => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null), [drawer, setDrawer] = React.useState(false);
  const all = state ? readRfqs(state).filter(r => r.domain === domain && (!sourceLineId || r.lineId === sourceLineId)) : [];
  const sourceLine = state?.orderLines.find(line => line.id === sourceLineId);
  const sourceOrder = state?.orders.find(order => order.id === sourceLine?.orderId);
  const label = (r: MistRfq) => !state ? '' : r.devId ? (() => { const d = state.devs.find(x => x.id === r.devId); return d ? `开发 ${d.code} · ${d.name}` : '开发案'; })() : fulfillmentSourceLabel(state, { kind: 'orderLine', orderId: r.orderId, lineId: r.lineId });
  const devOptions = (state?.devs || []).filter(d => !d.closure && developmentDomain(d.values) === domain).map(d => ({ value: 'dev:' + d.id, label: `开发 ${d.code} · ${d.name}` }));
  const rows = all.filter(r => !needle || `${r.code} ${r.description} ${label(r)} ${r.quotes.map(q => q.supplier).join(' ')}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || a.deadline.localeCompare(b.deadline));
  const selected = rows.find(r => r.id === picked) || all.find(r => r.id === picked);
  const available = (state?.market.suppliers || []).filter(s => !productionSupplierUnavailableReason(s, day));
  const preset = presetSupplierId ? state?.market.suppliers.find(s => s.id === presetSupplierId) : undefined;

  const createSpec = (): ModuleEditorSpec => ({
    title: '发起询价', submitLabel: '发起询价',
    sections: [
      { id: 'need', label: '需求', fields: ['source', 'kind', 'description', 'quantity', 'unit', 'currency', 'due', 'destination', 'deadline', 'note'] },
      { id: 'suppliers', label: '邀请供应商', fields: available.map(s => `s:${s.id}`) },
    ],
    fields: [field('source', '来源条目', 'select', true, sourceOptions(state || null, false).filter(option => !option.value || state?.orderLines.some(line => option.value === `line:${line.id}` && state.orders.some(order => order.id === line.orderId && order.type === domain && !sourceOrderBlocker(order)))).concat(devOptions)), field('kind', '采购内容', 'select', true, [emptyOption, ...purchaseChoices(domain)]), field('description', '询价内容'), field('quantity', '需求数量', 'number'), choiceField('unit', '单位', UNITS), choiceField('currency', '比价币种', CURRENCIES, true, true),
      field('due', '需求交期', 'date'), field('destination', '交付地点'), field('deadline', '报价截止日', 'date'), field('note', '技术要求 / 备注', 'textarea', false),
      ...available.map(s => field(`s:${s.id}`, `${s.name} · ${s.type}`, 'checkbox', false))],
    initialValues: { source: sourceLine ? 'line:' + sourceLine.id : '', kind: domain === 'garment' ? 'processing' : '', description: sourceLine?.name || '', quantity: sourceLine?.qty || '', unit: sourceLine?.unit || (domain === 'garment' ? '件' : '米'), currency: 'CNY', due: sourceOrder?.due || '', destination: sourceOrder?.governance?.contract.deliveryPlace || '', deadline: plusWorkdays(today(), 3), note: '', ...Object.fromEntries(available.map(s => [`s:${s.id}`, s.id === preset?.id])) },
    submit: async v => {
      if (!state) return;
      const picked = text(v, 'source'), devId = picked.startsWith('dev:') ? picked.slice(4) : '';
      const source = devId ? undefined : parseSource(state, picked);
      if (!devId && source?.kind !== 'orderLine') throw new Error('请选择订单条目或开发案');
      const saved = await run({ type: 'rfq.save', payload: { input: { ...(devId ? { devId, orderId: '', lineId: '' } : { orderId: source!.kind === 'orderLine' ? source!.orderId : '', lineId: source!.kind === 'orderLine' ? source!.lineId : '' }), ...parsePurchaseContent(text(v, 'kind'), domain), description: text(v, 'description'), quantity: num(v, 'quantity'), unit: text(v, 'unit'), currency: text(v, 'currency'), due: text(v, 'due'), destination: text(v, 'destination'), deadline: text(v, 'deadline'), note: text(v, 'note'), supplierIds: available.filter(s => v[`s:${s.id}`] === true).map(s => s.id) } } }) as { result?: { id?: string } } | undefined;
      if (saved?.result?.id) setPicked(saved.result.id);
    } });
  const invited = (r: MistRfq) => r.supplierIds.map(id => ({ value: id, label: state?.market.suppliers.find(s => s.id === id)?.name || id }));
  const quoteSpec = (r: MistRfq): ModuleEditorSpec => ({
    title: '登记报价', submitLabel: '登记报价', description: `${r.code} · ${r.description} ${r.quantity} ${r.unit}，需求交期 ${r.due}`,
    sections: [{id:'quote',label:'报价',fields:['supplierId','price','currency','moq']},{id:'delivery',label:'交付约定',fields:['promisedDue','terms','validUntil','note']}],
    fields: [field('supplierId', '供应商', 'select', true, [emptyOption, ...invited(r)]), field('price', `单价（每${r.unit}）`, 'number'), choiceField('currency', '报价币种', CURRENCIES, true, true), field('moq', `MOQ（${r.unit}）`, 'number', false), field('promisedDue', '承诺交期', 'date'), choiceField('terms', '付款条件', SUPPLIER_PAYMENT_TERMS), field('validUntil', '报价有效期', 'date'), field('note', '备注', 'textarea', false)],
    initialValues: { supplierId: '', price: '', currency: r.currency, moq: '', promisedDue: r.due, terms: '', validUntil: '', note: '' },
    submit: v => run({ type: 'rfq.quote', payload: { id: r.id, supplierId: text(v, 'supplierId'), price: num(v, 'price'), currency: text(v, 'currency'), moq: num(v, 'moq'), promisedDue: text(v, 'promisedDue'), terms: text(v, 'terms'), validUntil: text(v, 'validUntil'), note: text(v, 'note') } }) });
  const declineSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '登记谢绝报价', submitLabel: '登记谢绝', fields: [field('supplierId', '供应商', 'select', true, [emptyOption, ...invited(r)]), field('declineReason', '谢绝原因', 'textarea')], initialValues: { supplierId: '', declineReason: '' },
    submit: v => run({ type: 'rfq.quote', payload: { id: r.id, supplierId: text(v, 'supplierId'), declined: true, declineReason: text(v, 'declineReason') } }) });
  const inviteSpec = (r: MistRfq): ModuleEditorSpec => { const rest = available.filter(s => !r.supplierIds.includes(s.id)); return { title: '追加邀请供应商', submitLabel: '追加邀请', fields: rest.map(s => field(`s:${s.id}`, `${s.name} · ${s.type}`, 'checkbox', false)), initialValues: Object.fromEntries(rest.map(s => [`s:${s.id}`, false])),
    submit: v => run({ type: 'rfq.invite', payload: { id: r.id, supplierIds: rest.filter(s => v[`s:${s.id}`] === true).map(s => s.id) } }) }; };
  const awardSpec = (r: MistRfq, row: RfqComparisonRow): ModuleEditorSpec => { const flags = state ? rfqAwardFlags(state, r, row.quote.id, day) : [];
    return { title: `定标 ${row.quote.supplier}`, submitLabel: '定标并生成采购草稿', description: `${price(row.quote.price)} ${row.quote.currency}/${r.unit} · 承诺交期 ${row.quote.promisedDue} · ${row.quote.terms}${flags.length ? ` · ${flags.join('；')}` : ''}`,
      fields: [field('reason', '定标理由', 'textarea', flags.length > 0)], initialValues: { reason: '' },
      submit: async v => { const saved = await run({ type: 'rfq.award', payload: { id: r.id, quoteId: row.quote.id, reason: text(v, 'reason') } }) as { result?: { purchaseId?: string } } | undefined; if (saved?.result?.purchaseId) onPurchase(saved.result.purchaseId); } }; };
  const editSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '修改询价需求', submitLabel: '保存修改', fields: [field('quantity', `需求数量（${r.unit}）`, 'number'), field('due', '需求交期', 'date'), field('deadline', '报价截止日', 'date'), field('reason', '修改原因', 'textarea')], initialValues: { quantity: r.quantity, due: r.due, deadline: r.deadline, reason: '' },
    submit: v => run({ type: 'rfq.update', payload: { id: r.id, quantity: String(v.quantity), due: text(v, 'due'), deadline: text(v, 'deadline'), reason: text(v, 'reason') } }) });
  const unawardSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '撤销定标', submitLabel: '撤销定标', submitVariant: 'danger', description: r.award && !r.devId ? `${r.award.supplier} · 采购草稿 ${r.award.purchaseCode} 将作废` : undefined, fields: [field('reason', '撤销原因', 'textarea')], initialValues: { reason: '' }, submit: v => run({ type: 'rfq.unaward', payload: { id: r.id, reason: text(v, 'reason') } }) });
  const reopenSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '重开询价', submitLabel: '重开', fields: [field('deadline', '报价截止日', 'date'), field('reason', '重开原因', 'textarea')], initialValues: { deadline: '', reason: '' }, submit: v => run({ type: 'rfq.reopen', payload: { id: r.id, deadline: text(v, 'deadline'), reason: text(v, 'reason') } }) });
  const cancelSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '取消询价', submitLabel: '取消询价', fields: [field('reason', '取消原因', 'textarea')], initialValues: { reason: '' }, submit: v => run({ type: 'rfq.cancel', payload: { id: r.id, reason: text(v, 'reason') } }) });

  const columns: Column<MistRfq>[] = [
    { key: 'code', header: '询价单', width: 'minmax(200px,2fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><span><Mono>{r.code}</Mono> · {r.description}</span><small className="mist-muted">{label(r)}</small></div> },
    { key: 'quotes', header: '报价', width: '120px', hideOnMobile: true, render: r => { const q = rfqCurrentQuotes(r); return <div className="mist-col" style={{ gap: 2 }}><span>{q.filter(x => !x.declined).length} / {r.supplierIds.length}{uiText(" 家")}</span><small className={r.state === 'open' && r.deadline < day ? 'mist-tone-bad' : 'mist-muted'}>{uiText("截止 ")}{r.deadline}</small></div>; } },
    { key: 'best', header: '最低报价', width: 'minmax(130px,1.2fr)', hideOnMobile: true, render: r => { const best = state ? rfqComparison(state, r, day).rows.find(x => x.lowest) : undefined; return best ? <div className="mist-col" style={{ gap: 2 }}><span>{price(best.quote.price)} {best.quote.currency}</span><small className="mist-muted">{best.quote.supplier}</small></div> : <span className="mist-muted">{uiText("暂无有效报价")}</span>; } },
    { key: 'state', header: '状态', width: '110px', render: r => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={STATE_TONE[r.state]}>{RFQ_STATE_LABEL[r.state]}</Pill>{r.award && <small className="mist-muted">{r.award.supplier}</small>}</div> },
  ];
  const detail = selected && state ? <RfqDetail rfq={selected} state={state} day={day} can={can} locked={locked} label={uiText(label(selected))} onPurchase={onPurchase} onSupplier={onSupplier}
      onQuote={() => open(quoteSpec(selected))} onDecline={() => open(declineSpec(selected))} onInvite={() => open(inviteSpec(selected))} onAward={row => open(awardSpec(selected, row))} onCancel={() => open(cancelSpec(selected))} onEdit={() => open(editSpec(selected))} onUnaward={() => open(unawardSpec(selected))} onReopen={() => open(reopenSpec(selected))} canInvite={available.some(s => !selected.supplierIds.includes(s.id))} />
    : <EmptyState icon={Scale} title={uiText("选择询价单")} compact />;
  return <>
    {preset && productionSupplierUnavailableReason(preset,day) && <div className="mist-section"><Banner tone="warn" title={preset.name}>{uiText(productionSupplierUnavailableReason(preset,day))}</Banner></div>}
    <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected ? `${selected.code} · ${selected.description}` : '询价详情'} drawerSub={selected ? RFQ_STATE_LABEL[selected.state] : undefined}
      list={<Card>
        <CardHeader title={ui`询价比价 · ${all.length}`} tools={can ? <Button variant="primary" icon={Plus} disabled={locked || !!blockedSource} title={uiText(blockedSource || undefined)} onClick={() => open(createSpec())}>{uiText("发起询价")}</Button> : undefined} />
        <DataTable ariaLabel={uiText("询价单列表")} loading={loading} rows={rows} rowKey={r => r.id} selectedKey={selected?.id} density="comfy" onRowClick={r => { setPicked(r.id); setDrawer(true); }} columns={columns}
          empty={needle && all.length ? <EmptyState icon={SearchX} title={uiText("没有符合条件的询价单")} description={uiText("换个关键词试试。")} /> : <EmptyState icon={Scale} title={ui`还没有${domain === 'fabric' ? '面料' : '成衣'}询价`} />} />
      </Card>}
      detail={detail} />
  </>;
}

function RfqDetail({ rfq: r, state, day, can, locked, label, canInvite, onQuote, onDecline, onInvite, onAward, onCancel, onEdit, onUnaward, onReopen, onPurchase, onSupplier }: {
  rfq: MistRfq; state: MistState; day: string; can: boolean; locked: boolean; label: string; canInvite: boolean;
  onQuote: () => void; onDecline: () => void; onInvite: () => void; onAward: (row: RfqComparisonRow) => void; onCancel: () => void; onEdit: () => void; onUnaward: () => void; onReopen: () => void; onPurchase: (id: string) => void; onSupplier: (id: string) => void;
}) {
  const { go } = useNav();
  const cmp = rfqComparison(state, r, day), isOpen = r.state === 'open', history = r.quotes.filter(q => q.supersededAt);
  const pendingSuppliers = r.supplierIds.filter(id => !rfqCurrentQuotes(r).some(q => q.supplierId === id)).map(id => state.market.suppliers.find(s => s.id === id)?.name || id);
  const closedReason = isOpen ? false : `询价单${RFQ_STATE_LABEL[r.state]}`;
  return <DetailBody data-rfq-detail={r.id} heading={<div><span className="mist-mono mist-muted">{r.code}</span><div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{r.description}</div></div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={STATE_TONE[r.state]}>{RFQ_STATE_LABEL[r.state]}</Pill>{isOpen && r.deadline < day && <Pill tone="warn">{uiText("已过报价截止日")}</Pill>}</div>
    {r.award && r.devId && <Banner variant="status" tone="ok" title={ui`已定标 ${r.award.supplier}`}>{r.award.price} {r.award.currency}/{uiText(r.unit)}{uiText(r.award.flags.length ? `；${r.award.flags.join('；')}；理由：${r.award.reason}` : '')}</Banner>}
    {r.award && !r.devId && <Banner variant="status" tone="ok" title={ui`已定标 ${r.award.supplier}`}>{uiText("生成采购草稿 ")}<TextLink onClick={() => onPurchase(r.award!.purchaseId)}>{r.award.purchaseCode}</TextLink>{uiText(r.award.flags.length ? `；${r.award.flags.join('；')}；理由：${r.award.reason}` : '')}。</Banner>}
    {r.cancelled && <Banner variant="status" tone="neutral" title={uiText("询价已取消")}>{r.cancelled.reason}</Banner>}
    {can && isOpen && <ActionBar busy={locked} actions={[
      { label: '登记报价', icon: MessageSquareQuote, onClick: onQuote, primary: true, reason: closedReason },
      { label: '登记谢绝', icon: XCircle, onClick: onDecline, reason: closedReason },
      { label: '追加邀请', icon: UserPlus, onClick: onInvite, reason: closedReason || (canInvite ? false : '没有其他可合作供应商') },
      { label: '修改需求', onClick: onEdit, reason: closedReason },
      { label: '取消询价', icon: Ban, onClick: onCancel, reason: closedReason, hidden: !isOpen },
    ] as ReasonedAction[]} />}
    {can && r.state === 'awarded' && (() => { const po = state.fulfillment.purchases.find(x => x.id === r.award?.purchaseId); return <ActionBar busy={locked} actions={[{ label: '撤销定标', onClick: onUnaward, reason: po && !['draft', 'rejected', 'cancelled'].includes(po.state) ? '采购单已提交审批或已批准' : false }] as ReasonedAction[]} />; })()}
    {can && r.state === 'cancelled' && <ActionBar busy={locked} actions={[{ label: '重开询价', onClick: onReopen }] as ReasonedAction[]} />}
    {!!r.changes?.length && <DetailBlock title={uiText('变更记录')}>{r.changes.map((c, i) => <div key={i} className="mist-note">{platformBusinessDate(c.at)} · {c.actor} · {c.note}</div>)}</DetailBlock>}
    <Facts items={[
      { label: r.devId ? '来源开发案' : '来源条目', value: label },
      { label: '需求', value: `${r.quantity} ${r.unit} · ${purchaseContent(r)}` },
      { label: '需求交期', value: r.due },
      { label: '交付地点', value: r.destination },
      { label: '报价截止', value: r.deadline },
      { label: '比价口径', value: cmp.basis === 'cny' ? '单价折人民币（月末汇率）' : `仅比较 ${r.currency} 报价（缺月末汇率）` },
    ]} />
    {r.note && <p className="mist-sub">{uiText("技术要求：")}{r.note}</p>}
    <DetailBlock title={ui`比价 · ${cmp.rows.length}`}>
      {cmp.rows.length ? <DataTable ariaLabel={ui`${r.code} 比价`} rows={cmp.rows} rowKey={x => x.quote.id} columns={[
        { key: 'supplier', header: '供应商', render: x => <div className="mist-col" style={{ gap: 2 }}><TextLink onClick={() => onSupplier(x.quote.supplierId)}>{x.quote.supplier}</TextLink><small className="mist-muted">{uiText("评级 ")}{x.grade}</small></div> },
        { key: 'price', header: '单价', align: 'right', render: x => x.quote.declined ? <span className="mist-muted">{uiText("谢绝：")}{x.quote.declineReason}</span> : <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span>{price(x.quote.price)} {x.quote.currency}</span><small className="mist-muted">{uiText(x.cnyUnit !== null && x.quote.currency !== 'CNY' ? `≈ ${price(x.cnyUnit)} CNY` : x.comparable ? '' : '缺汇率，未比价')}</small></div> },
        { key: 'terms', header: '交期 / 条件', render: x => x.quote.declined ? null : <div className="mist-col" style={{ gap: 2 }}><span className={x.late ? 'mist-tone-bad' : undefined}>{x.quote.promisedDue}{uiText(x.late ? '（晚于需求）' : '')}</span><small className={x.moqOver ? 'mist-tone-bad' : 'mist-muted'}>MOQ {x.quote.moq || '无'} · {x.quote.terms}</small><small className={x.valid ? 'mist-muted' : 'mist-tone-bad'}>{uiText("有效至 ")}{x.quote.validUntil}</small></div> },
        { key: 'rank', header: '排名', render: x => x.lowest ? <Pill tone="ok">{uiText("最低价")}</Pill> : x.rank ? `第 ${x.rank}` : <span className="mist-muted">—</span> },
        ...(can && isOpen ? [{ key: 'act', header: '', align: 'right' as const, render: (x: RfqComparisonRow) => x.valid ? <Button size="sm" icon={Award} disabled={locked} aria-label={ui`定标 ${x.quote.supplier}`} onClick={() => onAward(x)}>{uiText("定标")}</Button> : null }] : []),
      ]} /> : <span className="mist-note">{uiText("还没有报价。")}</span>}
      {isOpen && pendingSuppliers.length > 0 && <span className="mist-note">{uiText("待报价：")}{pendingSuppliers.join('、')}</span>}
      <ActionBar busy={locked} actions={[
        { label: '导出比价表', icon: Download, onClick: () => downloadModuleXlsx(`${r.code}-比价.xlsx`, [{ name: '比价', headers: ['供应商', '评级', '单价', '币种', '折人民币', 'MOQ', '承诺交期', '付款条件', '有效期', '排名', '备注'], rows: cmp.rows.map(x => [x.quote.supplier, x.grade, x.quote.declined ? '' : x.quote.price, x.quote.currency, x.cnyUnit ?? '', x.quote.moq || '', x.quote.promisedDue, x.quote.terms, x.quote.validUntil, x.lowest ? '最低价' : x.rank ?? '', x.quote.declined ? '谢绝：' + x.quote.declineReason : [x.late ? '晚于需求交期' : '', x.moqOver ? 'MOQ 超出需求' : '', x.valid ? '' : '报价已过期'].filter(Boolean).join('；')]) }, { name: '需求', headers: ['项目', '内容'], rows: [['询价单', r.code], ['来源条目', label], ['需求', `${r.quantity} ${r.unit} · ${r.description}`], ['需求交期', r.due], ['交付地点', r.destination], ['报价截止', r.deadline]] }]), reason: !cmp.rows.length ? '还没有报价' : false },
        { label: '用邮箱发询价函', icon: Send, onClick: () => { const pending = r.supplierIds.filter(id => !rfqCurrentQuotes(r).some(q => q.supplierId === id)).map(id => state.market.suppliers.find(x => x.id === id)).filter(Boolean); setComposeIntent({ to: pending.map(x => x!.contacts.find(c => c.primary && c.email)?.email || x!.contacts.find(c => c.email)?.email).filter(Boolean).join(', '), subject: `询价 ${r.code} · ${r.description}`, body: `您好，\n\n请就以下需求报价：\n品名 / 规格：${r.description}\n数量：${r.quantity} ${r.unit}\n需求交期：${r.due}\n交付地点：${r.destination}\n报价币种：${r.currency}\n请于 ${r.deadline} 前回复单价、MOQ、交期与付款条件。${r.note ? '\n\n' + r.note : ''}\n`, links: [{ kind: 'rfq', id: r.id }] }); go('emails'); }, reason: !isOpen ? `询价单${RFQ_STATE_LABEL[r.state]}` : false, hidden: !can },
      ] as ReasonedAction[]} />
    </DetailBlock>
    {history.length > 0 && <DetailBlock title={ui`历史报价 · ${history.length}`}><div className="mist-col">{history.map(q => <small key={q.id} className="mist-muted">{q.supplier} · {uiText(q.declined ? `谢绝：${q.declineReason}` : `${price(q.price)} ${q.currency} · 交期 ${q.promisedDue}`)} · {shortWhen(q.at)}，{shortWhen(q.supersededAt!)}{uiText(" 更新")}</small>)}</div></DetailBlock>}
    <DetailBlock title={uiText("记录")}><Events entity="procurement" id={r.id} /></DetailBlock>
  </DetailBody>;
}
