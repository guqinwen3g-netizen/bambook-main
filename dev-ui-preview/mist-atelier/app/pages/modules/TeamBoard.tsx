import {businessNow} from '../../runtime/businessClock';
/** 全景看板 · 团队：业务主管看下属名下在手的事，并对具体订单 / 客户 / 开发案 / 发票督办。 */
import React from 'react';
import { AlertTriangle, Archive, BellRing, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, Package, Receipt, Ship, Users, Wallet } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, Drawer, EmptyState, Pill, Segmented, StatCard, StatGrid, TextLink, useToast, type Column, type Tone } from '../../../../../components/mist';
import type { MistCommand, MistState, MistTarget } from '../../../../../server/src/shared/mistWorkspace';
import { MIST_BUSINESS_GROUP_LABEL, type MistBusinessGroup } from '../../../../../server/src/shared/mistAccounts';
import { TEAM_DORMANT_DAYS, addBusinessDays, myTeamReport, teamOverview, teamWeeklyReport, teamWeeklyText, weekStartOf, type TeamAttention, type TeamMoney, type TeamRow, type TeamWeekRow } from '../../../../../server/src/shared/mistTeam';
import { platformBusinessDate } from '../../../../../server/src/shared/mistPlatform';
import type { MistMemberOption } from '../../runtime/members';
import { ModuleEditorDialog, downloadModuleCsv, type ModuleEditorSpec, type ModuleValues } from './ModuleWorkbench';
import { DetailBlock } from './pageKit';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sums = (rows: Array<{ currency: string; amount: number }>) => rows.map(r => `${r.currency} ${money(r.amount)}`).join(' / ');
const ATTENTION: Record<TeamAttention, { tone: Tone; label: string }> = { bad: { tone: 'bad', label: '需介入' }, warn: { tone: 'warn', label: '需关注' }, ok: { tone: 'ok', label: '正常' } };
const ORDER_STATUS = { overdue: { tone: 'bad', label: '已过交期' }, soon: { tone: 'warn', label: '7 天内到期' }, ontrack: { tone: 'ok', label: '正常' }, nodue: { tone: 'neutral', label: '未填交期' } } as const;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
type Group = MistBusinessGroup | 'all';
type Nudge = { target: MistTarget; label: string; title: string };

export function nudgeSpec(row: TeamRow, n: Nudge, today: string, run: (c: MistCommand) => Promise<unknown>): ModuleEditorSpec {
  return {
    title: `督办 ${row.name}`, submitLabel: '发出督办',
    description: `对象：${n.label}。督办会进入${row.name}的“我的工作”，由本人完成后勾选；同一对象未完成前不能重复督办。`,
    fields: [
      { key: 'title', label: '督办事项', hint: '写清要对方做什么，2–60 字' },
      { key: 'due', label: '完成期限', type: 'date' },
      { key: 'note', label: '说明', type: 'textarea', required: false },
    ],
    initialValues: { title: n.title, due: addDays(today, 2), note: '' },
    submit: (v: ModuleValues) => run({ type: 'team.nudge', payload: { assigneeId: row.id, title: String(v.title ?? ''), due: String(v.due ?? ''), note: String(v.note ?? ''), target: n.target } } as MistCommand),
  };
}

export function TeamBoard({ state, members, viewer, can, busy, run, go, initialMode = 'now', initialWeek }: {
  state: MistState; members: MistMemberOption[]; viewer: { id: string; owner: boolean }; can: boolean; busy: boolean;
  /** 从“我的工作”周报提醒进入时直接打开周报并定位到上周。 */
  initialMode?: 'now' | 'week'; initialWeek?: string;
  run: (c: MistCommand) => Promise<unknown>; go: (view: string, id?: string, extra?: Record<string, unknown>) => void;
}) {
  const today = platformBusinessDate(businessNow());
  const [group, setGroup] = React.useState<Group>('all'), [mode, setMode] = React.useState<'now' | 'week'>(initialMode), [open, setOpen] = React.useState<string | null>(null), [dialog, setDialog] = React.useState<ModuleEditorSpec | null>(null);
  const rows = teamOverview(state, members, viewer, today, group);
  const row = rows.find(r => r.id === open);
  const total = (f: (r: TeamRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const ar = new Map<string, number>(); for (const r of rows) for (const x of r.overdueReceivable) ar.set(x.currency, Math.round(((ar.get(x.currency) || 0) + x.amount) * 100) / 100);
  const mainAr = [...ar].sort((a, b) => b[1] - a[1])[0];
  const nudgeable = (r: TeamRow) => can && !r.former && !r.self;
  const nudge = (r: TeamRow, n: Nudge) => setDialog(nudgeSpec(r, n, today, run));
  const nudgeOpen = (r: TeamRow, target: MistTarget) => r.nudges.some(x => x.target?.view === target.view && x.target?.id === target.id);
  const nudgeButton = (r: TeamRow, n: Nudge) => nudgeable(r) ? (nudgeOpen(r, n.target) ? <span className="mist-muted">督办中</span> : <Button size="sm" icon={BellRing} disabled={busy} aria-label={`督办 ${n.label}`} onClick={() => nudge(r, n)}>督办</Button>) : null;
  const goTo = (t: MistTarget) => { const { view, id, ...extra } = t; go(view, id, extra); };
  const scopeNote = viewer.owner || !(members.find(m => m.id === viewer.id)?.groups.length) ? '全部成员' : `与你同业务组（${members.find(m => m.id === viewer.id)!.groups.map(g => MIST_BUSINESS_GROUP_LABEL[g]).join('、')}）的成员`;
  const columns: Column<TeamRow>[] = [
    { key: 'name', header: '成员', width: 'minmax(140px,1.2fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><b>{r.name}{r.self ? '（本人）' : ''}</b><small className="mist-muted">{r.former ? '已不在本空间' : r.groups.map(g => MIST_BUSINESS_GROUP_LABEL[g]).join(' · ') || '未设业务组'}</small></div> },
    { key: 'attention', header: '状态', width: 'minmax(160px,1.6fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><Pill tone={ATTENTION[r.attention].tone}>{ATTENTION[r.attention].label}</Pill>{r.reasons[0] && <small className="mist-muted">{r.reasons[0]}{r.reasons.length > 1 ? ` 等 ${r.reasons.length} 项` : ''}</small>}</div> },
    { key: 'customers', header: '客户', width: '64px', align: 'right', render: r => r.customers },
    { key: 'orders', header: '在手订单', width: 'minmax(120px,1fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><span>{r.orders.length} 单</span><small className="mist-muted">{[r.orders.filter(o => o.status === 'overdue').length && `逾期 ${r.orders.filter(o => o.status === 'overdue').length}`, r.orders.filter(o => o.status === 'soon').length && `临近 ${r.orders.filter(o => o.status === 'soon').length}`].filter(Boolean).join(' · ') || sums(r.openAmount) || '—'}</small></div> },
    { key: 'dev', header: '开发 / 寻样', width: '96px', align: 'right', render: r => `${r.devs.length} / ${r.fabrics.length}` },
    { key: 'opp', header: '商机', width: '64px', align: 'right', render: r => r.opportunities.length },
    { key: 'tasks', header: '待办', width: '96px', render: r => <span>{r.tasks.length}{r.tasks.some(t => t.overdue) ? <b>（逾期 {r.tasks.filter(t => t.overdue).length}）</b> : null}</span> },
    { key: 'ar', header: '逾期应收', width: 'minmax(120px,1fr)', align: 'right', render: r => r.overdueReceivable.length ? sums(r.overdueReceivable) : '—' },
    { key: 'nudges', header: '督办中', width: '72px', align: 'right', render: r => r.nudges.length || '—' },
  ];
  return <>
    <div className="mist-section mist-row" style={{ justifyContent: 'space-between' }}>
      <span className="mist-note">范围：{scopeNote}。统计只含你有权查看的数据；交期 {7} 天内为临近，客户超过 {TEAM_DORMANT_DAYS} 天无跟进且无在手订单为久未跟进。</span>
      <span className="mist-row"><Segmented<'now' | 'week'> ariaLabel="团队视图" value={mode} onChange={setMode} options={[{ value: 'now', label: '在手' }, { value: 'week', label: '周报' }]} />
      <Segmented<Group> ariaLabel="业务组" value={group} onChange={setGroup} options={[{ value: 'all', label: '全部' }, { value: 'garment', label: '成衣组' }, { value: 'fabric', label: '面料组' }]} /></span>
    </div>
    {mode === 'week' ? <TeamWeekly state={state} members={members} viewer={viewer} group={group} today={today} initialWeek={initialWeek} canArchive={can} busy={busy} run={run} /> : <>
    <StatGrid>
      <StatCard icon={Users} label="需介入 / 需关注" value={`${rows.filter(r => r.attention === 'bad').length} / ${rows.filter(r => r.attention === 'warn').length}`} unit="人" foot={`共 ${rows.length} 人`} />
      <StatCard icon={Package} label="过交期订单" value={total(r => r.orders.filter(o => o.status === 'overdue').length)} unit="单" foot={`7 天内到期 ${total(r => r.orders.filter(o => o.status === 'soon').length)} 单`} />
      <StatCard icon={ClipboardList} label="逾期待办" value={total(r => r.tasks.filter(t => t.overdue).length)} unit="条" foot={`督办中 ${total(r => r.nudges.length)} 条`} />
      <StatCard icon={Receipt} label="逾期应收" value={mainAr ? money(mainAr[1]) : '0.00'} unit={mainAr?.[0] || ''} foot={ar.size > 1 ? sums([...ar].map(([currency, amount]) => ({ currency, amount }))) : '按订单负责人归属'} />
    </StatGrid>
    <section className="mist-section"><Card>
      <CardHeader title="团队在手" sub="点成员查看明细；需要推进的，对具体订单、客户、开发案或发票督办。" />
      <DataTable ariaLabel="团队在手" rows={rows} rowKey={r => r.id} selectedKey={open || undefined} onRowClick={r => setOpen(r.id)} columns={columns}
        empty={<EmptyState icon={Users} title="范围内没有成员" description="所有者可在 设置 · 工作空间 授权成员并设置业务组。" compact />} />
    </Card></section>
    <Drawer open={!!row} onClose={() => setOpen(null)} size="lg" title={row ? `${row.name}${row.self ? '（本人）' : ''}` : '成员'} sub={row ? `${ATTENTION[row.attention].label} · 客户 ${row.customers} · 在手订单 ${row.orders.length}` : undefined}>
      {row && <div className="mist-col" data-team-member={row.id}>
        {row.former && <Banner tone="bad" icon={AlertTriangle} title="该账号已不在本空间" actions={viewer.owner ? <Button size="sm" onClick={() => go('settings', undefined, { section: 'workspace' })}>去办理成员交接</Button> : undefined}>名下客户、订单与待办没有人跟进。{viewer.owner ? '' : '请工作区所有者在 设置 · 工作空间 办理成员交接。'}</Banner>}
        {row.reasons.length > 0 && !row.former && <Banner tone={row.attention === 'bad' ? 'bad' : 'warn'} title="需要关注">{row.reasons.join('；')}</Banner>}
        {!can && !row.former && !row.self && <span className="mist-note">督办需要客户管理主管权限。</span>}
        <DetailBlock title={`在手订单 · ${row.orders.length}`} aside={row.openAmount.length ? <span className="mist-muted">{sums(row.openAmount)}</span> : undefined}>
          {row.orders.length ? <DataTable ariaLabel={`${row.name} 在手订单`} rows={row.orders} rowKey={o => o.id} onRowClick={o => go('orders/detail', o.id)} columns={[
            { key: 'code', header: '订单', render: o => <div className="mist-col" style={{ gap: 2 }}><b>{o.code}</b><small className="mist-muted">{o.customer}</small></div> },
            { key: 'due', header: '交期', width: '150px', render: o => <div className="mist-col" style={{ gap: 2 }}><span>{o.due || '—'}</span><Pill tone={ORDER_STATUS[o.status].tone}>{o.status === 'overdue' ? `逾期 ${o.lateDays} 天` : ORDER_STATUS[o.status].label}</Pill></div> },
            { key: 'progress', header: '进度', width: '80px', align: 'right', render: o => `${o.progress}%` },
            { key: 'amount', header: '金额', width: '130px', align: 'right', render: o => `${o.currency} ${money(o.amount)}` },
            { key: 'act', header: '', width: '96px', align: 'right', render: o => o.pending ? <span className="mist-muted">审批中</span> : nudgeButton(row, { target: { view: 'orders/detail', id: o.id }, label: `订单 ${o.code}`, title: o.status === 'overdue' ? `订单 ${o.code} 已过交期，核对出货安排并回复客户` : `核对订单 ${o.code} 生产进度与交期` }) },
          ]} /> : <span className="mist-note">没有在手订单。</span>}
        </DetailBlock>
        {row.receivables.length > 0 && <DetailBlock title={`逾期应收 · ${row.receivables.length}`} aside={<span className="mist-muted">{sums(row.overdueReceivable)}</span>}>
          <DataTable ariaLabel={`${row.name} 逾期应收`} rows={row.receivables} rowKey={i => i.id} onRowClick={i => go('invoices', i.id)} columns={[
            { key: 'code', header: '发票', render: i => <div className="mist-col" style={{ gap: 2 }}><b>{i.code}</b><small className="mist-muted">{i.customer}</small></div> },
            { key: 'due', header: '到期', width: '140px', render: i => <div className="mist-col" style={{ gap: 2 }}><span>{i.due}</span><Pill tone={i.days > 30 ? 'bad' : 'warn'}>逾期 {i.days} 天</Pill></div> },
            { key: 'open', header: '未收', width: '130px', align: 'right', render: i => `${i.currency} ${money(i.open)}` },
            { key: 'act', header: '', width: '96px', align: 'right', render: i => nudgeButton(row, { target: { view: 'invoices', id: i.id }, label: `发票 ${i.code}`, title: `催收 ${i.code}，登记客户承诺付款日` }) },
          ]} />
        </DetailBlock>}
        <DetailBlock title={`未完成待办 · ${row.tasks.length}`}>
          {row.tasks.length ? <div className="mist-col">{row.tasks.slice(0, 20).map(t => <div key={t.id} className="mist-row" style={{ justifyContent: 'space-between' }}>
            <TextLink onClick={() => goTo(t.target)}>{t.title}</TextLink>
            <span className="mist-row">{t.nudge && <Pill tone="accent">{t.nudge.by} 督办</Pill>}<Pill tone={t.overdue ? 'bad' : 'neutral'}>{t.due ? (t.overdue ? `已逾期 · ${t.due}` : t.due) : '未定期限'}</Pill></span>
          </div>)}{row.tasks.length > 20 && <span className="mist-note">另有 {row.tasks.length - 20} 条。</span>}</div> : <span className="mist-note">没有未完成待办。</span>}
        </DetailBlock>
        {(row.devs.length > 0 || row.fabrics.length > 0) && <DetailBlock title={`在途开发 · ${row.devs.length} · 寻样 · ${row.fabrics.length}`}>
          <div className="mist-col">
            {row.devs.map(d => <div key={d.id} className="mist-row" style={{ justifyContent: 'space-between' }}><TextLink onClick={() => go('development/detail', d.id)}>{d.code} · {d.name}</TextLink><span className="mist-row"><Pill tone={d.overdue ? 'bad' : 'neutral'}>{d.due || '未定期限'}</Pill>{nudgeButton(row, { target: { view: 'development/detail', id: d.id }, label: `开发案 ${d.code}`, title: `推进开发案 ${d.code}，更新打样进度` })}</span></div>)}
            {row.fabrics.map(f => <div key={f.id} className="mist-row" style={{ justifyContent: 'space-between' }}><span>{f.code} · {f.name}</span><Pill tone={f.overdue ? 'bad' : 'neutral'}>{f.due || '未定期限'}</Pill></div>)}
          </div>
        </DetailBlock>}
        {row.dormant.length > 0 && <DetailBlock title={`久未跟进客户 · ${row.dormant.length}`}>
          <div className="mist-col">{row.dormant.map(c => <div key={c.id} className="mist-row" style={{ justifyContent: 'space-between' }}><TextLink onClick={() => go('crm', c.id, { customerId: c.id })}>{c.code} · {c.name}</TextLink><span className="mist-row"><span className="mist-muted">{c.lastAt ? `上次跟进 ${c.lastAt.slice(0, 10)}` : '没有跟进记录'}</span>{nudgeButton(row, { target: { view: 'crm', id: c.id }, label: `客户 ${c.name}`, title: `跟进客户 ${c.name}，登记跟进记录` })}</span></div>)}</div>
        </DetailBlock>}
        {row.opportunities.length > 0 && <DetailBlock title={`进行中商机 · ${row.opportunities.length}`}>
          <div className="mist-col">{row.opportunities.map(o => <div key={o.id} className="mist-row" style={{ justifyContent: 'space-between' }}><span>{o.name}</span><Pill tone={o.overdue ? 'warn' : 'neutral'}>{o.due ? `预计 ${o.due}` : '未定预计日期'}</Pill></div>)}</div>
        </DetailBlock>}
      </div>}
    </Drawer>
    </>}
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </>;
}

const moneyCell = (rows: TeamMoney) => rows.length ? sums(rows) : '—';
/** 周报：周一至周日的流量（新单、出运、回款、跟进、督办）+ 当前快照；可复制文字版或导出 CSV，由主管自行发送。 */
export function TeamWeekly({ state, members, viewer, group, today, initialWeek, canArchive = false, busy = false, run }: {
  state: MistState; members: MistMemberOption[]; viewer: { id: string; owner: boolean }; group: Group; today: string;
  initialWeek?: string; canArchive?: boolean; busy?: boolean; run?: (c: MistCommand) => Promise<unknown>;
}) {
  const toast = useToast(), current = weekStartOf(today);
  const [week, setWeek] = React.useState(initialWeek && weekStartOf(initialWeek) === initialWeek && initialWeek <= current ? initialWeek : current);
  /** 已结束的周：本人存档过就显示存档版本（数据冻结在生成那一刻），否则显示实时计算并可存档。 */
  const archived = myTeamReport(state, viewer.id, week);
  const live = teamWeeklyReport(state, members, viewer, week, today, group);
  const report = archived ? archived.report : live, t = report.totals;
  const text = archived ? archived.text : teamWeeklyText(report);
  const ended = week < current;
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('周报文字已复制'); } catch { toast('复制失败，请改用导出', 'bad'); } };
  const archive = async () => { if (!run) return; const r = await run({ type: 'team.weekly.archive', payload: { weekStart: week } } as MistCommand); if (r !== undefined) toast('周报已生成并存档'); };
  const exportCsv = () => downloadModuleCsv(`团队周报-${report.weekStart}.csv`, ['成员', '新接订单', '新单金额', '出运票数', '出运数量', '回款', '新开发案', '客户跟进', '赢单', '流失', '完成待办', '收到督办', '完成督办', '逾期督办', '当前过交期订单', '当前逾期应收'],
    report.rows.map(r => [r.name + (r.former ? '（已不在本空间）' : ''), r.newOrders, sums(r.newOrderAmount), r.shipments, r.shippedQty, sums(r.collected), r.newDevs, r.followUps, r.won, r.lost, r.tasksDone, r.nudgesIn, r.nudgesDone, r.nudgesOpenLate, r.lateOrders, sums(r.overdueReceivable)]));
  const columns: Column<TeamWeekRow>[] = [
    { key: 'name', header: '成员', width: 'minmax(110px,1fr)', render: r => <b>{r.name}{r.former ? '（已不在本空间）' : ''}</b> },
    { key: 'orders', header: '新接订单', width: 'minmax(120px,1fr)', render: r => <div className="mist-col" style={{ gap: 2 }}><span>{r.newOrders} 单</span>{r.newOrderAmount.length > 0 && <small className="mist-muted">{sums(r.newOrderAmount)}</small>}</div> },
    { key: 'ship', header: '出运', width: '96px', align: 'right', render: r => r.shipments ? `${r.shipments} 票 · ${r.shippedQty}` : '—' },
    { key: 'collected', header: '回款', width: 'minmax(110px,1fr)', align: 'right', render: r => moneyCell(r.collected) },
    { key: 'follow', header: '跟进 / 新开发', width: '104px', align: 'right', render: r => `${r.followUps} / ${r.newDevs}` },
    { key: 'opp', header: '赢单 / 流失', width: '96px', align: 'right', render: r => `${r.won} / ${r.lost}` },
    { key: 'tasks', header: '完成待办', width: '80px', align: 'right', render: r => r.tasksDone },
    { key: 'nudge', header: '督办 收到/完成', width: '112px', align: 'right', render: r => <span>{r.nudgesIn} / {r.nudgesDone}{r.nudgesOpenLate ? <b>（逾期 {r.nudgesOpenLate}）</b> : null}</span> },
    { key: 'late', header: '当前过交期', width: '88px', align: 'right', render: r => r.lateOrders || '—' },
    { key: 'ar', header: '当前逾期应收', width: 'minmax(110px,1fr)', align: 'right', render: r => moneyCell(r.overdueReceivable) },
  ];
  return <div data-team-weekly={report.weekStart}>
    <div className="mist-section mist-row" style={{ justifyContent: 'space-between' }}>
      <span className="mist-row"><Button size="sm" icon={ChevronLeft} aria-label="上一周" onClick={() => setWeek(addBusinessDays(week, -7))} /><b>{report.weekStart} 至 {report.weekEnd}</b>{week === current && <Pill tone="accent">本周 · 统计到 {today}</Pill>}<Button size="sm" icon={ChevronRight} aria-label="下一周" disabled={week >= current} onClick={() => setWeek(addBusinessDays(week, 7))} /></span>
      <span className="mist-row">{ended && !archived && canArchive && run && <Button size="sm" variant="primary" icon={Archive} disabled={busy} onClick={() => void archive()}>生成并存档</Button>}<Button size="sm" icon={Copy} onClick={() => void copy()}>复制周报文字</Button><Button size="sm" icon={Download} disabled={!report.rows.length} onClick={exportCsv}>导出 CSV</Button></span>
    </div>
    {archived ? <Banner tone="ok" title={`已存档 · ${archived.scope}`}>由 {archived.generatedBy} 于 {archived.generatedAt.slice(0, 16).replace('T', ' ')} 生成；以下是生成那一刻的数据，之后的补录不会改变它。</Banner>
      : ended && canArchive && run ? <Banner tone="warn" title="这一周已结束，尚未存档">点“生成并存档”把此刻的数据冻结成正式周报，之后可随时回看、复制或导出。</Banner> : null}
    <StatGrid>
      <StatCard icon={Package} label="新接订单" value={t.newOrders} unit="单" foot={sums(t.newOrderAmount) || '本周没有新单'} />
      <StatCard icon={Ship} label="出运" value={t.shipments} unit="票" foot={`合计 ${t.shippedQty} 件/米`} />
      <StatCard icon={Wallet} label="回款" value={t.collected[0] ? money(t.collected[0].amount) : '0.00'} unit={t.collected[0]?.currency || ''} foot={t.collected.length > 1 ? sums(t.collected) : '按到账日、已核销到发票'} />
      <StatCard icon={BellRing} label="督办 完成 / 发出" value={`${t.nudgesDone} / ${t.nudgesIn}`} unit="条" foot={`逾期未完成 ${t.nudgesOpenLate} 条`} />
    </StatGrid>
    <section className="mist-section"><Card>
      <CardHeader title="成员本周" sub={`新单按建单日、出运按离港日、回款按到账日（已核销到该成员订单的发票）；${archived ? '“当前”两列是存档时的状态。' : '“当前”两列是此刻的状态，不是当周历史值。'}`} />
      <DataTable ariaLabel="团队周报" rows={report.rows} rowKey={r => r.id} columns={columns} empty={<EmptyState icon={Users} title="范围内没有成员" compact />} />
    </Card></section>
    <span className="mist-note">本系统只生成周报内容；复制或导出后由你自行发送。</span>
  </div>;
}
