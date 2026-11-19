import { View } from '../../../types';

export const COMPANY_SETTINGS_VIEWS = new Set(['system-settings', 'settings', 'company-settings', 'workspace-settings']);
/** 公司管理页的全部地址；任一分区可用即可进入，分区再按本人权限出现。 */
export const COMPANY_ADMIN_VIEWS = new Set([...COMPANY_SETTINGS_VIEWS, 'admin-panel']);
export const canOpenCompanyAdmin = (canAccessView: (view: View) => boolean) => canAccessView(View.SystemSettings) || canAccessView(View.AdminPanel);
const PERSONAL_VIEWS = new Set(['account', 'account-settings', 'approvals', 'notifications', 'search']);
const REGISTERED_VIEWS = new Set<string>(Object.values(View));

/** Old personal-setting links remain personal, even for people without company administration access. */
export function personalSettingsSection(route: { view: string; section?: string }): string | undefined {
  if (route.view === 'account-settings') return route.section || 'profile';
  if (!COMPANY_SETTINGS_VIEWS.has(route.view)) return undefined;
  if (route.section === 'account') return 'profile';
  return route.section === 'appearance' || route.section === 'security' ? route.section : undefined;
}

/** Read pages and creation URLs have distinct requirements, including query-driven creation. */
export function canOpenMistView(target: string | { view: string; id?: string; section?: string }, context: { canAccessView: (view: View) => boolean; platformOperator: boolean; hasPermission?: (scope: string) => boolean }, referencePreview: boolean): boolean {
  const view = typeof target === 'string' ? target : target.view;
  const sourcingCreate = typeof target !== 'string' && view === 'development' && target.section === 'sourcing' && target.id === 'new';
  const write = view === 'development/new' || sourcingCreate ? 'products:write' : view === 'orders/new' ? 'orders:write' : undefined;
  if (write && !context.hasPermission?.(write)) return false;
  if (COMPANY_ADMIN_VIEWS.has(view)) return canOpenCompanyAdmin(context.canAccessView);
  if (PERSONAL_VIEWS.has(view)) return true;
  if (view === 'platform-admin') return context.platformOperator;
  if (view === 'states' || view === 'design-system') return referencePreview;
  const base = view.split('/')[0];
  return REGISTERED_VIEWS.has(base) && context.canAccessView(base as View);
}

/** 服务端因未配置审批人而拒绝提交（订单、出运、供应商承诺等）。 */
export const approverMissing = (message: string) => /尚未配置.*审批(负责)?人|尚无除申请人外的有效订单审批负责人|未能解析独立的业务审批负责人|申请人以外的.*审批人/.test(message);
/** 只能由管理员在公司设置里补上的缺口：失败提示直接给出去处，而不是“重新读取”。 */
export function settingsGap(message: string): { section: 'approvals' | 'profile' | 'jobs'; label: string; ask: string } | null {
  if (/没有可审批「[^」]+」的审批人|授予「[^」]+」.*审批权限/.test(message)) return { section: 'jobs', label: '配置岗位权限', ask: '请管理员在 设置 · 岗位与权限 中授予该档审批权限' };
  if (approverMissing(message)) return { section: 'approvals', label: '设置审批资格', ask: '请管理员在 设置 · 审批资格 中指定' };
  if (/补全公司抬头/.test(message)) return { section: 'profile', label: '补全公司资料', ask: '请管理员在 设置 · 公司资料 中补全' };
  return null;
}
