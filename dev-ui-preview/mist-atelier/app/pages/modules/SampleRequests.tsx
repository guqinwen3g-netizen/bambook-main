/** ord19 / ord18：客户索样申请。业务员提单，样品间据单从库存寄出，收费的申请寄出后开具样品费发票交财务确认。 */
import React from 'react';
import { Ban, Pencil, Plus, Receipt, Send } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Facts, Mono, ObjectCell, Pill, SearchField, Timeline, Toolbar, Pipeline, type Column } from '../../../../../components/mist';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import { readSampleRequests, sampleRequestSent, SAMPLE_REQUEST_STATE_LABEL, type MistSampleRequest } from '../../../../../server/src/shared/mistSampleRequests';
import { fulfillmentPositions } from '../../../../../server/src/shared/mistFulfillment';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { activeCustomers } from '../../runtime/activeCustomers';
import { CURRENCIES } from '../../runtime/tradeOptions';
import { SAMPLE_COUNT_UNITS, SAMPLE_MEASURED_UNITS } from '../../../../../server/src/shared/mistDevelopmentDomain';
const SAMPLE_UNITS = [...new Set([...SAMPLE_MEASURED_UNITS, ...SAMPLE_COUNT_UNITS.fabric, ...SAMPLE_COUNT_UNITS.garment])].map(u => ({ value: u, label: u }));
import { ModuleEditorDialog, moduleFileIds, type ModuleEditorSpec } from './ModuleWorkbench';
import { emptyOption, field, number, text, today, useEditor } from './fulfillmentKit';
import { useRouteDraft } from './useRouteDraft';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen } from './pageKit';
import { uiText, ui } from '../../../../../services/interfaceLanguage';

type Filter = 'all' | MistSampleRequest['state'];
const TONE = { open: 'warn', sent: 'ok', cancelled: 'neutral' } as const;

export function SampleRequests() {
  const { state, loading, run, saving, pending } = useMistWorkspace(), session = useMistSession(), { route, go } = useNav(), editor = useEditor();
  const [dialog, setDialog] = useRouteDraft<ModuleEditorSpec | null>(null);
  const [query, setQuery] = React.useState(''), [filter, setFilter] = React.useState<Filter>('open'), [drawer, setDrawer] = React.useState(false);
  const can = session.hasPermission('products:write'), room = can && session.hasPermission('sample:room:write'), canInvoice = session.hasPermission('invoices:write'), locked = saving || !!pending;
  const rows = state ? readSampleRequests(state) : [];
  const shown = rows.filter(r => (filter === 'all' || r.state === filter) && (!query || [r.code, r.customer, r.description, r.recipient].join(' ').toLowerCase().includes(query.toLowerCase())));
  const selected = rows.find(r => r.id === route.id) || shown[0];
  const count = (f: Filter) => rows.filter(r => f === 'all' || r.state === f).length;
  const pick = (r: MistSampleRequest) => { setDrawer(true); go('samples', r.id, { section: 'requests' }, { keepScroll: true }); };

  const saveSpec = (r?: MistSampleRequest): ModuleEditorSpec => ({ title: r ? `修改索样 ${r.code}` : '新建索样申请', submitLabel: r ? '保存' : '提交',
    sections: [{ id: 'sample', label: '样品', fields: ['customerId', 'orderId', 'description', 'quantity', 'unit', 'neededBy'] }, { id: 'ship', label: '寄送与收费', fields: ['recipient', 'address', 'feeAmount', 'feeCurrency', 'note'] }],
    fields: [field('customerId', '客户', 'select', true, [emptyOption, ...activeCustomers(state, r?.customerId).map(c => ({ value: c.id, label: c.name }))]),
      field('orderId', '关联订单', 'select', false, [emptyOption, ...(state?.orders || []).filter(o => !o.governance || !['cancelled', 'void'].includes(o.governance.status)).map(o => ({ value: o.id, label: `${o.code} · ${o.customer}` }))]),
      field('description', '样品要求', 'textarea'), { ...field('quantity', '数量', 'number'), min: 0.0001 }, field('unit', '单位', 'select', true, SAMPLE_UNITS),
      field('recipient', '收件人'), field('address', '寄送地址', 'textarea'), field('neededBy', '需要日期', 'date'),
      { ...field('feeAmount', '样品费', 'number', false), min: 0 }, field('feeCurrency', '样品费币种', 'select', false, CURRENCIES.map(c => ({ value: c.value, label: c.label }))), field('note', '备注', 'textarea', false)],
    initialValues: r ? { customerId: r.customerId, orderId: r.orderId || '', description: r.description, quantity: r.quantity, unit: r.unit, recipient: r.recipient, address: r.address, neededBy: r.neededBy, feeAmount: r.fee?.amount ?? '', feeCurrency: r.fee?.currency || 'USD', note: r.note }
      : { customerId: route.customerId || '', orderId: '', description: '', quantity: 1, unit: '份', recipient: '', address: '', neededBy: today(), feeAmount: '', feeCurrency: 'USD', note: '' },
    submit: async v => { const fee = Number(v.feeAmount) > 0; const saved = await run({ type: 'sample.request.save', payload: { ...(r ? { id: r.id } : {}), customerId: text(v, 'customerId'), ...(text(v, 'orderId') ? { orderId: text(v, 'orderId') } : {}), description: text(v, 'description'), quantity: number(v, 'quantity'), unit: text(v, 'unit'), recipient: text(v, 'recipient'), address: text(v, 'address'), neededBy: text(v, 'neededBy'), note: text(v, 'note'), ...(fee ? { feeAmount: number(v, 'feeAmount'), feeCurrency: text(v, 'feeCurrency') } : {}) } });
      const id = String(saved.result.id || ''); if (id) go('samples', id, { section: 'requests' }); } });
  const fulfillSpec = (r: MistSampleRequest, s: MistState): ModuleEditorSpec => {
    const left = Math.max(0, Math.round((r.quantity - sampleRequestSent(r)) * 10000) / 10000);
    const options = s.fulfillment.samples.filter(x => x.unit === r.unit && x.available > 0).map(x => ({ value: x.id, label: `${x.code} · ${x.name}${x.color ? ' · ' + x.color : ''} · 可用 ${x.available} ${x.unit}${fulfillmentPositions(x).length > 1 ? ' · 多个位置' : ''}` }));
    return { title: `据单寄出 ${r.code}`, submitLabel: '登记寄出',
      fields: [field('sampleId', '寄出样品', 'select', true, [emptyOption, ...options]), { ...field('quantity', `本次数量（${r.unit}）`, 'number'), min: 0.0001 }, field('carrier', '快递公司', 'text', false), field('trackingNo', '运单号', 'text', false), field('complete', '本次寄完', 'checkbox', false)],
      initialValues: { sampleId: '', quantity: left || r.quantity, carrier: '', trackingNo: '', complete: true },
      submit: async v => { await run({ type: 'sample.request.fulfill', payload: { id: r.id, sampleId: text(v, 'sampleId'), quantity: number(v, 'quantity'), carrier: text(v, 'carrier'), trackingNo: text(v, 'trackingNo'), complete: v.complete === true } }); go('samples', r.id, { section: 'requests' }); } };
  };
  const cancelSpec = (r: MistSampleRequest): ModuleEditorSpec => ({ title: `取消索样 ${r.code}`, submitLabel: '取消申请', submitVariant: 'danger', fields: [field('reason', '取消原因', 'textarea')], initialValues: { reason: '' },
    submit: v => run({ type: 'sample.request.cancel', payload: { id: r.id, reason: text(v, 'reason') } }) });
  const invoiceSpec = (r: MistSampleRequest): ModuleEditorSpec => ({ title: `开具样品费 · ${r.fee?.amount} ${r.fee?.currency}`, submitLabel: '开票',
    fields: [field('number', '发票编号'), field('due', '到期日', 'date'), field('files', '发票原件', 'files')], initialValues: { number: '', due: today(), files: '' },
    submit: v => run({ type: 'sample.request.invoice', payload: { id: r.id, number: text(v, 'number'), due: text(v, 'due'), fileIds: moduleFileIds(v.files) } }) });

  if (editor.spec) return editor.view;
  const columns: Column<MistSampleRequest>[] = [
    { key: 'code', header: '索样单', width: 'minmax(200px,1.6fr)', render: r => <ObjectCell name={r.customer} meta={<><Mono>{r.code}</Mono> · {r.description}</>} />, sortValue: r => r.code },
    { key: 'qty', header: '数量', width: '110px', align: 'right', render: r => `${sampleRequestSent(r)} / ${r.quantity} ${uiText(r.unit)}` },
    { key: 'due', header: '需要日期', width: '110px', hideOnMobile: true, render: r => <span className={r.state === 'open' && r.neededBy < today() ? 'mist-tone-bad' : undefined}>{r.neededBy}</span>, sortValue: r => r.neededBy },
    { key: 'state', header: '状态', width: '96px', render: r => <Pill tone={TONE[r.state]}>{uiText(SAMPLE_REQUEST_STATE_LABEL[r.state])}</Pill> },
  ];
  const detail = selected && state ? <DetailBody data-sample-request={selected.id} heading={<div><span className="mist-mono mist-muted">{selected.code}</span><div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{selected.customer}</div></div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={TONE[selected.state]}>{uiText(SAMPLE_REQUEST_STATE_LABEL[selected.state])}</Pill>{selected.fee && <Pill tone={selected.fee.invoiceId ? 'ok' : 'accent'}>{selected.fee.invoiceId ? ui`样品费已开票 ${selected.fee.invoiceCode || ''}` : ui`收样品费 ${selected.fee.amount} ${selected.fee.currency}`}</Pill>}</div>
    <ActionBar busy={locked} actions={[
      { label: '据单寄出', icon: Send, primary: true, onClick: () => setDialog(fulfillSpec(selected, state)), reason: room ? false : '需要样品间权限', hidden: selected.state !== 'open' },
      { label: '开具样品费', icon: Receipt, primary: true, onClick: () => setDialog(invoiceSpec(selected)), reason: canInvoice ? false : '需要开票权限', hidden: selected.state !== 'sent' || !selected.fee || !!selected.fee.invoiceId },
      { label: '修改', icon: Pencil, onClick: () => editor.open(saveSpec(selected)), hidden: !can || selected.state !== 'open' || !!selected.shipments.length },
      { label: '取消申请', icon: Ban, onClick: () => setDialog(cancelSpec(selected)), hidden: !can || selected.state !== 'open' || !!selected.shipments.length },
    ]} />
    <Facts items={[
      { label: '样品要求', value: selected.description }, { label: '数量', value: `${sampleRequestSent(selected)} / ${selected.quantity} ${selected.unit}` },
      { label: '收件人', value: selected.recipient }, { label: '寄送地址', value: selected.address }, { label: '需要日期', value: selected.neededBy },
      ...(selected.orderId ? [{ label: '关联订单', value: state.orders.find(o => o.id === selected.orderId)?.code || '—' }] : []),
      { label: '申请人', value: `${selected.requester} · ${shortWhen(selected.createdAt)}` },
    ]} />
    {selected.note && <p className="mist-sub">{selected.note}</p>}
    {selected.cancelled && <span className="mist-note">{selected.cancelled.actor} · {shortWhen(selected.cancelled.at)} · {selected.cancelled.reason}</span>}
    {!!selected.shipments.length && <DetailBlock title={uiText('寄出记录')}><Timeline events={selected.shipments.slice().reverse().map(s => ({ who: s.actor, when: shortWhen(s.at), text: `${s.sampleCode} · ${s.quantity} ${s.unit}${s.carrier ? ' · ' + s.carrier : ''}${s.trackingNo ? ' · ' + s.trackingNo : ''}` }))} /></DetailBlock>}
  </DetailBody> : <EmptyState title={uiText(loading ? '正在读取索样申请' : '选择一条索样申请')} compact />;

  return <>
    <Toolbar right={can ? <Button variant="primary" icon={Plus} disabled={locked} onClick={() => editor.open(saveSpec())}>{uiText('新建索样申请')}</Button> : undefined}>
      <SearchField value={query} onChange={setQuery} placeholder={uiText('搜索单号、客户、样品或收件人')} />
    </Toolbar>
    <Pipeline value={filter} onChange={value => setFilter(value as Filter)} items={[
      { value: 'open', label: '待寄出', count: count('open'), color: 'var(--mist-warn)' }, { value: 'sent', label: '已寄出', count: count('sent'), color: 'var(--mist-ok)' },
      { value: 'cancelled', label: '已取消', count: count('cancelled'), color: 'var(--mist-ink-3)' }, { value: 'all', label: '全部', count: count('all'), color: 'var(--mist-ink-2)' },
    ]} />
    <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected?.customer || '索样申请'} drawerSub={selected?.code}
      list={<Card><DataTable ariaLabel={uiText('索样申请')} loading={loading} rows={shown} rowKey={r => r.id} selectedKey={selected?.id} onRowClick={pick} columns={columns}
        empty={<EmptyState title={uiText(rows.length ? '没有符合条件的申请' : '还没有索样申请')} />} /></Card>}
      detail={detail} />
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </>;
}
