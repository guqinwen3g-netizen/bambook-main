import React from 'react';
import { readDevice, useDevice } from './devicePreferences';
import english from './locales/en-US.json';
import { reviewedEnglish } from './locales/en-US-reviewed';

export type InterfaceLocale = 'zh-CN' | 'en-US';
function systemLocale(): InterfaceLocale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const language = navigator.languages?.[0] || navigator.language;
  return /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en-US';
}
/** Resolve the local preference before formatting dates or sending it to AI. */
export function interfaceLocale(): InterfaceLocale {
  const preference = readDevice('locale');
  return preference === 'system' ? systemLocale() : preference;
}
const catalogue: Record<string, string> = { ...english, ...reviewedEnglish };
const patterns = Object.entries(catalogue).filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
  .map(([key, value]) => {
  const slots: number[] = [];
  const expression = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(Number(part.slice(1, -1))); return '([\\s\\S]*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { expression: new RegExp('^' + expression + '$'), value, slots };
});
const cache = new Map<string, string>();

export function localizedPageTitle(title: string): string {
  return title.split(' · ').map(uiText).join(' · ');
}

/** Translate interface copy only. Call sites must keep business content and form values intact. */
export function uiText<T>(source: T): T {
  if (typeof source !== 'string' || interfaceLocale() !== 'en-US') return source;
  const key = source.trim();
  let translated = catalogue[key] ?? cache.get(key);
  if (translated === undefined) for (const pattern of patterns) {
    const match = key.match(pattern.expression);
    if (!match) continue;
    const values = new Map(pattern.slots.map((slot, i) => [slot, match[i + 1]]));
    translated = pattern.value.replace(/\{(\d+)\}/g, (_, index) => values.get(Number(index)) ?? '');
    if (cache.size > 2000) cache.clear();
    cache.set(key, translated); break;
  }
  if (translated === undefined) return source;
  return (source.slice(0, source.length - source.trimStart().length) + translated + source.slice(source.trimEnd().length)) as T;
}

/** Whole-sentence interpolation keeps record names and numbers outside the catalogue. */
export function ui(strings: TemplateStringsArray, ...values: unknown[]): string {
  const key = strings.reduce((text, part, i) => text + (i ? `{${i - 1}}` : '') + part, '');
  const translated = interfaceLocale() === 'en-US' ? catalogue[key] ?? key : key;
  return translated.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
}

export function useInterfaceLanguage() {
  const preference = useDevice('locale');
  const [deviceLocale, setDeviceLocale] = React.useState(systemLocale);
  React.useEffect(() => {
    const update = () => setDeviceLocale(systemLocale());
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);
  const locale = preference === 'system' ? deviceLocale : preference;
  React.useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return locale;
}
