/** 订单核算：费用台账（按出运 / 按订单分摊）+ 每单实际成本与毛利（人民币管理口径）。 */
import React from 'react';
import { Plus, Receipt, TrendingUp, Truck, Wallet } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Checkbox, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, Pill, Select, StatCard, StatGrid, TextInput, Toolbar, useToast, type Column } from '../../../../../components/mist';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { FX_BASIS_LABEL, type FxBasis } from '../../../../../server/src/shared/mistFxRates';
import { ALLOCATION_BASES, EXPENSE_CATEGORIES, activeExpenses, expensePayableBill, orderActualCost, orderExpenses, type AllocationBasis, type ExpenseCategory, type OrderActualCost, type OrderCostLine, type OrderExpense } from '../../../../../server/src/shared/mistOrderCost';
import { downloadModuleCsv } from './ModuleWorkbench';

const money = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cnyCell = (v: number | null) => v === null ? <span className="mist-note">—</span> : money(v);
const pct = (r: number | null) => r === null ? '—' : (r * 100).toFixed(1) + '%';
const SHIPMENT_BASES: AllocationBasis[] = ['volume', 'weight', 'value', 'quantity', 'equal', 'manual'];
const ORDER_BASES: AllocationBasis[] = ['value', 'quantity', 'equal', 'manual'];

export function OrderActualCostPanel({ state, asOf, canWrite, busy, run }: { state: MistState; asOf: string; canWrite: boolean; busy: boolean; run: (c: MistCommand) => Promise<unknown> }) {
  const toast = useToast();
  const [basisChoice, setBasis] = React.useState<FxBasis | null>(null), [month, setMonth] = React.useState(asOf.slice(0, 7));
  const basis: FxBasis = basisChoice ?? ((state.fxRecords || []).some(r => r.kind === 'settlement' && !r.reversed) ? 'actual' : 'period');
  const [open, setOpen] = React.useState<string | null>(null), [register, setRegister] = React.useState(false), [voiding, setVoiding] = React.useState<OrderExpense | null>(null), [reason, setReason] = React.useState(''), [showVoided, setShowVoided] = React.useState(false), [paying, setPaying] = React.useState<OrderExpense | null>(null), [payForm, setPayForm] = React.useState({ supplierId: '', invoiceNo: '', due: '', taxAmount: '' });
  const orders = state.orders.filter(o => !o.governance || o.governance.status === 'approved');
  const rows = orders.map(o => orderActualCost(state, o.id, basis, month, asOf)).sort((a, b) => ({ ok: 0, norate: 1 }[a.status] - { ok: 0, norate: 1 }[b.status]) || (a.rateIn ?? 0) - (b.rateIn ?? 0) || a.code.localeCompare(b.code));
  const ok = rows.filter(r => r.status === 'ok'), total = (pick: (r: OrderActualCost) => number | null) => Math.round(ok.reduce((n, r) => n + (pick(r) ?? 0) * 100, 0)) / 100;
  const t = { revenue: total(r => r.revenueCny), purchase: total(r => r.purchaseCny), expense: total(r => r.expenseCny), margin: total(r => r.marginIn) };
  const expenses = showVoided ? orderExpenses(state) : activeExpenses(state);
  const detail = rows.find(r => r.orderId === open);
  const columns: Column<OrderActualCost>[] = [
    { key: 'code', header: '订单', render: r => <div className="mist-col" style={{ gap: 2 }}><b>{r.code}</b><small className="mist-muted">{r.customer}</small></div> },
    { key: 'rev', header: '收入 CNY', align: 'right', render: r => cnyCell(r.revenueCny) },
    { key: 'pur', header: '采购 CNY', align: 'right', render: r => cnyCell(r.purchaseCny) },
    { key: 'exp', header: '费用 CNY', align: 'right', render: r => r.expenses.length ? cnyCell(r.expenseCny) : <span className="mist-note">未登记</span> },
    { key: 'rebate', header: '退税', align: 'right', render: r => r.rebate.used ? money(r.rebate.used) : '—' },
    { key: 'margin', header: '实际毛利（含退税）', align: 'right', render: r => r.marginIn === null ? <span className="mist-note">—</span> : <b className={r.marginIn < 0 ? 'mist-tone-bad' : undefined}>{money(r.marginIn)}</b>, sortValue: r => r.marginIn ?? -Infinity },
    { key: 'rate', header: '毛利率', align: 'right', render: r => pct(r.rateIn) },
    { key: 'status', header: '状态', render: r => r.status === 'norate' ? <Pill tone="warn">缺 {r.missing.join('、')} 汇率</Pill> : r.estimated ? <Pill tone="neutral">含暂估</Pill> : <Pill tone="ok">已决算</Pill> },
  ];
  const expenseColumns: Column<OrderExpense>[] = [
    { key: 'code', header: '编号', render: e => <div className="mist-col" style={{ gap: 2 }}><b>{e.code}</b><small className="mist-muted">{e.date}</small></div> },
    { key: 'cat', header: '类别', render: e => EXPENSE_CATEGORIES[e.category] },
    { key: 'vendor', header: '收款方 / 单据', render: e => [e.vendor, e.ref].filter(Boolean).join(' · ') || '—' },
    { key: 'amount', header: '金额', align: 'right', render: e => `${e.currency} ${money(e.amount)}` },
    { key: 'scope', header: '分摊', render: e => <div className="mist-col" style={{ gap: 2 }}><span>{e.scope === 'shipment' ? `出运 ${e.shipmentCode}` : '指定订单'} · {ALLOCATION_BASES[e.basis]}</span><small className="mist-muted">{e.shares.map(s => `${s.orderCode} ${money(s.amount)}`).join('；')}</small></div> },
    { key: 'payable', header: '应付', render: e => { const bill = expensePayableBill(state, e); return bill ? <Pill tone="ok">{bill.code}</Pill> : e.voided ? null : canWrite ? <Button size="sm" variant="quiet" disabled={busy} aria-label={`转应付 ${e.code}`} onClick={() => { setPayForm({ supplierId: (state.market?.suppliers || []).find(x => x.name === e.vendor)?.id || '', invoiceNo: e.ref, due: '', taxAmount: '' }); setPaying(e); }}>转应付</Button> : <span className="mist-note">未转</span>; } },
    { key: 'state', header: '', render: e => e.voided ? <Pill tone="neutral">已作废</Pill> : canWrite && !expensePayableBill(state, e) ? <Button size="sm" variant="quiet" disabled={busy} aria-label={`作废 ${e.code}`} onClick={() => { setReason(''); setVoiding(e); }}>作废</Button> : null },
  ];
  const exportCsv = () => downloadModuleCsv(`订单核算-${FX_BASIS_LABEL[basis]}-${asOf}.csv`, ['订单', '客户', '收入CNY', '采购CNY', '费用CNY', '退税CNY', '毛利不含退税', '毛利含退税', '毛利率%', '状态'],
    rows.map(r => [r.code, r.customer, r.revenueCny ?? '', r.purchaseCny ?? '', r.expenseCny ?? '', r.rebate.used, r.marginEx ?? '', r.marginIn ?? '', r.rateIn === null ? '' : (r.rateIn * 100).toFixed(1), r.status === 'norate' ? '缺汇率' : r.estimated ? '含暂估' : '已决算']));
  const doPayable = async () => { if (!paying) return; await run({ type: 'cost.expense.payable', payload: { id: paying.id, supplierId: payForm.supplierId, invoiceNo: payForm.invoiceNo, due: payForm.due, taxAmount: payForm.taxAmount } } as MistCommand); setPaying(null); toast('已转入应付待办，可按票申请付款'); };
  const doVoid = async () => { if (!voiding) return; await run({ type: 'cost.expense.void', payload: { id: voiding.id, reason } } as MistCommand); setVoiding(null); toast('费用已作废'); };
  return <div data-order-actual-cost>
    <Toolbar right={<span className="mist-row">{canWrite && <Button icon={Plus} variant="primary" disabled={busy} onClick={() => setRegister(true)}>登记费用</Button>}<Button onClick={exportCsv}>导出核算</Button></span>}>
      <Field label="折算口径"><Select aria-label="核算折算口径" value={basis} onChange={e => setBasis(e.target.value as FxBasis)} options={(['actual', 'period', 'quote'] as FxBasis[]).map(b => ({ value: b, label: `人民币 · ${FX_BASIS_LABEL[b]}` }))} /></Field>
      {basis !== 'quote' && <Field label="暂估月份"><TextInput type="month" aria-label="核算暂估月份" value={month} onChange={e => setMonth(e.target.value)} /></Field>}
    </Toolbar>
    <StatGrid>
      <StatCard icon={Wallet} label={`收入 CNY · ${ok.length} 单`} value={money(t.revenue)} />
      <StatCard icon={Receipt} label="采购成本" value={money(t.purchase)} />
      <StatCard icon={Truck} label="分摊费用" value={money(t.expense)} />
      <StatCard icon={TrendingUp} label="实际毛利 · 含退税" value={`${money(t.margin)}（${pct(t.revenue ? t.margin / t.revenue : null)}）`} />
    </StatGrid>
    <section className="mist-section"><Card><CardHeader title="订单实际核算" sub="点订单看收入、采购、费用、退税明细。" />
      <DataTable ariaLabel="订单实际核算" rows={rows} rowKey={r => r.orderId} columns={columns} onRowClick={r => setOpen(r.orderId)} empty={<EmptyState title="没有已生效订单" compact />} />
    </Card></section>
    <section className="mist-section"><Card><CardHeader title="费用台账" sub="运费、报关、佣金、银行费用等；登记时按所选口径分摊到订单并冻结。" tools={<Checkbox checked={showVoided} onChange={setShowVoided} label="显示已作废" />} />
      <DataTable ariaLabel="费用台账" rows={expenses} rowKey={e => e.id} columns={expenseColumns} empty={<EmptyState title="还没有登记费用" description="订单毛利此时只扣采购成本。" compact />} />
    </Card></section>
    <p className="mist-note">收入 = 已确认的销售发票，未开票部分按合同金额暂估；采购 = 已批准采购的已到票金额，扣除供应商索赔扣款，未到票部分按合同暂估；费用按登记时冻结的分摊额；退税已核准按核准额，否则按应退额。缺所选口径汇率的订单不出毛利。费用台账只用于核算，不产生应付或付款。</p>
    <Drawer open={!!detail} onClose={() => setOpen(null)} size="lg" title={detail ? `${detail.code} 实际核算` : '实际核算'} sub={detail ? `${detail.customer} · ${FX_BASIS_LABEL[basis]}` : undefined}>
      {detail && <div data-order-cost-detail={detail.orderId}>
        {(['revenue', 'purchases', 'expenses'] as const).map(k => <CostBlock key={k} title={{ revenue: '收入', purchases: '采购成本', expenses: '分摊费用' }[k]} rows={detail[k]} />)}
        <Card><CardHeader title="出口退税" sub={`应退 ${money(detail.rebate.expected)} · 核准 ${money(detail.rebate.approved)} · 已到账 ${money(detail.rebate.received)}`} /></Card>
        <StatGrid>
          <StatCard icon={TrendingUp} label="毛利 · 不含退税" value={detail.marginEx === null ? '—' : money(detail.marginEx)} />
          <StatCard icon={TrendingUp} label="毛利 · 含退税" value={detail.marginIn === null ? '—' : money(detail.marginIn)} foot={pct(detail.rateIn)} />
        </StatGrid>
      </div>}
    </Drawer>
    {register && <RegisterExpense state={state} asOf={asOf} busy={busy} run={run} onClose={() => setRegister(false)} onDone={() => { setRegister(false); toast('费用已登记并分摊'); }} />}
    <Dialog open={!!voiding} onClose={() => setVoiding(null)} tone="bad" title={`作废 ${voiding?.code ?? ''}`} description="作废后不再计入订单成本，原记录保留。" footer={<><Button onClick={() => setVoiding(null)}>取消</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void doVoid().catch(() => undefined)}>作废</Button></>}>
      <Field label="作废原因"><TextInput aria-label="作废原因" value={reason} onChange={e => setReason(e.target.value)} /></Field>
    </Dialog>
    <Dialog open={!!paying} onClose={() => setPaying(null)} title={`转应付 ${paying?.code ?? ''}`} description={paying ? `${EXPENSE_CATEGORIES[paying.category]} · ${paying.amount} ${paying.currency}。生成应付票据后在「财务管理 › 应付待办」按票申请付款；成本仍按费用台账计，不重复计入。` : undefined} footer={<><Button onClick={() => setPaying(null)}>取消</Button><Button variant="primary" disabled={busy || !payForm.supplierId || !payForm.invoiceNo.trim() || !payForm.due} onClick={() => void doPayable().catch(() => undefined)}>转应付</Button></>}>
      <FormGrid>
        <Field label="收款供应商" required hint="货代、报关行等须先在供应商管理建档"><Select aria-label="收款供应商" value={payForm.supplierId} onChange={e => setPayForm({ ...payForm, supplierId: e.target.value })} options={[{ value: '', label: '选择供应商' }, ...(state.market?.suppliers || []).map(x => ({ value: x.id, label: `${x.code} · ${x.name}` }))]} /></Field>
        <Field label="发票号" required><TextInput aria-label="发票号" value={payForm.invoiceNo} onChange={e => setPayForm({ ...payForm, invoiceNo: e.target.value })} /></Field>
        <Field label="付款到期日" required><TextInput aria-label="付款到期日" type="date" value={payForm.due} onChange={e => setPayForm({ ...payForm, due: e.target.value })} /></Field>
        <Field label="税额"><TextInput aria-label="税额" type="number" step="0.01" value={payForm.taxAmount} onChange={e => setPayForm({ ...payForm, taxAmount: e.target.value })} /></Field>
      </FormGrid>
    </Dialog>
  </div>;
}

function CostBlock({ title, rows }: { title: string; rows: OrderCostLine[] }) {
  const cols: Column<OrderCostLine>[] = [
    { key: 'label', header: '项目', render: r => <span>{r.label}{r.estimated ? <Pill tone="neutral">暂估</Pill> : null}</span> },
    { key: 'amount', header: '原币', align: 'right', render: r => `${r.currency} ${money(r.amount)}` },
    { key: 'cny', header: 'CNY', align: 'right', render: r => cnyCell(r.cny) },
  ];
  return <section className="mist-section"><Card><CardHeader title={title} /><DataTable ariaLabel={title} rows={rows} rowKey={r => r.key} columns={cols} empty={<EmptyState title="无" compact />} /></Card></section>;
}

function RegisterExpense({ state, asOf, busy, run, onClose, onDone }: { state: MistState; asOf: string; busy: boolean; run: (c: MistCommand) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const shipments = state.fulfillment.shipments.filter(s => s.state !== 'cancelled');
  const orders = state.orders.filter(o => !o.governance || o.governance.status === 'approved');
  const [v, setV] = React.useState({ category: 'freight' as ExpenseCategory, vendor: '', ref: '', date: asOf, currency: 'USD', amount: '', note: '', scope: (shipments.length ? 'shipment' : 'orders') as 'shipment' | 'orders', shipmentId: shipments[0]?.id ?? '', basis: 'volume' as AllocationBasis });
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
  return <Dialog open onClose={() => !busy && onClose()} title="登记费用" description="选择费用发生在哪票出运或哪些订单，系统按口径分摊到订单并冻结。" width={640}
    footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !v.amount || !scopeOrders.length} onClick={() => void submit()}>登记并分摊</Button></>}>
    {error && <Banner tone="bad" title={error} />}
    <FormGrid>
      <Field label="费用类别"><Select aria-label="费用类别" value={v.category} onChange={e => set({ category: e.target.value as ExpenseCategory })} options={Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="费用日期"><TextInput type="date" aria-label="费用日期" value={v.date} max={asOf} onChange={e => set({ date: e.target.value })} /></Field>
      <Field label="币种"><Select aria-label="费用币种" value={v.currency} onChange={e => set({ currency: e.target.value })} options={['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD'].map(c => ({ value: c, label: c }))} /></Field>
      <Field label="金额"><TextInput aria-label="费用金额" inputMode="decimal" value={v.amount} onChange={e => set({ amount: e.target.value })} /></Field>
      <Field label="收款方"><TextInput aria-label="收款方" value={v.vendor} onChange={e => set({ vendor: e.target.value })} /></Field>
      <Field label="发票 / 单据号"><TextInput aria-label="发票或单据号" value={v.ref} onChange={e => set({ ref: e.target.value })} /></Field>
      <Field label="分摊范围"><Select aria-label="分摊范围" value={v.scope} onChange={e => { const scope = e.target.value as 'shipment' | 'orders'; set({ scope, basis: scope === 'shipment' ? 'volume' : 'value' }); }} options={[{ value: 'shipment', label: '按出运（一票货的订单之间）' }, { value: 'orders', label: '按订单（直接指定）' }]} /></Field>
      <Field label="分摊口径"><Select aria-label="分摊口径" value={v.basis} onChange={e => set({ basis: e.target.value as AllocationBasis })} options={bases.map(b => ({ value: b, label: ALLOCATION_BASES[b] }))} /></Field>
    </FormGrid>
    {v.scope === 'shipment' ? <Field label="出运"><Select aria-label="出运" value={v.shipmentId} onChange={e => set({ shipmentId: e.target.value })} options={shipments.map(s => ({ value: s.id, label: `${s.code} · ${s.customer}` }))} /></Field>
      : <div className="mist-col" role="group" aria-label="选择订单" style={{ gap: 4, maxHeight: 200, overflow: 'auto' }}>{orders.map(o => <Checkbox key={o.id} checked={picked.includes(o.id)} onChange={c => setPicked(p => c ? [...p, o.id] : p.filter(x => x !== o.id))} label={`${o.code} · ${o.customer} · ${o.currency}`} />)}</div>}
    {v.basis === 'manual' && <div className="mist-col" style={{ gap: 4 }}>{scopeOrders.map(id => <Field key={id} label={`${code(id)} 分摊金额`}><TextInput aria-label={`${code(id)} 分摊金额`} inputMode="decimal" value={manual[id] ?? ''} onChange={e => setManual(m => ({ ...m, [id]: e.target.value }))} /></Field>)}</div>}
    <Field label="备注"><TextInput aria-label="费用备注" value={v.note} onChange={e => set({ note: e.target.value })} /></Field>
  </Dialog>;
}
