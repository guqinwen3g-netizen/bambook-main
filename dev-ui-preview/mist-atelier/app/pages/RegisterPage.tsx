/**
 * 注册：创建公司（公司信息 → 管理员账号 → 验证邮箱，完成后直接进入）或
 * 加入公司（搜索选择公司 → 你的账号 → 验证邮箱，管理员同意后可登录）。
 */
import React from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, Hash, KeyRound, Mail, Search, User, UserPlus } from 'lucide-react';
import { BAMBOOK_BRAND } from '../../../../server/src/shared/brand';
import { Banner, Button, CardButton, CodeInput, Field, Icon, MistMark, MistWordmark, PasswordInput, Segmented, TextInput, TextLink, useToast } from '../../../../components/mist';
import { useNav } from '../nav';
import { useMistSession } from '../runtime/auth';
import { passwordChecks, passwordOk } from '../runtime/passwordRule';
import { registerCompany, registerJoinCompany, searchRegistrationCompanies, sendVerificationCode, type CompanyBusiness, type CompanySearchResult, type CompanySize } from '../../../../services/authService';

type Mode = 'choose' | 'company' | 'join';
type Step = 'company' | 'find' | 'account' | 'verify';
const FLOW: Record<'company' | 'join', Step[]> = { company: ['company', 'account', 'verify'], join: ['find', 'account', 'verify'] };
const BUSINESS: Array<{ value: CompanyBusiness; label: string }> = [{ value: 'fabric', label: '面料' }, { value: 'garment', label: '成衣' }, { value: 'both', label: '面料与成衣' }];
const SIZE: Array<{ value: CompanySize; label: string }> = [{ value: '1-20', label: '1–20 人' }, { value: '21-100', label: '21–100 人' }, { value: '100+', label: '100 人以上' }];
const businessLabel = (value: CompanyBusiness | null) => BUSINESS.find(b => b.value === value)?.label;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sameName = (a: string, b: string) => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
const errorText = (e: unknown, fallback: string) => e instanceof Error && e.message ? e.message : fallback;

/** 输入停顿后搜索公司；空查询或不足 2 字时清空。 */
function useCompanySearch(query: string, enabled: boolean) {
  const [results, setResults] = React.useState<CompanySearchResult[]>([]), [loading, setLoading] = React.useState(false), [error, setError] = React.useState('');
  React.useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) { setResults([]); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchRegistrationCompanies(q, controller.signal)
        .then(rows => { setResults(rows); setError(''); })
        .catch(e => { if (!controller.signal.aborted) { setResults([]); setError(errorText(e, '暂时无法搜索公司')); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, enabled]);
  return { results, loading, error };
}

export function RegisterPage() {
  const { go } = useNav();
  const session = useMistSession();
  const toast = useToast();
  const [mode, setMode] = React.useState<Mode>('choose'), [step, setStep] = React.useState<Step>('company');
  const [companyName, setCompanyName] = React.useState(''), [business, setBusiness] = React.useState<CompanyBusiness | ''>(''), [size, setSize] = React.useState<CompanySize | ''>('');
  const [query, setQuery] = React.useState(''), [selected, setSelected] = React.useState<CompanySearchResult | null>(null), [useCode, setUseCode] = React.useState(false), [companyCode, setCompanyCode] = React.useState('');
  const [displayName, setDisplayName] = React.useState(''), [email, setEmail] = React.useState(''), [password, setPassword] = React.useState(''), [code, setCode] = React.useState('');
  const [sentTo, setSentTo] = React.useState(''), [cooldown, setCooldown] = React.useState(0);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [joined, setJoined] = React.useState<{ company: string; email: string } | null>(null), [created, setCreated] = React.useState<{ email: string } | null>(null);
  const timer = React.useRef<number | undefined>(undefined), mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearInterval(timer.current); }; }, []);

  const duplicate = useCompanySearch(companyName, mode === 'company' && step === 'company');
  const existing = duplicate.results.find(c => sameName(c.name, companyName.trim()));
  const search = useCompanySearch(query, mode === 'join' && step === 'find' && !useCode);

  const flow = mode === 'choose' ? [] : FLOW[mode];
  const open = (next: 'company' | 'join', first?: Step) => { setMode(next); setStep(first ?? FLOW[next][0]); setError(''); };
  const back = () => { setError(''); const index = flow.indexOf(step); if (index > 0) setStep(flow[index - 1]); else setMode('choose'); };
  const startCooldown = (seconds: number) => {
    setCooldown(seconds); window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setCooldown(v => { if (v <= 1) { window.clearInterval(timer.current); return 0; } return v - 1; }), 1000);
  };
  const sendCode = async () => {
    setBusy(true); setError('');
    try {
      const result = await sendVerificationCode(email.trim(), 'register');
      if (!mounted.current) return false;
      setSentTo(email.trim()); setCode(''); startCooldown(Math.max(1, Math.round((result.cooldownMs || 60000) / 1000)));
      return true;
    } catch (e: any) {
      if (mounted.current) { setError(errorText(e, '验证码发送失败，请稍后重试。')); if (typeof e?.retryAfterMs === 'number' && e.retryAfterMs > 0) startCooldown(Math.ceil(e.retryAfterMs / 1000)); }
      return false;
    } finally { if (mounted.current) setBusy(false); }
  };

  const next = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (step === 'company') {
      if (companyName.trim().length < 2) return setError('请填写公司名称');
      if (!business) return setError('请选择主营业务');
      return setStep('account');
    }
    if (step === 'find') {
      if (useCode ? !companyCode.trim() : !selected) return setError(useCode ? '请填写公司代码' : '请选择你的公司');
      return setStep('account');
    }
    if (step === 'account') {
      if (!displayName.trim()) return setError('请填写姓名');
      if (!EMAIL.test(email.trim())) return setError('邮箱格式不正确');
      if (!passwordOk(password)) return setError('密码未满足要求');
      if (sentTo === email.trim() && cooldown > 0) return setStep('verify');
      if (await sendCode()) setStep('verify');
      return;
    }
    if (code.length < 6) return setError('请输入 6 位验证码');
    await finish(code);
  };

  const finish = async (value: string) => {
    if (busy) return;
    setBusy(true); setError('');
    const account = { displayName: displayName.trim(), email: email.trim(), password, code: value };
    try {
      if (mode === 'company') {
        const result = await registerCompany({ ...account, companyName: companyName.trim(), business: business || undefined, size: size || undefined });
        try {
          const user = await session.login(result.email, password, { remember: true });
          if (mounted.current) { toast(`欢迎，${user.displayName || result.email}`); go('cockpit'); }
        } catch { if (mounted.current) setCreated({ email: result.email }); }
      } else {
        const result = await registerJoinCompany(useCode || !selected ? { ...account, companyCode: companyCode.trim() } : { ...account, companyId: selected.id });
        if (mounted.current) setJoined({ company: result.company.name, email: result.email });
      }
      if (mounted.current) setPassword('');
    } catch (e) { if (mounted.current) setError(errorText(e, '注册未完成，请稍后重试')); }
    finally { if (mounted.current) setBusy(false); }
  };

  const progress = flow.length ? <div className="mist-register-progress" aria-label={`第 ${flow.indexOf(step) + 1} 步，共 ${flow.length} 步`}>{flow.map((s, i) => <i key={s} data-on={i <= flow.indexOf(step) || undefined} />)}</div> : null;
  const login = <p className="mist-auth-switch">已有账号？<TextLink disabled={busy} onClick={() => go('login')}>登录</TextLink></p>;
  const backLink = <TextLink disabled={busy} onClick={back}><Icon icon={ArrowLeft} size="xs" /> 返回</TextLink>;
  const primary = (label: string) => <Button type="submit" variant="primary" size="lg" block loading={busy} iconRight={busy ? undefined : ArrowRight}>{label}</Button>;
  const alert = error ? <Banner tone="bad" title={error} /> : null;

  let body: React.ReactNode;
  if (joined) body = <>
    <h2 className="mist-h1 mist-auth-title">申请已发送</h2>
    <p className="mist-sub">「{joined.company}」的管理员同意后，即可用 {joined.email} 登录。</p>
    <Button variant="primary" size="lg" block onClick={() => go('login', joined.email)}>返回登录</Button>
  </>;
  else if (created) body = <>
    <h2 className="mist-h1 mist-auth-title">公司已创建</h2>
    <p className="mist-sub">用 {created.email} 登录即可开始使用。</p>
    <Button variant="primary" size="lg" block iconRight={ArrowRight} onClick={() => go('login', created.email)}>登录</Button>
  </>;
  else if (mode === 'choose') body = <>
    <h2 className="mist-h1 mist-auth-title">注册</h2>
    <CardButton className="mist-register-option" onClick={() => open('company')}><Icon icon={Building2} /><span><b>创建公司</b><span>首次使用竹衍</span></span><Icon icon={ArrowRight} size="sm" /></CardButton>
    <CardButton className="mist-register-option" onClick={() => open('join')}><Icon icon={UserPlus} /><span><b>加入公司</b><span>公司已在使用竹衍</span></span><Icon icon={ArrowRight} size="sm" /></CardButton>
    {login}
  </>;
  else if (step === 'company') body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">公司信息</h2>
    {alert}
    <Field label="公司名称"><TextInput icon={Building2} value={companyName} maxLength={60} autoFocus onChange={e => setCompanyName(e.target.value)} /></Field>
    {existing && <div className="mist-register-note">「{existing.name}」已在使用竹衍 · <TextLink onClick={() => { setSelected(existing); setQuery(existing.name); setUseCode(false); open('join', 'account'); }}>申请加入</TextLink></div>}
    <Field label="主营业务"><Segmented<CompanyBusiness> ariaLabel="主营业务" options={BUSINESS} value={business as CompanyBusiness} onChange={v => { setBusiness(v); setError(''); }} /></Field>
    <Field label="公司规模（选填）"><Segmented<CompanySize> ariaLabel="公司规模" options={SIZE} value={size as CompanySize} onChange={v => setSize(v === size ? '' : v)} /></Field>
    {primary('下一步')}
  </>;
  else if (step === 'find') body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">找到你的公司</h2>
    {alert}
    {useCode ? <>
      <Field label="公司代码"><TextInput icon={Hash} value={companyCode} maxLength={50} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e => setCompanyCode(e.target.value)} /></Field>
      <p className="mist-auth-switch"><TextLink onClick={() => { setUseCode(false); setError(''); }}>按名称搜索</TextLink></p>
    </> : <>
      <TextInput icon={Search} aria-label="公司名称" placeholder="公司名称" value={query} autoFocus onChange={e => { setQuery(e.target.value); if (selected && !sameName(selected.name, e.target.value)) setSelected(null); }} />
      <div className="mist-register-results" role="listbox" aria-label="搜索结果">
        {search.results.map(c => <button key={c.id} type="button" role="option" aria-selected={selected?.id === c.id} className="mist-register-result" data-on={selected?.id === c.id || undefined} onClick={() => { setSelected(c); setError(''); }}>
          <Icon icon={Building2} size="sm" /><span>{c.name}</span>{businessLabel(c.business) && <small>{businessLabel(c.business)}</small>}{selected?.id === c.id && <Icon icon={Check} size="sm" />}
        </button>)}
        {query.trim().length >= 2 && !search.loading && !search.results.length && <p className="mist-register-empty">{search.error || `没有找到「${query.trim()}」`}</p>}
      </div>
      <p className="mist-auth-switch">找不到？用<TextLink onClick={() => { setUseCode(true); setError(''); }}>公司代码</TextLink>加入</p>
    </>}
    {primary('下一步')}
  </>;
  else if (step === 'account') body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">{mode === 'company' ? '管理员账号' : '你的账号'}</h2>
    {mode === 'join' && <div className="mist-register-result" data-on data-static><Icon icon={Building2} size="sm" /><span>{selected && !useCode ? selected.name : `公司代码 ${companyCode.trim()}`}</span><TextLink onClick={() => setStep('find')}>更换</TextLink></div>}
    {alert}
    <Field label="姓名"><TextInput icon={User} value={displayName} maxLength={40} autoComplete="name" autoFocus onChange={e => setDisplayName(e.target.value)} /></Field>
    <Field label={mode === 'company' ? '联系邮箱' : '工作邮箱'}><TextInput icon={Mail} type="email" value={email} autoComplete="email" onChange={e => setEmail(e.target.value)} /></Field>
    <Field label="设置密码"><PasswordInput icon={KeyRound} value={password} maxLength={72} autoComplete="new-password" onChange={e => setPassword(e.target.value)} /></Field>
    <div className="mist-register-checks">{passwordChecks(password).map(c => <span key={c.label} data-ok={c.ok || undefined}><Icon icon={Check} size="xs" />{c.label}</span>)}</div>
    {primary('下一步')}
  </>;
  else body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">验证邮箱</h2>
    <p className="mist-sub">验证码已发送至 {sentTo}</p>
    {alert}
    <CodeInput value={code} onChange={v => { setCode(v); setError(''); }} onComplete={v => void finish(v)} disabled={busy} autoFocus />
    <p className="mist-register-resend">{cooldown > 0 ? `${cooldown} 秒后可重新发送` : <TextLink disabled={busy} onClick={() => void sendCode()}>重新发送</TextLink>} · <TextLink disabled={busy} onClick={() => setStep('account')}>修改邮箱</TextLink></p>
    {primary(mode === 'company' ? '完成注册' : '提交申请')}
  </>;

  return (
    <div className="mist-auth">
      <div className="mist-auth-brand">
        <MistMark className="mist-hero-ring" />
        <div className="mist-brand" style={{ padding: 0 }}><MistMark /><MistWordmark /></div>
        <div className="mist-auth-brand-copy"><h1 className="mist-h1">{BAMBOOK_BRAND.headline[0]}<br />{BAMBOOK_BRAND.headline[1]}</h1><p>{BAMBOOK_BRAND.name} · {BAMBOOK_BRAND.description}</p></div>
      </div>
      <div className="mist-auth-panel">
        <form className="mist-auth-form" aria-label="注册" onSubmit={next} noValidate>{body}</form>
      </div>
    </div>
  );
}
