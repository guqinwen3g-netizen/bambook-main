/** 深浅色是设备偏好（见 devicePreferences.ts）：只存本机浏览器，点击即生效。 */
import { readDevice, writeDevice, type DeviceValues } from './devicePreferences';
export type ThemePreference = DeviceValues['theme'];
export const readThemePreference = (): ThemePreference => readDevice('theme');
export const writeThemePreference = (value: ThemePreference) => writeDevice('theme', value);
export const resolveTheme = (value: ThemePreference): 'light' | 'dark' => value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
export function onThemePreference(listener: (value: ThemePreference) => void) {
  const handler = (event: Event) => { if ((event as CustomEvent).detail === 'theme') listener(readDevice('theme')); };
  window.addEventListener('bambook-device-preference', handler);
  return () => window.removeEventListener('bambook-device-preference', handler);
}
