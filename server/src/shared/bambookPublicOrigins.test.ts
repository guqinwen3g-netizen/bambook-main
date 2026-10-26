import { describe, expect, it } from 'vitest';
import { BAMBOOK_PUBLIC_ORIGINS, loginEntryForHost, publicEntryForHost, publicHostname, publicOriginAllowed } from './bambookPublicOrigins';
describe('public Bambook entries', () => {
  it.each([
    ['bambook.sylway.cloud','platform-login','company'],
    ['bambook-admin.sylway.cloud','cockpit','platform'],
    ['BAMBOOK-ADMIN.SYLWAY.CLOUD:443','register','platform'],
    ['bambook-dev.sylway.cloud','platform-login','company'],
    ['localhost:3002','platform-login','platform'],
    ['localhost:3002','login','company'],
  ])('resolves %s at %s to %s', (host, view, expected) => expect(loginEntryForHost(host, view)).toBe(expected));
  it.each(['bambook-admin.sylway.cloud.evil.test','evil.test','bambook-customer.sylway.cloud','bambook-supplier.sylway.cloud'])('does not activate a portal for %s', host => expect(publicEntryForHost(host)).toBeNull());
  it.each(['admin@bambook-admin.sylway.cloud','bambook-admin.sylway.cloud/path','bambook-admin.sylway.cloud?x=1'])('rejects malformed host %s', host => expect(publicHostname(host)).toBe(''));
  it('keeps customer and supplier addresses reserved separately', () => {
    expect(BAMBOOK_PUBLIC_ORIGINS.customer).toBe('https://bambook-customer.sylway.cloud');
    expect(BAMBOOK_PUBLIC_ORIGINS.supplier).toBe('https://bambook-supplier.sylway.cloud');
  });
  it('does not grant browser access between public company and platform origins', () => {
    expect(publicOriginAllowed('bambook-admin.sylway.cloud','https://bambook.sylway.cloud')).toBe(false);
    expect(publicOriginAllowed('bambook.sylway.cloud','https://bambook-admin.sylway.cloud')).toBe(false);
    expect(publicOriginAllowed('bambook-admin.sylway.cloud','https://evil.test')).toBe(false);
    expect(publicOriginAllowed('bambook-admin.sylway.cloud','https://user@bambook-admin.sylway.cloud')).toBe(false);
    expect(publicOriginAllowed('bambook-admin.sylway.cloud','https://bambook-admin.sylway.cloud')).toBe(true);
    expect(publicOriginAllowed('bambook-admin.sylway.cloud')).toBe(true);
  });
});
