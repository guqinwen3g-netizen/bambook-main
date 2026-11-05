import {ClaimRepairWork,repairRecordSpec,repairHandbackSpec,repairDispatchSpec,repairReturnSpec} from './ClaimRepairWork';
import {MistPresentedErrorContext} from '../../runtime/errorPresentation';
import {latestClaimRepair,pendingRepairDispatch,unrecordedRepairDispatch} from '../../../../../server/src/shared/mistClaimInventory';
import { materialDeliveryRequired, materialDeliveryRows, materialDeliveryTargets } from '../../../../../server/src/shared/mistInternalFabric';
import { stockName } from '../businessNames';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 库存与仓储：面料 / 成衣业务组各自的实物台账；按单位分开汇总，详情为“事实 → 可做的动作 → 流水”。 */
import React from 'react';
import { ArrowRightLeft, Bookmark, Boxes, ClipboardCheck, Download, Layers, PackageMinus, PackagePlus, Plus, SearchX, Shirt, Trash2, Truck, Undo2, Warehouse } from 'lucide-react';
import { Banner, Button, Card, CardButton, DataTable, Dropdown, EmptyState, Facts, KeyValue, MistPage, Mono, PageHeader, Pill, Pipeline, SearchField, Select, TextLink, Tile, Timeline, Toolbar, type Column, type Tone } from '../../../../../components/mist';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import type { FulfillmentStock } from '../../../../../server/src/shared/mistFulfillment';
import { freeQuantity, fulfillmentPositions, fulfillmentSourceLabel, OTHER_RECEIPT_REASONS, reservationOpen, stockIssueRemaining, stockReservedQuantity } from '../../../../../server/src/shared/mistFulfillment';
import { stockAgeDays, stockInTransit, stockUnitCost } from '../../../../../server/src/shared/mistStockOperations';
import { CURRENCIES, UNITS } from '../../runtime/tradeOptions';
import { businessNow } from '../../runtime/businessClock';
import type { ClaimInventoryWarehouse } from '../../../../../server/src/shared/mistClaimInventory';
import { View } from '../../../../../types';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { Nav, useNav } from '../../nav';
import { ModuleEditorDialog, ModuleWorkbench, type ModuleEditorSpec } from './ModuleWorkbench';
import { choiceField, deliveryTargetPayload, emptyOption, exportRecords, field, number, parseRolls, PositionSummary, RecordFiles, SourceLink, text, today, useEditor } from './fulfillmentKit';
import { useRouteDraft } from './useRouteDraft';
import { ActionBar, DetailBlock, DetailBody, ListDetail, shortWhen } from './pageKit';
import { businessWhen } from './pageKit';
import { FailureNotice } from '../../runtime/FailureNotice';

type Domain = 'fabric' | 'garment';
type StateFilter = 'all' | 'available' | 'inspecting' | 'isolated' | 'cleared';
type SourceFilter = 'all' | 'purchase' | 'claimReturn' | 'other';
// Split by business group, not by material: the garment group's stock also holds trims and fabric for its orders.
const DOMAIN_LABEL: Record<Domain, string> = { fabric: '面料业务', garment: '成衣业务' };
const MOVE_LABEL: Record<string, string> = { receive: '实际入库', issue: '出库', return: '按原出库退回', move: '移位', lock: '隔离锁定', unlock: '批准解锁', scrap: '报废出库', reject: '转为拒收', adjust: '盘点调整', transferOut: '调拨出仓', transferIn: '调拨到仓', reserve: '预留', release: '释放预留' };
/** Lots older than this with goods still available are flagged as slow-moving. */
const SLOW_DAYS = 90;
const sourceKindOf = (stock: FulfillmentStock): Exclude<SourceFilter, 'all'> => stock.sourceKind === 'claimReturn' ? 'claimReturn' : stock.sourceKind === 'other' ? 'other' : 'purchase';
const confirmField = (label: string) => field('confirm', label, 'checkbox', false);
const confirmed = (v: Record<string, unknown>): true => { if (v.confirm !== true) throw new Error('请勾选确认'); return true; };
const round = (value: number) => Math.round(value * 10000) / 10000;
const isReturn = (stock: FulfillmentStock) => stock.sourceKind === 'claimReturn';
/** Same basis as the finance projection's referenceAmount: isolated quantity × contract price. */
const recoveryReference = (root: MistState, returnId: string) => { const f = root.fulfillment, row = f.stockMovements.find(m => m.id === returnId), stock = row && f.stock.find(x => x.id === row.stockId), purchase = stock && f.purchases.find(x => x.id === stock.purchaseId); return { amount: Math.round((row?.quarantinedQuantity || 0) * (purchase?.price || 0) * 100) / 100, currency: purchase?.currency || '' }; };

/** Net quantity issued from this batch (issues minus returns recorded against them). */
export function stockOutstanding(root: MistState, stock: FulfillmentStock) {
  return round(root.fulfillment.stockMovements.filter(movement => movement.stockId === stock.id && movement.kind === 'issue').reduce((sum, movement) => sum + stockIssueRemaining(root, movement.id), 0));
}
/** Quality / availability state from recorded quantities only. */
/** Lot held by an open incoming inspection (IQC), not a failed lot. */
export const stockAwaitingIqc = (root: MistState, stock: FulfillmentStock) => root.fulfillment.qcTasks.some(task => task.kind === 'incoming' && task.incoming?.stockId === stock.id && !task.incoming.releasedAt);
export function stockState(root: MistState, stock: FulfillmentStock): Exclude<StateFilter, 'all'> {
  if ((stock.locked || 0) > 0) return stockAwaitingIqc(root, stock) ? 'inspecting' : 'isolated';
  return stock.available > 0 ? 'available' : 'cleared';
}
const STATE_LABEL: Record<Exclude<StateFilter, 'all'>, string> = { available: '可用', inspecting: '待来料检验', isolated: '隔离待处置', cleared: '已出清' };
const STATE_PILL: Record<Exclude<StateFilter, 'all'>, string> = { available: '可用', inspecting: '待检', isolated: '隔离中', cleared: '已出清' };
const STATE_TONE: Record<Exclude<StateFilter, 'all'>, Tone> = { available: 'ok', inspecting: 'accent', isolated: 'warn', cleared: 'neutral' };
const domainOf = (root: MistState, stock: FulfillmentStock): Domain | undefined => root.orders.find(order => order.id === stock.orderId)?.type as Domain | undefined || root.fulfillment.purchases.find(purchase => purchase.id === stock.purchaseId)?.domain;
/** Per-unit totals; different units are never added together. */
function byUnit(rows: FulfillmentStock[], value: (stock: FulfillmentStock) => number) {
  const totals = new Map<string, number>();
  for (const stock of rows) { const amount = value(stock); if (amount > 0) totals.set(stock.unit, round((totals.get(stock.unit) || 0) + amount)); }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}
function UnitLines({ totals, tone }: { totals: Array<[string, number]>; tone?: Tone }) {
  if (!totals.length) return <b>0</b>;
  return <b className={`mist-unit-lines${tone ? ` mist-tone-${tone}` : ''}`}>{totals.slice(0, 2).map(([unit, amount]) => <span key={unit}>{amount}<small>{uiText(unit)}</small></span>)}{totals.length > 2 && <small>{uiText("另 ")}{uiText(totals.length - 2)}{uiText(" 种单位")}</small>}</b>;
}

export function InventoryPage() {
  const presentedError=React.useContext(MistPresentedErrorContext);
  const { state, workspace, run, error, refresh, loading, saving, pending } = useMistWorkspace(), session = useMistSession(), editor = useEditor(), nav = useNav(), { route, go } = nav;
  const f=state?.fulfillment,receipt=f?.returnReceipts?.find(row=>row.id===route.id);
  const explicitClaim=route.section?.startsWith('claim:')===true,hasClaim=explicitClaim||!!receipt,claimId=explicitClaim?route.section!.slice(6):receipt?.claimId;
  const claim=state?.platform.claims.find(row=>row.id===claimId),incomingStock=f?.stock.find(row=>row.id===route.id);
  const invalidSource = hasClaim && !!state && (!claim || !!route.id && !receipt && !incomingStock || !!receipt && receipt.claimId !== claim?.id || !!incomingStock && incomingStock.claimId !== claim?.id);
  const [warehouseFilter, setWarehouseFilter] = React.useState(''); React.useEffect(() => { setWarehouseFilter(''); }, [route.section, receipt?.id, session.sessionKey]);
  const [domainChoice, setDomainChoice] = React.useState<Domain | null>(null), [stateFilter, setStateFilter] = React.useState<StateFilter>('all'), [sourceFilter, setSourceFilter] = React.useState<SourceFilter>('all'), [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(incomingStock ? incomingStock.id : null), [drawer, setDrawer] = React.useState(!!incomingStock);
  React.useEffect(() => { if (incomingStock) { setPicked(incomingStock.id); setDomainChoice(null); } }, [incomingStock?.id]);
  const can = session.hasPermission('inventory:write'), [catalog, setCatalog] = useRouteDraft(false), [catalogId, setCatalogId] = useRouteDraft<string | undefined>(undefined), [selectedGoods, setSelectedGoods] = useRouteDraft('');
  const [dialog, setDialog] = useRouteDraft<ModuleEditorSpec | null>(null);
  const claimGoods = (state?.platform.claimGoods || []).filter(goods => goods.source && goods.returnReceiptId && (!hasClaim || goods.claimId === claim?.id) && (!receipt || goods.returnReceiptId === receipt.id));
  const sourceGoods = claimGoods.find(goods => goods.id === selectedGoods), terminal = !!claim && ['Closed', 'Cancelled'].includes(claim.state);
  const scoped = invalidSource ? [] : (f?.stock || []).filter(stock => { if (hasClaim) return !!claim && stock.claimId === claim.id && (!receipt || stock.returnReceiptId === receipt.id); if(!route.section)return true;return stock.purchaseId === route.section; });
  const sourceMode = !!route.section||!!receipt;
  const routedDomain = state && incomingStock ? domainOf(state, incomingStock) : undefined;
  const domain: Domain = domainChoice || routedDomain || (!state || scoped.some(stock => domainOf(state, stock) === 'garment') || !scoped.some(stock => domainOf(state, stock) === 'fabric') ? 'garment' : 'fabric');
  const domainRows = sourceMode || !state ? scoped : scoped.filter(stock => { const value = domainOf(state, stock); return !value || value === domain; });
  const needle = query.trim().toLowerCase();
  const purchaseOf = (stock: FulfillmentStock) => f?.purchases.find(purchase => purchase.id === stock.purchaseId);
  const returnCode = (stock: FulfillmentStock) => f?.returnReceipts.find(rt => rt.id === stock.returnReceiptId)?.code;
  const warehouseName = (id?: string) => id ? f?.warehouses.find(row => row.id === id)?.name || '仓库不可用' : '';
  const searched = domainRows.filter(stock => (!warehouseFilter || stock.warehouseId === warehouseFilter) && (sourceFilter === 'all' || sourceFilter === sourceKindOf(stock))
    && (!needle || `${stock.name} ${stock.batchNumber || ''} ${stock.dyeLot || ''} ${stock.otherReceipt?.source || ''} ${stock.location} ${stock.owner} ${fulfillmentPositions(stock).map(position => position.location).join(' ')} ${purchaseOf(stock)?.code || ''} ${purchaseOf(stock)?.supplier || ''} ${returnCode(stock) || ''} ${warehouseName(stock.warehouseId)}`.toLowerCase().includes(needle)));
  const priority: Record<Exclude<StateFilter, 'all'>, number> = { isolated: 0, inspecting: 1, available: 2, cleared: 3 };
  const rows = !state ? [] : searched.filter(stock => stateFilter === 'all' || stockState(state, stock) === stateFilter)
    .sort((a, b) => priority[stockState(state, a)] - priority[stockState(state, b)] || b.createdAt.localeCompare(a.createdAt));
  const selected = rows.find(stock => stock.id === picked) || (picked ? scoped.find(stock => stock.id === picked) : undefined);
  const locked = saving || !!pending;
  const canCost = session.hasPermission('procurement:read');

  const warehouseSpec = (row?: ClaimInventoryWarehouse): ModuleEditorSpec => ({ title: row ? '更新真实仓库' : '新增仓库', fields: [field('code', '仓库代码'), field('name', '仓库名称'), field('address', '仓库地址'),field('custodian','保管方','select',true,[{value:'',label:'请选择'},{value:'company',label:'公司'},{value:'supplier',label:'合作方'}]),{...field('supplierId','保管单位','select',true,[{value:'',label:'请选择'},...(state?.market.suppliers||[]).map(row=>({value:row.id,label:row.name}))]),when:{key:'custodian',values:['supplier']}}, field('active', '当前启用', 'checkbox', false)], initialValues: { code: row?.code || '', name: row?.name || '', address: row?.address || '',custodian:row?(row.supplierId?'supplier':row.custodian||''):'company',supplierId:row?.supplierId||'', active: row?.active ?? true }, submit: v => run({ type: 'fulfillment.claimInventory.warehouse.save', payload: { ...(row ? { id: row.id } : {}), code: text(v, 'code'), name: text(v, 'name'), address: text(v, 'address'),custodian:text(v,'custodian') as 'company'|'supplier',supplierId:text(v,'custodian')==='supplier'?text(v,'supplierId'):'', active: !!v.active } }) });
  const receive = () => {
    if (!sourceGoods?.source || !state) return; const goods = sourceGoods, source = goods.source!, rt = f!.returnReceipts.find(row => row.id === goods.returnReceiptId)!;
    editor.open({ title: '退货收货', fields: [{ ...field('warehouseId', '收货仓库', 'select', true, (f?.warehouses || []).map(row => ({ value: row.id, label: row.code + ' · ' + row.name }))), readonly: true }, field('quantity', `本次实收数量（${source.unit}）`, 'number'), field('location', '库位'), field('batchNumber', '退货批号'), field('ownership', '货权', 'select', true, [emptyOption, ...(claim?.dispositions.find(row=>row.id===goods.dispositionId)?.kind==='Repair'?[]:[{ value: 'Owned', label: '我方货权' }]), { value: 'Transferred', label: '客户货权' }]), field('ownershipDate', '货权确认日期', 'date'), { ...field('ownershipEvidence', '货权依据', 'textarea') }, field('receivedAt', '收货日期', 'date'), { ...field('basis', '收货依据', 'textarea'), hint: `${source.style} · 批准 ${source.quantity}${source.unit}，已收 ${goods.receivedQuantity || 0}${source.unit}` }, field('fileId', '收货凭据', 'select', false, [emptyOption, ...state.files.map(file => ({ value: file.id, label: file.name }))])], initialValues: { warehouseId: rt.warehouseId, quantity: 0, location: '', batchNumber: '', ownership: '', ownershipDate: today(), ownershipEvidence: '', receivedAt: today(), basis: '', fileId: '' }, submit: v => run({ type: 'fulfillment.claimInventory.receive', payload: { goodsId: goods.id, quantity: number(v, 'quantity'), unit: source.unit, warehouseId: rt.warehouseId, location: text(v, 'location'), batchNumber: text(v, 'batchNumber'), ownership: text(v, 'ownership') as 'Owned' | 'Transferred', ownershipDate: text(v, 'ownershipDate'), ownershipEvidence: text(v, 'ownershipEvidence'), receivedAt: text(v, 'receivedAt'), basis: text(v, 'basis'), fileIds: text(v, 'fileId') ? [text(v, 'fileId')] : [] } }) });
  };
  const scrapSpec = (stock: FulfillmentStock): ModuleEditorSpec | null => { const record = f?.receivedRecords.find(row => row.stockId === stock.id); if (!record) return null; return { title: '报废登记', submitVariant: 'danger', fields: [{ ...field('batch', '收货批次'), readonly: true }, field('basis', '报废依据', 'textarea'), confirmField('报废后不可撤销')], initialValues: { batch: stock.batchNumber + ' · ' + record.quantity + ' ' + record.unit, basis: '', confirm: false }, submit: v => confirmed(v) && run({ type: 'fulfillment.claimInventory.scrap', payload: { goodsId: record.goodsId, receivedEventId: record.id, basis: text(v, 'basis'), fileIds: [] } }) }; };
  const repairSpec = (stock:FulfillmentStock,handback=false):ModuleEditorSpec|null => {
    const record=f?.receivedRecords.find(row=>row.stockId===stock.id),goods=state?.platform.claimGoods.find(row=>row.id===stock.goodsId);
    if(!state||!record||!goods)return null;const job=latestClaimRepair(goods,record.id);
    return handback&&job?repairHandbackSpec(state,goods,job,run):repairRecordSpec(state,goods,record,run);
  };
  const custodySpec=(stock:FulfillmentStock,returning=false):ModuleEditorSpec|null=>{
    const record=f?.receivedRecords.find(row=>row.stockId===stock.id),goods=state?.platform.claimGoods.find(row=>row.id===stock.goodsId);
    if(!state||!record||!goods)return null;const trip=pendingRepairDispatch(goods,record.id);
    return returning?(trip?repairReturnSpec(state,goods,record,trip,run):null):repairDispatchSpec(state,goods,record,run);
  };
  const canStockWrite = (_stock: FulfillmentStock) => {
    return can;
  };
  const issueTargets = (stock: FulfillmentStock) => !!state && materialDeliveryRequired(state, stock.purchaseId || '') ? workspace?.materialIssueTargets?.[stock.id] ?? materialDeliveryTargets(state, stock.purchaseId || '', stock.id) : null;
  // When every receiving contract is blocked by the source's quality state, say why before the form is opened.
  // An empty target list means no processing contract can receive yet; say so rather than opening a form with nothing to pick.
  const issueBlocker = (stock: FulfillmentStock) => { const targets = issueTargets(stock); if (targets && !targets.length) return '本订单条目还没有已发出并经供应商确认的加工合同'; return targets?.length && targets.every(target => target.blocker) ? targets[0].blocker! : ''; };
  const moveSpec = (stock: FulfillmentStock, kind: 'issue' | 'return' | 'move'): ModuleEditorSpec => {
    const linked = kind === 'issue' && !!state && materialDeliveryRequired(state, stock.purchaseId || '');
    const targets = (linked ? issueTargets(stock) ?? [] : []).map(target => target.blocker ? { ...target, label: `${target.label} · ${target.blocker}` } : target);
    const quantity = targets.length === 1 && targets[0].remaining ? Math.min(stock.available, Number(targets[0].remaining)) : linked && targets.length !== 1 ? 0 : stock.available;
    return {
      title: ({ issue: linked ? '登记发料' : '登记出库', return: '按原出库退回', move: '登记库存移位' })[kind],
      ...(kind === 'return' && state && materialDeliveryRows(state).some(row => row.kind === 'issue' && state.fulfillment.stockMovements.some(movement => movement.id === row.id && movement.stockId === stock.id) && Number(row.rejected) > Number(row.returned)) ? { description: '拒收料优先退回并隔离，待处置。' } : {}),
      submitLabel: ({ issue: linked ? '登记发料' : '登记出库', return: '登记退回', move: '登记移位' })[kind],
      fields: [
        ...(linked ? [field('targetProductionId', '接收加工单', 'select', true, [emptyOption, ...targets])] : []),
        ...(kind !== 'return' && fulfillmentPositions(stock).length > 1 ? [field('sourceLocation', kind === 'move' ? '移出位置' : '本次出库位置', 'select', true, [{ value: '__choose__', label: '请选择位置' }, ...fulfillmentPositions(stock).map(position => ({ value: position.location, label: `${position.location || '位置未记录'} · ${position.available}${stock.unit}` }))])] : []),
        ...(kind === 'return' ? [field('issueId', '原出库', 'select', true, [emptyOption, ...(f?.stockMovements || []).filter(movement => movement.stockId === stock.id && movement.kind === 'issue' && !movement.shipmentLink && !movement.shipmentCorrectionHold && stockIssueRemaining(state!, movement.id) > 0).map(movement => ({ value: movement.id, label: `${movement.person} · 可退回 ${stockIssueRemaining(state!, movement.id)}${stock.unit} · ${movement.location} · ${businessWhen(movement.at)} · ${movement.note}` }))])] : []),
        field('quantity', `数量（${stock.unit}）`, 'number'),
        field('location', kind === 'move' ? '移入位置' : '交接地点'), field('person', linked ? '交接联系人' : kind === 'issue' ? '接收方（工厂 / 出运 / 人员）' : '接收 / 交付方'), field('note', '交接依据', 'textarea'),
        ...(kind === 'issue' ? [confirmField('出库后不能撤销，只能按原出库退回')] : []),
      ],
      initialValues: { confirm: false, quantity: kind === 'return' ? 0 : kind === 'move' && fulfillmentPositions(stock).length > 1 ? '' : Math.min(quantity, kind === 'move' ? stock.available : freeQuantity(stock) + (linked ? stockReservedQuantity(stock) : 0)), location: kind === 'return' || stock.location === '多个位置' ? '' : stock.location, person: '', note: '', issueId: '', sourceLocation: '__choose__', targetProductionId: targets.length === 1 ? targets[0].value : '' },
      submit: v => {
        if (kind === 'issue') confirmed(v);
        const payload = { id: stock.id, quantity: number(v, 'quantity'), location: text(v, 'location'), person: text(v, 'person'), note: text(v, 'note'), ...(text(v, 'sourceLocation') !== '__choose__' ? { sourceLocation: text(v, 'sourceLocation') } : {}) };
        return linked ? run({ type: 'fulfillment.materials.issue', payload: { ...payload, ...deliveryTargetPayload(text(v, 'targetProductionId')) } }) : run({ type: 'fulfillment.inventory.move', payload: { ...payload, kind, ...(text(v, 'issueId') ? { issueId: text(v, 'issueId') } : {}) } });
      },
    };
  };
  const lineOptions = [emptyOption, ...(state?.orderLines || []).map(line => ({ value: line.id, label: `${state!.orders.find(o => o.id === line.orderId)?.code || ''} · ${line.style || ''} · ${line.name}` }))];
  const activeWarehouses = (f?.warehouses || []).filter(w => w.active).map(w => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const otherReceiptSpec = (): ModuleEditorSpec => ({
    title: '其他入库', submitLabel: '登记入库',
    sections: [{ id: 'source', label: '来源', fields: ['reason', 'lineId', 'source', 'evidence'] }, { id: 'goods', label: '货物', fields: ['name', 'unit', 'quantity', 'warehouseId', 'location', 'dyeLot', 'rolls'] }, { id: 'cost', label: '成本', fields: ['unitCost', 'currency'] }],
    fields: [field('reason', '来源类型', 'select', true, [emptyOption, ...Object.entries(OTHER_RECEIPT_REASONS).map(([value, label]) => ({ value, label }))]), field('lineId', '订单条目', 'select', true, lineOptions), field('source', '来源单位 / 单号'), field('evidence', '入库依据', 'textarea'),
      field('name', '物料名称'), choiceField('unit', '单位', UNITS), field('quantity', '入库数量', 'number'), ...(activeWarehouses.length ? [field('warehouseId', '仓库', 'select', true, [emptyOption, ...activeWarehouses])] : []), field('location', '库位'), field('dyeLot', '缸号', 'text', false), field('rolls', '码单（卷号 数量 公斤）', 'textarea', false),
      field('unitCost', '单位成本', 'number', false), { ...choiceField('currency', '币种', CURRENCIES, false, true) }],
    initialValues: { reason: '', lineId: '', source: '', evidence: '', name: '', unit: '', quantity: 0, warehouseId: activeWarehouses.length === 1 ? activeWarehouses[0].value : '', location: '', dyeLot: '', rolls: '', unitCost: '', currency: '' },
    submit: v => {
      const line = state?.orderLines.find(row => row.id === text(v, 'lineId'));
      if (!line) throw new Error('请选择订单条目');
      const rolls = parseRolls(text(v, 'rolls')), cost = v.unitCost === '' || v.unitCost === undefined ? undefined : number(v, 'unitCost');
      if (cost !== undefined && !text(v, 'currency')) throw new Error('请选择成本币种');
      return run({ type: 'fulfillment.stock.receiveOther', payload: { orderId: line.orderId, lineId: line.id, reason: text(v, 'reason') as keyof typeof OTHER_RECEIPT_REASONS, source: text(v, 'source'), name: text(v, 'name'), unit: text(v, 'unit'), quantity: number(v, 'quantity'), ...(text(v, 'warehouseId') ? { warehouseId: text(v, 'warehouseId') } : {}), location: text(v, 'location'), evidence: text(v, 'evidence'), ...(cost !== undefined ? { unitCost: cost, currency: text(v, 'currency') } : {}), ...(text(v, 'dyeLot').trim() ? { dyeLot: text(v, 'dyeLot').trim() } : {}), ...(rolls ? { rolls } : {}) } });
    },
  });
  const reserveSpec = (stock: FulfillmentStock): ModuleEditorSpec => ({
    title: '预留库存', submitLabel: '确认预留',
    fields: [field('lineId', '预留给订单条目', 'select', true, lineOptions), field('quantity', `数量（${stock.unit}）`, 'number'), field('purpose', '用途 / 单号')],
    initialValues: { lineId: '', quantity: freeQuantity(stock), purpose: '' },
    submit: v => { const line = state?.orderLines.find(row => row.id === text(v, 'lineId')); if (!line) throw new Error('请选择订单条目'); return run({ type: 'fulfillment.stock.reserve', payload: { stockId: stock.id, orderId: line.orderId, lineId: line.id, quantity: number(v, 'quantity'), purpose: text(v, 'purpose') } }); },
  });
  const releaseSpec = (stock: FulfillmentStock, reservationId: string): ModuleEditorSpec => ({ title: '释放预留', submitLabel: '确认释放', fields: [field('reason', '释放原因', 'textarea')], initialValues: { reason: '' }, submit: v => run({ type: 'fulfillment.stock.release', payload: { stockId: stock.id, reservationId, reason: text(v, 'reason') } }) });
  const transferSpec = (stock: FulfillmentStock): ModuleEditorSpec => {
    const positions = fulfillmentPositions(stock).filter(pos => pos.available > 0), targets = activeWarehouses.filter(w => w.value !== stock.warehouseId);
    return { title: '仓库调拨', submitLabel: '登记调出',
      fields: [...(positions.length > 1 ? [field('sourceLocation', '调出位置', 'select', true, [emptyOption, ...positions.map(pos => ({ value: pos.location, label: `${pos.location} · ${pos.available}${stock.unit}` }))])] : []), field('quantity', `数量（${stock.unit}）`, 'number'), field('toWarehouseId', '调入仓库', 'select', true, [emptyOption, ...targets]), field('toLocation', '调入库位'), field('carrier', '承运 / 经手'), field('note', '调拨依据', 'textarea')],
      initialValues: { sourceLocation: '', quantity: positions.length > 1 ? 0 : freeQuantity(stock), toWarehouseId: targets.length === 1 ? targets[0].value : '', toLocation: '', carrier: '', note: '' },
      submit: v => run({ type: 'fulfillment.stock.transfer', payload: { stockId: stock.id, quantity: number(v, 'quantity'), ...(text(v, 'sourceLocation') ? { sourceLocation: text(v, 'sourceLocation') } : {}), toWarehouseId: text(v, 'toWarehouseId'), toLocation: text(v, 'toLocation'), carrier: text(v, 'carrier'), note: text(v, 'note') } }) };
  };
  const transferReceiveSpec = (id: string): ModuleEditorSpec => ({ title: '调拨到仓', submitLabel: '确认到仓', fields: [field('note', '点收依据', 'textarea')], initialValues: { note: '' }, submit: v => run({ type: 'fulfillment.stock.transfer.receive', payload: { id, note: text(v, 'note') } }) });
  const countSpec = (stock: FulfillmentStock): ModuleEditorSpec => {
    const positions = fulfillmentPositions(stock).filter(pos => pos.available > 0);
    return { title: '库存盘点', submitLabel: '提交盘点',
      fields: [...positions.map((pos, i) => ({ ...field(`count${i}`, `${pos.location || '位置未记录'} 实盘（账面 ${pos.available}${stock.unit}）`, 'number') })), field('note', '盘点说明', 'textarea')],
      initialValues: { ...Object.fromEntries(positions.map((pos, i) => [`count${i}`, pos.available])), note: '' },
      submit: v => run({ type: 'fulfillment.stock.count', payload: { lines: positions.map((pos, i) => ({ stockId: stock.id, location: pos.location, counted: number(v, `count${i}`) })), note: text(v, 'note') } }) };
  };
  if (editor.spec) return editor.view;
  const back = <>{hasClaim && claim && session.canAccessView(View.Claims) && <Button onClick={() => go('claims', claim.id)}>{uiText("返回来源案件")}</Button>}{hasClaim && <Button onClick={() => go('inventory')}>{uiText("查看全部库存")}</Button>}{!hasClaim && route.section && <Button onClick={() => go('procurement', route.section)}>{uiText("返回来源采购")}</Button>}</>;
  if (catalog) return <Nav.Provider value={{ ...nav, route: { ...route, id: catalogId }, go: (view, id, target) => { if (view === 'inventory') setCatalogId(id); else go(view, id, target); } }}><ModuleWorkbench title={uiText("仓库目录")} rows={f?.warehouses || []} columns={[{ key: 'code', header: '仓库', render: row => <><Mono>{row.code}</Mono><div>{row.name}</div></> }, { key: 'address', header: '实际地址', render: row => row.address }, {key:'custodian',header:'保管方',render:row=>row.supplierId?state?.market.suppliers.find(s=>s.id===row.supplierId)?.name||'合作方':row.custodian==='company'?'公司':'未登记'}, { key: 'active', header: '状态', render: row => <Pill tone={row.active ? 'ok' : 'neutral'}>{uiText(row.active ? '启用' : '停用')}</Pill> }]} create={can ? warehouseSpec() : undefined} edit={can ? row => warehouseSpec(row) : undefined} detail={row => <KeyValue items={[{ label: '仓库代码', value: row.code }, { label: '仓库名称', value: row.name }, { label: '实际地址', value: row.address },{label:'保管方',value:row.supplierId?state?.market.suppliers.find(s=>s.id===row.supplierId)?.name||'合作方':row.custodian==='company'?'公司':'未登记'}, { label: '当前状态', value: row.active ? '启用' : '停用' }]} />} toolbar={<>{back}<Button onClick={() => { setCatalog(false); setCatalogId(undefined); }}>{uiText("返回库存台账")}</Button></>} /></Nav.Provider>;
  const receivingBlocked = !sourceGoods || terminal || invalidSource || (sourceGoods.receivedQuantity || 0) >= sourceGoods.quantity || !f?.warehouses.some(row => row.id === f.returnReceipts.find(rt => rt.id === sourceGoods.returnReceiptId)?.warehouseId && row.active);
  const receivingReason = !sourceGoods ? '请先选择退货条目' : terminal ? '来源案件已结束' : (sourceGoods.receivedQuantity || 0) >= sourceGoods.quantity ? '本条目已全部收货' : receivingBlocked ? '退货单仓库未启用' : '';

  const pick = (stock: FulfillmentStock) => { setPicked(stock.id); setDrawer(true); };
  const changeDomain = (value: Domain) => { setDomainChoice(value); setStateFilter('all'); setPicked(null); };
  const stateCount = (value: StateFilter) => !state ? 0 : value === 'all' ? searched.length : searched.filter(stock => stockState(state, stock) === value).length;
  const metrics = (value: Domain) => { const list = !state ? [] : scoped.filter(stock => domainOf(state, stock) === value); return { count: list.length, available: byUnit(list, stock => stock.available), isolated: byUnit(list, stock => stock.locked || 0), out: byUnit(list, stock => state ? stockOutstanding(state, stock) : 0) }; };
  const columns: Column<FulfillmentStock>[] = [
    { key: 'name', header: '物料 / 产品 · 来源批次', width: 'minmax(170px,1.6fr)', render: stock => <div className="mist-col" style={{ gap: 2 }}><span>{state ? stockName(state, stock) : stock.name}</span><small className="mist-muted">{uiText(isReturn(stock) ? `${returnCode(stock) || '退货单不可用'} · ${stock.batchNumber}` : stock.sourceKind === 'other' ? `${OTHER_RECEIPT_REASONS[stock.otherReceipt!.reason]} · ${stock.otherReceipt!.source}` : `${purchaseOf(stock)?.code || '来源采购不可用'}${stock.batchNumber ? ` · ${stock.batchNumber}` : ''}`)}{stock.dyeLot ? uiText(` · 缸号 ${stock.dyeLot}`) : ''}</small></div> },
    { key: 'source', header: '订单条目', width: 'minmax(120px,1fr)', hideOnMobile: true, render: stock => <SourceLink source={{ kind: 'orderLine', orderId: stock.orderId, lineId: stock.lineId }} /> },
    { key: 'location', header: '位置 / 货权', width: 'minmax(120px,1fr)', hideOnMobile: true, render: stock => { const positions = fulfillmentPositions(stock); return <div className="mist-col" style={{ gap: 2 }}><span>{uiText(stock.warehouseId ? `${warehouseName(stock.warehouseId)} · ` : '')}{uiText(positions.length > 1 ? `${positions.length} 个位置` : stock.location || '位置未记录')}</span><small className="mist-muted">{stock.owner}</small></div>; } },
    { key: 'quantity', header: '数量', width: '188px', align: 'right', render: stock => { const out = state ? stockOutstanding(state, stock) : 0; return <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span className="mist-num" style={{ whiteSpace: 'nowrap' }}>{uiText(isReturn(stock) ? `可用 ${stock.available} / 现存 ${stock.onHand} / 隔离 ${stock.locked} ${stock.unit}` : `可用 ${stock.available} / 累计入库 ${stock.quantity} ${stock.unit}`)}</span>{out > 0 && <small className="mist-muted">{uiText("已出库 ")}{out} {uiText(stock.unit)}</small>}{stockReservedQuantity(stock) > 0 && <small className="mist-muted">{uiText("已预留 ")}{stockReservedQuantity(stock)} {uiText(stock.unit)}</small>}{state && stockInTransit(state, stock.id) > 0 && <small className="mist-muted">{uiText("在途 ")}{stockInTransit(state, stock.id)} {uiText(stock.unit)}</small>}</div>; } },
    { key: 'age', header: '库龄', width: '72px', align: 'right', hideOnMobile: true, render: stock => { const days = stockAgeDays(stock, businessNow().toISOString()); return stock.available > 0 ? <span className="mist-num">{days}{uiText(" 天")}</span> : <span className="mist-muted">—</span>; } },
    { key: 'state', header: '状态', width: '80px', render: stock => state ? stockState(state, stock) === 'available' && stockAgeDays(stock, businessNow().toISOString()) > SLOW_DAYS ? <Pill tone="warn">{uiText('呆滞')}</Pill> : <Pill tone={STATE_TONE[stockState(state, stock)]}>{STATE_PILL[stockState(state, stock)]}</Pill> : null },
  ];
  const exportRows = () => { const now = businessNow().toISOString(); exportRecords('库存来源台账', ['名称', '来源', '批号', '缸号', '订单条目', '累计入库', '在库数量', '隔离', '可用', '已预留', '在途', '已出库（净）', '单位', '入库日期', '库龄（天）', ...(canCost ? ['单位成本', '库存金额', '币种'] : []), '仓库', '位置', '货权'], rows.map(stock => { const cost = canCost ? stockUnitCost(state!, stock) : undefined; return [stock.name, isReturn(stock) ? returnCode(stock) : stock.sourceKind === 'other' ? stock.otherReceipt?.source : purchaseOf(stock)?.code || stock.receiptId, stock.batchNumber || '', stock.dyeLot || '', fulfillmentSourceLabel(state!, { kind: 'orderLine', orderId: stock.orderId, lineId: stock.lineId }), stock.quantity, stock.onHand ?? '', stock.locked ?? '', stock.available, stockReservedQuantity(stock), stockInTransit(state!, stock.id), stockOutstanding(state!, stock), stock.unit, stock.createdAt.slice(0, 10), stockAgeDays(stock, now), ...(canCost ? [cost?.unitCost ?? '', cost ? round(cost.unitCost * stock.available) : '', cost?.currency ?? ''] : []), warehouseName(stock.warehouseId), stock.location, stock.owner]; })); };
  const filtersOn = !!needle || stateFilter !== 'all' || sourceFilter !== 'all' || !!warehouseFilter;
  const empty = filtersOn && domainRows.length
    ? <EmptyState icon={SearchX} title={uiText("没有符合条件的库存")} description={uiText("换个关键词或清除筛选。")} action={<Button onClick={() => { setQuery(''); setStateFilter('all'); setSourceFilter('all'); setWarehouseFilter(''); }}>{uiText("清除筛选")}</Button>} />
    : <EmptyState icon={Boxes} title={uiText(invalidSource ? '来源不匹配' : sourceMode ? '本来源还没有入库批次' : `${DOMAIN_LABEL[domain]}还没有库存`)} description={uiText(invalidSource ? '请返回来源案件重新选择准确退货单。' : '')} action={!sourceMode && session.canAccessView(View.Procurement) ? <Button onClick={() => go('procurement')}>{uiText("前往采购管理")}</Button> : undefined} />;
  const detail = selected && state
    ? <StockDetail stock={selected} issueBlocker={issueBlocker(selected)} state={state} can={canStockWrite(selected)} canFinance={session.hasPermission('invoices:read')&&session.hasPermission('vouchers:read')} locked={locked}
        onMove={kind => setDialog(moveSpec(selected, kind))} onScrap={() => setDialog(scrapSpec(selected))} onRepair={() => {const spec=repairSpec(selected);if(spec)editor.open(spec);}} onHandback={() => {const spec=repairSpec(selected,true);if(spec)editor.open(spec);}} onDispatch={()=>{const spec=custodySpec(selected);if(spec)editor.open(spec);}} onRepairReturn={()=>{const spec=custodySpec(selected,true);if(spec)editor.open(spec);}}
        onInspect={returnId => setDialog({title:'隔离料送复检',submitLabel:'发起复检',fields:[field('due','预计检查日','date')],initialValues:{due:today()},submit:v=>run({type:'fulfillment.inventory.quarantine.request',payload:{returnId,due:text(v,'due')}})})}
        onRelease={returnId => setDialog({title:'恢复可用库存',submitLabel:'确认恢复',fields:[field('evidence','处置依据','textarea')],initialValues:{evidence:''},submit:v=>run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId,decision:'release',evidence:text(v,'evidence')}})})}
        onDispose={(returnId,decision) => setDialog({title:decision==='scrap'?'登记隔离料报废':'登记退供应商',submitLabel:'确认登记',submitVariant:'danger',fields:[{...field('evidence',decision==='scrap'?'报废依据':'供应商接收依据','textarea'),hint:'采购结算需另行核对'},confirmField(decision==='scrap'?'报废后不可撤销':'退回后不可撤销')],initialValues:{evidence:'',confirm:false},submit:v=>confirmed(v) && run({type:'fulfillment.inventory.quarantine.dispose',payload:{returnId,decision,evidence:text(v,'evidence')}})})}
        canDecideRecovery={session.hasPermission('aftersales:approve')}
        onDecideRecovery={returnId=>{const reference=recoveryReference(state,returnId);setDialog({title:'追偿决定',submitLabel:'确认决定',fields:[field('decision','决定','select',true,[{value:'recovery',label:'向供应商追偿'},{value:'noRecovery',label:'不追偿'}]),{...field('amount',`追偿金额（${reference.currency}）`,'number'),min:0.01,step:'0.01',when:{key:'decision',values:['recovery']}},field('evidence','决定依据','textarea')],initialValues:{decision:'recovery',amount:reference.amount,evidence:''},submit:v=>text(v,'decision')==='recovery'?run({type:'fulfillment.inventory.quarantine.recovery',payload:{returnId,amount:number(v,'amount'),reason:text(v,'evidence')}}):run({type:'fulfillment.inventory.quarantine.noRecovery',payload:{returnId,evidence:text(v,'evidence')}})});}}
        onRevokeRecovery={(returnId,recovery)=>setDialog({title:recovery?'撤回追偿决定':'撤回不追偿决定',submitLabel:'确认撤回',fields:[field('reason','撤回原因','textarea')],initialValues:{reason:''},submit:v=>run(recovery?{type:'fulfillment.inventory.quarantine.recovery.revoke',payload:{returnId,reason:text(v,'reason')}}:{type:'fulfillment.inventory.quarantine.noRecovery.revoke',payload:{returnId,reason:text(v,'reason')}})})}
        onLinkShipment={issueId => { const branch=state.productions.find(p=>p.sourcePurchaseId===selected.purchaseId&&p.orderId===selected.orderId&&p.lineId===selected.lineId); const held=state.fulfillment.stockMovements.find(m=>m.id===issueId)?.shipmentCorrectionHold; const options=state.fulfillment.shipments.filter(s=>s.state!=='cancelled'&&(!held||s.state==='departed')&&s.lines.some(l=>l.orderId===selected.orderId&&l.lineId===selected.lineId&&l.productionId===branch?.id)).map(s=>({value:s.id,label:s.code})); setDialog({title:'关联出运',submitLabel:'确认关联',fields:[{...field('issue','本次出库'),readonly:true},field('shipmentId','出运单','select',true,[emptyOption,...options]),field('evidence','核对依据','textarea')],initialValues:{issue:`${selected.name} · ${stockIssueRemaining(state,issueId)} ${selected.unit}`,shipmentId:options.length===1?options[0].value:'',evidence:''},submit:v=>run({type:'fulfillment.inventory.shipment.link',payload:{issueId,shipmentId:text(v,'shipmentId'),evidence:text(v,'evidence')}})}); }}
        onUnlinkShipment={issueId => setDialog({title:'解除出运关联',submitLabel:'确认解除',fields:[field('reason','解除原因','textarea')],initialValues:{reason:''},submit:v=>run({type:'fulfillment.inventory.shipment.unlink',payload:{issueId,reason:text(v,'reason')}})})}
        onCorrectShipment={issueId => {const issue=f!.stockMovements.find(m=>m.id===issueId)!;const branch=state.productions.find(p=>p.sourcePurchaseId===selected.purchaseId&&p.orderId===selected.orderId&&p.lineId===selected.lineId);const options=f!.shipments.filter(s=>s.state==='departed'&&s.lines.some(l=>l.orderId===selected.orderId&&l.lineId===selected.lineId&&l.productionId===branch?.id)).map(s=>({value:s.id,label:s.code}));setDialog({title:'更正已离港关联',submitLabel:'确认更正',fields:[{...field('shipmentId','准确出运单','select',false,[{value:'',label:'暂未确认'},...options]),hint:'暂未确认时保留待核对，不能普通退库'},field('reason','更正原因','textarea'),field('evidence','核对依据','textarea')],initialValues:{shipmentId:issue.shipmentLink?.shipmentId||'',reason:'',evidence:''},submit:v=>run({type:'fulfillment.inventory.shipment.correct',payload:{issueId,shipmentId:text(v,'shipmentId'),reason:text(v,'reason'),evidence:text(v,'evidence')}})});}}
        onQc={id=>go('qc-workbench',id,{section:'quarantine'})} canQc={session.canAccessView(View.QcWorkbench)}
        canReserve={session.hasPermission('orders:write')} canCost={canCost} canTransfer={activeWarehouses.some(w => w.value !== selected.warehouseId)}
        onTransfer={() => setDialog(transferSpec(selected))} onTransferReceive={id => setDialog(transferReceiveSpec(id))} onCount={() => setDialog(countSpec(selected))} onReserve={() => setDialog(reserveSpec(selected))} onReleaseReservation={id => setDialog(releaseSpec(selected, id))}
        onPurchase={id => go('procurement', id)} onClaim={(id, section) => section ? go('claims', id, { section }) : go('claims', id)} canClaims={session.canAccessView(View.Claims)} />
    : <EmptyState icon={Boxes} title={uiText(loading ? '正在读取库存' : '未选择批次')} compact />;

  return <Nav.Provider value={{ ...nav, route: { ...route, id: receipt || invalidSource ? undefined : route.id } }}><MistPage width="wide">
    <PageHeader description={uiText(hasClaim ? invalidSource ? '退货来源不匹配' : claim?.code : route.section ? f?.purchases.find(purchase => purchase.id === route.section)?.code : undefined)} eyebrow={uiText("订单履约 · 库存")} title={uiText("库存与仓储")}
      actions={<>{back}<Button icon={Download} disabled={!rows.length} onClick={exportRows}>{uiText("导出")}</Button><Button icon={Warehouse} onClick={() => setCatalog(true)}>{uiText("仓库目录")}</Button>{can && <Button icon={Plus} disabled={locked} onClick={() => editor.open(warehouseSpec())}>{uiText("新增仓库")}</Button>}{can && !hasClaim && <Button variant="primary" icon={PackagePlus} disabled={locked} onClick={() => editor.open(otherReceiptSpec())}>{uiText("其他入库")}</Button>}</>} />
    {error&&error!==presentedError && <FailureNotice title={"库存读取未完成"} detail={error} retry={() => void refresh()} />}
    {hasClaim && !f?.warehouses.length && <div className="mist-section"><Banner tone="warn" title={uiText("尚无真实仓库")}>{uiText("请先登记，再返回案件选择退货仓库。")}</Banner></div>}
    {hasClaim && !invalidSource && <div className="mist-section"><Card><div className="mist-card-body mist-col">
      <div className="mist-row" style={{ flexWrap: 'wrap' }}><span className="mist-eyebrow">{uiText("退货收货 · ")}{claim?.code}</span><span className="mist-spacer" /></div>
      <div className="mist-row" style={{ flexWrap: 'wrap' }}>
        <Select aria-label={uiText("退货条目")} value={selectedGoods} onChange={event => setSelectedGoods(event.target.value)} options={[emptyOption, ...claimGoods.map(goods => ({ value: goods.id, label: `${f?.returnReceipts.find(rt => rt.id === goods.returnReceiptId)?.code || '退货单不可用'} · ${goods.source!.style} · 批准${goods.quantity}${goods.unit} / 已收${goods.receivedQuantity || 0}${goods.unit}` }))]} />
        {can && <Button variant="primary" icon={PackageMinus} disabled={receivingBlocked} title={uiText(receivingReason || undefined)} onClick={receive}>{uiText("登记收货")}</Button>}
      </div>
      {can && receivingBlocked && receivingReason && !['请先选择退货条目','本条目已全部收货'].includes(receivingReason) && <span className="mist-note">{uiText("登记收货：")}{receivingReason}</span>}
    </div></Card></div>}
    {!sourceMode && <div className="mist-domains" role="tablist" aria-label={uiText("库存业务板块")}>
      {(['fabric', 'garment'] as const).map(value => { const m = metrics(value); return <CardButton key={value} role="tab" aria-selected={domain === value} className="mist-domain" onClick={() => changeDomain(value)}>
        <span className="mist-domain-h"><Tile icon={value === 'fabric' ? Layers : Shirt} tone={domain === value ? 'accent' : undefined} /><b>{DOMAIN_LABEL[value]}</b><span className="mist-spacer" /><span className="mist-note">{m.count}{uiText(" 个批次 · 按单位分开")}</span></span>
        <span className="mist-domain-nums">
          <span><small>{uiText("可用")}</small><UnitLines totals={m.available} /></span>
          <span><small>{uiText("隔离待处置")}</small><UnitLines totals={m.isolated} tone={m.isolated.length ? 'warn' : undefined} /></span>
          <span><small>{uiText("已出库")}</small><UnitLines totals={m.out} /></span>
        </span>
      </CardButton>; })}
    </div>}
    <Toolbar>
      <SearchField value={query} onChange={setQuery} placeholder={uiText("搜索名称、批号、位置、采购单或退货单")} />
      <Select aria-label={uiText("仓库筛选")} value={warehouseFilter} onChange={event => setWarehouseFilter(event.target.value)} options={[{ value: '', label: '全部仓库' }, ...(f?.warehouses || []).map(row => ({ value: row.id, label: row.code + ' · ' + row.name + (row.active ? '' : '（停用）') }))]} />
      <Dropdown<SourceFilter> label={uiText("来源")} value={sourceFilter} onChange={setSourceFilter} options={[{ value: 'all', label: '全部' }, { value: 'purchase', label: '采购交付入库' }, { value: 'other', label: '其他入库' }, { value: 'claimReturn', label: '退货入库' }]} />
    </Toolbar>
    <Pipeline<StateFilter> value={stateFilter} onChange={setStateFilter} items={[
      { value: 'all', label: '全部批次', count: stateCount('all'), color: 'var(--mist-ink-2)' },
      { value: 'available', label: '可用', count: stateCount('available'), color: 'var(--mist-ok)' },
      { value: 'inspecting', label: '待来料检验', count: stateCount('inspecting'), color: 'var(--mist-accent)' },
      { value: 'isolated', label: '隔离待处置', count: stateCount('isolated'), color: 'var(--mist-warn)' },
      { value: 'cleared', label: '已出清', count: stateCount('cleared'), color: 'var(--mist-ink-3)' },
    ]} />
    <ListDetail drawerOpen={drawer && !!selected} onDrawerClose={() => setDrawer(false)} drawerTitle={selected && state ? stockName(state, selected) : '库存详情'} drawerSub={selected ? `${selected.available} ${selected.unit} 可用` : undefined}
      list={<Card><DataTable ariaLabel={uiText("库存批次列表")} loading={loading} rows={rows} rowKey={stock => stock.id} selectedKey={selected?.id} density="comfy" onRowClick={pick} columns={columns} empty={empty} /></Card>}
      detail={detail} />
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </MistPage></Nav.Provider>;
}

function StockDetail({ stock, issueBlocker, state, can, locked, canClaims, canQc, canFinance, canDecideRecovery, onDecideRecovery, canReserve, canCost, canTransfer, onTransfer, onTransferReceive, onCount, onReserve, onReleaseReservation, onMove, onScrap, onRepair, onHandback, onDispatch, onRepairReturn, onInspect, onRelease, onDispose, onRevokeRecovery, onQc, onPurchase, onClaim, onLinkShipment, onUnlinkShipment, onCorrectShipment }: {
  stock: FulfillmentStock; issueBlocker?: string; state: MistState; can: boolean; locked: boolean; canClaims: boolean; canFinance: boolean;
  onMove: (kind: 'issue' | 'return' | 'move') => void; onScrap: () => void; onRepair:()=>void; onHandback:()=>void; onDispatch:()=>void; onRepairReturn:()=>void; onPurchase: (id: string) => void; onClaim: (id: string, section?: string) => void;
  onInspect:(id:string)=>void; onRelease:(id:string)=>void; onQc:(id:string)=>void; canQc:boolean;
  onLinkShipment:(id:string)=>void; onUnlinkShipment:(id:string)=>void;
  onCorrectShipment:(id:string)=>void; onDispose:(id:string,decision:'scrap'|'supplierReturn')=>void;
  canDecideRecovery:boolean; onDecideRecovery:(id:string)=>void; onRevokeRecovery:(id:string,recovery:boolean)=>void;
  canReserve: boolean; canCost: boolean; canTransfer: boolean; onTransfer: () => void; onTransferReceive: (id: string) => void; onCount: () => void; onReserve: () => void; onReleaseReservation: (id: string) => void;
}) {
  const f = state.fulfillment, returned = isReturn(stock), current = stockState(state, stock), out = stockOutstanding(state, stock), domain = domainOf(state, stock);
  const purchase = f.purchases.find(row => row.id === stock.purchaseId), receipt = f.receipts.find(row => row.id === stock.receiptId);
  const record = f.receivedRecords.find(row => row.stockId === stock.id), sourceClaim = state.platform.claims.find(row => row.id === stock.claimId);
  const goods = state.platform.claimGoods.find(row => row.id === stock.goodsId), disposition = sourceClaim?.dispositions.find(row => row.id === stock.dispositionId);
  const repair=goods&&record?latestClaimRepair(goods,record.id):undefined,isRepair=disposition?.kind==='Repair'&&goods?.destination==='Repair';
  const dispatch=goods&&record?pendingRepairDispatch(goods,record.id):undefined,unrecorded=goods&&record?unrecordedRepairDispatch(goods,record.id):undefined;
  const warehouse = f.warehouses.find(row => row.id === stock.warehouseId);
  const movements = f.stockMovements.filter(movement => movement.stockId === stock.id);
  const disposedQuantity = movements.filter(m=>m.quarantineDisposition&&m.quarantineDisposition.decision!=='release').reduce((n,m)=>round(n+(m.quarantinedQuantity||0)),0);
  const openIssues = movements.filter(movement => movement.kind === 'issue' && stockIssueRemaining(state, movement.id) > 0);
  const writeReason = can ? false : '需要库存写权限';
  const other = stock.sourceKind === 'other', reserved = stockReservedQuantity(stock), free = freeQuantity(stock), cost = canCost ? stockUnitCost(state, stock) : undefined, age = stockAgeDays(stock, businessNow().toISOString());
  const transfers = (f.stockTransfers || []).filter(t => t.stockId === stock.id && t.state === 'inTransit'), reservations = (stock.reservations || []).filter(r => reservationOpen(r) > 0);
  const counting = (f.stockCounts || []).some(c => c.state === 'pending' && c.lines.some(l => l.stockId === stock.id));
  const claimOpen = !!sourceClaim && !['Closed', 'Cancelled'].includes(sourceClaim.state);
  const next: { tone: Tone; title: string; text: string } = returned
    ? isRepair ? {tone:record?.releasedRepairId?'ok':repair?.qc?.result==='fail'?'bad':'warn',title:record?.releasedRepairId?'已交还':!repair?'待维修':!repair.qc?'待复检':repair.qc.result==='pass'?'待交还':'复检不合格',text:''} : record && !record.disposal ? { tone: 'warn', title: '退回隔离库存', text: '待按批准去向处置' } : { tone: 'ok', title: '已按批准去向处置', text: record?.disposal ? `${record.disposal.actor} · ${shortWhen(record.disposal.at)} · ${record.disposal.basis}` : '本批没有待处置数量。' }
    : current === 'inspecting' ? { tone: 'accent', title: `待来料检验 ${stock.locked} ${stock.unit}`, text: '' }
    : current === 'isolated' ? { tone: 'warn', title: `隔离待处置 ${stock.locked} ${stock.unit}`, text: '' }
    : current === 'available' ? { tone: 'accent', title: `可用 ${stock.available} ${stock.unit}`, text: '' }
    : out > 0 && !disposedQuantity ? { tone: 'neutral', title: `已全部出库 · ${out} ${stock.unit}`, text: '' }
    : { tone: 'neutral', title: '已出清', text: '' };
  const returnedReason = '退回隔离库存须按批准去向处置，不能通用领出或移位';
  return <DetailBody data-stock-detail={stock.id} heading={<div>
      <span className="mist-mono mist-muted">{uiText(returned ? returnCode(state, stock) || '退货单不可用' : purchase?.code || '来源采购不可用')}{uiText(stock.batchNumber ? ` · ${stock.batchNumber}` : '')}</span>
      <div className="mist-h2" style={{ fontSize: 19, marginTop: 4 }}>{stockName(state, stock)}</div>
    </div>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={STATE_TONE[current]}>{STATE_LABEL[current]}</Pill><Pill>{uiText(returned ? '退货入库' : other ? OTHER_RECEIPT_REASONS[stock.otherReceipt!.reason] : '采购交付入库')}</Pill>{current === 'available' && age > SLOW_DAYS && <Pill tone="warn">{uiText(`呆滞 ${age} 天`)}</Pill>}{counting && <Pill tone="warn">{uiText('盘点待审批')}</Pill>}{domain && <Pill>{uiText(domain === 'fabric' ? '面料业务' : '成衣业务')}</Pill>}{out > 0 && <Pill>{uiText("已出库 ")}{out} {uiText(stock.unit)}</Pill>}</div>
    {(!isRepair||!repair&&!dispatch&&!unrecorded)&&<Banner variant="status" tone={next.tone} title={uiText(next.title)}>{next.text}</Banner>}
    <ActionBar busy={locked} actions={[
      { label: '登记出库', icon: PackageMinus, onClick: () => onMove('issue'), primary: !returned && stock.available > 0, reason: writeReason || (returned ? returnedReason : stock.available <= 0 ? '当前没有可用数量' : issueBlocker || false), hidden: returned },
      { label: '按原出库退回', icon: Undo2, onClick: () => onMove('return'), primary: !returned && stock.available <= 0 && openIssues.some(m=>!m.shipmentLink&&!m.shipmentCorrectionHold), reason: writeReason || (!openIssues.some(m=>!m.shipmentLink&&!m.shipmentCorrectionHold) ? '没有可退回的出库' : false), hidden: returned },
      { label: '登记移位', icon: ArrowRightLeft, onClick: () => onMove('move'), reason: writeReason || (stock.available <= 0 ? '当前没有可用数量' : false), hidden: returned },
      { label: '仓库调拨', icon: Truck, onClick: onTransfer, reason: writeReason || (free <= 0 ? '当前没有可调拨数量' : !canTransfer ? '没有其他启用仓库' : false), hidden: returned },
      { label: '预留', icon: Bookmark, onClick: onReserve, reason: !canReserve ? '需要订单写权限' : free <= 0 ? '当前没有可预留数量' : false, hidden: returned },
      { label: '盘点', icon: ClipboardCheck, onClick: onCount, reason: writeReason || (counting ? '有盘点待审批' : stock.available <= 0 ? '当前没有在库数量' : false), hidden: returned },
      {label:'外送维修',onClick:onDispatch,hidden:!isRepair||!record||!!record.releasedRepairId||!!dispatch||!!unrecorded||!!repair&&!repair.qc||!can,reason:!claimOpen?'来源案件已结束':false},
      {label:'送修返库',onClick:onRepairReturn,primary:true,hidden:!isRepair||!record||!dispatch||!can,reason:!claimOpen?'来源案件已结束':false},
      {label:!unrecorded&&repair?.qc?.result==='pass'?'重新维修':'登记维修',onClick:onRepair,primary:repair?.qc?.result!=='pass',hidden:!isRepair||!record||!!record.releasedRepairId||!!dispatch||!!repair&&!repair.qc&&!unrecorded||!can,reason:!claimOpen?'来源案件已结束':false},
      {label:'登记交还',onClick:onHandback,primary:true,hidden:!isRepair||!record||!!record.releasedRepairId||repair?.qc?.result!=='pass'||!!dispatch||!!unrecorded||!can,reason:!claimOpen?'来源案件已结束':false},
      { label: '登记本批报废', icon: Trash2, onClick: onScrap, primary: true, reason: writeReason || (!claimOpen ? '来源案件已结束' : false), hidden: !returned || !record || !!record.disposal || goods?.destination !== 'Scrap' || !can },
    ]} />
    {isRepair&&goods&&record&&<ClaimRepairWork goods={goods} state={state} receivedEventId={record.id} busy={locked}/>}
    {returned
      ? <KeyValue items={[{ label: '来源订单', value: <SourceLink source={{ kind: 'orderLine', orderId: stock.orderId, lineId: stock.lineId }} /> }, { label: '正式退货单', value: returnCode(state, stock) || '不可用' }, { label: '来源案件', value: sourceClaim?.code || '不可用' }, { label: '来源CI', value: state.invoices.find(invoice => invoice.id === stock.invoiceId)?.code || '来源发票不可用' }, { label: '来源出运', value: f.shipments.find(shipment => shipment.id === record?.source.shipmentId)?.code || '来源出运不可用' }, { label: '批号', value: stock.batchNumber }, { label: '累计入库', value: `${stock.quantity} ${stock.unit}` }, { label: '在库数量', value: `${stock.onHand} ${stock.unit}` }, { label: '隔离数量', value: `${stock.locked} ${stock.unit}` }, { label: '可用数量', value: `${stock.available} ${stock.unit}` }, { label: '仓库', value: warehouse ? `${warehouse.code} · ${warehouse.name}` : '仓库不可用' }, { label: '位置', value: stock.location }, { label: '货权', value: stock.owner }, { label: '货权确认日期', value: stock.ownershipDate }, { label: '货权依据', value: stock.ownershipEvidence }, { label: '计量单位', value: stock.unit }]} />
      : <Facts items={[
        { label: '来源订单条目', value: <SourceLink source={{ kind: 'orderLine', orderId: stock.orderId, lineId: stock.lineId }} /> },
        other ? { label: '来源', value: stock.otherReceipt!.source } : { label: '来源采购', value: purchase ? <TextLink onClick={() => onPurchase(purchase.id)}>{purchase.code} · {purchase.supplier}</TextLink> : '来源采购不可用' },
        { label: '入库日期 / 库龄', value: `${receipt?.date || shortWhen(stock.createdAt)} · ${age} 天` },
        ...(stock.dyeLot || stock.shade ? [{ label: '缸号 / 色号', value: [stock.dyeLot, stock.shade].filter(Boolean).join(' · ') }] : []),
        { label: '累计入库', value: `${stock.quantity} ${stock.unit}` },
        { label: '当前可用', value: reserved > 0 ? `${stock.available} ${stock.unit}（已预留 ${reserved}）` : `${stock.available} ${stock.unit}` },
        ...(transfers.length ? [{ label: '调拨在途', value: `${stockInTransit(state, stock.id)} ${stock.unit}` }] : []),
        ...(cost ? [{ label: '库存金额', value: `${round(cost.unitCost * stock.available)} ${cost.currency}（${cost.unitCost} / ${stock.unit}）` }] : []),
        ...(cost && (stock.locked || 0) > 0 ? [{ label: '隔离货值', value: `${round(cost.unitCost * stock.locked!)} ${cost.currency}` }] : []),
        ...((stock.locked || 0) > 0 ? [{ label: '隔离待处置', value: `${stock.locked} ${stock.unit}` }] : []),
        ...(disposedQuantity > 0 ? [{ label: '退供 / 报废', value: `${disposedQuantity} ${stock.unit}` }] : []),
        { label: '已出库（净）', value: out > 0 ? `${out} ${stock.unit}` : '无' },
        { label: '仓库 / 位置', value: `${warehouse ? `${warehouse.name} · ` : ''}${stock.location || '位置未记录'}` },
        { label: '货权', value: stock.owner },
      ]} />}
    {receipt?.evidence && !returned && <p className="mist-sub">{uiText("入库依据：")}{receipt.evidence}</p>}
    {other && <p className="mist-sub">{uiText("入库依据：")}{stock.otherReceipt!.evidence}</p>}
    <PositionSummary row={stock} />
    {transfers.length > 0 && <DetailBlock title={uiText('调拨在途')}>
      <DataTable ariaLabel={uiText('调拨在途')} rows={transfers} rowKey={t => t.id} columns={[
        { key: 'code', header: '调拨单', render: t => <Mono>{t.code}</Mono> },
        { key: 'to', header: '调入', render: t => `${f.warehouses.find(w => w.id === t.toWarehouseId)?.name || ''} · ${t.toLocation}` },
        { key: 'qty', header: '数量', align: 'right', render: t => `${t.quantity} ${stock.unit}` },
        { key: 'act', header: '', align: 'right', render: t => can ? <Button size="sm" disabled={locked} onClick={() => onTransferReceive(t.id)}>{uiText('到仓')}</Button> : '—' },
      ]} />
    </DetailBlock>}
    {reservations.length > 0 && <DetailBlock title={uiText('预留')}>
      <DataTable ariaLabel={uiText('预留')} rows={reservations} rowKey={r => r.id} columns={[
        { key: 'line', header: '订单条目', render: r => <SourceLink source={{ kind: 'orderLine', orderId: r.orderId, lineId: r.lineId }} /> },
        { key: 'purpose', header: '用途', hideOnMobile: true, render: r => r.purpose },
        { key: 'qty', header: '未用', align: 'right', render: r => `${reservationOpen(r)} ${stock.unit}` },
        { key: 'act', header: '', align: 'right', render: r => canReserve ? <Button size="sm" disabled={locked} onClick={() => onReleaseReservation(r.id)}>{uiText('释放')}</Button> : '—' },
      ]} />
    </DetailBlock>}
    {!!stock.rolls?.length && <DetailBlock title={uiText(`码单 · ${stock.rolls.length} 卷`)}>
      <DataTable ariaLabel={uiText('码单')} rows={stock.rolls} rowKey={r => r.roll} columns={[
        { key: 'roll', header: '卷号', render: r => <Mono>{r.roll}</Mono> },
        { key: 'qty', header: '数量', align: 'right', render: r => `${r.quantity} ${stock.unit}` },
        { key: 'kg', header: '公斤', align: 'right', render: r => r.weightKg ?? '—' },
      ]} />
    </DetailBlock>}
    {movements.some(m=>m.quarantinedQuantity) && <DetailBlock title={uiText('退料复检')}>
      {movements.filter(m=>m.quarantinedQuantity).map(m=>{const task=state.fulfillment.qcTasks.find(t=>t.id===m.quarantineTaskId), report=task&&state.fulfillment.qcReports.find(r=>r.id===task.reportIds.at(-1));return <div className="mist-col" key={m.id}>
        <div className="mist-row"><span>{m.quarantinedQuantity} {stock.unit} · {m.location}</span><Pill tone={m.quarantineDisposition?'ok':report?.result==='reject'?'bad':'warn'}>{m.quarantineDisposition?({release:'已恢复可用',supplierReturn:'已退供应商',scrap:'已报废'} as const)[m.quarantineDisposition.decision]:report?.result==='pass'?'复检通过':report?.result==='reject'?'复检未通过':report?.result==='conditional'?'复检有保留':m.quarantineTaskId?'待复检':'待送检'}</Pill></div>
        <div className="mist-row">{can&&!m.quarantineTaskId&&!m.quarantineDisposition&&<Button disabled={locked} onClick={()=>onInspect(m.id)}>{uiText('送复检')}</Button>}{m.quarantineTaskId&&canQc&&<Button variant="quiet" onClick={()=>onQc(m.quarantineTaskId!)}>{uiText('查看复检')}</Button>}{can&&!m.quarantineDisposition&&report?.result==='pass'&&<Button disabled={locked} onClick={()=>onRelease(m.id)}>{uiText('恢复可用')}</Button>}{can&&!m.quarantineDisposition&&report?.result==='reject'&&<><Button disabled={locked} onClick={()=>onDispose(m.id,'supplierReturn')}>{uiText('退供应商')}</Button><Button disabled={locked} onClick={()=>onDispose(m.id,'scrap')}>{uiText('报废')}</Button></>}</div>
        {m.quarantineDisposition&&<div>{m.quarantineDisposition.evidence}{m.quarantineDisposition.decision!=='release'&&canFinance&&(m.quarantineDisposition.financeReviews?.some(r=>!r.reversed)?' · 财务已核对':' · 采购结算待核对')}</div>}
        {m.quarantineDisposition&&m.quarantineDisposition.decision!=='release'&&(()=>{const d=m.quarantineDisposition!,decided=d.recoveryDecision||d.noRecoveryDecision,reviewed=d.financeReviews?.some(r=>!r.reversed);return <div className="mist-row">{decided?<><span>{d.recoveryDecision?`${uiText('追偿')} ${d.recoveryDecision.amount} ${d.recoveryDecision.currency} · ${d.recoveryDecision.actor} · ${d.recoveryDecision.reason}`:`${uiText('不追偿')} · ${d.noRecoveryDecision!.actor} · ${d.noRecoveryDecision!.evidence}`}</span>{canDecideRecovery&&canFinance&&!reviewed&&<Button disabled={locked} size="sm" onClick={()=>onRevokeRecovery(m.id,!!d.recoveryDecision)}>{uiText('撤回决定')}</Button>}</>:canDecideRecovery&&<Button disabled={locked} size="sm" onClick={()=>onDecideRecovery(m.id)}>{uiText('追偿决定')}</Button>}</div>;})()}
      </div>;})}
    </DetailBlock>}
    {openIssues.length > 0 && <DetailBlock title={uiText("出库去向")}>
      <DataTable ariaLabel={uiText("出库去向")} rows={openIssues} rowKey={movement => movement.id} columns={[
        { key: 'who', header: '接收方', render: movement => movement.person },
        { key: 'where', header: '交接地点', hideOnMobile: true, render: movement => movement.location },
        { key: 'when', header: '出库日', hideOnMobile: true, render: movement => shortWhen(movement.at) },
        { key: 'left', header: '出库净量', align: 'right', render: movement => `${stockIssueRemaining(state, movement.id)} ${stock.unit}` },
        { key: 'shipment', header: '出运', render: movement => { const ship=f.shipments.find(s=>s.id===movement.shipmentLink?.shipmentId); const branch=state.productions.find(p=>p.sourcePurchaseId===stock.purchaseId&&p.orderId===stock.orderId&&p.lineId===stock.lineId); const canLink=!!branch&&f.shipments.some(s=>s.state!=='cancelled'&&(!movement.shipmentCorrectionHold||s.state==='departed')&&s.lines.some(l=>l.orderId===stock.orderId&&l.lineId===stock.lineId&&l.productionId===branch.id)); return movement.shipmentLink ? <span>{ship?.code||'已关联出运'}{can&&ship&&ship.state==='departed'&&<Button size="sm" disabled={locked} onClick={()=>onCorrectShipment(movement.id)}>{uiText('更正')}</Button>}{can&&ship&&ship.state!=='departed'&&ship.state!=='cancelled'&&<Button size="sm" disabled={locked} onClick={()=>onUnlinkShipment(movement.id)}>{uiText('解除')}</Button>}</span> : !movement.materialDelivery&&!returned&&can&&canLink ? <span>{movement.shipmentCorrectionHold&&uiText('待核对 · ')}<Button size="sm" disabled={locked} onClick={()=>onLinkShipment(movement.id)}>{uiText('关联出运')}</Button></span> : movement.shipmentCorrectionHold?'待核对':'—'; } },
      ]} />
    </DetailBlock>}
    {movements.some(m=>m.shipmentLinkHistory?.length) && <DetailBlock title={uiText('出运关联更正记录')}><Timeline events={movements.flatMap(m=>(m.shipmentLinkHistory||[]).map(h=>({who:h.unlinkedBy,when:businessWhen(h.unlinkedAt),text:`原关联 ${f.shipments.find(s=>s.id===h.shipmentId)?.code||'出运不可见'} · ${h.unlinkReason} · 原依据：${h.evidence}${h.correctionEvidence?` · 更正依据：${h.correctionEvidence}`:''}${h.correctedShipmentId?` · 更正为 ${f.shipments.find(s=>s.id===h.correctedShipmentId)?.code||'出运不可见'}`:''}`})))} /></DetailBlock>}
    {record && <DetailBlock title={uiText("收货与处置凭据")}><RecordFiles ids={[...record.fileIds, ...(record.disposal?.fileIds || [])]} /></DetailBlock>}
    {returned && <div className="mist-row mist-module-actions">{sourceClaim && canClaims && <Button onClick={() => onClaim(sourceClaim.id)}>{uiText("查看案件")}</Button>}{disposition?.creditNoteId && sourceClaim && canClaims && <Button onClick={() => onClaim(sourceClaim.id, 'credit:' + disposition.creditNoteId)}>{uiText("查看来源CN")}</Button>}</div>}
    <DetailBlock title={uiText("出入库流水")}>
      {movements.length ? <Timeline events={movements.slice().reverse().map(movement => ({ who: movement.actor, when: businessWhen(movement.at), text: `${movement.kind==='reject'&&movement.quarantineReturnId?'退供应商':MOVE_LABEL[movement.kind]} ${movement.kind==='adjust'&&movement.quantity>0?'+':''}${movement.quantity}${stock.unit} · ${movement.location} · ${movement.note}${movement.quarantinedQuantity ? ` · 隔离 ${movement.quarantinedQuantity}${stock.unit}` : ''}${movement.onHandBefore === undefined ? '' : ` · 现存 ${movement.onHandBefore}→${movement.onHandAfter} / 隔离 ${movement.lockedBefore}→${movement.lockedAfter}`}` }))} /> : <span className="mist-note">{uiText("还没有流水")}</span>}
    </DetailBlock>
  </DetailBody>;
}
const returnCode = (state: MistState, stock: FulfillmentStock) => state.fulfillment.returnReceipts.find(rt => rt.id === stock.returnReceiptId)?.code;
