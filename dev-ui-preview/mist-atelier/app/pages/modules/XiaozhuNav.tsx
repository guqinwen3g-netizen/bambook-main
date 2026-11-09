/** 小竹页左栏：新对话、待我确认 / 任务 / 自动规则 / 草稿入口，以及按日期分组的历史对话。版式与智能邮箱左栏一致。 */
import React from 'react';
import { FileText, ListChecks, ShieldCheck, SquarePen, Zap } from 'lucide-react';
import { Button, Icon, Pill, type Tone } from '../../../../../components/mist';
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
export function XiaozhuNav({ conversations, activeId, onSelect, onNew, confirmCount, runningCount, ruleCount, draftCount, onOpenConfirm, onOpenTasks, onOpenRules, onOpenDrafts, now = new Date() }: {
  conversations: XiaozhuConversation[]; activeId: string; onSelect: (id: string) => void; onNew: () => void;
  confirmCount: number; runningCount: number; ruleCount: number; draftCount: number;
  onOpenConfirm: () => void; onOpenTasks: () => void; onOpenRules: () => void; onOpenDrafts: () => void; now?: Date;
}) {
  const entries: Entry[] = [
    { key: 'confirm', icon: ShieldCheck, label: '待我确认', count: confirmCount, tone: 'warn', onClick: onOpenConfirm },
    { key: 'tasks', icon: ListChecks, label: '任务', count: runningCount, onClick: onOpenTasks },
    { key: 'rules', icon: Zap, label: '自动规则', count: ruleCount, onClick: onOpenRules },
    { key: 'drafts', icon: FileText, label: '草稿', count: draftCount, onClick: onOpenDrafts },
  ];
  const groups: Array<[string, XiaozhuConversation[]]> = [];
  for (const c of conversations) { const b = bucket(c.lastAt, now), last = groups.at(-1); if (last?.[0] === b) last[1].push(c); else groups.push([b, [c]]); }
  return <nav className="mist-xz-nav" aria-label={uiText('小竹')}>
    <Button variant="primary" icon={SquarePen} className="mist-xz-new" onClick={onNew}>{uiText('新对话')}</Button>
    <div className="mist-xz-navgroup">{entries.map(e => <button key={e.key} type="button" className="mist-xz-navitem" onClick={e.onClick}><Icon icon={e.icon} size="sm" /><span>{uiText(e.label)}</span>{e.count > 0 && <b data-tone={e.tone}>{e.count}</b>}</button>)}</div>
    <div className="mist-xz-history">
      {groups.map(([label, list]) => <div key={label} className="mist-xz-navgroup"><span className="mist-xz-navlabel">{uiText(label)}</span>
        {list.map(c => <button key={c.id} type="button" className="mist-xz-navitem" data-active={c.id === activeId || undefined} aria-current={c.id === activeId || undefined} title={c.title} onClick={() => onSelect(c.id)}><span className="mist-xz-navtitle">{c.title}</span>{c.active && <i className="mist-xz-navdot" aria-label={uiText('办理中')} />}</button>)}
      </div>)}
    </div>
  </nav>;
}

/** 「待我确认」抽屉：小竹（含自动规则）留下的待确认事项。 */
export function XiaozhuProposalList({ proposals, onOpen }: { proposals: AgentProposal[]; onOpen: (id: string) => void }) {
  if (!proposals.length) return <p className="mist-xz-quiet">{uiText('没有待确认事项')}</p>;
  return <div className="mist-xz-list">{proposals.map(p => { const risk = agentCommandRisk(p.command.type); return <button type="button" key={p.id} className="mist-xz-item" onClick={() => onOpen(p.id)}><span className="mist-xz-item-t">{p.summary[0] ?? p.command.type}</span><Pill tone={RISK_TONE[risk]}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></button>; })}</div>;
}
