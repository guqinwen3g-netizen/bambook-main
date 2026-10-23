import { interfaceLocale } from '../../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
import {businessNow} from '../../runtime/businessClock';
/** 报表中心：客户销售额、订单毛利、应收账龄、订单进度与逾期。销售额与账龄按币种分别统计、不折算；订单毛利可按所选口径（实际结汇 / 月末暂估 / 报价预计）折算人民币，并列不含 / 含出口退税。 */
import React from 'react';
import { Clock, Download, Package, Receipt, TrendingUp } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, EmptyState, Field, MistPage, PageHeader, Pill, Select, StatCard, StatGrid, Tabs, TextInput, Toolbar, type Column } from '../../../../../components/mist';
import { platformBusinessDate } from '../../../../../server/src/shared/mistPlatform';
import { isActiveMistInvoice, isRecognizedMistInvoice, mistMoneyMinor, type MistState } from '../../../../../server/src/shared/mistWorkspace';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { downloadModuleCsv } from './ModuleWorkbench';
import { OrderActualCostPanel } from './OrderActualCostPanel';
import { FX_BASIS_LABEL, fxOrderActual, fxRateFor, fxUnallocatedSettlements, type FxBasis, type FxResolved } from '../../../../../server/src/shared/mistFxRates';
import { orderRebate } from '../../../../../server/src/shared/mistExportRebate';
import { mistInvoiceCustomerId, mistInvoiceCustomerName } from '../../../../../server/src/shared/mistOpeningBalance';

const money = (n: number) => new Intl.NumberFormat(interfaceLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const minor = (n: number) => mistMoneyMinor(n);
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const businessDay = (at: string) => { try { return platformBusinessDate(at); } catch { return at.slice(0, 10); } };

export type CustomerSalesRow = { id: string; customerId: string; customer: string; currency: string; orders: number; amount: number; invoiced: number; received: number; open: number };
/** 订单按业务日（上海）落在范围内；开票、已收、未收只统计这些订单的有效发票。 */
export function buildCustomerSales(state: MistState, from = '', to = '', currency = ''): CustomerSalesRow[] {
  const orders = state.orders.filter(o => { const d = businessDay(o.createdAt); return (!from || d >= from) && (!to || d <= to) && (!currency || o.currency === currency); });
  const map = new Map<string, { customerId: string; customer: string; currency: string; orders: number; amount: number; invoiced: number; open: number }>();
  for (const o of orders) {
    const key = (o.customerId || o.customer) + '|' + o.currency, row = map.get(key) ?? { customerId: o.customerId, customer: o.customer, currency: o.currency, orders: 0, amount: 0, invoiced: 0, open: 0 };
    row.orders++; row.amount += minor(o.amount);
    for (const i of state.invoices) if (i.orderId === o.id && isRecognizedMistInvoice(i) && i.currency === o.currency) { row.invoiced += minor(i.amount); row.open += minor(i.open); }
    map.set(key, row);
  }
  return [...map.entries()].map(([id, r]) => ({ id, customerId: r.customerId, customer: r.customer, currency: r.currency, orders: r.orders, amount: r.amount / 100, invoiced: r.invoiced / 100, received: (r.invoiced - r.open) / 100, open: r.open / 100 }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount || a.customer.localeCompare(b.customer, 'zh-CN'));
}

export type OrderMarginRow = { id: string; code: string; customer: string; currency: string; revenue: number; cost: number; billed: number; margin: number | null; rate: number | null; purchases: number; pending: number; foreign: string; status: 'ok' | 'nocost' | 'foreign' };
/**
 * 订单预估毛利（贸易公司通行做法：合同口径）：
 * 销售收入 = 已生效订单金额（未走审批或审批已通过；草稿、待审、退回不计）；
 * 采购成本 = 该订单下已批准且未取消的采购合同金额（数量 × 单价，通常为含税价）；
 * 已到票 = 这些采购在有效供应商发票中登记的金额，仅作执行参考；
 * 毛利只在采购与订单同币种时计算；有异币种采购的订单不折算、不出毛利，单独标注。
 * 未计出口退税、运费、报关、佣金、索赔扣款等，属于毛利以外的调整项。
 */
export function buildOrderMargin(state: MistState, from = '', to = '', currency = ''): OrderMarginRow[] {
  const purchases = state.fulfillment?.purchases ?? [], bills = (state.payables?.bills ?? []).filter(b => b.state !== 'void');
  return state.orders.filter(o => (!o.governance || o.governance.status === 'approved') && (!currency || o.currency === currency)).filter(o => { const d = businessDay(o.createdAt); return (!from || d >= from) && (!to || d <= to); }).map(o => {
    const mine = purchases.filter(p => p.orderId === o.id && !p.cancellation), approved = mine.filter(p => p.state === 'approved');
    let cost = 0, billed = 0; const foreign = new Map<string, number>();
    for (const p of approved) {
      const value = Math.max(0, Math.round(p.quantity * p.price * 100));
      if (p.currency === o.currency) cost += value; else foreign.set(p.currency, (foreign.get(p.currency) ?? 0) + value);
      for (const b of bills) if (b.currency === o.currency && p.currency === o.currency) for (const l of b.lines) if (l.purchaseId === p.id) billed += minor(l.amount);
    }
    const revenue = minor(o.amount), status: OrderMarginRow['status'] = foreign.size ? 'foreign' : approved.length ? 'ok' : 'nocost';
    const margin = status === 'ok' ? revenue - cost : null;
    return { id: o.id, code: o.code, customer: o.customer, currency: o.currency, revenue: revenue / 100, cost: cost / 100, billed: billed / 100, margin: margin === null ? null : margin / 100, rate: margin === null || !revenue ? null : margin / revenue,
      purchases: approved.length, pending: mine.filter(p => p.state === 'pending' || p.state === 'draft').length, foreign: [...foreign.entries()].map(([c, v]) => `${c} ${money(v / 100)}`).join(' · '), status };
  }).sort((a, b) => a.currency.localeCompare(b.currency) || ({ ok: 0, foreign: 1, nocost: 2 }[a.status] - { ok: 0, foreign: 1, nocost: 2 }[b.status]) || (a.rate ?? 0) - (b.rate ?? 0) || a.code.localeCompare(b.code));
}
export type OrderMarginCnyRow = { id: string; code: string; customer: string; currency: string; revenue: number; fx?: FxResolved; revenueCny: number | null; costCny: number | null; marginEx: number | null; rateEx: number | null;
  rebate: { expected: number; approved: number; received: number }; marginIn: number | null; rateIn: number | null; estimated: boolean; missing: string[]; purchases: number; pending: number; status: 'ok' | 'norate' | 'nocost' };
/**
 * 订单毛利（人民币管理口径）：收入与非人民币采购按所选口径的汇率折算；同一口径缺任何币种的汇率就不出毛利，标“缺汇率”，不猜、不换口径。
 * 不含退税毛利 = 收入 × 汇率 − 已批准采购（通常含税价，折人民币）；含退税毛利 = 不含退税毛利 + 本单分摊的退税（已核准按核准额，未核准按应退额；未申报不计）。
 */
export function buildOrderMarginCny(state: MistState, basis: FxBasis, month: string, asOf: string, from = '', to = '', currency = ''): OrderMarginCnyRow[] {
  const purchases = state.fulfillment?.purchases ?? [];
  return state.orders.filter(o => (!o.governance || o.governance.status === 'approved') && (!currency || o.currency === currency)).filter(o => { const d = businessDay(o.createdAt); return (!from || d >= from) && (!to || d <= to); }).map(o => {
    const mine = purchases.filter(p => p.orderId === o.id && !p.cancellation), approved = mine.filter(p => p.state === 'approved');
    const rates = new Map<string, FxResolved | undefined>(), rateOf = (c: string) => { if (!rates.has(c)) rates.set(c, fxRateFor(state, c, basis, { month, asOf, orderId: o.id })); return rates.get(c); };
    // 实际结汇口径：订单收入按结汇分配到账逐笔取实际汇率，其余按月末暂估（fxOrderActual）。
    const actual = basis === 'actual' && o.currency !== 'CNY' ? fxOrderActual(state, o, month, asOf) : undefined;
    if (basis === 'actual' && o.currency !== 'CNY') rates.set(o.currency, actual);
    const fx = rateOf(o.currency); let cost = 0;
    // 外币采购没有对应结汇：实际口径下按月末汇率暂估（与订单收入的实际汇率分开取）。
    const costRate = (c: string) => basis === 'actual' && c === o.currency && c !== 'CNY' ? (rates.has(c + '（采购）') ? rates.get(c + '（采购）') : (rates.set(c + '（采购）', fxRateFor(state, c, basis, { month, asOf })), rates.get(c + '（采购）'))) : rateOf(c);
    for (const p of approved) { const r = costRate(p.currency); if (r) cost += Math.round(Math.max(0, Math.round(p.quantity * p.price * 100)) * r.rate); }
    const missing = [...rates.entries()].filter(([, r]) => !r).map(([c]) => c), revenue = minor(o.amount);
    const status: OrderMarginCnyRow['status'] = missing.length ? 'norate' : approved.length ? 'ok' : 'nocost';
    const revenueCny = actual ? actual.cnyMinor : fx ? Math.round(revenue * fx.rate) : null, rebate = orderRebate(state, o.id), rebateMinor = minor(rebate.approved);
    const marginEx = status === 'ok' && revenueCny !== null ? revenueCny - cost : null, marginIn = marginEx === null ? null : marginEx + rebateMinor;
    return { id: o.id, code: o.code, customer: o.customer, currency: o.currency, revenue: revenue / 100, fx, revenueCny: revenueCny === null ? null : revenueCny / 100, costCny: status === 'norate' ? null : cost / 100,
      marginEx: marginEx === null ? null : marginEx / 100, rateEx: marginEx === null || !revenueCny ? null : marginEx / revenueCny, rebate, marginIn: marginIn === null ? null : marginIn / 100, rateIn: marginIn === null || !revenueCny ? null : marginIn / revenueCny,
      estimated: [...rates.values()].some(r => r?.estimated), missing, purchases: approved.length, pending: mine.filter(p => p.state === 'pending' || p.state === 'draft').length, status };
  }).sort((a, b) => ({ ok: 0, norate: 1, nocost: 2 }[a.status] - { ok: 0, norate: 1, nocost: 2 }[b.status]) || (a.rateIn ?? 0) - (b.rateIn ?? 0) || a.code.localeCompare(b.code));
}
const CNY_STATUS = { ok: { label: '已计算', tone: 'ok' }, norate: { label: '缺汇率', tone: 'warn' }, nocost: { label: '无已批准采购', tone: 'neutral' } } as const;
type MarginView = 'none' | FxBasis;
const MARGIN_STATUS = { ok: { label: '已计算', tone: 'ok' }, foreign: { label: '含异币种采购', tone: 'warn' }, nocost: { label: '无已批准采购', tone: 'neutral' } } as const;
const percent = (r: number | null) => r === null ? '—' : (r * 100).toFixed(1) + '%';

export const AGING_BUCKETS = [{ key: 'current', label: '未到期' }, { key: 'd30', label: '逾期 1–30 天' }, { key: 'd60', label: '31–60 天' }, { key: 'd90', label: '61–90 天' }, { key: 'over', label: '90 天以上' }] as const;
type Bucket = typeof AGING_BUCKETS[number]['key'];
export const agingBucket = (due: string, asOf: string): Bucket => { const late = days(due, asOf); return late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over'; };
export type AgingRow = { id: string; customer: string; currency: string; invoices: number; total: number } & Record<Bucket, number>;
/** 只统计有效且仍有未收余额的发票；按到期日计算逾期天数。 */
export function buildReceivableAging(state: MistState, asOf: string): AgingRow[] {
  const map = new Map<string, { customer: string; currency: string; invoices: number } & Record<Bucket | 'total', number>>();
  for (const i of state.invoices) {
    if (!isActiveMistInvoice(i) || !(i.open > 0)) continue;
    const name = mistInvoiceCustomerName(state, i), key = (mistInvoiceCustomerId(state, i) || name) + '|' + i.currency, row = map.get(key) ?? { customer: name, currency: i.currency, invoices: 0, total: 0, current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
    const value = minor(i.open); row.invoices++; row.total += value; row[agingBucket(i.due, asOf)] += value; map.set(key, row);
  }
  return [...map.entries()].map(([id, r]) => ({ id, customer: r.customer, currency: r.currency, invoices: r.invoices, total: r.total / 100, current: r.current / 100, d30: r.d30 / 100, d60: r.d60 / 100, d90: r.d90 / 100, over: r.over / 100 }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.total - a.total);
}

export type OrderProgressRow = { id: string; code: string; customer: string; due: string; progress: number; state: string; tone: string; status: 'overdue' | 'soon' | 'ontrack' | 'nodue'; lateDays: number };
/** 未完成订单（进度 < 100%）：已过交期为逾期，7 天内到期为临近。 */
export function buildOrderProgress(state: MistState, asOf: string): OrderProgressRow[] {
  return state.orders.filter(o => o.progress < 100).map(o => {
    const late = o.due ? days(o.due, asOf) : 0;
    const status: OrderProgressRow['status'] = !o.due ? 'nodue' : late > 0 ? 'overdue' : late >= -7 ? 'soon' : 'ontrack';
    return { id: o.id, code: o.code, customer: o.customer, due: o.due, progress: o.progress, state: o.state, tone: o.tone, status, lateDays: Math.max(0, late) };
  }).sort((a, b) => ({ overdue: 0, soon: 1, ontrack: 2, nodue: 3 }[a.status] - { overdue: 0, soon: 1, ontrack: 2, nodue: 3 }[b.status]) || b.lateDays - a.lateDays || a.due.localeCompare(b.due));
}
const PROGRESS_STATUS = { overdue: { label: '已逾期', tone: 'bad' }, soon: { label: '7 天内到期', tone: 'warn' }, ontrack: { label: '正常', tone: 'ok' }, nodue: { label: '未填交期', tone: 'neutral' } } as const;

type ReportTab = 'sales' | 'margin' | 'actual' | 'aging' | 'orders';
export function PlatformReportsPage() {
  const workspace = useMistWorkspace(), session = useMistSession(), { route, go } = useNav(), state = workspace.state;
  // 毛利涉及采购成本，只给报表管理者（业务主管、财务、老板）看；本机演示公司为单人使用。
  const canSeeMargin = !!session.localMode || session.hasPermission('reports:admin');
  const tab: ReportTab = route.section === 'aging' || route.section === 'orders' || ((route.section === 'margin' || route.section === 'actual') && canSeeMargin) ? route.section : 'sales';
  const asOf = platformBusinessDate(businessNow());
  const [from, setFrom] = React.useState(''), [to, setTo] = React.useState(''), [currency, setCurrency] = React.useState(''), [progressFilter, setProgressFilter] = React.useState('');
  // 默认口径：有实际结汇用实际结汇，否则有月末汇率用月末暂估，都没有则原币。
  const [viewChoice, setView] = React.useState<MarginView | null>(null), view: MarginView = viewChoice ?? ((state?.fxRecords || []).some(r => r.kind === 'settlement' && !r.reversed) ? 'actual' : (state?.fxPeriodRates || []).some(r => !r.voided) ? 'period' : 'none'), [fxMonth, setFxMonth] = React.useState(asOf.slice(0, 7));
  const invalid = !!from && !!to && from > to;
  const currencies = [...new Set([...(state?.orders ?? []).map(o => o.currency), ...(state?.invoices ?? []).map(i => i.currency)])].filter(Boolean).sort();
  const sales = state && !invalid ? buildCustomerSales(state, from, to, currency) : [];
  const margin = state && !invalid && tab === 'margin' && view === 'none' ? buildOrderMargin(state, from, to, currency) : [];
  const cny = state && !invalid && tab === 'margin' && view !== 'none' ? buildOrderMarginCny(state, view, fxMonth, asOf, from, to, currency) : [];
  const unallocated = state && tab === 'margin' && view === 'actual' ? fxUnallocatedSettlements(state, asOf) : [];
  const cnyOk = cny.filter(r => r.status === 'ok'), sum = (pick: (r: OrderMarginCnyRow) => number | null) => cnyOk.reduce((t, r) => t + minor(pick(r) ?? 0), 0) / 100;
  const cnyTotals = { revenue: sum(r => r.revenueCny), ex: sum(r => r.marginEx), rebate: sum(r => r.rebate.approved), inc: sum(r => r.marginIn), estimated: cnyOk.filter(r => r.estimated).length };
  const marginTotals = [...new Set(margin.map(r => r.currency))].map(c => { const rows = margin.filter(r => r.currency === c && r.status === 'ok'), rev = rows.reduce((t, r) => t + minor(r.revenue), 0), m = rows.reduce((t, r) => t + minor(r.margin ?? 0), 0); return { currency: c, revenue: rev / 100, margin: m / 100, rate: rev ? m / rev : null, orders: rows.length }; });
  const aging = state ? buildReceivableAging(state, asOf).filter(r => !currency || r.currency === currency) : [];
  const progress = state ? buildOrderProgress(state, asOf) : [];
  const shownProgress = progress.filter(r => !progressFilter || r.status === progressFilter);
  // 多币种合计每个币种一行，避免大字号下金额从中间折断。
  const totals = (rows: Array<{ currency: string }>, pick: (r: any) => number): React.ReactNode => {
    const lines = [...new Set(rows.map(r => r.currency))].map(c => `${c} ${money(rows.filter(r => r.currency === c).reduce((s, r) => s + minor(pick(r)), 0) / 100)}`);
    return lines.length > 1 ? <span className="mist-stat-lines">{lines.map(l => <span key={l}>{l}</span>)}</span> : lines[0] ?? '—';
  };
  const currencyFilter = <Field label={uiText("币种")}><Select aria-label={uiText("币种")} value={currency} onChange={e => setCurrency(e.target.value)} options={[{ value: '', label: '全部币种（分别统计）' }, ...currencies.map(c => ({ value: c, label: c }))]} /></Field>;

  const salesColumns: Column<CustomerSalesRow>[] = [
    { key: 'customer', header: '客户', width: 'minmax(180px,2fr)', render: r => r.customerId ? <Button variant="quiet" onClick={() => go('crm', r.customerId, { customerId: r.customerId })}>{r.customer}</Button> : r.customer, sortValue: r => r.customer },
    { key: 'currency', header: '币种', width: '72px', render: r => r.currency },
    { key: 'orders', header: '订单数', width: '80px', align: 'right', render: r => r.orders, sortValue: r => r.orders },
    { key: 'amount', header: '订单金额', align: 'right', render: r => money(r.amount), sortValue: r => r.amount },
    { key: 'invoiced', header: '已开票', align: 'right', render: r => money(r.invoiced), sortValue: r => r.invoiced },
    { key: 'received', header: '已收', align: 'right', render: r => money(r.received), sortValue: r => r.received },
    { key: 'open', header: '未收', align: 'right', render: r => money(r.open), sortValue: r => r.open },
  ];
  const marginColumns: Column<OrderMarginRow>[] = [
    { key: 'code', header: '订单', width: 'minmax(130px,1fr)', render: r => <Button variant="quiet" onClick={() => go('orders/detail', r.id)}>{r.code}</Button>, sortValue: r => r.code },
    { key: 'customer', header: '客户', width: 'minmax(140px,1.4fr)', render: r => r.customer, sortValue: r => r.customer },
    { key: 'currency', header: '币种', width: '64px', render: r => r.currency },
    { key: 'revenue', header: '销售收入', align: 'right', render: r => money(r.revenue), sortValue: r => r.revenue },
    { key: 'cost', header: '采购成本', align: 'right', render: r => r.purchases ? money(r.cost) : <span className="mist-note">—</span>, sortValue: r => r.cost },
    { key: 'margin', header: '毛利', align: 'right', render: r => r.margin === null ? <span className="mist-note">—</span> : <b className={r.margin < 0 ? 'mist-tone-bad' : undefined}>{money(r.margin)}</b>, sortValue: r => r.margin ?? -Infinity },
    { key: 'rate', header: '毛利率', width: '80px', align: 'right', render: r => <span className={r.rate !== null && r.rate < 0 ? 'mist-tone-bad' : undefined}>{percent(r.rate)}</span>, sortValue: r => r.rate ?? -Infinity },
    { key: 'billed', header: '已到票', align: 'right', render: r => r.billed ? money(r.billed) : <span className="mist-note">—</span>, sortValue: r => r.billed },
    { key: 'status', header: '说明', width: 'minmax(150px,1.4fr)', render: r => <><Pill tone={MARGIN_STATUS[r.status].tone}>{uiText(MARGIN_STATUS[r.status].label)}</Pill>{r.foreign && <div className="mist-note">{uiText("另有 ")}{r.foreign}</div>}{r.pending > 0 && <div className="mist-note">{r.pending}{uiText(" 张采购未批准，未计入")}</div>}</> },
  ];
  const cnyColumns: Column<OrderMarginCnyRow>[] = [
    { key: 'code', header: '订单', width: 'minmax(130px,1fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><Button variant="quiet" onClick={() => go('orders/detail', r.id)}>{r.code}</Button><small className="mist-muted">{r.customer}</small></div>, sortValue: r => r.code },
    { key: 'revenue', header: '收入', align: 'right', render: r => <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span>{uiText(r.revenueCny === null ? '—' : money(r.revenueCny))}</span><small className="mist-muted">{r.currency} {money(r.revenue)}</small></div>, sortValue: r => r.revenueCny ?? -Infinity },
    { key: 'fx', header: '汇率', width: 'minmax(120px,1fr)', hideOnMobile: true, render: r => r.fx ? <div className="mist-col" style={{ gap: 2 }}><span>{uiText(r.fx.label)}</span>{r.estimated && <small className="mist-tone-warn">{uiText("暂估")}</small>}</div> : <span className="mist-tone-bad">{uiText("缺 ")}{r.currency}{uiText(" 汇率")}</span> },
    { key: 'cost', header: '采购成本', align: 'right', render: r => r.costCny === null || !r.purchases ? <span className="mist-note">—</span> : money(r.costCny), sortValue: r => r.costCny ?? 0 },
    { key: 'ex', header: '毛利 · 不含退税', align: 'right', render: r => r.marginEx === null ? <span className="mist-note">—</span> : <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><b className={r.marginEx < 0 ? 'mist-tone-bad' : undefined}>{money(r.marginEx)}</b><small className="mist-muted">{percent(r.rateEx)}</small></div>, sortValue: r => r.marginEx ?? -Infinity },
    { key: 'rebate', header: '出口退税', align: 'right', render: r => !r.rebate.expected ? <span className="mist-note">{uiText("未申报")}</span> : <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><span>{money(r.rebate.approved)}</span><small className={r.rebate.received && r.rebate.received < r.rebate.approved ? 'mist-tone-warn' : 'mist-muted'}>{uiText(r.rebate.approved !== r.rebate.expected ? `应退 ${money(r.rebate.expected)} · ` : '')}{uiText(r.rebate.received ? `到账 ${money(r.rebate.received)}${r.rebate.received !== r.rebate.approved ? ` · 差 ${money(r.rebate.received - r.rebate.approved)}` : ''}` : '未到账')}</small></div>, sortValue: r => r.rebate.approved },
    { key: 'in', header: '毛利 · 含退税', align: 'right', render: r => r.marginIn === null ? <span className="mist-note">—</span> : <div className="mist-col" style={{ gap: 2, alignItems: 'flex-end' }}><b className={r.marginIn < 0 ? 'mist-tone-bad' : undefined}>{money(r.marginIn)}</b><small className="mist-muted">{percent(r.rateIn)}</small></div>, sortValue: r => r.marginIn ?? -Infinity },
    { key: 'status', header: '说明', width: 'minmax(120px,1fr)', render: r => <><Pill tone={CNY_STATUS[r.status].tone}>{uiText(CNY_STATUS[r.status].label)}</Pill>{r.missing.length > 0 && <div className="mist-note">{uiText("缺 ")}{r.missing.join('、')}</div>}{r.pending > 0 && <div className="mist-note">{r.pending}{uiText(" 张采购未批准，未计入")}</div>}</> },
  ];
  const agingColumns: Column<AgingRow>[] = [
    { key: 'customer', header: '客户', width: 'minmax(160px,2fr)', render: r => r.customer, sortValue: r => r.customer },
    { key: 'currency', header: '币种', width: '72px', render: r => r.currency },
    ...AGING_BUCKETS.map(b => ({ key: b.key, header: b.label, align: 'right' as const, render: (r: AgingRow) => r[b.key] ? <span className={b.key === 'over' || b.key === 'd90' ? 'mist-tone-bad' : undefined}>{money(r[b.key])}</span> : <span className="mist-note">—</span>, sortValue: (r: AgingRow) => r[b.key] })),
    { key: 'total', header: '未收合计', align: 'right', render: r => <b>{money(r.total)}</b>, sortValue: r => r.total },
  ];
  const progressColumns: Column<OrderProgressRow>[] = [
    { key: 'code', header: '订单', width: 'minmax(140px,1fr)', render: r => <Button variant="quiet" onClick={() => go('orders/detail', r.id)}>{r.code}</Button>, sortValue: r => r.code },
    { key: 'customer', header: '客户', width: 'minmax(140px,1.5fr)', render: r => r.customer },
    { key: 'due', header: '交期', width: '110px', render: r => r.due || '—', sortValue: r => r.due },
    { key: 'progress', header: '进度', width: '80px', align: 'right', render: r => r.progress + '%', sortValue: r => r.progress },
    { key: 'status', header: '交期状态', width: '120px', render: r => <Pill tone={PROGRESS_STATUS[r.status].tone}>{uiText(PROGRESS_STATUS[r.status].label)}{uiText(r.status === 'overdue' ? ` ${r.lateDays} 天` : '')}</Pill> },
    { key: 'state', header: '当前环节', render: r => r.state },
  ];
  const exportCurrent = () => {
    if (tab === 'sales') downloadModuleCsv('客户销售额.csv', ['客户', '币种', '订单数', '订单金额', '已开票', '已收', '未收'], sales.map(r => [r.customer, r.currency, r.orders, r.amount, r.invoiced, r.received, r.open]));
    else if (tab === 'margin' && view !== 'none') downloadModuleCsv(`订单毛利-人民币-${FX_BASIS_LABEL[view]}.csv`, ['订单', '客户', '币种', '原币收入', '汇率口径', '汇率', '暂估', '收入CNY', '采购成本CNY', '毛利不含退税', '毛利率不含退税%', '退税核准或应退', '退税应退', '退税到账', '毛利含退税', '毛利率含退税%', '说明'], cny.map(r => [r.code, r.customer, r.currency, r.revenue, FX_BASIS_LABEL[view], r.fx ? Math.round(r.fx.rate * 1e6) / 1e6 : '', r.estimated ? '是' : '', r.revenueCny ?? '', r.costCny ?? '', r.marginEx ?? '', r.rateEx === null ? '' : Math.round(r.rateEx * 1000) / 10, r.rebate.approved, r.rebate.expected, r.rebate.received, r.marginIn ?? '', r.rateIn === null ? '' : Math.round(r.rateIn * 1000) / 10, CNY_STATUS[r.status].label + (r.missing.length ? ' ' + r.missing.join('/') : '')]));
    else if (tab === 'margin') downloadModuleCsv('订单毛利.csv', ['订单', '客户', '币种', '销售收入', '采购成本', '毛利', '毛利率%', '已到票', '说明', '异币种采购', '未批准采购数'], margin.map(r => [r.code, r.customer, r.currency, r.revenue, r.purchases ? r.cost : '', r.margin ?? '', r.rate === null ? '' : Math.round(r.rate * 1000) / 10, r.billed, MARGIN_STATUS[r.status].label, r.foreign, r.pending]));
    else if (tab === 'aging') downloadModuleCsv(`应收账龄-${asOf}.csv`, ['客户', '币种', ...AGING_BUCKETS.map(b => b.label), '未收合计'], aging.map(r => [r.customer, r.currency, ...AGING_BUCKETS.map(b => r[b.key]), r.total]));
    else downloadModuleCsv(`订单进度-${asOf}.csv`, ['订单', '客户', '交期', '进度%', '交期状态', '逾期天数', '当前环节'], shownProgress.map(r => [r.code, r.customer, r.due, r.progress, PROGRESS_STATUS[r.status].label, r.lateDays, r.state]));
  };

  return <MistPage>
    <PageHeader title={uiText("报表中心")} actions={<Button icon={Download} disabled={!state || tab === 'actual' || ((tab === 'sales' || tab === 'margin') && invalid)} onClick={exportCurrent}>{uiText("导出当前报表")}</Button>} />
    {workspace.error && <Banner tone="bad" title={uiText("读取失败")}>{workspace.error}</Banner>}
    <Tabs<ReportTab> value={tab} onChange={next => go('reports', undefined, { section: next })} options={[{ value: 'sales', label: '客户销售额' }, ...(canSeeMargin ? [{ value: 'margin' as const, label: '订单毛利' }, { value: 'actual' as const, label: '订单核算' }] : []), { value: 'aging', label: '应收账龄' }, { value: 'orders', label: '订单进度与逾期', count: progress.filter(r => r.status === 'overdue').length || undefined }]} />
    <section className="mist-section">{tab === 'sales' ? <>
      <Toolbar><Field label={uiText("订单创建起日")}><TextInput type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label={uiText("订单创建止日")}><TextInput type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>{currencyFilter}</Toolbar>
      {invalid && <Banner tone="bad" title={uiText("起始日期不能晚于结束日期")} />}
      <StatGrid><StatCard icon={Package} label={uiText("订单金额")} value={totals(sales, r => r.amount)} /><StatCard icon={Receipt} label={uiText("已收")} value={totals(sales, r => r.received)} /><StatCard icon={Clock} label={uiText("未收")} value={totals(sales, r => r.open)} /></StatGrid>
      <section className="mist-section"><Card><DataTable ariaLabel={uiText("客户销售额")} rows={sales} rowKey={r => r.id} loading={workspace.loading} columns={salesColumns} empty={<EmptyState title={uiText("当前范围没有订单")} description={uiText("调整日期或币种后重新查看。")} />} /></Card></section>
      <p className="mist-note">{uiText("按订单业务日期（北京时间）统计；已开票、已收、未收只计这些订单下的有效发票，作废发票不计。")}</p>
    </> : tab === 'margin' ? <>
      <Toolbar><Field label={uiText("订单创建起日")}><TextInput type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label={uiText("订单创建止日")}><TextInput type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>{currencyFilter}
        <Field label={uiText("折算口径")}><Select aria-label={uiText("折算口径")} value={view} onChange={e => setView(e.target.value as MarginView)} options={[{ value: 'actual', label: '人民币 · 实际结汇' }, { value: 'period', label: '人民币 · 月末暂估' }, { value: 'quote', label: '人民币 · 报价预计' }, { value: 'none', label: '原币（不折算）' }]} /></Field>
        {(view === 'period' || view === 'actual') && <Field label={uiText("暂估月份")}><TextInput type="month" aria-label={uiText("暂估月份")} value={fxMonth} onChange={e => setFxMonth(e.target.value)} /></Field>}</Toolbar>
      {invalid && <Banner tone="bad" title={uiText("起始日期不能晚于结束日期")} />}
      {view === 'none' ? <>
        <StatGrid>{marginTotals.length ? marginTotals.map(t => <StatCard key={t.currency} icon={TrendingUp} label={ui`${t.currency} 毛利 · ${t.orders} 单`} value={`${money(t.margin)}（${percent(t.rate)}）`} />) : <StatCard icon={TrendingUp} label={uiText("毛利")} value="—" />}</StatGrid>
        <section className="mist-section"><Card><DataTable ariaLabel={uiText("订单毛利")} rows={margin} rowKey={r => r.id} loading={workspace.loading} columns={marginColumns} empty={<EmptyState title={uiText("当前范围没有已生效订单")} description={uiText("草稿、待审批或被退回的订单不计入毛利。")} />} /></Card></section>
        <p className="mist-note">{uiText("预估毛利 = 订单金额 − 已批准采购合同金额（同币种）。汇总只含“已计算”的订单；含异币种采购的订单不做汇率折算、不出毛利。采购价通常含税，未计出口退税、运费、报关、佣金与索赔扣款。“已到票”为供应商有效发票中登记到这些采购的金额。")}</p>
      </> : <>
        <StatGrid>
          <StatCard icon={Package} label={ui`收入 CNY · ${cnyOk.length} 单`} value={money(cnyTotals.revenue)} />
          <StatCard icon={TrendingUp} label={uiText("毛利 · 不含退税")} value={`${money(cnyTotals.ex)}（${percent(cnyTotals.revenue ? cnyTotals.ex / cnyTotals.revenue : null)}）`} />
          <StatCard icon={Receipt} label={uiText("出口退税（核准 / 应退）")} value={money(cnyTotals.rebate)} />
          <StatCard icon={TrendingUp} label={uiText("毛利 · 含退税")} value={`${money(cnyTotals.inc)}（${percent(cnyTotals.revenue ? cnyTotals.inc / cnyTotals.revenue : null)}）`} />
        </StatGrid>
        {cnyTotals.estimated > 0 && <Banner tone="warn" title={ui`${cnyTotals.estimated} 单${view === 'actual' ? '含暂估部分' : '按暂估 / 预计汇率折算'}`}>{uiText(view === 'actual' ? '已收未结汇（外币留存）与未收部分按所选月份的月末汇率暂估；结汇并分配到对应到账后转为实际汇率。' : view === 'period' ? '月末暂估汇率仅用于管理报表，结汇后以实际结汇口径为准。' : '报价预计汇率取订单来源报价版本上的报价汇率，仅反映报价时的预期。')}</Banner>}
        {view === 'actual' && unallocated.length > 0 && <Banner tone="accent" title={ui`有结汇未对应到账：${unallocated.map(u => `${u.currency} ${money(u.amount)}（${u.count} 笔）`).join('、')}`}>{uiText("未对应到账的结汇不计入任何订单。请在“账户与余额 → 锁汇 / 结汇”为该结汇补登对应到账。")}</Banner>}
        <section className="mist-section"><Card><DataTable ariaLabel={uiText("订单毛利（人民币）")} rows={cny} rowKey={r => r.id} loading={workspace.loading} columns={cnyColumns} empty={<EmptyState title={uiText("当前范围没有已生效订单")} description={uiText("草稿、待审批或被退回的订单不计入毛利。")} />} /></Card></section>
        <p className="mist-note">{FX_BASIS_LABEL[view]}：{uiText(view === 'actual' ? `订单收入中已收且已结汇的部分（本单发票的核销到账 → 结汇时分配到该到账的金额）按各笔结汇的实际成交汇率；已收未结汇与未收部分、外币采购按不晚于 ${fxMonth} 的最新月末汇率暂估。` : view === 'period' ? `取不晚于 ${fxMonth} 的最新一期月末汇率（财务在“账户与余额”登记）。` : '取订单来源报价版本上冻结的报价汇率（多个报价版本按条目金额加权）；报价未填报价汇率的订单标“缺汇率”。')}{uiText("缺少所选口径汇率的订单不出毛利。不含退税毛利 = 收入 × 汇率 − 已批准采购合同（通常含税价）；含退税毛利再加本单分摊的出口退税（已核准按核准额，未核准按应退额；未申报不计）。未计运费、报关、佣金与索赔扣款。")}</p>
      </>}
    </> : tab === 'actual' ? (state ? <OrderActualCostPanel state={state} asOf={asOf} canWrite={!!session.localMode || session.hasPermission('invoices:write')} busy={workspace.loading || workspace.saving || !!workspace.pending} run={c => workspace.run(c)} /> : <EmptyState title={uiText("正在读取数据")} compact />) : tab === 'aging' ? <>
      <Toolbar right={<span className="mist-note">{uiText("截至 ")}{asOf}</span>}>{currencyFilter}</Toolbar>
      <StatGrid>{AGING_BUCKETS.map(b => <StatCard key={b.key} icon={Clock} label={uiText(b.label)} value={totals(aging, r => r[b.key])} />)}</StatGrid>
      <section className="mist-section"><Card><DataTable ariaLabel={uiText("应收账龄")} rows={aging} rowKey={r => r.id} loading={workspace.loading} columns={agingColumns} empty={<EmptyState title={uiText("没有未收应收")} description={uiText("有效发票均已收清。")} />} /></Card></section>
      <div className="mist-row"><Button onClick={() => go('invoices')}>{uiText("查看发票")}</Button><Button onClick={() => go('payment-vouchers')}>{uiText("查看到账与核销")}</Button></div>
    </> : <>
      <Toolbar right={<span className="mist-note">{uiText("截至 ")}{asOf}{uiText(" · 只含进度未到 100% 的订单")}</span>}><Field label={uiText("交期状态")}><Select aria-label={uiText("交期状态")} value={progressFilter} onChange={e => setProgressFilter(e.target.value)} options={[{ value: '', label: '全部' }, ...Object.entries(PROGRESS_STATUS).map(([value, s]) => ({ value, label: s.label }))]} /></Field></Toolbar>
      <StatGrid>{(Object.keys(PROGRESS_STATUS) as Array<keyof typeof PROGRESS_STATUS>).map(k => <StatCard key={k} icon={Package} label={uiText(PROGRESS_STATUS[k].label)} value={progress.filter(r => r.status === k).length} onClick={() => setProgressFilter(k)} />)}</StatGrid>
      <section className="mist-section"><Card><DataTable ariaLabel={uiText("订单进度")} rows={shownProgress} rowKey={r => r.id} loading={workspace.loading} columns={progressColumns} empty={<EmptyState title={uiText("没有符合条件的未完成订单")} />} /></Card></section>
    </>}</section>
  </MistPage>;
}
