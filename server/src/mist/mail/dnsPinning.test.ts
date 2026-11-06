import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMistLocalRuntime } from '../local';
import { createMistServer } from '../server';
import type { EmailTransport } from '../../shared/mistEmail';

const imapConnect = vi.hoisted(() => vi.fn());
const smtpOptions = vi.hoisted(() => [] as any[]);
vi.mock('imap-simple', () => ({ default: { connect: imapConnect } }));
vi.mock('nodemailer/lib/smtp-connection', () => ({ default: class {
  constructor(options: any) { smtpOptions.push(options); }
  on() { return this; } once() { return this; }
  connect(done: () => void) { queueMicrotask(done); }
  login(_auth: unknown, done: (error?: unknown) => void) { done(); }
  send(_envelope: unknown, _raw: unknown, done: (error: unknown, info: unknown) => void) { done(null, { response: '250 ok', accepted: [], rejected: [] }); }
  quit() { /* closed */ } close() { /* closed */ }
} }));
import { imapSmtpTransport, type MailConnectTarget, type MailTransport } from './transport';

/**
 * DNS 重绑定：主机检查与实际连接必须使用同一个已校验地址。
 * 解析器第一次返回公网地址、之后返回内网地址；连接目标须是第一次校验通过的地址，TLS servername 保持原主机名。
 */
const SECRET = 'pinning-test-secret';
const W = '/api/mist/workspaces/';
let directory: string, n = 0;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mist-mail-pin-'));
  vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', ''); vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', ''); vi.stubEnv('MIST_MAIL_INSECURE_TLS_HOSTS', ''); vi.stubEnv('MIST_MAIL_ALLOWED_RECIPIENT_DOMAINS', '');
  vi.stubEnv('MIST_MAIL_CREDENTIAL_KEY', 'test-only-mail-public-host-key-32-characters');
  imapConnect.mockReset(); smtpOptions.length = 0;
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

/** 记录每次连接拿到的目标；收信服务器只需能列出空文件夹，发信服务器总是接收。 */
function recordingTransport() {
  const imap: MailConnectTarget[] = [], smtp: MailConnectTarget[] = [], insecureTls: boolean[] = [];
  const transport: MailTransport = {
    async imap(config, _secret, insecure) { imap.push({ ...config }); insecureTls.push(insecure); return { folders: async () => [{ path: 'INBOX', attribs: [] }, { path: 'Sent', attribs: ['\\Sent'] }], open: async () => ({ uidValidity: 1, uidNext: 1 }), uidsAfter: async () => [], fetch: async () => [], hasMessageId: async () => false, append: async () => undefined, close: async () => undefined }; },
    async smtpVerify(config, _secret, insecure) { smtp.push({ ...config }); insecureTls.push(insecure); },
    async smtpSend(config, _secret, insecure, envelope) { smtp.push({ ...config }); insecureTls.push(insecure); return { response: '250 ok', accepted: envelope.to, rejected: [] }; },
  };
  return { transport, imap, smtp, insecureTls };
}
/** 第一次解析返回公网地址，之后每次都返回内网地址（模拟检查后被重绑定）。 */
function rebinding(first: string[], later: string[]) {
  const calls: string[] = [];
  return { calls, resolve: async (host: string) => { calls.push(host); return calls.filter(h => h === host).length === 1 ? first : later; } };
}
async function setup(resolve: (host: string) => Promise<string[]>, transport: MailTransport, host = 'mail.public.test', overrides: Partial<EmailTransport> = {}) {
  const local = createMistLocalRuntime({ directory }), app = createMistServer(undefined, { local, mailResolve: resolve, mailTransport: transport });
  const owner = request.agent(app); await owner.get('/api/mist/session').expect(200);
  let ws = (await owner.get(W + 'default').expect(200)).body.workspace;
  const save = await owner.post(W + ws.id + '/commands').send({ requestId: 'pin-' + (++n), expectedRevision: ws.revision, command: { type: 'email.account.save', payload: { input: { address: 'staff@example.test', displayName: 'staff', kind: 'personal', memberIds: [], aliases: [], signature: '', transport: { imapHost: host, imapPort: 993, imapSecure: true, smtpHost: host, smtpPort: 587, smtpSecure: false, username: 'staff@example.test', ...overrides } } } } });
  if (save.status !== 200) throw new Error(JSON.stringify(save.body));
  ws = save.body.workspace;
  return { owner, ws, id: save.body.receipt.result.id as string };
}

describe('邮件主机检查后钉住已校验地址', () => {
  it('绑定凭据：收信与发信连接使用第一次校验通过的公网地址，servername 保持原主机名', async () => {
    const dns = rebinding(['203.0.113.10'], ['10.0.0.5']), rec = recordingTransport();
    const t = await setup(dns.resolve, rec.transport);
    await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    expect(rec.imap).toEqual([expect.objectContaining({ imapHost: '203.0.113.10', imapServername: 'mail.public.test' })]);
    expect(rec.smtp).toEqual([expect.objectContaining({ smtpHost: '203.0.113.10', smtpServername: 'mail.public.test' })]);
    for (const target of [...rec.imap, ...rec.smtp]) expect(JSON.stringify(target)).not.toContain('10.0.0.5');
  });

  it('公网模式下收信同步与发送的每次连接都先检查再钉住；解析变为内网后拒绝连接', async () => {
    vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', 'mail.sylway.cloud'); vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
    const dns = rebinding(['203.0.113.10'], ['10.0.0.5']), rec = recordingTransport();
    const t = await setup(dns.resolve, rec.transport);
    await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    const before = rec.imap.length + rec.smtp.length;
    expect(dns.calls).toEqual(['mail.public.test']);
    expect(rec.imap[0]).toMatchObject({ imapHost: '203.0.113.10', imapServername: 'mail.public.test' });
    expect(rec.smtp[0]).toMatchObject({ smtpHost: '203.0.113.10', smtpServername: 'mail.public.test' });
    // 之后每次解析都指向内网：所有连接路径都在检查处失败，不会按主机名连接到内网。
    const sync = await t.owner.post(W + t.ws.id + '/email/accounts/' + t.id + '/sync').send({});
    expect(sync.status).toBe(422); expect(sync.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
    const send = await t.owner.post(W + t.ws.id + '/email/sends').send({ requestKey: 'pin-send-0001', input: { accountId: t.id, from: 'staff@example.test', to: 'buyer@example.org', cc: '', bcc: '', subject: '通知', body: '正文', template: '', links: [], fileIds: [] } });
    expect(send.status).toBe(422); expect(send.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
    expect(rec.imap.length + rec.smtp.length).toBe(before);
  });

  it('公网模式发送钉住本次地址，同一请求重放不再投递', async () => {
    vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', 'mail.sylway.cloud'); vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
    let answer = ['203.0.113.10'];
    const rec = recordingTransport(), t = await setup(async () => answer, rec.transport);
    await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    answer = ['198.51.100.7'];
    const input = { requestKey: 'pin-send-0002', input: { accountId: t.id, from: 'staff@example.test', to: 'buyer@example.org', cc: '', bcc: '', subject: '通知', body: '正文', template: '', links: [], fileIds: [] } };
    const sent = await t.owner.post(W + t.ws.id + '/email/sends').send(input).expect(200);
    expect(sent.body.send.status).toBe('sent');
    expect(rec.smtp.at(-1)).toMatchObject({ smtpHost: '198.51.100.7', smtpServername: 'mail.public.test' });
    // 投递后写入远端“已发送”使用同一份钉住目标。
    expect(rec.imap.at(-1)).toMatchObject({ imapHost: '198.51.100.7', imapServername: 'mail.public.test' });
    const replay = await t.owner.post(W + t.ws.id + '/email/sends').send(input).expect(200);
    expect(replay.body.send).toMatchObject({ id: sent.body.send.id, status: 'sent', replayed: true });
    expect(replay.body.workspace.state.email.sends).toHaveLength(1);
    expect(rec.smtp).toHaveLength(2); // 绑定校验一次，实际投递一次。
    expect(rec.imap).toHaveLength(2); // 绑定校验一次，写已发送一次。
    expect(rec.insecureTls).toEqual([false, false, false, false]);
  });

  it('IPv6：公网地址被钉住，内网 IPv6（ULA / 链路本地 / 映射内网）一律拒绝', async () => {
    const rec = recordingTransport();
    const ok = await setup(async () => ['2001:db8::25'], rec.transport);
    await ok.owner.put(W + ok.ws.id + '/email/accounts/' + ok.id + '/credential').send({ password: SECRET }).expect(200);
    expect(rec.imap[0]).toMatchObject({ imapHost: '2001:db8::25', imapServername: 'mail.public.test' });
    for (const internal of [['fd00::1'], ['fe80::1'], ['::1'], ['::ffff:10.0.0.1'], ['2001:db8::25', 'fc00::2']]) {
      await fs.rm(directory, { recursive: true, force: true }); await fs.mkdir(directory);
      const bad = await setup(async () => internal, rec.transport);
      const r = await bad.owner.put(W + bad.ws.id + '/email/accounts/' + bad.id + '/credential').send({ password: SECRET });
      expect(r.status, internal.join(',')).toBe(422); expect(r.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
    }
  });

  it('运维白名单主机保持按名字连接，不解析也不钉住', async () => {
    vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', 'mail.sylway.cloud');
    const resolve = vi.fn(async () => ['127.0.0.1']), rec = recordingTransport();
    const t = await setup(resolve, rec.transport, 'mail.sylway.cloud');
    await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    expect(resolve).not.toHaveBeenCalled();
    expect(rec.imap[0]).toMatchObject({ imapHost: 'mail.sylway.cloud', imapServername: 'mail.sylway.cloud' });
    expect(rec.smtp[0]).toMatchObject({ smtpHost: 'mail.sylway.cloud', smtpServername: 'mail.sylway.cloud' });
  });
});

describe('白名单与显式公网接入策略', () => {
  const trustedHost = 'mail.sylway.cloud';
  beforeEach(() => { vi.stubEnv('MIST_MAIL_ALLOWED_HOSTS', trustedHost); });

  describe.each(['imap', 'smtp'] as const)('%s 非白名单主机', kind => {
    const hostOverride = (host: string) => kind === 'imap' ? { imapHost: host } : { smtpHost: host };
    it.each([undefined, '', '0', 'true', 'false', '01'])('开关为 %s 时拒绝公网主机且不连接', async flag => {
      vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', flag);
      const resolve = vi.fn(async () => ['203.0.113.10']), rec = recordingTransport();
      const t = await setup(resolve, rec.transport, trustedHost, hostOverride('mail.public.test'));
      const blocked = await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(422);
      expect(blocked.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
      expect(resolve).not.toHaveBeenCalled();
      expect(rec.imap).toHaveLength(0); expect(rec.smtp).toHaveLength(0);
    });

    it.each([
      ['10.0.0.5'], ['127.0.0.1'], ['169.254.169.254'], ['fd00::1'], ['fe80::1'], ['::1'], ['::ffff:10.0.0.1'],
      ['203.0.113.10', '10.0.0.5'], ['2001:db8::25', 'fc00::2'],
    ])('公网模式仍拒绝包含内部地址的 DNS 答复 %j', async (...answers) => {
      vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
      const rec = recordingTransport(), t = await setup(async () => answers, rec.transport, trustedHost, hostOverride('mail.public.test'));
      const blocked = await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(422);
      expect(blocked.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
      expect(rec.imap).toHaveLength(0); expect(rec.smtp).toHaveLength(0);
    });

    it.each(['10.0.0.5', '127.0.0.1', '169.254.169.254'])('公网模式仍拒绝直接填写内部 IP %s', async host => {
      vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
      const resolve = vi.fn(async () => ['203.0.113.10']), rec = recordingTransport();
      const t = await setup(resolve, rec.transport, trustedHost, hostOverride(host));
      const blocked = await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(422);
      expect(blocked.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
      expect(resolve).not.toHaveBeenCalled();
      expect(rec.imap).toHaveLength(0); expect(rec.smtp).toHaveLength(0);
    });

    it('公网模式仍拒绝非标准端口，检查完成前不连接任何邮件服务', async () => {
      vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
      const resolve = vi.fn(async () => ['203.0.113.10']), rec = recordingTransport();
      const t = await setup(resolve, rec.transport, trustedHost, { ...hostOverride('mail.public.test'), ...(kind === 'imap' ? { imapPort: 1993 } : { smtpPort: 2525 }) });
      const blocked = await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(422);
      expect(blocked.body.error.code).toBe('MAIL_HOST_NOT_ALLOWED');
      expect(resolve).not.toHaveBeenCalled();
      expect(rec.imap).toHaveLength(0); expect(rec.smtp).toHaveLength(0);
    });
  });

  it('公网模式下分别钉住 IMAP/SMTP 地址，保留原主机的 TLS 校验与加密凭据', async () => {
    vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1');
    // 受信自建主机的 TLS 例外不能扩散到新接入的公网主机。
    vi.stubEnv('MIST_MAIL_INSECURE_TLS_HOSTS', trustedHost);
    const resolve = vi.fn(async (host: string) => host === 'imap.public.test' ? ['203.0.113.10', '203.0.113.11'] : ['2001:db8::25']);
    imapConnect.mockResolvedValue({ imap: {}, getBoxes: async () => ({ INBOX: { attribs: [] } }), end: vi.fn(), on: vi.fn() });
    const t = await setup(resolve, imapSmtpTransport, 'imap.public.test', { imapPort: 143, imapSecure: false, smtpHost: 'smtp.public.test' });
    const bound = await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    expect(resolve.mock.calls.map(([host]) => host)).toEqual(['imap.public.test', 'smtp.public.test']);
    expect(imapConnect.mock.calls[0][0].imap).toMatchObject({ host: '203.0.113.10', tls: false, autotls: 'required', tlsOptions: { servername: 'imap.public.test', rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
    expect(smtpOptions[0]).toMatchObject({ host: '2001:db8::25', secure: false, requireTLS: true, servername: 'smtp.public.test', tls: { servername: 'smtp.public.test', rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
    const stored = await fs.readFile(path.join(directory, 'mail-credentials', t.ws.id, t.id + '.json'), 'utf8');
    expect(JSON.parse(stored)).toMatchObject({ v: 1, iv: expect.any(String), tag: expect.any(String), data: expect.any(String) });
    expect(JSON.parse(stored)).not.toHaveProperty('plain');
    for (const text of [stored, JSON.stringify(bound.body), await fs.readFile(path.join(directory, 'store.json'), 'utf8')]) expect(text).not.toContain(SECRET);
  });

  it.each(['', '1'])('开关为 %s 时白名单内网邮箱仍允许自定义端口与原 TLS 例外', async flag => {
    vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', flag); vi.stubEnv('MIST_MAIL_INSECURE_TLS_HOSTS', trustedHost);
    const resolve = vi.fn(async () => ['127.0.0.1']), rec = recordingTransport();
    const t = await setup(resolve, rec.transport, trustedHost, { imapPort: 1993, smtpPort: 2525 });
    await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    expect(resolve).not.toHaveBeenCalled();
    expect(rec.imap[0]).toMatchObject({ imapHost: trustedHost, imapPort: 1993, imapServername: trustedHost });
    expect(rec.smtp[0]).toMatchObject({ smtpHost: trustedHost, smtpPort: 2525, smtpServername: trustedHost });
    expect(rec.insecureTls).toEqual([true, true]);
  });

  it.each(['to', 'cc', 'bcc'] as const)('公网模式不放宽 %s 收件域门禁，拒绝时不投递也不创建发送意图', async field => {
    vi.stubEnv('MIST_MAIL_ALLOW_PUBLIC_HOSTS', '1'); vi.stubEnv('MIST_MAIL_ALLOWED_RECIPIENT_DOMAINS', 'sylway.cloud');
    const rec = recordingTransport(), t = await setup(async () => ['203.0.113.10'], rec.transport);
    await t.owner.put(W + t.ws.id + '/email/accounts/' + t.id + '/credential').send({ password: SECRET }).expect(200);
    const before = (await t.owner.get(W + t.ws.id).expect(200)).body.workspace;
    const blocked = await t.owner.post(W + t.ws.id + '/email/sends').send({ requestKey: 'public-host-domain-' + field, input: { accountId: t.id, from: 'staff@example.test', to: 'buyer@sylway.cloud', cc: '', bcc: '', subject: '通知', body: '正文', template: '', links: [], fileIds: [], [field]: 'buyer@sylway.cloud；External@Outside.Test' } }).expect(422);
    expect(blocked.body.error.code).toBe('MAIL_RECIPIENT_NOT_ALLOWED');
    expect(blocked.body.error.message).toContain('external@outside.test');
    const after = (await t.owner.get(W + t.ws.id).expect(200)).body.workspace;
    expect(after.revision).toBe(before.revision); expect(after.state.email.sends).toEqual(before.state.email.sends);
    expect(rec.smtp).toHaveLength(1); expect(rec.imap).toHaveLength(1); // 只有绑定校验。
  });
});

describe('底层连接：host 用钉住地址，TLS servername 显式为原主机名', () => {
  const base: EmailTransport = { imapHost: '203.0.113.10', imapPort: 993, imapSecure: true, smtpHost: '2001:db8::25', smtpPort: 587, smtpSecure: false, username: 'u' };
  it('IMAP 与 SMTP 按 IP 连接，同时按原主机名做 SNI 与证书校验（IPv4、IPv6）', async () => {
    imapConnect.mockResolvedValue({ imap: {}, end: vi.fn(), on: vi.fn() });
    const target: MailConnectTarget = { ...base, imapServername: 'imap.public.test', smtpServername: 'smtp.public.test' };
    await imapSmtpTransport.imap(target, { username: 'u', password: 'p' }, false);
    const imap = imapConnect.mock.calls[0][0].imap;
    expect(imap).toMatchObject({ host: '203.0.113.10', tlsOptions: { servername: 'imap.public.test', rejectUnauthorized: true } });
    await imapSmtpTransport.smtpVerify(target, { username: 'u', password: 'p' }, false);
    expect(smtpOptions[0]).toMatchObject({ host: '2001:db8::25', servername: 'smtp.public.test', tls: { servername: 'smtp.public.test', rejectUnauthorized: true } });
  });
  it('原主机本身是 IP 时不发送 SNI（IPv4、IPv6 均识别）', async () => {
    imapConnect.mockResolvedValue({ imap: {}, end: vi.fn(), on: vi.fn() });
    await imapSmtpTransport.imap({ ...base, imapServername: '203.0.113.10' }, { username: 'u', password: 'p' }, false);
    expect(imapConnect.mock.calls[0][0].imap.tlsOptions.servername).toBeUndefined();
    await imapSmtpTransport.smtpVerify({ ...base, smtpServername: '2001:db8::25' }, { username: 'u', password: 'p' }, false);
    expect(smtpOptions[0].servername).toBeUndefined();
    expect(smtpOptions[0].tls.servername).toBeUndefined();
  });
});

import { isInternalAddress } from './service';
describe('内部地址判断覆盖 IPv4 映射与内嵌写法', () => {
  it.each(['::ffff:7f00:1', '::ffff:a00:1', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '::ffff:127.0.0.1'])('%s 视为内部地址', address => expect(isInternalAddress(address)).toBe(true));
  it.each(['::ffff:808:808', '64:ff9b::8.8.8.8', '2001:4860:4860::8888', '8.8.8.8'])('%s 为公网地址', address => expect(isInternalAddress(address)).toBe(false));
});
