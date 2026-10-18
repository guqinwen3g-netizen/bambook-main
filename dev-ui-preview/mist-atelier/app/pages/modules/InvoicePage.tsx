/** Finance reads existing receivables; CI creation belongs to the source business, never this ledger. */
import { BaseDataImportButton } from './BaseDataImport';
import { AccessHiddenNotice } from '../AccessHiddenNotice';
import { MIST_FINANCE_WRITE_PERMISSIONS } from '../../../../../server/src/shared/mistFinancePermissions';
import React from 'react';
import { Download, RefreshCw, ArrowLeft, Receipt, Clock, FileText, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Banner, Button, Card, DataTable, EmptyState, Facts, MistPage, Mono, ObjectCell, PageHeader, Pill, SearchField, Segmented, Select, StatCard, StatGrid, Tabs, Toolbar, type Column } from '../../../../../components/mist';
import { isActiveMistInvoice, isPendingFinanceMistInvoice, type MistState, type MistInvoice } from '../../../../../server/src/shared/mistWorkspace';
import { CRM_COLLECTION_LEVEL_LABEL, CRM_METHOD_LABEL, invoiceCollectionStatus, type CrmCollectionLevel, type CrmFollowUp } from '../../../../../server/src/shared/mistCrm';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { financeCurrencyTotals } from '../FinanceWorkspace';
import { platformBusinessDate } from '../../../../../server/src/shared/mistPlatform';
import { supplierPayableSummary } from '../../../../../server/src/shared/mistPayables';
import { downloadModuleCsv, ModuleEditorDialog, type ModuleEditorSpec } from './ModuleWorkbench';
import { ActionBar, DetailBlock, todayIso } from './pageKit';
import { useRouteDraft, useRouteScope } from './useRouteDraft';
import { CustomerStatementCard } from './CustomerStatements';

type Age = 'unknown' | 'not-due' | '1-30' | '31-60' | '61-90' | '90+';
type Status = 'all' | 'pending' | 'open' | 'overdue' | 'settled' | 'void' | 'draft';
export type InvoiceLedgerRow = MistInvoice & { draft: boolean; note?: string; state: Exclude<Status, 'all' | 'overdue'> };
const labels = { pending: '待财务确认', open: '未结应收', settled: '已结清', void: '已作废', draft: '历史草稿' };
const ageLabels: Record<Age, string> = { unknown: '待核对账期', 'not-due': '未逾期', '1-30': '逾期 1–30 天', '31-60': '逾期 31–60 天', '61-90': '逾期 61–90 天', '90+': '逾期 90 天以上' };
const money = (amount: number, currency: string) => `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || '币种未确认'}`;
const validDay = (value: string) => { const ms = Date.parse(value + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value; };
export function invoiceAge(due: string, today = todayIso()): { days: number | null; group: Age } {
  if (!validDay(due) || !validDay(today)) return { days: null, group: 'unknown' };
  const days = Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000));
  return { days, group: days === 0 ? 'not-due' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+' };
}
export function invoiceLedgerRows(state: MistState | null): InvoiceLedgerRow[] {
  return [...(state?.invoices || []).map(i => ({ ...i, draft: false, state: (!isActiveMistInvoice(i) ? 'void' : isPendingFinanceMistInvoice(i) ? 'pending' : i.open > 0 ? 'open' : 'settled') as InvoiceLedgerRow['state'] })),
    ...(state?.platform?.invoiceDrafts || []).filter(d => d.state === 'Draft').map(d => { const order = state?.orders.find(o => o.id === d.orderId); return { id: d.id, code: '历史草稿', orderId: d.orderId, order: order?.code || '来源订单未找到', customer: order?.customer || '来源客户未找到', currency: order?.currency || '', due: d.due, amount: d.amount, open: 0, draft: true, note: d.note, state: 'draft' as const }; })];
}
export function invoiceSource(state: MistState | null, row: InvoiceLedgerRow) {
  if (row.devId) return { document: undefined, problem: '', label: '开发费用', devId: row.devId as string | undefined };
  if (row.opening) return { document: undefined, problem: '', label: '期初未结应收', devId: undefined as string | undefined };
  const docs = (state?.fulfillment?.documents || []).filter(d => d.type === 'CI' && d.invoiceId === row.id);
  const document = docs.length === 1 && docs[0].orderId === row.orderId ? docs[0] : undefined;
  return { document, problem: docs.length > 1 ? '存在多个 CI 关联，请核对准确来源，不能猜版本。' : docs.length === 1 && !document ? 'CI 与应收来源订单不一致，不能跳转到错误来源。' : '', label: document ? '出运 CI' : row.draft ? '历史独立草稿' : '历史应收（无准确 CI 关联）', devId: undefined as string | undefined };
}
export function invoiceFinancialFacts(state: MistState | null, row: InvoiceLedgerRow) {
  const allocations = (state?.allocations || []).filter(a => a.invoiceId === row.id), credits = (state?.platform?.creditApplications || []).filter(a => a.invoiceId === row.id);
  const sum = (rows: Array<{ amount: number; currency?: string }>) => rows.reduce((n, r) => n + Math.round(r.amount * 100), 0) / 100;
  const cash = sum(allocations.filter(a => a.currency === row.currency)), credit = sum(credits);
  return { allocations, credits, cash, credit, unexplained: row.draft || row.state === 'void' ? 0 : (Math.round(row.amount * 100) - Math.round(cash * 100) - Math.round(credit * 100) - Math.round(row.open * 100)) / 100 };
}
const PROMISE_LABEL = { pending: '待兑现', kept: '已兑现', broken: '承诺未兑现' } as const;
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export function invoiceCustomerId(state: MistState | null, row: Pick<MistInvoice, 'orderId' | 'devId' | 'customerId'>) { return row.customerId ? row.customerId : row.devId ? state?.devs.find(d => d.id === row.devId)?.customerId : state?.orders.find(o => o.id === row.orderId)?.customerId; }
/** 催收摘要（列表用）：已催次数与最近承诺。 */
export function collectionSummary(state: MistState | null, row: InvoiceLedgerRow, today: string) {
  if (!state || row.state !== 'open') return '';
  const c = invoiceCollectionStatus(state, row.id, today);
  return [c.count ? `已催 ${c.count} 次` : '', c.promise ? `承诺 ${c.promise.date} ${PROMISE_LABEL[c.promise.state]}` : ''].filter(Boolean).join(' · ');
}
export function InvoicePage() {
  const w = useMistWorkspace(), session = useMistSession(), { route, go } = useNav(), scope = useRouteScope();
  const rows = invoiceLedgerRows(w.state), [selected, setSelected] = React.useState(route.id || '');
  const [tab, setTab] = React.useState<'ar' | 'ap'>('ar'), [query, setQuery] = React.useState(''), [currency, setCurrency] = React.useState('all'), [status, setStatus] = React.useState<Status>('all'), [age, setAge] = React.useState<string>('all');
  const [fileError, setFileError] = useRouteDraft('');
  const [dialog, setDialog] = useRouteDraft<ModuleEditorSpec | null>(null);
  // CI 签发只形成待确认应收；确认 / 驳回由财务应收写权限执行，服务端同样校验。
  const canConfirm = session.hasPermission('invoices:write' as any);
  const workspaceId=w.workspace?.id||'',activeWorkspace=React.useRef(workspaceId);activeWorkspace.current=workspaceId;
  React.useEffect(()=>setFileError(''),[workspaceId]);
  React.useEffect(() => { setSelected(route.id || ''); if (route.id) setTab('ar'); }, [route.id, w.workspace?.id]);
  React.useEffect(() => { setTab(route.section === 'payables' ? 'ap' : 'ar'); if (route.section === 'open') setStatus('open'); else if (route.section === 'overdue') setStatus('overdue'); else if (route.section === 'pending') setStatus('pending'); else setStatus('all'); }, [route.section]);
  const currencies = [...new Set(rows.filter(r => r.currency).map(r => r.currency))].sort(), today = todayIso();
  const shown = rows.filter(r => { const a = invoiceAge(r.due, today), source = invoiceSource(w.state, r), order = w.state?.orders.find(o => o.id === r.orderId); return (!route.customerId || order?.customerId === route.customerId) && (currency === 'all' || r.currency === currency) && (status === 'all' || status === 'overdue' ? status !== 'overdue' || r.state === 'open' && (a.days || 0) > 0 : r.state === status) && (age === 'all' || r.state === 'open' && a.group === age) && (!query.trim() || `${r.code} ${r.order} ${r.customer} ${r.currency} ${source.document?.number || ''}`.toLowerCase().includes(query.trim().toLowerCase())); }).sort((a, b) => Number(a.state !== 'pending') - Number(b.state !== 'pending') || Number(a.state !== 'open') - Number(b.state !== 'open') || (a.due || '9999').localeCompare(b.due || '9999') || a.code.localeCompare(b.code));
  const current = rows.find(r => r.id === selected), missing = !!selected && !current && !w.loading;
  const pendingRows = rows.filter(r => r.state === 'pending'), open = rows.filter(r => r.state === 'open'), overdue = open.filter(r => (invoiceAge(r.due, today).days || 0) > 0), totals = financeCurrencyTotals(open.map(r => ({ currency: r.currency, amount: r.open }))), overdueTotals = financeCurrencyTotals(overdue.map(r => ({ currency: r.currency, amount: r.open })));
  const payableOpen = w.state ? supplierPayableSummary(w.state, platformBusinessDate(new Date())).filter(r => r.open > 0) : [];
  const payableTotals = financeCurrencyTotals(payableOpen.map(r => ({ currency: r.currency, amount: r.open })));
  const totalsText = (values: typeof totals) => values.map(t => money(t.amount, t.currency)).join(' · ') || '暂无未结金额';
  const listContext={...(route.section?{section:route.section}:{}),...(route.customerId?{customerId:route.customerId}:{})};
  const pick = (id: string) => { setSelected(id); go('invoices', id, listContext); }, back = () => { setSelected(''); go('invoices',undefined,listContext); };
  const columns: Column<InvoiceLedgerRow>[] = [
    { key: 'code', header: '票据 / 对方', width: 'minmax(180px,1.6fr)', render: r => <ObjectCell name={<Mono>{r.code}</Mono>} meta={r.customer} /> },
    { key: 'source', header: '来源', width: 'minmax(145px,1.2fr)', hideOnMobile: true, render: r => <ObjectCell name={<Mono>{r.order}</Mono>} meta={invoiceSource(w.state, r).label} /> },
    { key: 'amount', header: '原币票面', width: '145px', align: 'right', render: r => money(r.amount, r.currency) },
    { key: 'open', header: '未收余额', width: '145px', align: 'right', render: r => r.draft ? '未形成应收' : r.state === 'pending' ? '待财务确认' : money(r.open, r.currency) },
    { key: 'due', header: '到期 / 账龄 / 催收', width: '190px', hideOnMobile: true, render: r => <ObjectCell name={r.due || '未记录'} meta={r.state === 'open' ? [ageLabels[invoiceAge(r.due, today).group], collectionSummary(w.state, r, today)].filter(Boolean).join(' · ') : '—'} /> },
    { key: 'state', header: '状态', width: '105px', render: r => <Pill tone={r.state === 'void' ? 'bad' : r.state === 'settled' ? 'ok' : r.state === 'pending' ? 'accent' : r.state === 'open' && (invoiceAge(r.due, today).days || 0) > 0 ? 'warn' : 'neutral'}>{labels[r.state]}</Pill> },
  ];
  const exportRows = () => downloadModuleCsv('应收票据当前台账.csv', ['票据', '对方', '来源订单', '来源类型', '票面金额', '币种', '到账核销', '贷项抵扣', '未收余额', '到期', '账龄', '状态'], shown.map(r => { const f = invoiceFinancialFacts(w.state, r); return [r.code, r.customer, r.order, invoiceSource(w.state, r).label, r.amount, r.currency, r.draft ? '' : f.cash, r.draft ? '' : f.credit, r.draft ? '' : r.open, r.due, r.state === 'open' ? ageLabels[invoiceAge(r.due, today).group] : '', labels[r.state]]; }));
  const canInvoice = session.hasPermission('invoices:write' as any);
  const voidOpeningSpec = (row: InvoiceLedgerRow): ModuleEditorSpec => ({ title: '作废期初应收', submitLabel: '作废', description: `${row.code} · ${row.customer} · ${money(row.amount, row.currency)}。用于登记错误后作废重登；作废后不再计入应收余额。`,
    fields: [{ key: 'reason', label: '作废原因', type: 'textarea', required: true }], initialValues: { reason: '' },
    submit: v => w.run({ type: 'opening.receivable.void', payload: { invoiceId: row.id, reason: String(v.reason ?? '').trim() } }) });
  const rejectSpec = (row: InvoiceLedgerRow): ModuleEditorSpec => ({ title: '驳回 CI 应收', submitLabel: '驳回并退回更正', description: `${row.code} · ${money(row.amount, row.currency)}。驳回后本笔应收不入账，CI 退回后勤更正后重新签发。`,
    fields: [{ key: 'reason', label: '驳回原因', type: 'textarea', required: true }], initialValues: { reason: '' },
    submit: v => w.run({ type: 'finance.receivable.reject', payload: { invoiceId: row.id, reason: String(v.reason ?? '').trim() } }) });
  const canCollect = session.hasPermission('relations:write' as any), customerId = current ? invoiceCustomerId(w.state, current) : undefined;
  const collection = current && w.state ? invoiceCollectionStatus(w.state, current.id, today) : null;
  const collectionRows: CrmFollowUp[] = current ? (w.state?.crm?.followUps || []).filter(f => f.link?.kind === 'invoice' && f.link.id === current.id).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const collectSpec = (row: InvoiceLedgerRow): ModuleEditorSpec => { const days = invoiceAge(row.due, today).days || 0; return { title: `登记催收 · ${row.code}`, submitLabel: '保存催收', description: `${row.customer} · 未收 ${money(row.open, row.currency)}${days ? ` · 已逾期 ${days} 天` : ' · 未逾期'}。记录已发生的沟通；客户承诺付款时填写承诺日与金额，到期未兑现会在台账标出。`,
    fields: [{ key: 'level', label: '催收级别', type: 'select', required: true, options: ([1, 2, 3] as CrmCollectionLevel[]).map(l => ({ value: String(l), label: CRM_COLLECTION_LEVEL_LABEL[l] })) },
      { key: 'method', label: '方式', type: 'select', required: true, options: Object.entries(CRM_METHOD_LABEL).map(([value, label]) => ({ value, label })) },
      { key: 'at', label: '实际时间', type: 'datetime-local', required: true }, { key: 'content', label: '沟通内容', type: 'textarea', required: true },
      { key: 'promisedDate', label: '客户承诺付款日', type: 'date', hint: '无承诺留空' }, { key: 'promisedAmount', label: `承诺金额（${row.currency}）`, type: 'text', hint: '不超过当前未收' },
      { key: 'nextDate', label: '下次跟进日', type: 'date', hint: '填写后生成催收待办' }],
    initialValues: { level: days > 60 ? '3' : days > 0 ? '2' : '1', method: 'email', at: localNow(), content: '', promisedDate: '', promisedAmount: '', nextDate: '' },
    submit: v => w.run({ type: 'crm.followUp.save', payload: { customerId: customerId || '', method: String(v.method) as CrmFollowUp['method'], content: String(v.content ?? ''), at: new Date(String(v.at)).toISOString(), nextDate: String(v.nextDate ?? ''), link: { kind: 'invoice', id: row.id }, collection: { level: Number(v.level) as CrmCollectionLevel, promisedDate: String(v.promisedDate ?? ''), promisedAmount: String(v.promisedAmount ?? '').trim() } } }) }; };
  const source = current ? invoiceSource(w.state, current) : null, facts = current ? invoiceFinancialFacts(w.state, current) : null, document = source?.document;
  const order = w.state?.orders.find(o => o.id === current?.orderId), shipment = w.state?.fulfillment.shipments.find(s => s.id === document?.shipmentId);
  const events = (w.state?.events || []).filter(e => e.entityId === current?.id || !!document && e.entityId === document.id).sort((a, b) => b.at.localeCompare(a.at));
  return <MistPage>
    <PageHeader eyebrow="财务与成本 · 票据" title={current ? current.code : '发票管理'} description="财务查看来源票据与账款，不制作业务 CI / PL，也不以票款状态代替履约。" actions={current ? <Button icon={ArrowLeft} onClick={back}>返回发票台账</Button> : <>{tab === 'ar' && canInvoice && <BaseDataImportButton kind="openingReceivable" label="导入期初应收" disabled={w.loading} />}<Button icon={Download} disabled={tab !== 'ar' || w.loading} onClick={exportRows}>导出当前台账 CSV</Button><Button icon={RefreshCw} disabled={w.loading || w.saving} onClick={() => void w.refresh()}>刷新</Button></>} />
    {w.error && <Banner tone="bad" title="票据读取未完成" actions={<Button onClick={() => void w.refresh()}>重试</Button>}>{w.error}</Banner>}
    <AccessHiddenNotice keys={['receivables','receipts','payments']} />
    {!MIST_FINANCE_WRITE_PERMISSIONS.some(scope=>session.hasPermission(scope as any)) && <Banner title="财务结果只读">当前账号可查看授权范围内的票据与核销来源；资金登记和核销由财务处理。</Banner>}
    {missing && <Banner tone="warn" title="未找到指定票据" actions={<Button onClick={back}>返回台账</Button>}>当前空间中没有这个票据或历史草稿，未自动打开其他来源。</Banner>}
    {current && facts ? <div className="mist-col" data-module-detail>
      <Card><div className="mist-card-body mist-col"><Pill tone={current.state === 'void' ? 'bad' : current.state === 'settled' ? 'ok' : current.state === 'pending' ? 'accent' : 'neutral'}>{labels[current.state]}</Pill>
        {current.state === 'pending' && <Banner tone="warn" title="待财务确认">后勤签发 CI 后形成的应收尚未经财务确认：不计入应收余额、账龄、报表与催收，也不能登记收款核销。{canConfirm ? '' : '确认或驳回由财务处理。'}</Banner>}
        {current.state === 'pending' && canConfirm && <ActionBar actions={[{ label: '确认应收', icon: ShieldCheck, primary: true, onClick: () => void w.run({ type: 'finance.receivable.confirm', payload: { invoiceId: current.id } }) }, { label: '驳回 CI', onClick: () => setDialog(rejectSpec(current)) }]} />}
        {current.draft && <Banner tone="warn" title="历史独立草稿只读">旧财务入口形成的草稿未签发、未形成应收。保留金额与说明供核对；本页不再编辑或签发 CI，请回实际业务 / 后勤制单来源；上线前已开出的未结发票请用“导入期初应收”登记。</Banner>}
        {source?.problem && <Banner tone="warn" title="单据关联待核对">{source.problem}</Banner>}
        {facts.unexplained !== 0 && <Banner tone="warn" title="票款明细待核对">票面、已记录到账核销、贷项和当前余额存在 {money(facts.unexplained, current.currency)} 差异，不把它自动记成到账或折让。</Banner>}
        <Facts items={[{ label: '对方', value: current.customer }, { label: '准确来源', value: source?.label || '未找到' }, { label: '来源订单', value: current.order }, { label: '原币票面', value: money(current.amount, current.currency) }, { label: '实际到账核销', value: current.draft ? '未形成应收' : money(facts.cash, current.currency) }, { label: '贷项抵扣', value: current.draft ? '—' : money(facts.credit, current.currency) }, { label: '当前未收', value: current.draft ? '未形成应收' : money(current.open, current.currency) }, { label: '到期 / 账龄', value: `${current.due || '未记录'} · ${current.state === 'open' ? ageLabels[invoiceAge(current.due, today).group] : '不计当前未结账龄'}` }]} />
        <ActionBar actions={[{ label: '收款与核销', onClick: () => go('payment-vouchers', current.id), primary: true, reason: current.draft ? '历史草稿未形成应收' : current.state === 'pending' ? '应收待财务确认，确认前不能登记收款核销' : current.state === 'void' ? '已作废票据不可新增核销' : false }, source?.devId ? { label: '来源开发案', onClick: () => go('development/detail', source.devId) } : current.opening ? { label: '客户档案', onClick: () => go('crm', current.customerId, { customerId: current.customerId }), reason: !current.customerId && '未记录客户' } : { label: '来源订单', onClick: () => go('orders/detail', current.orderId), reason: !order && '准确来源订单不可见' }, { label: '来源 CI / 作废回程', onClick: () => go('document-center', document?.id), reason: !document && (source?.problem || '没有准确 CI 关联，不能从票据号猜来源') }, { label: '来源出运', onClick: () => go('shipments', shipment?.id), reason: !shipment && '没有准确出运关联' }]} />
        {current.opening && <DetailBlock title="期初登记"><Facts items={[{ label: '原票面金额', value: money(current.opening.originalAmount, current.currency) }, { label: '启用时未收', value: money(current.amount, current.currency) }, { label: '登记', value: `${current.opening.registeredBy} · ${current.opening.registeredAt.slice(0, 10)}` }, ...(current.opening.note ? [{ label: '备注', value: current.opening.note }] : [])]} />{current.state !== 'void' && canInvoice && <ActionBar actions={[{ label: '作废期初登记', onClick: () => setDialog(voidOpeningSpec(current)), reason: facts.allocations.length ? '已有收款核销，须先冲回核销' : facts.credits.length ? '已有贷项抵扣' : false }]} />}</DetailBlock>}
        {current.note && <DetailBlock title="历史草稿说明"><p className="mist-note">{current.note}</p></DetailBlock>}
        {(current.financeConfirmedAt || current.financeRejectedAt) && <DetailBlock title="财务确认"><Facts items={current.financeRejectedAt ? [{ label: '结果', value: '财务驳回' }, { label: '驳回时间', value: current.financeRejectedAt }, { label: '经办', value: current.financeRejectedBy || '未记录' }, { label: '驳回原因', value: current.financeRejectReason || '未记录' }] : [{ label: '结果', value: '已确认入账' }, { label: '确认时间', value: current.financeConfirmedAt || '未记录' }, { label: '确认人', value: current.financeConfirmedBy || '未记录' }]} />{current.financeRejectedAt && <span className="mist-note">CI 已退回后勤更正；更正后重新签发会形成新的待确认应收。</span>}</DetailBlock>}
        {current.voidedAt && <DetailBlock title="保留作废事实"><Facts items={[{ label: '作废时间', value: current.voidedAt }, { label: '经办', value: current.voidedBy || '未记录' }, { label: '依据', value: current.voidReason || '未记录' }]} /><span className="mist-note">原始票面金额保留，已作废应收不再纳入未结余额。</span></DetailBlock>}
      </div></Card>
      {document && <Card><div className="mist-card-body mist-col"><DetailBlock title="准确 CI 来源与原件"><Facts items={[{ label: 'CI 号', value: document.number }, { label: '单据状态', value: document.status === 'issued' ? '已签发' : document.status === 'void' ? '已作废' : '草稿' }, { label: '签发时间', value: document.issuedAt || '未记录' }, { label: '来源出运', value: shipment?.code || '来源出运未找到' }]} /><p className="mist-note">{document.content || '正文未记录'}</p>{fileError && <Banner tone="bad" title="原件读取失败">{fileError}</Banner>}<div className="mist-row mist-module-actions">{document.fileIds.map(id => { const file = w.state?.files.find(f => f.id === id); return file ? <Button key={id} onClick={() => { setFileError(''); void w.downloadFile(file).catch(e => { if (scope.isCurrent() && activeWorkspace.current===workspaceId) setFileError(e instanceof Error ? e.message : '原件读取失败'); }); }}>{file.name}</Button> : <span className="mist-note" key={id}>原件不可见：{id}</span>; })}</div><span className="mist-note">后勤签发 CI 形成待确认应收；财务确认后才计入应收余额，驳回则把 CI 退回后勤更正。</span></DetailBlock></div></Card>}
      <Card><div className="mist-card-body mist-col"><DetailBlock title="到账核销记录">{facts.allocations.length ? facts.allocations.map(a => { const receipt = w.state?.receipts.find(r => r.id === a.receiptId); return <div className="mist-col" key={a.id}><div className="mist-row mist-module-actions"><Mono>{receipt?.code || '来源到账未找到'}</Mono><span>{money(a.amount, a.currency)}</span><Button disabled={!receipt} onClick={() => go('payment-vouchers', a.receiptId, { section: 'records' })}>查看到账流水</Button></div><span className="mist-note">{a.createdAt} · {a.actor}{a.payerBasis ? ` · ${a.payerBasis}` : ''}</span></div>; }) : <EmptyState compact title="尚无到账核销" description="未结余额不是已收到银行款。" />}</DetailBlock></div></Card>
      <Card><div className="mist-card-body mist-col"><DetailBlock title="贷项抵扣记录">{facts.credits.length ? facts.credits.map(a => { const credit = w.state?.platform?.credits.find(c => c.id === a.creditId); return <div className="mist-col" key={a.id}><div className="mist-row mist-module-actions"><Mono>{credit?.code || '贷项来源未找到'}</Mono><span>{money(a.amount, current.currency)}</span><Button disabled={!credit || !w.state?.platform?.claims.some(c=>c.id===credit.claimId)} onClick={() => go('claims', credit?.claimId, {section:'credit:'+a.creditId})}>查看贷项来源案件</Button></div><span className="mist-note">{a.at} · {a.actor}</span></div>; }) : <EmptyState compact title="尚无贷项抵扣" description="贷项由已批准售后处置形成，不在财务票据页伪造折让。" />}</DetailBlock></div></Card>
      {current.state === 'open' || collectionRows.length ? <Card><div className="mist-card-body mist-col"><DetailBlock title={`催收记录${collection?.count ? ` · ${collection.count} 次` : ''}`}>
        {collection?.promise && <Banner tone={collection.promise.state === 'broken' ? 'bad' : collection.promise.state === 'kept' ? 'ok' : 'accent'} title={`客户承诺 ${collection.promise.date} 付 ${collection.promise.amount} ${collection.promise.currency} · ${PROMISE_LABEL[collection.promise.state]}`}>承诺之后已核销 {money(collection.promise.paidSince, collection.promise.currency)}。</Banner>}
        {collectionRows.length ? collectionRows.map(f => <div className="mist-col" key={f.id} style={{ gap: 2 }}><span className="mist-row" style={{ gap: 6, flexWrap: 'wrap' }}>{f.collection && <Pill tone={f.collection.level === 3 ? 'bad' : f.collection.level === 2 ? 'warn' : 'neutral'}>{CRM_COLLECTION_LEVEL_LABEL[f.collection.level]}</Pill>}<span>{CRM_METHOD_LABEL[f.method]}</span>{f.collection?.promisedDate && <Pill tone="accent">承诺 {f.collection.promisedDate} · {f.collection.promisedAmount} {f.collection.currency}</Pill>}{f.nextDate && <Pill tone="neutral">下次 {f.nextDate}</Pill>}</span><span style={{ whiteSpace: 'pre-wrap' }}>{f.content}</span><span className="mist-note">{f.at.slice(0, 16).replace('T', ' ')} · {f.actor}{f.collection ? ` · 登记时未收 ${money(f.collection.openAtLog, f.collection.currency)}` : ''}</span></div>) : <span className="mist-note">还没有催收记录。催收由客户负责业务员登记，财务可在此查看。</span>}
        {current.state === 'open' && <ActionBar actions={[{ label: '登记催收', onClick: () => setDialog(collectSpec(current)), reason: !canCollect ? '需要客户关系登记权限（业务员）' : !customerId ? '未找到来源客户，不能登记催收' : false }]} />}
      </DetailBlock></div></Card> : null}
      <Card><div className="mist-card-body mist-col"><DetailBlock title="票据与来源操作记录">{events.length ? events.map(e => <div className="mist-col" key={e.id}><span>{e.text}</span><span className="mist-note">{e.at} · {e.actor}</span></div>) : <span className="mist-note">暂无可读取的来源操作记录；不把它当作催收记录。</span>}</DetailBlock></div></Card>
    </div> : <>
      <StatGrid><StatCard icon={ShieldCheck} label="待财务确认" value={pendingRows.length} unit="笔" onClick={() => { setTab('ar'); setStatus('pending'); }} foot="CI 已签发，确认前不计应收" /><StatCard icon={Receipt} label="未结票据" value={open.length} unit="笔" onClick={() => { setTab('ar'); setStatus('open'); }} foot={totalsText(totals)} /><StatCard icon={Clock} label="逾期应收" value={overdue.length} unit="笔" onClick={() => { setTab('ar'); setStatus('overdue'); }} foot={totalsText(overdueTotals)} /><StatCard icon={FileText} label="历史草稿" value={rows.filter(r => r.draft).length} unit="笔" onClick={() => { setTab('ar'); setStatus('draft'); }} foot="未签发，不计应收余额" /><StatCard icon={ArrowUpRight} label="供应商应付" value={new Set(payableOpen.map(r => r.supplierId)).size} unit="家" foot={payableOpen.length ? `${totalsText(payableTotals)} · 在财务管理办理` : '暂无未付；在财务管理 › 应付待办办理'} onClick={() => setTab('ap')} /></StatGrid>
      <Tabs<'ar' | 'ap'> value={tab} onChange={value => { setTab(value); go('invoices', undefined, value === 'ap' ? { section: 'payables' } : {}); }} options={[{ value: 'ar', label: '应收票据', count: rows.length }, { value: 'ap', label: '供应商应付' }]} />
      {tab === 'ap' ? <div className="mist-col"><Banner title="供应商应付在「财务管理 › 应付待办」办理">供应商原票按已批采购 / 委外合同登记，付款分配、预付抵扣与索赔扣款都在应付台账；采购合同本身不是应付票据。</Banner><ActionBar actions={[{ label: '打开应付台账', primary: true, onClick: () => go('payment-vouchers', undefined, { section: 'payables' }) }, { label: '查看采购来源', onClick: () => go('procurement') }]} /></div> : <div className="mist-col">
        <Banner title="来源制单，财务核账">后勤签发 CI 后应收进入「待财务确认」，财务确认后才计入余额；本页不提供新建 / 签发商业发票入口。系统启用前已开出、仍未收回的客户发票，用「导入期初应收」逐笔登记。</Banner>
        <Toolbar><SearchField value={query} onChange={setQuery} placeholder="搜索票据、对方、来源订单或币种" /><Select aria-label="票据币种" value={currency} onChange={e => setCurrency(e.target.value)} options={[{ value: 'all', label: '全部币种' }, ...currencies.map(c => ({ value: c, label: c }))]} /><Select aria-label="票据账龄" value={age} onChange={e => setAge(e.target.value)} options={[{ value: 'all', label: '全部账龄' }, ...Object.entries(ageLabels).map(([value, label]) => ({ value, label }))]} /></Toolbar>
        <Segmented<Status> value={status} onChange={setStatus} options={[{ value: 'all', label: '全部' }, { value: 'pending', label: '待财务确认' }, { value: 'open', label: '未结' }, { value: 'overdue', label: '逾期' }, { value: 'settled', label: '已结清' }, { value: 'void', label: '已作废' }, { value: 'draft', label: '历史草稿' }]} />
        <Card><DataTable ariaLabel="应收票据台账" rows={shown} columns={columns} rowKey={r => r.id} loading={w.loading} onRowClick={r => pick(r.id)} empty={<EmptyState title={rows.length ? '没有符合条件的票据' : '暂无应收票据'} description={rows.length ? '调整筛选或清除条件查看原台账。' : '从实际业务或后勤的已签发 CI 进入，不由财务补造票据。'} action={rows.length ? <Button onClick={() => { setQuery(''); setCurrency('all'); setAge('all'); setStatus('all'); if (route.customerId) go('invoices'); }}>清除筛选</Button> : <Button onClick={() => go('document-center')}>查看来源单据</Button>} />} footer={<span>{shown.length} / {rows.length} 笔 · 金额按原币，历史草稿不计应收</span>} /></Card>
        <CustomerStatementCard customerId={route.customerId} />
      </div>}
    </>}
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </MistPage>;
}
