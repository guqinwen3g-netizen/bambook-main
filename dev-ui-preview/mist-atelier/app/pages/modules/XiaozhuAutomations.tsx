/** 小竹页的自动模式（2026-11-07 定案）：常驻规则，什么情况发生就做什么；触发一次做一次，要改业务的事留给本人确认。 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Banner, Button, Drawer, EmptyState, Field, IconButton, Pill, Select, Switch, TextArea, TextInput, useToast } from '../../../../../components/mist';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { mistApiRequest } from '../../runtime/workspace';
import { useNav } from '../../nav';

type Trigger = 'new_mail' | 'new_receipt' | 'due_soon' | 'daily';
type Rule = { id: string; name: string; trigger: Trigger; time: string; instructions: string; enabled: boolean; version: number; runs: Array<{ at: string; taskId: string; detail: string }>; halted?: { message: string } };
const TRIGGERS: Array<{ value: Trigger; label: string; name: string; instructions: string }> = [
  { value: 'new_mail', label: '收到新邮件', name: '新邮件整理', instructions: '读取新邮件，总结要点，判断是否需要跟进，并起草回复。' },
  { value: 'new_receipt', label: '收到新到账', name: '到账核对', instructions: '核对新到账，匹配对应应收，说明依据和需要人工确认的地方。' },
  { value: 'due_soon', label: '订单交期临近', name: '交期提醒', instructions: '检查交期临近的订单进度，列出风险和下一步。' },
  { value: 'daily', label: '每天定时', name: '每日汇总', instructions: '汇总今天需要处理的待办、逾期和风险。' },
];
const timed = (t: Trigger) => t === 'daily' || t === 'due_soon';
const label = (t: Trigger) => TRIGGERS.find(x => x.value === t)!.label;

export function XiaozhuAutomations({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId?: string }) {
  const { go } = useNav(), toast = useToast(), base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) + '/agent-automations' : '';
  const [rules, setRules] = React.useState<Rule[]>([]), [loading, setLoading] = React.useState(false), [error, setError] = React.useState('');
  const [draft, setDraft] = React.useState<{ trigger: Trigger; name: string; instructions: string; time: string } | null>(null), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    if (!base) return; setLoading(true);
    try { setRules(((await mistApiRequest(base)) as { items: Rule[] }).items); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); } finally { setLoading(false); }
  }, [base]);
  React.useEffect(() => { if (open) void load(); else setDraft(null); }, [open, load]);
  const start = () => { const t = TRIGGERS[0]; setDraft({ trigger: t.value, name: t.name, instructions: t.instructions, time: '09:00' }); };
  const pick = (value: Trigger) => { const t = TRIGGERS.find(x => x.value === value)!; setDraft(d => d && { ...d, trigger: value, name: t.name, instructions: t.instructions }); };
  const act = async (run: () => Promise<unknown>) => { setBusy(true); setError(''); try { await run(); await load(); return true; } catch (e) { setError(e instanceof Error ? e.message : '操作未完成'); return false; } finally { setBusy(false); } };
  const create = async () => { if (draft && await act(() => mistApiRequest(base, { method: 'POST', body: JSON.stringify({ ...draft, enabled: true }) }))) { setDraft(null); toast(uiText('规则已开启')); } };
  const toggle = (r: Rule, enabled: boolean) => act(() => mistApiRequest(base + '/' + r.id, { method: 'PUT', body: JSON.stringify({ name: r.name, trigger: r.trigger, time: r.time, instructions: r.instructions, enabled }) }));
  const remove = (r: Rule) => act(() => mistApiRequest(base + '/' + r.id, { method: 'DELETE' }));
  return <Drawer open={open} onClose={onClose} size="lg" title={uiText('自动')} tone="ai" footer={draft ? undefined : <Button icon={Plus} variant="primary" onClick={start}>{uiText('新建规则')}</Button>}>
    <div className="mist-col">
      {error && <Banner tone="bad" title={uiText(error)} />}
      {draft && <div className="mist-col">
        <Field label={uiText('什么时候')} required><Select aria-label={uiText('触发条件')} value={draft.trigger} options={TRIGGERS.map(t => ({ value: t.value, label: uiText(t.label) }))} onChange={e => pick(e.target.value as Trigger)} /></Field>
        {timed(draft.trigger) && <Field label={uiText('每天几点')}><TextInput aria-label={uiText('每天几点')} type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} /></Field>}
        <Field label={uiText('规则名称')} required><TextInput aria-label={uiText('规则名称')} value={draft.name} maxLength={40} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label={uiText('要做什么')} required><TextArea aria-label={uiText('规则要做什么')} rows={3} maxLength={2000} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></Field>
        <div className="mist-row"><span className="mist-spacer" /><Button disabled={busy} onClick={() => setDraft(null)}>{uiText('取消')}</Button><Button variant="primary" loading={busy} disabled={busy || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void create()}>{uiText('开启')}</Button></div>
      </div>}
      {!rules.length && !draft && !loading && <EmptyState title={uiText('还没有规则')} compact />}
      {rules.map(r => <div className="mist-col mist-section" key={r.id}>
        <div className="mist-row"><b>{r.name}</b><Pill tone="ai">{uiText(label(r.trigger))}{timed(r.trigger) ? ' ' + r.time : ''}</Pill><span className="mist-spacer" />
          <Switch ariaLabel={uiText(`开启 ${r.name}`)} checked={r.enabled} disabled={busy} onChange={v => void toggle(r, v)} />
          <IconButton icon={Trash2} label={uiText(`删除 ${r.name}`)} disabled={busy} onClick={() => void remove(r)} /></div>
        {r.halted && <Banner tone="warn" title={uiText(r.halted.message)} />}
        <p className="mist-sub">{r.instructions}</p>
        {r.runs.slice(0, 3).map(run => <div className="mist-row" key={run.taskId}><span className="mist-note">{new Date(run.at).toLocaleString(interfaceLocale())} · {run.detail}</span><span className="mist-spacer" /><Button size="sm" variant="quiet" onClick={() => go('assistant', run.taskId, { section: 'tasks' })}>{uiText('查看')}</Button></div>)}
      </div>)}
    </div>
  </Drawer>;
}
