/** 采购管理 · 询价比价：按订单条目向多家供应商询价，逐家登记报价或谢绝，按折人民币单价比价并定标；定标生成采购草稿，仍走采购审批。 */
import React from 'react';
import { Award, Ban, MessageSquareQuote, Plus, Scale, SearchX, UserPlus, XCircle } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, EmptyState, Facts, Mono, Pill, TextLink, type Column, type Tone } from '../../../../../components/mist';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { fulfillmentSourceLabel, type FulfillmentPurchase } from '../../../../../server/src/shared/mistFulfillment';
import { RFQ_STATE_LABEL, readRfqs, rfqAwardFlags, rfqComparison, rfqCurrentQuotes, type MistRfq, type RfqComparisonRow } from '../../../../../server/src/shared/mistSourcing';
import { supplierStatusOn, supplierUnavailableReason } from '../../../../../server/src/shared/mistSupplierStatus';
import type { ModuleEditorSpec } from './ModuleWorkbench';
import { emptyOption, Events, field, parseSource, sourceOptions, text, today } from './fulfillmentKit';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen, type ReasonedAction } from './pageKit';

const STATE_TONE: Record<MistRfq['state'], Tone> = { open: 'accent', awarded: 'ok', cancelled: 'neutral' };
const KIND_OPTIONS = [{ value: 'material', label: '材料' }, { value: 'finished', label: '成品' }, { value: 'processing', label: '加工服务' }];
const num = (v: Record<string, unknown>, key: string) => String(v[key] ?? '').trim();
const price = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function RfqLedger({ state, day, domain, needle, can, locked, loading, open, run, presetSupplierId, onPurchase, onSupplier }: {
  state: MistState | undefined; day: string; domain: FulfillmentPurchase['domain']; needle: string; can: boolean; locked: boolean; loading: boolean; presetSupplierId?: string;
  open: (spec: ModuleEditorSpec) => void; run: (command: MistCommand) => Promise<unknown>; onPurchase: (id: string) => void; onSupplier: (id: string) => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null), [drawer, setDrawer] = React.useState(false);
  const all = state ? readRfqs(state).filter(r => r.domain === domain) : [];
  const label = (r: MistRfq) => state ? fulfillmentSourceLabel(state, { kind: 'orderLine', orderId: r.orderId, lineId: r.lineId }) : '';
  const rows = all.filter(r => !needle || `${r.code} ${r.description} ${label(r)} ${r.quotes.map(q => q.supplier).join(' ')}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || a.deadline.localeCompare(b.deadline));
  const selected = rows.find(r => r.id === picked) || all.find(r => r.id === picked);
  const available = (state?.market.suppliers || []).filter(s => supplierStatusOn(s, day) === 'active');
  const preset = presetSupplierId ? state?.market.suppliers.find(s => s.id === presetSupplierId) : undefined;

  const createSpec = (): ModuleEditorSpec => ({
    title: '发起询价', submitLabel: '发起询价', description: '按订单条目向至少两家可合作供应商询价；报价截止日不晚于需求交期。询价不形成对外采购承诺。',
    sections: [
      { id: 'need', label: '需求', fields: ['source', 'kind', 'description', 'quantity', 'unit', 'currency', 'due', 'destination', 'deadline', 'note'] },
      { id: 'suppliers', label: '邀请供应商', description: '暂停或停用的供应商不在列表中。', fields: available.map(s => `s:${s.id}`) },
    ],
    fields: [field('source', '来源条目', 'select', true, sourceOptions(state || null, false)), field('kind', '采购类型', 'select', true, KIND_OPTIONS), field('description', '询价内容'), field('quantity', '需求数量', 'number'), field('unit', '单位'), { ...field('currency', '比价币种'), hint: '供应商可按其他币种报价，比价时按月末汇率折人民币。' },
      field('due', '需求交期', 'date'), field('destination', '交付地点'), field('deadline', '报价截止日', 'date'), field('note', '技术要求 / 备注', 'textarea', false),
      ...available.map(s => field(`s:${s.id}`, `${s.name} · ${s.type}`, 'checkbox', false))],
    initialValues: { source: '', kind: domain === 'garment' ? 'processing' : 'material', description: '', quantity: '', unit: domain === 'garment' ? '件' : '米', currency: 'CNY', due: '', destination: '', deadline: today(), note: '', ...Object.fromEntries(available.map(s => [`s:${s.id}`, s.id === preset?.id])) },
    submit: async v => {
      if (!state) return;
      const source = parseSource(state, text(v, 'source'));
      if (source.kind !== 'orderLine') throw new Error('询价必须关联订单条目');
      const saved = await run({ type: 'rfq.save', payload: { input: { orderId: source.orderId, lineId: source.lineId, kind: text(v, 'kind') as FulfillmentPurchase['kind'], description: text(v, 'description'), quantity: num(v, 'quantity'), unit: text(v, 'unit'), currency: text(v, 'currency'), due: text(v, 'due'), destination: text(v, 'destination'), deadline: text(v, 'deadline'), note: text(v, 'note'), supplierIds: available.filter(s => v[`s:${s.id}`] === true).map(s => s.id) } } }) as { result?: { id?: string } } | undefined;
      if (saved?.result?.id) setPicked(saved.result.id);
    } });
  const invited = (r: MistRfq) => r.supplierIds.map(id => ({ value: id, label: state?.market.suppliers.find(s => s.id === id)?.name || id }));
  const quoteSpec = (r: MistRfq): ModuleEditorSpec => ({
    title: '登记报价', submitLabel: '登记报价', description: `${r.code} · ${r.description} ${r.quantity} ${r.unit}，需求交期 ${r.due}。同一供应商再次登记即为更新报价，原报价保留为历史。`,
    fields: [field('supplierId', '供应商', 'select', true, [emptyOption, ...invited(r)]), field('price', `单价（每${r.unit}）`, 'number'), field('currency', '报价币种'), { ...field('moq', `MOQ（${r.unit}）`, 'number', false), hint: '无最小起订量留空。' }, field('promisedDue', '承诺交期', 'date'), field('terms', '付款条件'), field('validUntil', '报价有效期', 'date'), field('note', '备注', 'textarea', false)],
    initialValues: { supplierId: '', price: '', currency: r.currency, moq: '', promisedDue: r.due, terms: '', validUntil: '', note: '' },
    submit: v => run({ type: 'rfq.quote', payload: { id: r.id, supplierId: text(v, 'supplierId'), price: num(v, 'price'), currency: text(v, 'currency'), moq: num(v, 'moq'), promisedDue: text(v, 'promisedDue'), terms: text(v, 'terms'), validUntil: text(v, 'validUntil'), note: text(v, 'note') } }) });
  const declineSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '登记谢绝报价', submitLabel: '登记谢绝', fields: [field('supplierId', '供应商', 'select', true, [emptyOption, ...invited(r)]), field('declineReason', '谢绝原因', 'textarea')], initialValues: { supplierId: '', declineReason: '' },
    submit: v => run({ type: 'rfq.quote', payload: { id: r.id, supplierId: text(v, 'supplierId'), declined: true, declineReason: text(v, 'declineReason') } }) });
  const inviteSpec = (r: MistRfq): ModuleEditorSpec => { const rest = available.filter(s => !r.supplierIds.includes(s.id)); return { title: '追加邀请供应商', submitLabel: '追加邀请', fields: rest.map(s => field(`s:${s.id}`, `${s.name} · ${s.type}`, 'checkbox', false)), initialValues: Object.fromEntries(rest.map(s => [`s:${s.id}`, false])),
    submit: v => run({ type: 'rfq.invite', payload: { id: r.id, supplierIds: rest.filter(s => v[`s:${s.id}`] === true).map(s => s.id) } }) }; };
  const awardSpec = (r: MistRfq, row: RfqComparisonRow): ModuleEditorSpec => { const flags = state ? rfqAwardFlags(state, r, row.quote.id, day) : [];
    return { title: `定标 ${row.quote.supplier}`, submitLabel: '定标并生成采购草稿', description: `${price(row.quote.price)} ${row.quote.currency}/${r.unit} · 承诺交期 ${row.quote.promisedDue} · ${row.quote.terms}。定标后按中标报价生成采购草稿，仍须提交审批。${flags.length ? `需要说明：${flags.join('；')}。` : ''}`,
      fields: [field('reason', '定标理由', 'textarea', flags.length > 0)], initialValues: { reason: '' },
      submit: async v => { const saved = await run({ type: 'rfq.award', payload: { id: r.id, quoteId: row.quote.id, reason: text(v, 'reason') } }) as { result?: { purchaseId?: string } } | undefined; if (saved?.result?.purchaseId) onPurchase(saved.result.purchaseId); } }; };
  const cancelSpec = (r: MistRfq): ModuleEditorSpec => ({ title: '取消询价', submitLabel: '取消询价', fields: [field('reason', '取消原因', 'textarea')], initialValues: { reason: '' }, submit: v => run({ type: 'rfq.cancel', payload: { id: r.id, reason: text(v, 'reason') } }) });

  const columns: Column<MistRfq>[] = [
    { key: 'code', header: '询价单', width: 'minmax(200px,2fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><span><Mono>{r.code}</Mono> · {r.description}</span><small className="mist-muted">{label(r)}</small></div> },
    { key: 'quotes', header: '报价', width: '120px', hideOnMobile: true, render: r => { const q = rfqCurrentQuotes(r); return <div className="mist-col" style={{ gap: 2 }}><span>{q.filter(x => !x.declined).length} / {r.supplierIds.length} 家</span><small className={r.state === 'open' && r.deadline < day ? 'mist-tone-bad' : 'mist-muted'}>截止 {r.deadline}</small></div>; } },
    { key: 'best', header: '最低报价', width: 'minmax(130px,1.2fr)', hideOnMobile: true, render: r => { const best = state ? rfqComparison(state, r, day).rows.find(x => x.lowest) : undefined; return best ? <div className="mist-col" style={{ gap: 2 }}><span>{price(best.quote.price)} {best.quote.currency}</span><small className="mist-muted">{best.quote.supplier}</small></div> : <span className="mist-muted">暂无有效报价</span>; } },
    { key: 'state', header: '状态', width: '110px', render: r => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={STATE_TONE[r.state]}>{RFQ_STATE_LABEL[r.state]}</Pill>{r.award && <small className="mist-muted">{r.award.supplier}</small>}</div> },
  ];
  const detail = selected && state ? <RfqDetail rfq={selected} state={state} day={day} can={can} locked={locked} label={label(selected)} onPurchase={onPurchase} onSupplier={onSupplier}
      onQuote={() => open(quoteSpec(selected))} onDecline={() => open(declineSpec(selected))} onInvite={() => open(inviteSpec(selected))} onAward={row => open(awardSpec(selected, row))} onCancel={() => open(cancelSpec(selected))} canInvite={available.some(s => !selected.supplierIds.includes(s.id))} />
    : <EmptyState icon={Scale} title="询价详情" description="从列表选择一张询价单，查看比价与定标" compact />;
  return <>
    {preset && <div className="mist-section"><Banner tone="neutral" title={`从供应商 ${preset.name} 进入`}>{supplierUnavailableReason(preset, day) ? `${preset.name} 当前不可合作（${supplierUnavailableReason(preset, day)}），不能邀请报价。` : `发起询价时已默认勾选 ${preset.name}，至少再邀请一家供应商比价。`}</Banner></div>}
    <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected ? `${selected.code} · ${selected.description}` : '询价详情'} drawerSub={selected ? RFQ_STATE_LABEL[selected.state] : undefined}
      list={<Card>
        <CardHeader title={`询价比价 · ${all.length}`} sub="多家报价按折人民币单价比价；定标生成采购草稿后走审批。" tools={can ? <Button variant="primary" icon={Plus} disabled={locked} onClick={() => open(createSpec())}>发起询价</Button> : undefined} />
        <DataTable ariaLabel="询价单列表" loading={loading} rows={rows} rowKey={r => r.id} selectedKey={selected?.id} density="comfy" onRowClick={r => { setPicked(r.id); setDrawer(true); }} columns={columns}
          empty={needle && all.length ? <EmptyState icon={SearchX} title="没有符合条件的询价单" description="换个关键词试试。" /> : <EmptyState icon={Scale} title={`还没有${domain === 'fabric' ? '面料' : '成衣'}询价`} description="需要比价的采购或委外加工，先按订单条目向多家供应商询价，再按报价定标。" />} />
      </Card>}
      detail={detail} />
  </>;
}

function RfqDetail({ rfq: r, state, day, can, locked, label, canInvite, onQuote, onDecline, onInvite, onAward, onCancel, onPurchase, onSupplier }: {
  rfq: MistRfq; state: MistState; day: string; can: boolean; locked: boolean; label: string; canInvite: boolean;
  onQuote: () => void; onDecline: () => void; onInvite: () => void; onAward: (row: RfqComparisonRow) => void; onCancel: () => void; onPurchase: (id: string) => void; onSupplier: (id: string) => void;
}) {
  const cmp = rfqComparison(state, r, day), isOpen = r.state === 'open', history = r.quotes.filter(q => q.supersededAt);
  const pendingSuppliers = r.supplierIds.filter(id => !rfqCurrentQuotes(r).some(q => q.supplierId === id)).map(id => state.market.suppliers.find(s => s.id === id)?.name || id);
  const closedReason = isOpen ? false : `询价单${RFQ_STATE_LABEL[r.state]}`;
  return <DetailBody data-rfq-detail={r.id} heading={<div><span className="mist-mono mist-muted">{r.code}</span><div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{r.description}</div></div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={STATE_TONE[r.state]}>{RFQ_STATE_LABEL[r.state]}</Pill>{isOpen && r.deadline < day && <Pill tone="warn">已过报价截止日</Pill>}</div>
    {r.award && <Banner tone="ok" title={`已定标 ${r.award.supplier}`}>生成采购草稿 <TextLink onClick={() => onPurchase(r.award!.purchaseId)}>{r.award.purchaseCode}</TextLink>{r.award.flags.length ? `；${r.award.flags.join('；')}；理由：${r.award.reason}` : ''}。</Banner>}
    {r.cancelled && <Banner tone="neutral" title="询价已取消">{r.cancelled.reason}</Banner>}
    {can && <ActionBar busy={locked} actions={[
      { label: '登记报价', icon: MessageSquareQuote, onClick: onQuote, primary: true, reason: closedReason },
      { label: '登记谢绝', icon: XCircle, onClick: onDecline, reason: closedReason },
      { label: '追加邀请', icon: UserPlus, onClick: onInvite, reason: closedReason || (canInvite ? false : '没有其他可合作供应商') },
      { label: '取消询价', icon: Ban, onClick: onCancel, reason: closedReason, hidden: !isOpen },
    ] as ReasonedAction[]} />}
    <Facts items={[
      { label: '来源条目', value: label },
      { label: '需求', value: `${r.quantity} ${r.unit} · ${KIND_OPTIONS.find(k => k.value === r.kind)?.label}` },
      { label: '需求交期', value: r.due },
      { label: '交付地点', value: r.destination },
      { label: '报价截止', value: r.deadline },
      { label: '比价口径', value: cmp.basis === 'cny' ? '单价折人民币（月末汇率）' : `仅比较 ${r.currency} 报价（缺月末汇率）` },
    ]} />
    {r.note && <p className="mist-sub">技术要求：{r.note}</p>}
    <DetailBlock title={`比价 · ${cmp.rows.length}`}>
      {cmp.rows.length ? <DataTable ariaLabel={`${r.code} 比价`} rows={cmp.rows} rowKey={x => x.quote.id} columns={[
        { key: 'supplier', header: '供应商', render: x => <div className="mist-col" style={{ gap: 2 }}><TextLink onClick={() => onSupplier(x.quote.supplierId)}>{x.quote.supplier}</TextLink><small className="mist-muted">评级 {x.grade}</small></div> },
        { key: 'price', header: '单价', align: 'right', render: x => x.quote.declined ? <span className="mist-muted">谢绝：{x.quote.declineReason}</span> : <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span>{price(x.quote.price)} {x.quote.currency}</span><small className="mist-muted">{x.cnyUnit !== null && x.quote.currency !== 'CNY' ? `≈ ${price(x.cnyUnit)} CNY` : x.comparable ? '' : '缺汇率，未比价'}</small></div> },
        { key: 'terms', header: '交期 / 条件', render: x => x.quote.declined ? null : <div className="mist-col" style={{ gap: 2 }}><span className={x.late ? 'mist-tone-bad' : undefined}>{x.quote.promisedDue}{x.late ? '（晚于需求）' : ''}</span><small className={x.moqOver ? 'mist-tone-bad' : 'mist-muted'}>MOQ {x.quote.moq || '无'} · {x.quote.terms}</small><small className={x.valid ? 'mist-muted' : 'mist-tone-bad'}>有效至 {x.quote.validUntil}</small></div> },
        { key: 'rank', header: '排名', render: x => x.lowest ? <Pill tone="ok">最低价</Pill> : x.rank ? `第 ${x.rank}` : <span className="mist-muted">—</span> },
        ...(can && isOpen ? [{ key: 'act', header: '', align: 'right' as const, render: (x: RfqComparisonRow) => x.valid ? <Button size="sm" icon={Award} disabled={locked} aria-label={`定标 ${x.quote.supplier}`} onClick={() => onAward(x)}>定标</Button> : null }] : []),
      ]} /> : <span className="mist-note">还没有报价。</span>}
      {isOpen && pendingSuppliers.length > 0 && <span className="mist-note">待报价：{pendingSuppliers.join('、')}</span>}
    </DetailBlock>
    {history.length > 0 && <DetailBlock title={`历史报价 · ${history.length}`}><div className="mist-col">{history.map(q => <small key={q.id} className="mist-muted">{q.supplier} · {q.declined ? `谢绝：${q.declineReason}` : `${price(q.price)} ${q.currency} · 交期 ${q.promisedDue}`} · {shortWhen(q.at)}，{shortWhen(q.supersededAt!)} 更新</small>)}</div></DetailBlock>}
    <DetailBlock title="记录"><Events entity="procurement" id={r.id} /></DetailBlock>
  </DetailBody>;
}
