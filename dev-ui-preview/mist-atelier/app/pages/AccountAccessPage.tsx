import { uiText, ui } from '../../../../services/interfaceLanguage';
import React from 'react';
import { BAMBOOK_BRAND } from '../../../../server/src/shared/brand';
import { Banner, Button, Field, MistMark, MistWordmark, PasswordInput, TextInput, TextLink } from '../../../../components/mist';
import { useNav } from '../nav';
import { accountAccessApi } from '../runtime/accountAccess';
import { PASSWORD_HINT, passwordOk } from '../runtime/passwordRule';
import { useRecoveryCooldown } from '../runtime/recoveryCooldown';

/** GET never consumes a link. A request acknowledgement is not proof of email delivery. */
export function AccountAccessPage(){
 const nav=useNav(),query=new URLSearchParams(location.search),requestMode=nav.route.view==='platform-recovery';
 const kind=query.get('kind')==='invite'?'invite':'recovery';
 const [email,setEmail]=React.useState(query.get('email')||''),[password,setPassword]=React.useState(''),[confirm,setConfirm]=React.useState('');
 const token=React.useRef(location.hash.slice(1)),inFlight=React.useRef(false),heading=React.useRef<HTMLHeadingElement>(null);
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[accepted,setAccepted]=React.useState(false),[done,setDone]=React.useState(false);
 const [linkInvalid,setLinkInvalid]=React.useState(!requestMode&&!token.current),[attempted,setAttempted]=React.useState(false);
 const {remaining,start}=useRecoveryCooldown(requestMode);
 const mounted=React.useRef(true);React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 React.useEffect(()=>{if(done||linkInvalid)heading.current?.focus();},[done,linkInvalid]);
 const mismatch=attempted&&password!==confirm,weak=attempted&&!passwordOk(password);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(inFlight.current||requestMode&&remaining>0)return;
  setError('');
  if(!requestMode){setAttempted(true);if(!token.current){setLinkInvalid(true);return;}if(password!==confirm||!passwordOk(password))return;}
  inFlight.current=true;setBusy(true);
  try{
   if(requestMode){
    const result=await accountAccessApi.requestRecovery(email.trim());
    if(mounted.current){start(result.retryAfterSeconds??60);setNotice('申请已提交，请查收邮件。');setAccepted(true);}
   }else{
    await accountAccessApi.complete({email:email.trim(),kind,token:token.current,password});
    if(mounted.current){setDone(true);setPassword('');setConfirm('');token.current='';history.replaceState(history.state,'',location.pathname+location.search);}
   }
  }catch(e){if(mounted.current){
   const issue=e as {code?:string;retryAfterSeconds?:number};
   if(requestMode&&issue?.retryAfterSeconds)start(issue.retryAfterSeconds);
   if(issue?.code==='ACCESS_LINK_INVALID')setLinkInvalid(true);
   else setError(e instanceof Error?e.message:'操作未完成，请重试。');
  }}finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 const title=done?(kind==='invite'?'登录密码已设置':'密码已更新'):linkInvalid?'链接已失效':requestMode?'找回密码':kind==='invite'?'设置登录密码':'设置新密码';
 const waitTime=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
 const returnToLogin=()=>nav.go('login');
 return <div className="mist-auth"><div className="mist-auth-brand"><MistMark className="mist-hero-ring"/><div className="mist-brand" style={{padding:0}}><MistMark/><MistWordmark/></div><div className="mist-auth-brand-copy"><h1 className="mist-h1">{BAMBOOK_BRAND.headline[0]}<br/>{BAMBOOK_BRAND.headline[1]}</h1><p>{BAMBOOK_BRAND.name} · {BAMBOOK_BRAND.description}</p></div></div><div className="mist-auth-panel"><form className="mist-auth-form" aria-label={uiText(title)} onSubmit={submit} aria-busy={busy}>
  <h2 ref={heading} tabIndex={-1} className="mist-h1 mist-auth-title">{uiText(title)}</h2>
  {done?<Button variant="primary" onClick={returnToLogin}>{uiText("返回登录")}</Button>
   :linkInvalid?<><p className="mist-sub">{uiText(kind==='invite'?'请联系管理员重新发送邀请。':'请重新申请重置邮件。')}</p>{kind==='recovery'&&<Button variant="primary" onClick={()=>nav.go('platform-recovery')}>{uiText("重新申请")}</Button>}<TextLink onClick={returnToLogin}>{uiText("返回登录")}</TextLink></>
   :<>
    {error&&<Banner tone="bad" title={uiText(error)}/>}
    <Field label={uiText("工作邮箱")}><TextInput aria-label={uiText("工作邮箱")} type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={busy||!requestMode} value={email} onChange={e=>{setEmail(e.target.value);setNotice('');setAccepted(false);}}/></Field>
    {!requestMode&&<>
     <Field label={uiText("新密码")} hint={<span id="account-new-password-help">{PASSWORD_HINT}</span>} error={weak?<span id="account-new-password-help" role="alert">{uiText(new TextEncoder().encode(password).length>72?'密码过长，请缩短后重试。':PASSWORD_HINT)}</span>:undefined}><PasswordInput aria-label={uiText("新密码")} aria-describedby="account-new-password-help" aria-invalid={weak||undefined} autoComplete="new-password" required minLength={8} maxLength={72} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></Field>
     <Field label={uiText("确认新密码")} error={mismatch?<span id="account-confirm-password-error" role="alert">{uiText("两次输入的密码不一致。")}</span>:undefined}><PasswordInput aria-label={uiText("确认新密码")} aria-describedby={mismatch?'account-confirm-password-error':undefined} aria-invalid={mismatch||undefined} autoComplete="new-password" required disabled={busy} value={confirm} onChange={e=>setConfirm(e.target.value)}/></Field>
    </>}
    <Button type="submit" variant="primary" block loading={busy} disabled={busy||requestMode&&remaining>0}>{uiText(busy?'正在提交…':requestMode?(remaining>0?`重新发送（${waitTime}）`:accepted?'重新发送':'发送重置链接'):kind==='invite'?'设置登录密码':'更新密码')}</Button>
    {notice&&<p role="status" className="mist-sub">{uiText(notice)}</p>}
    <TextLink disabled={busy} onClick={returnToLogin}>{uiText("返回登录")}</TextLink>
   </>}
 </form></div></div>;
}
