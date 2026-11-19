import React from 'react';
import { loginEntryForHost, publicEntryForHost } from '../../../server/src/shared/bambookPublicOrigins';
import { uiText } from '../../../services/interfaceLanguage';
import { Button, Card, CardHeader, MistPage } from '../../../components/mist';
import { Nav, type NavCtx } from './nav';
import { AccountAccessPage } from './pages/AccountAccessPage';
import { ForcedPasswordChangePage } from './pages/ChangePassword';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { useMistSession, type MistSession } from './runtime/auth';

type Mode = 'account-access' | 'register' | 'loading' | 'connection' | 'login' | 'password';

export function publicEntryMode(view: string, session: MistSession): Mode | undefined {
  if (['account-access', 'account-recovery', 'platform-recovery'].includes(view)) return 'account-access';
  if (view === 'register' && publicEntryForHost(location.host) !== 'platform') return 'register';
  if (session.status === 'loading') return 'loading';
  if (session.status === 'anonymous' && (session.localMode || session.connectionModeUnverified)) return 'connection';
  if (session.status === 'anonymous' || view === 'login' || view === 'platform-login') return 'login';
  if (!session.localMode && session.user?.mustChangePassword) return 'password';
}

export function PublicEntry({ mode, nav, warmWorkspace }: { mode: Mode; nav: NavCtx; warmWorkspace?: () => void }) {
  const session = useMistSession();
  const { route, go } = nav;
  if (mode === 'account-access') return <Nav.Provider value={nav}><AccountAccessPage key={route.view}/></Nav.Provider>;
  if (mode === 'register') return <Nav.Provider value={nav}><RegisterPage/></Nav.Provider>;
  if (mode === 'loading') return null;
  if (mode === 'connection') return <MistPage width="narrow"><Card><CardHeader title={uiText("公司连接待核对")} sub={uiText(session.localMode?'本地工作身份由本机服务提供，无需输入旧账号密码。':'暂时无法确认当前公司，请重新连接后继续。')}/><div className="mist-card-body"><p>{session.error||'暂时无法读取公司会话，请重新连接。'}</p><Button variant="primary" loading={session.refreshing} onClick={()=>void session.refresh()}>{uiText(session.localMode?'重新进入本地身份':'重新连接公司')}</Button></div></Card></MistPage>;
  if (mode === 'login') {
    // 平台管理入口与公司登录分开：platform-* 地址只显示平台登录。
    const platformEntry = loginEntryForHost(location.host, route.view) === 'platform';
    const loginGo = (view: string, id?: string) => {
      if (view === 'cockpit' && !['login', 'platform-admin', 'platform-login'].includes(route.view)) go(route.view, route.id, route); else go(view, id);
    };
    return <Nav.Provider value={{ ...nav, go: loginGo }}><LoginPage key={platformEntry ? 'platform' : 'company'} entry={platformEntry ? 'platform' : 'company'} onWorkspaceIntent={warmWorkspace} /></Nav.Provider>;
  }
  return <ForcedPasswordChangePage />;
}
