import React from 'react';
import { BAMBOOK_BRAND } from '../../../../server/src/shared/brand';
import { Banner, Button, Field, MistMark, MistWordmark, TextInput, TextLink } from '../../../../components/mist';
import { useNav } from '../nav';
import { accountAccessApi } from '../runtime/accountAccess';
/** Email links never log users in or consume credentials on GET; only explicit form submission changes the password. */
export function AccountAccessPage(){
 const nav=useNav(),query=new URLSearchParams(location.search),requestMode=nav.route.view==='platform-recovery';
 const kind=query.get('kind')==='invite'?'invite':'recovery';
 const [email,setEmail]=React.useState(query.get('email')||''),[password,setPassword]=React.useState(''),[confirm,setConfirm]=React.useState(''),[mfa,setMfa]=React.useState('');
 const token=React.useRef(location.hash.slice(1)),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[message,setMessage]=React.useState(''),[done,setDone]=React.useState(false);
 const mounted=React.useRef(true);React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setError('');setMessage('');
  if(!requestMode&&(!token.current||password!==confirm)){setError(!token.current?'链接不完整，请从邀请邮件重新打开。':'两次输入的密码不一致。');return;}
  setBusy(true);try{if(requestMode){const result=await accountAccessApi.requestRecovery(email.trim());if(mounted.current)setMessage(result.message);}else{await accountAccessApi.complete({email:email.trim(),kind,token:token.current,password,mfaCode:mfa});if(mounted.current){setDone(true);setPassword('');setConfirm('');setMfa('');token.current='';history.replaceState(history.state,'',location.pathname+location.search);}}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'操作未完成，请重试。');}finally{if(mounted.current)setBusy(false);}}
 const title=requestMode?'找回密码':kind==='invite'?'设置登录密码':'重设平台密码';
 return <div className="mist-auth"><div className="mist-auth-brand"><MistMark className="mist-hero-ring"/><div className="mist-brand" style={{padding:0}}><MistMark/><MistWordmark/></div><div className="mist-auth-brand-copy"><h1 className="mist-h1">{BAMBOOK_BRAND.headline[0]}<br/>{BAMBOOK_BRAND.headline[1]}</h1><p>{BAMBOOK_BRAND.name} · {BAMBOOK_BRAND.description}</p></div></div><div className="mist-auth-panel"><form className="mist-auth-form" onSubmit={submit}>
 <h2 className="mist-h1" style={{fontSize:28}}>{done?'密码已设置':title}</h2>
 {done?<><p>请使用刚设置的密码登录。已开启的两步验证继续有效。</p><Button variant="primary" onClick={()=>nav.go('login')}>前往登录</Button></>:<>
 <p className="mist-sub">{requestMode?'平台工作账号可通过邮箱找回；公司账号请联系本公司管理员重置。':kind==='invite'?'完成密码设置后即可登录。邀请链接 48 小时内有效，仅能使用一次。':'链接 30 分钟内有效。修改后原有设备会话将失效。'}</p>
 {error&&<Banner tone="bad" title={error}/>} {message&&<Banner tone="ok" title={message}/>}
 <Field label="工作邮箱"><TextInput aria-label="工作邮箱" type="email" autoComplete="username" required disabled={busy||!requestMode} value={email} onChange={e=>setEmail(e.target.value)}/></Field>
 {!requestMode&&<><Field label="新密码" hint="至少 12 位，包含字母和数字；最多 72 字节。"><TextInput aria-label="新密码" type="password" autoComplete="new-password" required minLength={12} maxLength={72} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></Field><Field label="确认新密码"><TextInput aria-label="确认新密码" type="password" autoComplete="new-password" required disabled={busy} value={confirm} onChange={e=>setConfirm(e.target.value)}/></Field><Field label="两步验证码或恢复码" hint="已开启两步验证的账号须填写；未开启可留空。"><TextInput aria-label="两步验证码或恢复码" autoComplete="one-time-code" disabled={busy} value={mfa} onChange={e=>setMfa(e.target.value)}/></Field></>}
 <Button type="submit" variant="primary" block loading={busy} disabled={busy}>{requestMode?'发送找回邮件':'设置密码'}</Button>
 <TextLink disabled={busy} onClick={()=>nav.go('login')}>返回登录</TextLink>
 </>}
 </form></div></div>;
}
