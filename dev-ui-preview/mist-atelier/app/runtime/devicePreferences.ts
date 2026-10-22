/** 设备偏好：只存本机浏览器，不写公司设置，点击即生效。 */
import React from 'react';
export type DeviceKey = 'theme' | 'density' | 'reducedMotion' | 'locale';
export type DeviceValues = { theme: 'light' | 'dark' | 'system'; density: 'compact' | 'default' | 'comfy'; reducedMotion: boolean; locale: 'zh-CN' | 'en-US' };
const DEFAULTS: DeviceValues = { theme: 'system', density: 'default', reducedMotion: false, locale: 'zh-CN' };
const PREFIX = 'bambook.device.', EVENT = 'bambook-device-preference';

export function readDevice<K extends DeviceKey>(key: K): DeviceValues[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw) as DeviceValues[K];
  } catch { /* 隐私模式或禁用存储：用默认值 */ }
  return DEFAULTS[key];
}
export function writeDevice<K extends DeviceKey>(key: K, value: DeviceValues[K]) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* 存不下也不影响当次切换 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}
export function useDevice<K extends DeviceKey>(key: K): DeviceValues[K] {
  const [value, setValue] = React.useState<DeviceValues[K]>(() => readDevice(key));
  React.useEffect(() => {
    const handler = (event: Event) => { if ((event as CustomEvent<DeviceKey>).detail === key) setValue(readDevice(key)); };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [key]);
  return value;
}
