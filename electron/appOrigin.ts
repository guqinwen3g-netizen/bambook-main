// Where the packaged desktop app loads the company workspace from, and which pages may use its bridges.
//
// The Mist runtime calls `/api/mist/*` and `/api/*` with same-origin relative URLs, and the work assistant binds
// delegations to the page's HTTP(S) origin. A bundled `file://` renderer can do neither, so the packaged main
// window loads the company site over HTTPS (same pages, same login as the web app). Only that origin may drive the
// main window or reach privileged bridges; everything else opens in the system browser.
import { BAMBOOK_PUBLIC_ORIGINS } from '../server/src/shared/bambookPublicOrigins';

export const DESKTOP_DEFAULT_ORIGIN = BAMBOOK_PUBLIC_ORIGINS.company;

/** `BAMBOOK_DESKTOP_ORIGIN` may point the desktop app at another company host; only a bare https origin is accepted. */
export function desktopAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BAMBOOK_DESKTOP_ORIGIN?.trim();
  if (!raw) return DESKTOP_DEFAULT_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) return DESKTOP_DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DESKTOP_DEFAULT_ORIGIN;
  }
}

/** True when `pageUrl` belongs to `allowed` (exact origin match). Dev origins are passed in explicitly by the caller. */
export function isTrustedOrigin(pageUrl: string, allowed: readonly string[]): boolean {
  try {
    const url = new URL(pageUrl);
    if (url.username || url.password) return false;
    return url.origin !== 'null' && allowed.includes(url.origin);
  } catch {
    return false;
  }
}

/** Origins allowed to drive the main window: the company site, plus the electron-vite dev server when present. */
export function trustedOrigins(appOrigin: string, devUrl?: string): string[] {
  const list = [appOrigin];
  if (devUrl) { try { list.push(new URL(devUrl).origin); } catch { /* ignore malformed dev url */ } }
  return list;
}
