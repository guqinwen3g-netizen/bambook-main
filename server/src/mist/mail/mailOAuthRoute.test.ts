import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prepareMailReturn } from '../../../../electron/mailOAuth';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { createMistLocalRuntime } from '../local';
import { createMistServer } from '../server';
import { MistMailOAuthProvider, type MailOAuthProvider } from './oauthProvider';
import type { MailImapSession, MailTransport } from './transport';

/**
 * 邮箱 OAuth 连接全链路：发起 → 服务商回调 → 真实登录校验 → 私有授权保存 → 续期 / 断开。
 * 服务商令牌端点与 IMAP/SMTP 为替身；真实 Google / Microsoft 授权另行实测。
 */
const ORIGIN = 'http://127.0.0.1:3005', W = '/api/mist/workspaces/', CALLBACK = '/api/mist/email/oauth/callback/';
let key: Awaited<ReturnType<typeof generateKeyPair>>, directory: string, n = 0;
beforeAll(async () => { key = await generateKeyPair('RS256'); });
const fakeFetch = vi.fn<typeof fetch>();
type Seen = { stage: 'imap' | 'smtp' | 'send'; host: string; user: string; token?: string; password?: string };
let seen: Seen[], rejectTokens: Set<string>, smtpDown: boolean;
let mailbox = { uidValidity: 1, uidNext: 1 };
const searches: number[] = [];
const fakeTransport = (): MailTransport => {
  const check = (stage: Seen['stage'], config: any, secret: any) => {
    seen.push({ stage, host: stage === 'imap' ? config.imapServername || config.imapHost : config.smtpServername || config.smtpHost, user: secret.username, token: secret.oauth?.accessToken, password: secret.password });
    if (secret.oauth && rejectTokens.has(secret.oauth.accessToken)) throw Object.assign(new Error('Invalid credentials (Failure)'), { textCode: 'AUTHENTICATIONFAILED', source: 'authentication', authenticationFailed: true, mailStage: 'login', mailReplied: true });
  };
  return {
    async imap(config, secret) {
      check('imap', config, secret);
      const session: MailImapSession = {
        async folders() { return [{ path: 'INBOX', attribs: [] }, { path: 'Sent', attribs: ['\\Sent'] }]; },
        async open() { return mailbox; }, async uidsAfter(uid) { searches.push(uid); return []; }, async fetch() { return []; },
        async hasMessageId() { return false; }, async append() { /* noop */ }, async close() { /* noop */ },
      };
      return session;
    },
    async smtpVerify(config, secret) { check('smtp', config, secret); if (smtpDown) throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', mailStage: 'login', mailReplied: true }); },
    async smtpSend(config, secret, _insecure, envelope) { check('send', config, secret); return { response: '250 ok', accepted: envelope.to, rejected: [], rejectedReplies: [] }; },
  };
};
beforeEach(async () => {
  mailbox = { uidValidity: 1, uidNext: 1 }; searches.length = 0;
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mist-mail-oauth-')); seen = []; rejectTokens = new Set(); smtpDown = false; fakeFetch.mockReset();
  vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', '127.0.0.1'); vi.stubEnv('MIST_MAIL_INSECURE_TLS_HOSTS', '127.0.0.1'); vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
  vi.stubEnv('MIST_MAIL_CREDENTIAL_DIR', path.join(directory, 'mail-credentials')); vi.stubEnv('MIST_MAIL_CREDENTIAL_KEY', 'k'.repeat(48));
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

const configured = (): NodeJS.ProcessEnv => ({ MIST_MAIL_GOOGLE_CLIENT_ID: 'google-client', MIST_MAIL_GOOGLE_CLIENT_SECRET: 'google-secret', MIST_MAIL_MICROSOFT_CLIENT_ID: 'microsoft-client',
  MIST_MAIL_MICROSOFT_CLIENT_SECRET: 'microsoft-secret', MIST_MAIL_CREDENTIAL_KEY: 'k'.repeat(48), MIST_MAIL_CREDENTIAL_DIR: path.join(directory, 'mail-credentials'), MIST_MAIL_OAUTH_ORIGIN: ORIGIN });
async function setup(env: NodeJS.ProcessEnv = configured()) {
  const oauth = new MistMailOAuthProvider(env, { fetch: fakeFetch, keys: () => async () => key.publicKey });
  const local = createMistLocalRuntime({ directory }), app = createMistServer(undefined, { local, mailResolve: async () => ['203.0.113.10'], mailTransport: fakeTransport(), mailOAuth: oauth });
  const owner = request.agent(app); await owner.get('/api/mist/session').expect(200);
  let ws = (await owner.get(W + 'default').expect(200)).body.workspace;
  const latest = async (client = owner) => (ws = (await client.get(W + ws.id).expect(200)).body.workspace);
  const command = async (type: string, payload: unknown, client = owner) => { await latest(client); return client.post(W + ws.id + '/commands').send({ requestId: 'oauth-test-' + (++n), expectedRevision: ws.revision, command: { type, payload } }); };
  /** 发起连接；返回服务商将带回的 state、回调 Cookie 与该请求的 nonce（替身签发身份令牌用）。 */
  const start = async (provider: MailOAuthProvider, accountId?: string, client = owner, userId = ws.ownerId as string, desktopPort?: number) => {
    const r = await client.post(W + ws.id + '/email/oauth/start').set('Origin', ORIGIN).send({ provider, ...(accountId ? { accountId } : {}), ...(desktopPort ? { desktopPort } : {}) }).expect(200);
    const url = new URL(r.body.oauth.authorizationUrl), state = url.searchParams.get('state')!, setCookie = ([] as string[]).concat(r.headers['set-cookie'] || []).find(c => c.startsWith('bambook_mail_oauth_' + provider + '='))!;
    const cookie = decodeURIComponent(setCookie.split(';')[0].split('=').slice(1).join('='));
    const flow = await oauth.readFlow(cookie, provider, state, userId, '');
    return { url, state, setCookie, cookie, nonce: flow.nonce };
  };
  /** 令牌端点替身：按请求签发与本次 nonce 匹配的身份令牌。 */
  const grant = async (provider: MailOAuthProvider, nonce: string, address: string, fields: Record<string, unknown> = {}) => {
    const microsoft = provider === 'microsoft', tid = '9188040d-6c67-4c5b-b112-36a304b66dad', now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sub: 'provider-' + address, nonce, email: address, name: 'Mail Owner', ...(microsoft ? { tid } : { email_verified: true }) })
      .setProtectedHeader({ alg: 'RS256' }).setAudience(microsoft ? 'microsoft-client' : 'google-client')
      .setIssuer(microsoft ? `https://login.microsoftonline.com/${tid}/v2.0` : 'https://accounts.google.com').setIssuedAt(now).setExpirationTime(now + 3600).sign(key.privateKey);
    fakeFetch.mockResolvedValueOnce(Response.json({ access_token: 'access-first', refresh_token: 'refresh-first', expires_in: 3600, token_type: 'Bearer', id_token: token, ...fields }));
  };
  const callback = (provider: MailOAuthProvider, query: Record<string, string>, client = owner) => client.get(CALLBACK + provider).query(query).expect(303);
  const outcome = (r: request.Response) => { const url = new URL(r.headers.location); return { origin: url.origin, view: url.searchParams.get('view'), status: url.searchParams.get('mailConnect'), code: url.searchParams.get('mailConnectCode'), accountId: url.searchParams.get('mailAccount'), keys: [...url.searchParams.keys()].sort() }; };
  const connect = async (provider: MailOAuthProvider, address: string, accountId?: string, fields: Record<string, unknown> = {}) => {
    const started = await start(provider, accountId); await grant(provider, started.nonce, address, fields);
    return outcome(await callback(provider, { state: started.state, code: 'one-time-code' }));
  };
  const accounts = async () => (await latest()).state.email.accounts.filter((a: any) => !a.example) as any[];
  const vault = async () => { const dir = path.join(directory, 'mail-credentials', ws.id); return (await fs.readdir(dir).catch(() => [] as string[])).filter(name => name.endsWith('.json')); };
  return { app, oauth, owner, get ws() { return ws; }, latest, command, start, grant, callback, outcome, connect, accounts, vault };
}

describe('邮箱 OAuth 连接（服务端全链路）', () => {
  it('平台未配置时不可发起；发起只接受当前网页入口', async () => {
    const off = await setup({ MIST_MAIL_CREDENTIAL_KEY: 'k'.repeat(48), MIST_MAIL_CREDENTIAL_DIR: path.join(directory, 'mail-credentials') });
    expect((await off.owner.get(W + off.ws.id + '/email/oauth').expect(200)).body.providers).toEqual([expect.objectContaining({ provider: 'google', available: false }), expect.objectContaining({ provider: 'microsoft', available: false })]);
    expect((await off.owner.post(W + off.ws.id + '/email/oauth/start').set('Origin', ORIGIN).send({ provider: 'google' }).expect(503)).body.error.code).toBe('MAIL_OAUTH_NOT_CONFIGURED');
    await fs.rm(directory, { recursive: true, force: true }); await fs.mkdir(directory, { recursive: true });
    const t = await setup();
    expect((await t.owner.get(W + t.ws.id + '/email/oauth').expect(200)).body.providers.map((p: any) => p.available)).toEqual([true, true]);
    for (const origin of [undefined, 'https://evil.example.test', 'http://127.0.0.1:4444']) {
      const r = t.owner.post(W + t.ws.id + '/email/oauth/start'); if (origin) r.set('Origin', origin);
      await r.send({ provider: 'google' }).expect(403);
    }
    await t.owner.post(W + t.ws.id + '/email/oauth/start').set('Origin', ORIGIN).send({ provider: 'yahoo' }).expect(400);
    await t.owner.post(W + t.ws.id + '/email/oauth/start').set('Origin', ORIGIN).send({ provider: 'google', redirect: 'https://evil.example.test' }).expect(400);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it.each([['google', 'imap.gmail.com', 'smtp.gmail.com'], ['microsoft', 'outlook.office365.com', 'smtp-mail.outlook.com']] as const)('%s：授权后真实登录校验通过才建立邮箱，令牌只进加密私有文件', async (provider, imapHost, smtpHost) => {
    const t = await setup(), started = await t.start(provider);
    expect(started.setCookie).toMatch(/HttpOnly/i); expect(started.setCookie).toMatch(/SameSite=Lax/i);
    expect(started.setCookie).toContain('Path=' + CALLBACK + provider);
    expect(started.url.searchParams.get('redirect_uri')).toBe(ORIGIN + CALLBACK + provider);
    await t.grant(provider, started.nonce, 'Owner.Box@Example.test');
    const response = await t.callback(provider, { state: started.state, code: 'one-time-code' }), result = t.outcome(response);
    const [account] = await t.accounts();
    expect(result).toEqual({ origin: ORIGIN, view: 'emails', status: 'connected', code: null, accountId: account.id, keys: ['mailAccount', 'mailConnect', 'view'] });
    expect(response.headers['cache-control']).toContain('no-store'); expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(account).toMatchObject({ address: 'owner.box@example.test', kind: 'personal', ownerId: t.ws.ownerId, credentialSet: true, connection: 'connected', lastError: null, oauth: { provider }, transport: { imapHost, smtpHost } });
    expect(seen.map(s => [s.stage, s.host, s.user, s.token, s.password])).toEqual([['imap', imapHost, 'owner.box@example.test', 'access-first', undefined], ['smtp', smtpHost, 'owner.box@example.test', 'access-first', undefined]]);
    const files = await t.vault(); expect(files).toEqual([account.oauth.credentialId + '.json']);
    const stored = await fs.readFile(path.join(directory, 'mail-credentials', t.ws.id, files[0]), 'utf8');
    const publicTexts = [JSON.stringify(t.ws), await fs.readFile(path.join(directory, 'store.json'), 'utf8'), response.headers.location, stored];
    for (const text of publicTexts) for (const secret of ['access-first', 'refresh-first', 'one-time-code', started.nonce]) expect(text).not.toContain(secret);
    expect(JSON.parse(stored).plain).toBeUndefined();
    // 同一次授权不能重放，也不会建出第二个邮箱。
    await t.grant(provider, started.nonce, 'owner.box@example.test');
    const replay = t.outcome(await t.owner.get(CALLBACK + provider).set('Cookie', started.setCookie.split(';')[0]).query({ state: started.state, code: 'one-time-code' }).expect(303));
    expect(replay).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_STATE_INVALID', accountId: null });
    expect(await t.accounts()).toHaveLength(1); expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it.each(['google', 'microsoft'] as const)('%s desktop return stays on this machine and can only finish in the initiating session', async provider => {
    const t = await setup(), desktop = await prepareMailReturn(ORIGIN, provider);
    try {
      const start = await t.start(provider, undefined, t.owner, t.ws.ownerId, desktop.port);
      await expect(desktop.open('https://evil.example/authorize', async () => undefined)).rejects.toThrow();
      const opened = desktop.open(start.url.toString(), async () => undefined);
      const response = await request(t.app).get(CALLBACK + provider).query({ state: start.state, code: 'example-code' }).expect(303);
      const loopback = new URL(response.headers.location);
      expect(loopback.origin).toBe('http://127.0.0.1:' + desktop.port);
      expect((await fetch(loopback.toString().replace(start.state, 'wrong'))).status).toBe(404);
      await request(t.app).get(CALLBACK + provider).query({ state: start.state.replace('.' + desktop.port + '.', '.1024.'), code: 'c' }).expect(400);
      expect((await fetch(loopback)).status).toBe(200); await opened;
      const finish = new URL(desktop.finish());
      expect(finish.origin).toBe(ORIGIN);
      await request(t.app).get(finish.pathname + finish.search).expect(401);
      expect(await t.accounts()).toHaveLength(0);
      await t.grant(provider, start.nonce, 'owner@example.test');
      expect(t.outcome(await t.owner.get(finish.pathname + finish.search).expect(303)).status).toBe('connected');
      expect(t.outcome(await t.owner.get(finish.pathname + finish.search).expect(303)).status).toBe('failed');
    } finally { desktop.cancel(); }
  });

  it('starts designated mailboxes at connection time, preserves progress on reconnect and skips history on a UID reset', async () => {
    vi.stubEnv('MIST_MAIL_NEW_ONLY_ADDRESSES', 'owner@example.test');
    const t = await setup(); mailbox.uidNext = 101;
    const { accountId } = await t.connect('google', 'owner@example.test');
    expect((await t.accounts())[0].folders.map((f: any) => f.lastUid)).toEqual([100, 100]);
    mailbox.uidNext = 111;
    await t.connect('google', 'owner@example.test', accountId);
    const sync = () => t.owner.post(W + t.ws.id + '/email/accounts/' + accountId + '/sync').send({}).expect(200);
    await sync(); expect(searches.splice(0)).toEqual([100, 100]);
    mailbox = { uidValidity: 2, uidNext: 0 }; await sync(); expect(searches).toEqual([]);
    mailbox.uidNext = 501; await sync(); expect(searches).toEqual([500, 500]);
  });

  it('取消授权、缺少回调 Cookie、其他账号或被改写的 state 都不会建立邮箱', async () => {
    const t = await setup();
    const cancelled = await t.start('google');
    expect(t.outcome(await t.callback('google', { state: cancelled.state, error: 'access_denied' }))).toMatchObject({ status: 'cancelled', code: null, accountId: null });
    // 取消也消耗本次请求：随后带着同一 state 的授权码不被接受。
    await t.grant('google', cancelled.nonce, 'owner@example.test');
    expect(t.outcome(await t.owner.get(CALLBACK + 'google').set('Cookie', cancelled.setCookie.split(';')[0]).query({ state: cancelled.state, code: 'late-code' }).expect(303))).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_STATE_INVALID' });
    const other = await t.start('google');
    expect(t.outcome(await t.callback('google', { state: other.state, error: 'server_error' }))).toMatchObject({ status: 'failed', accountId: null });
    const tampered = await t.start('google');
    expect(t.outcome(await t.callback('google', { state: tampered.state + 'x', code: 'c' }))).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_STATE_INVALID' });
    expect(t.outcome(await t.callback('microsoft', { state: tampered.state, code: 'c' }))).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_STATE_INVALID' });
    // 另一位成员拿到发起人的回调 Cookie 与 state，也不能替他完成连接。
    await t.owner.post(W + t.ws.id + '/members').send({ requestId: 'oauth-member-' + (++n), expectedRevision: (await t.latest()).revision, action: 'add', account: 'local-sales' }).expect(200);
    const sales = request.agent(t.app); await sales.get('/api/mist/session').expect(200);
    const switched = await sales.post('/api/mist/session').send({ profileId: 'local-sales' }).expect(200);
    const session = ([] as string[]).concat(switched.headers['set-cookie'] || []).map(c => c.split(';')[0]);
    const stolen = await t.start('google'); await t.grant('google', stolen.nonce, 'owner@example.test');
    const hijack = await request(t.app).get(CALLBACK + 'google').set('Cookie', [...session, stolen.setCookie.split(';')[0]].join('; ')).query({ state: stolen.state, code: 'one-time-code' }).expect(303);
    expect(t.outcome(hijack)).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_STATE_INVALID', accountId: null });
    // 服务商跳回（跨站、不带本机会话）先在本机内再导航一次；没有会话的请求到不了回调。
    const bounce = await request(t.app).get(CALLBACK + 'google').set('Sec-Fetch-Site', 'cross-site').query({ state: 'a"><script>x</script>', code: 'c&d', 'bad name': '1' }).expect(200);
    expect(bounce.text).toContain('bounce=1'); expect(bounce.text).not.toContain('<script'); expect(bounce.text).not.toContain('bad'); expect(bounce.headers['content-security-policy']).toBe("default-src 'none'");
    await request(t.app).get(CALLBACK + 'google').query({ state: stolen.state, code: 'one-time-code', bounce: '1' }).expect(401);
    expect(await t.accounts()).toHaveLength(0); expect(await t.vault()).toEqual([]); expect(seen).toEqual([]);
  });

  it('收信或发信登录未通过、权限不全时不保存授权也不建邮箱', async () => {
    const t = await setup();
    smtpDown = true;
    expect(await t.connect('google', 'owner@example.test')).toMatchObject({ status: 'failed', accountId: null });
    smtpDown = false; rejectTokens.add('access-first');
    expect(await t.connect('google', 'owner@example.test')).toMatchObject({ status: 'failed', accountId: null });
    rejectTokens.clear();
    expect(await t.connect('google', 'owner@example.test', undefined, { scope: 'openid email profile' })).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_SCOPE_MISSING' });
    expect(await t.connect('google', 'owner@example.test', undefined, { refresh_token: undefined })).toMatchObject({ status: 'failed', accountId: null });
    expect(await t.accounts()).toHaveLength(0); expect(await t.vault()).toEqual([]);
    expect(await t.connect('google', 'owner@example.test')).toMatchObject({ status: 'connected' });
  });

  it('已用密码接入的邮箱改为授权连接：保留名称、签名与共享成员，旧凭据作废；授权了别的邮箱则原样保留', async () => {
    const t = await setup();
    await t.owner.post(W + t.ws.id + '/members').send({ requestId: 'oauth-member-' + (++n), expectedRevision: t.ws.revision, action: 'add', account: 'local-sales' }).expect(200);
    const memberId = 'local-sales'; await t.latest();
    const saved = await t.command('email.account.save', { input: { address: 'team@example.test', displayName: '外贸组', kind: 'shared', memberIds: [memberId], aliases: ['sales@example.test'], signature: '云锦外贸组', transport: { imapHost: '127.0.0.1', imapPort: 993, imapSecure: true, smtpHost: '127.0.0.1', smtpPort: 587, smtpSecure: false, username: 'team@example.test' } } });
    expect(saved.status).toBe(200); const id = saved.body.receipt.result.id as string;
    await t.owner.put(W + t.ws.id + '/email/accounts/' + id + '/credential').send({ password: 'old-password' }).expect(200);
    expect(await t.vault()).toEqual([id + '.json']);
    expect(await t.connect('google', 'someone-else@example.test', id)).toMatchObject({ status: 'failed', code: 'MAIL_OAUTH_ADDRESS_MISMATCH', accountId: null });
    expect(await t.vault()).toEqual([id + '.json']); expect((await t.accounts())[0].oauth).toBeUndefined();
    expect(await t.connect('google', 'team@example.test', id)).toMatchObject({ status: 'connected', accountId: id });
    const [account] = await t.accounts();
    expect(account).toMatchObject({ id, displayName: '外贸组', kind: 'shared', memberIds: [memberId], aliases: ['sales@example.test'], signature: '云锦外贸组', oauth: { provider: 'google' }, transport: { imapHost: 'imap.gmail.com' } });
    expect(await t.vault()).toEqual([account.oauth.credentialId + '.json']);
    // 成员可见但不能重新连接；授权邮箱不再接受密码绑定或改服务器，客户端也不能自行写入授权记录。
    const sales = request.agent(t.app); await sales.get('/api/mist/session').expect(200); await sales.post('/api/mist/session').send({ profileId: 'local-sales' }).expect(200);
    expect((await sales.post(W + t.ws.id + '/email/oauth/start').set('Origin', ORIGIN).send({ provider: 'google', accountId: id }).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await t.owner.put(W + t.ws.id + '/email/accounts/' + id + '/credential').send({ password: 'old-password' }).expect(422)).body.error.code).toBe('MAIL_OAUTH_RECONNECT');
    const moved = await t.command('email.account.save', { id, input: { address: 'team@example.test', displayName: '外贸组', kind: 'shared', memberIds: [memberId], aliases: [], signature: '', transport: { ...account.transport, smtpHost: '127.0.0.1' } } });
    expect(moved.status).not.toBe(200);
    const renamed = await t.command('email.account.save', { id, input: { address: 'team@example.test', displayName: '外贸一组', kind: 'shared', memberIds: [memberId], aliases: [], signature: '新签名', transport: account.transport } });
    expect(renamed.status).toBe(200);
    const forged = await t.command('email.server.oauth', { provider: 'google', credentialId: account.oauth.credentialId, address: 'forged@example.test', displayName: 'x', transport: account.transport });
    expect(forged.status).not.toBe(200);
    expect(await t.accounts()).toHaveLength(1); expect((await t.accounts())[0]).toMatchObject({ displayName: '外贸一组', signature: '新签名', oauth: { provider: 'google' } });
  });

  it('令牌到期前在服务端续期且并发只续一次；服务商撤销后要求重新连接；断开即删除私有授权', async () => {
    const t = await setup();
    const { accountId } = await t.connect('microsoft', 'owner@example.test', undefined, { expires_in: 30 });
    const sync = () => t.owner.post(W + t.ws.id + '/email/accounts/' + accountId + '/sync').send({});
    seen = []; fakeFetch.mockReset();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    fakeFetch.mockImplementationOnce(async () => { await gate; return Response.json({ access_token: 'access-second', refresh_token: 'refresh-second', expires_in: 3600, token_type: 'Bearer' }); });
    const pair = [sync(), sync()].map(r => r.then(x => x)); await new Promise(resolve => setTimeout(resolve, 50)); release();
    const results = await Promise.all(pair);
    expect(results.some(r => r.status === 200)).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const body = fakeFetch.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token'); expect(body.get('refresh_token')).toBe('refresh-first'); expect(String(fakeFetch.mock.calls[0][0])).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(seen.length).toBeGreaterThan(0); expect(seen.every(s => s.token === 'access-second')).toBe(true);
    const stored = await fs.readFile(path.join(directory, 'mail-credentials', t.ws.id, (await t.vault())[0]), 'utf8');
    for (const secret of ['access-second', 'refresh-second']) { expect(stored).not.toContain(secret); expect(JSON.stringify(await t.latest())).not.toContain(secret); }
    // 仍在有效期内：不再访问服务商。
    await sync().expect(200); expect(fakeFetch).toHaveBeenCalledTimes(1);
    // 服务商一侧撤销：登录被拒后提示重新连接，不当作网络故障重试。
    rejectTokens.add('access-second');
    const revoked = await sync().expect(200);
    expect(revoked.body.sync.error).toContain('重新连接');
    expect(revoked.body.workspace.state.email.accounts.find((a: any) => a.id === accountId)).toMatchObject({ connection: 'error', lastError: { code: 'MAIL_OAUTH_RECONNECT' } });
    rejectTokens.clear();
    await t.owner.delete(W + t.ws.id + '/email/accounts/' + accountId + '/credential').expect(200);
    expect(await t.vault()).toEqual([]);
    expect((await t.accounts())[0]).toMatchObject({ id: accountId, credentialSet: false });
    await sync().expect(r => expect(r.status).not.toBe(200));
    expect(await t.connect('microsoft', 'owner@example.test', accountId as string)).toMatchObject({ status: 'connected', accountId });
    expect((await t.accounts())[0]).toMatchObject({ credentialSet: true, connection: 'connected' });
  });

  it('续期被服务商拒绝（授权已失效）时要求重新连接', async () => {
    const t = await setup(), { accountId } = await t.connect('google', 'owner@example.test', undefined, { expires_in: 30 });
    fakeFetch.mockReset(); fakeFetch.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect((await t.owner.post(W + t.ws.id + '/email/accounts/' + accountId + '/sync').send({}).expect(422)).body.error.code).toBe('MAIL_OAUTH_RECONNECT');
  });
});
