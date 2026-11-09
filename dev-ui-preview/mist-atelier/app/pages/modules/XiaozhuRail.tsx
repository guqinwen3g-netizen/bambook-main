/** 小竹页右侧：一眼看到待我确认、正在办理和自动规则，不用开抽屉。 */
import React from 'react';
import { ListChecks, Plus, ShieldCheck, Zap } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Pill, Switch, type Tone } from '../../../../../components/mist';
import type { AgentTaskView } from '../../../../../server/src/shared/mistAgentTasks';
import { agentCommandRisk, AGENT_RISK_LABEL, type AgentProposal } from '../../../../../server/src/shared/mistAgentProposals';
import { uiText } from '../../../../../services/interfaceLanguage';
import { mistApiRequest } from '../../runtime/workspace';
import { COWORK_ACTIVE } from '../../runtime/xiaozhuCowork';

export type AutomationRule = { id: string; name: string; trigger: 'new_mail' | 'new_receipt' | 'due_soon' | 'daily'; time: string; instructions: string; enabled: boolean; version: number; runs: Array<{ at: string; taskId: string; detail: string }>; halted?: { message: string } };
export const TRIGGER_LABEL: Record<AutomationRule['trigger'], string> = { new_mail: '收到新邮件', new_receipt: '收到新到账', due_soon: '订单交期临近', daily: '每天定时' };
const RISK_TONE: Record<string, Tone> = { low: 'neutral', medium: 'warn', high: 'bad' };
const STATE_LABEL: Partial<Record<AgentTaskView['state'], string>> = { queued: '待执行', running: '办理中', waiting_time: '等待继续', waiting_condition: '等待资料变化', waiting_human: '待我确认', paused: '已暂停' };

export function useAutomationRules(workspaceId: string | undefined, enabled: boolean, reloadKey: unknown) {
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) + '/agent-automations' : '';
  const [rules, setRules] = React.useState<AutomationRule[]>([]);
  const load = React.useCallback(async () => { if (!base || !enabled) return; try { setRules(((await mistApiRequest(base)) as { items: AutomationRule[] }).items); } catch { /* 规则读不到时右栏不显示，不影响对话 */ } }, [base, enabled]);
  React.useEffect(() => { setRules([]); void load(); const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 15_000); return () => clearInterval(timer); }, [load, reloadKey]);
  const toggle = async (rule: AutomationRule, on: boolean) => { try { await mistApiRequest(base + '/' + rule.id, { method: 'PUT', body: JSON.stringify({ name: rule.name, trigger: rule.trigger, time: rule.time, instructions: rule.instructions, enabled: on }) }); } finally { await load(); } };
  return { rules, toggle, reload: load };
}

export function XiaozhuRail({ proposals, active, rules, onProposal, onOpenTasks, onOpenAutomations, onNewRule, onToggle, onOpenTask }: {
  proposals: AgentProposal[]; active: AgentTaskView[]; rules: AutomationRule[];
  onProposal: (id: string) => void; onOpenTasks: () => void; onOpenAutomations: () => void; onNewRule: () => void; onToggle: (rule: AutomationRule, on: boolean) => void; onOpenTask: (task: AgentTaskView) => void;
}) {
  const running = active.filter(t => COWORK_ACTIVE.includes(t.state) && t.state !== 'waiting_human');
  return <>
    <Card>
      <CardHeader title={uiText('待我确认')} leading={<ShieldCheck size={15} />} tools={proposals.length ? <Pill tone="warn">{proposals.length}</Pill> : undefined} />
      <CardBody>{proposals.length ? <div className="mist-xz-list">{proposals.slice(0, 5).map(p => { const risk = agentCommandRisk(p.command.type); return <button type="button" key={p.id} className="mist-xz-item" onClick={() => onProposal(p.id)}><span className="mist-xz-item-t">{p.summary[0] ?? p.command.type}</span><Pill tone={RISK_TONE[risk]}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></button>; })}</div> : <span className="mist-note">{uiText('没有待确认事项')}</span>}</CardBody>
    </Card>
    <Card>
      <CardHeader title={uiText('正在办理')} leading={<ListChecks size={15} />} tools={<Button size="sm" variant="quiet" onClick={onOpenTasks}>{uiText('全部任务')}</Button>} />
      <CardBody>{running.length ? <div className="mist-xz-list">{running.slice(0, 5).map(t => <button type="button" key={t.id} className="mist-xz-item" onClick={() => onOpenTask(t)}><span className="mist-xz-item-t">{t.name}</span><Pill tone="accent">{uiText(STATE_LABEL[t.state] ?? '办理中')}</Pill></button>)}</div> : <span className="mist-note">{uiText('暂时没有在办的事项')}</span>}</CardBody>
    </Card>
    <Card>
      <CardHeader title={uiText('自动规则')} leading={<Zap size={15} />} tools={<Button size="sm" variant="quiet" onClick={rules.length ? onOpenAutomations : onNewRule}>{uiText(rules.length ? '管理' : '新建')}</Button>} />
      <CardBody>{rules.length ? <div className="mist-xz-list">{rules.slice(0, 5).map(r => <div key={r.id} className="mist-xz-item mist-xz-rule"><span className="mist-xz-item-t">{r.name}<small>{uiText(TRIGGER_LABEL[r.trigger])}{r.halted ? ' · ' + r.halted.message : r.runs[0] ? ' · ' + r.runs[0].detail : ''}</small></span><Switch ariaLabel={uiText(`开启 ${r.name}`)} checked={r.enabled} onChange={on => onToggle(r, on)} /></div>)}
        <Button size="sm" variant="quiet" icon={Plus} onClick={onNewRule}>{uiText('新建规则')}</Button></div> : <span className="mist-note">{uiText('还没有自动规则')}</span>}</CardBody>
    </Card>
  </>;
}
