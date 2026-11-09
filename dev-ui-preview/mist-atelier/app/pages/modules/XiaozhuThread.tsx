/** 小竹对话：请求、办理过程、结果、追问和待确认事项都在同一条对话里，不用离开页面。 */
import React from 'react';
import { ChevronRight, Copy, FileText, RotateCcw, Zap, ShieldCheck } from 'lucide-react';
import { Button, Pill, TextInput, type Tone } from '../../../../../components/mist';
import type { AgentTaskTrailItem, AgentTaskView } from '../../../../../server/src/shared/mistAgentTasks';
import { agentCommandRisk, AGENT_RISK_LABEL, type AgentProposal } from '../../../../../server/src/shared/mistAgentProposals';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { COWORK_ACTIVE, splitRequest } from '../../runtime/xiaozhuCowork';
import type { RecordRef } from '../../runtime/xiaozhuRecords';
import { XiaozhuMarkdown } from './XiaozhuMarkdown';

const STATE: Record<AgentTaskView['state'], [string, Tone]> = { queued: ['待执行', 'accent'], running: ['办理中', 'accent'], waiting_time: ['等待继续', 'neutral'], waiting_condition: ['等待资料变化', 'neutral'], waiting_human: ['待我确认', 'warn'], paused: ['已暂停', 'neutral'], succeeded: ['已完成', 'ok'], failed: ['未完成', 'bad'], cancelled: ['已停止', 'neutral'], expired: ['已到期', 'neutral'], budget_exhausted: ['达到限额', 'warn'], access_changed: ['权限已变化', 'warn'] };
const RISK_TONE: Record<string, Tone> = { low: 'neutral', medium: 'warn', high: 'bad' };
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso), key = dayKey(iso), today = dayKey(now.toISOString()), yesterday = dayKey(new Date(now.getTime() - 86400_000).toISOString());
  return key === today ? uiText('今天') : key === yesterday ? uiText('昨天') : d.toLocaleDateString(interfaceLocale(), { month: 'long', day: 'numeric' });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(interfaceLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });

function Trail({ items, active, onOpen }: { items: AgentTaskTrailItem[]; active: boolean; onOpen: (view: string, id: string) => void }) {
  const [open, setOpen] = React.useState(false), shown = open || active;
  const reads = items.filter(i => i.kind === 'read').length, writes = items.filter(i => i.kind === 'write').length, last = items.at(-1);
  const summary = active && last ? last.label : [reads ? `查阅 ${reads} 项` : '', writes ? `${writes} 步写入` : ''].filter(Boolean).join(' · ') || `${items.length} 步`;
  return <div className="mist-xz-trail" data-open={shown || undefined}>
    <button type="button" className="mist-xz-trail-h" aria-expanded={shown} disabled={active} onClick={() => setOpen(v => !v)}><ChevronRight size={13} />{uiText(summary)}</button>
    {shown && <ol className="mist-xz-trail-l">{items.map((i, n) => <li key={n} data-failed={i.failed || undefined}>{i.ref ? <button type="button" className="mist-xz-ref" onClick={() => onOpen(viewOf(i.ref!.type), i.ref!.id)}>{i.label}</button> : <span>{i.label}</span>}</li>)}</ol>}
  </div>;
}
// 小竹读到的对象类型对应的页面；未列出的类型不提供跳转。
const VIEW: Record<string, string> = { order: 'orders/detail', customer: 'crm', development: 'development/detail', purchase: 'procurement', shipment: 'shipments', invoice: 'invoices', quotation: 'quotations', supplier: 'suppliers', email: 'emails', production: 'production-board', risk: 'risks', claim: 'claims' };
const viewOf = (type: string) => VIEW[type] ?? '';

function Question({ task, onAnswer }: { task: AgentTaskView; onAnswer: (task: AgentTaskView, id: string, text: string) => void }) {
  const [text, setText] = React.useState('');
  const open = (task.questions ?? []).find(q => !q.answeredAt);
  if (!open || !task.canControl) return null;
  const send = () => { if (text.trim()) { onAnswer(task, open.id, text); setText(''); } };
  return <div className="mist-xz-ask"><p className="mist-chat-text">{open.question}</p>
    <div className="mist-row"><TextInput aria-label={uiText('回答小竹')} value={text} maxLength={2000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <Button size="sm" variant="primary" disabled={!text.trim()} onClick={send}>{uiText('回答')}</Button></div></div>;
}

function ProposalCard({ proposal, onOpen }: { proposal: AgentProposal; onOpen: (id: string) => void }) {
  const risk = agentCommandRisk(proposal.command.type);
  return <div className="mist-xz-proposal"><div className="mist-row"><ShieldCheck size={15} /><b>{uiText('需要你确认')}</b><Pill tone={RISK_TONE[risk]}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></div>
    <ul>{proposal.summary.slice(0, 4).map((line, i) => <li key={i}>{line}</li>)}</ul>
    <div className="mist-row"><Button size="sm" variant="ai" onClick={() => onOpen(proposal.id)}>{uiText('查看并确认')}</Button></div></div>;
}

export type ThreadActions = { onAnswer: (task: AgentTaskView, id: string, text: string) => void; onCancel: (task: AgentTaskView) => void; onRetry: (text: string) => void; onCopy: (text: string) => void; onDraft: (text: string) => void; onAutomate: (text: string) => void; onOpenRecord: (view: string, id: string) => void; onProposal: (id: string) => void };

export function XiaozhuThread({ tasks, index, proposals, ...actions }: { tasks: AgentTaskView[]; index: RecordRef[]; proposals: AgentProposal[] } & ThreadActions) {
  let lastDay = '';
  return <div className="mist-msgs mist-xz-thread">{tasks.map(t => {
    const day = dayKey(t.createdAt), divider = day !== lastDay; lastDay = day;
    const active = COWORK_ACTIVE.includes(t.state), asking = t.state === 'waiting_human' && (t.questions ?? []).some(q => !q.answeredAt);
    const pending = t.waitingProposalIds.map(id => proposals.find(p => p.id === id && p.state === 'pending')).filter((p): p is AgentProposal => !!p);
    const request = splitRequest(t.instructions), done = !active && t.state !== 'waiting_human';
    return <React.Fragment key={t.id}>
      {divider && <div className="mist-xz-day">{dayLabel(t.createdAt)}</div>}
      <div className="mist-msg" data-role="user" title={clock(t.createdAt)}>{request}</div>
      <div className="mist-msg" data-role="assistant" data-task-state={t.state}>
        <div className="mist-msg-bubble">
          {!!t.trail?.length && <Trail items={t.trail} active={active && !asking && !pending.length} onOpen={actions.onOpenRecord} />}
          {t.result ? <XiaozhuMarkdown text={t.result} index={index} onOpen={actions.onOpenRecord} /> : active && !asking && !pending.length && !t.trail?.length ? <div className="mist-typing" aria-label={uiText('小竹正在办理')}><i /><i /><i /></div> : null}
          {active && t.checkpoint && !t.result && <p className="mist-note">{t.checkpoint}</p>}
          {asking && <Question task={t} onAnswer={actions.onAnswer} />}
          {pending.map(p => <ProposalCard key={p.id} proposal={p} onOpen={actions.onProposal} />)}
          {!active && t.state !== 'succeeded' && t.state !== 'waiting_human' && <Pill tone={STATE[t.state][1]}>{uiText(STATE[t.state][0])}</Pill>}
          {!active && t.state !== 'succeeded' && !t.result && t.checkpoint && <p className="mist-note">{t.checkpoint}</p>}
        </div>
        <div className="mist-msg-acts">
          {active && t.canControl && <Button size="sm" variant="quiet" onClick={() => actions.onCancel(t)}>{uiText('停止')}</Button>}
          {done && t.result && <>
            <Button size="sm" variant="quiet" icon={Copy} onClick={() => actions.onCopy(t.result)}>{uiText('复制')}</Button>
            <Button size="sm" variant="quiet" icon={FileText} onClick={() => actions.onDraft(t.result)}>{uiText('保存草稿')}</Button>
          </>}
          {done && <Button size="sm" variant="quiet" icon={RotateCcw} onClick={() => actions.onRetry(request)}>{uiText('重新提问')}</Button>}
          {done && t.state === 'succeeded' && <Button size="sm" variant="quiet" icon={Zap} onClick={() => actions.onAutomate(request)}>{uiText('设为自动规则')}</Button>}
          <span className="mist-xz-time">{clock(t.updatedAt || t.createdAt)}</span>
        </div>
      </div>
    </React.Fragment>;
  })}</div>;
}
