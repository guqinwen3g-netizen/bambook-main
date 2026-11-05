import { describe, expect, it } from 'vitest';
import { DESKTOP_DEFAULT_ORIGIN, desktopAppOrigin, isTrustedOrigin, trustedOrigins } from './appOrigin';

describe('desktop app origin', () => {
  it('defaults to the company HTTPS site and accepts only a bare https override', () => {
    expect(DESKTOP_DEFAULT_ORIGIN).toBe('https://bambook.sylway.cloud');
    expect(desktopAppOrigin({})).toBe(DESKTOP_DEFAULT_ORIGIN);
    expect(desktopAppOrigin({ BAMBOOK_DESKTOP_ORIGIN: 'https://bambook-dev.sylway.cloud' })).toBe('https://bambook-dev.sylway.cloud');
    expect(desktopAppOrigin({ BAMBOOK_DESKTOP_ORIGIN: 'https://bambook-dev.sylway.cloud/' })).toBe('https://bambook-dev.sylway.cloud');
    for (const bad of ['http://bambook.sylway.cloud', 'https://u:p@evil.example', 'https://evil.example/path', 'https://evil.example/?x=1', 'file:///tmp/index.html', 'not a url'])
      expect(desktopAppOrigin({ BAMBOOK_DESKTOP_ORIGIN: bad })).toBe(DESKTOP_DEFAULT_ORIGIN);
  });

  it('trusts only exact origins, never file:// or look-alike hosts', () => {
    const allowed = trustedOrigins('https://bambook.sylway.cloud', 'http://localhost:5173/');
    expect(allowed).toEqual(['https://bambook.sylway.cloud', 'http://localhost:5173']);
    expect(isTrustedOrigin('https://bambook.sylway.cloud/?view=assistant', allowed)).toBe(true);
    expect(isTrustedOrigin('http://localhost:5173/index.html', allowed)).toBe(true);
    for (const url of ['file:///Users/x/out/renderer/index.html', 'https://bambook.sylway.cloud.evil.example/', 'http://bambook.sylway.cloud/', 'https://bambook.sylway.cloud:8443/', 'https://u:p@bambook.sylway.cloud/', 'about:blank', 'garbage'])
      expect(isTrustedOrigin(url, allowed)).toBe(false);
  });

  it('without a dev server only the company origin is trusted', () => {
    expect(trustedOrigins('https://bambook.sylway.cloud')).toEqual(['https://bambook.sylway.cloud']);
    expect(trustedOrigins('https://bambook.sylway.cloud', 'not a url')).toEqual(['https://bambook.sylway.cloud']);
  });
});
