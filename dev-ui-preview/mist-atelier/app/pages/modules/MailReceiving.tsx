import React from 'react';
import { Banner, Button, Pill, Switch } from '../../../../../components/mist';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { useMistSession } from '../../runtime/auth';
import { mistApiRequest, useMistWorkspace } from '../../runtime/workspace';
import type { EmailAccount } from '../../../../../server/src/shared/mistEmail';
import type { MailReceivingPage, MailReceivingView } from '../../../../../server/src/shared/mistMailReceiving';

type Plan = { accountId: string; enabled: boolean; version: number; sourceGeneration: number; requestId: string };
const empty = (): MailReceivingPage => ({ serviceAvailable: false, items: [] });
const labels: Record<MailReceivingView['state'], string> = { off: '已关闭', waiting: '等待收件', running: '收件中', retrying: '稍后重试', blocked: '需要重新开启' };
const time = (value: string) => new Date(value).toLocaleString(interfaceLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function useMailReceiving(accounts: EmailAccount[]) {
  const session = useMistSession(), { workspace } = useMistWorkspace();
  const workspaceId = workspace?.id, scope = session.sessionKey + ':' + (workspaceId ?? '');
  const signature = JSON.stringify(accounts.filter(a => !a.example).map(a => [a.id, a.ownerId, a.sourceGeneration, a.credentialSet]));
  const [page, setPage] = React.useState<MailReceivingPage>(empty), [error, setError] = React.useState('');
  const [pending, setPending] = React.useState<Plan | null>(null), [busy, setBusy] = React.useState(false);
  const live = React.useRef(scope), mounted = React.useRef(false), reads = React.useRef(0), writes = React.useRef(0);
  const readAbort = React.useRef<AbortController | null>(null), writeAbort = React.useRef<AbortController | null>(null), pendingRef = React.useRef(pending);
  const readFailure = React.useRef(false);
  live.current = scope; pendingRef.current = pending;
  const load = React.useCallback(async () => {
    if (!workspaceId) return;
    const serial = ++reads.current, abort = new AbortController(); readAbort.current?.abort(); readAbort.current = abort;
    try {
      const result = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(workspaceId)}/email/receiving`, { signal: abort.signal });
      if (!Array.isArray(result.items) || typeof result.serviceAvailable !== 'boolean') throw new Error('收件状态响应无效');
      if (!mounted.current || live.current !== scope || serial !== reads.current) return;
      setPage(result);
      const plan = pendingRef.current;
      if (!plan && readFailure.current) { readFailure.current = false; setError(''); }
      if (plan && result.items.some((item: MailReceivingView) => item.accountId === plan.accountId && item.lastChangeId === plan.requestId)) { setPending(null); setError(''); }
    } catch (failure) {
      if (mounted.current && live.current === scope && serial === reads.current && !abort.signal.aborted) { readFailure.current = true; setError(failure instanceof Error ? failure.message : '收件状态读取失败'); }
    }
  }, [scope, workspaceId]);
  React.useEffect(() => {
    mounted.current = true; setPage(empty()); setPending(null); setBusy(false); setError(''); void load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 15_000);
    return () => { mounted.current = false; reads.current++; writes.current++; clearInterval(timer); readAbort.current?.abort(); writeAbort.current?.abort(); };
  }, [load, signature]);
  const submit = async (plan: Plan) => {
    if (!workspaceId || busy) return;
    const serial = ++writes.current, abort = new AbortController(); writeAbort.current = abort;
    readFailure.current = false; setPending(plan); setBusy(true); setError('');
    try {
      const result = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(workspaceId)}/email/accounts/${encodeURIComponent(plan.accountId)}/receiving`, { method: 'PUT', signal: abort.signal, body: JSON.stringify({ enabled: plan.enabled, version: plan.version, sourceGeneration: plan.sourceGeneration, requestId: plan.requestId }) });
      if (result.item?.accountId !== plan.accountId || result.item?.lastChangeId !== plan.requestId) throw new Error('收件设置响应无效，请核对状态');
      if (!mounted.current || live.current !== scope || serial !== writes.current) return;
      setPage(previous => ({ ...previous, items: [...previous.items.filter(item => item.accountId !== plan.accountId), result.item] }));
      setPending(null); void load();
    } catch (failure) {
      if (mounted.current && live.current === scope && serial === writes.current && !abort.signal.aborted) {
        const known = Number((failure as any)?.status) >= 400 && Number((failure as any)?.status) < 500;
        if (known) setPending(null);
        setError(known && failure instanceof Error ? failure.message : '自动收件设置结果待核对');
        void load();
      }
    } finally { if (mounted.current && live.current === scope && serial === writes.current) setBusy(false); }
  };
  return { page, error, pending, busy, available: !!workspaceId, refresh: load, retry: () => pending && submit(pending),
    toggle: (account: EmailAccount, enabled: boolean) => { const item = page.items.find(r => r.accountId === account.id); if (item) void submit({ accountId: account.id, enabled, version: item.version, sourceGeneration: account.sourceGeneration || 1, requestId: crypto.randomUUID() }); } };
}

export function MailReceivingNotice({ control }: { control: ReturnType<typeof useMailReceiving> }) {
  return control.error ? <Banner tone="warn" title={uiText(control.error)} actions={<><Button size="sm" disabled={control.busy} onClick={() => void control.refresh()}>{uiText('核对状态')}</Button>{control.pending && <Button size="sm" disabled={control.busy} onClick={() => void control.retry()}>{uiText('重试')}</Button>}</>} /> : null;
}
export function MailReceivingControl({ account, control, locked }: { account: EmailAccount; control: ReturnType<typeof useMailReceiving>; locked: boolean }) {
  if (!control.available || account.example) return null;
  const row = control.page.items.find(r => r.accountId === account.id), pending = control.pending?.accountId === account.id;
  const disabled = locked || control.busy || !!control.pending || !row || (row.enabled ? !row.canDisable : !row.canEnable || !control.page.serviceAvailable);
  return <div className="mist-col" data-gap="sm">
    <div className="mist-row" data-wrap><span>{uiText('自动收件')}</span><Switch ariaLabel={account.displayName + ' ' + uiText('自动收件')} checked={row?.enabled ?? false} disabled={disabled} onChange={enabled => control.toggle(account, enabled)} /><Pill tone={row?.state === 'blocked' || row?.state === 'retrying' ? 'warn' : 'neutral'}>{uiText(pending ? '待核对' : !row ? '正在读取' : !control.page.serviceAvailable ? '收件服务未运行' : labels[row.state])}</Pill></div>
    {row?.lastSuccessAt && <span className="mist-note">{uiText('最近收件')} {time(row.lastSuccessAt)}{row.pending ? ` · ${uiText('待收取')} ${row.pending}` : ''}</span>}
    {row?.error && <span className="mist-note" data-tone="warn">{uiText(row.error.message)}</span>}
    {!account.credentialSet && <span className="mist-note">{uiText('请先绑定邮箱凭据')}</span>}
  </div>;
}
