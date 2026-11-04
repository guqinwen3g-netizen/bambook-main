/**
 * 第二类个人 Agent（2026-11-04 定案）：每个账号一个，只为本人办事，权限不超过本人；
 * 模型由平台统一配置，需要确认的事项进入本人「接着完成」。浏览器与桌面端都可用。
 */
import React from 'react';
import { Bot, RefreshCw, Send } from 'lucide-react';
import { Banner, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, KeyValue, MistPage, PageHeader, Pill, TextArea, TextInput, useToast, type Tone } from '../../../../../components/mist';
import type { AgentIdentityView } from '../../../../../server/src/shared/mistAgentIdentities';
import type { AgentTaskPage, AgentTaskView } from '../../../../../server/src/shared/mistAgentTasks';
import { mistApiRequest, useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { businessNow } from '../../runtime/businessClock';

const STATE: Record<AgentTaskView['state'], [string, Tone]> = { queued: ['待执行', 'accent'], running: ['执行中', 'accent'], waiting_time: ['等待继续', 'neutral'], waiting_condition: ['等待资料变化', 'neutral'], waiting_human: ['待我确认', 'warn'], paused: ['已暂停', 'neutral'], succeeded: ['已完成', 'ok'], failed: ['未完成', 'bad'], cancelled: ['已停止', 'neutral'], expired: ['已到期', 'neutral'], budget_exhausted: ['达到限额', 'warn'], access_changed: ['权限已变化', 'warn'] };
type Usage = { month: string; scope: 'mine' | 'company'; items: Array<{ ownerId: string; ownerName: string; tasks: number; modelTurns: number; runtimeMs: number }> };

export function PersonalAgentPage({ tabs }: { tabs?: React.ReactNode }) {
  const w = useMistWorkspace(), session = useMistSession(), { go } = useNav(), toast = useToast();
  const workspaceId = w.workspace?.id, canChat = session.hasPermission('ai:chat');
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) : '';
  const [identity, setIdentity] = React.useState<AgentIdentityView | null>(null), [available, setAvailable] = React.useState(true);
  const [tasks, setTasks] = React.useState<AgentTaskView[]>([]), [usage, setUsage] = React.useState<Usage | null>(null);
  const [name, setName] = React.useState(''), [instructions, setInstructions] = React.useState('');
  const [busy, setBusy] = React.useState(false), [loading, setLoading] = React.useState(true), [error, setError] = React.useState('');
  const month = businessNow().toISOString().slice(0, 7);
  const load = React.useCallback(async () => {
    if (!base || !canChat) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [mine, page, caps, used] = await Promise.all([
        mistApiRequest(base + '/agent-identities?scope=mine') as Promise<{ items: AgentIdentityView[] }>,
        mistApiRequest(base + '/agent-tasks') as Promise<AgentTaskPage>,
        mistApiRequest(base + '/agent-task-capabilities') as Promise<{ platformAvailable: boolean }>,
        mistApiRequest(base + '/personal-agent/usage?month=' + month) as Promise<Usage>,
      ]);
      const own = mine.items.find(i => i.kind === 'personal') ?? null;
      setIdentity(own); setTasks(page.items.filter(t => t.executor === 'platform' && (!own || t.identityId === own.id))); setAvailable(caps.platformAvailable); setUsage(used);
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); } finally { setLoading(false); }
  }, [base, canChat, month]);
  React.useEffect(() => { void load(); }, [load]);
  const send = async () => {
    if (busy || !base || !instructions.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await mistApiRequest(base + '/personal-agent/tasks', { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), name: (name.trim() || instructions.trim()).slice(0, 60), instructions: instructions.trim(), locale: interfaceLocale() }) }) as { item: AgentTaskView };
      setTasks(old => [r.item, ...old]); setName(''); setInstructions(''); toast(uiText('已交给我的 Agent')); void load();
    } catch (e) { setError(e instanceof Error ? e.message : '未能交办'); } finally { setBusy(false); }
  };
  const header = <PageHeader title={uiText('我的 Agent')} actions={<Button icon={RefreshCw} disabled={loading} onClick={() => void load()}>{uiText('刷新')}</Button>} />;
  if (!canChat) return <MistPage>{header}{tabs}<Banner tone="warn" title={uiText('无 AI 使用权限')} /></MistPage>;
  const stopped = identity?.state === 'disabled';
  return <MistPage>
    {header}{tabs}
    {error && <Banner tone="bad" title={uiText('未完成')}>{uiText(error)}</Banner>}
    {!available && <Banner tone="warn" title={uiText('平台模型暂不可用')} />}
    {stopped && <Banner tone="warn" title={uiText('我的 Agent 已被管理员停用')} />}
    <Card>
      <CardHeader title={uiText('交给我的 Agent')} leading={<Bot size={16} />} />
      <CardBody>
        <Field label={uiText('事项')}><TextInput aria-label={uiText('事项名称')} value={name} maxLength={60} disabled={busy || stopped} onChange={e => setName(e.target.value)} /></Field>
        <Field label={uiText('要做什么')} required><TextArea aria-label={uiText('要做什么')} rows={4} maxLength={4000} value={instructions} disabled={busy || stopped} onChange={e => setInstructions(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} /></Field>
        <div className="mist-row"><span className="mist-spacer" /><Button variant="primary" icon={Send} loading={busy} disabled={busy || stopped || !available || !instructions.trim()} onClick={() => void send()}>{uiText('交办')}</Button></div>
      </CardBody>
    </Card>
    <Card className="mist-section">
      <CardHeader title={uiText('我交办的事项')} />
      <DataTable ariaLabel={uiText('我交办的事项')} loading={loading && !tasks.length} rows={tasks} rowKey={t => t.id} onRowClick={t => go('account', t.id, { section: 'agents' })} columns={[
        { key: 'name', header: '事项', width: 'minmax(180px,2fr)', render: t => <span>{t.name}{t.result ? <small className="mist-cell-sub">{t.result.slice(0, 80)}</small> : null}</span> },
        { key: 'state', header: '状态', width: '110px', render: t => <Pill tone={STATE[t.state][1]}>{uiText(STATE[t.state][0])}</Pill> },
        { key: 'at', header: '交办时间', width: '140px', hideOnMobile: true, render: t => new Date(t.createdAt).toLocaleString(interfaceLocale()) },
      ]} empty={<EmptyState title={uiText('还没有交办事项')} compact />} />
      {tasks.some(t => t.state === 'waiting_human') && <CardBody><Button onClick={() => go('cockpit')}>{uiText('查看待我确认')}</Button></CardBody>}
    </Card>
    {usage && <Card className="mist-section">
      <CardHeader title={uiText(usage.scope === 'company' ? `本公司个人 Agent 用量 · ${usage.month}` : `本月用量 · ${usage.month}`)} />
      <CardBody>{usage.items.length ? <KeyValue items={usage.items.map(u => ({ label: usage.scope === 'company' ? u.ownerName : uiText('我'), value: `${u.tasks} 项 · 模型调用 ${u.modelTurns} 次` }))} /> : <span className="mist-note">{uiText('本月还没有用量')}</span>}</CardBody>
    </Card>}
  </MistPage>;
}
