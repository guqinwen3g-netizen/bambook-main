import { View } from '../../../types';

export const COMPANY_SETTINGS_VIEWS = new Set(['system-settings', 'settings', 'company-settings', 'workspace-settings']);
const PERSONAL_VIEWS = new Set(['account', 'account-settings', 'approvals', 'notifications', 'search']);
const REGISTERED_VIEWS = new Set<string>(Object.values(View));

/** Old personal-setting links remain personal, even for people without company administration access. */
export function personalSettingsSection(route: { view: string; section?: string }): string | undefined {
  if (route.view === 'account-settings') return route.section || 'profile';
  if (!COMPANY_SETTINGS_VIEWS.has(route.view)) return undefined;
  if (route.section === 'account') return 'profile';
  return route.section === 'appearance' || route.section === 'security' ? route.section : undefined;
}

/** Navigation and direct URLs use the same read permission; write actions retain their own guards. */
export function canOpenMistView(view: string, context: { canAccessView: (view: View) => boolean; platformOperator: boolean }, developmentBuild: boolean): boolean {
  if (COMPANY_SETTINGS_VIEWS.has(view)) return context.canAccessView(View.SystemSettings);
  if (PERSONAL_VIEWS.has(view)) return true;
  if (view === 'platform-admin') return context.platformOperator;
  if (view === 'states' || view === 'design-system') return developmentBuild;
  const base = view.split('/')[0];
  return REGISTERED_VIEWS.has(base) && context.canAccessView(base as View);
}
