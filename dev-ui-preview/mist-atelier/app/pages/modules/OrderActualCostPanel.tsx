import type {InternalFabricCostBasis} from '../../../../../server/src/shared/mistInternalFabric';
import { interfaceLocale } from '../../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 订单核算：费用台账（按出运 / 按订单分摊）+ 每单实际成本与毛利（人民币管理口径）。 */
import React from 'react';
import { Plus, Receipt, TrendingUp, Truck, Wallet } from 'lucide-react';
import { Banner, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Dialog, Drawer, EmptyState, Facts, Field, FormGrid, Pill, Select, StatCard, StatGrid, TextInput, Toolbar, useToast, type Column } from '../../../../../components/mist';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { FX_BASIS_LABEL, type FxBasis } from '../../../../../server/src/shared/mistFxRates';
import { ALLOCATION_BASES, EXPENSE_CATEGORIES, activeExpenses, expensePayableBill, orderActualCost, orderExpenses, type AllocationBasis, type ExpenseCategory, type OrderActualCost, type OrderCostLine, type OrderExpense } from '../../../../../server/src/shared/mistOrderCost';
import { downloadModuleCsv } from './ModuleWorkbench';

const money = (v: number) => v.toLocaleString(interfaceLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cnyCell = (v: number | null) => v === null ? <span className="mist-note">—</span> : money(v);
const pct = (r: number | null) => r === null ? '—' : (r * 100).toFixed(1) + '%';
const SHIPMENT_BASES: AllocationBasis[] = ['volume', 'weight', 'value', 'quantity', 'equal', 'manual'];
const ORDER_BASES: AllocationBasis[] = ['value', 'quantity', 'equal', 'manual'];

export function OrderActualCostPanel({ state, asOf, canWrite, busy, run,materialCostBasis,initialOrderId }: { materialCostBasis?:ReadonlyArray<InternalFabricCostBasis>|null;initialOrderId?:string;state: MistState; asOf: string; canWrite: boolean; busy: boolean; run: (c: MistCommand) => Promise<unknown> }) {
  const toast = useToast();
  const [basisChoice, setBasis] = React.useState<FxBasis | null>(null), [month, setMonth] = React.useState(asOf.slice(0, 7));
  const basis: FxBasis = basisChoice ?? ((state.fxRecords || []).some(r => r.kind === 'settlement' && !r.reversed) ? 'actual' : 'period');
  const [open, setOpen] = React.useState<string | null>(initialOrderId ?? null), [register, setRegister] = React.useState(false), [voiding, setVoiding] = React.useState<OrderExpense | null>(null), [reason, setReason] = React.useState(''), [showVoided, setShowVoided] = React.useState(false), [paying, setPaying] = React.useState<OrderExpense | null>(null), [payForm, setPayForm] = React.useState({ supplierId: '', invoiceNo: '', due: '', taxAmount: '' });
  if(materialCostBasis===null)return <div className="mist-col"><Banner tone="warn" title={uiText(state.partialExpenses !== undefined ? '当前范围无法核对完整成本' : '内部供料成本依据未读取')}/>{(state.partialExpenses?.length ?? 0)>0 && <Card><CardHeader title={uiText('部分可见费用')} /><div className="mist-card-body mist-col" role="list" aria-label={uiText('部分可见费用')}>{state.partialExpenses!.map(expense=><div className="mist-col" role="listitem" key={expense.id}><div className="mist-row"><span>{expense.code} · {EXPENSE_CATEGORIES[expense.category]}</span><span className="mist-spacer"/><span>{ui`另有 ${expense.hiddenCount} 笔其他范围业务`}</span></div>{expense.shares.map(share=><div className="mist-row" key={share.orderId}><span>{share.orderCode}</span><span className="mist-spacer"/><span>{money(share.amount)} {expense.currency}</span></div>)}</div>)}</div></Card>}</div>;
  const orders = state.orders.filter(o => !o.governance || o.governance.status === 'approved');
  const rows = orders.map(o => orderActualCost(state, o.id, basis, month, asOf,materialCostBasis)).sort((a, b) => ({ ok: 0, norate: 1 }[a.status] - { ok: 0, norate: 1 }[b.status]) || (a.rateIn ?? 0) - (b.rateIn ?? 0) || a.code.localeCompare(b.code));
  const ok = rows.filter(r => r.status === 'ok' && !r.internal), internalRows = rows.filter(r => r.status === 'ok' && r.internal), total = (pick: (r: OrderActualCost) => number | null, list = ok) => Math.round(list.reduce((n, r) => n + (pick(r) ?? 0) * 100, 0)) / 100;
  const t = { revenue: total(r => r.revenueCny), purchase: total(r => r.purchaseCny), expense: total(r => r.expenseCny), margin: total(r => r.marginIn), internalCost: total(r => r.costCny, internalRows) };
  const expenses = showVoided ? orderExpenses(state) : activeExpenses(state);
  const detail = rows.find(r => r.orderId === open);
  const columns: Column<OrderActualCost>[] = [
    { key: 'code', header: '订单', render: r => <div className="mist-col" style={{ gap: 2 }}><b>{r.code}</b><small className="mist-muted">{r.customer}</small></div> },
    { key: 'rev', header: '收入 CNY', align: 'right', render: r => r.internal ? <Pill tone="neutral">{uiText("内部订单")}</Pill> : cnyCell(r.revenueCny) },
    { key: 'pur', header: '采购 CNY', align: 'right', render: r => cnyCell(r.purchaseCny) },
    { key: 'exp', header: '费用 CNY', align: 'right', render: r => r.expenses.length ? cnyCell(r.expenseCny) : <span className="mist-note">{uiText("未登记")}</span> },
    { key: 'rebate', header: '退税', align: 'right', render: r => !r.internal && r.rebate.used ? money(r.rebate.used) : '—' },
    { key: 'margin', header: '实际毛利（含退税）', align: 'right', render: r => r.internal ? <span className="mist-note">{uiText("成本 ")}{cnyCell(r.costCny)}</span> : r.marginIn === null ? <span className="mist-note">—</span> : <b className={r.marginIn < 0 ? 'mist-tone-bad' : undefined}>{money(r.marginIn)}</b>, sortValue: r => r.internal ? -Infinity : r.marginIn ?? -Infinity },
    { key: 'rate', header: '毛利率', align: 'right', render: r => pct(r.rateIn) },
    { key: 'status', header: '状态', render: r => r.status === 'norate' ? <Pill tone="warn">{uiText("缺 ")}{r.missing.join('、')}{uiText(" 汇率")}</Pill> : r.estimated ? <Pill tone="neutral">{uiText("含暂估")}</Pill> : <Pill tone="ok">{uiText("无暂估")}</Pill> },
  ];
  const expenseColumns: Column<OrderExpense>[] = [
    { key: 'code', header: '编号', render: e => <div className="mist-col" style={{ gap: 2 }}><b>{e.code}</b><small className="mist-muted">{e.date}</small></div> },
    { key: 'cat', header: '类别', render: e => EXPENSE_CATEGORIES[e.category] },
    { key: 'vendor', header: '收款方 / 单据', render: e => [e.vendor, e.ref].filter(Boolean).join(' · ') || '—' },
    { key: 'amount', header: '金额', align: 'right', render: e => `${e.currency} ${money(e.amount)}` },
    { key: 'scope', header: '分摊', render: e => <div className="mist-col" style={{ gap: 2 }}><span>{uiText(e.scope === 'shipment' ? `出运 ${e.shipmentCode}` : '指定订单')} · {ALLOCATION_BASES[e.basis]}</span><small className="mist-muted">{e.shares.map(s => `${s.orderCode} ${money(s.amount)}`).join('；')}</small></div> },
    { key: 'payable', header: '应付', render: e => { const bill = expensePayableBill(state, e); return bill ? <Pill tone="ok">{bill.code}</Pill> : e.voided ? null : canWrite ? <Button size="sm" variant="quiet" disabled={busy} aria-label={ui`转应付 ${e.code}`} onClick={() => { setPayForm({ supplierId: (state.market?.suppliers || []).find(x => x.name === e.vendor)?.id || '', invoiceNo: e.ref, due: '', taxAmount: '' }); setPaying(e); }}>{uiText("转应付")}</Button> : <span className="mist-note">{uiText("未转")}</span>; } },
    { key: 'state', header: '', render: e => e.voided ? <Pill tone="neutral">{uiText("已作废")}</Pill> : canWrite && !expensePayableBill(state, e) ? <Button size="sm" variant="quiet" disabled={busy} aria-label={ui`作废 ${e.code}`} onClick={() => { setReason(''); setVoiding(e); }}>{uiText("作废")}</Button> : null },
  ];
  const exportCsv = () => downloadModuleCsv(`订单核算-${FX_BASIS_LABEL[basis]}-${asOf}.csv`, ['订单', '客户', '类型', '收入CNY', '采购CNY', '费用CNY', '退税CNY', '毛利不含退税', '毛利含退税', '毛利率%', '状态'],
    rows.map(r => [r.code, r.customer, r.internal ? '内部订单' : '对外订单', r.internal ? '' : r.revenueCny ?? '', r.purchaseCny ?? '', r.expenseCny ?? '', r.internal ? '' : r.rebate.used, r.marginEx ?? '', r.marginIn ?? '', r.rateIn === null ? '' : (r.rateIn * 100).toFixed(1), r.status === 'norate' ? '缺汇率' : r.estimated ? '含暂估' : '无暂估']));
  const doPayable = async () => { if (!paying) return; await run({ type: 'cost.expense.payable', payload: { id: paying.id, supplierId: payForm.supplierId, invoiceNo: payForm.invoiceNo, due: payForm.due, taxAmount: payForm.taxAmount } } as MistCommand); setPaying(null); toast('已转入应付待办，可按票申请付款'); };
  const doVoid = async () => { if (!voiding) return; await run({ type: 'cost.expense.void', payload: { id: voiding.id, reason } } as MistCommand); setVoiding(null); toast('费用已作废'); };
  return <div data-order-actual-cost>
    <Toolbar right={<span className="mist-row">{canWrite && <Button icon={Plus} variant="primary" disabled={busy} onClick={() => setRegister(true)}>{uiText("登记费用")}</Button>}<Button onClick={exportCsv}>{uiText("导出核算")}</Button></span>}>
      <Field label={uiText("折算口径")}><Select aria-label={uiText("核算折算口径")} value={basis} onChange={e => setBasis(e.target.value as FxBasis)} options={(['actual', 'period', 'quote'] as FxBasis[]).map(b => ({ value: b, label: `人民币 · ${FX_BASIS_LABEL[b]}` }))} /></Field>
      {basis !== 'quote' && <Field label={uiText("暂估月份")}><TextInput type="month" aria-label={uiText("核算暂估月份")} value={month} onChange={e => setMonth(e.target.value)} /></Field>}
    </Toolbar>
    <StatGrid>
      <StatCard icon={Wallet} label={ui`收入 CNY · ${ok.length} 单`} value={money(t.revenue)} />
      <StatCard icon={Receipt} label={uiText("采购成本")} value={money(t.purchase)} />
      <StatCard icon={Truck} label={uiText("分摊费用")} value={money(t.expense)} />
      <StatCard icon={TrendingUp} label={uiText("实际毛利 · 含退税")} value={`${money(t.margin)}（${pct(t.revenue ? t.margin / t.revenue : null)}）`} />
      {internalRows.length > 0 && <StatCard icon={Receipt} label={ui`内部订单成本 · ${internalRows.length} 单`} value={money(t.internalCost)} />}
    </StatGrid>
    <section className="mist-section"><Card><CardHeader title={uiText("订单实际核算")} />
      <DataTable ariaLabel={uiText("订单实际核算")} rows={rows} rowKey={r => r.orderId} columns={columns} onRowClick={r => setOpen(r.orderId)} empty={<EmptyState title={uiText("没有已生效订单")} compact />} />
    </Card></section>
    <section className="mist-section"><Card><CardHeader title={uiText("费用台账")} tools={<Checkbox checked={showVoided} onChange={setShowVoided} label={uiText("显示已作废")} />} />
      <DataTable ariaLabel={uiText("费用台账")} rows={expenses} rowKey={e => e.id} columns={expenseColumns} empty={<EmptyState title={uiText("还没有登记费用")} compact />} />
    </Card></section>
    <Drawer open={!!detail} onClose={() => setOpen(null)} size="lg" title={uiText(detail ? `${detail.code} 实际核算` : '实际核算')} sub={detail?[detail.customer,uiText(FX_BASIS_LABEL[basis]),...(detail.estimated?[uiText('含暂估')]:[])].join(' · '):undefined}>
      {detail && <div className="mist-content-flow" data-order-cost-detail={detail.orderId}>
        {(detail.internal ? (['purchases', 'expenses'] as const) : (['revenue', 'purchases', 'expenses'] as const)).map(k => <CostBlock key={k} title={uiText({ revenue: '收入', purchases: '采购成本', expenses: '分摊费用' }[k])} rows={detail[k]} />)}
        {detail.internal ? <Card><CardBody><Facts items={[{label:uiText('实际成本'),value:cnyCell(detail.costCny)}]}/></CardBody></Card> : <>
        <Card><CardHeader title={uiText("出口退税")} sub={ui`应退 ${money(detail.rebate.expected)} · 核准 ${money(detail.rebate.approved)} · 已到账 ${money(detail.rebate.received)}`} /></Card>
        <Card><CardBody><Facts items={[
          {label:uiText('毛利 · 不含退税'),value:detail.marginEx===null?'—':money(detail.marginEx)},
          {label:uiText('毛利 · 含退税'),value:detail.marginIn===null?'—':money(detail.marginIn)},
          ...(detail.rateIn===null?[]:[{label:uiText('毛利率'),value:pct(detail.rateIn)}]),
        ]}/></CardBody></Card></>}
      </div>}
    </Drawer>
    {register && <RegisterExpense state={state} asOf={asOf} busy={busy} run={run} onClose={() => setRegister(false)} onDone={() => { setRegister(false); toast('费用已登记并分摊'); }} />}
    <Dialog open={!!voiding} onClose={() => setVoiding(null)} tone="bad" title={ui`作废 ${voiding?.code ?? ''}`} description={uiText("作废后不再计入订单成本，原记录保留。")} footer={<><Button onClick={() => setVoiding(null)}>{uiText("取消")}</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void doVoid().catch(() => undefined)}>{uiText("作废")}</Button></>}>
      <Field label={uiText("作废原因")}><TextInput aria-label={uiText("作废原因")} value={reason} onChange={e => setReason(e.target.value)} /></Field>
    </Dialog>
    <Dialog open={!!paying} onClose={() => setPaying(null)} title={ui`转应付 ${paying?.code ?? ''}`} description={uiText(paying ? `${EXPENSE_CATEGORIES[paying.category]} · ${paying.amount} ${paying.currency}。生成应付票据后在「财务管理 › 应付待办」按票申请付款；成本仍按费用台账计，不重复计入。` : undefined)} footer={<><Button onClick={() => setPaying(null)}>{uiText("取消")}</Button><Button variant="primary" disabled={busy || !payForm.supplierId || !payForm.invoiceNo.trim() || !payForm.due} onClick={() => void doPayable().catch(() => undefined)}>{uiText("转应付")}</Button></>}>
      <FormGrid>
        <Field label={uiText("收款供应商")} required hint={uiText("货代、报关行等须先在供应商管理建档")}><Select aria-label={uiText("收款供应商")} value={payForm.supplierId} onChange={e => setPayForm({ ...payForm, supplierId: e.target.value })} options={[{ value: '', label: '选择供应商' }, ...(state.market?.suppliers || []).map(x => ({ value: x.id, label: `${x.code} · ${x.name}` }))]} /></Field>
        <Field label={uiText("发票号")} required><TextInput aria-label={uiText("发票号")} value={payForm.invoiceNo} onChange={e => setPayForm({ ...payForm, invoiceNo: e.target.value })} /></Field>
        <Field label={uiText("付款到期日")} required><TextInput aria-label={uiText("付款到期日")} type="date" value={payForm.due} onChange={e => setPayForm({ ...payForm, due: e.target.value })} /></Field>
        <Field label={uiText("税额")}><TextInput aria-label={uiText("税额")} type="number" step="0.01" value={payForm.taxAmount} onChange={e => setPayForm({ ...payForm, taxAmount: e.target.value })} /></Field>
      </FormGrid>
    </Dialog>
  </div>;
}

function CostBlock({ title, rows }: { title: string; rows: OrderCostLine[] }) {
  const cols: Column<OrderCostLine>[] = [
    { key: 'label', header: '项目', render: r => <span>{uiText(r.label)}{r.estimated ? <Pill tone="neutral">{uiText("暂估")}</Pill> : null}</span> },
    { key: 'amount', header: '原币', align: 'right', render: r => `${r.currency} ${money(r.amount)}` },
    { key: 'cny', header: 'CNY', align: 'right', render: r => cnyCell(r.cny) },
  ];
  const sources=[...new Map(rows.filter(r=>r.fx).map(r=>[r.currency+' '+r.fx!.label,r])).values()];
  return <section className="mist-section"><Card><CardHeader title={uiText(title)} />{sources.length>0&&<CardBody><Facts items={sources.map(r=>({label:uiText("汇率依据"),value:r.currency+" · "+uiText(r.fx!.label.replace(/（暂估）$/,''))}))}/></CardBody>}<DataTable ariaLabel={uiText(title)} rows={rows} rowKey={r => r.key} columns={cols} empty={<EmptyState title={uiText("无")} compact />} /></Card></section>;
}

function RegisterExpense({ state, asOf, busy, run, onClose, onDone }: { state: MistState; asOf: string; busy: boolean; run: (c: MistCommand) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const shipments = state.fulfillment.shipments.filter(s => s.state !== 'cancelled');
  const orders = state.orders.filter(o => !o.governance || o.governance.status === 'approved');
  const [v, setV] = React.useState({ category: 'freight' as ExpenseCategory, vendor: '', ref: '', date: asOf, currency: 'USD', amount: '', note: '', scope: (shipments.length ? 'shipment' : 'orders') as 'shipment' | 'orders', shipmentId: '', basis: 'volume' as AllocationBasis });
  const [picked, setPicked] = React.useState<string[]>([]), [manual, setManual] = React.useState<Record<string, string>>({}), [error, setError] = React.useState('');
  const set = (patch: Partial<typeof v>) => setV(x => ({ ...x, ...patch }));
  const bases = v.scope === 'shipment' ? SHIPMENT_BASES : ORDER_BASES;
  const scopeOrders = v.scope === 'shipment' ? [...new Set(shipments.find(s => s.id === v.shipmentId)?.lines.map(l => l.orderId) ?? [])] : picked;
  const code = (id: string) => state.orders.find(o => o.id === id)?.code ?? id;
  const submit = async () => {
    setError('');
    try {
      await run({ type: 'cost.expense.register', payload: { ...v, amount: v.amount, ...(v.scope === 'shipment' ? { shipmentId: v.shipmentId } : { orderIds: picked }), ...(v.basis === 'manual' ? { manual: scopeOrders.map(orderId => ({ orderId, amount: manual[orderId] ?? '' })) } : {}) } } as MistCommand);
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '登记失败'); }
  };
  return <Dialog open onClose={() => !busy && onClose()} title={uiText("登记费用")} width={640}
    footer={<><Button onClick={onClose}>{uiText("取消")}</Button><Button variant="primary" disabled={busy || !v.amount || !scopeOrders.length} onClick={() => void submit()}>{uiText("登记并分摊")}</Button></>}>
    {error && <Banner tone="bad" title={uiText(error)} />}
    <FormGrid>
      <Field label={uiText("费用类别")}><Select aria-label={uiText("费用类别")} value={v.category} onChange={e => set({ category: e.target.value as ExpenseCategory })} options={Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label={uiText("费用日期")}><TextInput type="date" aria-label={uiText("费用日期")} value={v.date} max={asOf} onChange={e => set({ date: e.target.value })} /></Field>
      <Field label={uiText("币种")}><Select aria-label={uiText("费用币种")} value={v.currency} onChange={e => set({ currency: e.target.value })} options={['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD'].map(c => ({ value: c, label: c }))} /></Field>
      <Field label={uiText("金额")}><TextInput aria-label={uiText("费用金额")} inputMode="decimal" value={v.amount} onChange={e => set({ amount: e.target.value })} /></Field>
      <Field label={uiText("收款方")}><TextInput aria-label={uiText("收款方")} value={v.vendor} onChange={e => set({ vendor: e.target.value })} /></Field>
      <Field label={uiText("发票 / 单据号")}><TextInput aria-label={uiText("发票或单据号")} value={v.ref} onChange={e => set({ ref: e.target.value })} /></Field>
      <Field label={uiText("分摊范围")}><Select aria-label={uiText("分摊范围")} value={v.scope} onChange={e => { const scope = e.target.value as 'shipment' | 'orders'; set({ scope, basis: scope === 'shipment' ? 'volume' : 'value' }); }} options={[{ value: 'shipment', label: '按出运' }, { value: 'orders', label: '按订单' }]} /></Field>
      <Field label={uiText("分摊口径")}><Select aria-label={uiText("分摊口径")} value={v.basis} onChange={e => set({ basis: e.target.value as AllocationBasis })} options={bases.map(b => ({ value: b, label: ALLOCATION_BASES[b] }))} /></Field>
    </FormGrid>
    {v.scope === 'shipment' ? <Field label={uiText("出运")} required><Select aria-label={uiText("出运")} value={v.shipmentId} onChange={e => set({ shipmentId: e.target.value })} options={[{value:'',label:'请选择出运'},...shipments.map(s => ({ value: s.id, label: `${s.code} · ${s.customer}` }))]} /></Field>
      : <div className="mist-col" role="group" aria-label={uiText("选择订单")} style={{ gap: 4, maxHeight: 200, overflow: 'auto' }}>{orders.map(o => <Checkbox key={o.id} checked={picked.includes(o.id)} onChange={c => setPicked(p => c ? [...p, o.id] : p.filter(x => x !== o.id))} label={uiText(`${o.code} · ${o.customer} · ${o.currency}`)} />)}</div>}
    {v.basis === 'manual' && <div className="mist-col" style={{ gap: 4 }}>{scopeOrders.map(id => <Field key={id} label={ui`${code(id)} 分摊金额`}><TextInput aria-label={ui`${code(id)} 分摊金额`} inputMode="decimal" value={manual[id] ?? ''} onChange={e => setManual(m => ({ ...m, [id]: e.target.value }))} /></Field>)}</div>}
    <Field label={uiText("备注")}><TextInput aria-label={uiText("费用备注")} value={v.note} onChange={e => set({ note: e.target.value })} /></Field>
  </Dialog>;
}
