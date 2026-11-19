import { publicEntryForHost } from '../server/src/shared/bambookPublicOrigins';

/** Public company/platform pages keep credentials and API traffic on their own origin. */
export function publicEntryApiBase(): string | undefined {
  if (typeof location === 'undefined' || !publicEntryForHost(location.host)) return undefined;
  return `${location.origin}/api`;
}
