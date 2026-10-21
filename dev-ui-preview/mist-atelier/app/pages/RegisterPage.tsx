/**
 * 注册（登录页「立即注册」，2026-10-21 用户定案）：两条路径，均需邮箱验证码。
 * - 创建公司：同时注册该公司的管理员账号，创建后即可登录。
 * - 加入公司：凭公司代码提交申请，由该公司管理员在「公司后台 › 账号」审核通过后才能登录。
 */
import React from 'react';
import { ArrowLeft, ArrowRight, Building2, Hash, KeyRound, Mail, User, UserPlus } from 'lucide-react';
import { BAMBOOK_BRAND } from '../../../../server/src/shared/brand';
import { Banner, Button, CardButton, Field, Icon, MistMark, MistWordmark, Mono, PasswordInput, TextInput, TextLink } from '../../../../components/mist';
import { useNav } from '../nav';
import { registerCompany, registerJoinCompany, sendVerificationCode } from '../../../../services/authService';

type Mode = 'choose' | 'company' | 'join';
type Done = { mode: 'company'; name: string; code: string; email: string } | { mode: 'join'; name: string; email: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errorText = (e: unknown, fallback: string) => e instanceof Error && e.message ? e.message : fallback;
/** 与服务端一致：至少 12 个字符、含字母和数字、不超过 72 字节。 */
const weakPassword = (value: string) => value.length < 12 || new TextEncoder().encode(value).length > 72 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value);

export function RegisterPage() {
  const { go } = useNav();
  const [mode, setMode] = React.useState<Mode>('choose');
  const [companyName, setCompanyName] = React.useState(''), [companyCode, setCompanyCode] = React.useState('');
  const [displayName, setDisplayName] = React.useState(''), [email, setEmail] = React.useState(''), [code, setCode] = React.useState(''), [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false), [sending, setSending] = React.useState(false), [cooldown, setCooldown] = React.useState(0);
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [done, setDone] = React.useState<Done | null>(null);
  const timer = React.useRef<number | undefined>(undefined), mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearInterval(timer.current); }; }, []);

  const pick = (next: Mode) => { setMode(next); setError(''); setNotice(''); };
  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setCooldown(value => { if (value <= 1) { window.clearInterval(timer.current); return 0; } return value - 1; }), 1000);
  };
  const sendCode = async () => {
    if (sending || cooldown > 0) return;
    if (!EMAIL.test(email.trim())) { setError('请先填写正确的工作邮箱。'); return; }
    setSending(true); setError(''); setNotice('');
    try {
      const result = await sendVerificationCode(email.trim(), 'register');
      if (!mounted.current) return;
      setNotice(`验证码已发送到 ${email.trim()}，请查收邮件（也可能在垃圾邮件中）。`);
      startCooldown(Math.max(1, Math.round((result.cooldownMs || 60000) / 1000)));
    } catch (e: any) {
      if (!mounted.current) return;
      setError(errorText(e, '验证码发送失败，请稍后重试。'));
      if (typeof e?.retryAfterMs === 'number' && e.retryAfterMs > 0) startCooldown(Math.ceil(e.retryAfterMs / 1000));
    } finally { if (mounted.current) setSending(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const missing = mode === 'company' && companyName.trim().length < 2 ? '请填写公司名称。'
      : mode === 'join' && !companyCode.trim() ? '请填写公司代码。'
      : !displayName.trim() ? '请填写你的姓名。'
      : !EMAIL.test(email.trim()) ? '请填写正确的工作邮箱。'
      : !code.trim() ? '请填写邮箱验证码。'
      : weakPassword(password) ? '密码须包含字母和数字，至少 12 个字符。' : '';
    if (missing) { setError(missing); return; }
    setBusy(true); setError(''); setNotice('');
    const account = { displayName: displayName.trim(), email: email.trim(), password, code: code.trim() };
    try {
      if (mode === 'company') {
        const result = await registerCompany({ ...account, companyName: companyName.trim() });
        if (mounted.current) setDone({ mode: 'company', name: result.company.name, code: result.company.code, email: result.email });
      } else {
        const result = await registerJoinCompany({ ...account, companyCode: companyCode.trim() });
        if (mounted.current) setDone({ mode: 'join', name: result.company.name, email: result.email });
      }
      if (mounted.current) setPassword('');
    } catch (e) { if (mounted.current) setError(errorText(e, '注册未完成，请稍后重试。')); }
    finally { if (mounted.current) setBusy(false); }
  };

  const backToLogin = <p className="mist-auth-switch">已有账号？<TextLink disabled={busy} onClick={() => go('login')}>返回登录</TextLink></p>;
  const body = done ? (done.mode === 'company' ? <>
    <h2 className="mist-h1 mist-auth-title">公司已创建</h2>
    <p className="mist-sub">「{done.name}」已开通，你是公司管理员。登录后可在公司后台邀请同事、设置岗位权限。</p>
    <div className="mist-register-code"><span>公司代码</span><Mono>{done.code}</Mono><span>同事注册时选择「加入公司」并填写这个代码；之后也可在「设置 › 公司资料」查看。</span></div>
    <Button variant="primary" size="lg" block iconRight={ArrowRight} onClick={() => go('login', done.email)}>登录</Button>
  </> : <>
    <h2 className="mist-h1 mist-auth-title">申请已提交</h2>
    <p className="mist-sub">已向「{done.name}」提交加入申请。公司管理员审核通过后，用 {done.email} 登录即可。</p>
    <Button variant="primary" size="lg" block onClick={() => go('login', done.email)}>返回登录</Button>
  </>) : mode === 'choose' ? <>
    <h2 className="mist-h1 mist-auth-title">注册</h2>
    <p className="mist-sub">按你的情况选择一种方式。</p>
    <CardButton className="mist-register-option" onClick={() => pick('company')}>
      <Icon icon={Building2} /><span><b>创建公司</b><span>首次使用竹衍。创建公司，你将成为公司管理员，之后邀请同事加入。</span></span><Icon icon={ArrowRight} size="sm" />
    </CardButton>
    <CardButton className="mist-register-option" onClick={() => pick('join')}>
      <Icon icon={UserPlus} /><span><b>加入公司</b><span>公司已在使用竹衍。填写公司代码提交申请，公司管理员审核通过后即可登录。</span></span><Icon icon={ArrowRight} size="sm" />
    </CardButton>
    {backToLogin}
  </> : <>
    <TextLink disabled={busy} onClick={() => pick('choose')}><Icon icon={ArrowLeft} size="xs" /> 返回选择</TextLink>
    <h2 className="mist-h1 mist-auth-title">{mode === 'company' ? '创建公司' : '加入公司'}</h2>
    <p className="mist-sub">{mode === 'company' ? '填写公司名称和你的账号信息。创建后你就是这家公司的管理员。' : '向公司管理员索取公司代码。提交后由公司管理员审核，通过后即可登录。'}</p>
    {error && <Banner tone="bad" title={error} />}
    {notice && !error && <Banner tone="ok" title={notice} />}
    {mode === 'company'
      ? <Field label="公司名称"><TextInput icon={Building2} value={companyName} maxLength={60} placeholder="例如：雾织贸易" disabled={busy} onChange={e => setCompanyName(e.target.value)} /></Field>
      : <Field label="公司代码" hint="公司管理员可在「设置 › 公司资料」查看。"><TextInput icon={Hash} value={companyCode} maxLength={50} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} onChange={e => setCompanyCode(e.target.value)} /></Field>}
    <Field label="你的姓名"><TextInput icon={User} value={displayName} maxLength={40} autoComplete="name" disabled={busy} onChange={e => setDisplayName(e.target.value)} /></Field>
    <Field label="工作邮箱"><TextInput icon={Mail} type="email" value={email} autoComplete="email" disabled={busy} onChange={e => setEmail(e.target.value)} /></Field>
    <Field label="邮箱验证码">
      <span className="mist-register-code-row">
        <TextInput value={code} maxLength={8} inputMode="numeric" autoComplete="one-time-code" disabled={busy} onChange={e => setCode(e.target.value)} />
        <Button loading={sending} disabled={busy || sending || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码'}</Button>
      </span>
    </Field>
    <Field label="设置密码" hint="至少 12 位，包含字母和数字。"><PasswordInput icon={KeyRound} value={password} maxLength={72} autoComplete="new-password" disabled={busy} onChange={e => setPassword(e.target.value)} /></Field>
    <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy} iconRight={busy ? undefined : ArrowRight}>{mode === 'company' ? '创建公司' : '提交加入申请'}</Button>
    {backToLogin}
  </>;

  return (
    <div className="mist-auth">
      <div className="mist-auth-brand">
        <MistMark className="mist-hero-ring" />
        <div className="mist-brand" style={{ padding: 0 }}><MistMark /><MistWordmark /></div>
        <div className="mist-auth-brand-copy"><h1 className="mist-h1">{BAMBOOK_BRAND.headline[0]}<br />{BAMBOOK_BRAND.headline[1]}</h1><p>{BAMBOOK_BRAND.name} · {BAMBOOK_BRAND.description}</p></div>
      </div>
      <div className="mist-auth-panel">
        <form className="mist-auth-form" aria-label="注册" onSubmit={submit} noValidate>{body}</form>
      </div>
    </div>
  );
}
