/** Public product addresses; credentials and infrastructure identifiers never belong here. */
export const BAMBOOK_PUBLIC_ORIGINS = {
  company: 'https://bambook.sylway.cloud',
  platform: 'https://bambook-admin.sylway.cloud',
  customer: 'https://bambook-customer.sylway.cloud',
  supplier: 'https://bambook-supplier.sylway.cloud',
} as const;
export type PublicEntry = 'company' | 'platform';
const companyHost = BAMBOOK_PUBLIC_ORIGINS.company.slice('https://'.length);
const platformHost = BAMBOOK_PUBLIC_ORIGINS.platform.slice('https://'.length);

export function publicHostname(host: string): string {
  if (!host || /[\s/@\\?#]/.test(host)) return '';
  try { return new URL('http://' + host).hostname.toLowerCase().replace(/\.$/, ''); }
  catch { return ''; }
}
export function publicEntryForHost(host: string): PublicEntry | null {
  const name = publicHostname(host);
  if (name === platformHost) return 'platform';
  if (name === companyHost || name === 'bambook-dev.sylway.cloud') return 'company';
  return null;
}
export function loginEntryForHost(host: string, view: string): PublicEntry {
  return publicEntryForHost(host) ?? (view.startsWith('platform') ? 'platform' : 'company');
}
export function samePublicOrigin(host: string, origin?: string): boolean {
  if (!origin || !publicEntryForHost(host)) return false;
  try { const url = new URL(origin); return url.origin === origin && url.protocol === 'https:' && url.hostname === publicHostname(host) && !url.port; }
  catch { return false; }
}
/** The admin origin never grants credentialed browser access to another origin. */
export function publicOriginAllowed(host: string, origin?: string): boolean {
  if (!origin) return true;
  const entry = publicEntryForHost(host);
  if (!entry) return true;
  if (entry === 'platform') return samePublicOrigin(host, origin);
  try { return publicEntryForHost(new URL(origin).host) !== 'platform'; }
  catch { return false; }
}
