import { loginEntryForHost, publicEntryForHost } from '../../../server/src/shared/bambookPublicOrigins';
import { interfaceLocale } from '../../../services/interfaceLanguage';
import { uiText, ui, useInterfaceLanguage, localizedPageTitle } from '../../../services/interfaceLanguage';
import {businessNow} from './runtime/businessClock';
import { AccountAccessPage } from './pages/AccountAccessPage';
import { exitCompanyManagement } from './runtime/platformAdmin';
import React from 'react';
import { buildPages, MODULE_VIEW_SET, PageLoadBoundary, AccountPage, PlatformSettingsPage, PlatformCompanySettingsPage } from './pageRegistry';
import { PageLoading } from './PageLoading';
import { preloadPagesWhenIdle } from './pagePreload';
import { primaryImageId } from '../../../server/src/shared/mistPrimaryImage';
import { Bell, ClipboardList, Component, KeyRound, Layers, ListTodo, Moon, Search, Settings2, ShieldCheck, Sparkles, SquareDashed, Users } from 'lucide-react';

import {
  AssistantDrawer, Banner, TaskList, Button, Card, CardHeader, CommandPalette, Drawer, EmptyState, MistAppShell, MistPage, MistRoot, MistSidebarPresentation, MistTopbar, ToastProvider, MistDensityContext, useHotkey, useToast,
  type ChatMessage, type CommandItem, type Crumb, type NavSection, type ThemeMode,
} from '../../../components/mist';
import { getModuleByView, getPrimaryNavigationModules, groupPrimaryNavigationModules } from '../../../components/moduleRegistry';
import { View } from '../../../types';
import { MODULE_MAP } from './moduleMap';
import { Nav, useNav, type GoOptions, type Route, type RouteTarget } from './nav';
import { PAGE_LABELS as LABELS, pageDocumentTitle } from './pageTitle';
import { MistSessionProvider, useMistSession } from './runtime/auth';
import { onThemePreference, readThemePreference, resolveTheme, writeThemePreference } from './runtime/themePreference';
import { useDevice } from './runtime/devicePreferences';
import { LegacyStartup } from '../../../components/mist/LegacyStartup';
import { MistWorkspaceProvider, useMistWorkspace } from './runtime/workspace';
import {MistPresentedErrorContext,useClaimedUploadRecovery} from './runtime/errorPresentation';
import { clearPrivateImages, schedulePrivateImagePrefetch } from './runtime/usePrivateImage';
import { useOrganizationContext } from './runtime/organizationContext';
import { canOpenCompanyAdmin, canOpenMistView, COMPANY_ADMIN_VIEWS, personalSettingsSection } from './routeAccess';
import { LoginPage } from './pages/LoginPage';
import { ForcedPasswordChangePage } from './pages/ChangePassword';
import { RegisterPage } from './pages/RegisterPage';
import { MistReviewButton, MistReviewProvider, useOptionalMistReviews } from './runtime/reviews';
import { mistMyWork, mistNavCounts, mistWorkModule, type MistWorkOptions } from './runtime/workQueue';
import { workspaceSearchRecords } from './runtime/search';
import { apiService } from '../../../services/apiService';
import { platformBusinessDate } from '../../../server/src/shared/mistPlatform';
import { visibleMistNotifications, mistDailyDigest } from './runtime/notificationPreferences';
import { DEVELOPMENT_LIST_TABS, developmentCreateTarget, developmentListTab, developmentListTarget, type DevelopmentListTab } from './developmentEntry';
const SEARCH_ICONS: Record<string, typeof Layers> = { 开发案: Layers, 订单: ClipboardList };
// Only the separate reference preview enables developer showcase pages.
// Running the business app through Vite does not make them client features.
const REFERENCE_PREVIEW = import.meta.env.VITE_MIST_REFERENCE === 'true';

const PAGES = buildPages(REFERENCE_PREVIEW);
const LIVE_VIEWS = new Set(['account','platform-admin','emails','cockpit','development','development/detail','development/new','orders','orders/detail','orders/new','payment-vouchers','crm','production-board','calendar','system-settings','settings','company-settings','workspace-settings','approvals','notifications','search']);
const ROUTE_KEYS = ['view','id','versionId','batchId','section','customerId','orderLineId','productionId','detail'] as const;
const GROUPS: Record<string, string> = { overview: '我的事务', customer: '客户与市场', fulfillment: '订单履约', finance: '财务与成本', platform: '平台' };

export function readMistRoute(): Route {
  const qs = new URLSearchParams(location.search);
  const view = qs.get('view') || 'cockpit', id = qs.get('id') || undefined;
  const saved = history.state?.mistRoute;
  const scopeMatches = saved?.view === view && saved?.id === id && ROUTE_KEYS.slice(2).every(key => saved[key] === (qs.get(key) || undefined));
  return {
    ...(scopeMatches ? saved : {}),
    view, id, ...Object.fromEntries(ROUTE_KEYS.slice(2).map(key => [key, qs.get(key) || undefined])),
  };
}
export function writeMistRoute(route: Route, options: GoOptions = {}) {
  const url = new URL(location.href);
  for (const key of ROUTE_KEYS) {
    if (route[key]) url.searchParams.set(key, route[key]!); else url.searchParams.delete(key);
  }
  history.pushState({ ...history.state, mistRoute: route, mistListState: isListState(route, options), mistDepth: (Number(history.state?.mistDepth) || 0) + 1 }, '', url);
}
/** A list position: the list itself or a row picked for its in-page preview (not a full page). */
export function isListState(route: Route, options: GoOptions = {}) { return !route.detail && (!route.id || !!options.keepScroll); }
/** Scroll resets on page changes, but not while switching the previewed row inside the same list (or going back/forward between such rows). */
export function nextScrollKey(previous: { key: string; route: Route; list: boolean }, route: Route, list: boolean) {
  const keep = list && previous.list && previous.route.view === route.view && (previous.route.section ?? '') === (route.section ?? '');
  return keep ? previous.key : scrollKeyOf(route, list);
}
function scrollKeyOf(route: Route, list: boolean) { return route.view + (route.id ?? '') + (list ? '#list' : '');
}
/** 平台管理范围：账号、组织人事及公司设置；业务执行仍走公司端。 */
const COMPANY_MANAGEMENT_VIEWS = ['admin-panel', 'hr', 'system-settings', 'settings', 'company-settings', 'workspace-settings'];
function useSections(): NavSection[] {
  const session = useMistSession();
  return React.useMemo(() => {
    const platformOnly = session.user?.platformRole === 'platform_admin' && !session.user.roleIds?.length;
    const supporting = !!session.user?.platformCompany;
    const modules = platformOnly ? [] : getPrimaryNavigationModules({ isAdmin: session.hasRole('owner', 'admin') || session.hasPermission('users:admin'), canAccessView: session.canAccessView })
      .filter(m => !supporting || COMPANY_MANAGEMENT_VIEWS.includes(String(m.view)));
    const real = groupPrimaryNavigationModules(modules).map(g => ({
      id: g.group, label: g.label === '平台' ? '数据与工具' : g.label, defaultClosed: !['overview', 'fulfillment'].includes(g.group),
      items: g.modules.filter(m => !COMPANY_ADMIN_VIEWS.has(String(m.view)) && m.view !== View.HR).map(m => ({ id: String(m.view), label: productName(m), icon: m.icon })),
    })).filter(g => g.items.length);
    const hr = !platformOnly && !session.localMode && session.canAccessView(View.HR) ? [{ id: 'hr', label: '人事管理', icon: Users }] : [];
    const items = supporting ? [...hr, { id: 'company-settings', label: '公司管理', icon: Settings2 }] : [
      ...hr,
      ...(platformOnly ? [{ id: 'system-settings', label: '平台设置', icon: Settings2 }] : canOpenCompanyAdmin(session.canAccessView) ? [{ id: 'company-settings', label: '公司管理', icon: Settings2 }] : []),
      ...(session.user?.platformRole === 'platform_admin' ? [{ id: 'platform-admin', label: '平台管理', icon: ShieldCheck }] : []),
    ];
    const reference = REFERENCE_PREVIEW ? [{ id: 'design-system', label: '设计系统', icon: Component }, { id: 'states', label: '空 / 加载 / 错误', icon: SquareDashed }, ...(!session.localMode ? [{ id: 'login', label: '登录页', icon: KeyRound }] : [])] : [];
    return [...real, ...(items.length ? [{ id: 'handoff', label: '管理', items }] : []), ...(reference.length ? [{ id: 'reference', label: '开发预览', items: reference }] : [])];
  }, [session.sessionKey, session.status, session.hasRole, session.canAccessView, interfaceLocale()]);
}
/** 侧栏数字、模块页「待我处理」、首页合计共用同一口径（见 runtime/workQueue）。 */
function useMyWorkOptions(): MistWorkOptions {
  const session = useMistSession(), { workspace } = useMistWorkspace(), reviews = useOptionalMistReviews();
  return { canRead: view => session.canAccessView(view as View), can: permission => session.hasPermission(permission), me: session.user?.id ?? '', reviews: reviews?.rows, today: platformBusinessDate(businessNow()), workspaceId: workspace?.id };
}
function CountedSidebar({ sections, ...rest }: React.ComponentProps<typeof MistSidebarPresentation>) {
  const { state } = useMistWorkspace(), counts = mistNavCounts(state, useMyWorkOptions());
  const counted = sections.map(section => ({ ...section, items: section.items.map(item => ({ ...item, count: counts[item.id] || undefined })) }));
  return <MistSidebarPresentation sections={counted} {...rest} />;
}
/** 模块首页顶部：本模块等我处理的事项（条数与侧栏数字一致），展开后可直接打开原业务。 */
function ModuleWorkBar({ view }: { view: string }) {
  const { state } = useMistWorkspace(), { go } = useNav(), [open, setOpen] = React.useState(false), today = platformBusinessDate(businessNow());
  const module = mistWorkModule(view), items = mistMyWork(state, useMyWorkOptions()).filter(item => item.module === module);
  React.useEffect(() => setOpen(false), [module]);
  if (!items.length || module === 'cockpit') return null;
  return <><div data-mist-module-work={module}><Banner tone="accent" icon={ListTodo} title={ui`待我处理 ${items.length} 项`} actions={<Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{uiText("查看")}</Button>}>{items.slice(0, 2).map(item => item.title).join('；')}{uiText(items.length > 2 ? ' 等' : '')}</Banner></div>
    <Drawer open={open} onClose={() => setOpen(false)} title={ui`待我处理 · ${items.length} 项`} sub={uiText("指定给我或我岗位的事项；办理后自动消失")}>
      <TaskList items={items.map(item => ({ id: item.id, when: item.when, urgent: item.urgent || (!!item.at && item.at.slice(0, 10) < today && item.source === 'task'), title: item.title, meta: item.meta }))}
        onOpen={row => { const item = items.find(entry => entry.id === row.id); if (item) { setOpen(false); go(item.target.view, item.target.id, item.target); } }} />
    </Drawer></>;
}
const developmentCreateLabel = (section?: string) => DEVELOPMENT_LIST_TABS.find(tab => tab.value === (section === 'fabric' ? 'fabric' : 'garment'))!.create;
/** 模块的正式产品名：注册表里的「（开发中）」内部标记不进入界面。 */
const productName = (m: { productLabel: string }) => m.productLabel.replace('（开发中）', '');

function crumbsFor(route: Route, go: (view: string, id?: string) => void, objectLabel?: string, versionLabel?: string): Crumb[] {
  if (COMPANY_ADMIN_VIEWS.has(route.view)) return [{ label: '公司管理' }];
  if (route.view === 'hr') return [{ label: '人事管理' }];
  if (route.view === 'platform-admin') return [{ label: '平台运营', hideOnMobile: true }, { label: '平台管理' }];
  const base = route.view.split('/')[0], mod = getModuleByView(base as View);
  const label = (mod && productName(mod)) ?? LABELS[base] ?? base;
  const crumbs: Crumb[] = [{ label: mod ? GROUPS[mod.nav.group] : base === 'account' || base === 'company-settings' || base === 'workspace-settings' || base === 'approvals' || base === 'notifications' || base === 'search' ? '我的事务' : '设计系统', hideOnMobile: true }];
  if (route.view.includes('/')) {
    crumbs.push({ label, onClick: () => go(base) });
    crumbs.push(route.view.endsWith('/new') ? { label: base === 'orders' ? '新建订单' : route.id ? '继续开发草稿' : developmentCreateLabel(route.section) } : { label: objectLabel || route.id || '未指定对象', mono: true });
    if (route.versionId) crumbs.push({ label: versionLabel || route.versionId, mono: true });
  } else crumbs.push({ label });
  return crumbs;
}
function AppInner({ theme, setTheme }: { theme: ThemeMode; setTheme: (theme: ThemeMode) => void }) {
  const locale = useInterfaceLanguage();
  const session = useMistSession(), toast = useToast(), workspace = useMistWorkspace(), claimedUpload = useClaimedUploadRecovery();
  const {state} = workspace;
  const platformOnly = session.user?.platformRole === 'platform_admin' && !session.user.roleIds?.length;
  const platformCompany = session.user?.platformCompany;
  const canAI = session.hasPermission('ai:chat') && !platformOnly && !platformCompany;
  const canCreateDevelopment = session.hasPermission('products:write');
  const [exitingSupport, setExitingSupport] = React.useState(false);
  const organization = useOrganizationContext();
  const [organizationOpen, setOrganizationOpen] = React.useState(false);
  const visibleNotifications=visibleMistNotifications(state,view=>session.canAccessView(view as View));
  const dailyDigest=mistDailyDigest(state,platformBusinessDate(businessNow()),view=>session.canAccessView(view as View));
  const canDevelopment=session.canAccessView('development' as View), canOrders=session.canAccessView('orders' as View), canCustomers=session.canAccessView('crm' as View), canProduction=session.canAccessView('production-board' as View);
  const [route, setRoute] = React.useState<Route>(readMistRoute);
  const personalSection = personalSettingsSection(route);
  const documentTitle = pageDocumentTitle(personalSection ? 'account' : session.status === 'anonymous' && publicEntryForHost(location.host) === 'platform' ? 'platform-login' : route.view, { anonymous: session.status === 'anonymous', loading: session.status === 'loading', platformOnly, mustChangePassword: !session.localMode && session.user?.mustChangePassword, invitation: new URLSearchParams(location.search).get('kind') === 'invite' });
  React.useEffect(() => { document.title = localizedPageTitle(documentTitle); }, [documentTitle, locale]);
  const scrollPosition = React.useRef<{ key: string; route: Route; list: boolean }>(null as never);
  if (!scrollPosition.current) { const list = typeof history.state?.mistListState === 'boolean' ? history.state.mistListState : isListState(route); scrollPosition.current = { key: scrollKeyOf(route, list), route, list }; }
  const [collapsed, setCollapsed] = React.useState(false);
  const [palette, setPalette] = React.useState(false), [query, setQuery] = React.useState('');
  const [ai, setAI] = React.useState(false);
  React.useEffect(()=>{if(!canAI)setAI(false);},[canAI]);
  const [notifications, setNotifications] = React.useState(false);
  const [msgs, setMsgs] = React.useState<ChatMessage[]>([]);
  const [aiBusy,setAiBusy]=React.useState(false),[aiUseRouteSource,setAiUseRouteSource]=React.useState(false);
  const aiScope=session.sessionKey+':'+(workspace.workspace?.id??'');
  React.useEffect(() => {
    const workspaceId = workspace.workspace?.id;
    if (!workspaceId || !state?.market?.products?.length || workspace.loading) return;
    const scope = `${session.sessionKey}:${session.user?.id || ''}:${workspaceId}`;
    const files = new Map(state.files.map(file => [file.id, file]));
    // 只预取主图的抠图派生；补充图在用户切换到它时才按普通预览读取。
    const productPaths = state.market.products.flatMap(product => {
      const id = primaryImageId(files, product.fileIds), file = id ? files.get(id) : undefined; if (!file) return [];
      const base = workspace.fileUrl(file); return [`${base}?preview=cutout-thumb`, `${base}?preview=cutout-display`];
    });
    const developmentIds=[...state.devs,...state.versions].flatMap(owner=>{const id=primaryImageId(files,owner.fileIds);return id?[id]:[];});
    const developmentPaths=[...new Set(developmentIds)].flatMap(id=>{const file=files.get(id);return file?[`${workspace.fileUrl(file)}?preview=cutout-display`]:[];});
    const paths=[...productPaths,...developmentPaths];
    return schedulePrivateImagePrefetch(scope, paths);
  }, [session.sessionKey, session.user?.id, workspace.workspace?.id, workspace.loading, workspace.workspace?.revision]);
  React.useEffect(() => () => clearPrivateImages(), [session.sessionKey, workspace.workspace?.id]);
  const aiCurrent=React.useRef(aiScope);aiCurrent.current=aiScope;
  const aiMounted=React.useRef(true),aiController=React.useRef<AbortController|null>(null),aiRun=React.useRef<symbol|null>(null);
  const aiHistory=React.useRef<Array<{role:'user'|'assistant';content:string}>>([]);
  React.useEffect(()=>{aiMounted.current=true;return()=>{aiMounted.current=false;aiController.current?.abort();aiRun.current=null;};},[]);
  React.useEffect(()=>{aiController.current?.abort();aiController.current=null;aiRun.current=null;aiHistory.current=[];setAiBusy(false);setAiUseRouteSource(false);},[aiScope]);
  React.useEffect(()=>setAiUseRouteSource(false),[route.view,route.id]);
  const sections = useSections();
  React.useEffect(() => {
    if (session.status !== 'authenticated' || session.user?.mustChangePassword || (!platformOnly && workspace.loading)) return;
    const views = sections.flatMap(section => section.items.map(item => item.id));
    // Details and creation pages are prepared only when their parent module is visible.
    if (views.includes('orders')) views.push('orders/detail', 'orders/new');
    if (views.includes('development')) views.push('development/detail', 'development/new');
    for (const view of ['approvals', 'notifications', 'search']) {
      if (canOpenMistView({ view }, { canAccessView: session.canAccessView, hasPermission: session.hasPermission, platformOperator: session.user?.platformRole === 'platform_admin' }, REFERENCE_PREVIEW)) views.push(view);
    }
    const pages = [AccountPage, ...views.map(view => PAGES[view]).filter((page): page is React.FC => !!page)];
    if (platformOnly) pages.push(PlatformSettingsPage);
    if (platformCompany) pages.push(PlatformCompanySettingsPage);
    return preloadPagesWhenIdle(pages);
  }, [sections, session.status, session.sessionKey, session.user?.mustChangePassword, session.canAccessView, session.hasPermission, session.user?.platformRole, platformOnly, !!platformCompany, workspace.loading]);
  // 侧栏「开发与寻样」回到本次会话最近查看的页签；未查看过时为「成衣开发」。
  const lastDevelopmentTab = React.useRef<DevelopmentListTab>('garment');
  if (route.view === 'development') lastDevelopmentTab.current = developmentListTab(route.section);
  const go = React.useCallback((view: string, id?: string, target: RouteTarget = {}, options: GoOptions = {}) => {
    const next = { view, id, ...target }, list = isListState(next, options);
    scrollPosition.current = { key: nextScrollKey(scrollPosition.current, next, list), route: next, list };
    setRoute(next); writeMistRoute(next, options); setPalette(false); setAI(false); setNotifications(false);
    if (view === 'cockpit') window.dispatchEvent(new CustomEvent('bambook:mist-workbench-refresh'));
  }, [toast]);
  // 平台会话退出后回到平台管理登录，不落到公司登录页。
  const platformSession = React.useRef(false);
  React.useEffect(() => {
    if (platformOnly || platformCompany) platformSession.current = true;
    else if (session.status === 'anonymous' && platformSession.current) { platformSession.current = false; go('platform-login'); }
  }, [platformOnly, platformCompany, session.status, go]);
  React.useEffect(() => {
    if (publicEntryForHost(location.host) === 'platform' && platformOnly && !personalSection
      && !['platform-admin','system-settings','settings','platform-login','platform-recovery','account-access'].includes(route.view)) go('platform-admin');
  }, [platformOnly, personalSection, route.view, go]);
  // 公司管理会话保持在当前公司的管理页面。
  React.useEffect(() => { if (platformCompany && !personalSection && !COMPANY_MANAGEMENT_VIEWS.includes(route.view.split('/')[0])) go('company-settings'); }, [platformCompany, personalSection, route.view, go]);
  const exitManagement = async () => {
    setExitingSupport(true);
    try { await exitCompanyManagement(); go('platform-admin', platformCompany?.companyId); } catch (failure) { report(failure); } finally { setExitingSupport(false); }
  };
  React.useEffect(() => { if (personalSection && session.status === 'authenticated') go('account', undefined, { section: personalSection }); }, [personalSection, session.status, go]);
  React.useEffect(() => {
    const back = () => { const next = readMistRoute(), list = typeof history.state?.mistListState === 'boolean' ? history.state.mistListState : isListState(next); scrollPosition.current = { key: nextScrollKey(scrollPosition.current, next, list), route: next, list }; setRoute(next); setPalette(false); setAI(false); if (next.view === 'cockpit') window.dispatchEvent(new CustomEvent('bambook:mist-workbench-refresh')); };
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back);
  }, []);
  React.useEffect(() => { setPalette(false); setAI(false); setNotifications(false); setOrganizationOpen(false); setMsgs([]); }, [session.sessionKey, workspace.workspace?.id]);
  const previousLocalActor = React.useRef<string|undefined>(undefined);
  React.useEffect(() => {
    if (!session.localMode || session.status !== 'authenticated') return;
    if (route.view === 'login' || previousLocalActor.current && previousLocalActor.current !== session.user?.id) go('cockpit');
    previousLocalActor.current = session.user?.id;
  }, [session.localMode, session.status, session.user?.id, route.view, go]);
  const previousSpace = React.useRef<{session:string;id?:string}>({session:session.sessionKey});
  React.useEffect(()=>{
    const id=workspace.workspace?.id, previous=previousSpace.current;
    if(previous.session!==session.sessionKey){previousSpace.current={session:session.sessionKey,id};return;}
    if(id){if(previous.id&&previous.id!==id)go('cockpit');previousSpace.current={session:session.sessionKey,id};}
  },[session.sessionKey,workspace.workspace?.id,go]);
  React.useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(resolveTheme(readThemePreference()));
    sync(); media.addEventListener?.('change', sync);
    const off = onThemePreference(sync);
    return () => { media.removeEventListener?.('change', sync); off(); };
  }, [setTheme]);
  const reducedMotion = useDevice('reducedMotion');
  const density = useDevice('density');
  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('.mist-root');
    for (const key of ['--mist-dur-fast','--mist-dur','--mist-dur-slow']) {
      if (reducedMotion) root?.style.setProperty(key, '0s'); else root?.style.removeProperty(key);
    }
  }, [reducedMotion]);
  const report = (failure: unknown) => toast(failure instanceof Error ? failure.message : '操作未完成', 'bad');
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    writeThemePreference(next);
  };
  const routeBase=route.view.split('/')[0];
  const currentAiSource=route.id&&routeBase==='orders'&&canOrders&&session.hasPermission('orders:read')
    ?state?.orders.find(row=>row.id===route.id)
      ?{id:'orders:'+route.id,label:state.orders.find(row=>row.id===route.id)!.code,view:'orders/detail',entityId:route.id}:null
    :route.id&&routeBase==='invoices'&&session.hasPermission('invoices:read')
      ?state?.invoices.find(row=>row.id===route.id)
        ?{id:'invoices:'+route.id,label:state.invoices.find(row=>row.id===route.id)!.code,view:'invoices',entityId:route.id}:null
      :route.id&&routeBase==='risks'&&session.hasPermission('risk:read')
        ?state?.platform?.risks.find(row=>row.id===route.id)
          ?{id:'risks:'+route.id,label:state.platform.risks.find(row=>row.id===route.id)!.title,view:'risks',entityId:route.id}:null
        :null;
  const overview = (): ChatMessage => {
    if (!state) return {role:'assistant',content:'公司数据尚未读取，请稍后再试。'};
    const visibleDevs=canDevelopment?state.devs:[],visibleOrders=canOrders?state.orders:[],visibleTasks=state.tasks.filter(t=>session.canAccessView(t.target.view.split('/')[0] as View));
    const devs=visibleDevs.filter(d=>d.stage<4).slice(0,4),late=(canProduction?state.productions:[]).filter(p=>!p.closed&&p.col!=='done'&&p.due<platformBusinessDate(businessNow()));
    return {role:'assistant',content:<div><p>{uiText("当前公司有 ")}{visibleDevs.length}{uiText(" 个可见开发案、")}{visibleOrders.length}{uiText(" 张订单；")}{visibleTasks.filter(t=>!t.done).length}{uiText(" 项待办未完成，")}{late.length}{uiText(" 项生产已过交期。")}</p>{devs.map(d=><p key={d.id}><Button variant="quiet" onClick={()=>go('development/detail',d.id,{versionId:d.currentVersionId||undefined})}>{d.code} · {d.name} · {d.state}</Button></p>)}</div>,sources:[state.settings.workspaceName || '当前公司'],actions:<><Button disabled={!session.hasPermission('ai:chat')} onClick={()=>go('assistant')}>{uiText("进入完整助手")}</Button>{currentAiSource?<Button aria-pressed={aiUseRouteSource} disabled={aiBusy} onClick={()=>setAiUseRouteSource(value=>!value)}>{uiText(aiUseRouteSource?'取消引用：':'引用当前来源：')}{uiText(currentAiSource.label)}</Button>:null}</>};
  };
  const send = async (question:string,retrySources?:string[]) => {
    const content=question.trim();if(!content)return;
    const sourceIds=retrySources??(aiUseRouteSource&&currentAiSource?[currentAiSource.id]:[]);
    const available=()=>aiMounted.current&&aiCurrent.current===aiScope;
    if(!available())return;
    const errorMessage=(message:string):ChatMessage=>({role:'assistant',content:<p>{message}</p>,actions:<Button onClick={()=>void send(content,sourceIds)}>{uiText("重试此问题")}</Button>});
    if(aiRun.current){setMsgs(items=>[...items,{role:'user',text:content},errorMessage('上一个问题仍在处理。内容已保留，请等待完成后重试。')]);return;}
    if(!workspace.workspace?.id||workspace.loading){setMsgs(items=>[...items,{role:'user',text:content},errorMessage('公司数据尚未读取，请完成读取后重试。')]);return;}
    if(!canAI)return;
    if(content.length>4000){setMsgs(items=>[...items,{role:'user',text:content},{role:'assistant',content:'问题超过4000个字符，请缩短后重试。'}]);return;}
    const token=Symbol('assistant-run'),controller=new AbortController();aiRun.current=token;aiController.current=controller;setAiBusy(true);setMsgs(items=>[...items,{role:'user',text:content}]);
    try{
      const response=await fetch('/api/mist/workspaces/'+encodeURIComponent(workspace.workspace.id)+'/assistant',{method:'POST',headers:{...apiService.getAuthHeaders(),'Content-Type':'application/json','X-Bambook-Locale':interfaceLocale()},credentials:'include',signal:controller.signal,body:JSON.stringify({message:content,history:aiHistory.current.slice(-8).map(m=>({...m,content:m.content.slice(0,2000)})),sourceIds})});
      const result=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(result?.error?.message??'模型请求未完成，请重试');
      if(result?.mode!=='read_only'||typeof result.text!=='string'||!result.text.trim()||!Number.isSafeInteger(result.revision)||!Array.isArray(result.sources)||result.sources.some((source:any)=>!source||!sourceIds.includes(source.id)||typeof source.label!=='string'||typeof source.entityId!=='string'||!['orders/detail','invoices','risks'].includes(source.view)||source.id!==(source.view==='orders/detail'?'orders':source.view)+':'+source.entityId))throw new Error('助手响应格式无效，请重试');
      if(!available()||aiRun.current!==token)return;
      aiHistory.current=[...aiHistory.current,{role:'user',content},{role:'assistant',content:result.text}];
      setMsgs(items=>[...items,{role:'assistant',content:<><p style={{whiteSpace:'pre-wrap'}}>{result.text}</p>{result.truncated&&<p className="mist-note">{uiText("回复过长，已截断；可缩小问题范围继续询问。")}</p>}</>,actions:<>{result.sources.map((source:any)=><Button key={source.id} variant="quiet" onClick={()=>go(source.view,source.entityId)}>{uiText(source.label)}</Button>)}<Button onClick={()=>go('assistant')}>{uiText("进入完整助手")}</Button></>}]);
    }catch(error){if(available()&&aiRun.current===token&&!(error instanceof Error&&error.name==='AbortError'))setMsgs(items=>[...items,errorMessage(error instanceof Error?error.message:'模型服务暂不可用，请重试')]);}
    finally{if(available()&&aiRun.current===token){aiRun.current=null;aiController.current=null;setAiBusy(false);}}
  };
  const openAI = (prompt?: string) => {if(!canAI)return;setAI(true);setPalette(false);if(prompt)void send(prompt);};
  useHotkey('k', () => { if (session.status === 'authenticated') setPalette(value => !value); }, { meta: true });
  useHotkey('j', () => { if (session.status === 'authenticated') openAI(); }, { meta: true });
  const commands: CommandItem[] = [
    ...(state ? workspaceSearchRecords(state, view => session.canAccessView(view as View)).map(r => ({ id: r.view + '-' + r.id, group: r.group, label: r.label, hint: r.hint, keywords: r.keywords, icon: SEARCH_ICONS[r.group], run: () => go(r.view, r.id, r.target) })) : []),
    ...sections.flatMap(section => section.items.map(item => ({ id: 'go-' + item.id, group: '跳转', label: item.label, hint: section.label, icon: item.icon, run: () => navigateModule(item.id) }))),
    ...(canDevelopment ? DEVELOPMENT_LIST_TABS.flatMap(tab => {
      const list = developmentListTarget(tab.value), create = developmentCreateTarget(tab.value);
      return [
        { id: 'go-development-' + tab.value, group: '跳转', label: tab.label, hint: '开发与寻样', keywords: '开发与寻样 ' + tab.label, run: () => go(list.view, list.id, list.target) },
        ...(canCreateDevelopment ? [{ id: 'new-development-' + tab.value, group: '操作', label: tab.create, keywords: '新建 ' + tab.label, run: () => go(create.view, create.id, create.target) }] : []),
      ];
    }) : []),
    { id: 'approvals', group: '操作', label: '审批与放行', keywords: '审批 待我审批 放行 付款申请', icon: ClipboardList, run: () => go('approvals') },
    { id: 'notifications', group: '操作', label: '通知中心', keywords: '通知 提醒 未读 消息', icon: Bell, run: () => go('notifications') },
    { id: 'theme', group: '操作', label: '切换深浅色', icon: Moon, run: toggleTheme },
    ...(canAI ? [{ id: 'ai', group: '操作', label: '问小竹', hint: '⌘ J', icon: Sparkles, run: ()=>openAI() }] : []),
    ...(query.trim() ? [{ id: 'search-all', group: '搜索', label: '打开搜索结果页查看全部', keywords: query.trim(), icon: Search, run: () => go('search', undefined, { section: query.trim() }) }] : []),
  ];
  function navigateModule(id: string) {
    if (id !== 'development') { go(id); return; }
    const target = developmentListTarget(lastDevelopmentTab.current);
    go(target.view, target.id, target.target);
  }
  const nav = { route, go, theme, toggleTheme, openPalette: () => setPalette(true), openAI };
  if (['account-access','platform-recovery'].includes(route.view)) return <Nav.Provider value={nav}><AccountAccessPage key={route.view}/></Nav.Provider>;
  if (route.view === 'register' && publicEntryForHost(location.host) !== 'platform') return <Nav.Provider value={nav}><RegisterPage/></Nav.Provider>;
  if (session.status === 'loading') return null;
  if (session.status === 'anonymous' && (session.localMode || session.connectionModeUnverified)) return <MistPage width="narrow"><Card><CardHeader title={uiText("公司连接待核对")} sub={uiText(session.localMode?'本地工作身份由本机服务提供，无需输入旧账号密码。':'暂时无法确认当前公司，请重新连接后继续。')}/><div className="mist-card-body"><p>{session.error||'暂时无法读取公司会话，请重新连接。'}</p><Button variant="primary" loading={session.refreshing} onClick={()=>void session.refresh()}>{uiText(session.localMode?'重新进入本地身份':'重新连接公司')}</Button></div></Card></MistPage>;
  if (session.status === 'anonymous' || route.view === 'login' || route.view === 'platform-login') {
    // 平台管理入口与公司登录分开：platform-* 地址只显示平台登录。
    const platformEntry = loginEntryForHost(location.host, route.view) === 'platform';
    const loginGo = (view: string, id?: string) => {
      if (view === 'cockpit' && !['login', 'platform-admin', 'platform-login'].includes(route.view)) go(route.view, route.id, route); else go(view, id);
    };
    return <Nav.Provider value={{ ...nav, go: loginGo }}><LoginPage key={platformEntry ? 'platform' : 'company'} entry={platformEntry ? 'platform' : 'company'} /></Nav.Provider>;
  }
  if (!session.localMode && session.user?.mustChangePassword) return <ForcedPasswordChangePage />;
  const base = route.view.split('/')[0], module = getModuleByView(base as View);
  // 空间设置只处理本公司；不能为此授予系统设置/后台管理权限。
  const permitted = !!personalSection || canOpenMistView(route, { canAccessView: session.canAccessView, hasPermission: session.hasPermission, platformOperator: session.user?.platformRole === 'platform_admin' }, REFERENCE_PREVIEW) || platformOnly && ['system-settings','settings'].includes(route.view), live = LIVE_VIEWS.has(route.view) || MODULE_VIEW_SET.has(route.view) || COMPANY_ADMIN_VIEWS.has(route.view);
  const Page = personalSection ? AccountPage : platformCompany && COMPANY_ADMIN_VIEWS.has(route.view) ? PlatformCompanySettingsPage : platformOnly && ['system-settings','settings'].includes(route.view) ? PlatformSettingsPage
    : PAGES[route.view] ?? null;
  // 二级页（详情 / 新建）：应用内有上一页时按历史返回，直接打开链接时回到所属模块。
  const backTarget = route.view.includes('/') ? { view: base, label: (module && productName(module)) ?? LABELS[base] ?? '' } : null;
  const goBack = () => { if ((Number(history.state?.mistDepth) || 0) > 0) history.back(); else if (backTarget) go(backTarget.view); };
  const user = session.user!;
  const workspaceProfileName = state?.settings.profileName?.trim() || '';
  const name = (workspace.workspace?.ownerId === user.id ? workspaceProfileName : '') || user.displayName || user.email;
  const roles = platformOnly ? '平台管理员' : platformCompany ? '平台管理' : user.roleLabels?.filter(role => !role.name.endsWith('标准岗位补充')).map(role => role.name).join(' · ') || user.roles.map(role => ({ owner: '负责人', admin: '管理员', manager: '管理者', merchandiser: '业务员', finance: '财务', sales: '业务员', viewer: '查看人员', agent_operator: '助手操作员' })[role]).join(' · ');
  return (
    <Nav.Provider value={nav}><MistReviewProvider><MistDensityContext.Provider value={density||'default'}>
      <MistAppShell collapsed={collapsed} scrollKey={scrollPosition.current.key}
        sidebar={<CountedSidebar sections={sections} activeId={base === 'development' ? 'development' : COMPANY_ADMIN_VIEWS.has(base) && !(platformOnly && ['system-settings','settings'].includes(base)) ? 'company-settings' : base}
          onNavigate={navigateModule} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(value => !value)}
          workspace={platformOnly ? { symbol: 'S', name: 'Sylway Cloud', caption: '平台运营', onClick:()=>go('platform-admin') } : platformCompany ? { symbol: platformCompany.companyName.slice(0,1), name: platformCompany.companyName, caption: '平台管理', onClick:()=>go('company-settings') } : { symbol: organization.name.slice(0,1), name: organization.name, caption: organization.caption, expanded: organizationOpen, onClick:()=>{if(collapsed || matchMedia('(min-width: 761px) and (max-width: 1180px)').matches){go('account');return;}setOrganizationOpen(value=>!value);if(!organizationOpen)organization.retry();}, disclosure: <><dl><div><dt>{uiText('公司')}</dt><dd>{state?.settings.companyProfile?.legalName||'—'}</dd></div><div><dt>{uiText('部门')}</dt><dd>{user.department||'—'}</dd></div><div><dt>{uiText('小组')}</dt><dd>{uiText(organization.loading?'正在读取':organization.error?'读取失败':organization.teams.map(team=>team.name).join('、')||'未加入小组')}</dd></div></dl>{organization.error&&<button type="button" onClick={organization.retry}>{uiText('重新读取')}</button>}{session.canAccessView(View.SystemSettings)&&<button type="button" onClick={()=>{setOrganizationOpen(false);go('company-settings',undefined,{section:'profile'});}}>{uiText('公司资料')}</button>}</> }}
          account={{ name, caption: roles, avatarUrl: user.avatarUrl ?? undefined, onClick: () => go('account') }}
          onSearch={() => setPalette(true)}
          assistant={!canAI ? undefined : { title: '小竹', text: '查询当前公司的进展', onClick: ()=>openAI() }} />}
        topbar={scrolled => <MistTopbar scrolled={scrolled} onBack={backTarget ? goBack : undefined} backLabel={backTarget ? '返回' + backTarget.label : undefined} crumbs={platformOnly && ['system-settings','settings'].includes(route.view) ? [{label:'平台运营'},{label:'平台设置'}] : crumbsFor(route, go, state?.devs.find(d=>d.id===route.id)?.code || state?.orders.find(o=>o.id===route.id)?.code, state?.versions.find(v=>v.id===route.versionId)?.label)}
          sync={base === 'account' ? undefined : platformOnly ? { state: 'ok', text: '平台运营' } : platformCompany ? { state: 'ok', text: '平台管理' } : { state: workspace.error||workspace.pending&&!workspace.saving ? 'offline' : workspace.loading||workspace.saving ? 'syncing' : 'ok', text: workspace.saving ? '正在保存' : workspace.loading ? '读取公司数据' : workspace.pending ? '需要核对同步状态' : workspace.error ? (workspace.pendingCreate ? '需要核对同步状态' : '操作未完成') : live ? '已保存 · 公司' : '设计组件展示' }}
          theme={theme} onToggleTheme={toggleTheme} onSearch={() => setPalette(true)}
          extra={platformOnly || platformCompany ? undefined : <MistReviewButton/>} notifications={platformOnly || platformCompany ? undefined : { unread: visibleNotifications.some(n=>!n.readAt), onClick:()=>setNotifications(true) }} onAsk={!canAI ? undefined : ()=>openAI()} />}
      >
        {platformCompany && <Banner tone="neutral" title={ui`公司管理 · ${platformCompany.companyName}`} actions={<Button loading={exitingSupport} onClick={()=>void exitManagement()}>{uiText("返回平台")}</Button>}/>}
        {workspace.pendingCreate && !workspace.saving && <Banner tone="warn" title={uiText("历史数据创建结果需要核对")} actions={<Button onClick={()=>void workspace.createWorkspace(workspace.pendingCreate!.name,workspace.pendingCreate!.seed).catch(report)}>{uiText("核对创建结果")}</Button>}>{workspace.pendingCreate.name}{uiText("：将查询并继续同一次创建。")}</Banner>}
        {workspace.pending && !workspace.saving && !(workspace.pending.kind==='mail-send'&&route.view==='emails') && !(workspace.pending.kind==='command'&&route.view==='calendar') && !(workspace.pending.kind==='upload'&&claimedUpload===workspace.pending.requestId) && <Banner tone="warn" title={uiText("上次操作的结果需要核对")} actions={<Button loading={workspace.saving} onClick={()=>void workspace.recover().catch(report)}>{uiText("核对原请求")}</Button>}>{uiText("核对前会保留原请求，避免重复保存。")}{uiText(workspace.pending.kind==='upload'?'如尚未上传成功，请在原页面重新选择同一附件。':workspace.pending.kind==='mail-send'?'上次邮件发送未收到服务器回执；核对时使用原发送请求，已登记的不会重复投递。':'')}</Banner>}
        {workspace.error && !workspace.pending && <Banner tone="bad" title={uiText(workspace.error)} actions={<Button onClick={()=>void workspace.refresh()}>{uiText("重新读取")}</Button>} />}
        {!permitted ? <EmptyState icon={ShieldCheck} title={uiText("没有查看权限")} description={uiText("当前账号无法访问此业务。")} action={<Button onClick={() => go('cockpit')}>{uiText("返回我的工作")}</Button>} />
          : Page ? <MistPresentedErrorContext.Provider value={workspace.error||undefined}>{!route.id && !route.view.includes('/') && <ModuleWorkBar view={route.view} />}<PageLoadBoundary resetKey={route.view} fallback={retry=><MistPage><Banner tone="bad" title={uiText('页面未能加载')} actions={<Button onClick={retry}>{uiText('重新加载')}</Button>}/></MistPage>}><React.Suspense fallback={<PageLoading />}><Page key={session.sessionKey + ':' + workspace.workspace?.id + ':' + (MODULE_VIEW_SET.has(route.view)?route.view:JSON.stringify(route))} /></React.Suspense></PageLoadBoundary></MistPresentedErrorContext.Provider>
          : <EmptyState title={uiText("没有找到此页面")} action={<Button onClick={() => go('cockpit')}>{uiText("返回我的工作")}</Button>} />}
      </MistAppShell>
      <CommandPalette open={palette} onClose={() => setPalette(false)} query={query} onQueryChange={setQuery} items={commands} />
      <AssistantDrawer key={aiScope} open={ai} onClose={() => setAI(false)} messages={[overview(),...msgs,...(aiBusy?[{role:'typing'} as ChatMessage]:[])]} onSend={question=>void send(question)} sub={uiText(aiBusy?'正在生成':undefined)} suggestions={aiBusy?[]:['根据当前事实建议下一步','哪些信息还需要核实']} />
      <Drawer open={notifications} onClose={()=>setNotifications(false)} title={uiText("通知")} sub={uiText("来自当前公司的操作记录")}
        footer={<><Button variant="quiet" onClick={()=>{setNotifications(false);go('notifications');}}>{uiText("查看全部通知")}</Button><Button disabled={!visibleNotifications.some(n=>!n.readAt)} loading={workspace.saving} onClick={()=>void workspace.run({type:'notification.readAll',payload:{}}).catch(report)}>{uiText("全部标为已读")}</Button></>}>
        {state?.settings.notifications.digest&&<Card><CardHeader title={uiText("今日工作摘要")} sub={uiText("按当前记录生成 · 不发送邮件")}/><div className="mist-card-body">{dailyDigest.length?dailyDigest.map(item=><p key={item.id}><Button variant="quiet" onClick={()=>go(item.target.view,item.target.id,item.target)}>{uiText(item.label)} · {item.detail}</Button></p>):<p>{uiText("今天没有待处理事项。")}</p>}</div></Card>}
        {visibleNotifications.length?visibleNotifications.slice().reverse().map(n=><Card key={n.id}><CardHeader title={uiText(n.title)} sub={uiText(new Date(n.at).toLocaleString())} tools={<Button variant="quiet" onClick={()=>{void (n.readAt?Promise.resolve():workspace.run({type:'notification.read',payload:{id:n.id}})).then(()=>{if(n.target)go(n.target.view,n.target.id,n.target);}).catch(report);}}>{uiText(n.readAt?'查看':'阅读')}</Button>} /><p className="mist-card-body">{n.detail}</p></Card>):<EmptyState title={uiText("暂无通知")} />}
      </Drawer>
    </MistDensityContext.Provider></MistReviewProvider></Nav.Provider>
  );
}

function StartupGate() {
  const session = useMistSession();
  return <LegacyStartup ready={session.status !== 'loading'} />;
}

export function ReferenceApp() {
  const qs = new URLSearchParams(location.search);
  const [theme, setTheme] = React.useState<ThemeMode>(() => (qs.get('theme') as ThemeMode) || (document.documentElement.dataset.mistBootTheme as ThemeMode) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  React.useEffect(() => { try { localStorage.setItem('bambook.mist.boot-theme', theme); } catch {} document.documentElement.style.colorScheme = theme; document.body.style.background = theme === 'dark' ? '#101C35' : '#7FA3B3'; }, [theme]); // mist-allow: original outer-body background outside MistRoot
  return (
    <MistRoot theme={theme}>
      <ToastProvider>
        <MistSessionProvider>
          {qs.get('intro') !== '0' && <StartupGate />}
          <MistWorkspaceProvider><AppInner theme={theme} setTheme={setTheme} /></MistWorkspaceProvider>
        </MistSessionProvider>
      </ToastProvider>
    </MistRoot>
  );
}
