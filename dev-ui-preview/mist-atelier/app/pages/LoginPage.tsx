/**
 * T12 登录模板 —— 对应：Login.tsx / Register.tsx。左侧品牌（雾蓝 shell + 标志），右侧画布表单。
 */
import React from 'react';
import { BAMBOOK_BRAND } from '../../../../server/src/shared/brand';
import { ArrowRight, KeyRound, Mail } from 'lucide-react';
import { Button, Checkbox, Field, MistMark, MistWordmark, PasswordInput, TextInput, TextLink, useToast } from '../../../../components/mist';
import { useNav } from '../nav';
import { useMistSession } from '../runtime/auth';
import { mapAuthErrorMessage } from '../../../../services/authService';

export function LoginPage() {
  const { go, route } = useNav();
  const toast = useToast();
  const session = useMistSession();
  // 注册完成后带回邮箱（route.id），免得重新输入。
  const [email, setEmail] = React.useState(() => typeof route?.id === 'string' && route.id.includes('@') ? route.id : '');
  const [pw, setPw] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const busy = session.signingIn;
  const [cooldown, setCooldown] = React.useState(0);
  const cooldownTimer = React.useRef<number | undefined>(undefined);
  const mounted = React.useRef(true);
  const submitting = React.useRef(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearInterval(cooldownTimer.current); }; }, []);
  const [err, setErr] = React.useState('');
  // 同一账号属于多家公司时，先让用户选择本次进入哪一家。
  const [companies, setCompanies] = React.useState<Array<{ id: string; name: string; slug: string; jobTitle?: string | null }>>([]);
  const backToPassword = () => { setCompanies([]); setErr(''); session.clearError(); };
  const doLogin = async (companyId?: string) => {
    if (submitting.current || busy) return;
    submitting.current = true; setErr(''); session.clearError();
    try {
      const user = await session.login(email.trim(), pw, {
        remember,
        ...(companyId ? { companyId } : {}),
      });
      if (mounted.current) { setPw(''); setCompanies([]); go(user.platformRole === 'platform_admin' && !user.roleIds?.length ? 'platform-admin' : 'cockpit'); toast(`欢迎回来，${user.displayName || user.email}`); }
    } catch (failure: any) {
      if (!mounted.current) return;
      if (failure?.code === 'COMPANY_SELECTION_REQUIRED' && Array.isArray(failure.companies)) {
        setCompanies(failure.companies); setErr(''); return;
      }
      setPw('');
      setErr(mapAuthErrorMessage(failure, '登录失败，请稍后重试'));
      if (typeof failure?.retryAfterMs === 'number' && failure.retryAfterMs > 0) {
        setCooldown(Math.max(1, Math.ceil(failure.retryAfterMs / 1000)));
        window.clearInterval(cooldownTimer.current);
        cooldownTimer.current = window.setInterval(() => setCooldown(value => {
          if (value <= 1) { window.clearInterval(cooldownTimer.current); return 0; }
          return value - 1;
        }), 1000);
      }
    } finally { submitting.current = false; }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || busy || cooldown > 0 || session.status === 'loading') return;
    if (!email.trim()) { setErr('请输入工作邮箱'); return; }
    if (!pw) { setErr('请输入密码'); return; }
    await doLogin();
  };
  const shownError = err || session.error;
  const errorNode = shownError ? <span id="mist-login-error" role="alert">{shownError}</span> : undefined;
  return (
    <div className="mist-auth">
      <div className="mist-auth-brand">
        <MistMark className="mist-hero-ring" />
        <div className="mist-brand" style={{ padding: 0 }}><MistMark /><MistWordmark /></div>
        <div style={{ marginTop: 'auto', maxWidth: 520 }}>
          <h1 className="mist-h1" style={{ fontSize: 44, color: 'var(--mist-on-media)' }}>{BAMBOOK_BRAND.headline[0]}<br />{BAMBOOK_BRAND.headline[1]}</h1>
          <p style={{ marginTop: 14, color: 'rgba(255,255,255,.84)', fontSize: 15 }}>{BAMBOOK_BRAND.name} · {BAMBOOK_BRAND.description}</p>
        </div>
      </div>
      <div className="mist-auth-panel">
        <form className="mist-auth-form" aria-label="登录" onSubmit={submit}>
          {companies.length > 0 ? (<>
            <div><h2 className="mist-h1" style={{ fontSize: 28 }}>选择公司</h2><p className="mist-sub" style={{ marginTop: 6 }}>这个账号属于多家公司，选择这次要进入的一家。</p></div>
            <div style={{ display: 'grid', gap: 8 }}>
              {companies.map(company => (
                <Button key={company.id} size="lg" block onClick={() => void doLogin(company.id)} disabled={busy} iconRight={busy ? undefined : ArrowRight}>
                  {company.name}
                </Button>
              ))}
            </div>
            <div className="mist-row"><TextLink onClick={backToPassword} disabled={busy}>返回重新登录</TextLink></div>
          </>) : (<>
          <div><h2 className="mist-h1" style={{ fontSize: 28 }}>登录</h2></div>
          <Field label="工作邮箱"><TextInput icon={Mail} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required /></Field>
          <Field label="密码" error={errorNode}><PasswordInput icon={KeyRound} autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} placeholder="输入密码" disabled={busy} aria-invalid={!!(err || session.error)} aria-describedby={err || session.error ? "mist-login-error" : undefined} /></Field>
          <div className="mist-row"><Checkbox checked={remember} onChange={setRemember} disabled={busy} label="保持登录" /><span className="mist-spacer" /><TextLink disabled={busy} title="查看密码找回方式" onClick={()=>go('platform-recovery')}>忘记密码？</TextLink></div>
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || cooldown > 0 || session.status === 'loading'} iconRight={busy ? undefined : ArrowRight}>{cooldown > 0 ? `请稍候 ${cooldown}s` : '登录'}</Button>
          <p className="mist-auth-switch">还没有账号？<TextLink disabled={busy} onClick={() => go('register')}>立即注册</TextLink></p>
          </>)}
        </form>
      </div>
    </div>
  );
}
