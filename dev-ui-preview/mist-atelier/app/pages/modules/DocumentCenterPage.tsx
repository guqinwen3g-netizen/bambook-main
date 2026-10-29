import {MistPresentedErrorContext} from '../../runtime/errorPresentation';
import {fulfillmentDocumentFamily} from '../../../../../server/src/shared/mistFulfillment';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
import { View } from '../../../../../types';
/** 单据中心：按准确出运与合同保留单据版本（新版本不覆盖旧版本）、正式文件与签发 / 归档记录；我方签发 CI / PL，外部机构单据只归档原件；CI 签发回到财务应收。 */
import React from 'react';
import { Archive, Building2, Download, FileText, FilePlus2, Pencil, Plus, Receipt, SearchX, Stamp, XCircle } from 'lucide-react';
import { Banner, Button, Card, DataTable, Dropdown, EmptyState, Facts, MistPage, Mono, PageHeader, Pill, Pipeline, SearchField, Segmented, Tabs, TextLink, Toolbar, type Column, type Tone } from '../../../../../components/mist';
import { isPendingFinanceMistInvoice, isRecognizedMistInvoice, type MistState } from '../../../../../server/src/shared/mistWorkspace';
import type { FulfillmentDocument, FulfillmentShipment } from '../../../../../server/src/shared/mistFulfillment';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { fmt } from '../../data';
import { ModuleEditorDialog, type ModuleEditorSpec } from './ModuleWorkbench';
import { documentTypeLabel, choices, emptyOption, Events, exportRecords, field, localNow, RecordFiles, text } from './fulfillmentKit';
import { useRouteDraft } from './useRouteDraft';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen, type ReasonedAction } from './pageKit';
import { MODE_LABEL, packingMatched } from './ShipmentsPage';
import { DOCUMENT_ISSUERS } from '../../runtime/tradeOptions';

type Tab = 'documents' | 'template';
type Domain = FulfillmentShipment['domain'];
type DocType = FulfillmentDocument['type'];
type StatusFilter = 'active' | 'draft' | 'issued' | 'void';
type TypeFilter = 'all' | DocType;
const TYPE_LABEL: Record<DocType, string> = { CI: '商业发票 CI', PL: '装箱单 PL', BL: '提单 BL', CO: '原产地证 CO', OTHER: '其他外部单据' };
const OWN = (type: DocType) => type === 'CI' || type === 'PL';
const family = fulfillmentDocumentFamily;
export function documentStatus(d: FulfillmentDocument): { label: string; tone: Tone } {
  if (d.status === 'void') return { label: '已作废', tone: 'neutral' };
  if (d.status === 'issued') return d.externalIssue ? { label: '外部原件已归档', tone: 'ok' } : { label: '已签发', tone: 'ok' };
  return { label: '草稿', tone: 'warn' };
}
/** Why the backend would refuse to issue / archive this draft, checked up-front so the reason is visible. */
export function issueBlocker(root: MistState, d: FulfillmentDocument) {
  const s = root.fulfillment.shipments.find(row => row.id === d.shipmentId);
  if (!s) return '出运不可用';
  if (OWN(d.type) ? s.state === 'departed' || s.state === 'cancelled' : s.state === 'cancelled') return OWN(d.type) ? '出运已离港或已取消' : '出运已取消';
  if (!d.fileIds.length) return OWN(d.type) ? '请先上传核对后的正式单据文件' : '请先上传外部机构签发的原件';
  if (root.fulfillment.documents.some(o => o.id !== d.id && family(o) === family(d) && o.status === 'issued')) return '相同来源已有有效版本，请先作废';
  if(d.type==='CI'&&root.orders.find(o=>o.id===d.orderId)?.replacementSource&&!root.fulfillment.customs.some(c=>c.shipmentId===s.id&&c.replacementReviews?.some(r=>r.orderId===d.orderId&&r.unitPrice>0)))return '补发申报货值尚未核定';
  if (d.type === 'PL' && !packingMatched(root, s)) return '装箱分配与计划数量不一致';
  return '';
}
function voidBlocker(root: MistState, d: FulfillmentDocument) {
  const s = root.fulfillment.shipments.find(row => row.id === d.shipmentId);
  if (!s || s.state === 'departed' || s.state === 'cancelled') return '出运已离港或已取消，单据保留为历史';
  const inv = d.invoiceId ? root.invoices.find(row => row.id === d.invoiceId) : undefined;
  if (inv && ((isRecognizedMistInvoice(inv) && inv.open !== inv.amount) || root.allocations.some(a => a.invoiceId === inv.id))) return 'CI 已有收款，请先走财务更正';
  return '';
}

export function DocumentCenterPage() {
  const presentedError = React.useContext(MistPresentedErrorContext);
  const { state, run, error, refresh, loading, saving, pending } = useMistWorkspace(), session = useMistSession(), { go, route } = useNav();
  const can = session.hasPermission('customs:write'), canInvoices = session.hasPermission('invoices:read');
  const [dialog, setDialog] = useRouteDraft<ModuleEditorSpec | null>(null);
  const [tab, setTab] = React.useState<Tab>('documents'), [domainChoice, setDomainChoice] = React.useState<Domain | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('active'), [typeFilter, setTypeFilter] = React.useState<TypeFilter>('all'), [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(route.id || null), [drawer, setDrawer] = React.useState(!!route.id);
  React.useEffect(() => { if (route.id) { setPicked(route.id); setDrawer(true); setDomainChoice(null); setTab('documents'); } }, [route.id]);
  const f = state?.fulfillment, locked = saving || !!pending;
  const shipmentOf = (d: FulfillmentDocument) => f?.shipments.find(s => s.id === d.shipmentId);
  const contextShipment = route.section ? f?.shipments.find(s => s.id === route.section) : undefined;
  const hasContext = !!route.section, invalidContext = hasContext && !!state && !contextShipment;
  const docs = (f?.documents || []).filter(d => !hasContext || d.shipmentId === route.section);
  const routed = docs.find(d => d.id === route.id);
  const domainOf = (d: FulfillmentDocument): Domain => shipmentOf(d)?.domain || 'garment';
  const domain: Domain = domainChoice || (routed ? domainOf(routed) : undefined) || contextShipment?.domain || (docs.some(d => domainOf(d) === 'garment') || !docs.some(d => domainOf(d) === 'fabric') ? 'garment' : 'fabric');
  const inDomain = hasContext ? docs : docs.filter(d => domainOf(d) === domain);
  const needle = query.trim().toLowerCase();
  const orderCode = (id: string) => state?.orders.find(o => o.id === id)?.code || '';
  const searched = inDomain.filter(d => (typeFilter === 'all' || d.type === typeFilter) && (!needle || `${d.number} ${d.title} ${d.type} ${shipmentOf(d)?.code || ''} ${shipmentOf(d)?.customer || ''} ${orderCode(d.orderId)} ${d.externalIssue?.issuer || ''}`.toLowerCase().includes(needle)));
  const statusOf = (d: FulfillmentDocument): Exclude<StatusFilter, 'active'> => d.status;
  const count = (value: StatusFilter) => value === 'active' ? searched.filter(d => d.status !== 'void').length : searched.filter(d => statusOf(d) === value).length;
  const order: Record<FulfillmentDocument['status'], number> = { draft: 0, issued: 1, void: 2 };
  const rows = searched.filter(d => statusFilter === 'active' ? d.status !== 'void' : d.status === statusFilter)
    .sort((a, b) => order[a.status] - order[b.status] || (shipmentOf(a)?.code || '').localeCompare(shipmentOf(b)?.code || '') || a.type.localeCompare(b.type) || b.version - a.version);
  const selected = rows.find(d => d.id === picked) || (picked ? docs.find(d => d.id === picked) : undefined);

  const pick = (d: FulfillmentDocument) => { setPicked(d.id); setDrawer(true); const { view, id: _id, ...target } = route; go(view, d.id, target, { keepScroll: true }); };
  const changeDomain = (value: Domain) => { setDomainChoice(value); setStatusFilter('active'); setPicked(null); };
  const shipments = (f?.shipments || []).filter(s => s.state !== 'cancelled' && (!hasContext || s.id === route.section));
  const docSpec = (d?: FulfillmentDocument, base?: FulfillmentDocument): ModuleEditorSpec => {
    const src = d || base, fixed = !!src;
    const s = src ? f?.shipments.find(row => row.id === src.shipmentId) : contextShipment;
    const orderOptions = (s ? [...new Set(s.lines.map(line => line.orderId))] : []).map(id => ({ value: id, label: orderCode(id) || '订单不可用' }));
    return { title: d ? '编辑单据草稿' : base ? `基于 V${base.version} 建立新版本` : '新建单据', submitLabel: d ? '保存草稿' : '保存为草稿',
      fields: [
        ...(fixed ? [] : [field('shipmentId', '准确出运', 'select', true, [emptyOption, ...shipments.map(row => ({ value: row.id, label: `${row.code} · ${row.customer}` }))]), field('type', '单据类型', 'select', true, (['CI', 'PL', 'BL', 'CO', 'OTHER'] as DocType[]).map(value => ({ value, label: TYPE_LABEL[value] })))]),
        ...(fixed ? [] : [{ ...field('orderId', '对应订单', 'select', true, [emptyOption, ...(orderOptions.length ? orderOptions : (state?.orders || []).map(o => ({ value: o.id, label: o.code })))]), when: {key:'type',values:['CI']} }]),
        field('number', '实际单据编号'), field('title', '标题'),
        ...(!fixed || src?.type === 'CI' ? [{...field('dueDate', '应收到期日', 'date'),when:[{key:'type',values:['CI']},{key:'orderId',values:(state?.orders||[]).filter(order=>!order.replacementSource).map(order=>order.id)}]}] : []),
        field('content', '单据正文', 'textarea'),
      ],
      initialValues: { shipmentId: src?.shipmentId || (hasContext ? route.section || '' : ''), type: src?.type || 'PL', orderId: src?.orderId || '', number: d?.number || '', title: src?.title || '', dueDate: src?.dueDate || '', content: src?.content || '' },
      submit: v => run({ type: 'fulfillment.documents.save', payload: { ...(d ? { id: d.id } : {}), ...(base ? { baseDocumentId: base.id } : {}), shipmentId: src?.shipmentId || text(v, 'shipmentId'), orderId: src ? src.orderId : text(v, 'orderId'), type: (src?.type || text(v, 'type')) as DocType, number: text(v, 'number'), title: text(v, 'title'), dueDate: text(v, 'dueDate'), content: text(v, 'content'), fileIds: d?.fileIds || [] } }) };
  };
  const archiveSpec = (d: FulfillmentDocument): ModuleEditorSpec => ({ title: '归档外部机构原件', submitLabel: '归档原件', description: `${TYPE_LABEL[d.type]} ${d.number} · 以外部机构签发的原件为准。`, fields: [field('issuer', '外部签发机构', 'choice', true, DOCUMENT_ISSUERS), field('at', '实际签发时间', 'datetime-local'), field('evidence', '原件来源依据', 'textarea')], initialValues: { issuer: '', at: localNow(), evidence: '' }, submit: v => run({ type: 'fulfillment.documents.archiveExternal', payload: { id: d.id, issuer: text(v, 'issuer'), at: new Date(text(v, 'at')).toISOString(), evidence: text(v, 'evidence') } }) });
  const voidSpec = (d: FulfillmentDocument): ModuleEditorSpec => ({ title: `作废 ${d.number} · V${d.version}`, submitLabel: '确认作废', description: d.invoiceId ? '作废 CI 会同时作废其财务应收，出运回到单证处理中；已对客发送的需重新发送。' : '作废后出运回到单证处理中；原版本保留为历史。', fields: [field('reason', '作废原因', 'textarea')], initialValues: { reason: '' }, submit: v => run({ type: 'fulfillment.documents.void', payload: { id: d.id, reason: text(v, 'reason') } }) });

  const columns: Column<FulfillmentDocument>[] = [
    { key: 'number', header: '单据', width: 'minmax(170px,1.6fr)', render: d => <div className="mist-col" style={{ gap: 2 }}><Mono>{d.number}</Mono><small className="mist-muted">{d.title}</small></div> },
    { key: 'type', header: '类型 · 版本', width: 'minmax(120px,1fr)', render: d => { const n = (f?.documents || []).filter(o => family(o) === family(d)).length; return <div className="mist-col" style={{ gap: 2 }}><span>{documentTypeLabel(d.type)} · V{d.version}</span><small className="mist-muted">{uiText(OWN(d.type) ? '我方出具' : '外部机构')}{uiText(n > 1 ? ` · 共 ${n} 版` : '')}</small></div>; } },
    { key: 'shipment', header: '出运 / 订单', width: 'minmax(150px,1.3fr)', hideOnMobile: true, render: d => <div className="mist-col" style={{ gap: 2 }}><Mono>{shipmentOf(d)?.code || '出运不可用'}</Mono><small className="mist-muted">{shipmentOf(d)?.customer}{uiText(d.orderId ? ` · ${orderCode(d.orderId)}` : '')}</small></div> },
    { key: 'date', header: '签发 / 创建', width: '116px', hideOnMobile: true, render: d => <div className="mist-col" style={{ gap: 2 }}><span>{uiText(d.issuedAt ? shortWhen(d.issuedAt) : '未签发')}</span><small className="mist-muted">{d.actor} · {shortWhen(d.createdAt)}</small></div> },
    { key: 'status', header: '状态', width: '128px', render: d => { const st = documentStatus(d); return <div className="mist-col" style={{ gap: 2, alignItems: 'flex-start' }}><Pill tone={st.tone}>{uiText(st.label)}</Pill>{d.status === 'draft' && !d.fileIds.length && <small className="mist-muted">{uiText("缺正式文件")}</small>}</div>; } },
  ];
  const createButton = can ? <Button variant="primary" icon={Plus} disabled={invalidContext || !shipments.length} title={uiText(shipments.length ? undefined : '没有可出具单据的出运')} onClick={() => setDialog(docSpec())}>{uiText("新建单据")}</Button> : undefined;
  const empty = inDomain.length
    ? <EmptyState icon={SearchX} title={uiText("没有符合条件的单据")} description={uiText("换个关键词或清除筛选。")} action={<Button onClick={() => { setQuery(''); setTypeFilter('all'); setStatusFilter('active'); }}>{uiText("清除筛选")}</Button>} />
    : <EmptyState icon={FileText} title={uiText(invalidContext ? '来源出运不存在' : hasContext ? '本票还没有单据' : `还没有${domain === 'fabric' ? '面料' : '成衣'}出运单据`)} description={invalidContext ? uiText('来源出运不可用') : undefined} action={createButton && !invalidContext && shipments.length ? <Button icon={Plus} onClick={() => setDialog(docSpec())}>{uiText("新建单据")}</Button> : undefined} />;
  const detail = selected && state
    ? <DocumentDetail doc={selected} state={state} can={can} canInvoices={canInvoices} locked={locked} onPick={pick}
        onEdit={() => setDialog(docSpec(selected))} onVersion={() => setDialog(docSpec(undefined, selected))} onArchive={() => setDialog(archiveSpec(selected))} onVoid={() => setDialog(voidSpec(selected))}
        onIssue={() => setDialog({ title: `签发 ${selected.number} · V${selected.version}`, submitLabel: '确认签发', fields: [], initialValues: {}, submit: () => run({ type: 'fulfillment.documents.issue', payload: { id: selected.id } }) })}
        onAttach={ids => run({ type: 'fulfillment.documents.save', payload: { id: selected.id, shipmentId: selected.shipmentId, orderId: selected.orderId, type: selected.type, number: selected.number, title: selected.title, dueDate: selected.dueDate, content: selected.content, fileIds: ids } })}
        onShipment={() => go('shipments', selected.shipmentId)} onInvoice={id => go('invoices', id)} />
    : <EmptyState icon={FileText} title={uiText("单据详情")} description={uiText(loading ? '正在读取单据' : '从列表选择一份单据，查看版本、正式文件与签发记录')} compact />;
  const profile = state?.settings.companyProfile;

  return <MistPage width="wide">
    <PageHeader description={uiText(invalidContext ? '出运记录不存在' : contextShipment ? `${contextShipment.code} · ${contextShipment.customer}` : undefined)} eyebrow={uiText("订单履约 · 单证")} title={uiText("单据中心")}
      actions={<>
        {contextShipment && <Button onClick={() => go('shipments', contextShipment.id)}>{uiText("返回出运")}</Button>}
        {hasContext && <Button onClick={() => go('document-center')}>{uiText("查看全部单据")}</Button>}
        {tab === 'documents' && <Button icon={Download} disabled={!rows.length} onClick={() => exportRecords('单据目录', ['编号', '标题', '类型', '版本', '出运', '订单', '状态', '签发时间'], rows.map(d => [d.number, d.title, d.type, d.version, shipmentOf(d)?.code || '', orderCode(d.orderId), documentStatus(d).label, d.issuedAt || '']))}>{uiText("导出")}</Button>}
        {tab === 'documents' && createButton}
      </>} />
    {error && error !== presentedError && <div className="mist-section"><Banner tone="bad" title={uiText(state ? "单据操作未完成" : "单据未读取")} actions={<Button onClick={() => void refresh()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner></div>}
    {!hasContext && <div className="mist-section"><Tabs<Tab> value={tab} onChange={value => { setTab(value); setDrawer(false); }} options={[{ value: 'documents', label: '出运单据', count: docs.filter(d => d.status !== 'void').length }, { value: 'template', label: '抬头与模板' }]} /></div>}
    {tab === 'template' && !hasContext ? <Card><div className="mist-col" style={{ padding: 20, gap: 16 }}>
        {profile?.legalName ? <Facts items={[
          { label: '中文抬头', value: profile.legalName }, { label: '英文抬头', value: profile.englishName || '未填写' },
          { label: '中文地址', value: profile.address || '未填写' }, { label: '英文地址', value: profile.englishAddress || '未填写' },
          { label: '电话 / 邮箱', value: [profile.phone, profile.email].filter(Boolean).join(' · ') || '未填写' }, { label: '税号', value: profile.taxId || '未填写' },
          { label: '海关编码', value: profile.customsCode || '未填写' }, { label: '开户行 / SWIFT', value: [profile.bankName, profile.swift].filter(Boolean).join(' · ') || '未填写' },
        ]} /> : <EmptyState icon={Building2} title={uiText("尚未填写公司抬头")}  compact />}
        {session.canAccessView(View.SystemSettings)&&<div className="mist-row"><Button icon={Pencil} onClick={() => go('system-settings', undefined, { section: 'company' })}>{uiText("公司资料")}</Button></div>}
      </div></Card>
    : <>
      {!hasContext && <div className="mist-section"><Segmented<Domain> ariaLabel={uiText("业务板块")} value={domain} onChange={changeDomain} options={[{ value: 'garment', label: `成衣业务 · ${docs.filter(d => domainOf(d) === 'garment' && d.status !== 'void').length}` }, { value: 'fabric', label: `面料业务 · ${docs.filter(d => domainOf(d) === 'fabric' && d.status !== 'void').length}` }]} /></div>}
      <Toolbar>
        <SearchField value={query} onChange={setQuery} placeholder={uiText("搜索单据编号、标题、出运号、客户、订单或签发机构")} />
        <Dropdown<TypeFilter> label={uiText("类型")} value={typeFilter} onChange={setTypeFilter} options={[{ value: 'all', label: '全部类型' }, ...(['CI', 'PL', 'BL', 'CO', 'OTHER'] as DocType[]).map(value => ({ value, label: TYPE_LABEL[value] }))]} />
      </Toolbar>
      <Pipeline<StatusFilter> value={statusFilter} onChange={setStatusFilter} items={[
        { value: 'active', label: '当前单据', count: count('active'), color: 'var(--mist-ink-2)' },
        { value: 'draft', label: '草稿', count: count('draft'), color: 'var(--mist-warn)' },
        { value: 'issued', label: '有效签发 / 归档', count: count('issued'), color: 'var(--mist-ok)' },
        { value: 'void', label: '已作废', count: count('void'), color: 'var(--mist-ink-3)' },
      ]} />
      <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected ? `${selected.number} · V${selected.version}` : '单据详情'} drawerSub={selected ? `${TYPE_LABEL[selected.type]} · ${shipmentOf(selected)?.code || ''}` : undefined}
        list={<Card><DataTable ariaLabel={uiText("单据列表")} loading={loading} rows={rows} rowKey={d => d.id} selectedKey={selected?.id} density="comfy" onRowClick={pick} columns={columns} empty={empty} /></Card>}
        detail={detail} />
    </>}
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </MistPage>;
}

function DocumentDetail({ doc: d, state, can, canInvoices, locked, onPick, onEdit, onVersion, onIssue, onArchive, onVoid, onAttach, onShipment, onInvoice }: {
  doc: FulfillmentDocument; state: MistState; can: boolean; canInvoices: boolean; locked: boolean; onPick: (d: FulfillmentDocument) => void;
  onEdit: () => void; onVersion: () => void; onIssue: () => void; onArchive: () => void; onVoid: () => void; onAttach: (ids: string[]) => Promise<unknown>; onShipment: () => void; onInvoice: (id: string) => void;
}) {
  const s = state.fulfillment.shipments.find(row => row.id === d.shipmentId), st = documentStatus(d);
  const versions = state.fulfillment.documents.filter(o => family(o) === family(d)).sort((a, b) => b.version - a.version);
  const invoice = d.invoiceId ? state.invoices.find(row => row.id === d.invoiceId) : undefined;
  const order = state.orders.find(o => o.id === d.orderId);
  const blocker = d.status === 'draft' ? issueBlocker(state, d) : '';
  const noWrite = can ? false : '需要单证权限';
  const editableShipment = !!s && (OWN(d.type) ? s.state !== 'departed' && s.state !== 'cancelled' : s.state !== 'cancelled');
  const voidReason = d.status === 'issued' ? voidBlocker(state, d) : '';
  return <DetailBody data-document-detail={d.id} heading={<div>
      <span className="mist-mono mist-muted">{TYPE_LABEL[d.type]} · V{d.version}</span>
      <div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{d.number}</div>
    </div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={st.tone}>{uiText(st.label)}</Pill><Pill>{uiText(OWN(d.type) ? '我方出具' : '外部机构')}</Pill>{s && <Pill>{uiText(s.domain === 'fabric' ? '面料业务' : '成衣业务')}</Pill>}</div>
    {can && <ActionBar busy={locked} actions={[
      { label: '签发', icon: Stamp, onClick: onIssue, primary: true, reason: noWrite || blocker || false, hidden: d.status !== 'draft' || !OWN(d.type) },
      { label: '归档外部签发原件', icon: Archive, onClick: onArchive, primary: true, reason: noWrite || blocker || false, hidden: d.status !== 'draft' || OWN(d.type) },
      { label: '编辑草稿', icon: Pencil, onClick: onEdit, reason: noWrite || (editableShipment ? false : '出运已离港或已取消'), hidden: d.status !== 'draft' },
      { label: '作废当前版本', icon: XCircle, onClick: onVoid, reason: noWrite || voidReason || false, hidden: d.status !== 'issued' },
      { label: '建立新版本', icon: FilePlus2, onClick: onVersion, reason: noWrite || (editableShipment ? false : '出运已离港或已取消'), hidden: d.status === 'draft' || versions[0]?.id !== d.id },
    ] as ReasonedAction[]} />}
    <Facts items={[
      { label: '出运', value: s ? <TextLink onClick={onShipment}>{s.code}</TextLink> : '出运不可用' },
      { label: '客户', value: s?.customer || '—' },
      { label: '运输', value: s ? `${MODE_LABEL[s.mode]} · ${s.portOfLoading} → ${s.portOfDischarge}` : '—' },
      { label: '对应订单', value: order?.code || (d.orderId ? '订单不可用' : '整票出运') },
      ...(d.type === 'CI'&&!order?.replacementSource ? [{ label: 'CI 合同应收日', value: d.dueDate || '未填写' }] : []),
      { label: '标题', value: d.title },
      { label: '创建', value: `${d.actor} · ${shortWhen(d.createdAt)}` },
      { label: '签发 / 归档', value: d.issuedAt ? shortWhen(d.issuedAt) : '尚未签发' },
    ]} />
    {d.externalIssue && <p className="mist-sub">{uiText("原件来源：")}{d.externalIssue.evidence}</p>}
    <DetailBlock title={uiText("单据正文")}><p className="mist-sub" style={{ whiteSpace: 'pre-wrap' }}>{d.content}</p></DetailBlock>
    {d.type==='CI'&&order?.replacementSource&&<DetailBlock title={uiText('补发CI')}><Facts items={[{label:'客户收款',value:uiText('无需收款')},{label:'申报货值',value:d.replacementDeclaredAmount!==undefined?order.currency+' '+fmt(d.replacementDeclaredAmount,2):uiText('待签发')}]}/></DetailBlock>}
    {d.type === 'CI'&&!order?.replacementSource && <DetailBlock title={uiText("财务应收")} aside={invoice && canInvoices ? <TextLink icon={Receipt} onClick={() => onInvoice(invoice.id)}>{uiText("查看应收 ")}{invoice.code}</TextLink> : undefined}>
      {invoice ? <Facts items={[{ label: '应收金额', value: `${invoice.currency} ${fmt(invoice.amount, 2)}` }, { label: '未收', value: invoice.voidedAt ? '已随 CI 作废' : isPendingFinanceMistInvoice(invoice) ? '待财务确认' : `${invoice.currency} ${fmt(invoice.open, 2)}` }, { label: '到期日', value: invoice.due }]} />
        : <span className="mist-note">{uiText(d.status === 'draft' ? '待签发' : '未找到对应应收')}</span>}
    </DetailBlock>}
    <DetailBlock title={ui`版本（${versions.length}）`}>
      <DataTable ariaLabel={ui`${d.number} 版本`} rows={versions} rowKey={v => v.id} selectedKey={d.id} onRowClick={onPick} columns={[
        { key: 'v', header: '版本', width: '64px', render: v => `V${v.version}` },
        { key: 'number', header: '编号', render: v => <Mono>{v.number}</Mono> },
        { key: 'status', header: '状态', render: v => <Pill tone={documentStatus(v).tone}>{uiText(documentStatus(v).label)}</Pill> },
        { key: 'at', header: '签发 / 创建', hideOnMobile: true, render: v => v.issuedAt ? shortWhen(v.issuedAt) : shortWhen(v.createdAt) },
      ]} />
    </DetailBlock>
    <DetailBlock title={uiText("正式文件")}><RecordFiles key={d.id} ids={d.fileIds} onAttach={can && d.status === 'draft' && editableShipment ? onAttach : undefined} /></DetailBlock>
    <DetailBlock title={uiText("处理记录")}><Events entity="document" id={d.id} /></DetailBlock>
  </DetailBody>;
}
