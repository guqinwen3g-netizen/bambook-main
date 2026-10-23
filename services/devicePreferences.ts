/** 设备偏好：只存本机浏览器，不写公司设置，点击即生效。 */
import React from 'react';
export type DeviceKey = 'theme' | 'density' | 'reducedMotion' | 'locale';
export type DeviceValues = { theme: 'light' | 'dark' | 'system'; density: 'compact' | 'default' | 'comfy'; reducedMotion: boolean; locale: 'zh-CN' | 'en-US' };
const DEFAULTS: DeviceValues = { theme: 'system', density: 'default', reducedMotion: false, locale: 'zh-CN' };
const PREFIX = 'bambook.device.', EVENT = 'bambook-device-preference';
const transient: Partial<DeviceValues> = {};
const valid = (key: DeviceKey, value: unknown) => key === 'locale' ? ['zh-CN', 'en-US'].includes(String(value)) : key === 'theme' ? ['light', 'dark', 'system'].includes(String(value)) : key === 'density' ? ['compact', 'default', 'comfy'].includes(String(value)) : typeof value === 'boolean';

export function readDevice<K extends DeviceKey>(key: K): DeviceValues[K] {
  if (transient[key] !== undefined) return transient[key] as DeviceValues[K];
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null) { const value = JSON.parse(raw); if (valid(key, value)) return value; }
  } catch { /* 隐私模式或禁用存储：用默认值 */ }
  return DEFAULTS[key];
}
export function writeDevice<K extends DeviceKey>(key: K, value: DeviceValues[K]) {
  if (!valid(key, value)) return;
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); delete transient[key]; } catch { transient[key] = value; }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}
export function useDevice<K extends DeviceKey>(key: K): DeviceValues[K] {
  const [value, setValue] = React.useState<DeviceValues[K]>(() => readDevice(key));
  React.useEffect(() => {
    const handler = (event: Event) => { if ((event as CustomEvent<DeviceKey>).detail === key) setValue(readDevice(key)); };
    window.addEventListener(EVENT, handler);
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === PREFIX + key) { delete transient[key]; setValue(readDevice(key)); } };
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(EVENT, handler); window.removeEventListener('storage', storage); };
  }, [key]);
  return value;
}
