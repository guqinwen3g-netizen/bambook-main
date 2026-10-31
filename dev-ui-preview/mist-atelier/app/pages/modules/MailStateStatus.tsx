import React from 'react';
import { Button, Pill } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import { useMistSession } from '../../runtime/auth';
import { mistApiRequest, useMistWorkspace } from '../../runtime/workspace';
import type { EmailMessage } from '../../../../../server/src/shared/mistEmail';
import type { MailStateView } from '../../../../../server/src/shared/mistMailState';

export function MailStateStatus({ message, locked, retry }: { message: EmailMessage; locked: boolean; retry: (acceptRemote: boolean) => Promise<unknown> }) {
  const session = useMistSession(), { workspace } = useMistWorkspace();
  const enabled = !message.example && !!message.remote && !!workspace?.id;
  const scope = `${session.sessionKey}:${workspace?.id}:${message.id}`;
  const current = React.useRef(scope); current.current = scope;
  const serial = React.useRef(0), abort = React.useRef<AbortController | null>(null);
  const [status, setStatus] = React.useState<{ scope: string; row?: MailStateView; available: boolean; error: string; loaded: boolean }>({ scope, available: true, error: '', loaded: false });
  const load = React.useCallback(async () => {
    if (!enabled) return;
    const request = ++serial.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    try {
      const result = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(workspace!.id)}/email/states`, { signal: controller.signal });
      if (!Array.isArray(result.items) || typeof result.serviceAvailable !== 'boolean') throw Error('邮箱同步状态无效');
      if (current.current === scope && request === serial.current && !controller.signal.aborted) setStatus({ scope, row: result.items.find((r: MailStateView) => r.messageId === message.id), available: result.serviceAvailable, error: '', loaded: true });
    } catch (e) {
      if (current.current === scope && request === serial.current && !controller.signal.aborted) setStatus(previous => ({ ...previous, scope, error: '无法核对原邮箱同步状态', loaded: true }));
    }
  }, [enabled, scope, workspace?.id, message.id]);
  React.useEffect(() => {
    void load(); const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 5000);
    return () => { serial.current++; clearInterval(timer); abort.current?.abort(); };
  }, [load, workspace?.revision]);
  if (!enabled) return null;
  const view = status.scope === scope ? status : undefined, row = view?.row;
  const label = view?.error ? '状态待核对' : !view?.loaded ? '正在核对原邮箱' : row ? !view.available ? '等待同步服务' : ({ pending: '待同步原邮箱', running: '同步原邮箱中', failed: '原邮箱同步失败', unknown: '移动结果待核对', blocked: '同步已暂停' } as const)[row.state]
    : message.remoteMissing ? '原邮箱中未找到' : message.remoteState ? '原邮箱已同步' : '原邮箱状态未核对';
  const warning = !!view?.error || !!row?.error || !!message.remoteMissing;
  return <div className="mist-col" data-gap="sm">
    <div className="mist-row" data-wrap><Pill tone={warning ? 'warn' : 'neutral'}>{uiText(label)}</Pill>
      {row?.canRetry && <><Button size="sm" disabled={locked} onClick={() => void retry(false).then(load)}>{uiText('重试同步')}</Button><Button size="sm" variant="quiet" disabled={locked} onClick={() => void retry(true).then(load)}>{uiText('以原邮箱为准')}</Button></>}
      {view?.error && <Button size="sm" disabled={locked} onClick={() => void load()}>{uiText('核对状态')}</Button>}
    </div>
    {(view?.error || row?.error || message.remoteMissing) && <span className="mist-note" data-tone="warn">{uiText(view?.error || row?.error || '已保留本地副本，请核对原邮箱')}</span>}
  </div>;
}
