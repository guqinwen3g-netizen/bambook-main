/** 小竹对话里的任务回合：用户请求、办理进度、追问与待确认事项都在同一条对话里。 */
import React from 'react';
import { Button, TextInput, Pill, type Tone } from '../../../../../components/mist';
import type { AgentTaskView } from '../../../../../server/src/shared/mistAgentTasks';
import { uiText } from '../../../../../services/interfaceLanguage';
import { COWORK_ACTIVE, splitRequest } from '../../runtime/xiaozhuCowork';

const STATE: Record<AgentTaskView['state'], [string, Tone]> = { queued: ['待执行', 'accent'], running: ['办理中', 'accent'], waiting_time: ['等待继续', 'neutral'], waiting_condition: ['等待资料变化', 'neutral'], waiting_human: ['待我确认', 'warn'], paused: ['已暂停', 'neutral'], succeeded: ['已完成', 'ok'], failed: ['未完成', 'bad'], cancelled: ['已停止', 'neutral'], expired: ['已到期', 'neutral'], budget_exhausted: ['达到限额', 'warn'], access_changed: ['权限已变化', 'warn'] };

function Question({ task, onAnswer }: { task: AgentTaskView; onAnswer: (task: AgentTaskView, id: string, text: string) => void }) {
  const [text, setText] = React.useState('');
  const open = (task.questions ?? []).find(q => !q.answeredAt);
  if (!open || !task.canControl) return null;
  return <div className="mist-col"><p className="mist-chat-text">{open.question}</p>
    <div className="mist-row"><TextInput aria-label={uiText('回答小竹')} value={text} maxLength={2000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) { e.preventDefault(); onAnswer(task, open.id, text); setText(''); } }} />
      <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => { onAnswer(task, open.id, text); setText(''); }}>{uiText('回答')}</Button></div></div>;
}

export function XiaozhuThread({ tasks, onAnswer, onCancel, onConfirm }: { tasks: AgentTaskView[]; onAnswer: (task: AgentTaskView, id: string, text: string) => void; onCancel: (task: AgentTaskView) => void; onConfirm: () => void }) {
  return <div className="mist-msgs">{tasks.map(t => {
    const active = COWORK_ACTIVE.includes(t.state), asking = t.state === 'waiting_human' && (t.questions ?? []).some(q => !q.answeredAt);
    const confirming = t.state === 'waiting_human' && t.waitingProposalIds.length > 0;
    return <React.Fragment key={t.id}>
      <div className="mist-msg" data-role="user">{splitRequest(t.instructions)}</div>
      <div className="mist-msg" data-role="assistant" data-task-state={t.state}>
        <div className="mist-msg-bubble">
          {t.result ? <p className="mist-chat-text">{t.result}</p> : active && !asking && !confirming ? <div className="mist-typing" aria-label={uiText('小竹正在办理')}><i /><i /><i /></div> : null}
          {active && t.checkpoint && !t.result && <p className="mist-note">{t.checkpoint}</p>}
          {asking && <Question task={t} onAnswer={onAnswer} />}
          {confirming && <p className="mist-chat-text">{uiText('这一步会改动业务，需要你确认后才会执行。')}</p>}
          {!active && t.state !== 'succeeded' && <Pill tone={STATE[t.state][1]}>{uiText(STATE[t.state][0])}</Pill>}
          {!active && t.state !== 'succeeded' && !t.result && t.checkpoint && <p className="mist-note">{t.checkpoint}</p>}
        </div>
        <div className="mist-msg-acts">
          {confirming && <Button size="sm" variant="ai" onClick={onConfirm}>{uiText('去确认')}</Button>}
          {active && t.canControl && <Button size="sm" variant="quiet" onClick={() => onCancel(t)}>{uiText('停止')}</Button>}
        </div>
      </div>
    </React.Fragment>;
  })}</div>;
}
