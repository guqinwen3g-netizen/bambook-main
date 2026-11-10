import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MistMailOAuthProvider, mailOAuthTransport, mailOAuthTransportMatches, type MailOAuthFlow, type MailOAuthProvider } from './oauthProvider';

const NOW = Date.parse('2026-11-10T09:00:00Z');
const env = { MIST_MAIL_GOOGLE_CLIENT_ID: 'google-client', MIST_MAIL_GOOGLE_CLIENT_SECRET: 'google-secret', MIST_MAIL_MICROSOFT_CLIENT_ID: 'microsoft-client',
  MIST_MAIL_MICROSOFT_CLIENT_SECRET: 'microsoft-secret', MIST_MAIL_CREDENTIAL_KEY: 'k'.repeat(48), MIST_MAIL_CREDENTIAL_DIR: '/private/mail-test', MIST_MAIL_OAUTH_ORIGIN: 'https://mail-app.example.test' };
let key: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { key = await generateKeyPair('RS256'); });
const fakeFetch = vi.fn<typeof fetch>();
const client = (config: NodeJS.ProcessEnv = env, now = NOW) => new MistMailOAuthProvider(config, { fetch: fakeFetch, now: () => now, keys: () => async () => key.publicKey });
async function flow(provider: MailOAuthProvider = 'google') {
  const c = client(), started = await c.start({ provider, userId: 'user-1', sessionId: 'session-1', workspaceId: 'company-1' });
  return { c, started, flow: await c.readFlow(started.cookie, provider, new URL(started.authorizationUrl).searchParams.get('state'), 'user-1', 'session-1') };
}
async function response(f: MailOAuthFlow, claims: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) {
  const microsoft = f.provider === 'microsoft', tid = '9188040d-6c67-4c5b-b112-36a304b66dad';
  const token = await new SignJWT({ sub: 'provider-user', nonce: f.nonce, email: 'owner@example.test', name: 'Owner',
    ...(microsoft ? { tid } : { email_verified: true }), ...claims })
    .setProtectedHeader({ alg: 'RS256' }).setAudience(microsoft ? 'microsoft-client' : 'google-client')
    .setIssuer(microsoft ? `https://login.microsoftonline.com/${tid}/v2.0` : 'https://accounts.google.com')
    .setIssuedAt(NOW / 1000).setExpirationTime(NOW / 1000 + 3600).sign(key.privateKey);
  fakeFetch.mockResolvedValueOnce(Response.json({ access_token: 'access-only-server', refresh_token: 'refresh-only-server', expires_in: 3600, token_type: 'Bearer', id_token: token, ...fields }));
}

describe('邮箱 OAuth 服务商协议与浏览器绑定', () => {
  it('keeps unconfigured providers unavailable and refuses non-local plain HTTP callbacks', async () => {
    expect(client({}).status().every(p => !p.available)).toBe(true);
    expect(client({ ...env, MIST_MAIL_MICROSOFT_CLIENT_SECRET: '' }).status().map(p => p.available)).toEqual([true, false]);
    for (const origin of ['http://app.example.test', 'https://app.example.test/other', 'https://user:password@app.example.test', 'https://app.example.test/?return=evil']) {
      await expect(client({ ...env, MIST_MAIL_OAUTH_ORIGIN: origin }).start({ provider: 'google', userId: 'u', sessionId: 's', workspaceId: 'w' })).rejects.toMatchObject({ code: 'MAIL_OAUTH_NOT_CONFIGURED' });
    }
    expect(client({ ...env, MIST_MAIL_OAUTH_ORIGIN: 'http://localhost:3005' }).status().every(p => p.available)).toBe(true);
  });
  it.each(['google', 'microsoft'] as const)('uses %s official authorization, PKCE, nonce, state and an encrypted ten-minute request cookie', async provider => {
    const { c, started, flow: f } = await flow(provider), url = new URL(started.authorizationUrl);
    expect(url.hostname).toBe(provider === 'google' ? 'accounts.google.com' : 'login.microsoftonline.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(f.verifier).digest('base64url'));
    expect(url.searchParams.get('nonce')).toBe(f.nonce); expect(started.cookie).not.toContain(f.verifier);
    expect(started.authorizationUrl).not.toContain('secret'); expect(started.authorizationUrl).not.toContain('user-1');
    for (const [p, state, user, session] of [[provider, f.state + 'x', f.userId, f.sessionId], [provider, f.state, 'other', f.sessionId], [provider, f.state, f.userId, 'other'], [provider === 'google' ? 'microsoft' : 'google', f.state, f.userId, f.sessionId]] as const) {
      await expect(c.readFlow(started.cookie, p, state, user, session)).rejects.toMatchObject({ code: 'MAIL_OAUTH_STATE_INVALID' });
    }
    await expect(client(env, NOW + 601_000).readFlow(started.cookie, provider, f.state, f.userId, f.sessionId)).rejects.toMatchObject({ code: 'MAIL_OAUTH_STATE_INVALID' });
  });
  it.each(['google', 'microsoft'] as const)('verifies %s identity and exchanges the code only on the server', async provider => {
    const { c, flow: f } = await flow(provider); await response(f);
    const identity = await c.exchange(f, 'one-time-code');
    expect(identity).toMatchObject({ address: 'owner@example.test', displayName: 'Owner', grant: { provider, subject: 'provider-user', accessToken: 'access-only-server', refreshToken: 'refresh-only-server', expiresAt: NOW + 3600_000 } });
    const [, request] = fakeFetch.mock.calls.at(-1)!; const body = request!.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe(f.verifier); expect(body.get('client_secret')).toBe(provider + '-secret');
    expect(request!.redirect).toBe('error');
  });
  it('rejects unverified Google email, a different nonce, missing long-term consent and partial mail grants', async () => {
    const { c, flow: f } = await flow();
    for (const claims of [{ email_verified: false }, { nonce: 'another-login' }]) {
      await response(f, claims); await expect(c.exchange(f, 'code')).rejects.toMatchObject({ code: 'MAIL_OAUTH_IDENTITY_INVALID' });
    }
    await response(f, {}, { refresh_token: undefined }); await expect(c.exchange(f, 'code')).rejects.toMatchObject({ code: 'MAIL_OAUTH_FAILED' });
    await response(f, {}, { scope: 'openid email' }); await expect(c.exchange(f, 'code')).rejects.toMatchObject({ code: 'MAIL_OAUTH_SCOPE_MISSING' });
    const m = await flow('microsoft'); await response(m.flow, {}, { scope: 'https://outlook.office.com/IMAP.AccessAsUser.All' });
    await expect(m.c.exchange(m.flow, 'code')).rejects.toMatchObject({ code: 'MAIL_OAUTH_SCOPE_MISSING' });
  });
  it('rejects a signed ID token from another audience or issuer', async () => {
    const { c, flow: f } = await flow();
    for (const [audience, issuer] of [['another-app', 'https://accounts.google.com'], ['google-client', 'https://attacker.example.test']]) {
      const token = await new SignJWT({ sub: 's', email: 'owner@example.test', email_verified: true, nonce: f.nonce }).setProtectedHeader({ alg: 'RS256' }).setAudience(audience).setIssuer(issuer).setIssuedAt(NOW / 1000).setExpirationTime(NOW / 1000 + 3600).sign(key.privateKey);
      await response(f, {}, { id_token: token }); await expect(c.exchange(f, 'code')).rejects.toMatchObject({ code: 'MAIL_OAUTH_IDENTITY_INVALID' });
    }
  });
  it('refreshes privately and retains or rotates the refresh token as instructed by the provider', async () => {
    const { c, flow: f } = await flow('microsoft'); await response(f); const { grant } = await c.exchange(f, 'code');
    fakeFetch.mockResolvedValueOnce(Response.json({ access_token: 'next-access', token_type: 'Bearer', expires_in: 3600 }));
    expect(await c.refresh(grant)).toMatchObject({ accessToken: 'next-access', refreshToken: 'refresh-only-server' });
    fakeFetch.mockResolvedValueOnce(Response.json({ access_token: 'third-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 }));
    expect(await c.refresh(grant)).toMatchObject({ accessToken: 'third-access', refreshToken: 'rotated-refresh' });
    fakeFetch.mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: 'PRIVATE PROVIDER DETAIL' }, { status: 400 }));
    await expect(c.refresh(grant)).rejects.toMatchObject({ code: 'MAIL_OAUTH_RECONNECT', message: '邮箱授权已失效，请重新连接' });
  });
  it('pins OAuth mail settings to the provider, including Outlook personal and work SMTP', () => {
    const g = mailOAuthTransport('google', 'owner@example.test');
    expect(mailOAuthTransportMatches(g, 'owner@example.test', { provider: 'google' })).toBe(true);
    expect(mailOAuthTransportMatches({ ...g, smtpHost: 'attacker.example.test' }, 'owner@example.test', { provider: 'google' })).toBe(false);
    expect(mailOAuthTransportMatches(g, 'other@example.test', { provider: 'google' })).toBe(false);
    expect(mailOAuthTransport('microsoft', 'owner@example.test', '9188040d-6c67-4c5b-b112-36a304b66dad').smtpHost).toBe('smtp-mail.outlook.com');
    expect(mailOAuthTransport('microsoft', 'owner@example.test', '00000000-0000-0000-0000-000000000001').smtpHost).toBe('smtp.office365.com');
  });
  it('consumes a callback once across concurrent workers and a provider service restart', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-oauth-used-'));
    try {
      const config = { ...env, MIST_MAIL_CREDENTIAL_DIR: directory }, a = client(config), b = client(config), { flow: f } = await flow();
      const attempts = await Promise.allSettled([a.consumeFlow(f), b.consumeFlow(f)]);
      expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      await expect(client(config).consumeFlow(f)).rejects.toMatchObject({ code: 'MAIL_OAUTH_STATE_INVALID' });
      const files = await fs.readdir(path.join(directory, 'oauth-used')); expect(files).toHaveLength(1);
      const raw = await fs.readFile(path.join(directory, 'oauth-used', files[0]), 'utf8');
      expect(raw).not.toContain(f.state); expect(raw).not.toContain(f.verifier); expect(raw).not.toContain(f.userId);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
