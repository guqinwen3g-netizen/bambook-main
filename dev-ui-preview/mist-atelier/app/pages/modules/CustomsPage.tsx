import {ReplacementExportReviewBlock} from './ReplacementExportReviewBlock';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 外贸与报关：后勤单证按出运登记外部申报与放行事实（本系统不代替海关 / 单一窗口申报）；退税由财务按退税率版本配单申报、登记核准与到账勾稽；信用证由单证员按来证登记条款、修改书、交单与银行审单结果。 */
import React from 'react';
import { Download, FileText, Pencil, Plus, Receipt, SearchX, Stamp } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Checklist, DataTable, Dropdown, EmptyState, Facts, MistPage, Mono, PageHeader, Pill, Pipeline, SearchField, Segmented, Tabs, TextLink, Toolbar, type Column, type Tone } from '../../../../../components/mist';
import type { MistCommand, MistInvoice, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { isRecognizedMistInvoice } from '../../../../../server/src/shared/mistWorkspace';
import type { FulfillmentCustoms, FulfillmentShipment } from '../../../../../server/src/shared/mistFulfillment';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { fmt } from '../../data';
import { ModuleEditorDialog, type ModuleEditorSpec } from './ModuleWorkbench';
import { emptyOption, Events, exportRecords, field, RecordFiles, SourceLink, text, today } from './fulfillmentKit';
import { useRouteDraft } from './useRouteDraft';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen, type ReasonedAction } from './pageKit';
import { CustomsClassificationLedger, CustomsItemsBlock } from './CustomsDeclarationPanel';
import { readCustomsClassifications } from '../../../../../server/src/shared/mistCustomsDeclaration';
import { REBATE_TONE, RebateClaimBlock, RebateRatesCard, rebateSummary } from './RebatePanel';
import { REBATE_STATE_LABEL } from '../../../../../server/src/shared/mistExportRebate';
import { LetterOfCreditLedger, lcOrderDomain } from './LetterOfCredits';
import { readLetterOfCredits } from '../../../../../server/src/shared/mistLetterOfCredit';
import { MODE_LABEL, packedFor, packingMatched, shipmentStage, STAGE_LABEL, STAGE_TONE } from './ShipmentsPage';

type Tab = 'declarations' | 'lc' | 'rebate' | 'hs';
type Domain = FulfillmentShipment['domain'];
type CustomsStatus = FulfillmentCustoms['status'];
type StatusFilter = 'all' | CustomsStatus;
type FlagKey = 'awaiting' | 'unpacked' | 'packing' | 'cancelled';
type FlagFilter = 'all' | 'attention' | 'awaiting' | 'packing';
export const CUSTOMS_LABEL: Record<CustomsStatus, string> = { draft: '未申报', submitted: '已申报', cleared: '已放行' };
const CUSTOMS_TONE: Record<CustomsStatus, Tone> = { draft: 'warn', submitted: 'accent', cleared: 'ok' };
const round = (value: number) => Math.round(value * 10000) / 10000;
const isOpenShipment = (s: FulfillmentShipment) => s.state === 'preparing' || s.state === 'ready';

/** Reminders derived only from the shipment, packing and departure facts already recorded for the declaration. */
export function customsFlags(root: MistState, c: FulfillmentCustoms) {
  const s = root.fulfillment.shipments.find(row => row.id === c.shipmentId), flags: Array<{ key: FlagKey; label: string }> = [];
  if (!s || c.status === 'cleared') return flags;
  if (s.state === 'cancelled') return [{ key: 'cancelled', label: '出运已取消' }];
  if (s.state === 'ready' && s.documentsSentAt) flags.push({ key: 'awaiting', label: '离港等待放行' });
  if (isOpenShipment(s)) {
    if (!root.fulfillment.packing.some(row => row.shipmentId === s.id)) flags.push({ key: 'unpacked', label: '尚未装箱' });
    else if (!packingMatched(root, s)) flags.push({ key: 'packing', label: '装箱与计划不符' });
  }
  return flags;
}

/** Export-rebate evidence: customs release, collection of this shipment's issued CI receivables, and VAT special invoices matched or available for matching. */
export function rebateEvidence(root: MistState, c: FulfillmentCustoms) {
  const cis = root.fulfillment.documents.filter(d => d.shipmentId === c.shipmentId && d.type === 'CI' && d.status === 'issued');
  const invoices = cis.flatMap(d => { const invoice = d.invoiceId ? root.invoices.find(row => row.id === d.invoiceId) : undefined; return invoice && isRecognizedMistInvoice(invoice) ? [invoice] : []; });
  const open = new Map<string, number>();
  for (const invoice of invoices) if (invoice.open > 0) open.set(invoice.currency, round((open.get(invoice.currency) || 0) + invoice.open));
  const released = c.status === 'cleared';
  const replacement=!!c.replacementReviews?.length||root.fulfillment.shipments.find(s=>s.id===c.shipmentId)?.lines.some(line=>root.orders.find(o=>o.id===line.orderId)?.replacementSource)===true;
  const collected = invoices.length > 0 && invoices.length === cis.length && open.size === 0;
  const vat = rebateSummary(root, c);
  return { replacement,released, cis, invoices, open: [...open].map(([currency, amount]) => ({ currency, amount })), collected, vat, ready: Number(released) + Number(collected) + Number(vat.vatReady) };
}
const openText = (open: Array<{ currency: string; amount: number }>) => open.map(row => `${row.currency} ${fmt(row.amount, 2)}`).join(' / ');

export function CustomsPage() {
  const { state, run, error, refresh, loading, saving, pending } = useMistWorkspace(), session = useMistSession(), { go, route } = useNav();
  const can = session.hasPermission('customs:write'), canClear = session.hasPermission('customs:clear'), canInvoices = session.hasPermission('invoices:read');
  const canRebate = session.hasPermission('invoices:write'), canReconcile = session.hasPermission('invoices:reconcile');
  const [dialog, setDialog] = useRouteDraft<ModuleEditorSpec | null>(null);
  const [tabChoice, setTab] = React.useState<Tab>('declarations'), [domainChoice, setDomainChoice] = React.useState<Domain | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all'), [flagFilter, setFlagFilter] = React.useState<FlagFilter>('all'), [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(route.id || null), [drawer, setDrawer] = React.useState(!!route.id), [allPending, setAllPending] = React.useState(false);
  React.useEffect(() => { if (route.id) { setPicked(route.id); setDrawer(true); setDomainChoice(null); } }, [route.id]);
  const f = state?.fulfillment, day = today(), locked = saving || !!pending;
  const shipmentOf = (c: FulfillmentCustoms) => f?.shipments.find(s => s.id === c.shipmentId);
  const contextShipment = route.section ? f?.shipments.find(s => s.id === route.section) : undefined;
  const hasContext = !!route.section, invalidContext = hasContext && !!state && !contextShipment;
  const records = (f?.customs || []).filter(c => !hasContext || c.shipmentId === route.section);
  const routed = records.find(c => c.id === route.id);
  const lcAll = state ? readLetterOfCredits(state).map(lc => ({ type: lcOrderDomain(state, lc) })) : [];
  const hsAll = state ? readCustomsClassifications(state).filter(c => !c.voided) : [];
  const domainOf = (c: FulfillmentCustoms): Domain => shipmentOf(c)?.domain || 'garment';
  const domain: Domain = domainChoice || (routed ? domainOf(routed) : undefined) || contextShipment?.domain || (records.some(c => domainOf(c) === 'garment') || !records.some(c => domainOf(c) === 'fabric') ? 'garment' : 'fabric');
  const tab: Tab = hasContext ? (tabChoice==='hs'?'hs':'declarations') : tabChoice === 'lc' || tabChoice === 'hs' || !routed ? tabChoice : routed.status === 'draft' ? 'declarations' : tabChoice;
  const inDomain = hasContext ? records : records.filter(c => domainOf(c) === domain);
  const needle = query.trim().toLowerCase();
  const matches = (c: FulfillmentCustoms) => { const s = shipmentOf(c); return !needle || `${c.code} ${c.declarationNo} ${c.broker} ${c.hsCode} ${c.tradeMode} ${s?.code || ''} ${s?.customer || ''} ${s?.portOfDischarge || ''}`.toLowerCase().includes(needle); };
  const flagsOf = (c: FulfillmentCustoms) => state ? customsFlags(state, c) : [];
  const searched = inDomain.filter(c => matches(c) && (flagFilter === 'all' || (flagFilter === 'attention' ? flagsOf(c).length > 0 : flagsOf(c).some(flag => flag.key === flagFilter || (flagFilter === 'packing' && flag.key === 'unpacked')))));
  const statusOrder: Record<CustomsStatus, number> = { draft: 0, submitted: 1, cleared: 2 };
  const declarationRows = searched.filter(c => statusFilter === 'all' || c.status === statusFilter)
    .sort((a, b) => Number(flagsOf(b).some(x => x.key === 'awaiting')) - Number(flagsOf(a).some(x => x.key === 'awaiting')) || Number(flagsOf(b).length > 0) - Number(flagsOf(a).length > 0) || statusOrder[a.status] - statusOrder[b.status] || (shipmentOf(a)?.plannedDate || '9').localeCompare(shipmentOf(b)?.plannedDate || '9'));
  const rebateRows = !state ? [] : inDomain.filter(c => c.status !== 'draft' && matches(c)).sort((a, b) => rebateEvidence(state, a).ready - rebateEvidence(state, b).ready || (b.clearedAt || b.declaredAt).localeCompare(a.clearedAt || a.declaredAt));
    const shipmentsInDomain = (f?.shipments || []).filter(s => hasContext ? s.id === route.section : s.domain === domain);
  const pendingShipments = shipmentsInDomain.filter(s => isOpenShipment(s) && !f!.customs.some(c => c.shipmentId === s.id)).sort((a, b) => (a.plannedDate || '9').localeCompare(b.plannedDate || '9'));
  const rows = tab === 'rebate' ? rebateRows : declarationRows;
  const selected = tab === 'lc' ? undefined : rows.find(c => c.id === picked) || (picked ? records.find(c => c.id === picked) : undefined);

  const pick = (c: FulfillmentCustoms) => { setPicked(c.id); setDrawer(true); const { view, id: _id, ...target } = route; go(view, c.id, target, { keepScroll: true }); };
  const changeDomain = (value: Domain) => { setDomainChoice(value); setStatusFilter('all'); setPicked(null); };
  const changeTab = (value: Tab) => { setTab(value); setPicked(null); setDrawer(false); };
  const eligibleShipments = () => (f?.shipments || []).filter(s => isOpenShipment(s) && !f!.customs.some(c => c.shipmentId === s.id) && (!hasContext || s.id === route.section));
  const payload = (c: FulfillmentCustoms | undefined, patch: Partial<FulfillmentCustoms>) => ({ ...(c ? { id: c.id } : {}), shipmentId: c?.shipmentId || '', status: c?.status || 'draft', declarationNo: c?.declarationNo || '', broker: c?.broker || '', hsCode: c?.hsCode || '', origin: c?.origin || '', tradeMode: c?.tradeMode || '', declaredAt: c?.declaredAt || '', clearedAt: c?.clearedAt || '', evidence: c?.evidence || '', fileIds: c?.fileIds || [], note: c?.note || '', ...patch });
  const prepFields = [field('broker', '报关行', 'text', false), field('hsCode', 'HS 编码', 'text', false), field('origin', '原产地', 'text', false), field('tradeMode', '贸易方式 / 成交方式', 'text', false), field('note', '备注', 'textarea', false)];
  const createSpec = (shipmentId = ''): ModuleEditorSpec => ({ title: '建立报关记录', submitLabel: '建立记录',
    fields: [field('shipmentId', '准确出运', 'select', true, [emptyOption, ...eligibleShipments().map(s => ({ value: s.id, label: `${s.code} · ${s.customer}` }))]), ...prepFields],
    initialValues: { shipmentId: shipmentId || (hasContext ? route.section || '' : ''), broker: '', hsCode: '', origin: '', tradeMode: '', note: '' },
    submit: v => run({ type: 'fulfillment.customs.save', payload: payload(undefined, { shipmentId: text(v, 'shipmentId'), broker: text(v, 'broker'), hsCode: text(v, 'hsCode'), origin: text(v, 'origin'), tradeMode: text(v, 'tradeMode'), note: text(v, 'note') }) }) });
  const editSpec = (c: FulfillmentCustoms): ModuleEditorSpec => ({ title: '编辑报关资料', fields: prepFields, initialValues: { broker: c.broker, hsCode: c.hsCode, origin: c.origin, tradeMode: c.tradeMode, note: c.note },
    submit: v => run({ type: 'fulfillment.customs.save', payload: payload(c, { broker: text(v, 'broker'), hsCode: text(v, 'hsCode'), origin: text(v, 'origin'), tradeMode: text(v, 'tradeMode'), note: text(v, 'note') }) }) });
  const declareSpec = (c: FulfillmentCustoms, correcting: boolean): ModuleEditorSpec => ({ title: correcting ? '更正申报信息' : '登记已向海关申报', submitLabel: correcting ? '保存更正' : '登记已申报',
    fields: [field('declarationNo', '报关单号'), field('broker', '报关行'), field('hsCode', 'HS 编码'), field('origin', '原产地'), field('tradeMode', '贸易方式 / 成交方式'), field('declaredAt', '实际申报日', 'date'), field('note', '备注', 'textarea', false)],
    initialValues: { declarationNo: c.declarationNo, broker: c.broker, hsCode: c.hsCode, origin: c.origin, tradeMode: c.tradeMode, declaredAt: c.declaredAt || day, note: c.note },
    submit: v => run({ type: 'fulfillment.customs.save', payload: payload(c, { status: 'submitted', declarationNo: text(v, 'declarationNo'), broker: text(v, 'broker'), hsCode: text(v, 'hsCode'), origin: text(v, 'origin'), tradeMode: text(v, 'tradeMode'), declaredAt: text(v, 'declaredAt'), note: text(v, 'note') }) }) });
  const releaseSpec = (c: FulfillmentCustoms): ModuleEditorSpec => ({ title: '登记海关放行', submitLabel: '登记放行',
    fields: [field('clearedAt', '实际放行日', 'date'), field('evidence', '放行依据', 'textarea')],
    initialValues: { clearedAt: day, evidence: c.evidence },
    submit: v => run({ type: 'fulfillment.customs.save', payload: payload(c, { status: 'cleared', clearedAt: text(v, 'clearedAt'), evidence: text(v, 'evidence') }) }) });

  const statusCount = (value: StatusFilter) => value === 'all' ? searched.length : searched.filter(c => c.status === value).length;
  const declarationColumns: Column<FulfillmentCustoms>[] = [
    { key: 'code', header: '报关记录', width: 'minmax(150px,1.3fr)', render: c => <div className="mist-col" style={{ gap: 2 }}><Mono>{c.declarationNo || c.code}</Mono><small className="mist-muted">{uiText(c.declarationNo ? c.code : '尚无报关单号')}</small></div> },
    { key: 'shipment', header: '出运', width: 'minmax(150px,1.3fr)', render: c => { const s = shipmentOf(c); return <div className="mist-col" style={{ gap: 2 }}><Mono>{s?.code || '出运不可用'}</Mono><small className="mist-muted">{uiText(s ? `${s.customer} · ${MODE_LABEL[s.mode]} → ${s.portOfDischarge}` : '')}</small></div>; } },
    { key: 'hs', header: 'HS / 报关行', width: 'minmax(120px,1fr)', hideOnMobile: true, render: c => <div className="mist-col" style={{ gap: 2 }}><span>{c.hsCode || '待核实'}</span><small className="mist-muted">{c.broker || '未定报关行'}</small></div> },
    { key: 'date', header: '申报 / 放行', width: '120px', hideOnMobile: true, render: c => <div className="mist-col" style={{ gap: 2 }}><span>{c.declaredAt || '未申报'}</span><small className="mist-muted">{uiText(c.clearedAt ? `放行 ${c.clearedAt}` : shipmentOf(c)?.plannedDate ? `计划出运 ${shipmentOf(c)!.plannedDate}` : '')}</small></div> },
    { key: 'status', header: '状态', width: '118px', render: c => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={CUSTOMS_TONE[c.status]}>{CUSTOMS_LABEL[c.status]}</Pill>{flagsOf(c).map(flag => <small key={flag.key} className={flag.key === 'unpacked' ? 'mist-muted' : 'mist-tone-bad'}>{uiText(flag.label)}</small>)}</div> },
  ];
  const rebateColumns: Column<FulfillmentCustoms>[] = [
    { key: 'code', header: '报关单', width: 'minmax(150px,1.3fr)', render: c => <div className="mist-col" style={{ gap: 2 }}><Mono>{c.declarationNo}</Mono><small className="mist-muted">{shipmentOf(c)?.code} · {shipmentOf(c)?.customer}</small></div> },
    { key: 'release', header: '报关单放行', width: '120px', render: c => c.status === 'cleared' ? <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone="ok">{uiText("已放行")}</Pill><small className="mist-muted">{c.clearedAt}</small></div> : <Pill tone="warn">{uiText("待放行")}</Pill> },
    { key: 'collect', header: '收汇', width: 'minmax(130px,1.1fr)', render: c => { const e = rebateEvidence(state!, c); return e.replacement?<Pill>{uiText("无需收款")}</Pill>:e.collected ? <Pill tone="ok">{uiText("已全部收汇")}</Pill> : !e.cis.length ? <span className="mist-muted">{uiText("未签发 CI")}</span> : e.open.length ? <span className="mist-tone-bad">{uiText("未收 ")}{openText(e.open)}</span> : <span className="mist-muted">{uiText("CI 应收不可用")}</span>; } },
    { key: 'vat', header: '增值税专票', width: '110px', hideOnMobile: true, render: c => { const v = rebateEvidence(state!, c).vat; return v.claim ? `已配 ${v.claim.lines.length} 张` : v.candidates.length ? `可配 ${v.candidates.length} 张` : <span className="mist-muted">{uiText("未登记")}</span>; } },
    { key: 'claim', header: '退税申报', width: 'minmax(130px,1.1fr)', render: c => { const v = rebateEvidence(state!, c).vat; return v.claim ? <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={REBATE_TONE[v.claim.state]}>{REBATE_STATE_LABEL[v.claim.state]}</Pill><small className="mist-muted">{uiText("应退 ")}{fmt(v.claim.expected, 2)} CNY</small></div> : v.rate && v.candidates.length ? <div className="mist-col" style={{ gap: 2 }}><span className="mist-muted">{uiText("未申报")}</span><small className="mist-muted">{uiText("预计 ")}{fmt(v.preview, 2)} CNY</small></div> : <span className="mist-muted">{uiText(v.rate ? '未申报' : '缺退税率')}</span>; } },
    { key: 'ready', header: '资料', width: '90px', align: 'right', hideOnMobile: true, render: c => `${rebateEvidence(state!, c).ready} / 3` },
  ];

  const eligible = eligibleShipments();
  const createButton = can ? <Button variant="primary" icon={Plus} disabled={invalidContext || !eligible.length} title={uiText(eligible.length ? undefined : '没有尚无报关记录的进行中出运')} onClick={() => setDialog(createSpec())}>{uiText("建立报关记录")}</Button> : undefined;
  const filtered = tab === 'rebate' ? !!needle && inDomain.some(c => c.status !== 'draft') : inDomain.length > 0;
  const empty = filtered
    ? <EmptyState icon={SearchX} title={uiText("没有符合条件的报关记录")} description={uiText("换个关键词或清除筛选。")} action={<Button onClick={() => { setQuery(''); setStatusFilter('all'); setFlagFilter('all'); }}>{uiText("清除筛选")}</Button>} />
    : tab === 'rebate'
      ? <EmptyState icon={Receipt} title={uiText("还没有可核对的退税资料")} description={uiText("报关单登记为已申报或已放行后，会在这里核对放行、本票 CI 收汇与增值税专票，并由财务登记退税申报。")} />
      : <EmptyState icon={Stamp} title={uiText(invalidContext ? '来源出运不存在' : hasContext ? '本票还没有报关记录' : `还没有${domain === 'fabric' ? '面料' : '成衣'}报关记录`)} description={uiText(invalidContext ? '请返回货运管理重新选择准确出运。' : '报关记录与出运一一对应：后勤接手出运后建立记录，向海关申报后登记报关单号，放行后登记放行日与依据。')} action={createButton && !invalidContext && eligible.length ? <Button icon={Plus} onClick={() => setDialog(createSpec())}>{uiText("建立报关记录")}</Button> : undefined} />;
  const detail = selected && state
    ? <CustomsDetail record={selected} state={state} can={can} canClear={canClear} canInvoices={canInvoices} canRebate={canRebate} canReconcile={canReconcile} locked={locked} open={setDialog} run={run}
        onBill={id => go('payment-vouchers', id, { section: 'payables' })} onReceipt={id => go('payment-vouchers', id)}
        onEdit={() => setDialog(editSpec(selected))} onDeclare={() => setDialog(declareSpec(selected, selected.status === 'submitted'))} onRelease={() => { if (canClear) setDialog(releaseSpec(selected)); }}
        onAttach={ids => run({ type: 'fulfillment.customs.save', payload: payload(selected, { fileIds: ids }) })}
        onClassify={() => {if(hasContext){setTab('hs');setDrawer(false);}else changeTab('hs');}} onShipment={() => go('shipments', selected.shipmentId)} onDocuments={() => go('document-center', undefined, { section: selected.shipmentId })} onInvoice={id => go('invoices', id)} />
    : <EmptyState icon={Stamp} title={uiText("报关详情")} description={uiText(loading ? '正在读取报关记录' : tab === 'rebate' ? '从列表选择一张报关单，查看放行、收汇与退税资料' : '从列表选择一条报关记录，查看申报、放行与装箱核对')} compact />;
  const pendingShown = allPending ? pendingShipments : pendingShipments.slice(0, 3);
  const exportRows = () => exportRecords('报关台账', ['记录', '报关单号', '出运', '客户', 'HS编码', '报关行', '原产地', '成交方式', '状态', '申报日', '放行日'], rows.map(c => [c.code, c.declarationNo, shipmentOf(c)?.code || '', shipmentOf(c)?.customer || '', c.hsCode, c.broker, c.origin, c.tradeMode, CUSTOMS_LABEL[c.status], c.declaredAt, c.clearedAt]));

  return <MistPage width="wide">
    <PageHeader description={uiText(invalidContext ? '出运记录不存在' : contextShipment ? `${contextShipment.code} · ${contextShipment.customer}` : undefined)} eyebrow={uiText("订单履约 · 出口")} title={uiText("外贸与报关")}
      actions={<>
        {contextShipment && <Button onClick={() => go('shipments', contextShipment.id)}>{uiText("返回出运")}</Button>}
        {hasContext&&tab==='hs'&&<Button onClick={()=>{setTab('declarations');setDrawer(true);}}>{uiText('返回本票报关')}</Button>}{hasContext && <Button onClick={() => go('customs')}>{uiText("查看全部报关")}</Button>}
        {tab !== 'lc' && tab !== 'hs' && <Button icon={Download} disabled={!rows.length} onClick={exportRows}>{uiText("导出")}</Button>}
        {tab === 'declarations' && createButton}
      </>} />
    {!can && <div className="mist-section"><Banner tone="neutral" title={uiText("只读查看")}>{uiText("你的账号没有报关单证权限，可以查看报关记录、信用证台账与退税资料。")}</Banner></div>}
    {error && <div className="mist-section"><Banner tone="bad" title={uiText("报关数据未读取")} actions={<Button onClick={() => void refresh()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner></div>}
    {!hasContext && <div className="mist-section"><Tabs<Tab> value={tab} onChange={changeTab} options={[{ value: 'declarations', label: '报关', count: inDomain.length }, { value: 'lc', label: '信用证', count: lcAll.filter(o => o.type === domain).length }, { value: 'rebate', label: '退税', count: inDomain.filter(c => c.status !== 'draft').length }, { value: 'hs', label: '商品归类', count: hsAll.filter(c => c.family === domain).length }]} /></div>}
    {!hasContext && <div className="mist-section"><Segmented<Domain> ariaLabel={uiText("业务板块")} value={domain} onChange={changeDomain} options={[{ value: 'garment', label: `成衣业务 · ${tab === 'lc' ? lcAll.filter(o => o.type === 'garment').length : tab === 'hs' ? hsAll.filter(c => c.family === 'garment').length : records.filter(c => domainOf(c) === 'garment').length}` }, { value: 'fabric', label: `面料业务 · ${tab === 'lc' ? lcAll.filter(o => o.type === 'fabric').length : tab === 'hs' ? hsAll.filter(c => c.family === 'fabric').length : records.filter(c => domainOf(c) === 'fabric').length}` }]} /></div>}
    <Toolbar>
      <SearchField value={query} onChange={setQuery} placeholder={uiText(tab === 'lc' ? '搜索信用证号、客户或开证行' : '搜索报关单号、记录号、出运号、客户、HS 编码或报关行')} />
      {tab === 'declarations' && <Dropdown<FlagFilter> label={uiText("筛选")} value={flagFilter} onChange={setFlagFilter} options={[{ value: 'all', label: '全部' }, { value: 'attention', label: '需要关注' }, { value: 'awaiting', label: '离港等待放行' }, { value: 'packing', label: '装箱未完成或不符' }]} />}
    </Toolbar>
    {tab === 'declarations' && <>
      {pendingShipments.length > 0 && <div className="mist-section"><Card>
        <CardHeader title={ui`待建报关 · ${pendingShipments.length}`} sub={uiText("已发起、尚无报关记录的出运；后勤接手后在这里建立记录。")} />
        <DataTable ariaLabel={uiText("待建报关的出运")} rows={pendingShown} rowKey={s => s.id} columns={[
          { key: 'code', header: '出运', width: 'minmax(150px,1.4fr)', render: s => <div className="mist-col" style={{ gap: 2 }}><Mono>{s.code}</Mono><small className="mist-muted">{s.customer} · {MODE_LABEL[s.mode]} → {s.portOfDischarge}</small></div> },
          { key: 'stage', header: '出运阶段', width: '120px', hideOnMobile: true, render: s => <Pill tone={STAGE_TONE[shipmentStage(state!, s)]}>{STAGE_LABEL[shipmentStage(state!, s)]}</Pill> },
          { key: 'packing', header: '装箱', width: '120px', hideOnMobile: true, render: s => !f!.packing.some(row => row.shipmentId === s.id) ? <span className="mist-muted">{uiText("未装箱")}</span> : packingMatched(state!, s) ? '与计划一致' : <span className="mist-tone-bad">{uiText("与计划不符")}</span> },
          { key: 'date', header: '计划出运', width: '110px', hideOnMobile: true, render: s => <span className={s.plannedDate && s.plannedDate < day ? 'mist-tone-bad' : undefined}>{s.plannedDate || '未定'}</span> },
          ...(can ? [{ key: 'act', header: '', width: '132px', align: 'right' as const, render: (s: FulfillmentShipment) => <Button size="sm" icon={Plus} disabled={locked} onClick={() => setDialog(createSpec(s.id))} aria-label={ui`为 ${s.code} 建立报关记录`}>{uiText("建立记录")}</Button> }] : []),
        ]} />
        {pendingShipments.length > 3 && <div className="mist-row" style={{ padding: '8px 16px 12px' }}><TextLink onClick={() => setAllPending(v => !v)}>{uiText(allPending ? '收起' : `显示全部 ${pendingShipments.length} 票`)}</TextLink></div>}
      </Card></div>}
      <Pipeline<StatusFilter> value={statusFilter} onChange={setStatusFilter} items={[
        { value: 'all', label: '全部记录', count: statusCount('all'), color: 'var(--mist-ink-2)' },
        { value: 'draft', label: '未申报', count: statusCount('draft'), color: 'var(--mist-warn)' },
        { value: 'submitted', label: '已申报 · 待放行', count: statusCount('submitted'), color: 'var(--mist-accent)' },
        { value: 'cleared', label: '已放行', count: statusCount('cleared'), color: 'var(--mist-ok)' },
      ]} />
    </>}
    {tab === 'rebate' && state && <div className="mist-section"><RebateRatesCard state={state} canWrite={canRebate} locked={locked} open={setDialog} run={run} /></div>}
    {tab === 'lc'
      ? <>
        <LetterOfCreditLedger state={state || undefined} domain={domain} needle={needle} can={can} locked={locked} loading={loading} open={setDialog} run={run} onOrder={o => go('orders/detail', o.id, { customerId: o.customerId, section: o.type })} onShipment={id => go('shipments', id)} />
      </>
      : tab === 'hs' ? (state ? <CustomsClassificationLedger state={state} domain={domain} needle={needle} can={can} locked={locked} open={setDialog} run={run} /> : null)
      : <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected ? `${selected.declarationNo || selected.code} · ${shipmentOf(selected)?.customer || ''}` : '报关详情'} drawerSub={selected ? `${shipmentOf(selected)?.code || ''} · ${CUSTOMS_LABEL[selected.status]}` : undefined}
          list={<Card><DataTable ariaLabel={uiText(tab === 'rebate' ? '退税资料核对' : '报关列表')} loading={loading} rows={rows} rowKey={c => c.id} selectedKey={selected?.id} density="comfy" onRowClick={pick} columns={tab === 'rebate' ? rebateColumns : declarationColumns} empty={empty} /></Card>}
          detail={detail} />}
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </MistPage>;
}

function CustomsDetail({ record: c, state, can, canClear, canInvoices, canRebate, canReconcile, locked, open, run, onBill, onReceipt, onEdit, onDeclare, onRelease, onAttach, onClassify, onShipment, onDocuments, onInvoice }: {
  record: FulfillmentCustoms; state: MistState; can: boolean; canClear: boolean; canInvoices: boolean; canRebate: boolean; canReconcile: boolean; locked: boolean;
  open: (spec: ModuleEditorSpec) => void; run: (command: MistCommand) => Promise<unknown>; onBill: (id: string) => void; onReceipt: (id: string) => void;
  onEdit: () => void; onDeclare: () => void; onRelease: () => void; onAttach: (ids: string[]) => Promise<unknown>; onClassify: () => void; onShipment: () => void; onDocuments: () => void; onInvoice: (id: string) => void;
}) {
  const f = state.fulfillment, s = f.shipments.find(row => row.id === c.shipmentId), flags = customsFlags(state, c);
  const packingRows = f.packing.filter(row => row.shipmentId === c.shipmentId), documents = f.documents.filter(row => row.shipmentId === c.shipmentId);
  const closed = !s || s.state === 'departed' || s.state === 'cancelled';
  const baseReason = !can ? '需要报关单证权限' : closed ? '出运已离港或已取消，报关记录不能再修改' : false;
  const evidence = rebateEvidence(state, c);
  const unit = (lineId: string) => state.orderLines.find(line => line.id === lineId)?.unit || '';
  const cartons = new Set(packingRows.map(row => row.carton)).size, net = round(packingRows.reduce((sum, row) => sum + row.netWeight, 0)), gross = round(packingRows.reduce((sum, row) => sum + row.grossWeight, 0)), volume = round(packingRows.reduce((sum, row) => sum + row.volume, 0));
  return <DetailBody data-customs-detail={c.id} heading={<div>
      <span className="mist-mono mist-muted">{c.code}</span>
      <div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{uiText(c.declarationNo ? `报关单 ${c.declarationNo}` : `${s?.code || '出运'} · 未申报`)}</div>
    </div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={CUSTOMS_TONE[c.status]}>{CUSTOMS_LABEL[c.status]}</Pill>{s && <Pill>{uiText(s.domain === 'fabric' ? '面料业务' : '成衣业务')}</Pill>}{s && <Pill>{MODE_LABEL[s.mode]}</Pill>}{flags.map(flag => <Pill key={flag.key} tone={flag.key === 'unpacked' ? 'warn' : 'bad'}>{uiText(flag.label)}</Pill>)}</div>
    <ReplacementExportReviewBlock state={state} customs={c} can={canClear} busy={locked} open={open} run={run}/>
    {can && c.status !== 'cleared' && <ActionBar busy={locked} actions={[
      { label: '登记已申报', icon: Stamp, onClick: onDeclare, primary: true, reason: baseReason, hidden: c.status !== 'draft' || !canClear },
      { label: '编辑报关资料', icon: Pencil, onClick: onEdit, reason: baseReason, hidden: c.status !== 'draft' },
      // 已清关（海关放行）是后勤/单证专属事实：无 customs:clear 时不提供该选项，服务端同样拒绝。
      { label: '登记海关放行', icon: Stamp, onClick: onRelease, primary: true, reason: baseReason, hidden: c.status !== 'submitted' || !canClear },
      { label: '更正申报信息', icon: Pencil, onClick: onDeclare, reason: baseReason, hidden: c.status !== 'submitted' || !canClear },
    ] as ReasonedAction[]} />}
    {(c.status === 'draft' || c.status === 'submitted') && !canClear && <span className="mist-note" data-customs-clear-hint>{uiText("申报与清关须由后勤/单证登记")}</span>}
    {c.status === 'cleared' && <span className="mist-note">{uiText("已放行记录不可覆盖；如需更正，请先在海关办理改单后补充附件说明。")}</span>}
    <Facts items={[
      { label: '出运', value: s ? <TextLink onClick={onShipment}>{s.code}</TextLink> : '出运不可用' },
      { label: '客户', value: s?.customer || '—' },
      { label: '运输', value: s ? `${MODE_LABEL[s.mode]} · ${s.portOfLoading} → ${s.portOfDischarge} · ${s.incoterm}` : '—' },
      { label: '报关单号', value: c.declarationNo || '未申报' },
      { label: '报关行', value: c.broker || '未填写' },
      { label: 'HS 编码', value: c.hsCode || '待核实' },
      { label: '原产地', value: c.origin || '未填写' },
      { label: '贸易方式 / 成交方式', value: c.tradeMode || '未填写' },
      { label: '申报日', value: c.declaredAt || '未申报' },
      { label: '放行日', value: c.clearedAt || (c.status === 'submitted' ? '待放行' : '—') },
    ]} />
    {c.evidence && <p className="mist-sub">{uiText("放行依据：")}{c.evidence}</p>}
    {c.note && <p className="mist-sub">{uiText("备注：")}{c.note}</p>}
    <CustomsItemsBlock record={c} state={state} can={can} locked={locked} run={run} open={open} onClassify={onClassify} />
    <DetailBlock title={uiText("与装箱实货核对")}>
      {s ? <DataTable ariaLabel={ui`${c.code} 装箱核对`} rows={s.lines} rowKey={line => line.lineId + ':' + (line.productionId || '')} columns={[
        { key: 'source', header: '准确条目', render: line => <SourceLink source={{ kind: 'orderLine', orderId: line.orderId, lineId: line.lineId, productionId: line.productionId }} /> },
        { key: 'plan', header: '计划 / 已装箱', align: 'right', render: line => { const packed = packedFor(state, s, line); return <span className={packingRows.length && packed !== line.quantity ? 'mist-tone-bad' : undefined}>{line.quantity} / {packed} {unit(line.lineId)}</span>; } },
      ]} /> : <span className="mist-note">{uiText("出运不可用，无法核对装箱。")}</span>}
      {packingRows.length > 0 ? <Facts cols={4} items={[{ label: '箱数', value: `${cartons} 箱` }, { label: '净重', value: `${net} kg` }, { label: '毛重', value: `${gross} kg` }, { label: '体积', value: `${volume} m³` }]} /> : s && <span className="mist-note">{uiText("后勤尚未装箱；申报数量与重量须以实际装箱为准。")}</span>}
    </DetailBlock>
    <DetailBlock title={uiText("本票单据")} aside={s && <TextLink icon={FileText} onClick={onDocuments}>{uiText("处理本票单据")}</TextLink>}>
      {documents.length ? <DataTable ariaLabel={ui`${c.code} 本票单据`} rows={documents} rowKey={row => row.id} columns={[
        { key: 'type', header: '类型', render: row => row.type },
        { key: 'number', header: '编号 · 版本', render: row => `${row.number || '未编号'} · v${row.version}` },
        { key: 'status', header: '状态', render: row => <Pill tone={row.status === 'issued' ? 'ok' : row.status === 'void' ? 'neutral' : 'warn'}>{uiText(row.status === 'issued' ? '已签发' : row.status === 'void' ? '已作废' : '草稿')}</Pill> },
      ]} /> : <span className="mist-note">{uiText("本票还没有单据；CI / PL 在单据中心按版本签发。")}</span>}
    </DetailBlock>
    {c.status !== 'draft'&&!evidence.replacement && <DetailBlock title={uiText("退税资料")} aside={<span className="mist-muted">{uiText("已具备 ")}{evidence.ready} / 3</span>}>
      <Checklist items={[
        { label: '报关单（海关放行）', done: evidence.released, note: evidence.released ? `${c.declarationNo} · 放行 ${c.clearedAt}` : `${c.declarationNo} · 待放行` },
        { label: '收汇（本票 CI 应收）', done: evidence.collected, note: !evidence.cis.length ? '本票尚未签发 CI' : evidence.collected ? `${evidence.invoices.length} 张应收已全部收汇` : evidence.open.length ? `未收 ${openText(evidence.open)}` : 'CI 对应应收不可用', noteTone: evidence.open.length ? 'bad' : undefined },
        { label: '增值税专用发票', done: evidence.vat.vatReady, note: evidence.vat.claim ? `已配单 ${evidence.vat.claim.lines.length} 张 · ${evidence.vat.claim.code}` : evidence.vat.candidates.length ? `可配单 ${evidence.vat.candidates.length} 张（本票订单的人民币专票）` : '本票订单还没有登记人民币增值税专票（财务在应付登记）' },
      ]} />
      {canInvoices && evidence.invoices.length > 0 && <div className="mist-row" style={{ flexWrap: 'wrap' }}>{evidence.invoices.map((invoice: MistInvoice) => <TextLink key={invoice.id} icon={Receipt} onClick={() => onInvoice(invoice.id)}>{uiText("查看应收 ")}{invoice.code}</TextLink>)}</div>}
    </DetailBlock>}
    {c.status !== 'draft'&&!evidence.replacement && canInvoices && <RebateClaimBlock state={state} customs={c} canWrite={canRebate} canReconcile={canReconcile} locked={locked} open={open} run={run} onBill={onBill} onReceipt={onReceipt} />}
    <DetailBlock title={uiText("附件")}><RecordFiles key={c.id} ids={c.fileIds} onAttach={can && c.status !== 'cleared' && !closed ? onAttach : undefined} />{!c.fileIds.length && <span className="mist-note">{uiText("报关单、放行通知等原件作为附件保存")}</span>}</DetailBlock>
    <DetailBlock title={uiText("处理记录")}><Events entity="customs" id={c.id} /></DetailBlock>
  </DetailBody>;
}
