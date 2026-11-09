/** 小竹页左栏：新对话、待我确认 / 任务 / 自动规则 / 草稿入口，以及按日期分组的历史对话。版式与智能邮箱左栏一致。 */
import React from 'react';
import { FileText, ListChecks, MoreHorizontal, PenLine, Search, ShieldCheck, SquarePen, Trash2, Zap } from 'lucide-react';
import { ActionMenu, Button, Icon, Pill, type Tone } from '../../../../../components/mist';
import { agentCommandRisk, AGENT_RISK_LABEL, type AgentProposal } from '../../../../../server/src/shared/mistAgentProposals';
import { uiText } from '../../../../../services/interfaceLanguage';
import { mistApiRequest } from '../../runtime/workspace';
import type { XiaozhuConversation } from '../../runtime/xiaozhuCowork';

export type AutomationRule = { id: string; name: string; trigger: 'new_mail' | 'new_receipt' | 'due_soon' | 'daily'; time: string; instructions: string; enabled: boolean; version: number; runs: Array<{ at: string; taskId: string; detail: string }>; halted?: { message: string } };
export const TRIGGER_LABEL: Record<AutomationRule['trigger'], string> = { new_mail: '收到新邮件', new_receipt: '收到新到账', due_soon: '订单交期临近', daily: '每天定时' };
const RISK_TONE: Record<string, Tone> = { low: 'neutral', medium: 'warn', high: 'bad' };

export function useAutomationRules(workspaceId: string | undefined, enabled: boolean, reloadKey: unknown) {
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) + '/agent-automations' : '';
  const [rules, setRules] = React.useState<AutomationRule[]>([]);
  const load = React.useCallback(async () => { if (!base || !enabled) return; try { setRules(((await mistApiRequest(base)) as { items: AutomationRule[] }).items); } catch { /* 规则读不到时只少一个计数，不影响对话 */ } }, [base, enabled]);
  React.useEffect(() => { setRules([]); void load(); const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 15_000); return () => clearInterval(timer); }, [load, reloadKey]);
  return { rules, reload: load };
}

const DAY = 86_400_000;
function bucket(at: string, now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), t = Date.parse(at);
  return t >= start ? '今天' : t >= start - DAY ? '昨天' : t >= start - 6 * DAY ? '近 7 天' : '更早';
}

type Entry = { key: string; icon: typeof ShieldCheck; label: string; count: number; tone?: 'warn'; onClick: () => void };
export type ConversationActions = { onRename: (id: string, title: string) => void; onRemove: (id: string) => void };

/** 就地改名：回车保存，Esc 或失焦取消；空标题恢复默认。 */
export function TitleEditor({ initial, onDone, className }: { initial: string; onDone: (title: string | null) => void; className?: string }) {
  const [value, setValue] = React.useState(initial), done = React.useRef(false);
  const finish = (title: string | null) => { if (done.current) return; done.current = true; onDone(title); };
  return <input className={'mist-xz-rename' + (className ? ' ' + className : '')} aria-label={uiText('对话标题')} autoFocus value={value} maxLength={60}
    onFocus={e => e.currentTarget.select()} onChange={e => setValue(e.target.value)} onBlur={() => finish(value.trim() && value.trim() !== initial ? value.trim() : null)}
    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); finish(value.trim() && value.trim() !== initial ? value.trim() : null); } else if (e.key === 'Escape') { e.preventDefault(); finish(null); } }} />;
}

export function XiaozhuNav({ conversations, activeId, onSelect, onNew, confirmCount, runningCount, ruleCount, draftCount, onOpenConfirm, onOpenTasks, onOpenRules, onOpenDrafts, unread = new Set(), renaming, setRenaming, onRename, onRemove, hasMore, onLoadMore, now = new Date() }: {
  conversations: XiaozhuConversation[]; activeId: string; onSelect: (id: string) => void; onNew: () => void;
  confirmCount: number; runningCount: number; ruleCount: number; draftCount: number;
  onOpenConfirm: () => void; onOpenTasks: () => void; onOpenRules: () => void; onOpenDrafts: () => void;
  unread?: Set<string>; renaming?: string; setRenaming?: (id: string | undefined) => void; hasMore?: boolean; onLoadMore?: () => void; now?: Date;
} & Partial<ConversationActions>) {
  const [query, setQuery] = React.useState('');
  const entries: Entry[] = [
    { key: 'confirm', icon: ShieldCheck, label: '待我确认', count: confirmCount, tone: 'warn', onClick: onOpenConfirm },
    { key: 'tasks', icon: ListChecks, label: '任务', count: runningCount, onClick: onOpenTasks },
    { key: 'rules', icon: Zap, label: '自动规则', count: ruleCount, onClick: onOpenRules },
    { key: 'drafts', icon: FileText, label: '草稿', count: draftCount, onClick: onOpenDrafts },
  ];
  const q = query.trim().toLowerCase();
  const shown = q ? conversations.filter(c => (c.title + ' ' + c.tasks.map(t => t.instructions + ' ' + (t.result ?? '')).join(' ')).toLowerCase().includes(q)) : conversations;
  const groups: Array<[string, XiaozhuConversation[]]> = [];
  for (const c of shown) { const b = bucket(c.lastAt, now), last = groups.at(-1); if (last?.[0] === b) last[1].push(c); else groups.push([b, [c]]); }
  return <nav className="mist-xz-nav" aria-label={uiText('小竹')}>
    <Button variant="quiet" icon={SquarePen} className="mist-xz-new" onClick={onNew}>{uiText('新对话')}</Button>
    <div className="mist-xz-navgroup">{entries.map(e => <button key={e.key} type="button" className="mist-xz-navitem" onClick={e.onClick}><Icon icon={e.icon} size="sm" /><span>{uiText(e.label)}</span>{e.count > 0 && <b data-tone={e.tone}>{e.count}</b>}</button>)}</div>
    {(conversations.length > 6 || q) && <label className="mist-xz-search"><Icon icon={Search} size="sm" /><input type="search" aria-label={uiText('搜索对话')} placeholder={uiText('搜索对话')} value={query} onChange={e => setQuery(e.target.value)} /></label>}
    <div className="mist-xz-history">
      {q && !shown.length && <p className="mist-xz-quiet mist-xz-navempty">{uiText('没有匹配的对话')}</p>}
      {groups.map(([label, list]) => <div key={label} className="mist-xz-navgroup"><span className="mist-xz-navlabel">{uiText(label)}</span>
        {list.map(c => renaming === c.id && onRename ? <TitleEditor key={c.id} initial={c.title} onDone={title => { setRenaming?.(undefined); if (title) onRename(c.id, title); }} />
          : <div key={c.id} className="mist-xz-conv" data-active={c.id === activeId || undefined} data-unread={unread.has(c.id) || undefined}>
            <button type="button" className="mist-xz-navitem" aria-current={c.id === activeId || undefined} title={c.title} onClick={() => onSelect(c.id)}><span className="mist-xz-navtitle">{c.title}</span>{c.active ? <i className="mist-xz-navdot" aria-label={uiText('办理中')} /> : unread.has(c.id) && <i className="mist-xz-navdot" data-kind="unread" aria-label={uiText('有新回复')} />}</button>
            {onRename && onRemove && <ActionMenu className="mist-xz-conv-menu" icon={MoreHorizontal} label={uiText('对话操作')} items={[{ label: '重命名', icon: PenLine, onSelect: () => setRenaming?.(c.id) }, { label: '从列表移除', icon: Trash2, tone: 'bad', onSelect: () => onRemove(c.id) }]} />}
          </div>)}
      </div>)}
      {hasMore && onLoadMore && !q && <Button size="sm" variant="quiet" className="mist-xz-more" onClick={onLoadMore}>{uiText('加载更早的对话')}</Button>}
    </div>
  </nav>;
}

/** 「待我确认」抽屉：小竹（含自动规则）留下的待确认事项。 */
export function XiaozhuProposalList({ proposals, onOpen }: { proposals: AgentProposal[]; onOpen: (id: string) => void }) {
  if (!proposals.length) return <p className="mist-xz-quiet">{uiText('没有待确认事项')}</p>;
  return <div className="mist-xz-list">{proposals.map(p => { const risk = agentCommandRisk(p.command.type); return <button type="button" key={p.id} className="mist-xz-item" onClick={() => onOpen(p.id)}><span className="mist-xz-item-t">{p.summary[0] ?? p.command.type}</span><Pill tone={RISK_TONE[risk]}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></button>; })}</div>;
}
