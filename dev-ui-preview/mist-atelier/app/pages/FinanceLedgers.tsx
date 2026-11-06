/** Finance overviews: payment outlook, payables aging, supplier statement and the monthly voucher export. Read-only. */
import React from 'react';
import { Button, Card, CardHeader, DataTable, EmptyState, Field, FormGrid, Pill, Select, Tabs, TextInput } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { businessNow } from '../runtime/businessClock';
import { platformBusinessDate } from '../../../../server/src/shared/mistPlatform';
import { AGING_BUCKETS, paymentOutlook, payablesAging, supplierStatement } from '../../../../server/src/shared/mistPayableViews';
import { monthlyVouchers, VOUCHER_HEADERS, voucherRow } from '../../../../server/src/shared/mistVoucherExport';
import { downloadModuleXlsx } from './modules/ModuleWorkbench';
import { fmt } from '../data';

type Tab = 'outlook' | 'aging' | 'statement' | 'vouchers';
export function FinanceLedgers() {
  const { state } = useMistWorkspace(), session = useMistSession();
  const today = platformBusinessDate(businessNow()), [tab, setTab] = React.useState<Tab>('outlook');
  const suppliers = [...new Map((state?.payables?.bills || []).map(b => [b.supplierId, b.supplier])).entries()];
  const [supplierId, setSupplierId] = React.useState(''), [from, setFrom] = React.useState(today.slice(0, 4) + '-01-01'), [to, setTo] = React.useState(today);
  const lastMonth = (() => { const [y, m] = today.split('-').map(Number); return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`; })(), [month, setMonth] = React.useState(lastMonth);
  if (!state || !session.hasPermission('vouchers:read' as never)) return null;
  const outlook = paymentOutlook(state, today), aging = payablesAging(state, today), statement = supplierId ? supplierStatement(state, supplierId, from, to) : [];
  const totals = (items: Array<{ currency: string; amount: number }>) => [...items.reduce((m, i) => m.set(i.currency, Math.round(((m.get(i.currency) || 0) + i.amount) * 100) / 100), new Map<string, number>())].map(([c, n]) => `${fmt(n, 2)} ${c}`).join(' / ') || '—';
  return <Card>
    <CardHeader title={uiText('应付与账务')} />
    <div className="mist-card-body mist-col">
      <Tabs<Tab> value={tab} onChange={setTab} options={[{ value: 'outlook', label: '付款计划总览' }, { value: 'aging', label: '应付账龄' }, { value: 'statement', label: '供应商对账单' }, { value: 'vouchers', label: '凭证导出' }]} />
      {tab === 'outlook' && <DataTable ariaLabel={uiText('付款计划总览')} rows={outlook} rowKey={w => w.start} density="comfy" columns={[
        { key: 'w', header: '周（起）', render: w => w.start },
        { key: 'n', header: '笔数', align: 'right', render: w => w.items.length },
        { key: 't', header: '应付', align: 'right', render: w => totals(w.items) },
        { key: 'o', header: '', render: w => w.items.some(i => i.overdue) ? <Pill tone="bad">{uiText('含逾期')}</Pill> : null },
        { key: 'd', header: '明细', render: w => <small className="mist-muted">{w.items.slice(0, 4).map(i => `${i.supplier} ${fmt(i.amount, 2)} ${i.currency}`).join('；')}{w.items.length > 4 ? ' …' : ''}</small> },
      ]} />}
      {tab === 'aging' && (aging.length ? <DataTable ariaLabel={uiText('应付账龄')} rows={aging} rowKey={r => r.supplier + r.currency} density="comfy" columns={[
        { key: 's', header: '供应商', render: r => r.supplier }, { key: 'c', header: '币种', render: r => r.currency },
        ...AGING_BUCKETS.map(([k, label]) => ({ key: k, header: label, align: 'right' as const, render: (r: typeof aging[number]) => r.buckets[k] ? fmt(r.buckets[k], 2) : '—' })),
        { key: 't', header: '合计', align: 'right', render: r => fmt(r.total, 2) },
      ]} /> : <EmptyState compact title={uiText('没有未付票据')} />)}
      {tab === 'statement' && <>
        <FormGrid><Field label={uiText('供应商')}><Select aria-label={uiText('对账供应商')} value={supplierId} onChange={e => setSupplierId(e.target.value)} options={[{ value: '', label: '请选择' }, ...suppliers.map(([id, name]) => ({ value: id, label: name }))]} /></Field><Field label={uiText('起')}><TextInput aria-label={uiText('对账起始日')} type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label={uiText('止')}><TextInput aria-label={uiText('对账截止日')} type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></FormGrid>
        {statement.map(sec => <div key={sec.currency} className="mist-col">
          <DataTable ariaLabel={uiText(`供应商对账 ${sec.currency}`)} rows={sec.lines.map((l, i) => ({ ...l, id: `${i}:${l.ref}` }))} rowKey={l => l.id} density="comfy" columns={[
            { key: 'd', header: '日期', render: l => l.date }, { key: 'k', header: '类型', render: l => ({ bill: '票据', payment: '付款', deduction: '扣款' }[l.kind]) }, { key: 'r', header: '单据', render: l => l.ref },
            { key: 'cr', header: '应付增加', align: 'right', render: l => l.credit ? fmt(l.credit, 2) : '' }, { key: 'dr', header: '支付 / 扣减', align: 'right', render: l => l.debit ? fmt(l.debit, 2) : '' }, { key: 'b', header: '余额', align: 'right', render: l => fmt(l.balance, 2) },
          ]} />
          <div className="mist-row"><span className="mist-note">{uiText(`${sec.currency} 期初 ${fmt(sec.opening, 2)} · 期末 ${fmt(sec.closing, 2)}`)}</span><span className="mist-spacer" /><Button size="sm" onClick={() => downloadModuleXlsx(`供应商对账单-${suppliers.find(([id]) => id === supplierId)?.[1]}-${sec.currency}-${from}_${to}.xlsx`, [{ name: '对账单', headers: ['日期', '类型', '单据', '应付增加', '支付/扣减', '余额'], rows: [['', '期初', '', '', '', sec.opening], ...sec.lines.map(l => [l.date, ({ bill: '票据', payment: '付款', deduction: '扣款' })[l.kind], l.ref, l.credit || '', l.debit || '', l.balance]), ['', '期末', '', '', '', sec.closing]] }])}>{uiText('导出 Excel')}</Button></div>
        </div>)}
        {supplierId && !statement.length && <EmptyState compact title={uiText('该期间没有往来')} />}
      </>}
      {tab === 'vouchers' && <div className="mist-row"><Field label={uiText('月份')}><TextInput aria-label={uiText('凭证月份')} type="month" value={month} onChange={e => setMonth(e.target.value)} /></Field><span className="mist-spacer" /><Button variant="primary" onClick={() => { const lines = monthlyVouchers(state, month); downloadModuleXlsx(`凭证-${month}.xlsx`, [{ name: '凭证', headers: VOUCHER_HEADERS, rows: lines.map(voucherRow) }]); }}>{uiText('导出凭证 Excel')}</Button></div>}
    </div>
  </Card>;
}
