/** 小竹对话：请求、办理过程、结果、追问和待确认事项都在同一条对话里，不用离开页面。 */
import React from 'react';
import { ChevronRight, Copy, Download, FileText, RotateCcw, Zap, ShieldCheck, Search, PenLine, HelpCircle, Clock, Check, Square } from 'lucide-react';
import { AIBadge, AssistantEyes, Button, Icon, IconButton, Pill, type Tone } from '../../../../../components/mist';
import type { AgentTaskTrailItem, AgentTaskView } from '../../../../../server/src/shared/mistAgentTasks';
import { agentCommandRisk, AGENT_RISK_LABEL, type AgentProposal } from '../../../../../server/src/shared/mistAgentProposals';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { COWORK_ACTIVE, splitRequest } from '../../runtime/xiaozhuCowork';
import type { RecordRef } from '../../runtime/xiaozhuRecords';
import { commandRequiresSignature } from '../../runtime/signatureRules';
import { XiaozhuMarkdown } from './XiaozhuMarkdown';

const STATE: Record<AgentTaskView['state'], [string, Tone]> = { queued: ['待执行', 'accent'], running: ['办理中', 'accent'], waiting_time: ['等待继续', 'neutral'], waiting_condition: ['等待资料变化', 'neutral'], waiting_human: ['待我确认', 'warn'], paused: ['已暂停', 'neutral'], succeeded: ['已完成', 'ok'], failed: ['未完成', 'bad'], cancelled: ['已停止', 'neutral'], expired: ['已到期', 'neutral'], budget_exhausted: ['达到限额', 'warn'], access_changed: ['权限已变化', 'warn'] };
const RISK_TONE: Record<string, Tone> = { low: 'neutral', medium: 'warn', high: 'bad' };
const KIND_ICON = { read: Search, write: PenLine, ask: HelpCircle, wait: Clock, note: Check };
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai',});
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso), key = dayKey(iso), today = dayKey(now.toISOString()), yesterday = dayKey(new Date(now.getTime() - 86400_000).toISOString());
  return key === today ? uiText('今天') : key === yesterday ? uiText('昨天') : d.toLocaleDateString(interfaceLocale(), {timeZone:'Asia/Shanghai',  month: 'long', day: 'numeric' });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(interfaceLocale(), {timeZone:'Asia/Shanghai',  hour: '2-digit', minute: '2-digit', hour12: false });
// 旧记录没有服务端给出的页面时按类型兜底；新记录用 ref.view / section。
const VIEW: Record<string, string> = { order: 'orders/detail', customer: 'crm', development: 'development/detail', purchase: 'procurement', shipment: 'shipments', invoice: 'invoices', quotation: 'quotations', supplier: 'suppliers', email: 'emails', production: 'production-board', risk: 'risks', claim: 'claims' };

type OpenRecord = (view: string, id: string, section?: string) => void;
function Trail({ items, active, onOpen }: { items: AgentTaskTrailItem[]; active: boolean; onOpen: OpenRecord }) {
  const [open, setOpen] = React.useState(false);
  const reads = items.filter(i => i.kind === 'read').length, writes = items.filter(i => i.kind === 'write').length, last = items.at(-1);
  const summary = [reads ? `查阅 ${reads} 项` : '', writes ? `${writes} 步写入` : ''].filter(Boolean).join(' · ') || `${items.length} 步`;
  if (active) return <div className="mist-xz-trail"><span className="mist-xz-shimmer">{uiText(last?.label ?? '正在办理')}</span></div>;
  return <div className="mist-xz-trail" data-open={open || undefined}>
    <button type="button" className="mist-xz-trail-h" aria-expanded={open} onClick={() => setOpen(v => !v)}>{uiText(summary)}<ChevronRight size={13} /></button>
    {open && <ol className="mist-xz-steps">{items.map((i, n) => <li key={n} data-failed={i.failed || undefined}><Icon icon={KIND_ICON[i.kind]} size="xs" />{i.ref && (i.ref.view || VIEW[i.ref.type]) ? <button type="button" className="mist-xz-ref" onClick={() => onOpen(i.ref!.view ?? VIEW[i.ref!.type], i.ref!.id, i.ref!.section)}>{i.label}</button> : <span>{i.label}</span>}</li>)}</ol>}
  </div>;
}

function Question({ task, onAnswer }: { task: AgentTaskView; onAnswer: (task: AgentTaskView, id: string, text: string) => void }) {
  const [text, setText] = React.useState('');
  const open = (task.questions ?? []).find(q => !q.answeredAt);
  if (!open || !task.canControl) return null;
  const send = () => { if (text.trim()) { onAnswer(task, open.id, text); setText(''); } };
  return <div className="mist-xz-card" data-tone="ask"><div className="mist-xz-card-h"><Icon icon={HelpCircle} size="sm" /><b>{uiText('小竹想先确认')}</b></div>
    <p>{open.question}</p>
    <div className="mist-xz-answer"><input aria-label={uiText('回答小竹')} value={text} maxLength={2000} placeholder={uiText('输入回答')} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <Button size="sm" variant="ai" disabled={!text.trim()} onClick={send}>{uiText('回答')}</Button></div></div>;
}

function ProposalCard({ proposal, onOpen, onDecide }: { proposal: AgentProposal; onOpen: (id: string) => void; onDecide?: (id: string, confirm: boolean) => Promise<void> }) {
  const risk = agentCommandRisk(proposal.command.type), quick = !!onDecide && risk !== 'high' && !commandRequiresSignature(proposal.command), [busy, setBusy] = React.useState(false);
  const decide = async (confirm: boolean) => { if (!onDecide) return; setBusy(true); try { await onDecide(proposal.id, confirm); } finally { setBusy(false); } };
  return <div className="mist-xz-card"><div className="mist-xz-card-h"><Icon icon={ShieldCheck} size="sm" /><b>{uiText('需要你确认')}</b><Pill tone={RISK_TONE[risk]}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></div>
    <ul>{proposal.summary.slice(0, 5).map((line, i) => <li key={i}>{line}</li>)}</ul>
    <div className="mist-row">{quick ? <><Button size="sm" variant="ai" loading={busy} disabled={busy} onClick={() => void decide(true)}>{uiText('确认执行')}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => void decide(false)}>{uiText('拒绝')}</Button><span className="mist-spacer" /><Button size="sm" variant="quiet" disabled={busy} onClick={() => onOpen(proposal.id)}>{uiText('查看并确认')}</Button></> : <Button size="sm" variant="ai" onClick={() => onOpen(proposal.id)}>{uiText('查看并确认')}</Button>}</div></div>;
}

export type ThreadActions = { onAnswer: (task: AgentTaskView, id: string, text: string) => void; onCancel: (task: AgentTaskView) => void; onRetry: (text: string) => void; onCopy: (text: string) => void; onDraft: (text: string) => void; onAutomate: (text: string) => void; onOpenRecord: (view: string, id: string, section?: string) => void; onProposal: (id: string) => void; onDecide?: (id: string, confirm: boolean) => Promise<void>; onOpenFile?: (fileId: string) => void };

/** 本轮确认后生成的文件：放在回答下方，点开即下载。 */
function ProducedFiles({ proposals, onOpen }: { proposals: AgentProposal[]; onOpen: (fileId: string) => void }) {
  return <div className="mist-xz-files">{proposals.map(p => <button key={p.id} type="button" className="mist-xz-file" title={p.produced!.fileName} onClick={() => onOpen(p.produced!.fileId)}><Icon icon={FileText} size="sm" /><span>{p.produced!.fileName}</span><Icon icon={Download} size="xs" /></button>)}</div>;
}

export function XiaozhuTurnShell({ children, status }: { children: React.ReactNode; status?: React.ReactNode }) {
  // 头像已表明是小竹，不再逐条写名字；状态只在未完成时出现，时间放在操作行。
  return <div className="mist-xz-ai"><span className="mist-xz-avatar" aria-label={uiText('小竹')}><AIBadge icon={AssistantEyes} /></span><div className="mist-xz-ai-b">{status && <div className="mist-xz-ai-meta">{status}</div>}{children}</div></div>;
}

export function XiaozhuThread({ tasks, index, proposals, ...actions }: { tasks: AgentTaskView[]; index: RecordRef[]; proposals: AgentProposal[] } & ThreadActions) {
  let lastDay = '';
  // 对话跨天时才分日期；单日对话的日期已在左栏分组里。
  const multiDay = new Set(tasks.map(t => dayKey(t.createdAt))).size > 1;
  return <div className="mist-xz-thread">{tasks.map(t => {
    const day = dayKey(t.createdAt), divider = multiDay && day !== lastDay; lastDay = day;
    const active = COWORK_ACTIVE.includes(t.state), asking = t.state === 'waiting_human' && (t.questions ?? []).some(q => !q.answeredAt);
    const pending = t.waitingProposalIds.map(id => proposals.find(p => p.id === id && p.state === 'pending')).filter((p): p is AgentProposal => !!p);
    const produced = proposals.filter(p => p.taskId === t.id && p.state === 'confirmed' && p.produced && !p.unavailable);
    const request = splitRequest(t.instructions), done = !active && t.state !== 'waiting_human', working = active && !asking && !pending.length;
    const status = !active && t.state !== 'succeeded' ? <Pill tone={STATE[t.state][1]}>{uiText(STATE[t.state][0])}</Pill> : undefined;
    return <div className="mist-xz-turn" key={t.id} data-task-state={t.state}>
      {divider && <div className="mist-xz-day"><span>{dayLabel(t.createdAt)}</span></div>}
      <div className="mist-xz-user">{request}</div>
      <XiaozhuTurnShell status={status}>
        {(!!t.trail?.length || working) && <Trail items={t.trail ?? []} active={working} onOpen={actions.onOpenRecord} />}
        {t.result && <XiaozhuMarkdown text={t.result} index={index} onOpen={actions.onOpenRecord} />}
        {active && t.checkpoint && !t.result && !working && <p className="mist-xz-note">{t.checkpoint}</p>}
        {!active && t.state !== 'succeeded' && !t.result && t.checkpoint && <p className="mist-xz-note">{t.checkpoint}</p>}
        {!!produced.length && actions.onOpenFile && <ProducedFiles proposals={produced} onOpen={actions.onOpenFile} />}
        {asking && <Question task={t} onAnswer={actions.onAnswer} />}
        {pending.map(p => <ProposalCard key={p.id} proposal={p} onOpen={actions.onProposal} onDecide={actions.onDecide} />)}
        <div className="mist-xz-acts">
          {/* 办理中的停止在输入框；等待中的任务在这里停。 */}{active && t.canControl && !['queued', 'running'].includes(t.state) && <Button size="sm" variant="quiet" icon={Square} onClick={() => actions.onCancel(t)}>{uiText('停止')}</Button>}
          {done && t.result && <><IconButton size="sm" icon={Copy} label={uiText('复制')} onClick={() => actions.onCopy(t.result)} /><IconButton size="sm" icon={FileText} label={uiText('保存草稿')} onClick={() => actions.onDraft(t.result)} /></>}
          {done && <IconButton size="sm" icon={RotateCcw} label={uiText('重新提问')} onClick={() => actions.onRetry(request)} />}
          {done && t.state === 'succeeded' && <IconButton size="sm" icon={Zap} label={uiText('设为自动规则')} onClick={() => actions.onAutomate(request)} />}
          {done && <time className="mist-xz-time" dateTime={t.updatedAt}>{clock(t.updatedAt || t.createdAt)}</time>}
        </div>
      </XiaozhuTurnShell>
    </div>;
  })}</div>;
}
