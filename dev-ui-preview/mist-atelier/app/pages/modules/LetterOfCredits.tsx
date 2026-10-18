/** 信用证台账（外贸与报关 · 信用证页签）：单证员按来证登记条款、修改书、交单与银行审单结果。系统按条款提示迟装 / 迟交单 / 过期 / 分批不符点，不代替银行审单。 */
import React from 'react';
import { Ban, FilePen, Landmark, Plus, SearchX, Send, Stamp } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, EmptyState, Facts, Mono, Pill, TextLink, type Column, type Tone } from '../../../../../components/mist';
import type { MistCommand, MistOrder, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { LC_RESULT_LABEL, LC_STATUS_LABEL, lcAlerts, lcAvailableMinor, lcStatus, readLetterOfCredits, type LcAmendField, type LcPresentationResult, type LcStatus, type MistLcPresentation, type MistLetterOfCredit } from '../../../../../server/src/shared/mistLetterOfCredit';
import { fmt } from '../../data';
import type { ModuleEditorSpec, ModuleValues } from './ModuleWorkbench';
import { emptyOption, Events, field, RecordFiles, text, today } from './fulfillmentKit';
import { ActionBar, DetailBlock, DetailBody, ListDetail, type ReasonedAction } from './pageKit';

const STATUS_TONE: Record<LcStatus, Tone> = { active: 'ok', expired: 'bad', drawn: 'neutral', cancelled: 'neutral' };
const RESULT_TONE: Record<LcPresentationResult, Tone> = { pending: 'accent', complying: 'ok', discrepant: 'warn', honoured: 'ok', refused: 'bad' };
const money = (n: number, currency: string) => `${fmt(n, 2)} ${currency}`;
const yes = (v: boolean) => v ? '允许' : '不允许';
const num = (v: ModuleValues, key: string) => text(v, key).trim();
const final = (p: MistLcPresentation) => p.result === 'honoured' || p.result === 'refused';

export function lcOrderDomain(state: MistState, lc: MistLetterOfCredit): MistOrder['type'] {
  return state.orders.find(o => lc.orderIds.includes(o.id))?.type || 'garment';
}

export function LetterOfCreditLedger({ state, domain, needle, can, locked, loading, open, run, onOrder, onShipment }: {
  state: MistState | undefined; domain: MistOrder['type']; needle: string; can: boolean; locked: boolean; loading: boolean;
  open: (spec: ModuleEditorSpec) => void; run: (command: MistCommand) => Promise<unknown>; onOrder: (order: MistOrder) => void; onShipment: (id: string) => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null), [drawer, setDrawer] = React.useState(false), day = today();
  const all = state ? readLetterOfCredits(state).filter(lc => lcOrderDomain(state, lc) === domain) : [];
  const rows = all.filter(lc => !needle || `${lc.code} ${lc.lcNo} ${lc.customer} ${lc.issuingBank} ${lc.advisingBank}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(lcStatus(a, day) !== 'active') - Number(lcStatus(b, day) !== 'active') || lcAlerts(b, day).length - lcAlerts(a, day).length || a.expiryDate.localeCompare(b.expiryDate));
  const selected = rows.find(lc => lc.id === picked) || all.find(lc => lc.id === picked);
  const lcOrders = (state?.orders || []).filter(o => o.type === domain && o.governance?.contract.paymentMethod === 'LC');

  const createSpec = (): ModuleEditorSpec => ({
    title: '登记信用证', submitLabel: '登记信用证', description: '按开证行经通知行转来的信用证正本逐项登记；一张信用证只能对应同一客户、同一币种、合同约定以信用证付款的订单。信用证正本登记后作为附件追加。',
    sections: [
      { id: 'lc', label: '来证', fields: ['lcNo', 'issuingBank', 'advisingBank', 'confirmed', 'availableBy', 'usanceDays'] },
      { id: 'orders', label: '对应订单', description: '勾选本信用证项下的订单。', fields: lcOrders.map(o => `order:${o.id}`) },
      { id: 'amount', label: '金额与日期', fields: ['currency', 'amount', 'tolerancePct', 'issueDate', 'latestShipmentDate', 'expiryDate', 'expiryPlace', 'presentationDays'] },
      { id: 'terms', label: '条款', fields: ['partialShipment', 'transhipment', 'documentsRequired', 'note'] },
    ],
    fields: [
      field('lcNo', '信用证号'), field('issuingBank', '开证行'), field('advisingBank', '通知行', 'text', false), { ...field('confirmed', '保兑信用证', 'checkbox', false), hint: '通知行或其他银行加具保兑时勾选。' },
      field('availableBy', '付款期限', 'select', true, [{ value: 'sight', label: '即期' }, { value: 'usance', label: '远期' }]), { ...field('usanceDays', '远期天数', 'number', false), hint: '远期信用证填写，如提单日后 60 天。' },
      ...lcOrders.map(o => field(`order:${o.id}`, `${o.code} · ${o.customer} · ${o.currency}`, 'checkbox', false)),
      field('currency', '币种'), field('amount', '信用证金额', 'number'), { ...field('tolerancePct', '溢短装 %', 'number', false), hint: '如 “+/-5%” 填 5；未写明填 0。' },
      field('issueDate', '开证日', 'date'), field('latestShipmentDate', '最晚装运日', 'date'), field('expiryDate', '有效期', 'date'), field('expiryPlace', '到期地点', 'text', false),
      { ...field('presentationDays', '交单期（装运后天数）', 'number', false), hint: '信用证未规定时按 UCP 600 为装运后 21 天，且不得晚于有效期。' },
      field('partialShipment', '允许分批装运', 'checkbox', false), field('transhipment', '允许转运', 'checkbox', false), field('documentsRequired', '单据要求（46A）', 'textarea', false), field('note', '备注', 'textarea', false),
    ],
    initialValues: { lcNo: '', issuingBank: '', advisingBank: '', confirmed: false, availableBy: 'sight', usanceDays: '', currency: lcOrders[0]?.currency || 'USD', amount: '', tolerancePct: '0', issueDate: day, latestShipmentDate: '', expiryDate: '', expiryPlace: '', presentationDays: '21', partialShipment: false, transhipment: false, documentsRequired: '', note: '', ...Object.fromEntries(lcOrders.map(o => [`order:${o.id}`, lcOrders.length === 1])) },
    submit: v => run({ type: 'lc.save', payload: { input: {
      lcNo: text(v, 'lcNo'), orderIds: lcOrders.filter(o => v[`order:${o.id}`] === true).map(o => o.id), issuingBank: text(v, 'issuingBank'), advisingBank: text(v, 'advisingBank'), confirmed: v.confirmed === true,
      availableBy: text(v, 'availableBy') as 'sight' | 'usance', usanceDays: num(v, 'usanceDays') ? Number(num(v, 'usanceDays')) : undefined, currency: text(v, 'currency'), amount: num(v, 'amount'), tolerancePct: num(v, 'tolerancePct'),
      issueDate: text(v, 'issueDate'), latestShipmentDate: text(v, 'latestShipmentDate'), expiryDate: text(v, 'expiryDate'), expiryPlace: text(v, 'expiryPlace'), presentationDays: num(v, 'presentationDays'),
      partialShipment: v.partialShipment === true, transhipment: v.transhipment === true, documentsRequired: text(v, 'documentsRequired'), note: text(v, 'note'),
    } } }) });
  const amendSpec = (lc: MistLetterOfCredit): ModuleEditorSpec => ({
    title: '登记修改书', submitLabel: '登记修改', description: `${lc.lcNo} · 只登记受益人已接受的修改书；改动的条款会连同原条款记入修改记录。`,
    fields: [field('date', '修改书日期', 'date'), field('amount', `金额（${lc.currency}）`, 'number'), field('tolerancePct', '溢短装 %', 'number'), field('latestShipmentDate', '最晚装运日', 'date'), field('expiryDate', '有效期', 'date'), field('presentationDays', '交单期（天）', 'number'), field('partialShipment', '允许分批装运', 'checkbox', false), field('transhipment', '允许转运', 'checkbox', false), field('documentsRequired', '单据要求', 'textarea', false), field('note', '修改说明', 'textarea', false)],
    initialValues: { date: day, amount: String(lc.amount), tolerancePct: String(lc.tolerancePct), latestShipmentDate: lc.latestShipmentDate, expiryDate: lc.expiryDate, presentationDays: String(lc.presentationDays), partialShipment: lc.partialShipment, transhipment: lc.transhipment, documentsRequired: lc.documentsRequired, note: '' },
    submit: v => {
      const changes: Partial<Record<LcAmendField, unknown>> = {};
      if (Number(num(v, 'amount')) !== lc.amount) changes.amount = num(v, 'amount');
      if (Number(num(v, 'tolerancePct')) !== lc.tolerancePct) changes.tolerancePct = num(v, 'tolerancePct');
      if (text(v, 'latestShipmentDate') !== lc.latestShipmentDate) changes.latestShipmentDate = text(v, 'latestShipmentDate');
      if (text(v, 'expiryDate') !== lc.expiryDate) changes.expiryDate = text(v, 'expiryDate');
      if (Number(num(v, 'presentationDays')) !== lc.presentationDays) changes.presentationDays = num(v, 'presentationDays');
      if ((v.partialShipment === true) !== lc.partialShipment) changes.partialShipment = v.partialShipment === true;
      if ((v.transhipment === true) !== lc.transhipment) changes.transhipment = v.transhipment === true;
      if (text(v, 'documentsRequired').trim() !== lc.documentsRequired) changes.documentsRequired = text(v, 'documentsRequired');
      return run({ type: 'lc.amend', payload: { id: lc.id, date: text(v, 'date'), changes, note: text(v, 'note') } });
    } });
  const presentable = (lc: MistLetterOfCredit) => (state?.fulfillment.shipments || []).filter(s => s.state !== 'cancelled' && s.lines.some(l => lc.orderIds.includes(l.orderId)) && !lc.presentations.some(p => p.shipmentId === s.id && p.result !== 'refused'));
  const presentSpec = (lc: MistLetterOfCredit): ModuleEditorSpec => ({
    title: '登记交单', submitLabel: '登记交单', description: `${lc.lcNo} · 可用余额 ${money(lcAvailableMinor(lc) / 100, lc.currency)}。系统按条款列出迟装、迟交单、过期与分批不符点，银行审单结论以银行通知为准。`,
    fields: [field('shipmentId', '出运', 'select', true, [emptyOption, ...presentable(lc).map(s => ({ value: s.id, label: `${s.code} · ${s.portOfLoading} → ${s.portOfDischarge}` }))]), { ...field('shipmentDate', '装运日（运输单据日）', 'date'), hint: '以提单 / 空运单上的装船或签发日期为准。' }, field('presentedAt', '交单日', 'date'), field('amount', `交单金额（${lc.currency}）`, 'number'), field('documents', '提交单据', 'textarea'), field('discrepancies', '已知不符点', 'textarea', false)],
    initialValues: { shipmentId: '', shipmentDate: day, presentedAt: day, amount: '', documents: lc.documentsRequired, discrepancies: '' },
    submit: v => run({ type: 'lc.present', payload: { id: lc.id, shipmentId: text(v, 'shipmentId'), shipmentDate: text(v, 'shipmentDate'), presentedAt: text(v, 'presentedAt'), amount: num(v, 'amount'), documents: text(v, 'documents'), discrepancies: text(v, 'discrepancies') } }) });
  const resultSpec = (lc: MistLetterOfCredit, p: MistLcPresentation): ModuleEditorSpec => ({
    title: `登记第 ${p.no} 次交单审单结果`, submitLabel: '登记结果', description: `${p.shipmentCode} · ${money(p.amount, lc.currency)} · 交单日 ${p.presentedAt}。承付或拒付登记后不能再改；承付款到账由财务按银行流水核销。`,
    fields: [field('result', '银行结论', 'select', true, (['complying', 'discrepant', 'honoured', 'refused'] as const).map(value => ({ value, label: LC_RESULT_LABEL[value] }))), field('date', '银行通知日', 'date'), { ...field('discrepancies', '不符点', 'textarea', false), hint: '银行提出不符点时逐条填写。' }, { ...field('honouredAmount', `承付金额（${lc.currency}）`, 'number', false), hint: '承付时填写；扣不符点费等时填实际承付金额，留空按交单金额。' }, { ...field('note', '说明', 'textarea', false), hint: '拒付须写明银行拒付理由。' }],
    initialValues: { result: p.result === 'pending' ? 'complying' : 'honoured', date: day, discrepancies: p.discrepancies, honouredAmount: '', note: '' },
    submit: v => run({ type: 'lc.presentation.result', payload: { id: lc.id, presentationId: p.id, result: text(v, 'result') as Exclude<LcPresentationResult, 'pending'>, date: text(v, 'date'), discrepancies: text(v, 'discrepancies'), honouredAmount: num(v, 'honouredAmount'), note: text(v, 'note') } }) });
  const cancelSpec = (lc: MistLetterOfCredit): ModuleEditorSpec => ({
    title: '注销信用证', submitLabel: '注销', description: `${lc.lcNo} · 注销后不能再修改或交单；已承付记录保留。`,
    fields: [field('date', '注销日', 'date'), field('reason', '注销原因', 'textarea')], initialValues: { date: day, reason: '' },
    submit: v => run({ type: 'lc.cancel', payload: { id: lc.id, date: text(v, 'date'), reason: text(v, 'reason') } }) });

  const columns: Column<MistLetterOfCredit>[] = [
    { key: 'lc', header: '信用证', width: 'minmax(160px,1.4fr)', render: lc => <div className="mist-col" style={{ gap: 2 }}><Mono>{lc.lcNo}</Mono><small className="mist-muted">{lc.code} · {lc.issuingBank}</small></div> },
    { key: 'customer', header: '客户 / 订单', width: 'minmax(150px,1.3fr)', hideOnMobile: true, render: lc => <div className="mist-col" style={{ gap: 2 }}><span>{lc.customer}</span><small className="mist-muted">{lc.orderIds.map(id => state?.orders.find(o => o.id === id)?.code || id).join('、')}</small></div> },
    { key: 'amount', header: '金额 / 可用', width: 'minmax(140px,1.2fr)', align: 'right', render: lc => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span>{money(lc.amount, lc.currency)}{lc.tolerancePct ? ` ±${lc.tolerancePct}%` : ''}</span><small className="mist-muted">可用 {money(lcAvailableMinor(lc) / 100, lc.currency)}</small></div> },
    { key: 'dates', header: '最晚装运 / 有效期', width: '140px', hideOnMobile: true, render: lc => <div className="mist-col" style={{ gap: 2 }}><span>{lc.latestShipmentDate}</span><small className="mist-muted">有效至 {lc.expiryDate}</small></div> },
    { key: 'status', header: '状态', width: 'minmax(130px,1.2fr)', render: lc => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={STATUS_TONE[lcStatus(lc, day)]}>{LC_STATUS_LABEL[lcStatus(lc, day)]}</Pill>{lcAlerts(lc, day).map(a => <small key={a} className="mist-tone-bad">{a}</small>)}</div> },
  ];
  const detail = selected && state ? <LcDetail lc={selected} state={state} day={day} can={can} locked={locked} run={run} onShipment={onShipment}
      onAmend={() => open(amendSpec(selected))} onPresent={() => open(presentSpec(selected))} onResult={p => open(resultSpec(selected, p))} onCancel={() => open(cancelSpec(selected))} presentable={presentable(selected).length} />
    : <EmptyState icon={Landmark} title="信用证详情" description="从列表选择一张信用证，查看条款、修改记录与交单" compact />;
  const covered = (o: MistOrder) => all.filter(lc => !lc.cancelled && lc.orderIds.includes(o.id));
  const missing = lcOrders.filter(o => !covered(o).length && o.governance?.status === 'approved');

  return <>
    {missing.length > 0 && <div className="mist-section"><Banner tone="warn" title={`${missing.length} 张已审批的信用证付款订单尚未登记来证`}>{missing.map(o => o.code).join('、')}。收到通知行转来的信用证后请登记，核对金额、最晚装运日与有效期是否满足合同交期。</Banner></div>}
    <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected ? `${selected.lcNo} · ${selected.customer}` : '信用证详情'} drawerSub={selected ? LC_STATUS_LABEL[lcStatus(selected, day)] : undefined}
      list={<Card>
        <CardHeader title={`信用证台账 · ${all.length}`} sub="按来证登记条款，修改书、交单与银行审单结果逐次记录。" tools={can ? <Button variant="primary" icon={Plus} disabled={locked || !lcOrders.length} title={lcOrders.length ? undefined : '没有合同约定以信用证付款的订单'} onClick={() => open(createSpec())}>登记信用证</Button> : undefined} />
        <DataTable ariaLabel="信用证台账" loading={loading} rows={rows} rowKey={lc => lc.id} selectedKey={selected?.id} density="comfy" onRowClick={lc => { setPicked(lc.id); setDrawer(true); }} columns={columns}
          empty={needle && all.length ? <EmptyState icon={SearchX} title="没有符合条件的信用证" description="换个关键词试试。" /> : <EmptyState icon={Landmark} title={`还没有登记${domain === 'fabric' ? '面料' : '成衣'}信用证`} description="收到通知行转来的信用证后，由单证员按正本登记条款。" />} />
      </Card>}
      detail={detail} />
    <ExportedOrders orders={lcOrders} covered={covered} onOrder={onOrder} />
  </>;
}

function ExportedOrders({ orders, covered, onOrder }: { orders: MistOrder[]; covered: (o: MistOrder) => MistLetterOfCredit[]; onOrder: (o: MistOrder) => void }) {
  if (!orders.length) return null;
  return <div className="mist-section"><Card>
    <CardHeader title="信用证付款订单" sub="合同约定以信用证付款的订单与已登记来证。" />
    <DataTable ariaLabel="信用证付款订单" rows={orders} rowKey={o => o.id} onRowClick={onOrder} columns={[
      { key: 'order', header: '订单', width: 'minmax(150px,1.2fr)', render: o => <div className="mist-col" style={{ gap: 2 }}><Mono>{o.code}</Mono><small className="mist-muted">{o.customer}</small></div> },
      { key: 'note', header: '合同付款约定', width: 'minmax(160px,1.6fr)', hideOnMobile: true, render: o => o.governance?.contract.paymentNote || <span className="mist-muted">合同未写明信用证条款</span> },
      { key: 'due', header: '订单交期', width: '110px', hideOnMobile: true, render: o => o.due || '未定' },
      { key: 'lc', header: '来证', width: 'minmax(140px,1.2fr)', render: o => { const list = covered(o); return list.length ? list.map(lc => lc.lcNo).join('、') : <span className="mist-tone-bad">未登记来证</span>; } },
    ]} />
  </Card></div>;
}

function LcDetail({ lc, state, day, can, locked, run, presentable, onShipment, onAmend, onPresent, onResult, onCancel }: {
  lc: MistLetterOfCredit; state: MistState; day: string; can: boolean; locked: boolean; run: (command: MistCommand) => Promise<unknown>; presentable: number;
  onShipment: (id: string) => void; onAmend: () => void; onPresent: () => void; onResult: (p: MistLcPresentation) => void; onCancel: () => void;
}) {
  const status = lcStatus(lc, day), alerts = lcAlerts(lc, day), available = lcAvailableMinor(lc) / 100, cancelled = !!lc.cancelled;
  const openPresentations = lc.presentations.some(p => !final(p));
  return <DetailBody data-lc-detail={lc.id} heading={<div><span className="mist-mono mist-muted">{lc.code}</span><div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{lc.lcNo}</div></div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={STATUS_TONE[status]}>{LC_STATUS_LABEL[status]}</Pill><Pill>{lc.availableBy === 'sight' ? '即期' : `远期 ${lc.usanceDays} 天`}</Pill>{lc.confirmed && <Pill tone="accent">保兑</Pill>}</div>
    {alerts.length > 0 && <Banner tone="warn" title="需要关注">{alerts.join('；')}</Banner>}
    {lc.cancelled && <Banner tone="neutral" title={`已于 ${lc.cancelled.date} 注销`}>{lc.cancelled.reason}</Banner>}
    {can && <ActionBar busy={locked} actions={[
      { label: '登记交单', icon: Send, onClick: onPresent, primary: true, reason: cancelled ? '信用证已注销' : available <= 0 ? '可用余额为零' : !presentable ? '没有可交单的出运（须含本信用证订单且尚未交单）' : false },
      { label: '登记修改书', icon: FilePen, onClick: onAmend, reason: cancelled ? '信用证已注销' : false },
      { label: '注销信用证', icon: Ban, onClick: onCancel, reason: cancelled ? '信用证已注销' : openPresentations ? '还有未承付或未拒付的交单' : false, hidden: cancelled },
    ] as ReasonedAction[]} />}
    <Facts items={[
      { label: '客户', value: lc.customer },
      { label: '对应订单', value: lc.orderIds.map(id => state.orders.find(o => o.id === id)?.code || id).join('、') },
      { label: '开证行', value: lc.issuingBank },
      { label: '通知行', value: lc.advisingBank || '未填写' },
      { label: '金额', value: `${money(lc.amount, lc.currency)}${lc.tolerancePct ? `（±${lc.tolerancePct}%）` : ''}` },
      { label: '可用余额', value: money(available, lc.currency) },
      { label: '开证日', value: lc.issueDate },
      { label: '最晚装运日', value: lc.latestShipmentDate },
      { label: '有效期', value: `${lc.expiryDate}${lc.expiryPlace ? ` · ${lc.expiryPlace}` : ''}` },
      { label: '交单期', value: `装运后 ${lc.presentationDays} 天内，且在有效期内` },
      { label: '分批装运', value: yes(lc.partialShipment) },
      { label: '转运', value: yes(lc.transhipment) },
    ]} />
    {lc.documentsRequired && <p className="mist-sub" style={{ whiteSpace: 'pre-wrap' }}>单据要求：{lc.documentsRequired}</p>}
    {lc.note && <p className="mist-sub">备注：{lc.note}</p>}
    <DetailBlock title={`交单 · ${lc.presentations.length}`}>
      {lc.presentations.length ? <DataTable ariaLabel={`${lc.lcNo} 交单记录`} rows={[...lc.presentations].reverse()} rowKey={p => p.id} columns={[
        { key: 'no', header: '交单', render: p => <div className="mist-col" style={{ gap: 2 }}><TextLink onClick={() => onShipment(p.shipmentId)}>第 {p.no} 次 · {p.shipmentCode}</TextLink><small className="mist-muted">装运 {p.shipmentDate} · 交单 {p.presentedAt}（截止 {p.deadline}）</small></div> },
        { key: 'amount', header: '金额', align: 'right', render: p => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span>{money(p.amount, lc.currency)}</span>{p.honouredAmount !== undefined && <small className="mist-muted">承付 {money(p.honouredAmount, lc.currency)}</small>}</div> },
        { key: 'result', header: '结果', render: p => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={RESULT_TONE[p.result]}>{LC_RESULT_LABEL[p.result]}</Pill>{p.autoDiscrepancies.map(d => <small key={d} className="mist-tone-bad">{d}</small>)}{p.discrepancies && <small className="mist-muted">不符点：{p.discrepancies}</small>}{p.resultNote && <small className="mist-muted">{p.resultNote}</small>}</div> },
        ...(can ? [{ key: 'act', header: '', align: 'right' as const, render: (p: MistLcPresentation) => final(p) ? null : <Button size="sm" icon={Stamp} disabled={locked} aria-label={`登记第 ${p.no} 次交单审单结果`} onClick={() => onResult(p)}>审单结果</Button> }] : []),
      ]} /> : <span className="mist-note">尚未交单。出运装船后，按信用证要求备齐单据在交单期内向银行交单。</span>}
    </DetailBlock>
    <DetailBlock title={`修改记录 · ${lc.amendments.length}`}>
      {lc.amendments.length ? <div className="mist-col">{[...lc.amendments].reverse().map(a => <div key={a.no} className="mist-col" style={{ gap: 2 }}><span>第 {a.no} 次修改 · {a.date}</span>{a.changes.map(ch => <small key={ch.field} className="mist-muted">{ch.label}：{ch.from} → {ch.to}</small>)}{a.note && <small className="mist-muted">{a.note}</small>}</div>)}</div> : <span className="mist-note">没有修改书。</span>}
    </DetailBlock>
    <DetailBlock title="附件"><RecordFiles key={lc.id} ids={lc.fileIds} onAttach={can ? ids => run({ type: 'lc.files', payload: { id: lc.id, fileIds: ids } }) : undefined} />{!lc.fileIds.length && <span className="mist-note">信用证正本、修改书与银行通知作为附件保存，只能追加。</span>}</DetailBlock>
    <DetailBlock title="记录"><Events entity="customs" id={lc.id} /></DetailBlock>
  </DetailBody>;
}
