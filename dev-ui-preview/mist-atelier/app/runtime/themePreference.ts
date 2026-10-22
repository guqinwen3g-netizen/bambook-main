/** 深浅色是个人偏好：只存本机浏览器，不写公司设置；点击即生效。 */
export type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'bambook.theme-preference', EVENT = 'bambook-theme-preference';

export function readThemePreference(): ThemePreference {
  try { const value = localStorage.getItem(KEY); if (value === 'light' || value === 'dark' || value === 'system') return value; } catch {}
  return 'system';
}
export function writeThemePreference(value: ThemePreference) {
  try { localStorage.setItem(KEY, value); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}
export const resolveTheme = (value: ThemePreference): 'light' | 'dark' => value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
export function onThemePreference(listener: (value: ThemePreference) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<ThemePreference>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
