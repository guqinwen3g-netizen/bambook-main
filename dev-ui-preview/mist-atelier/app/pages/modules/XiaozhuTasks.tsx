/**
 * 小竹页的任务抽屉（2026-11-07 定案）：个人 Agent 不再是独立页面。交办、语音、任务监督与用量都在这里，
 * 模型由平台统一配置，需要确认的事项进入本人「接着完成」。语音放在抽屉外层，关闭抽屉不断开通话。
 */
import React from 'react';
import { Mic, MicOff, PhoneOff, Send, Square } from 'lucide-react';
import { Banner, Button, Card, CardBody, Drawer, Field, KeyValue, Pill, TextArea, TextInput, useToast } from '../../../../../components/mist';
import type { AgentIdentityView } from '../../../../../server/src/shared/mistAgentIdentities';
import type { AgentTaskView } from '../../../../../server/src/shared/mistAgentTasks';
import { mistApiRequest, useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { AgentTasks } from '../AgentTasks';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { businessNow } from '../../runtime/businessClock';
import { FailureNotice } from '../../runtime/FailureNotice';
import { usePersonalAgentVoice } from '../../runtime/personalAgentVoice';

type Usage = { month: string; scope: 'mine' | 'company'; items: Array<{ ownerId: string; ownerName: string; tasks: number; modelTurns: number; runtimeMs: number }> };

export function XiaozhuTasks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const w = useMistWorkspace(), session = useMistSession(), { go } = useNav(), toast = useToast();
  const workspaceId = w.workspace?.id, canChat = session.hasPermission('ai:chat');
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) : '';
  const [identity, setIdentity] = React.useState<AgentIdentityView | null>(null), [available, setAvailable] = React.useState(true);
  const [usage, setUsage] = React.useState<Usage | null>(null), [refresh, setRefresh] = React.useState(0);
  const [name, setName] = React.useState(''), [instructions, setInstructions] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const request = React.useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  const loadVersion = React.useRef(0);
  const owner = `${session.sessionKey}:${workspaceId}`, liveOwner = React.useRef(owner); liveOwner.current = owner;
  const onVoiceTask = React.useCallback((_task: AgentTaskView) => setRefresh(n => n + 1), []);
  const voice = usePersonalAgentVoice(`${session.sessionKey}:${workspaceId}:${canChat}`, workspaceId, onVoiceTask);
  const inCall = voice.state === 'connecting' || voice.state === 'listening' || voice.state === 'speaking';
  const month = businessNow().toISOString().slice(0, 7);
  const load = React.useCallback(async () => {
    const version = ++loadVersion.current;
    if (!base || !canChat) return;
    setError('');
    try {
      const [mine, caps, used] = await Promise.all([
        mistApiRequest(base + '/agent-identities?scope=mine') as Promise<{ items: AgentIdentityView[] }>,
        mistApiRequest(base + '/agent-task-capabilities') as Promise<{ platformAvailable: boolean }>,
        mistApiRequest(base + '/personal-agent/usage?month=' + month) as Promise<Usage>,
      ]);
      if (version !== loadVersion.current) return;
      setIdentity(mine.items.find(i => i.kind === 'personal') ?? null); setAvailable(caps.platformAvailable); setUsage(used);
    } catch (e) { if (version === loadVersion.current) setError(e instanceof Error ? e.message : '读取失败'); }
  }, [base, canChat, month, session.sessionKey]);
  React.useEffect(() => { setIdentity(null); setUsage(null); request.current = undefined; if (open) void load(); return () => { loadVersion.current++; }; }, [load, open]);
  React.useEffect(() => { setName(''); setInstructions(''); setBusy(false); setError(''); request.current = undefined; }, [owner]);
  const send = async () => {
    if (busy || !base || !instructions.trim()) return;
    const sentBy = owner, stillCurrent = () => liveOwner.current === sentBy;
    setBusy(true); setError('');
    try {
      const input = { name: (name.trim() || instructions.trim()).slice(0, 60), instructions: instructions.trim(), locale: interfaceLocale() };
      const fingerprint = JSON.stringify([base, input]);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      const r = await mistApiRequest(base + '/personal-agent/tasks', { method: 'POST', body: JSON.stringify({ requestId: request.current!.id, ...input }) }) as { item: AgentTaskView };
      // A reply that lands after an account or company switch belongs to the previous context.
      if (!stillCurrent()) return;
      request.current = undefined; voice.followTask(r.item.id); setRefresh(n => n + 1); setName(''); setInstructions(''); toast(uiText('已交给小竹')); void load();
    } catch (e) { if (stillCurrent()) setError(e instanceof Error ? e.message : '未能交办'); } finally { if (stillCurrent()) setBusy(false); }
  };
  const stopped = identity?.state === 'disabled';
  const call = inCall ? <Card className="mist-section"><CardBody>
    <div className="mist-row"><Pill tone="accent">{uiText(voice.state === 'connecting' ? '连接中' : voice.muted ? '已静音' : voice.state === 'speaking' ? '正在播放' : '正在聆听')}</Pill><span className="mist-spacer" />
      <Button icon={voice.muted ? MicOff : Mic} disabled={voice.state === 'connecting'} onClick={voice.toggleMute}>{uiText(voice.muted ? '取消静音' : '静音')}</Button>
      <Button icon={Square} disabled={voice.state !== 'speaking'} onClick={voice.interrupt}>{uiText('停止播放')}</Button>
      <Button icon={PhoneOff} onClick={voice.end}>{uiText('结束语音')}</Button>
    </div>
    {voice.transcript && <p aria-label={uiText('我的语音')}>{voice.transcript}</p>}
    {voice.reply && <p aria-live="polite">{voice.reply}</p>}
  </CardBody></Card> : null;
  return <>
    {!open && call}
    <Drawer open={open} onClose={onClose} size="lg" title={uiText('任务')} tone="ai">
      {!canChat ? <Banner tone="warn" title={uiText('无 AI 使用权限')} /> : <div className="mist-col">
        {error && <FailureNotice title={'未完成'} detail={error} />}
        {!available && <Banner tone="warn" title={uiText('平台模型暂不可用')} />}
        {stopped && <Banner tone="warn" title={uiText('小竹已被管理员停用')} />}
        {voice.state === 'error' && <Banner tone="warn" title={uiText(voice.error)} actions={<Button onClick={() => void voice.start()}>{uiText('重新连接')}</Button>} />}
        {call}
        <Field label={uiText('事项')}><TextInput aria-label={uiText('事项名称')} value={name} maxLength={60} disabled={busy || stopped} onChange={e => setName(e.target.value)} /></Field>
        <Field label={uiText('要做什么')} required><TextArea aria-label={uiText('要做什么')} rows={3} maxLength={4000} value={instructions} disabled={busy || stopped} onChange={e => setInstructions(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} /></Field>
        <div className="mist-row"><span className="mist-spacer" /><Button icon={Mic} disabled={inCall || !available || stopped} onClick={() => void voice.start()}>{uiText('语音')}</Button><Button variant="primary" icon={Send} loading={busy} disabled={busy || stopped || !available || !instructions.trim()} onClick={() => void send()}>{uiText('交办')}</Button></div>
        <AgentTasks onConnections={() => go('account', undefined, { section: 'connections' })} refreshSignal={refresh} rowAction={t => t.executor === 'platform' ? <Button icon={Mic} size="sm" disabled={inCall || stopped || !available} aria-label={uiText(`语音接续 ${t.name}`)} onClick={e => { e.stopPropagation(); void voice.start(t.id); }}>{uiText('语音')}</Button> : null} />
        {usage && (usage.items.length ? <KeyValue items={usage.items.map(u => ({ label: usage.scope === 'company' ? u.ownerName : uiText('本月用量'), value: `${u.tasks} 项 · 模型调用 ${u.modelTurns} 次` }))} /> : <span className="mist-note">{uiText('本月还没有用量')}</span>)}
      </div>}
    </Drawer>
  </>;
}
