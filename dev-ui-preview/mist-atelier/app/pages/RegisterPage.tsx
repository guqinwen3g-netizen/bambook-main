import { uiText, ui } from '../../../../services/interfaceLanguage';
/**
 * 注册：创建公司（公司信息 → 管理员账号 → 验证邮箱，完成后直接进入）或
 * 加入公司（受限名称核对 → 申请人信息 → 邮箱验证，管理员审核后可登录）。
 */
import React from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, Hash, KeyRound, Mail, Search, User, UserPlus } from 'lucide-react';
import { BAMBOOK_BRAND } from '../../../../server/src/shared/brand';
import { matchingCompany } from '../../../../server/src/shared/companyLookup';
import { Banner, Button, CardButton, CodeInput, Field, Icon, MistMark, MistWordmark, PasswordInput, Segmented, TextInput, TextLink } from '../../../../components/mist';
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
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const errorText = (e: unknown, fallback: string) => e instanceof Error && e.message ? e.message : fallback;

/** 输入停顿后自动核对；只显示符合统一前缀门槛的当前响应，忽略过期请求。 */
function useCompanySearch(query: string, enabled: boolean, attempt = 0): { results: CompanySearchResult[]; loading: boolean; error: string; checked: boolean } {
  const q = query.trim(), eligible = enabled && q.length >= 2 && q.length <= 60;
  const [state, setState] = React.useState<{ query: string; results: CompanySearchResult[]; loading: boolean; error: string; checked: boolean }>({ query: '', results: [], loading: false, error: '', checked: false });
  React.useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    setState(previous => ({ query: q, results: previous.query === q ? previous.results : [], loading: true, error: '', checked: false }));
    const timer = window.setTimeout(() => {
      searchRegistrationCompanies(q, controller.signal)
        .then(rows => { if (!controller.signal.aborted) setState({ query: q, results: matchingCompany(q, rows), loading: false, error: '', checked: true }); })
        .catch(e => { if (!controller.signal.aborted) setState({ query: q, results: [], loading: false, error: errorText(e, '暂时无法核对公司'), checked: true }); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [q, eligible, attempt]);
  if (!eligible) return { results: [], loading: false, error: '', checked: false };
  if (state.query !== q) return { results: [], loading: true, error: '', checked: false };
  return state;
}

export function RegisterPage() {
  const { go } = useNav();
  const session = useMistSession();
  const [mode, setMode] = React.useState<Mode>('choose'), [step, setStep] = React.useState<Step>('company');
  const [companyName, setCompanyName] = React.useState(''), [business, setBusiness] = React.useState<CompanyBusiness | ''>(''), [size, setSize] = React.useState<CompanySize | ''>('');
  const [composing, setComposing] = React.useState(false), [lookupAttempt, setLookupAttempt] = React.useState(0);
  const [query, setQuery] = React.useState(''), [selected, setSelected] = React.useState<CompanySearchResult | null>(null), [useCode, setUseCode] = React.useState(false), [companyCode, setCompanyCode] = React.useState('');
  const [displayName, setDisplayName] = React.useState(''), [email, setEmail] = React.useState(''), [password, setPassword] = React.useState(''), [code, setCode] = React.useState('');
  const [sentTo, setSentTo] = React.useState(''), [cooldown, setCooldown] = React.useState(0);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [joined, setJoined] = React.useState<{ company: string; email: string } | null>(null), [created, setCreated] = React.useState<{ email: string } | null>(null);
  const timer = React.useRef<number | undefined>(undefined), mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearInterval(timer.current); }; }, []);

  const duplicate = useCompanySearch(companyName, mode === 'company' && step === 'company' && !composing);
  const existing = duplicate.results.find(c => sameName(c.name, companyName.trim()));
  const search = useCompanySearch(query, mode === 'join' && step === 'find' && !useCode && !composing, lookupAttempt);

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
      if (useCode && !companyCode.trim()) return setError('请填写公司代码');
      if (!useCode && !selected) {
        if (query.trim().length < 2) return setError('请填写公司名称');
        if (search.error) setLookupAttempt(value => value + 1);
        return;
      }
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
          await session.login(result.email, password, { remember: true });
          if (mounted.current) go('cockpit');
        } catch { if (mounted.current) setCreated({ email: result.email }); }
      } else {
        const result = await registerJoinCompany(useCode || !selected ? { ...account, companyCode: companyCode.trim() } : { ...account, companyId: selected.id });
        if (mounted.current) setJoined({ company: result.company.name, email: result.email });
      }
      if (mounted.current) setPassword('');
    } catch (e) { if (mounted.current) setError(errorText(e, '注册未完成，请稍后重试')); }
    finally { if (mounted.current) setBusy(false); }
  };

  const progress = flow.length ? <div className="mist-register-progress" aria-label={ui`第 ${flow.indexOf(step) + 1} 步，共 ${flow.length} 步`}>{flow.map((s, i) => <i key={s} data-on={i <= flow.indexOf(step) || undefined} />)}</div> : null;
  const login = <p className="mist-auth-switch"><TextLink disabled={busy} onClick={() => go('login')}>{uiText("返回登录")}</TextLink></p>;
  const backLink = <TextLink disabled={busy} onClick={back}><Icon icon={ArrowLeft} size="xs" />{uiText(" 返回")}</TextLink>;
  const primary = (label: string, disabled = false) => <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || disabled} iconRight={busy ? undefined : ArrowRight}>{uiText(label)}</Button>;
  const alert = error ? <Banner tone="bad" title={uiText(error)} /> : null;

  let body: React.ReactNode;
  if (joined) body = <>
    <h2 className="mist-h1 mist-auth-title">{uiText("申请已提交")}</h2>
    <p className="mist-sub">{uiText("待「")}{joined.company}{uiText("」管理员审核通过后，可使用 ")}{joined.email}{uiText(" 登录。")}</p>
    <Button variant="primary" size="lg" block onClick={() => go('login', joined.email)}>{uiText("返回登录")}</Button>
  </>;
  else if (created) body = <>
    <h2 className="mist-h1 mist-auth-title">{uiText("公司账户已开通")}</h2>
    <p className="mist-sub">{uiText("登录邮箱：")}{created.email}</p>
    <Button variant="primary" size="lg" block iconRight={ArrowRight} onClick={() => go('login', created.email)}>{uiText("登录")}</Button>
  </>;
  else if (mode === 'choose') body = <>
    <h2 className="mist-h1 mist-auth-title">{uiText("账户开通")}</h2>
    <CardButton className="mist-register-option" onClick={() => open('company')}><Icon icon={Building2} /><span><b>{uiText("开通公司账户")}</b><span>{uiText("负责人或授权管理员办理")}</span></span><Icon icon={ArrowRight} size="sm" /></CardButton>
    <CardButton className="mist-register-option" onClick={() => open('join')}><Icon icon={UserPlus} /><span><b>{uiText("申请加入公司")}</b><span>{uiText("员工申请，需公司管理员审核")}</span></span><Icon icon={ArrowRight} size="sm" /></CardButton>
    {login}
  </>;
  else if (step === 'company') body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">{uiText("公司信息")}</h2>
    {alert}
    <Field label={uiText("公司名称")}><TextInput icon={Building2} value={companyName} maxLength={60} autoFocus onChange={e => setCompanyName(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} /></Field>
    {existing && <div className="mist-register-note">「{existing.name}{uiText("」已开通公司账户 · ")}<TextLink onClick={() => { setSelected(existing); setQuery(existing.name); setUseCode(false); open('join', 'account'); }}>{uiText("申请加入")}</TextLink></div>}
    <Field label={uiText("主营业务")}><Segmented<CompanyBusiness> ariaLabel={uiText("主营业务")} options={BUSINESS} value={business as CompanyBusiness} onChange={v => { setBusiness(v); setError(''); }} /></Field>
    <Field label={uiText("公司规模（选填）")}><Segmented<CompanySize> ariaLabel={uiText("公司规模")} options={SIZE} value={size as CompanySize} onChange={v => setSize(v === size ? '' : v)} /></Field>
    {primary('下一步')}
  </>;
  else if (step === 'find') body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">{uiText("核对公司")}</h2>
    {alert}
    {useCode ? <>
      <Field label={uiText("公司代码")}><TextInput icon={Hash} value={companyCode} maxLength={50} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e => setCompanyCode(e.target.value)} /></Field>
      <p className="mist-auth-switch"><TextLink onClick={() => { setUseCode(false); setError(''); }}>{uiText("使用公司名称")}</TextLink></p>
    </> : <>
      <Field label={uiText("公司名称")}><TextInput icon={Search} placeholder={uiText("输入公司名称")} value={query} maxLength={60} autoFocus onChange={e => { setQuery(e.target.value); setSelected(null); setError(''); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} /></Field>
      <div className="mist-register-results" role="listbox" aria-label={uiText("匹配的公司")} aria-busy={search.loading}>
        {search.results.map(c => <button key={c.id} type="button" role="option" aria-selected={selected?.id === c.id} className="mist-register-result" data-on={selected?.id === c.id || undefined} onClick={() => { setSelected(c); setError(''); }}>
          <Icon icon={Building2} size="sm" /><span>{c.name}</span>{businessLabel(c.business) && <small>{businessLabel(c.business)}</small>}{selected?.id === c.id && <Icon icon={Check} size="sm" />}
        </button>)}
        {search.loading && !search.results.length && <p className="mist-register-empty" role="status">{uiText("核对中…")}</p>}
        {search.checked && !search.results.length && <p className="mist-register-empty" role="status">{search.error || '暂未确认公司，请继续补充名称或使用公司代码。'}{search.error && <> <TextLink onClick={() => setLookupAttempt(value => value + 1)}>{uiText("重试")}</TextLink></>}</p>}
      </div>
      <p className="mist-auth-switch"><TextLink onClick={() => { setUseCode(true); setError(''); }}>{uiText("使用公司代码")}</TextLink></p>
    </>}
    {primary('下一步', !useCode && !selected)}
  </>;
  else if (step === 'account') body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">{uiText(mode === 'company' ? '管理员账号' : '申请人信息')}</h2>
    {mode === 'join' && <div className="mist-register-result" data-on data-static><Icon icon={Building2} size="sm" /><span>{uiText(selected && !useCode ? selected.name : `公司代码 ${companyCode.trim()}`)}</span><TextLink onClick={() => setStep('find')}>{uiText("更换")}</TextLink></div>}
    {alert}
    <Field label={uiText("姓名")}><TextInput icon={User} value={displayName} maxLength={40} autoComplete="name" autoFocus onChange={e => setDisplayName(e.target.value)} /></Field>
    <Field label={uiText(mode === 'company' ? '联系邮箱' : '工作邮箱')}><TextInput icon={Mail} type="email" value={email} autoComplete="email" onChange={e => setEmail(e.target.value)} /></Field>
    <Field label={uiText("设置密码")}><PasswordInput icon={KeyRound} value={password} maxLength={72} autoComplete="new-password" onChange={e => setPassword(e.target.value)} /></Field>
    <div className="mist-register-checks">{passwordChecks(password).map(c => <span key={c.label} data-ok={c.ok || undefined}><Icon icon={Check} size="xs" />{uiText(c.label)}</span>)}</div>
    {primary('下一步')}
  </>;
  else body = <>
    {backLink}{progress}
    <h2 className="mist-h1 mist-auth-title">{uiText("邮箱验证")}</h2>
    <p className="mist-sub">{uiText("验证码已发送至 ")}{sentTo}</p>
    {alert}
    <CodeInput value={code} onChange={v => { setCode(v); setError(''); }} onComplete={v => void finish(v)} disabled={busy} autoFocus />
    <p className="mist-register-resend">{cooldown > 0 ? `${cooldown} 秒后可重新发送` : <TextLink disabled={busy} onClick={() => void sendCode()}>{uiText("重新发送")}</TextLink>} · <TextLink disabled={busy} onClick={() => setStep('account')}>{uiText("修改邮箱")}</TextLink></p>
    {primary(mode === 'company' ? '开通公司账户' : '提交申请')}
  </>;

  return (
    <div className="mist-auth">
      <div className="mist-auth-brand">
        <MistMark className="mist-hero-ring" />
        <div className="mist-brand" style={{ padding: 0 }}><MistMark /><MistWordmark /></div>
        <div className="mist-auth-brand-copy"><h1 className="mist-h1">{BAMBOOK_BRAND.headline[0]}<br />{BAMBOOK_BRAND.headline[1]}</h1><p>{BAMBOOK_BRAND.name} · {BAMBOOK_BRAND.description}</p></div>
      </div>
      <div className="mist-auth-panel">
        <form className="mist-auth-form" aria-label={uiText("账户开通")} onSubmit={next} noValidate>{body}</form>
      </div>
    </div>
  );
}
