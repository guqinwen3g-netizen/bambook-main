import React from 'react';
import { Mail } from 'lucide-react';
import { Button } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import type { EmailAccount, EmailOAuthProvider } from '../../../../../server/src/shared/mistEmail';
import { mistApiRequest, useMistWorkspace, type MistMailAction, type MistMailResult } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';

type DesktopMail = {
  prepare(provider: EmailOAuthProvider): Promise<{ id: string; port: number }>;
  open(id: string, url: string): Promise<void>; finish(id: string): Promise<void>; cancel(id: string): Promise<void>;
};
const desktopWindow = () => window as Window & { bambook?: { versions?: { electron?: string } }; bambookMailOAuth?: DesktopMail };
type Provider = { provider: EmailOAuthProvider; available: boolean; reason: string };
const LABELS = { google: '连接 Gmail', microsoft: '连接 Outlook' } as const;
/** The only place that leaves the app for a provider page. */
export const mailOAuthNavigation = { leave: (url: string) => window.location.assign(url) };
export function mailOAuthProvider(account: EmailAccount): EmailOAuthProvider | undefined {
  if (account.oauth) return account.oauth.provider;
  const host = account.transport?.imapHost.trim().toLowerCase();
  if (host === 'imap.gmail.com' || host === 'imap.googlemail.com') return 'google';
  if (host === 'outlook.office365.com' || host === 'imap-mail.outlook.com') return 'microsoft';
  return undefined;
}
export function mailOAuthOutcome(): { status: 'connected' | 'cancelled' | 'failed'; accountId: string; message: string } | null {
  const query = new URLSearchParams(window.location.search), status = query.get('mailConnect');
  if (status !== 'connected' && status !== 'cancelled' && status !== 'failed') return null;
  const messages: Record<string, string> = {
    MAIL_OAUTH_STATE_INVALID: '连接已过期或登录已变化，请重新连接', MAIL_OAUTH_SCOPE_MISSING: '收信或发信权限未授权，请重新连接',
    MAIL_OAUTH_IDENTITY_INVALID: '邮箱身份验证失败，请重新连接', MAIL_OAUTH_ADDRESS_MISMATCH: '授权的邮箱与当前邮箱不一致，请选择原邮箱',
    MAIL_OAUTH_RECONNECT: '邮箱授权已失效，请重新连接', MAIL_HOST_NOT_ALLOWED: '邮箱服务商连接受限，请联系平台管理员', FORBIDDEN: '当前账号无权连接此邮箱',
  };
  return { status, accountId: query.get('mailAccount') || '', message: status === 'cancelled' ? '已取消邮箱连接' : status === 'failed' ? messages[query.get('mailConnectCode') || ''] || '邮箱连接未完成，请重试' : '' };
}
export function clearMailOAuthOutcome() {
  const url = new URL(window.location.href); for (const key of ['mailConnect', 'mailConnectCode', 'mailAccount']) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
export function useMailOAuth(can: boolean, mail: (action: MistMailAction) => Promise<MistMailResult>, beforeConnect: () => void) {
  const { workspace } = useMistWorkspace(), session = useMistSession(), workspaceId = workspace?.id;
  const scope = session.sessionKey + ':' + workspaceId, live = React.useRef(scope); live.current = scope;
  const [providers, setProviders] = React.useState<Provider[]>([]), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(false), [busy, setBusy] = React.useState(false);
  const active = React.useRef<AbortController | null>(null), keepDraft = React.useRef(beforeConnect);
  keepDraft.current = beforeConnect;
  React.useEffect(() => { setBusy(false); return () => { active.current?.abort(); active.current = null; }; }, [scope, can]);
  const request = React.useRef(0), mounted = React.useRef(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);
  const load = React.useCallback(async (signal?: AbortSignal) => {
    if (!can || !workspaceId) return;
    const serial = ++request.current; setLoading(true); setError('');
    try {
      const result = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(workspaceId)}/email/oauth`, { signal }) as { providers?: Provider[] };
      if (signal?.aborted || live.current !== scope || serial !== request.current) return;
      if (!Array.isArray(result.providers)) throw new Error('无法读取邮箱连接设置');
      setProviders(result.providers.filter(p => ['google', 'microsoft'].includes(p.provider) && typeof p.available === 'boolean'));
    } catch (failure) { if (!signal?.aborted && live.current === scope && serial === request.current) setError(failure instanceof Error ? failure.message : '无法读取邮箱连接设置'); }
    finally { if (!signal?.aborted && live.current === scope && serial === request.current) setLoading(false); }
  }, [can, workspaceId, scope]);
  React.useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [load]);
  const needsUpdate = !!desktopWindow().bambook?.versions?.electron && !desktopWindow().bambookMailOAuth;
  const reason = (provider: EmailOAuthProvider) => needsUpdate ? '请更新 Bambook 桌面版或在网页版连接邮箱' : !can ? '需要邮件权限' : loading ? '正在读取邮箱连接设置' : error ? '无法读取邮箱连接设置' : providers.find(p => p.provider === provider)?.available ? '' : providers.find(p => p.provider === provider)?.reason || '平台尚未配置邮箱连接';
  const connect = async (provider: EmailOAuthProvider, accountId?: string) => {
    if (active.current) return;
    const blocked = reason(provider); if (blocked) throw new Error(blocked);
    const controller = new AbortController(); active.current = controller; setBusy(true);
    const desktop = desktopWindow().bambookMailOAuth;
    const current = () => !controller.signal.aborted && mounted.current && live.current === scope;
    let ticket: { id: string; port: number } | undefined;
    const cancel = () => { if (desktop && ticket) void desktop.cancel(ticket.id).catch(() => undefined); };
    try {
      if (desktop) {
        ticket = await desktop.prepare(provider);
        if (!current()) return;
        controller.signal.addEventListener('abort', cancel, { once: true });
      }
      const result = await mail({ kind: 'oauthStart', provider, ...(ticket ? { desktopPort: ticket.port } : {}), ...(accountId ? { accountId } : {}) });
      if (!current()) return;
      let url: URL;
      try { url = new URL(result.oauth?.authorizationUrl || ''); } catch { throw new Error('邮箱授权地址无效'); }
      const expected = provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
      if (url.username || url.password || url.origin + url.pathname !== expected) throw new Error('邮箱授权地址无效');
      if (desktop && ticket) {
        await desktop.open(ticket.id, url.toString());
        if (!current()) return;
        keepDraft.current(); await desktop.finish(ticket.id);
      } else { keepDraft.current(); mailOAuthNavigation.leave(url.toString()); }
    } catch (failure) { if (current()) throw failure; }
    finally { controller.signal.removeEventListener('abort', cancel); cancel(); if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false); } }
  };
  return { reason, connect, loading, busy, error, retry: () => void load() };
}
export function MailOAuthChoices({ control, locked, connect }: { control: ReturnType<typeof useMailOAuth>; locked: boolean; connect: (provider: EmailOAuthProvider) => void }) {
  const reasons = [...new Set((['google', 'microsoft'] as const).map(provider => control.reason(provider)).filter(Boolean))];
  return <div className="mist-col" style={{ gap: 10 }}>
    <div className="mist-row" style={{ flexWrap: 'wrap', gap: 10 }}>{(['google', 'microsoft'] as const).map(provider =>
      <Button key={provider} variant="primary" icon={Mail} disabled={locked || control.busy || !!control.reason(provider)} loading={control.loading} onClick={() => connect(provider)}>{uiText(LABELS[provider])}</Button>)}</div>
    {control.error ? <div className="mist-row" style={{ flexWrap: 'wrap', gap: 8 }}><span className="mist-note" data-tone="bad">{uiText(control.error)}</span><Button size="sm" onClick={control.retry}>{uiText('重试')}</Button></div>
      : !control.loading && reasons.map(reason => <span key={reason} className="mist-note">{uiText(reason)}</span>)}
  </div>;
}
