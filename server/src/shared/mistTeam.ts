/**
 * 主管团队视角（2026-10-18）。业务主管（relations:admin）一屏看到下属名下在手的事，卡在哪里一眼就清楚：
 * - 团队范围：所有者或未设业务组的主管看全部成员；否则看与自己同业务组（成衣 / 面料）的成员，含本人；
 *   已不在本公司、名下仍有业务的前成员单独列出，提示办理交接。
 * - 每人一行：客户、在手订单（逾期 / 7 天内到期）、在途开发与寻样、进行中商机、未完成与逾期待办、逾期应收（按币种）、
 *   审批中订单、久未跟进客户、未完成督办；按需要关注程度排序。统计只基于当前账号可读的数据。
 * - 督办（team.nudge）：主管针对某个订单 / 客户 / 开发案 / 发票给成员派一条带期限的“督办”待办，进入对方“我的工作”；
 *   同一对象对同一成员只能有一条未完成督办；不能督办自己。完成仍由成员本人在待办中勾选。
 */
import { isOrderTerminated } from './mistOrderGovernance';
import { MistCommandError, isActiveMistInvoice, type MistContext, type MistState, type MistTarget, type MistTask } from './mistWorkspace';
import { accountOwnedObjects, resolveMember, type MistBusinessGroup } from './mistAccounts';
import { platformBusinessDate } from './mistPlatform';
import { mistInvoiceCustomerName } from './mistOpeningBalance';

export const TEAM_DORMANT_DAYS = 60;
export const TEAM_SOON_DAYS = 7;
export type TeamNudge = { byId: string; by: string; at: string; note: string };
export type TeamTask = MistTask & { nudge?: TeamNudge };
export type TeamCommand = { type: 'team.nudge'; payload: { assigneeId: string; title: string; due: string; note?: string; target: MistTarget } }
  | { type: 'team.weekly.archive'; payload: { weekStart: string } };
export const teamCommandPermission = (_c: TeamCommand) => 'relations:admin';

export type TeamMember = { id: string; name: string; groups: MistBusinessGroup[]; owner?: boolean };
export type TeamOrderRow = { id: string; code: string; customer: string; due: string; progress: number; amount: number; currency: string; status: 'overdue' | 'soon' | 'ontrack' | 'nodue'; lateDays: number; pending: boolean };
export type TeamTaskRow = { id: string; title: string; due: string; overdue: boolean; target: MistTarget; nudge?: TeamNudge };
export type TeamInvoiceRow = { id: string; code: string; customer: string; due: string; open: number; currency: string; days: number };
export type TeamItemRow = { id: string; code: string; name: string; due: string; overdue: boolean };
export type TeamCustomerRow = { id: string; code: string; name: string; lastAt: string | null };
export type TeamAttention = 'bad' | 'warn' | 'ok';
export type TeamRow = {
  id: string; name: string; groups: MistBusinessGroup[]; self: boolean; former: boolean; attention: TeamAttention; reasons: string[];
  customers: number; orders: TeamOrderRow[]; openAmount: Array<{ currency: string; amount: number }>;
  devs: TeamItemRow[]; fabrics: TeamItemRow[]; opportunities: TeamItemRow[]; tasks: TeamTaskRow[];
  receivables: TeamInvoiceRow[]; overdueReceivable: Array<{ currency: string; amount: number }>; dormant: TeamCustomerRow[]; nudges: TeamTaskRow[];
};

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const dayNo = (d: string) => Math.floor(Date.parse(d.slice(0, 10) + 'T00:00:00Z') / 86400000);
const daysBetween = (from: string, to: string) => dayNo(to) - dayNo(from);
const round2 = (n: number) => Math.round(n * 100) / 100;
const sumBy = (rows: Array<{ currency: string; amount: number }>) => { const m = new Map<string, number>(); for (const r of rows) m.set(r.currency, round2((m.get(r.currency) || 0) + r.amount)); return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount })); };

/** 主管能看到的成员：所有者或未设业务组的看全部；否则看同业务组成员（含本人）。 */
export function teamMembers(directory: TeamMember[], viewer: { id: string; owner: boolean }, group: MistBusinessGroup | 'all' = 'all'): TeamMember[] {
  const me = directory.find(m => m.id === viewer.id), mine = me?.groups || [];
  const scoped = viewer.owner || !mine.length ? directory : directory.filter(m => m.id === viewer.id || m.groups.some(g => mine.includes(g)));
  return group === 'all' ? scoped : scoped.filter(m => m.groups.includes(group));
}

const openTask = (t: MistTask, id: string) => !t.done && (t.assigneeIds || []).includes(id);
function orderRow(state: MistState, o: MistState['orders'][number], today: string): TeamOrderRow {
  const late = o.due ? daysBetween(o.due, today) : 0;
  const status: TeamOrderRow['status'] = !o.due ? 'nodue' : late > 0 ? 'overdue' : late >= -TEAM_SOON_DAYS ? 'soon' : 'ontrack';
  const g = o.governance;
  return { id: o.id, code: o.code, customer: o.customer, due: o.due, progress: o.progress, amount: o.amount, currency: o.currency, status, lateDays: Math.max(0, late), pending: g?.status === 'pending' || g?.changeDraft?.status === 'pending' };
}

/** 一个账号名下在手的事。 */
export function teamRow(state: MistState, member: { id: string; name: string; groups?: MistBusinessGroup[] }, today: string, flags: { self?: boolean; former?: boolean } = {}): TeamRow {
  const id = member.id;
  const customers = state.customers.filter(c => c.ownerId === id);
  const orders = state.orders.filter(o => o.ownerId === id && o.progress < 100 && !isOrderTerminated(o)).map(o => orderRow(state, o, today))
    .sort((a, b) => ({ overdue: 0, soon: 1, ontrack: 2, nodue: 3 }[a.status] - { overdue: 0, soon: 1, ontrack: 2, nodue: 3 }[b.status]) || b.lateDays - a.lateDays || a.due.localeCompare(b.due));
  const item = (code: string, name: string, due: string, rid: string): TeamItemRow => ({ id: rid, code, name, due, overdue: !!due && due < today });
  const devs = (state.devs || []).filter(d => d.ownerId === id && d.stage < 4).map(d => item(d.code, d.name, d.due, d.id));
  const fabrics = (state.fabrics || []).filter(f => f.ownerId === id && !f.confirmed).map(f => item(f.code, f.name, f.due, f.id));
  const opportunities = (state.crm?.opportunities || []).filter(o => o.ownerId === id && o.stage !== 'won' && o.stage !== 'lost').map(o => item('', o.title, o.expectedDate, o.id));
  const allTasks = (state.tasks as TeamTask[]).filter(t => openTask(t, id)).map(t => ({ id: t.id, title: t.title, due: t.due, overdue: !!t.due && t.due < today, target: t.target, ...(t.nudge ? { nudge: t.nudge } : {}) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due || '9999').localeCompare(b.due || '9999'));
  const ownedOrders = new Set(state.orders.filter(o => o.ownerId === id).map(o => o.id));
  const ownedCustomers = new Set(state.customers.filter(c => c.ownerId === id).map(c => c.id));
  const receivables = state.invoices.filter(i => (ownedOrders.has(i.orderId) || !!i.opening && !!i.customerId && ownedCustomers.has(i.customerId)) && isActiveMistInvoice(i) && i.open > 0 && i.due && i.due < today)
    .map(i => ({ id: i.id, code: i.code, customer: mistInvoiceCustomerName(state, i), due: i.due, open: i.open, currency: i.currency, days: daysBetween(i.due, today) })).sort((a, b) => b.days - a.days);
  const followUps = state.crm?.followUps || [];
  const busy = new Set(orders.map(o => state.orders.find(x => x.id === o.id)?.customerId));
  const dormant = customers.filter(c => !busy.has(c.id)).map(c => ({ c, lastAt: followUps.filter(f => f.customerId === c.id).map(f => f.at).sort().at(-1) || null }))
    .filter(({ c, lastAt }) => { const from = lastAt || c.since; return !!from && /^\d{4}-\d{2}-\d{2}/.test(from) && daysBetween(from, today) > TEAM_DORMANT_DAYS; })
    .map(({ c, lastAt }) => ({ id: c.id, code: c.code, name: c.name, lastAt }));
  const late = orders.filter(o => o.status === 'overdue'), soon = orders.filter(o => o.status === 'soon');
  const lateTasks = allTasks.filter(t => t.overdue), longAr = receivables.filter(r => r.days > 30);
  const reasons: string[] = [];
  if (flags.former && (accountOwnedObjects(state, id).length || allTasks.length)) reasons.push('已不在本公司，名下业务待交接');
  if (late.length) reasons.push(`${late.length} 个订单已过交期`);
  if (longAr.length) reasons.push(`${longAr.length} 张发票逾期超过 30 天`);
  if (lateTasks.length) reasons.push(`${lateTasks.length} 条待办已逾期`);
  if (soon.length) reasons.push(`${soon.length} 个订单 ${TEAM_SOON_DAYS} 天内到期`);
  if (receivables.length > longAr.length) reasons.push(`${receivables.length - longAr.length} 张发票刚逾期`);
  if (dormant.length) reasons.push(`${dormant.length} 个客户超过 ${TEAM_DORMANT_DAYS} 天未跟进`);
  const attention: TeamAttention = flags.former || late.length || longAr.length || lateTasks.length >= 3 ? 'bad' : reasons.length ? 'warn' : 'ok';
  return {
    id, name: member.name, groups: member.groups || [], self: !!flags.self, former: !!flags.former, attention, reasons,
    customers: customers.length, orders, openAmount: sumBy(orders.map(o => ({ currency: o.currency, amount: o.amount }))),
    devs, fabrics, opportunities, tasks: allTasks, receivables, overdueReceivable: sumBy(receivables.map(r => ({ currency: r.currency, amount: r.open }))), dormant,
    nudges: allTasks.filter(t => t.nudge),
  };
}

/** 团队一览：范围内成员 + 名下仍有业务的前成员；需要关注的排前面。 */
export function teamOverview(state: MistState, directory: TeamMember[], viewer: { id: string; owner: boolean }, today: string, group: MistBusinessGroup | 'all' = 'all'): TeamRow[] {
  const members = teamMembers(directory, viewer, group);
  const rows = members.map(m => teamRow(state, m, today, { self: m.id === viewer.id }));
  if (group === 'all') {
    const known = new Set(directory.map(m => m.id));
    const formerIds = new Set<string>();
    for (const r of [...state.customers, ...state.orders, ...(state.devs || []), ...(state.fabrics || []), ...(state.crm?.opportunities || [])]) if (r.ownerId && !known.has(r.ownerId)) formerIds.add(r.ownerId);
    for (const t of state.tasks) if (!t.done) for (const a of t.assigneeIds || []) if (!known.has(a) && a) formerIds.add(a);
    for (const fid of formerIds) {
      const name = [...state.customers, ...state.orders, ...(state.devs || []), ...(state.fabrics || [])].find(r => r.ownerId === fid)?.owner || fid;
      const row = teamRow(state, { id: fid, name }, today, { former: true });
      if (row.reasons.length) rows.push(row);
    }
  }
  const rank = { bad: 0, warn: 1, ok: 2 };
  return rows.sort((a, b) => rank[a.attention] - rank[b.attention] || Number(a.former) - Number(b.former) || a.name.localeCompare(b.name, 'zh-CN'));
}

/** 可督办的对象：订单、客户、开发案、发票；返回规范化目标与显示名。 */
export function nudgeTarget(state: MistState, target: unknown): { target: MistTarget; label: string; entityType: string; entityId: string } {
  const t = (target && typeof target === 'object' ? target : {}) as Partial<MistTarget>;
  const id = typeof t.id === 'string' ? t.id : '';
  if (!id) fail('请选择督办的对象');
  if (t.view === 'orders/detail') { const o = state.orders.find(x => x.id === id) || fail('订单不存在', 'NOT_FOUND'); return { target: { view: 'orders/detail', id }, label: `订单 ${o.code}`, entityType: 'order', entityId: id }; }
  if (t.view === 'crm') { const c = state.customers.find(x => x.id === id) || fail('客户不存在', 'NOT_FOUND'); return { target: { view: 'crm', id, customerId: id }, label: `客户 ${c.name}`, entityType: 'customer', entityId: id }; }
  if (t.view === 'development/detail') { const d = (state.devs || []).find(x => x.id === id) || fail('开发案不存在', 'NOT_FOUND'); return { target: { view: 'development/detail', id }, label: `开发案 ${d.code}`, entityType: 'development', entityId: id }; }
  if (t.view === 'invoices') { const i = state.invoices.find(x => x.id === id) || fail('发票不存在', 'NOT_FOUND'); return { target: { view: 'invoices', id }, label: `发票 ${i.code}`, entityType: 'invoice', entityId: id }; }
  return fail('督办对象只能是订单、客户、开发案或发票');
}

export function applyTeamCommand(root: MistState, command: TeamCommand, c: MistContext): { id: string } {
  if (command.type === 'team.weekly.archive') return archiveWeekly(root, command.payload, c);
  if (command.type !== 'team.nudge') fail('未知操作');
  const p = (command.payload || {}) as Extract<TeamCommand, { type: 'team.nudge' }>['payload'];
  const member = resolveMember(c, p.assigneeId, '督办对象');
  if (member.id === c.actorId) fail('不能督办自己');
  const title = typeof p.title === 'string' ? p.title.trim().replace(/\s+/g, ' ') : '';
  if (title.length < 2 || title.length > 60) fail('督办事项请写 2–60 个字');
  const note = typeof p.note === 'string' ? p.note.trim() : '';
  if (note.length > 200) fail('说明不超过 200 字');
  const due = typeof p.due === 'string' ? p.due : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due + 'T00:00:00Z')) || new Date(due + 'T00:00:00Z').toISOString().slice(0, 10) !== due) fail('请填写有效的完成期限');
  if (due < platformBusinessDate(c.now)) fail('完成期限不能早于今天');
  const t = nudgeTarget(root, p.target);
  const dup = (root.tasks as TeamTask[]).find(x => !x.done && x.nudge && x.assigneeIds.includes(member.id) && x.target?.view === t.target.view && x.target?.id === t.target.id);
  if (dup) fail(`已给 ${member.name} 督办过${t.label}（${dup.title}），待对方完成后再督办`, 'CONFLICT');
  const id = c.id();
  const task: TeamTask = { id, title: `督办：${title}`, due, done: false, kind: 'supervision', target: t.target, assigneeIds: [member.id], nudge: { byId: c.actorId || '', by: c.actorName, at: c.now, note } };
  root.tasks.unshift(task);
  root.events.unshift({ id: c.id(), entityType: t.entityType, entityId: t.entityId, actor: c.actorName, at: c.now, text: `督办 ${member.name}：${title}（${due} 前）${note ? '。' + note : ''}`, fileIds: [] });
  return { id };
}

/* ---------------- 主管周报（按周一至周日，Asia/Shanghai 业务日） ---------------- */
export type TeamMoney = Array<{ currency: string; amount: number }>;
export type TeamWeekRow = {
  id: string; name: string; former: boolean;
  newOrders: number; newOrderAmount: TeamMoney; shipments: number; shippedQty: number; collected: TeamMoney;
  newDevs: number; followUps: number; won: number; lost: number; tasksDone: number;
  nudgesIn: number; nudgesDone: number; nudgesOpenLate: number;
  /** 当前快照（不是历史值）：过交期订单、逾期应收。 */
  lateOrders: number; overdueReceivable: TeamMoney;
};
export type TeamWeekReport = { weekStart: string; weekEnd: string; asOf: string; rows: TeamWeekRow[]; totals: Omit<TeamWeekRow, 'id' | 'name' | 'former'> };

/** 某日所在周的周一。 */
export function weekStartOf(day: string) { const n = dayNo(day), dow = (new Date(n * 86400000).getUTCDay() + 6) % 7; return new Date((n - dow) * 86400000).toISOString().slice(0, 10); }
export const addBusinessDays = (day: string, n: number) => new Date((dayNo(day) + n) * 86400000).toISOString().slice(0, 10);
const bizDay = (at: string | undefined) => !at ? '' : /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : platformBusinessDate(at);

export function teamWeekRow(state: MistState, member: { id: string; name: string }, weekStart: string, today: string, former = false): TeamWeekRow {
  const weekEnd = addBusinessDays(weekStart, 6), inWeek = (at: string | undefined) => { const d = bizDay(at); return !!d && d >= weekStart && d <= weekEnd; };
  const id = member.id, owned = state.orders.filter(o => o.ownerId === id), ownedIds = new Set(owned.map(o => o.id));
  const fresh = owned.filter(o => inWeek(o.createdAt) && !isOrderTerminated(o));
  const shipments = (state.fulfillment?.shipments || []).filter(s => s.state === 'departed' && inWeek(s.departedAt) && s.lines.some(l => ownedIds.has(l.orderId)));
  const ownedCustomerIds = new Set(state.customers.filter(c => c.ownerId === id).map(c => c.id));
  const invoices = new Map(state.invoices.filter(i => ownedIds.has(i.orderId) || !!i.opening && !!i.customerId && ownedCustomerIds.has(i.customerId)).map(i => [i.id, i]));
  const collected = state.allocations.filter(a => invoices.has(a.invoiceId)).map(a => ({ a, date: state.receipts.find(r => r.id === a.receiptId)?.date || a.createdAt })).filter(x => inWeek(x.date)).map(x => ({ currency: x.a.currency, amount: x.a.amount }));
  const customers = new Set(state.customers.filter(c => c.ownerId === id).map(c => c.id));
  const opps = (state.crm?.opportunities || []).filter(o => o.ownerId === id);
  const tasks = (state.tasks as TeamTask[]).filter(t => (t.assigneeIds || []).includes(id));
  const snapshot = teamRow(state, member, today, { former });
  return {
    id, name: member.name, former,
    newOrders: fresh.length, newOrderAmount: sumBy(fresh.map(o => ({ currency: o.currency, amount: o.amount }))),
    shipments: shipments.length, shippedQty: shipments.reduce((n, s) => n + s.lines.filter(l => ownedIds.has(l.orderId)).reduce((m, l) => m + (Number(l.quantity) || 0), 0), 0),
    collected: sumBy(collected), newDevs: (state.devs || []).filter(d => d.ownerId === id && inWeek(d.createdAt)).length,
    followUps: (state.crm?.followUps || []).filter(f => customers.has(f.customerId) && inWeek(f.at)).length,
    won: opps.filter(o => o.history?.some(h => h.to === 'won' && inWeek(h.at))).length, lost: opps.filter(o => o.history?.some(h => h.to === 'lost' && inWeek(h.at))).length,
    tasksDone: tasks.filter(t => t.done && inWeek(t.doneAt)).length,
    nudgesIn: tasks.filter(t => t.nudge && inWeek(t.nudge.at)).length, nudgesDone: tasks.filter(t => t.nudge && t.done && inWeek(t.doneAt)).length,
    nudgesOpenLate: tasks.filter(t => t.nudge && !t.done && t.due && t.due < today).length,
    lateOrders: snapshot.orders.filter(o => o.status === 'overdue').length, overdueReceivable: snapshot.overdueReceivable,
  };
}

/** 团队周报：范围与团队一览一致；本周未结束时统计到今天。 */
export function teamWeeklyReport(state: MistState, directory: TeamMember[], viewer: { id: string; owner: boolean }, weekStart: string, today: string, group: MistBusinessGroup | 'all' = 'all'): TeamWeekReport {
  const people = teamOverview(state, directory, viewer, today, group).map(r => ({ id: r.id, name: r.name, former: r.former }));
  const rows = people.map(p => teamWeekRow(state, p, weekStart, today, p.former));
  const n = (k: keyof TeamWeekRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const m = (k: 'newOrderAmount' | 'collected' | 'overdueReceivable') => sumBy(rows.flatMap(r => r[k]));
  const weekEnd = addBusinessDays(weekStart, 6);
  return {
    weekStart, weekEnd, asOf: weekEnd < today ? weekEnd : today, rows,
    totals: { newOrders: n('newOrders'), newOrderAmount: m('newOrderAmount'), shipments: n('shipments'), shippedQty: n('shippedQty'), collected: m('collected'), newDevs: n('newDevs'), followUps: n('followUps'), won: n('won'), lost: n('lost'), tasksDone: n('tasksDone'), nudgesIn: n('nudgesIn'), nudgesDone: n('nudgesDone'), nudgesOpenLate: n('nudgesOpenLate'), lateOrders: n('lateOrders'), overdueReceivable: m('overdueReceivable') },
  };
}

const moneyText = (rows: TeamMoney) => rows.length ? rows.map(r => `${r.currency} ${r.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' / ') : '0';
/** 周报文字版：可复制到邮件或聊天，由主管自行发送。 */
export function teamWeeklyText(report: TeamWeekReport, title = '团队周报') {
  const t = report.totals;
  const lines = [
    `${title}（${report.weekStart} 至 ${report.weekEnd}${report.asOf < report.weekEnd ? `，统计到 ${report.asOf}` : ''}）`,
    `本周：新接订单 ${t.newOrders} 单（${moneyText(t.newOrderAmount)}）；出运 ${t.shipments} 票 ${t.shippedQty} 件/米；回款 ${moneyText(t.collected)}；新开发案 ${t.newDevs} 个；客户跟进 ${t.followUps} 次；商机赢单 ${t.won}、流失 ${t.lost}；完成待办 ${t.tasksDone} 条；督办 ${t.nudgesIn} 条、完成 ${t.nudgesDone} 条。`,
    `当前：过交期订单 ${t.lateOrders} 单；逾期应收 ${moneyText(t.overdueReceivable)}；逾期未完成督办 ${t.nudgesOpenLate} 条。`,
    '',
    ...report.rows.map(r => `· ${r.name}${r.former ? '（已不在本公司）' : ''}：新单 ${r.newOrders}（${moneyText(r.newOrderAmount)}），出运 ${r.shipments} 票，回款 ${moneyText(r.collected)}，跟进 ${r.followUps} 次，完成待办 ${r.tasksDone}；当前过交期 ${r.lateOrders} 单、逾期应收 ${moneyText(r.overdueReceivable)}${r.nudgesOpenLate ? `、逾期督办 ${r.nudgesOpenLate} 条` : ''}。`),
  ];
  return lines.join('\n');
}

/* ---------------- 周报存档：每周一起提醒主管生成上周周报，服务端按此刻数据冻结一份 ---------------- */
export type TeamWeeklyArchive = { id: string; weekStart: string; weekEnd: string; generatedAt: string; generatedById: string; generatedBy: string; scope: string; report: TeamWeekReport; text: string };
export const teamReports = (root: MistState) => (root as MistState & { teamReports?: TeamWeeklyArchive[] }).teamReports || [];
export const myTeamReport = (root: MistState, viewerId: string, weekStart: string) => teamReports(root).find(r => r.generatedById === viewerId && r.weekStart === weekStart);
/** 已结束、尚未由本人存档的最近一周（每周一起出现在“我的工作”）。 */
export function pendingWeeklyArchive(root: MistState, viewerId: string, today: string): string | null {
  const last = addBusinessDays(weekStartOf(today), -7);
  return viewerId && !myTeamReport(root, viewerId, last) ? last : null;
}
function archiveWeekly(root: MistState, p: { weekStart?: unknown }, c: MistContext): { id: string } {
  const weekStart = typeof p?.weekStart === 'string' ? p.weekStart : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || weekStartOf(weekStart) !== weekStart) fail('周报须从周一开始');
  const today = platformBusinessDate(c.now), weekEnd = addBusinessDays(weekStart, 6);
  if (weekEnd >= today) fail('这一周还没结束，结束后才能存档');
  if (!c.actorId) fail('无法确认生成人', 'PRECONDITION');
  if (!c.members) fail('无法核对团队成员，请刷新后重试', 'PRECONDITION');
  const old = myTeamReport(root, c.actorId!, weekStart);
  if (old) fail(`${weekStart} 这周的周报已于 ${old.generatedAt.slice(0, 10)} 存档`, 'CONFLICT');
  const directory = c.members!.filter(m => m.active).map(m => ({ id: m.id, name: m.name, groups: m.groups, owner: m.owner }));
  const me = c.members!.find(m => m.id === c.actorId);
  const viewer = { id: c.actorId!, owner: !!me?.owner };
  const report = teamWeeklyReport(root, directory, viewer, weekStart, today);
  const scope = viewer.owner || !me?.groups.length ? '全部成员' : `${me.groups.map(g => g === 'garment' ? '成衣' : '面料').join('、')}业务组`;
  const id = c.id();
  const row: TeamWeeklyArchive = { id, weekStart, weekEnd, generatedAt: c.now, generatedById: c.actorId!, generatedBy: c.actorName, scope, report, text: teamWeeklyText(report, `团队周报 · ${scope}`) };
  const all = root as MistState & { teamReports?: TeamWeeklyArchive[] };
  all.teamReports = [...teamReports(root), row].slice(-520);
  return { id };
}
