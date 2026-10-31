import { BAMBOOK_PUBLIC_ORIGINS } from '../../../../server/src/shared/bambookPublicOrigins';

/** Web stays at its own application mount; packaged Electron opens the current service's manual. */
export function manualUrl(locationHref: string, applicationBase = '/', apiBase = ''): string {
  const current = new URL(locationHref);
  if (current.protocol === 'http:' || current.protocol === 'https:') {
    const base = new URL(applicationBase, current);
    // A CDN asset base must not move the employee manual to another service.
    const pathname = base.origin === current.origin ? base.pathname.replace(/\/?$/, '/') : '/';
    return new URL(pathname + 'manual/', current.origin).href;
  }
  try {
    const endpoint = new URL(apiBase);
    if (['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password) return new URL('/manual/', endpoint.origin).href;
  } catch { /* Relative API bases have no origin in a packaged renderer. */ }
  return new URL('/manual/', BAMBOOK_PUBLIC_ORIGINS.company).href;
}
