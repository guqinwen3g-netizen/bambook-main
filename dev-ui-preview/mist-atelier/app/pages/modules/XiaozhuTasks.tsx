/**
 * 小竹页的任务抽屉（2026-11-07 定案）：对话里交给小竹的事项在这里集中监督（暂停、停止、历史），并看本月用量。
 * 交办本身在对话里完成；个人 Agent 不再是独立页面。
 */
import React from 'react';
import { Banner, Drawer, KeyValue } from '../../../../../components/mist';
import { mistApiRequest, useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { uiText } from '../../../../../services/interfaceLanguage';
import { businessNow } from '../../runtime/businessClock';
import { FailureNotice } from '../../runtime/FailureNotice';
import { AgentTasks } from '../AgentTasks';

type Usage = { month: string; scope: 'mine' | 'company'; items: Array<{ ownerId: string; ownerName: string; tasks: number; modelTurns: number; runtimeMs: number }>;
  today?: { tasks: number; turns: number; taskLimit: number; turnLimit: number; companyTurns?: number; companyTurnLimit?: number } };

export function XiaozhuTasks({ open, onClose, refreshSignal }: { open: boolean; onClose: () => void; refreshSignal?: number }) {
  const w = useMistWorkspace(), session = useMistSession(), { go } = useNav();
  const workspaceId = w.workspace?.id, canChat = session.hasPermission('ai:chat');
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) : '';
  const [usage, setUsage] = React.useState<Usage | null>(null), [error, setError] = React.useState('');
  const month = businessNow().toISOString().slice(0, 7);
  React.useEffect(() => {
    setUsage(null); setError('');
    if (!open || !base || !canChat) return;
    let stale = false;
    (mistApiRequest(base + '/personal-agent/usage?month=' + month) as Promise<Usage>).then(u => { if (!stale) setUsage(u); }).catch(e => { if (!stale) setError(e instanceof Error ? e.message : '读取失败'); });
    return () => { stale = true; };
  }, [base, canChat, month, open, session.sessionKey]);
  return <Drawer open={open} onClose={onClose} size="lg" title={uiText('任务')} tone="ai">
    {!canChat ? <Banner tone="warn" title={uiText('无 AI 使用权限')} /> : <div className="mist-col">
      {error && <FailureNotice title={'未完成'} detail={error} />}
      <AgentTasks onConnections={() => go('account', undefined, { section: 'connections' })} refreshSignal={refreshSignal} />
      {usage?.today && <KeyValue items={[
        { label: uiText('今日用量'), value: `${usage.today.tasks} / ${usage.today.taskLimit} 项 · 模型调用 ${usage.today.turns} / ${usage.today.turnLimit} 次` },
        ...(usage.today.companyTurnLimit !== undefined ? [{ label: uiText('公司今日'), value: `模型调用 ${usage.today.companyTurns ?? 0} / ${usage.today.companyTurnLimit} 次` }] : []),
      ]} />}
      {usage && (usage.items.length ? <KeyValue items={usage.items.map(u => ({ label: usage.scope === 'company' ? u.ownerName : uiText('本月用量'), value: `${u.tasks} 项 · 模型调用 ${u.modelTurns} 次` }))} /> : <span className="mist-note">{uiText('本月还没有用量')}</span>)}
    </div>}
  </Drawer>;
}
