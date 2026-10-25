import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import {businessNow} from '../runtime/businessClock';
/** T1 工作台：保留 Mist 的问候、统计、焦点、简报、任务与日程构图。 */
import React from 'react';
import { ArrowRight, BadgeCheck, FileText, Layers, Plus, Ship, SlidersHorizontal, Sparkles, Wallet, ArrowUpRight, RefreshCw } from 'lucide-react';
import { AIBrief, Agenda, Banner, Button, Card, CardBody, CardHeader, Dialog, Dropdown, EmptyState, Field, FormGrid, HeroFocus, KeyValue, MistPage, PageHeader, Segmented, Select, Skeleton, StatCard, StatGrid, Switch, TaskList, TextLink, WeekStrip, useToast, type TaskItem } from '../../../../components/mist';
import { MIST_LOGISTICS_DUTY, type MistTarget } from '../../../../server/src/shared/mistWorkspace';
import { IMG, STAGES } from '../data';
import { useNav } from '../nav';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { useMyDisplayName } from '../runtime/me';
import {mistActivityTitle} from '../runtime/activityLabels';
import { visibleMistNotifications } from '../runtime/notificationPreferences';
import { useOptionalMistReviews } from '../runtime/reviews';
import { mistWorkQueue, mistMyTasks, mistEmailFollowUpTaskIds, type MistWorkOptions } from '../runtime/workQueue';
import type { View } from '../../../../types';
import { firstWorkspaceImage, useWorkspaceImage } from '../runtime/useWorkspaceImage';

function dateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function weekDays(date: string) {
  const start = new Date(`${date}T12:00:00`); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return { key: dateKey(day), weekday: ['一', '二', '三', '四', '五', '六', '日'][index], day: day.getDate() }; });
}
const money = (value: number) => value.toLocaleString(interfaceLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HomePage() {
  const { go, openAI } = useNav(), toast = useToast(), session = useMistSession(), workspace = useMistWorkspace(), myName = useMyDisplayName(workspace.workspace, workspace.state);
  const { state, loading, saving, pending } = workspace;
  const [range, setRange] = React.useState<'today' | 'week'>('today');
  const [today, setToday] = React.useState(() => dateKey(businessNow()));
  const [day, setDay] = React.useState(today);
  const [sort, setSort] = React.useState<'due' | 'title'>('due');
  const [taskDialog, setTaskDialog] = React.useState(false), [selectedTask, setSelectedTask] = React.useState(''), [taskDone, setTaskDone] = React.useState(false);
  const [reportVersion, setReportVersion] = React.useState<string | null>(null), [error, setError] = React.useState('');
  const [statView,setStatView]=React.useState<'development'|'qc'|'shipping'|'invoices'|null>(null);
  const hidden = new Set(workspace.workspace?.access?.hidden?.map(section => section.key) ?? []);
  const hiddenStats = { development: hidden.has('products')||!session.hasPermission('products:read'), qc: hidden.has('products')||hidden.has('qc')||!session.hasPermission('products:read')||!session.hasPermission('qc:read'), shipping: hidden.has('shipments')||!session.hasPermission('shipments:read'), invoices: hidden.has('receivables')||!session.hasPermission('invoices:read') };
  React.useEffect(() => { if (statView && hiddenStats[statView]) setStatView(null); }, [statView, hiddenStats.development, hiddenStats.qc, hiddenStats.shipping, hiddenStats.invoices]);
  const scope = `${session.sessionKey}:${workspace.workspace?.id ?? ''}`, activeScope = React.useRef(scope); activeScope.current = scope;
  React.useEffect(()=>{const current=dateKey(businessNow());setToday(current);setDay(current);},[scope,state?.settings.businessClock?.at]);
  const alive=React.useRef(true);React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const busy = loading || saving || !!pending, operation = React.useRef(false);
  React.useEffect(() => { setTaskDialog(false); setSelectedTask(''); setReportVersion(null); setStatView(null); setError(''); operation.current = false; }, [scope]);
  React.useEffect(() => { const update = () => setToday(dateKey(businessNow())); const timer = window.setInterval(update, 60000); window.addEventListener('focus', update); return () => { window.clearInterval(timer); window.removeEventListener('focus', update); }; }, []);
  const days = weekDays(today), weekStart = days[0].key, weekEnd = days[6].key;
  const reviews = useOptionalMistReviews(), waitingReviews = reviews?.rows.filter(row => row.canDecide).length ?? 0;
  // 与侧栏同一口径：只列指定给我或我岗位的事项，「N 件事」= 侧栏「我的工作」数字。
  const workOptions: MistWorkOptions = { canRead: view => session.canAccessView(view as View), can: permission => session.hasPermission(permission), me: session.user?.id ?? '', reviews: reviews?.rows, today, workspaceId: workspace.workspace?.id };
  const allTasks = mistMyTasks(state, workOptions);
  const inRange = (date: string) => !date || (range === 'today' ? date <= today : date <= weekEnd);
  const tasks = allTasks.filter(task => (task.kind === 'shipping' && task.permission === MIST_LOGISTICS_DUTY) || inRange(task.due)).slice().sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title, 'zh-CN'));
  const queue = mistWorkQueue(state, workOptions);
  const focus = tasks.at(0) ?? queue.at(0);
  const dev = state?.devs.find(item => item.id === focus?.target.id);
  const version = dev ? state?.versions.find(item => item.devId===dev.id&&item.id === (focus?.target.versionId || dev.currentVersionId)) : undefined;
  const focusImageFile=state&&dev?(firstWorkspaceImage(state.files,version?.fileIds)||firstWorkspaceImage(state.files,dev.fileIds)):undefined;
  const focusImage=useWorkspaceImage(focusImageFile,'cutout-display');
  const report = state?.versions.find(item => item.id === reportVersion);
  const openTarget = (target: MistTarget) => { if (!busy) go(target.view, target.id, target); };
  const run = async (work: () => Promise<unknown>, success?: string) => {
    if (busy || operation.current) return;
    operation.current = true; const current = scope; setError('');
    try { await work(); if (alive.current && activeScope.current === current && success) toast(success); }
    catch (failure) { if (alive.current && activeScope.current === current) { const message = failure instanceof Error ? failure.message : '操作未完成，请重试'; setError(message); toast(message, 'bad'); } }
    finally { if (alive.current && activeScope.current === current) operation.current = false; }
  };
  const emailTasks = mistEmailFollowUpTaskIds(state);
  const queueRows: TaskItem[] = queue.map(item => ({ id: item.id, when: item.when, urgent: item.urgent, title: item.title, meta: item.meta, status: { tone: item.urgent ? 'warn' : 'accent', label: item.sourceLabel } }));
  const taskRows: TaskItem[] = [...queueRows, ...tasks.map(task => ({ id: task.id, when: !task.due ? '未定期限' : task.due < today ? '已逾期' : task.due === today ? '今天' : task.due.slice(5), urgent: !!task.due && task.due <= today,
    title: task.title, meta: [emailTasks.has(task.id) ? '邮件跟进' : task.kind === 'development' ? '开发事项' : task.kind === 'supervision' ? `主管督办${(task as { nudge?: { by: string } }).nudge?.by ? ' · ' + (task as { nudge?: { by: string } }).nudge!.by : ''}` : '工作事项', state?.devs.find(dev=>dev.id===task.target.id)?.code||state?.orders.find(order=>order.id===task.target.id)?.code, task.target.versionId ? state?.versions.find(v => v.id === task.target.versionId)?.label : undefined].filter(Boolean).join(' · '),
    status: { tone: task.due && task.due < today ? 'warn' : 'accent', label: task.due && task.due < today ? '已逾期' : '待处理' } as TaskItem['status'] }))];
  const outstanding = new Map<string, number>();
  state?.invoices.forEach(invoice => { if (invoice.open > 0) outstanding.set(invoice.currency, (outstanding.get(invoice.currency) ?? 0) + invoice.open); });
  const currencies = [...outstanding.entries()].sort(([a], [b]) => a.localeCompare(b));
  const preferredCurrency=state?.settings.companyProfile?.defaultCurrency;
  const mainCurrency = currencies.find(([currency]) => currency===preferredCurrency) ?? currencies.find(([currency]) => currency === 'USD') ?? currencies[0];
  const activeDevs=state?.devs.filter(item=>item.stage<4)||[];
  const qcTasks=state?.fulfillment.qcTasks.filter(task=>task.state==='pending'||task.state==='working')||[];
  const qcVersions=state?.versions.filter(version=>version.returnedAt&&!version.qc&&!qcTasks.some(task=>task.source.kind==='version'&&task.source.versionId===version.id))||[];
  const weekShipments=state?.fulfillment.shipments.filter(shipment=>shipment.state!=='cancelled'&&[shipment.plannedDate,shipment.departedAt?.slice(0,10)].some(date=>date&&date>=weekStart&&date<=weekEnd))||[];
  const statTitles={development:'在途开发案',qc:'待 QC 评审',shipping:'本周出运',invoices:'应收待核销'};
  const statRows:Array<{id:string;label:string;detail:string;target:MistTarget}>=statView==='development'?activeDevs.map(dev=>({id:dev.id,label:dev.code,detail:dev.name,target:{view:'development/detail',id:dev.id}})):statView==='qc'?[...qcTasks.map(task=>({id:task.id,label:task.code,detail:`${task.factory} · ${task.kind==='production'?'生产检验':'样品评审'}`,target:{view:'qc-workbench',id:task.id}})),...qcVersions.map(version=>({id:version.id,label:`${state?.devs.find(dev=>dev.id===version.devId)?.code||''} · ${version.label}`,detail:version.factory,target:{view:'development/detail',id:version.devId,versionId:version.id}}))]:statView==='shipping'?weekShipments.map(shipment=>({id:shipment.id,label:shipment.code,detail:`${shipment.customer} · ${shipment.plannedDate||shipment.departedAt?.slice(0,10)||''}`,target:{view:'shipments',id:shipment.id}})):(state?.invoices.filter(invoice=>invoice.open>0)||[]).map(invoice=>({id:invoice.id,label:invoice.code,detail:`${invoice.customer} · ${money(invoice.open)} ${invoice.currency}`,target:{view:'payment-vouchers',id:invoice.id}}));
  const hour = businessNow().getHours(), greeting = hour < 6 ? '夜深了' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const unread = visibleMistNotifications(state,view=>session.canAccessView(view as View)).filter(notification=>!notification.readAt);
  const brief: Array<{ strong: React.ReactNode; text: React.ReactNode; onClick?: () => void }> = unread.slice(0, 3).map(notification => ({ strong: notification.title, text: notification.detail,
    onClick: () => void run(async () => { const bound=scope;await workspace.run({ type: 'notification.read', payload: { id: notification.id } }); if(alive.current&&activeScope.current===bound)go(notification.target.view, notification.target.id, notification.target); }) }));
  if (!brief.length) (state?.events.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3) ?? []).forEach(event => brief.push({ strong: event.actor, text: mistActivityTitle(state,event.text,{view:({order:'orders/detail',production:'production-board',procurement:'procurement',qc:'qc-workbench'} as Record<string,string>)[event.entityType]||'cockpit',id:event.entityId}), onClick: () => openAI(`说明这条工作记录：${event.text}`) }));
  if (!brief.length) brief.push({ strong: '暂无工作动态', text: '创建开发案或推进工作后，这里会显示对应记录。', onClick: () => go('development/new') });
  const beginTask = () => { const task = tasks[0] ?? allTasks[0]; setSelectedTask(task?.id ?? ''); setTaskDone(task?.done ?? false); setTaskDialog(true); };
  const chosenTask = state?.tasks.find(task => task.id === selectedTask);
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString(interfaceLocale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  return (
    <MistPage>
      <PageHeader description={!state ? uiText(loading ? '正在读取公司业务…' : '公司业务尚未读取成功，请重试。') : undefined} variant="greeting" eyebrow={uiText(`${dateLabel} · ${workspace.workspace?.name ?? '公司工作台'}`)} title={<>{uiText(greeting)}{interfaceLocale() === 'en-US' ? ', ' : '，'}<em>{myName || uiText('同事')}</em></>}
        actions={<><Segmented<'today' | 'week'> ariaLabel={uiText("时间范围")} value={range} onChange={setRange} options={[{ value: 'today', label: '今天' }, { value: 'week', label: '本周' }]} />
          <Button variant="primary" icon={Plus} disabled={busy || !state || !session.hasPermission('products:write')} onClick={() => go('development/new')}>{uiText("新建")}</Button></>} />
      {(error || workspace.error) && <Banner tone="bad" title={uiText(error || workspace.error)} actions={<Button size="sm" icon={RefreshCw} onClick={() => { setError(''); void workspace.refresh(); }}>{uiText("重新读取")}</Button>} />}
      {pending && !saving && <Banner tone="warn" title={uiText("上一次操作结果待核对")} actions={<Button size="sm" disabled={saving} onClick={() => void workspace.recover().catch(problem=>setError(problem instanceof Error?problem.message:'原请求核对失败'))}>{uiText("核对原请求")}</Button>}>{uiText("核对完成前，暂停提交新的操作。")}</Banner>}
      {Object.values(hiddenStats).some(value=>!value)&&<StatGrid cols={Object.values(hiddenStats).filter(value=>!value).length}>
        {!hiddenStats.development&&<StatCard icon={Layers} label={uiText("在途开发案")} value={state ? activeDevs.length : '—'} unit={uiText('个')} onClick={() => setStatView('development')} />}
        {!hiddenStats.qc&&<StatCard icon={BadgeCheck} label={uiText("待 QC 评审")} value={state ? qcTasks.length+qcVersions.length : '—'} unit={uiText('项')} onClick={() => setStatView('qc')} />}
        {!hiddenStats.shipping&&<StatCard icon={Ship} label={uiText("本周出运")} value={state ? weekShipments.length : '—'} unit={uiText('票')} onClick={() => setStatView('shipping')} />}
        {!hiddenStats.invoices&&<StatCard icon={Wallet} label={uiText("应收待核销")} value={state ? money(mainCurrency?.[1] ?? 0) : '—'} unit={uiText(mainCurrency?.[0] ?? '')} foot={currencies.length > 1 ? currencies.filter(([currency]) => currency !== mainCurrency?.[0]).map(([currency, value]) => `${currency} ${money(value)}`).join(' · ') : (state ? `${state.invoices.filter(item => item.open > 0).length} 张未结发票` : '等待公司业务数据')} onClick={() => setStatView('invoices')} />}
      </StatGrid>}

      <section className="mist-grid">
        <HeroFocus className="mist-col-8" meta={focus ? dev ? [<span className="mist-mono">{dev.code}</span>,dev.customer] : [('sourceLabel' in focus ? focus.sourceLabel : '工作事项')] : []} media={dev ? { src: focusImage.src||IMG[dev.img], alt: dev.name } : undefined}
          title={loading ? '正在读取当前焦点' : focus ? dev ? <>{dev.name}<br />{uiText(version ? `${version.label} · ${dev.state}` : dev.state)}</> : focus.title : '当前没有待处理事项'} description={uiText(dev?.goal)}
          steps={dev ? STAGES.map((label, index) => ({ label, state: index < dev.stage ? 'done' : index === dev.stage ? 'now' : 'todo' })) : undefined}
          actions={<><Button variant="white" disabled={busy || !focus} iconRight={ArrowRight} onClick={() => focus && openTarget(focus.target)}>{uiText("打开事项")}</Button>{version?.qc&&<Button variant="glass" disabled={busy} icon={FileText} onClick={() => setReportVersion(version.id)}>{uiText("QC 报告")}</Button>}</>} />
        <AIBrief className="mist-col-4" icon={Sparkles} onAsk={() => openAI('请根据当前可见业务记录，整理下一步行动建议。')} items={state?.settings.notifications.suggestions===false?[{strong:'主动建议已关闭',text:'仍可手动打开小竹。',onClick:()=>openAI('请根据当前可见业务记录，整理下一步行动建议。')}]:brief} />
        <Card className="mist-col-8">
          <CardHeader title={uiText("接着完成")} tools={<><Dropdown<'due' | 'title'> label={uiText("排序")} value={sort} onChange={setSort} options={[{ value: 'due', label: '按期限' }, { value: 'title', label: '按名称' }]} />{reviews && <Button variant="quiet" size="sm" icon={BadgeCheck} onClick={() => go('approvals')}>{uiText(waitingReviews ? `待我审批 ${waitingReviews}` : '审批与放行')}</Button>}<Button variant="quiet" size="sm" icon={SlidersHorizontal} disabled={busy || !state?.tasks.length} onClick={beginTask}>{uiText("管理任务")}</Button></>}><span className="mist-muted" style={{ fontSize: 13 }}>{taskRows.length}{uiText(" 项")}</span></CardHeader>
          {loading ? <CardBody><Skeleton height={72} /><Skeleton height={72} /></CardBody> : taskRows.length ? <TaskList items={taskRows} onOpen={item => { const target = queue.find(entry => entry.id === item.id)?.target ?? tasks.find(task => task.id === item.id)?.target; if (target) openTarget(target); }} /> : <EmptyState compact title={uiText("这个时间范围没有待办")} description={uiText("可以切换本周，或查看其他业务事项。")} />}
        </Card>
        <Card className="mist-col-4">
          <CardHeader title={uiText(day===today?'今日安排':`${day.slice(5)} 安排`)} tools={<TextLink iconRight={ArrowUpRight} onClick={() => go('calendar',undefined,{section:day})}>{uiText("日历")}</TextLink>} />
          <WeekStrip days={days.map(value => ({ ...value, dots: state?.calendar.filter(event => event.date === value.key).length ?? 0 }))} value={day} onChange={setDay} />
          <Agenda events={(state?.calendar.filter(event => event.date === day).slice().sort((a, b) => a.time.localeCompare(b.time)) ?? []).map(event => ({ time: event.time, title: event.target ? <TextLink onClick={() => openTarget(event.target!)}>{event.title}</TextLink> : event.title, meta: event.note }))} />
          {!loading && !state?.calendar.some(event => event.date === day) && <EmptyState compact title={uiText("这一天没有安排")} action={<TextLink onClick={() => go('calendar',undefined,{section:day})}>{uiText("添加日程")}</TextLink>} />}
        </Card>
      </section>
      <Dialog open={taskDialog} onClose={() => setTaskDialog(false)} title={uiText("任务状态")} footer={<><Button variant="quiet" onClick={() => setTaskDialog(false)}>{uiText("关闭")}</Button><Button variant="primary" disabled={busy || !chosenTask || chosenTask.done === taskDone} onClick={() => void run(async () => { await workspace.run({ type: 'task.complete', payload: { id: selectedTask, done: taskDone } }); if (alive.current && activeScope.current === scope) setTaskDialog(false); }, taskDone ? '已完成事项' : '已重新打开事项')}>{uiText("保存状态")}</Button></>}>
        <FormGrid cols={1}><Field label={uiText("事项")}><Select aria-label={uiText("选择事项")} value={selectedTask} onChange={event => { const task = state?.tasks.find(item => item.id === event.target.value); setSelectedTask(event.target.value); setTaskDone(task?.done ?? false); }} options={(chosenTask && !allTasks.includes(chosenTask) ? [chosenTask, ...allTasks] : allTasks).map(task => ({ value: task.id, label: task.title }))} /></Field><Switch label={uiText("已完成")} checked={taskDone} disabled={busy} onChange={setTaskDone} /></FormGrid>
      </Dialog>
      <Dialog open={!!reportVersion} onClose={() => setReportVersion(null)} title={uiText(report?.qc?.report || 'QC 评审')}>
        {report?.qc ? <KeyValue items={[{ label: '版本', value: report.label }, { label: '评审人', value: report.qc.reviewer }, { label: '结论', value: ({ pass: '通过', conditional: '有保留通过', reject: '不通过' })[report.qc.result] }, { label: '评审时间', value: report.qc.reviewedAt }, { label: '意见', value: report.qc.opinion }]} /> : <EmptyState compact title={uiText("此版本没有可读取的评审记录")} />}
      </Dialog>
      <Dialog open={!!statView && !hiddenStats[statView]} onClose={()=>setStatView(null)} title={uiText(statView?statTitles[statView]:'统计明细')}>
        {statRows.length?statRows.map(row=><Button key={row.id} block onClick={()=>{setStatView(null);openTarget(row.target);}}>{uiText(row.label)} · {row.detail}</Button>):<EmptyState compact title={uiText("当前范围没有记录")}/>}
      </Dialog>
    </MistPage>
  );
}
