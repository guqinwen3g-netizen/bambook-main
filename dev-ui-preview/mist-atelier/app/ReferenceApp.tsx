import React from 'react';
import { Banner, Button, MistPage, MistRoot, ToastProvider, type ThemeMode } from '../../../components/mist';
import { LegacyStartup } from '../../../components/mist/LegacyStartup';
import { publicEntryForHost } from '../../../server/src/shared/bambookPublicOrigins';
import { localizedPageTitle, uiText, useInterfaceLanguage, type InterfaceLocale } from '../../../services/interfaceLanguage';
import { PageLoadBoundary, PageLoading } from './PageLoading';
import { PublicEntry, publicEntryMode } from './PublicEntry';
import { readMistRoute, writeMistRoute, type NavCtx } from './nav';
import { pageDocumentTitle } from './pageTitle';
import { personalSettingsSection } from './routeAccess';
import { MistSessionProvider, useMistSession } from './runtime/auth';
import { useDevice } from './runtime/devicePreferences';
import { onThemePreference, readThemePreference, resolveTheme, writeThemePreference } from './runtime/themePreference';

export { approverMissing, settingsGap } from './routeAccess';
export { isListState, nextScrollKey, readMistRoute, writeMistRoute } from './nav';

const loadWorkspace = () => import('./WorkspaceApp');
const WorkspaceApp = React.lazy(loadWorkspace);
let workspacePreloadRequested = false;
const warmWorkspace = () => {
  if (workspacePreloadRequested) return;
  workspacePreloadRequested = true;
  void loadWorkspace().catch(() => { workspacePreloadRequested = false; });
};

function StartupGate() {
  const session = useMistSession();
  return <LegacyStartup ready={session.status !== 'loading'} />;
}

function Entry({ theme, locale, toggleTheme }: { theme: ThemeMode; locale: InterfaceLocale; toggleTheme: () => void }) {
  const session = useMistSession();
  const [route, setRoute] = React.useState(readMistRoute);
  const [workspaceOpened, setWorkspaceOpened] = React.useState(false);
  const mode = publicEntryMode(route.view, session);
  const workspace = workspaceOpened || !mode;
  // After the first handoff, the workspace owns navigation, including later sign-outs.
  React.useEffect(() => { if (!mode) setWorkspaceOpened(true); }, [mode]);
  React.useEffect(() => {
    if (workspace) return;
    const pop = () => setRoute(readMistRoute());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [workspace]);
  const view = personalSettingsSection(route) ? 'account' : session.status === 'anonymous' && publicEntryForHost(location.host) === 'platform' ? 'platform-login' : route.view;
  const title = pageDocumentTitle(view, { anonymous: session.status === 'anonymous', loading: session.status === 'loading',
    mustChangePassword: !session.localMode && session.user?.mustChangePassword, invitation: new URLSearchParams(location.search).get('kind') === 'invite' });
  React.useEffect(() => { if (!workspace) document.title = localizedPageTitle(title); }, [title, locale, workspace]);
  const go: NavCtx['go'] = (view, id, target = {}, options = {}) => {
    const next = { view, id, ...target };
    writeMistRoute(next, options);
    setRoute(next);
  };
  if (workspaceOpened || !mode) return <PageLoadBoundary resetKey="workspace" fallback={retry => <MistPage><Banner tone="bad" title={uiText('页面未能加载')} actions={<Button onClick={retry}>{uiText('重新加载')}</Button>} /></MistPage>}>
    <React.Suspense fallback={<PageLoading />}><WorkspaceApp theme={theme} locale={locale} toggleTheme={toggleTheme} /></React.Suspense>
  </PageLoadBoundary>;
  return <PublicEntry mode={mode} nav={{ route, go, theme, toggleTheme, openPalette: () => {}, openAI: () => {} }} warmWorkspace={warmWorkspace} />;
}

export function ReferenceApp() {
  const qs = new URLSearchParams(location.search);
  const locale = useInterfaceLanguage();
  const reducedMotion = useDevice('reducedMotion');
  const [theme, setTheme] = React.useState<ThemeMode>(() => (qs.get('theme') as ThemeMode) || (document.documentElement.dataset.mistBootTheme as ThemeMode) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  React.useEffect(() => { try { localStorage.setItem('bambook.mist.boot-theme', theme); } catch {} document.documentElement.style.colorScheme = theme; document.body.style.background = theme === 'dark' ? '#101C35' : '#7FA3B3'; }, [theme]); // mist-allow: original outer-body background outside MistRoot
  React.useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(resolveTheme(readThemePreference()));
    sync(); media.addEventListener?.('change', sync);
    const off = onThemePreference(sync);
    return () => { media.removeEventListener?.('change', sync); off(); };
  }, []);
  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('.mist-root');
    for (const key of ['--mist-dur-fast','--mist-dur','--mist-dur-slow']) {
      if (reducedMotion) root?.style.setProperty(key, '0s'); else root?.style.removeProperty(key);
    }
  }, [reducedMotion]);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    writeThemePreference(next);
  };
  return <MistRoot theme={theme}>
    <ToastProvider>
      <MistSessionProvider>
        {qs.get('intro') !== '0' && <StartupGate />}
        <Entry theme={theme} locale={locale} toggleTheme={toggleTheme} />
      </MistSessionProvider>
    </ToastProvider>
  </MistRoot>;
}
