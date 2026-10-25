import {SAMPLE_SEND_PURPOSES,sampleSendPurpose} from '../../../../../server/src/shared/mistSampleSending';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 样品仓库：面料按档案汇总形态余额，成衣按每件实物；详情卡承接借出、寄出、归还、移位与送检。 */
import { parseShippingSampleSizes } from '../../../../../server/src/shared/mistShippingSample';
import React from 'react';
import { ArrowLeftRight, Download, Layers, Package, Pencil, Plus, RefreshCw, SearchX, Send, Shirt, Undo2 } from 'lucide-react';
import { Banner, Button, Card, DataTable, Dropdown, EmptyState, Facts, Icon, MistPage, Mono, ObjectCell, PageHeader, Pagination, Pill, Pipeline, SearchField, Tabs, TextLink, Thumb, Timeline, Toolbar, type Column } from '../../../../../components/mist';
import type { FulfillmentSample, SampleMovement } from '../../../../../server/src/shared/mistFulfillment';
import { fulfillmentSourceLabel, fulfillmentPositions, fulfillmentSampleRoleLabel, sampleLoanRemaining } from '../../../../../server/src/shared/mistFulfillment';
import { developmentDomain } from '../../../../../server/src/shared/mistDevelopmentDomain';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { ModuleEditorDialog, type ModuleEditorSpec } from './ModuleWorkbench';
import { choices, emptyOption, exportRecords, field, number, parseSource, PositionSummary, RecordFiles, shipmentReturnTarget, SourceLink, sourceOptions, text, today, useEditor } from './fulfillmentKit';
import { useRouteDraft } from './useRouteDraft';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen } from './pageKit';

type Shelf = 'fabric' | 'garment' | 'other';
type StatusFilter = 'all' | 'available' | 'lent' | 'overdue' | 'empty';
type MoveKind = 'lend' | 'return' | 'send' | 'move';
/** One ledger row: a fabric archive with its forms, or one garment / other physical sample. */
type LedgerRow = { id: string; shelf: Shelf; name: string; samples: FulfillmentSample[]; primary: FulfillmentSample };

const MOVE_LABEL: Record<SampleMovement['kind'], string> = { receive: '入库', lend: '借出', return: '归还', send: '寄出', move: '移位' };
const shelfOf = (sample: FulfillmentSample): Shelf => sample.category === '面料' ? 'fabric' : sample.category === '成衣' ? 'garment' : 'other';
const archiveKey = (sample: FulfillmentSample) => sample.source.kind === 'version' ? 'v:' + sample.source.versionId
  : sample.source.kind === 'orderLine' ? `l:${sample.source.lineId}:${sample.source.productionId || ''}` : `m:${sample.name}|${sample.source.description}`;

function ledgerRows(samples: FulfillmentSample[]): LedgerRow[] {
  const rows: LedgerRow[] = [], archives = new Map<string, LedgerRow>();
  for (const sample of samples) {
    const shelf = shelfOf(sample);
    if (shelf !== 'fabric') { rows.push({ id: sample.id, shelf, name: sample.name, samples: [sample], primary: sample }); continue; }
    const key = archiveKey(sample), existing = archives.get(key);
    if (existing) { existing.samples.push(sample); continue; }
    const row: LedgerRow = { id: 'archive:' + key, shelf, name: sample.name, samples: [sample], primary: sample };
    archives.set(key, row); rows.push(row);
  }
  return rows;
}

function sampleFacts(state: MistState, sample: FulfillmentSample, day: string) {
  const movements = state.fulfillment.sampleMovements.filter(movement => movement.sampleId === sample.id);
  const openLoans = movements.filter(movement => movement.kind === 'lend' && sampleLoanRemaining(state, movement.id) > 0);
  const lent = openLoans.reduce((total, loan) => total + sampleLoanRemaining(state, loan.id), 0);
  const overdue = openLoans.filter(loan => loan.expectedReturn && loan.expectedReturn < day);
  const sent = movements.some(movement => movement.kind === 'send');
  const last = movements.slice().sort((a, b) => a.at.localeCompare(b.at)).pop();
  return { movements, openLoans, lent: Math.round(lent * 10000) / 10000, overdue, sent, last };
}

function rowStatus(state: MistState, row: LedgerRow, day: string): { key: StatusFilter; label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' } {
  const facts = row.samples.map(sample => sampleFacts(state, sample, day));
  if (facts.some(fact => fact.overdue.length)) return { key: 'overdue', label: '逾期未还', tone: 'bad' };
  if (facts.some(fact => fact.openLoans.length)) return { key: 'lent', label: row.shelf === 'fabric' ? '部分借出' : '借出中', tone: 'warn' };
  if (row.samples.some(sample => sample.available > 0)) return { key: 'available', label: row.shelf === 'fabric' ? '可用' : '在库', tone: 'ok' };
  return { key: 'empty', label: facts.some(fact => fact.sent) ? '已寄出' : '无可用', tone: 'neutral' };
}

const locationSummary = (row: LedgerRow) => {
  const places = [...new Set(row.samples.flatMap(sample => fulfillmentPositions(sample).filter(position => position.available > 0).map(position => position.location || '位置未记录')))];
  return places.length === 0 ? '无在库位置' : places.length === 1 ? places[0] : '多个位置';
};

export function SamplesPage() {
  const { state, loading, error, run, saving, pending } = useMistWorkspace(), session = useMistSession(), { go, route } = useNav(), editor = useEditor();
  const [dialog, setDialog] = useRouteDraft<ModuleEditorSpec | null>(null);
  const [syncError, setSyncError] = useRouteDraft(''), [syncing, setSyncing] = React.useState(false);
  const [query, setQuery] = React.useState(''), [form, setForm] = React.useState('all'), [origin, setOrigin] = React.useState('all'), [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [page, setPage] = React.useState(1), [picked, setPicked] = React.useState<string | null>(route.id || null), [drawer, setDrawer] = React.useState(false);
  React.useEffect(() => { setPicked(route.id || null); }, [route.id]);
  const day = today(), can = session.hasPermission('products:write'), locked = saving || !!pending;

  // Shipment context: only this shipment's shipping samples, bound to its exact production branch.
  const hasShipmentContext = route.section?.startsWith('shipment:') === true, shipmentId = hasShipmentContext ? route.section!.slice(9) : undefined;
  const incomingShipment = state?.fulfillment.shipments.find(shipment => shipment.id === shipmentId);
  const sourceShipment = incomingShipment && incomingShipment.state !== 'cancelled' && (!route.customerId || incomingShipment.customerId === route.customerId) ? incomingShipment : undefined;
  const shipmentProductions = (state?.productions || []).filter(branch => sourceShipment?.lines.some(line => line.productionId === branch.id && line.orderId === branch.orderId && line.lineId === branch.lineId));
  const uniqueProduction = shipmentProductions.length === 1 ? shipmentProductions[0] : undefined;
  const sourceProduction = route.productionId ? shipmentProductions.find(branch => branch.id === route.productionId) : uniqueProduction;
  const contextProduction = hasShipmentContext ? sourceProduction : state?.productions.find(branch => branch.id === route.productionId);
  const hasProductionContext = !!route.productionId && !hasShipmentContext;
  const invalidProduction = hasProductionContext && !!state && !contextProduction;
  const canCreate = can && !invalidProduction && !(hasProductionContext && contextProduction?.closed);
  const contextLine = state?.orderLines.find(line => line.id === contextProduction?.lineId && line.orderId === contextProduction.orderId);
  const contextDomain = sourceShipment?.domain || state?.orders.find(order => order.id === contextProduction?.orderId)?.type;
  const contextShelf: Shelf | undefined = contextDomain === 'fabric' || contextDomain === 'garment' ? contextDomain : undefined;
  const invalidShipment = hasShipmentContext && !!state && (!sourceShipment || !shipmentProductions.length);
  const sourceHint = invalidProduction ? '生产单已不可用' : hasProductionContext && contextProduction?.closed ? '生产单已关闭' : invalidShipment ? '本票出运或生产来源已不可用' : hasShipmentContext && route.productionId && !sourceProduction ? '请选择本票生产来源' : hasShipmentContext && shipmentProductions.length > 1 ? '请选择本次船样的生产来源' : undefined;
  const inShipment = (sample: FulfillmentSample) => !hasShipmentContext || !!sourceShipment && sample.role === 'shipping' && sample.shipmentId === sourceShipment.id && sample.source.kind === 'orderLine'
    && shipmentProductions.some(branch => sample.source.kind === 'orderLine' && branch.id === sample.source.productionId && branch.orderId === sample.source.orderId && branch.lineId === sample.source.lineId);

  // Filter physical samples before grouping or selecting a row; a stale selected ID cannot escape the branch.
  const inProduction = (sample: FulfillmentSample) => !hasProductionContext || !!contextProduction && sample.source.kind === 'orderLine'
    && sample.source.productionId === contextProduction.id && sample.source.orderId === contextProduction.orderId && sample.source.lineId === contextProduction.lineId;
  const allRows = ledgerRows((state?.fulfillment.samples || []).filter(sample => inShipment(sample) && inProduction(sample)));
  const routedRow = allRows.find(row => row.samples.some(sample => sample.id === picked) || row.id === picked);
  const counts: Record<Shelf, number> = { fabric: 0, garment: 0, other: 0 }; for (const row of allRows) counts[row.shelf]++;
  const [shelfChoice, setShelf] = React.useState<Shelf | null>(null);
  React.useEffect(() => { setShelf(null); }, [route.productionId, route.section]);
  const shelf: Shelf = shelfChoice || routedRow?.shelf || contextShelf || (counts.fabric || !counts.garment ? (counts.fabric || counts.other === 0 ? 'fabric' : 'other') : 'garment');
  const shelfRows = allRows.filter(row => row.shelf === shelf);
  const forms = [...new Set(shelfRows.flatMap(row => row.samples.map(sample => sample.form)))];
  const statusOf = (row: LedgerRow) => state ? rowStatus(state, row, day) : { key: 'all' as StatusFilter, label: '', tone: 'neutral' as const };
  const searchText = (row: LedgerRow) => [row.name, ...row.samples.flatMap(sample => [sample.code, sample.form, sample.size, sample.color, sample.location, sample.note, ...fulfillmentPositions(sample).map(position => position.location)]), state ? fulfillmentSourceLabel(state, row.primary.source) : ''].join(' ').toLocaleLowerCase();
  const filtered = shelfRows.filter(row => (form === 'all' || row.samples.some(sample => sample.form === form))
    && (origin === 'all' || row.primary.source.kind === origin)
    && (statusFilter === 'all' || statusOf(row).key === statusFilter || (statusFilter === 'lent' && statusOf(row).key === 'overdue'))
    && (!query || searchText(row).includes(query.toLocaleLowerCase())));
  const size = 10, pages = Math.max(1, Math.ceil(filtered.length / size)), currentPage = Math.min(page, pages), visible = filtered.slice((currentPage - 1) * size, currentPage * size);
  const selected = routedRow && routedRow.shelf === shelf ? routedRow : visible[0];
  React.useEffect(() => setPage(1), [query, form, origin, statusFilter, shelf]);
  const overdueLoans = state ? allRows.flatMap(row => row.samples.flatMap(sample => sampleFacts(state, sample, day).overdue.map(loan => ({ loan, sample })))) : [];

  const synchronize = async () => { if (syncing || locked) return; setSyncing(true); setSyncError(''); try { await run({ type: 'fulfillment.samples.sync', payload: {} }); } catch (problem) { setSyncError(problem instanceof Error ? problem.message : '来源实物同步失败'); } finally { setSyncing(false); } };
  const pick = (row: LedgerRow) => { setPicked(row.primary.id); setDrawer(true); const { view, id: _id, detail: _detail, ...target } = route; go(view, row.primary.id, target, { keepScroll: true }); };
  const changeShelf = (next: Shelf) => { setShelf(next); setForm('all'); setStatusFilter('all'); setPicked(null); };

  const sampleSources = hasShipmentContext ? [emptyOption, ...shipmentProductions.map(branch => ({ value: 'production:' + branch.id, label: `${branch.order} · ${branch.code} · ${branch.factory}` }))]
    : hasProductionContext ? (contextProduction ? [{ value: 'production:' + contextProduction.id, label: `${contextProduction.order} · ${contextProduction.code} · ${contextProduction.factory}` }] : [emptyOption])
    : [{ value: 'manual', label: '手工 / 无系统来源' }, ...sourceOptions(state, true).filter(option => option.value && !option.value.startsWith('line:'))];
  const productionSources = sampleSources.filter(option => option.value.startsWith('production:')).map(option => option.value);
  const roleOptions = hasShipmentContext ? [{ value: 'shipping', label: '船样' }] : [emptyOption, ...(!contextShelf || contextShelf==='garment' ? [{ value: 'pp', label: '成衣产前样' }] : []), ...(!contextShelf || contextShelf==='fabric' ? [{ value: 'pioneer', label: '面料先锋样' }] : []), { value: 'shipping', label: '船样' }];
  const shipmentOptions = hasShipmentContext ? (sourceShipment ? [{ value: sourceShipment.id, label: sourceShipment.code }] : [emptyOption]) : [emptyOption, ...(state?.fulfillment.shipments || []).filter(shipment => shipment.state !== 'cancelled').map(shipment => ({ value: shipment.id, label: shipment.code }))];
  const defaultCategory = contextShelf ? (contextShelf === 'fabric' ? '面料' : '成衣') : shelf === 'garment' ? '成衣' : shelf === 'other' ? '其他' : '面料';
  const shippingGarment=hasShipmentContext&&sourceShipment?.domain==='garment';
  const createSpec: ModuleEditorSpec = {
    title: shippingGarment?'登记船样':'新建样品',
    sections: [
      { id: 'identity', label: '类别与来源', fields: ['category', 'categoryCustom', 'name', 'source', 'sourceText', 'role', 'shipmentId'] },
      { id: 'form', label: '形态与数量', fields: shippingGarment?['form','sizeQuantities','unit']:['form', 'quantity', 'unit'] },
      { id: 'place', label: '规格与位置', fields: shippingGarment?['color','location','note']:['size', 'color', 'location', 'note'] },
    ],
    fields: [{...field('category', '大类', 'select', true, choices(['面料', '成衣', '其他'])),readonly:!!contextShelf}, {...field('categoryCustom', '其他类别', 'text', false),when:{key:'category',values:['其他']}}, field('name', '名称'),
      { ...field('source', '来源', 'select', true, sampleSources), readonly:hasProductionContext, hint: sourceHint }, {...field('sourceText', '来源说明', 'text', false),when:{key:'source',values:['manual']}},
      { ...field('role', '样品用途', 'select', true, roleOptions), readonly: hasShipmentContext, when:{key:'source',values:productionSources} },
      { ...field('shipmentId', '出运批次', 'select', true, shipmentOptions), readonly: hasShipmentContext, when:[{key:'source',values:productionSources},{key:'role',values:['shipping']}] },
      field('form', '形态'), ...(shippingGarment?[field('sizeQuantities','尺码与件数','textarea')]:[field('quantity', '数量 / 长度', 'number')]), {...field('unit', '单位', 'select', true, choices(['米', '码', '公斤', '份', '件'])),readonly:shippingGarment},
      ...(!shippingGarment?[field('size', '尺码', 'text', false)]:[]), field('color', '颜色', 'text', false), field('location', '存放位置', 'text', false), field('note', '备注', 'textarea', false)],
    initialValues: { category: defaultCategory, categoryCustom: '', name: contextLine?.name || '', source: hasShipmentContext ? (sourceProduction ? 'production:' + sourceProduction.id : '') : contextProduction ? 'production:' + contextProduction.id : 'manual', sourceText: '',
      role: hasShipmentContext ? 'shipping' : route.productionId ? (state?.orders.find(order => order.id === state.productions.find(branch => branch.id === route.productionId)?.orderId)?.type === 'fabric' ? 'pioneer' : 'pp') : '',
      shipmentId: sourceShipment?.id || '', form: hasShipmentContext ? '船样' : '', quantity: 1,sizeQuantities:'',unit: defaultCategory === '面料' ? '' : '件', size: '', color: '', location: '', note: '' },
    submitLabel: '登记样品',
    submit: async values => {
      if (!state) return; if (invalidShipment || invalidProduction || hasProductionContext && contextProduction?.closed) throw new Error('生产来源已不可用');
      const category = text(values, 'category') === '其他' ? text(values, 'categoryCustom') : text(values, 'category');
      if (!category) throw new Error('请填写其他类别');
      const sizeQuantities=shippingGarment?parseShippingSampleSizes(text(values,'sizeQuantities')):undefined,actualQuantity=sizeQuantities?sizeQuantities.reduce((total,row)=>total+row.quantity,0):number(values,'quantity');
      if (category !== '面料' && !Number.isInteger(number(values, 'quantity'))) throw new Error('件或份类样品必须按整数登记');
      await run({ type: 'fulfillment.samples.create', payload: { name: text(values, 'name'), category, form: text(values, 'form'), unit: text(values, 'unit'), quantity: actualQuantity,...(sizeQuantities?{sizeQuantities}:{}),location: text(values, 'location'), size: text(values, 'size'), color: text(values, 'color'), note: text(values, 'note'), fileIds: [],
        ...(text(values, 'role') ? { role: text(values, 'role') as FulfillmentSample['role'] } : {}), ...(text(values, 'shipmentId') ? { shipmentId: text(values, 'shipmentId') } : {}),
        source: text(values, 'source') === 'manual' ? { kind: 'manual', description: text(values, 'sourceText') } : parseSource(state, text(values, 'source')) } });
    },
  };
  const editSpec = (sample: FulfillmentSample): ModuleEditorSpec => ({ title: '编辑样品资料', fields: [field('name', '样品名称'), field('form', '样品形态'), field('size', '尺码', 'text', false), field('color', '颜色', 'text', false), field('note', '备注', 'textarea', false)],
    initialValues: { name: sample.name, form: sample.form, size: sample.size, color: sample.color, note: sample.note },
    submit: values => run({ type: 'fulfillment.samples.edit', payload: { id: sample.id, location: sample.location, name: text(values, 'name'), form: text(values, 'form'), size: text(values, 'size'), color: text(values, 'color'), note: text(values, 'note'), fileIds: sample.fileIds } }) });
  const movement = (sample: FulfillmentSample, kind: MoveKind) => {
    if (!state) return;
    const loans = state.fulfillment.sampleMovements.filter(item => item.sampleId === sample.id && item.kind === 'lend' && sampleLoanRemaining(state, item.id) > 0);
    const positions = fulfillmentPositions(sample);
    setDialog({ title: ({ lend: '登记借出', return: '登记分次归还', send: '登记永久寄出', move: '登记移位' })[kind] + ` · ${sample.form}`,
      fields: [...(kind==='send'?[field('sendPurpose','寄送用途','select',true,Object.entries(SAMPLE_SEND_PURPOSES).map(([value,label])=>({value,label})))]:[]),...(kind !== 'return' && positions.length > 1 ? [field('sourceLocation', '本次出库位置', 'select', true, [{ value: '__choose__', label: '请选择位置' }, ...positions.map(position => ({ value: position.location, label: `${position.location || '位置未记录'} · ${position.available}${sample.unit}` }))])] : []),
        ...(kind === 'return' ? [field('loanId', '原借出', 'select', true, [emptyOption, ...loans.map(loan => ({ value: loan.id, label: `${loan.person} · 未还 ${sampleLoanRemaining(state, loan.id)}${sample.unit} · ${loan.at.slice(0, 10)}` }))])] : []),
        ...(kind !== 'move' ? [field('quantity', `本次数量（${sample.unit}）`, 'number')] : []),
        field('person', kind === 'send' ? '收件人 / 公司' : kind === 'lend' ? '借用人' : '经手人', 'text', kind === 'lend' || kind === 'send'),
        field('location', kind === 'send' ? '寄送去向 / 运单号' : '新位置', 'text', false), ...(kind === 'lend' ? [field('expectedReturn', '预计归还日', 'date', false)] : []), field('note', '交接说明', 'textarea', false)],
      initialValues: {sendPurpose:sample.source.kind==='manual'?'other':'confirmation',quantity: kind === 'return' ? 0 : sample.available, person: '', location: kind === 'return' || kind === 'send' || sample.location === '多个位置' ? '' : sample.location, note: '', loanId: '', expectedReturn: '', sourceLocation: '__choose__' },
      submitLabel: '保存流转',
      submit: values => run({ type: 'fulfillment.samples.move', payload: { id: sample.id, kind,...(kind==='send'?{sendPurpose:sampleSendPurpose(text(values,'sendPurpose'),sample)}:{}),quantity: kind === 'move' ? 0 : number(values, 'quantity'), person: text(values, 'person'), location: text(values, 'location'), note: text(values, 'note'),
        ...(text(values, 'loanId') ? { loanId: text(values, 'loanId') } : {}), ...(text(values, 'expectedReturn') ? { expectedReturn: text(values, 'expectedReturn') } : {}), ...(text(values, 'sourceLocation') !== '__choose__' ? { sourceLocation: text(values, 'sourceLocation') } : {}) } }) });
  };
  const openSampleQc = (sample: FulfillmentSample) => {
    const source = sample.source; if (source.kind === 'manual' || !state) return;
    const existing = state.fulfillment.qcTasks.find(task => task.sampleId === sample.id);
    const qcTarget = sample.role === 'shipping' && sample.shipmentId ? { section: 'shipment:' + sample.shipmentId, productionId: source.kind === 'orderLine' ? source.productionId : undefined } : { section: 'sample', ...(source.kind === 'orderLine' ? { orderLineId: source.lineId, productionId: source.productionId } : { versionId: source.versionId }) };
    if (existing) { go('qc-workbench', existing.id, qcTarget); return; }
    editor.open({ title: `送检 ${sample.code}`,
      fields: [field('factory', '工厂'), field('location', '实际检查地点'), field('contact', '现场联系人', 'text', false), field('due', '预计检查日', 'date')],
      initialValues: { factory: source.kind === 'orderLine' ? state.productions.find(branch => branch.id === source.productionId)?.factory || '' : state.versions.find(version => version.id === source.versionId)?.factory || '', location: sample.location, contact: '', due: today() },
      submitLabel: '发起送检',
      submit: async values => {
        const domain = source.kind === 'orderLine' ? state.orders.find(order => order.id === source.orderId)?.type : developmentDomain(state.devs.find(dev => dev.id === source.devId)!.values);
        const saved = await run({ type: 'fulfillment.qc.request', payload: { source, sampleId: sample.id, domain: domain || 'garment', kind: 'sample', factory: text(values, 'factory'), location: text(values, 'location'), contact: text(values, 'contact'), due: text(values, 'due') } });
        go('qc-workbench', String(saved.result.id || ''), qcTarget);
      } });
  };

  if (editor.spec) return editor.view;

  const balanceLines = (row: LedgerRow) => row.samples.map(sample => <span key={sample.id} className="mist-cell-sub">{[sample.form,sample.color].filter(Boolean).join(' · ')} · <b className="mist-num">{sample.available}</b> {uiText(sample.unit)}{uiText(" 可用")}</span>);
  const fabricColumns: Column<LedgerRow>[] = [
    { key: 'archive', header: '面料档案', width: 'minmax(190px,1.6fr)', render: row => <ObjectCell thumb={<Thumb icon={Layers} />} name={row.name} meta={<><Mono>{row.primary.code}</Mono>{uiText(row.samples.length > 1 ? ` · ${row.samples.length}份样品` : '')}</>} />, sortValue: row => row.name },
    { key: 'balance', header: '形态与余额', width: 'minmax(150px,1.2fr)', render: row => <div className="mist-col">{balanceLines(row)}</div> },
    { key: 'source', header: '来源', width: 'minmax(140px,1fr)', hideOnMobile: true, render: row => state ? <span className="mist-cell-sub">{fulfillmentSourceLabel(state, row.primary.source)}</span> : null },
    { key: 'location', header: '位置', width: '110px', hideOnMobile: true, render: row => locationSummary(row) },
    { key: 'status', header: '状态', width: '96px', render: row => { const status = statusOf(row); return <Pill tone={status.tone}>{uiText(status.label)}</Pill>; } },
  ];
  const pieceColumns: Column<LedgerRow>[] = [
    { key: 'piece', header: shelf === 'garment' ? '实物' : '样品', width: 'minmax(190px,1.6fr)', render: row => <ObjectCell thumb={<Thumb icon={shelf === 'garment' ? Shirt : Package} />} name={row.name} meta={<><Mono>{row.primary.code}</Mono> · {row.primary.form}</>} />, sortValue: row => row.name },
    { key: 'spec', header: '规格', width: '120px', hideOnMobile: true, render: row => [row.primary.size, row.primary.color].filter(Boolean).join(' · ') || '未记录' },
    { key: 'source', header: '来源', width: 'minmax(140px,1fr)', hideOnMobile: true, render: row => state ? <span className="mist-cell-sub">{fulfillmentSourceLabel(state, row.primary.source)}</span> : null },
    { key: 'location', header: '位置', width: '110px', hideOnMobile: true, render: row => row.primary.available > 0 ? locationSummary(row) : '—' },
    { key: 'status', header: '状态', width: '96px', render: row => { const status = statusOf(row); return <Pill tone={status.tone}>{uiText(status.label)}</Pill>; } },
  ];
  const statusCounts = (key: StatusFilter) => shelfRows.filter(row => key === 'all' || statusOf(row).key === key || (key === 'lent' && statusOf(row).key === 'overdue')).length;

  const detail = selected && state ? <SampleDetail row={selected} state={state} day={day} can={can} locked={locked}
    onMove={movement} onEdit={sample => editor.open(editSpec(sample))} onQc={openSampleQc}
    onAttach={(sample, ids) => run({ type: 'fulfillment.samples.edit', payload: { id: sample.id, location: sample.location, note: sample.note, fileIds: ids } })} />
    : <EmptyState icon={shelf === 'garment' ? Shirt : Layers} title={uiText("样品详情")} description={uiText(loading ? '正在读取样品' : '从列表选择一条样品记录')} compact />;

  return <MistPage>
    <PageHeader description={sourceHint || sourceShipment?.code || (hasProductionContext && contextProduction ? `${contextProduction.code} · ${contextProduction.factory}` : undefined)} eyebrow={uiText("订单履约 · 实体样品")} title={uiText("样品仓库")}
      actions={<>
        {sourceShipment && <Button onClick={() => go('shipments', sourceShipment.id, shipmentReturnTarget(state, sourceShipment))}>{uiText("返回本票出运")}</Button>}
        {hasProductionContext && contextProduction && <Button onClick={() => go('production-board', undefined, {productionId:contextProduction.id,orderLineId:contextProduction.lineId})}>{uiText("返回生产单")}</Button>}
        {(hasShipmentContext || hasProductionContext) && <Button onClick={() => go('samples')}>{uiText("查看全部样品")}</Button>}
        {can && !hasShipmentContext && !hasProductionContext && <Button icon={RefreshCw} loading={syncing} disabled={syncing || locked} onClick={() => void synchronize()}>{uiText("同步已返样版本")}</Button>}
        <Button icon={Download} disabled={!filtered.length} onClick={() => exportRecords('样品仓库', ['编号', '名称', '来源', '形态', '总量', '可用', '单位', '位置'], filtered.flatMap(row => row.samples).map(sample => [sample.code, sample.name, state ? fulfillmentSourceLabel(state, sample.source) : '', sample.form, sample.quantity, sample.available, sample.unit, fulfillmentPositions(sample).map(position => `${position.location || '位置未记录'} ${position.available}${sample.unit}`).join('；')]))}>{uiText("导出")}</Button>
        {canCreate && !invalidShipment && <Button variant="primary" icon={Plus} disabled={locked} onClick={() => editor.open(createSpec)}>{uiText("新建样品")}</Button>}
      </>} />
    {syncError && <div className="mist-section"><Banner tone="bad" title={uiText("来源实物同步失败")}>{syncError}</Banner></div>}
    {error && <div className="mist-section"><Banner tone="bad" title={uiText("读取失败")}>{uiText(error)}</Banner></div>}
    {overdueLoans.length > 0 && <div className="mist-section"><Banner tone="warn" title={ui`${overdueLoans.length} 笔借出已超过预计归还日`} actions={<Button onClick={() => { const first = overdueLoans[0]; changeShelf(shelfOf(first.sample)); setStatusFilter('overdue'); }}>{uiText("只看逾期")}</Button>}>
      {overdueLoans.slice(0, 3).map(({ loan, sample }) => `${sample.name} · ${loan.person} · 应还 ${loan.expectedReturn}`).join('；')}{uiText(overdueLoans.length > 3 ? ' …' : '')}</Banner></div>}
    <Tabs value={shelf} onChange={value => changeShelf(value as Shelf)} options={[{ value: 'fabric', label: '面料', count: counts.fabric }, { value: 'garment', label: '成衣', count: counts.garment }, { value: 'other', label: '其他类别', count: counts.other }]} />
    <Toolbar>
      <SearchField value={query} onChange={setQuery} placeholder={uiText("搜索档案号、名称、来源或位置")} />
      <Dropdown label={uiText("形态")} value={form} onChange={setForm} options={[{ value: 'all', label: '全部形态' }, ...forms.map(value => ({ value, label: value }))]} />
      <Dropdown label={uiText("来源")} value={origin} onChange={setOrigin} options={[{ value: 'all', label: '全部来源' }, { value: 'version', label: '开发版本' }, { value: 'orderLine', label: '订单条目' }, { value: 'manual', label: '手工登记' }]} />
    </Toolbar>
    <Pipeline value={statusFilter} onChange={value => setStatusFilter(value as StatusFilter)} items={[
      { value: 'all', label: '全部', count: statusCounts('all'), color: 'var(--mist-ink-2)' },
      { value: 'available', label: shelf === 'fabric' ? '可用' : '在库', count: statusCounts('available'), color: 'var(--mist-ok)' },
      { value: 'lent', label: '借出未还', count: statusCounts('lent'), color: 'var(--mist-warn)' },
      { value: 'overdue', label: '逾期未还', count: statusCounts('overdue'), color: 'var(--mist-bad)' },
      { value: 'empty', label: '已寄出 / 无可用', count: statusCounts('empty'), color: 'var(--mist-ink-3)' },
    ]} />
    <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected?.name || '样品详情'} drawerSub={selected?.primary.code}
      list={<Card><DataTable ariaLabel={uiText("样品台账")} loading={loading} rows={visible} rowKey={row => row.id} selectedKey={selected?.id} density="comfy" onRowClick={pick}
        columns={shelf === 'fabric' ? fabricColumns : pieceColumns}
        empty={shelfRows.length ? <EmptyState icon={SearchX} title={uiText("没有符合条件的样品")} description={uiText("换个关键词或清除筛选。")} action={<TextLink onClick={() => { setQuery(''); setForm('all'); setOrigin('all'); setStatusFilter('all'); }}>{uiText("清除筛选")}</TextLink>} />
          : <EmptyState icon={shelf === 'garment' ? Shirt : Layers} title={uiText(hasShipmentContext ? '本票还没有船样' : '还没有样品档案')}  action={canCreate && !invalidShipment ? <Button icon={Plus} disabled={locked} onClick={() => editor.open(createSpec)}>{uiText("新建样品")}</Button> : undefined} />}
        footer={pages > 1 ? <Pagination page={currentPage} pages={pages} onChange={setPage} /> : undefined} /></Card>}
      detail={detail} />
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </MistPage>;
}

function SampleDetail({ row, state, day, can, locked, onMove, onEdit, onQc, onAttach }: {
  row: LedgerRow; state: MistState; day: string; can: boolean; locked: boolean;
  onMove: (sample: FulfillmentSample, kind: MoveKind) => void; onEdit: (sample: FulfillmentSample) => void; onQc: (sample: FulfillmentSample) => void; onAttach: (sample: FulfillmentSample, ids: string[]) => Promise<unknown>;
}) {
  const { go } = useNav(), session = useMistSession();
  const primary = row.primary, status = rowStatus(state, row, day);
  const shipment = state.fulfillment.shipments.find(item => item.id === primary.shipmentId);
  const events = row.samples.flatMap(sample => state.fulfillment.sampleMovements.filter(movement => movement.sampleId === sample.id).map(movement => ({ movement, sample })))
    .sort((a, b) => b.movement.at.localeCompare(a.movement.at));
  const why = (sample: FulfillmentSample, kind: MoveKind): string | false => {
    if (!can) return '没有样品写权限';
    const facts = sampleFacts(state, sample, day);
    if (kind === 'return') return facts.openLoans.length ? false : '没有未归还的借出';
    return sample.available > 0 ? false : '当前没有可用数量';
  };
  return <DetailBody data-sample-detail={row.id} heading={<div>
      <span className="mist-mono mist-muted">{row.samples.map(sample => sample.code).join(' · ')}</span>
      <div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{row.name}</div>
    </div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill>{primary.category}</Pill><Pill tone={status.tone}>{uiText(status.label)}</Pill>{primary.role && <Pill tone="accent">{fulfillmentSampleRoleLabel(primary.role)}</Pill>}</div>
    <Facts items={[
      { label: '来源', value: <SourceLink source={primary.source} /> },
      { label: row.shelf === 'fabric' ? '样品数' : '规格', value: row.shelf === 'fabric' ? `${row.samples.length}` : [primary.size, primary.color].filter(Boolean).join(' · ') || '未记录' },
      ...(shipment ? [{ label: '出运批次', value: <Mono>{shipment.code}</Mono> }] : []),
      { label: '登记', value: shortWhen(primary.createdAt) },
    ]} />
    <DetailBlock title={uiText(row.shelf === 'fabric' ? '形态与余额' : '数量与位置')}>
      {row.samples.map(sample => { const facts = sampleFacts(state, sample, day); return <div key={sample.id} className="mist-col" data-sample-form={sample.id}>
        <div className="mist-row"><b>{[sample.form,sample.color,sample.size].filter(Boolean).join(' · ')}</b><span className="mist-spacer" /><span className="mist-num">{sample.available} / {sample.quantity} {uiText(sample.unit)}</span></div>
        <span className="mist-note">{uiText("可用 ")}{sample.available} {uiText(sample.unit)}{uiText(" · 借出未还 ")}{facts.lent} {uiText(sample.unit)} · {uiText(sample.available > 0 ? (fulfillmentPositions(sample).length > 1 ? '多个位置' : sample.location || '位置未记录') : '无在库位置')}</span>
        {facts.overdue.map(loan => <span key={loan.id} className="mist-note"><Icon icon={Undo2} size="xs" />{loan.person}{uiText(" 应于 ")}{loan.expectedReturn}{uiText(" 归还，已逾期")}</span>)}
        <PositionSummary row={sample} />
        {can && <ActionBar busy={locked} actions={[
          { label: '借出', icon: ArrowLeftRight, onClick: () => onMove(sample, 'lend'), hidden: !!why(sample, 'lend') },
          { label: '寄出', icon: Send, onClick: () => onMove(sample, 'send'), hidden: !!why(sample, 'send') },
          { label: '归还', icon: Undo2, onClick: () => onMove(sample, 'return'), hidden: !!why(sample, 'return') },
          { label: '移位', onClick: () => onMove(sample, 'move'), hidden: !!why(sample, 'move') },
        ]} />}
        {sample.source.kind !== 'manual' && (state.fulfillment.qcTasks.some(task=>task.sampleId===sample.id) || session.hasPermission(sample.source.kind==='version'?'products:write':'orders:write')) && <Button onClick={() => onQc(sample)}>{uiText("查看 / 发起本样品QC")}</Button>}
      </div>; })}
    </DetailBlock>
    <div className="mist-row mist-module-actions">
      {can && <Button icon={Pencil} disabled={locked} onClick={() => onEdit(primary)}>{uiText("编辑资料")}</Button>}
    </div>
    {primary.note && <p className="mist-sub">{primary.note}</p>}
    <DetailBlock title={uiText("实物照片与附件")}>
      <RecordFiles key={primary.id} ids={primary.fileIds} onAttach={can ? ids => onAttach(primary, ids) : undefined} />
      {row.samples.slice(1).filter(sample => sample.fileIds.length).map(sample => <RecordFiles key={sample.id} ids={sample.fileIds} />)}
    </DetailBlock>
    <DetailBlock title={uiText("流转记录")}>
      {events.length ? <Timeline events={events.map(({ movement, sample }) => { const line = `${MOVE_LABEL[movement.kind]}${row.samples.length > 1 ? ' · ' + sample.form : ''}${movement.quantity ? ` ${movement.quantity}${sample.unit}` : ''}${movement.sendPurpose?' · '+uiText(SAMPLE_SEND_PURPOSES[movement.sendPurpose]):''}${movement.person ? ' · ' + movement.person : ''}${movement.location ? ' · ' + movement.location : ''}${movement.expectedReturn ? ` · 预计 ${movement.expectedReturn} 归还` : ''}${movement.note ? ' · ' + movement.note : ''}`, link = movement.development; return ({ who: movement.actor, when: new Date(movement.at).toLocaleString(), text: link ? <>{line} <TextLink onClick={() => go('development/detail', link.devId, { versionId: link.versionId })}>{uiText("查看开发案 ")}{state.devs.find(dev => dev.id === link.devId)?.code || ''}</TextLink></> : line }); })} />
        : <span className="mist-note">{uiText("还没有流转记录")}</span>}
    </DetailBlock>
  </DetailBody>;
}
