import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { EmailTransport } from '../../shared/mistEmail';
import { fail } from '../errors';

export type MailOAuthProvider = 'google' | 'microsoft';
export type MailOAuthGrant = {
  provider: MailOAuthProvider; subject: string; tenantId?: string;
  accessToken: string; refreshToken: string; expiresAt: number;
};
export type MailOAuthIdentity = { address: string; displayName: string; grant: MailOAuthGrant };
export type MailOAuthFlow = {
  provider: MailOAuthProvider; state: string; verifier: string; nonce: string;
  userId: string; sessionId: string; workspaceId: string; accountId?: string;
};
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const PROVIDERS = {
  google: {
    label: 'Google', authorization: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs', scopes: ['openid', 'email', 'profile', 'https://mail.google.com/'],
  },
  microsoft: {
    label: 'Microsoft', authorization: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send'],
  },
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const opaque = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };

/** Fixed provider destinations: neither a mailbox owner nor a callback can redirect a bearer token to another host. */
export function mailOAuthTransport(provider: MailOAuthProvider, address: string, tenantId?: string): EmailTransport {
  return provider === 'google'
    ? { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, username: address }
    : { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true, smtpHost: tenantId === PERSONAL_TENANT ? 'smtp-mail.outlook.com' : 'smtp.office365.com', smtpPort: 587, smtpSecure: false, username: address };
}
export function mailOAuthTransportMatches(transport: EmailTransport, address: string, grant: Pick<MailOAuthGrant, 'provider' | 'tenantId'>): boolean {
  const expected = mailOAuthTransport(grant.provider, address, grant.tenantId);
  return (Object.keys(expected) as Array<keyof EmailTransport>).every(key => expected[key] === transport[key]);
}

type Settings = { clientId: string; clientSecret: string; origin: string; redirectUri: string };
type Dependencies = { fetch?: typeof fetch; now?: () => number; keys?: (provider: MailOAuthProvider) => JWTVerifyGetKey };
/** Provider authorization only. This does not log into Bambook, create a Bambook identity or grant company permissions. */
export class MistMailOAuthProvider {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly keys: (provider: MailOAuthProvider) => JWTVerifyGetKey;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, dependencies: Dependencies = {}) {
    this.fetch = dependencies.fetch ?? fetch; this.now = dependencies.now ?? Date.now;
    const keys = { google: createRemoteJWKSet(new URL(PROVIDERS.google.jwks)), microsoft: createRemoteJWKSet(new URL(PROVIDERS.microsoft.jwks)) };
    this.keys = dependencies.keys ?? (provider => keys[provider]);
  }
  provider(value: unknown): MailOAuthProvider {
    if (value !== 'google' && value !== 'microsoft') fail('INVALID_INPUT', '请选择 Google 或 Microsoft 邮箱', 400);
    return value as MailOAuthProvider;
  }
  private settings(provider: MailOAuthProvider): Settings {
    const prefix = provider === 'google' ? 'MIST_MAIL_GOOGLE_' : 'MIST_MAIL_MICROSOFT_';
    const clientId = this.env[prefix + 'CLIENT_ID']?.trim(), clientSecret = this.env[prefix + 'CLIENT_SECRET']?.trim();
    let url: URL;
    try {
      url = new URL(this.env.MIST_MAIL_OAUTH_ORIGIN || this.env.BAMBOOK_PUBLIC_URL || '');
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    } catch { fail('MAIL_OAUTH_NOT_CONFIGURED', '平台尚未配置邮箱连接，请联系平台管理员', 503); }
    if (!clientId || !clientSecret || !this.env.MIST_MAIL_CREDENTIAL_KEY || this.env.MIST_MAIL_CREDENTIAL_KEY.length < 32 || !this.env.MIST_MAIL_CREDENTIAL_DIR) {
      fail('MAIL_OAUTH_NOT_CONFIGURED', `平台尚未配置 ${PROVIDERS[provider].label} 邮箱连接，请联系平台管理员`, 503);
    }
    return { clientId: clientId!, clientSecret: clientSecret!, origin: url!.origin, redirectUri: url!.origin + '/api/mist/email/oauth/callback/' + provider };
  }
  status() {
    return (['google', 'microsoft'] as const).map(provider => {
      try { this.settings(provider); return { provider, available: true, reason: '' }; }
      catch { return { provider, available: false, reason: `平台尚未配置 ${PROVIDERS[provider].label} 邮箱连接` }; }
    });
  }
  origin(provider: MailOAuthProvider) { return this.settings(provider).origin; }
  private cookieKey() {
    const value = this.env.MIST_MAIL_CREDENTIAL_KEY;
    if (!value || value.length < 32) fail('MAIL_OAUTH_NOT_CONFIGURED', '平台尚未配置邮箱连接', 503);
    return createHash('sha256').update('bambook-mail-oauth-state\0').update(value!).digest();
  }
  private desktopSignature(provider: MailOAuthProvider, value: string) {
    return createHmac('sha256', this.cookieKey()).update(provider + '/' + value).digest('base64url');
  }
  desktopReturn(provider: MailOAuthProvider, state: string, code: unknown, error: unknown) {
    const match = /^(desktop\.(\d{4,5})\.(\d{10})\.[\w-]{43})\.([\w-]{43})$/.exec(state);
    if (!match || Number(match[2]) < 1024 || Number(match[2]) > 65535 || Number(match[3]) <= this.now() / 1000 ||
      !equal(match[4], this.desktopSignature(provider, match[1]))) return fail('MAIL_OAUTH_STATE_INVALID', '邮箱连接已过期，请重新连接', 400);
    // Only a locally allocated port can vary. The host, path, provider and expiry are fixed or authenticated.
    const target = new URL('http://127.0.0.1:' + match[2] + '/mail/oauth/' + provider);
    target.searchParams.set('state', state);
    if (typeof error === 'string' && error) target.searchParams.set('error', error === 'access_denied' ? error : 'failed');
    else if (typeof code === 'string' && code && code.length <= 8192) target.searchParams.set('code', code);
    else return fail('MAIL_OAUTH_FAILED', '邮箱授权未完成，请重新连接', 400);
    return target.toString();
  }
  async start(input: Pick<MailOAuthFlow, 'provider' | 'userId' | 'sessionId' | 'workspaceId' | 'accountId'>, desktopPort?: number) {
    const config = this.settings(input.provider);
    let state = opaque();
    if (desktopPort !== undefined) {
      if (!Number.isSafeInteger(desktopPort) || desktopPort < 1024 || desktopPort > 65535) return fail('INVALID_INPUT', '桌面回程端口无效', 400);
      const value = ['desktop', desktopPort, Math.floor(this.now() / 1000) + 600, state].join('.');
      state = value + '.' + this.desktopSignature(input.provider, value);
    }
    const flow: MailOAuthFlow = { ...input, state, verifier: opaque(), nonce: opaque() };
    const url = new URL(PROVIDERS[input.provider].authorization);
    const values = { client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: PROVIDERS[input.provider].scopes.join(' '),
      state: flow.state, nonce: flow.nonce, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256',
      ...(input.provider === 'google' ? { access_type: 'offline', prompt: 'consent select_account' } : { response_mode: 'query', prompt: 'select_account' }) };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    const now = Math.floor(this.now() / 1000);
    const cookie = await new EncryptJWT({ ...flow }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuer('bambook-mail-oauth').setAudience('bambook-mail-callback').setIssuedAt(now).setExpirationTime(now + 600).encrypt(this.cookieKey());
    return { authorizationUrl: url.toString(), cookie };
  }
  async readFlow(cookie: unknown, provider: MailOAuthProvider, state: unknown, userId: string, sessionId: string): Promise<MailOAuthFlow> {
    try {
      if (typeof cookie !== 'string' || cookie.length > 4096 || typeof state !== 'string') throw new Error();
      const { payload } = await jwtDecrypt(cookie, this.cookieKey(), { issuer: 'bambook-mail-oauth', audience: 'bambook-mail-callback', currentDate: new Date(this.now()), keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
      if (payload.provider !== provider || payload.userId !== userId || payload.sessionId !== sessionId || typeof payload.state !== 'string' || !equal(payload.state, state) ||
        typeof payload.workspaceId !== 'string' || !payload.workspaceId || typeof payload.verifier !== 'string' || typeof payload.nonce !== 'string' ||
        payload.accountId !== undefined && typeof payload.accountId !== 'string') throw new Error();
      return { provider, state, userId, sessionId, workspaceId: payload.workspaceId, verifier: payload.verifier, nonce: payload.nonce, ...(payload.accountId ? { accountId: payload.accountId as string } : {}) };
    } catch { return fail('MAIL_OAUTH_STATE_INVALID', '邮箱连接已过期或不是当前登录发起的，请重新连接', 400); }
  }
  /** Atomic across workers and process restarts. Only a hash and timestamp are stored, never a code or token. */
  async consumeFlow(flow: MailOAuthFlow) {
    this.settings(flow.provider);
    const root = path.join(this.env.MIST_MAIL_CREDENTIAL_DIR!, 'oauth-used');
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(root, createHash('sha256').update(flow.state).digest('hex')), String(this.now()), { flag: 'wx', mode: 0o600 });
    } catch (error: any) {
      if (error?.code === 'EEXIST') return fail('MAIL_OAUTH_STATE_INVALID', '此邮箱授权已处理，请重新发起连接', 400);
      return fail('MAIL_CREDENTIAL_STORE_UNAVAILABLE', '邮箱授权暂时无法保存，请稍后重试', 503);
    }
    // A consumed request outlives its ten-minute cookie; cleanup is bounded and contains no mailbox data.
    try {
      const entries = await fs.opendir(root); let count = 0;
      for await (const entry of entries) {
        if (++count > 100) break;
        if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        const file = path.join(root, entry.name), stat = await fs.stat(file);
        if (stat.mtimeMs < this.now() - 15 * 60_000) await fs.unlink(file);
      }
    } catch { /* A cleanup failure never reopens a consumed authorization. */ }
  }
  private async token(provider: MailOAuthProvider, body: URLSearchParams) {
    let response: Response;
    try { response = await this.fetch(PROVIDERS[provider].token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { return fail('MAIL_OAUTH_UNAVAILABLE', '邮箱服务商暂时无法连接，请稍后重试', 502); }
    // Provider responses can contain tokens and identifiers: never put raw responses into logs or public errors.
    const data = await response!.json().catch(() => null) as Record<string, unknown> | null;
    if (!response!.ok || !data || typeof data.access_token !== 'string' || !data.access_token || String(data.token_type).toLowerCase() !== 'bearer' ||
      !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || Number(data.expires_in) > 86400) {
      return fail(data?.error === 'invalid_grant' ? 'MAIL_OAUTH_RECONNECT' : 'MAIL_OAUTH_FAILED', data?.error === 'invalid_grant' ? '邮箱授权已失效，请重新连接' : '邮箱授权未完成，请重新连接', 422);
    }
    if (typeof data.scope === 'string') {
      const granted = new Set(data.scope.split(/\s+/));
      const required = provider === 'google' ? ['https://mail.google.com/'] : ['https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send'];
      if (required.some(scope => !granted.has(scope))) fail('MAIL_OAUTH_SCOPE_MISSING', '收信或发信权限未授权，请重新连接并允许邮箱访问', 422);
    }
    return data;
  }
  async exchange(flow: MailOAuthFlow, code: unknown): Promise<MailOAuthIdentity> {
    if (typeof code !== 'string' || !code || code.length > 8192) fail('MAIL_OAUTH_FAILED', '邮箱授权未完成，请重新连接', 400);
    const config = this.settings(flow.provider), data = await this.token(flow.provider, new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: 'authorization_code', code: code as string, redirect_uri: config.redirectUri, code_verifier: flow.verifier }));
    if (typeof data.id_token !== 'string' || typeof data.refresh_token !== 'string' || !data.refresh_token) fail('MAIL_OAUTH_FAILED', '未取得持续收发授权，请重新连接', 422);
    let claims;
    try {
      const result = await jwtVerify(data.id_token as string, this.keys(flow.provider), { audience: config.clientId, algorithms: ['RS256'], currentDate: new Date(this.now()), requiredClaims: ['iss', 'sub', 'iat', 'exp', 'nonce'] });
      claims = result.payload;
      if (typeof claims.nonce !== 'string' || !equal(claims.nonce, flow.nonce) || typeof claims.sub !== 'string' || !claims.sub) throw new Error();
      if (flow.provider === 'google') {
        if (!['https://accounts.google.com', 'accounts.google.com'].includes(String(claims.iss)) || claims.email_verified !== true) throw new Error();
      } else if (typeof claims.tid !== 'string' || !uuid.test(claims.tid) || claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) throw new Error();
    } catch { return fail('MAIL_OAUTH_IDENTITY_INVALID', '邮箱身份验证失败，请重新连接', 422); }
    const address = String(claims!.email || (flow.provider === 'microsoft' ? claims!.preferred_username : '') || '').trim().toLowerCase();
    if (!email.test(address) || address.length > 254) fail('MAIL_OAUTH_IDENTITY_INVALID', '未取得邮箱地址，请改用有邮箱的账号连接', 422);
    return { address, displayName: typeof claims!.name === 'string' ? claims!.name.slice(0, 80) : address.split('@')[0], grant: {
      provider: flow.provider, subject: claims!.sub!, ...(flow.provider === 'microsoft' ? { tenantId: claims!.tid as string } : {}), accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string, expiresAt: this.now() + Number(data.expires_in) * 1000,
    } };
  }
  async refresh(grant: MailOAuthGrant): Promise<MailOAuthGrant> {
    const config = this.settings(grant.provider), data = await this.token(grant.provider, new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: 'refresh_token', refresh_token: grant.refreshToken, ...(grant.provider === 'microsoft' ? { scope: PROVIDERS.microsoft.scopes.join(' ') } : {}) }));
    return { ...grant, accessToken: data.access_token as string, refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : grant.refreshToken, expiresAt: this.now() + Number(data.expires_in) * 1000 };
  }
}
