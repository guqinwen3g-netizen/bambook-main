import React from 'react';

/** 页面按需加载：登录页与外壳先到，进入哪个页面再取哪个页面的代码。 */
type PageModule = Record<string, unknown>;
const cache = new Map<() => Promise<PageModule>, Promise<PageModule>>();
const load = (loader: () => Promise<PageModule>) => {
  let pending = cache.get(loader);
  if (!pending) { pending = loader().catch(failure => { cache.delete(loader); throw failure; }); cache.set(loader, pending); }
  return pending;
};
function page(loader: () => Promise<PageModule>, pick: (module: PageModule) => unknown): React.LazyExoticComponent<React.FC> {
  return React.lazy(async () => ({ default: pick(await load(loader)) as React.FC }));
}
const named = (loader: () => Promise<PageModule>, name: string) => page(loader, module => module[name]);
const mapped = (loader: () => Promise<PageModule>, map: string, view: string) => page(loader, module => (module[map] as Record<string, React.FC>)[view]);

const fulfillment = () => import('./pages/modules/FulfillmentPages');
const market = () => import('./pages/modules/MarketPages');
const platform = () => import('./pages/modules/PlatformPages');
const settings = () => import('./pages/SettingsPage');
const account = () => import('./pages/AccountPage');

/** 按 view 作为页面身份的模块页；与各模块文件导出的映射保持一致（测试核对）。 */
export const MODULE_VIEWS = {
  FULFILLMENT_PAGES: ['samples', 'qc-workbench', 'shipments', 'procurement', 'inventory', 'customs', 'document-center', 'mes'],
  MARKET_PAGES: ['products', 'quotations', 'suppliers', 'relations', 'seasons', 'marketing'],
  PLATFORM_PAGES: ['invoices', 'pricing', 'bom', 'risks', 'claims', 'reports', 'dashboard', 'data-center', 'hr', 'business-tools', 'admin-panel', 'assistant'],
} as const;
export const MODULE_VIEW_SET = new Set<string>(Object.values(MODULE_VIEWS).flat());
const loaders = { FULFILLMENT_PAGES: fulfillment, MARKET_PAGES: market, PLATFORM_PAGES: platform };

export const AccountPage = named(account, 'AccountPage');
export const SettingsPage = named(settings, 'SettingsPage');
export const SaasAdminPage = named(() => import('./pages/SaasAdminPage'), 'SaasAdminPage');
export const PlatformSettingsPage = named(() => import('./pages/PlatformSettingsPage'), 'PlatformSettingsPage');
export const PlatformCompanySettingsPage = named(() => import('./pages/PlatformCompanySettingsPage'), 'PlatformCompanySettingsPage');
export const LocalAdminPanel = named(() => import('./pages/modules/LocalAdminPanel'), 'LocalAdminPanel');
export const StatesPage = named(() => import('./pages/StatesPage'), 'StatesPage');
export const DesignSystemPage = named(() => import('./pages/DesignSystemPage'), 'DesignSystemPage');

export function buildPages(referencePreview: boolean): Record<string, React.FC> {
  const modules = Object.fromEntries(Object.entries(MODULE_VIEWS).flatMap(([map, views]) => views.map(view => [view, mapped(loaders[map as keyof typeof loaders], map, view)])));
  return {
    'platform-admin': SaasAdminPage, account: AccountPage, 'account-settings': AccountPage,
    ...modules,
    emails: named(() => import('./pages/modules/EmailsPage'), 'EmailsPage'),
    cockpit: named(() => import('./pages/HomePage'), 'HomePage'),
    development: named(() => import('./pages/DevListPage'), 'DevListPage'),
    'development/detail': named(() => import('./pages/DevDetailPage'), 'DevDetailPage'),
    'development/new': named(() => import('./pages/DevCreatePage'), 'DevCreatePage'),
    orders: named(() => import('./pages/OrderListPage'), 'OrderListPage'),
    'orders/detail': named(() => import('./pages/OrderDetailPage'), 'OrderDetailPage'),
    'orders/new': named(() => import('./pages/OrderCreatePage'), 'OrderCreatePage'),
    calendar: named(() => import('./pages/CalendarPage'), 'CalendarPage'),
    'payment-vouchers': named(() => import('./pages/FinancePage'), 'FinancePage'),
    crm: named(() => import('./pages/CustomerPage'), 'CustomerPage'),
    'production-board': named(() => import('./pages/ProductionPage'), 'ProductionPage'),
    'system-settings': SettingsPage, settings: SettingsPage, 'company-settings': SettingsPage, 'workspace-settings': SettingsPage,
    approvals: named(() => import('./pages/ApprovalsPage'), 'ApprovalsPage'),
    notifications: named(() => import('./pages/NotificationsPage'), 'NotificationsPage'),
    search: named(() => import('./pages/SearchPage'), 'SearchPage'),
    ...(referencePreview ? { states: StatesPage, 'design-system': DesignSystemPage } : {}),
  };
}

/** 页面代码下载失败（断网或发布后旧标签页）时给出重新加载，不让整个外壳白屏。 */
export class PageLoadBoundary extends React.Component<{ resetKey: string; fallback: (retry: () => void) => React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() { return this.state.failed ? this.props.fallback(() => location.reload()) : this.props.children; }
}
