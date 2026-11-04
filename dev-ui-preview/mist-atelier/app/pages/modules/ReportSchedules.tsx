/**
 * fin63 报表定时发送：本人订阅报表按周 / 月发送。到期后在「待我处理」提醒；
 * 「生成并发送」按当前数据生成 Excel、附到智能邮箱草稿，本人确认发出后登记本期已发。
 */
import React from 'react';
import { Mail, Plus, Square } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, EmptyState, Pill } from '../../../../../components/mist';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import { dueReportSchedules, readReportSchedules, REPORT_SCHEDULE_ADMIN_KINDS, REPORT_SCHEDULE_KINDS, reportSchedulePeriod, type MistReportSchedule, type ReportScheduleKind } from '../../../../../server/src/shared/mistReportSchedules';
import { monthlyFinanceSummary } from '../../../../../server/src/shared/mistFinanceReports';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { setComposeIntent } from '../../runtime/composeIntent';
import { buildModuleXlsxFile, ModuleEditorDialog, type ModuleEditorSpec } from './ModuleWorkbench';
import { AGING_BUCKETS, buildCustomerSales, buildOrderMargin, buildOrderProgress, buildReceivableAging, PROGRESS_STATUS } from './PlatformReports';
import { uiText } from '../../../../../services/interfaceLanguage';

const WEEKDAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
/** 与页面导出相同的列；毛利按原币口径（含成本，只给报表管理者）。 */
export function reportSheet(state: MistState, kind: ReportScheduleKind, asOf: string): { name: string; headers: string[]; rows: unknown[][] } {
  if (kind === 'sales') return { name: '客户销售额', headers: ['客户', '币种', '订单数', '订单金额', '已开票', '已收', '未收'], rows: buildCustomerSales(state).map(r => [r.customer, r.currency, r.orders, r.amount, r.invoiced, r.received, r.open]) };
  if (kind === 'aging') return { name: '应收账龄', headers: ['客户', '币种', ...AGING_BUCKETS.map(b => b.label), '未收合计'], rows: buildReceivableAging(state, asOf).map(r => [r.customer, r.currency, ...AGING_BUCKETS.map(b => (r as Record<string, unknown>)[b.key]), r.total]) };
  if (kind === 'orders') return { name: '订单进度', headers: ['订单', '客户', '交期', '进度%', '交期状态', '逾期天数', '当前环节'], rows: buildOrderProgress(state, asOf).map(r => [r.code, r.customer, r.due, r.progress, PROGRESS_STATUS[r.status].label, r.lateDays, r.state]) };
  if (kind === 'cash') return { name: '资金月报', headers: ['月份', '币种', '收款', '付款', '净流入', '退税到账', '汇兑损益', '费用'], rows: monthlyFinanceSummary(state, '', '').map(r => [r.month, r.currency, r.cashIn, r.cashOut, r.net, r.rebate, r.fx, r.expense]) };
  return { name: '订单毛利', headers: ['订单', '客户', '币种', '销售收入', '采购成本', '毛利', '毛利率%'], rows: buildOrderMargin(state).map(r => [r.code, r.customer, r.currency, r.revenue, r.purchases ? r.cost : '', r.margin ?? '', r.rate === null ? '' : Math.round(r.rate * 1000) / 10]) };
}

export function ReportSchedules({ state, canAdmin, asOf }: { state: MistState; canAdmin: boolean; asOf: string }) {
  const { run, uploadFile, saving, pending } = useMistWorkspace(), session = useMistSession(), { go } = useNav();
  const [dialog, setDialog] = React.useState<ModuleEditorSpec | null>(null), [busy, setBusy] = React.useState(''), [error, setError] = React.useState('');
  const me = session.user?.id || '', rows = readReportSchedules(state).filter(s => s.ownerId === me && s.active);
  const due = new Map(dueReportSchedules(state, me, asOf).map(d => [d.schedule.id, d]));
  const kinds = (Object.keys(REPORT_SCHEDULE_KINDS) as ReportScheduleKind[]).filter(k => canAdmin || !REPORT_SCHEDULE_ADMIN_KINDS.includes(k));
  const locked = saving || !!pending || !!busy;
  const spec = (s?: MistReportSchedule): ModuleEditorSpec => ({ title: s ? '修改报表订阅' : '订阅报表', submitLabel: '保存',
    fields: [{ key: 'kind', label: '报表', type: 'select', required: true, options: kinds.map(k => ({ value: k, label: REPORT_SCHEDULE_KINDS[k] })) },
      { key: 'every', label: '频率', type: 'select', required: true, options: [{ value: 'week', label: '每周' }, { value: 'month', label: '每月' }] },
      { key: 'weekday', label: '星期', type: 'select', required: true, options: WEEKDAY.map((label, i) => ({ value: String(i + 1), label })), when: { key: 'every', values: ['week'] } },
      { key: 'monthday', label: '每月几号', type: 'number', required: true, min: 1, step: 1, when: { key: 'every', values: ['month'] } },
      { key: 'to', label: '收件人', required: true, hint: '多个邮箱用逗号分隔' }, { key: 'note', label: '邮件说明', type: 'textarea' }],
    initialValues: { kind: s?.kind || kinds[0], every: s?.every || 'week', weekday: String(s?.every === 'week' ? s.day : 1), monthday: s?.every === 'month' ? s.day : 1, to: s?.to || '', note: s?.note || '' },
    submit: v => run({ type: 'report.schedule.save', payload: { ...(s ? { id: s.id } : {}), kind: String(v.kind) as ReportScheduleKind, every: v.every === 'month' ? 'month' : 'week', day: Number(v.every === 'month' ? v.monthday : v.weekday), to: String(v.to ?? ''), note: String(v.note ?? '') } }) });
  const send = async (s: MistReportSchedule) => {
    if (locked) return; setBusy(s.id); setError('');
    try {
      const period = reportSchedulePeriod(s, asOf).period, sheet = reportSheet(state, s.kind, asOf);
      const file = await uploadFile(await buildModuleXlsxFile(`${sheet.name}-${period}.xlsx`, [sheet]));
      setComposeIntent({ to: s.to, subject: `${sheet.name} · ${period}`, body: `${s.note ? s.note + '\n\n' : ''}附件为截至 ${asOf} 的${sheet.name}。\n`, fileIds: [file.id], afterSent: { type: 'report.schedule.sent', payload: { id: s.id, period } } });
      go('emails');
    } catch (e) { setError(e instanceof Error ? e.message : '未能生成报表'); } finally { setBusy(''); }
  };
  return <Card className="mist-section">
    <CardHeader title={uiText('定时发送')} tools={<Button size="sm" icon={Plus} disabled={locked} onClick={() => setDialog(spec())}>{uiText('订阅报表')}</Button>} />
    {error && <Banner tone="bad" title={uiText('未完成')}>{uiText(error)}</Banner>}
    <DataTable ariaLabel={uiText('报表订阅')} rows={rows} rowKey={r => r.id} density="compact" columns={[
      { key: 'kind', header: '报表', width: 'minmax(120px,1fr)', render: r => REPORT_SCHEDULE_KINDS[r.kind] },
      { key: 'when', header: '频率', width: '110px', render: r => r.every === 'week' ? `每${WEEKDAY[r.day - 1]}` : `每月 ${r.day} 号` },
      { key: 'to', header: '收件人', width: 'minmax(160px,1.6fr)', render: r => <span className="mist-cell-sub">{r.to}</span> },
      { key: 'state', header: '本期', width: '100px', render: r => due.has(r.id) ? <Pill tone="warn">{uiText('待发送')}</Pill> : <Pill tone="ok">{uiText(r.lastPeriod ? '已发' : '未到期')}</Pill> },
      { key: 'act', header: '', width: '220px', render: r => <span className="mist-row">
        {due.has(r.id) && <Button size="sm" variant="primary" icon={Mail} loading={busy === r.id} disabled={locked} onClick={() => void send(r)}>{uiText('生成并发送')}</Button>}
        <Button size="sm" variant="quiet" disabled={locked} onClick={() => setDialog(spec(r))}>{uiText('修改')}</Button>
        <Button size="sm" variant="quiet" icon={Square} disabled={locked} onClick={() => void run({ type: 'report.schedule.stop', payload: { id: r.id } }).catch(e => setError(e instanceof Error ? e.message : '停用未完成'))}>{uiText('停用')}</Button>
      </span> },
    ]} empty={<EmptyState compact title={uiText('还没有订阅')} />} />
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </Card>;
}
