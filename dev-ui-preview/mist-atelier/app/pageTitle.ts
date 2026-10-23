import { BAMBOOK_BRAND } from '../../../server/src/shared/brand';
import { getModuleByView } from '../../../components/moduleRegistry';
import type { View } from '../../../types';

export const PAGE_LABELS: Record<string, string> = { account: '我的账号', 'platform-admin': '平台管理', 'design-system': '设计系统', states: '空 / 加载 / 错误', 'system-settings': '系统设置', settings: '系统设置', 'company-settings': '公司设置', 'workspace-settings': '公司设置', approvals: '审批与放行', search: '搜索结果', notifications: '通知中心' };
type TitleContext = { anonymous?: boolean; loading?: boolean; platformOnly?: boolean; mustChangePassword?: boolean; invitation?: boolean };

/** Titles describe the rendered page, never an unauthenticated URL's requested business route. */
export function pageDocumentTitle(view: string, context: TitleContext = {}): string {
  let label: string | undefined;
  if (view === 'register') label = '账户开通';
  else if (view === 'platform-recovery') label = '找回密码';
  else if (view === 'account-access') label = context.invitation ? '设置登录密码' : '重置密码';
  else if (context.loading) return BAMBOOK_BRAND.name;
  else if (context.anonymous || view === 'login') label = '登录';
  else if (context.mustChangePassword) label = '修改密码';
  else if (['system-settings', 'settings'].includes(view)) label = context.platformOnly ? '平台设置' : '公司设置';
  else {
    const details: Record<string, string> = { 'orders/new': '新建订单', 'orders/detail': '订单详情', 'development/new': '新建开发案', 'development/detail': '开发案详情' };
    const base = view.split('/')[0];
    label = details[view] ?? PAGE_LABELS[base] ?? getModuleByView(base as View)?.productLabel.replace('（开发中）', '');
  }
  return label ? `${BAMBOOK_BRAND.name} · ${label}` : BAMBOOK_BRAND.name;
}
