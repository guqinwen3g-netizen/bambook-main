import React from 'react';
import type { AgentTaskActivity, AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
import { withRequestDeadline } from './requestDeadline';
import { mistApiRequest } from './workspace';

const ACTIVE_INTERVAL = 2500;
const IDLE_INTERVAL = 15_000;
const REQUEST_TIMEOUT = 5000;

export function useXiaozhuActivity(workspaceId: string | undefined, scope: string, enabled: boolean) {
  const [snapshot, setSnapshot] = React.useState<{ scope: string; items: AgentTaskActivity[] }>();
  const path = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) + '/personal-agent/activity' : '';
  React.useEffect(() => {
    if (!enabled || !path) {
      setSnapshot(undefined);
      return;
    }
    let live = true;
    let timer: number | undefined;
    let request: AbortController | undefined;
    let recheck = false;
    const refresh = async () => {
      window.clearTimeout(timer);
      if (!live || document.hidden || !navigator.onLine || request) return;
      const controller = new AbortController();
      request = controller;
      let next = IDLE_INTERVAL;
      try {
        const { items } = await withRequestDeadline(controller, REQUEST_TIMEOUT, '小竹状态读取超时', signal =>
          mistApiRequest(path, { signal, cache: 'no-store' }) as Promise<{ items: AgentTaskActivity[] }>);
        if (!live || controller.signal.aborted) return;
        if (!Array.isArray(items)) throw Error('小竹状态响应无效');
        setSnapshot({ scope, items });
        if (items.length) next = ACTIVE_INTERVAL;
      } catch {
        // Without a recent authorized response, an old step is no longer live.
        if (live && !document.hidden) setSnapshot(undefined);
      } finally {
        request = undefined;
        if (live && !document.hidden && navigator.onLine) timer = window.setTimeout(() => void refresh(), recheck ? 0 : next);
        recheck = false;
      }
    };
    const update = () => {
      if (document.hidden || !navigator.onLine) return;
      if (request) recheck = true;
      else void refresh();
    };
    const suspend = () => {
      window.clearTimeout(timer);
      recheck = false;
      request?.abort();
      setSnapshot(undefined);
    };
    const wake = () => {
      if (document.hidden) suspend();
      else update();
    };
    window.addEventListener('bambook:agent-task-update', update);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('offline', suspend);
    window.addEventListener('online', update);
    void refresh();
    return () => {
      live = false;
      window.clearTimeout(timer);
      request?.abort();
      window.removeEventListener('bambook:agent-task-update', update);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('offline', suspend);
      window.removeEventListener('online', update);
    };
  }, [path, scope, enabled]);
  return enabled && snapshot?.scope === scope ? snapshot.items : [];
}

export function activeModelFallbackSince(task: Pick<AgentTaskView, 'state' | 'executionStage' | 'runnerStatus' | 'modelFallbackSince'>) {
  const since = task.modelFallbackSince;
  if (task.state === 'running' && task.executionStage === 'model' && !task.runnerStatus
    && typeof since === 'string' && Number.isFinite(Date.parse(since))) return since;
}

export function xiaozhuActivityLabel(task: AgentTaskActivity) {
  if (task.runnerStatus === 'heartbeat_stale') return '执行进度暂未更新';
  if (task.runnerStatus === 'awaiting_reclaim') return '待重新领取';
  if (task.retrying) return '等待模型重试';
  if (task.state === 'queued') return '待执行';
  if (task.executionStage === 'model') return activeModelFallbackSince(task) ? '正在等待备用模型' : '正在等待模型';
  return task.currentStep || '办理中';
}


export function xiaozhuModelWaitLabel(task: AgentTaskView): string | undefined {
  if (task.state === 'queued' && task.executionIssue?.retryAt) {
    return task.executionIssue.code === 'model_timeout' ? '模型响应超时，等待重试' : '等待模型重试';
  }
  if (task.state !== 'running' || task.executionStage !== 'model') return;
  if (activeModelFallbackSince(task)) return '正在等待备用模型';
  return task.executionIssue?.code === 'model_timeout' ? '正在重试模型' : '正在等待模型';
}
