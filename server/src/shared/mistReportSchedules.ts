/**
 * fin63 报表定时发送（2026-11-04）。
 * 本人订阅某张报表（客户销售额、应收账龄、订单进度、资金月报、订单毛利）按每周 / 每月发给指定收件人。
 * 到期时生成本人待办；本人从待办打开报表，一键生成 Excel 附件并带入智能邮箱草稿，确认后发送。
 * 对外发信始终由本人确认（不做无人自动外发）；发出后在订阅上登记本期已发。
 */
import { MistCommandError, type MistContext, type MistState } from './mistWorkspace';
import { platformBusinessDate } from './mistPlatform';

export const REPORT_SCHEDULE_KINDS = { sales: '客户销售额', aging: '应收账龄', orders: '订单进度', cash: '资金月报', margin: '订单毛利' } as const;
export type ReportScheduleKind = keyof typeof REPORT_SCHEDULE_KINDS;
/** 资金月报与订单毛利含成本与资金，只给报表管理者。 */
export const REPORT_SCHEDULE_ADMIN_KINDS: readonly ReportScheduleKind[] = ['cash', 'margin'];
export type MistReportSchedule = {
  id: string; ownerId: string; owner: string; kind: ReportScheduleKind; every: 'week' | 'month';
  /** 每周：1–7（周一到周日）；每月：1–28 号。 */
  day: number; to: string; note: string; active: boolean; createdAt: string;
  lastPeriod?: string; lastSentAt?: string;
};
export type ReportScheduleCommand =
  | { type: 'report.schedule.save'; payload: { id?: string; kind: ReportScheduleKind; every: 'week' | 'month'; day: number; to: string; note?: string } }
  | { type: 'report.schedule.stop'; payload: { id: string } }
  | { type: 'report.schedule.sent'; payload: { id: string; period: string } };
type Root = MistState & { reportSchedules?: MistReportSchedule[] };

const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message); };
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekday = (day: string) => { const w = new Date(day + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };

export const readReportSchedules = (root: Pick<Root, 'reportSchedules'>) => root.reportSchedules || [];
export function reportSchedulePermission(command: ReportScheduleCommand, kind?: ReportScheduleKind): string {
  const k = kind ?? (command.type === 'report.schedule.save' ? command.payload?.kind : undefined);
  return k && REPORT_SCHEDULE_ADMIN_KINDS.includes(k) ? 'reports:admin' : 'reports:read';
}
/** 本期编号与到期日：每周按订阅的星期几，每月按订阅的日期；到期日不晚于今天时为“本期待发”。 */
export function reportSchedulePeriod(s: Pick<MistReportSchedule, 'every' | 'day'>, today: string): { period: string; due: string } {
  if (s.every === 'week') { const due = addDays(today, -((weekday(today) - s.day + 7) % 7)); return { period: due, due }; }
  const month = today.slice(0, 7), due = `${month}-${String(s.day).padStart(2, '0')}`;
  if (due <= today) return { period: month, due };
  const [y, m] = month.split('-').map(Number), prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  return { period: prev, due: `${prev}-${String(s.day).padStart(2, '0')}` };
}
/** 当前账号到期未发的订阅（供首页待办派生）。 */
export function dueReportSchedules(root: Root, me: string, today: string) {
  return readReportSchedules(root).filter(s => s.active && s.ownerId === me).flatMap(s => { const p = reportSchedulePeriod(s, today); return s.lastPeriod === p.period || p.due < s.createdAt.slice(0, 10) ? [] : [{ schedule: s, ...p }]; });
}
const recipients = (v: unknown) => {
  const list = String(v ?? '').split(/[,;，；\s]+/).map(x => x.trim()).filter(Boolean);
  if (!list.length) fail('请填写收件人邮箱');
  if (list.length > 20) fail('收件人最多 20 个');
  for (const x of list) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) fail(`邮箱格式无效：${x}`);
  return [...new Set(list)].join(', ');
};

export function applyReportScheduleCommand(root: Root, command: ReportScheduleCommand, c: MistContext): { id: string } {
  const list = root.reportSchedules ||= [], p = command.payload as Record<string, unknown>;
  const own = (id: unknown) => { const s = list.find(x => x.id === id) || fail('报表订阅不存在', 'NOT_FOUND'); if (s.ownerId !== c.actorId) fail('只能管理本人的报表订阅', 'FORBIDDEN'); return s; };
  if (!c.actorId) fail('无法确认当前账号', 'PRECONDITION');
  switch (command.type) {
    case 'report.schedule.save': {
      const kind = p.kind as ReportScheduleKind;
      if (!Object.prototype.hasOwnProperty.call(REPORT_SCHEDULE_KINDS, kind)) fail('报表类型无效');
      const every = p.every === 'month' ? 'month' : p.every === 'week' ? 'week' : fail('发送频率无效');
      const day = Number(p.day);
      if (!Number.isInteger(day) || day < 1 || day > (every === 'week' ? 7 : 28)) fail(every === 'week' ? '请选择星期一到星期日' : '每月日期须为 1–28 号');
      const note = String(p.note ?? '').trim().slice(0, 500);
      const old = p.id ? own(p.id) : undefined;
      if (!old && list.filter(x => x.ownerId === c.actorId && x.active).length >= 20) fail('本人有效订阅最多 20 个');
      const row: MistReportSchedule = { id: old?.id || c.id(), ownerId: c.actorId!, owner: c.actorName, kind, every, day, to: recipients(p.to), note, active: true, createdAt: old?.createdAt || c.now, ...(old?.lastPeriod ? { lastPeriod: old.lastPeriod } : {}), ...(old?.lastSentAt ? { lastSentAt: old.lastSentAt } : {}) };
      if (old) Object.assign(old, row); else list.push(row);
      root.events.unshift({ id: c.id(), entityType: 'reportSchedule', entityId: row.id, actor: c.actorName, at: c.now, text: `${old ? '修改' : '新建'}报表订阅：${REPORT_SCHEDULE_KINDS[kind]} · ${every === 'week' ? '每周' : '每月'} → ${row.to}`, fileIds: [] });
      return { id: row.id };
    }
    case 'report.schedule.stop': {
      const s = own(p.id); s.active = false;
      root.events.unshift({ id: c.id(), entityType: 'reportSchedule', entityId: s.id, actor: c.actorName, at: c.now, text: `停用报表订阅：${REPORT_SCHEDULE_KINDS[s.kind]}`, fileIds: [] });
      return { id: s.id };
    }
    case 'report.schedule.sent': {
      const s = own(p.id), expected = reportSchedulePeriod(s, platformBusinessDate(c.now)).period;
      if (p.period !== expected) fail('报表期次已变化，请刷新后重试', 'CONFLICT');
      s.lastPeriod = expected; s.lastSentAt = c.now;
      root.events.unshift({ id: c.id(), entityType: 'reportSchedule', entityId: s.id, actor: c.actorName, at: c.now, text: `报表已发出：${REPORT_SCHEDULE_KINDS[s.kind]}（${expected}）→ ${s.to}`, fileIds: [] });
      return { id: s.id };
    }
  }
  return fail('未知报表订阅操作');
}
