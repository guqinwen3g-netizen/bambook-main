import { uiText, ui } from '../../../../services/interfaceLanguage';
import { useTeamOriginLookup } from '../runtime/teamView';
import {businessNow} from '../runtime/businessClock';
import {OrderProductThumb} from './OrderProductThumb';
/**
 * T3 宽表列表模板 —— 对应真实模块：订单管理（OrderManager）及所有纯记录列表。
 * 结构：页头 → 汇总统计卡（可选）→ Tabs → 工具栏 → 全宽数据表（可排序）
 */
import React from 'react';
import {orderLocked} from './OrderTermination';
import { ChevronRight, ClipboardList, Download, Plus, SearchX, Ship, Wallet, AlertTriangle } from 'lucide-react';
import { Avatar, Banner, Button, Card, DataTable, Dropdown, EmptyState, Icon, MistPage, Mono, ObjectCell, PageHeader, Pagination, Pill, SearchField, StatCard, StatGrid, Tabs, TextLink, Thumb, Toolbar, type Column } from '../../../../components/mist';
import { fmt } from '../data';
import type { MistOrder } from '../../../../server/src/shared/mistWorkspace';
import { useMistWorkspace } from '../runtime/workspace';
import { useNav } from '../nav';
import type {OrderGovernanceFields} from '../../../../server/src/shared/mistOrderGovernance';
import { useMistSession } from '../runtime/auth';
import { OrderSourceDialog } from './OrderSourceDialog';
import { currentLineStage, orderLineFlags } from './orderLineTrack';
import { useDevice } from '../runtime/devicePreferences';
import { downloadGeneratedBlob, requestGeneratedExport } from '../runtime/exportRequests';
const approvalOf=(order:MistOrder)=>(order as MistOrder&{governance?:OrderGovernanceFields}).governance?.status;
/** BB-ORD-7：已作废 / 已取消订单默认不在列表与统计中，可按主单审批筛选查看。 */
export const isTerminatedOrder=(order:MistOrder)=>['void','cancelled'].includes(approvalOf(order)||'');
const approvalLabel=(order:MistOrder)=>({draft:'订单草稿',pending:'待主单审批',approved:'主单已批准',rejected:'主单已退回',void:'已作废',cancelled:'已取消'}[approvalOf(order)||'']||'待补主单审批');

/** Export the displayed records as a real UTF-8 spreadsheet-compatible file. */
export function downloadMistCsv(filename: string, headings: string[], rows: Array<Array<string | number | null | undefined>>, options: { direct?: boolean } = {}) {
  const cell = (value: string | number | null | undefined) => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const blob = new Blob(['\uFEFF', [headings, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const run = () => downloadGeneratedBlob(blob, filename);
  if (options.direct) run(); else requestGeneratedExport({ filename, rowCount: rows.length, run });
  return blob;
}

export function mistDate(value: string): Date | null {
  const normalized = /^\d{2}\/\d{2}$/.test(value) ? `${businessNow().getFullYear()}-${value.replace('/', '-')}` : value;
  const date = new Date(normalized.includes('T') ? normalized : `${normalized}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function OrderListPage() {
  const density = useDevice('density');
  const { go, route } = useNav();
  const { state, loading, error, refresh } = useMistWorkspace();
  const [tab, setTab] = React.useState<'garment' | 'fabric'>(route.section==='fabric'?'fabric':'garment');
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [approvalFilter,setApprovalFilter]=React.useState('all');
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const session = useMistSession(), canWrite = session.hasPermission('orders:write');
  const allOrders = state?.orders ?? [];
  React.useEffect(()=>{if(route.section==='fabric'||route.section==='garment'){setTab(route.section);setStatus('all');}},[route.section]);
  const customerId = route.customerId;
  const family = allOrders.filter(order => order.type === tab && (!customerId || order.customerId === customerId));
  const rows = family.filter(order => (approvalFilter==='all'?!isTerminatedOrder(order):approvalOf(order)===approvalFilter) && (status === 'all' || order.state === status) && (!q || `${order.code} ${order.customer} ${order.season}`.toLowerCase().includes(q.toLowerCase())));
  React.useEffect(() => setPage(1), [tab, q, status, customerId,approvalFilter]);
  const pages = Math.max(1, Math.ceil(rows.length / 20)), currentPage = Math.min(page, pages);
  const active = family.filter(order => approvalOf(order)==='approved' && !['已出运', '履约完成', '已完成', '已取消', '已作废', '待收尾款'].includes(order.state));
  const amounts = [...new Set(active.map(order => order.currency))].map(currency => ({ currency, amount: active.filter(order => order.currency === currency).reduce((sum, order) => sum + order.amount, 0) }));
  const shipped = family.filter(order => ['已出运', '履约完成', '待收尾款'].includes(order.state));
  const partialShipped = family.filter(order => order.state === '部分出运').length;
  const unitTotals = new Map<string, number>();
  for (const line of state?.orderLines ?? []) if (active.some(order => order.id === line.orderId)) unitTotals.set(line.unit, (unitTotals.get(line.unit) ?? 0) + line.qty);
  const dayStart=businessNow();dayStart.setHours(0,0,0,0);
  const overdue = (state?.invoices ?? []).filter(invoice => family.some(order => order.id === invoice.orderId) && invoice.open > 0 && (mistDate(invoice.due)?.getTime() ?? Infinity) < dayStart.getTime());
  const quantityLabel=(order:MistOrder)=>{const totals=new Map<string,number>();for(const line of state?.orderLines||[])if(line.orderId===order.id)totals.set(line.unit,(totals.get(line.unit)||0)+line.qty);return [...totals].map(([unit,total])=>`${fmt(total)} ${uiText(unit)}`).join(' · ')||'未记录数量';};
  const teamsOf = useTeamOriginLookup();
  const cols: Column<MistOrder>[] = [
    { key: 'id', header: '订单', width: 'minmax(220px,2fr)', sortValue: order => order.code, render: order => <ObjectCell thumb={<OrderProductThumb orderId={order.id} category={order.type}/>} name={<Mono>{order.code}</Mono>} meta={<>{`${order.customer} · ${order.season}`}{teamsOf('order', order.id).length ? <span className="mist-team-origin">{uiText(` · ${teamsOf('order', order.id).join('、')}`)}</span> : null}</>} /> },
    { key: 'qty', header: '数量', width: '90px', align: 'right', hideOnMobile: true, sortValue: order => order.qty, render: order => <><span className="mist-num">{quantityLabel(order)}</span><span className="mist-cell-sub">{order.lines}{uiText(" 个条目")}</span></> },
    { key: 'amt', header: '金额', width: '130px', align: 'right', sortValue: order => order.amount, render: order => <><b className="mist-cell-strong mist-num">{fmt(order.amount, 2)}</b><span className="mist-cell-sub">{order.currency}</span></> },
    { key: 'prog', header: '条目阶段', width: 'minmax(190px,1.6fr)', hideOnMobile: true, render: order => { if (!state) return null;if(orderLocked(order))return <span className="mist-muted">—</span>; const flags = orderLineFlags(state, order), shown = flags.tracks.slice(0, 2); const notes = [flags.business && `待业务动作 ${flags.business}`, flags.nok && `QC NOK ${flags.nok}`, flags.toShip && `待出运 ${flags.toShip}`].filter(Boolean) as string[];
      return <div className="mist-col" style={{ gap: 4 }} data-order-stages={order.id}><div className="mist-row" style={{ gap: 4, flexWrap: 'wrap' }}>{shown.map(({ line, stages }) => { const stage = currentLineStage(stages); return <Pill key={line.id} tone={!stage ? 'ok' : stage.state === 'blocked' ? 'bad' : stage.state === 'now' ? 'accent' : 'neutral'}>{line.style} · {uiText(stage ? stage.label : '已出运')}</Pill>; })}{flags.tracks.length > 2 && <span className="mist-muted">+{uiText(flags.tracks.length - 2)}</span>}</div>{notes.length > 0 && <span className={flags.nok ? 'mist-cell-sub mist-tone-bad' : 'mist-cell-sub'}>{notes.join(' · ')}</span>}</div>; } },
    { key: 'due', header: '交期', width: '70px', hideOnMobile: true, sortValue: order => order.due, render: order => <b className="mist-cell-strong" title={uiText(order.due)}>{order.due.slice(-5).replace('-', '/')}</b> },
    { key: 'owner', header: '负责人', width: '56px', hideOnMobile: true, render: order => <Avatar name={order.owner} size="sm" /> },
    { key: 'state', header: '状态', width: '120px', render: order => <><Pill tone={approvalOf(order)==='approved'||isTerminatedOrder(order)?order.tone:'warn'}>{uiText(approvalOf(order)==='approved'?order.state:approvalLabel(order))}</Pill>{approvalOf(order)==='approved'&&<span className="mist-cell-sub">{uiText("主单已批准")}</span>}</> },
    { key: 'go', header: '', width: '16px', hideOnMobile: true, render: () => <span className="mist-go"><Icon icon={ChevronRight} size="sm" /></span> },
  ];
  return <MistPage>
    <PageHeader description={uiText(customerId ? state?.customers.find(customer => customer.id === customerId)?.name : undefined)} eyebrow={uiText("订单履约 · 订单")} title={uiText("订单管理")}
      actions={<><Button icon={Download} disabled={!state} onClick={() => { downloadMistCsv('订单台账.csv', ['订单', '客户', '季节', '数量', '币种', '金额', '交期', '负责人', '主单审批', '状态'], rows.map(order => [order.code, order.customer, order.season, quantityLabel(order), order.currency, order.amount, order.due, order.owner, approvalLabel(order), order.state])); }}>{uiText("导出")}</Button>{canWrite&&<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>{uiText("新建订单")}</Button>}</>} />
    <OrderSourceDialog open={createOpen} onClose={() => setCreateOpen(false)} type={tab} customerId={customerId} canWrite={canWrite} />
    {error && <Banner tone="bad" title={uiText("订单读取失败")} actions={<Button onClick={() => void refresh()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner>}
    <StatGrid>
      <StatCard icon={ClipboardList} label={uiText("在途订单")} value={active.length} unit={uiText("单")} foot={[...unitTotals].map(([unit, quantity]) => `${fmt(quantity)} ${uiText(unit)}`).join(' · ') || '暂无在途条目'} />
      <StatCard icon={Ship} label={uiText("已出运")} value={shipped.length} unit={uiText("单")} foot={[shipped.map(order => order.code).join(' · '), partialShipped ? ui`另有 ${partialShipped} 单部分出运` : ''].filter(Boolean).join(' · ') || '暂无已出运订单'} />
      <StatCard icon={Wallet} label={uiText("在途金额")} value={fmt(amounts[0]?.amount ?? 0, 2)} unit={uiText(amounts[0]?.currency ?? '')} foot={amounts.length > 1 ? amounts.slice(1).map(item => `${fmt(item.amount, 2)} ${item.currency}`).join(' · ') : '按原币种统计'} />
      <StatCard icon={AlertTriangle} label={uiText("逾期收款")} value={overdue.length} unit={uiText("笔")} foot={overdue.length ? '需跟进' : '暂无逾期'} onClick={() => go('payment-vouchers',undefined,{section:`overdue:${tab}`,customerId})} />
    </StatGrid>
    <Tabs<'garment' | 'fabric'> value={tab} onChange={value=>{setTab(value);setStatus('all');}} options={[{ value: 'garment', label: '成衣订单', count: allOrders.filter(order => order.type === 'garment'&&(!customerId||order.customerId===customerId)).length }, { value: 'fabric', label: '面料订单', count: allOrders.filter(order => order.type === 'fabric'&&(!customerId||order.customerId===customerId)).length }]} />
    <Toolbar><SearchField value={q} onChange={setQ} placeholder={uiText("订单号、客户或季节")} /><Dropdown label={uiText("主单审批")} value={approvalFilter} onChange={setApprovalFilter} options={[{value:'all',label:'全部（不含作废 / 取消）'},{value:'draft',label:'草稿'},{value:'pending',label:'待审批'},{value:'approved',label:'已批准'},{value:'rejected',label:'已退回'},{value:'void',label:'已作废'},{value:'cancelled',label:'已取消'}]}/><Dropdown label={uiText("状态")} value={status} onChange={setStatus} options={[{ value: 'all', label: '全部' }, ...[...new Set(family.map(order => order.state))].map(value => ({ value, label: value }))]} />{customerId && <TextLink onClick={() => go('orders')}>{uiText("清除客户筛选")}</TextLink>}</Toolbar>
    <Card><DataTable density={density} ariaLabel={uiText("订单")} columns={cols} rows={rows.slice((currentPage - 1) * 20, currentPage * 20)} rowKey={order => order.id} loading={loading} onRowClick={order => go('orders/detail', order.id,{customerId,section:tab})}
      empty={<EmptyState icon={SearchX} title={uiText(q || status !== 'all' ? '没有匹配的订单' : `还没有${tab === 'garment' ? '成衣' : '面料'}订单`)} action={q || status !== 'all' ? <TextLink onClick={() => { setQ(''); setStatus('all'); }}>{uiText("清除筛选")}</TextLink> : <Button icon={Plus} onClick={() => setCreateOpen(true)}>{uiText("新建订单")}</Button>} />}
      footer={<><span>{rows.length}{uiText(" 个订单")}</span><Pagination page={currentPage} pages={pages} onChange={setPage} /></>} /></Card>
  </MistPage>;
}
