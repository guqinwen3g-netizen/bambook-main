import React from 'react';
import { ui, uiText, interfaceLocale } from '../../../../services/interfaceLanguage';
import { Button, Drawer, EmptyState, Icon, Segmented } from '../../../../components/mist';
import { ArrowRight, X } from 'lucide-react';
import type { MistNotification, MistTarget } from '../../../../server/src/shared/mistWorkspace';
import type { MistDigestItem } from './notificationPreferences';

/** Times are shown in the company's business time zone, the same zone the server uses for business dates. */
const BUSINESS_TZ = 'Asia/Shanghai';
const dayKey = (iso: string) => { const at = new Date(iso); return Number.isFinite(at.getTime()) ? at.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ }) : ''; };
export function noticeWhen(iso: string, today = dayKey(new Date().toISOString())) {
  const at = new Date(iso); if (!Number.isFinite(at.getTime())) return '';
  const time = at.toLocaleTimeString(interfaceLocale(), { timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  if (dayKey(iso) === today) return time;
  return at.toLocaleDateString(interfaceLocale(), { timeZone: BUSINESS_TZ, month: 'numeric', day: 'numeric' }) + ' ' + time;
}

type Filter = 'unread' | 'all';
type Props = {
  open: boolean; onClose: () => void; items: MistNotification[]; digest: MistDigestItem[]; digestEnabled: boolean;
  busy?: boolean; error?: React.ReactNode;
  onOpenItem: (n: MistNotification) => void; onOpenDigest: (target: MistTarget) => void; onReadAll: () => void; onViewAll: () => void;
};

/** One compact row per notice: unread dot, title, "who · when". The whole row opens the record and marks it read. */
function NoticeRow({ n, today, onOpen, busy }: { n: MistNotification; today: string; onOpen: () => void; busy?: boolean }) {
  return <button type="button" className="mist-notice-row" data-unread={!n.readAt || undefined} disabled={busy} onClick={onOpen}>
    <span className="mist-notice-dot" aria-hidden="true" />
    <span className="mist-notice-main"><span className="mist-notice-title">{uiText(n.title)}</span><span className="mist-notice-meta">{[n.detail, noticeWhen(n.at, today)].filter(Boolean).join(' · ')}</span></span>
    <span className="mist-go"><Icon icon={ArrowRight} size="sm" /></span>
  </button>;
}

export function NotificationCenter({ open, onClose, items, digest, digestEnabled, busy, error, onOpenItem, onOpenDigest, onReadAll, onViewAll }: Props) {
  const unread = items.filter(n => !n.readAt).length;
  const [filter, setFilter] = React.useState<Filter>('unread');
  React.useEffect(() => { if (open) setFilter(unread ? 'unread' : 'all'); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dayKey(new Date().toISOString());
  const shown = filter === 'unread' ? items.filter(n => !n.readAt) : items;
  const groups = [{ id: 'today', label: '今天', rows: shown.filter(n => dayKey(n.at) === today) }, { id: 'earlier', label: '更早', rows: shown.filter(n => dayKey(n.at) !== today) }].filter(g => g.rows.length);
  return <Drawer open={open} onClose={onClose} title={uiText('通知')}
    footer={<><Button variant="quiet" onClick={onViewAll}>{uiText('查看全部通知')}</Button><Button disabled={!unread} loading={busy} onClick={onReadAll}>{uiText('全部标为已读')}</Button></>}>
    <div className="mist-notice-center">
      {error}
      <Segmented<Filter> ariaLabel={uiText('通知范围')} value={filter} onChange={setFilter} options={[{ value: 'unread', label: unread ? ui`未读 ${unread}` : uiText('未读') }, { value: 'all', label: uiText('全部') }]} />
      {digestEnabled && digest.length > 0 && <section className="mist-notice-group" aria-label={uiText('今日待办')}>
        <h3 className="mist-notice-group-h">{uiText('今日待办')}</h3>
        {digest.map(item => <button key={item.id} type="button" className="mist-notice-row" onClick={() => onOpenDigest(item.target)}>
          <span className="mist-notice-dot" data-kind="todo" aria-hidden="true" />
          <span className="mist-notice-main"><span className="mist-notice-title">{uiText(item.label)}</span><span className="mist-notice-meta">{uiText(item.detail)}</span></span>
          <span className="mist-go"><Icon icon={ArrowRight} size="sm" /></span>
        </button>)}
      </section>}
      {groups.length ? groups.map(g => <section key={g.id} className="mist-notice-group" aria-label={uiText(g.label)}>
        <h3 className="mist-notice-group-h">{uiText(g.label)}</h3>
        {g.rows.map(n => <NoticeRow key={n.id} n={n} today={today} busy={busy} onOpen={() => onOpenItem(n)} />)}
      </section>) : <EmptyState title={uiText(filter === 'unread' ? '没有未读通知' : '暂无通知')} />}
    </div>
  </Drawer>;
}

/** A new notice arriving: one small card at the top right, the same surface as shell status. Several at once merge into one. */
export function NotificationToast({ items, onOpen, onOpenAll, onDismiss }: { items: MistNotification[]; onOpen: (n: MistNotification) => void; onOpenAll: () => void; onDismiss: () => void }) {
  if (!items.length) return null;
  const single = items.length === 1 ? items[0] : null;
  return <div className="mist-shell-notice mist-notice-toast" role="status" aria-live="polite">
    <button type="button" className="mist-notice-row" data-unread onClick={() => single ? onOpen(single) : onOpenAll()}>
      <span className="mist-notice-dot" aria-hidden="true" />
      <span className="mist-notice-main"><span className="mist-notice-title">{single ? uiText(single.title) : ui`${items.length} 条新通知`}</span><span className="mist-notice-meta">{single ? [single.detail, noticeWhen(single.at)].filter(Boolean).join(' · ') : uiText(items.slice(0, 2).map(n => n.title).join('；'))}</span></span>
    </button>
    <button type="button" className="mist-icon-btn mist-notice-toast-x" data-size="sm" aria-label={uiText('关闭')} title={uiText('关闭')} onClick={onDismiss}><Icon icon={X} size="sm" /></button>
  </div>;
}
