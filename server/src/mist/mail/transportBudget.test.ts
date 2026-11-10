import SMTPConnection from 'nodemailer/lib/smtp-connection';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTransport } from '../../shared/mistEmail';

const connect = vi.hoisted(() => vi.fn());
vi.mock('imap-simple', () => ({ default: { connect } }));
import { imapSmtpTransport, MAIL_FETCH_MAX_BYTES } from './transport';

const config = { imapHost: 'mail.example.test', imapPort: 993, imapSecure: true } as EmailTransport;
function connection(sizes: Record<number, number>, chunks = 1) {
  const calls: Array<{ ids: number[]; options: any }> = [];
  const destroy = vi.fn(), end = vi.fn();
  const imap = { destroy, fetch(ids: number[], options: any) {
    calls.push({ ids, options });
    const fetch = new EventEmitter();
    queueMicrotask(() => {
      for (const uid of ids) {
        if (!(uid in sizes)) continue;
        const message = new EventEmitter(); fetch.emit('message', message);
        if (!options.size) {
          const stream = new EventEmitter(); message.emit('body', stream);
          const chunk = Buffer.alloc(1024 * 1024, 'x');
          for (let index = 0; index < chunks; index++) stream.emit('data', chunk);
        }
        message.emit('attributes', { uid, size: sizes[uid], flags: [] });
        message.emit('end');
      }
      fetch.emit('end');
    });
    return fetch;
  } };
  connect.mockResolvedValue({ imap, end });
  return { calls, destroy, end };
}
beforeEach(() => connect.mockReset());
describe('IMAP raw receive resource budget', () => {
  it('does not treat an incomplete metadata response as a deleted message', async () => {
    const imap={fetch:()=>{const f=new EventEmitter();queueMicrotask(()=>{f.emit('message',new EventEmitter());f.emit('end');});return f;}};
    connect.mockResolvedValue({imap});const session=await imapSmtpTransport.imap(config,{password:'test'} as any,false);
    await expect(session.metadata!([1])).rejects.toMatchObject({code:'MAIL_STATE_METADATA_INVALID'});
  });
  it('rejects control characters before issuing a Message-ID search', async () => {
    const search=vi.fn();connect.mockResolvedValue({imap:{search}});const session=await imapSmtpTransport.imap(config,{password:'test'} as any,false);
    await expect(session.searchMessageId!('mail\r\nUID MOVE')).rejects.toMatchObject({code:'MAIL_STATE_AMBIGUOUS'});expect(search).not.toHaveBeenCalled();
  });
  it('refuses unsafe fallback when MOVE is not advertised', async () => {
    const imap = Object.assign(new EventEmitter(), { serverSupports: () => false, move: vi.fn() });
    connect.mockResolvedValue({ imap });
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    await expect(session.move!(1,'Archive')).rejects.toMatchObject({code:'MAIL_MOVE_UNSUPPORTED'});
    expect(imap.move).not.toHaveBeenCalled();
  });
  it('rejects a disconnected MOVE whose callback never arrives instead of leaving it pending', async () => {
    const imap = Object.assign(new EventEmitter(), { serverSupports: () => true, move: () => queueMicrotask(() => imap.emit('end')) });
    connect.mockResolvedValue({ imap });
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    await expect(session.move!(1,'Archive')).rejects.toMatchObject({code:'ECONNRESET'});
    expect(imap.listenerCount('end')).toBe(0);expect(imap.listenerCount('close')).toBe(0);
  });
  it('rejects an oversized advertised message before fetching its body', async () => {
    const f = connection({ 1: MAIL_FETCH_MAX_BYTES + 1 });
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    await expect(session.fetch([1])).rejects.toMatchObject({ code: 'MAIL_MESSAGE_TOO_LARGE' });
    expect(f.calls).toEqual([{ ids: [1], options: { size: true, markSeen: false } }]);
  });
  it('fetches only a bounded UID prefix and leaves later messages for the next run', async () => {
    const f = connection({ 1: 40 * 1024 * 1024, 2: 40 * 1024 * 1024 });
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    expect((await session.fetch([1, 2])).map(row => row.uid)).toEqual([1]);
    expect(f.calls[1].ids).toEqual([1]);
  });
  it('enforces actual stream bytes even when a server advertises a false size', async () => {
    const f = connection({ 1: 1 }, 65);
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    await expect(session.fetch([1])).rejects.toMatchObject({ code: 'MAIL_MESSAGE_TOO_LARGE' });
    expect(f.destroy).toHaveBeenCalledOnce();
  });
  it('skips concurrently deleted UIDs but rejects missing size metadata for an existing UID', async () => {
    connection({ 2: Number.NaN });
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    await expect(session.fetch([1, 2])).rejects.toMatchObject({ code: 'MAIL_MESSAGE_SIZE_UNKNOWN' });
  });
  it('force-closes a cancelled connection instead of waiting for protocol logout', async () => {
    const f = connection({});
    const session = await imapSmtpTransport.imap(config, { password: 'test' } as any, false);
    await session.close(true);
    expect(f.destroy).toHaveBeenCalledOnce(); expect(f.end).not.toHaveBeenCalled();
  });
});

describe('provider mail authentication', () => {
  it('passes only an access token to IMAP and SMTP and leaves token renewal to Bambook', async () => {
    const username = 'owner@example.test';
    const oauth = { provider: 'microsoft' as const, subject: 'owner', accessToken: 'short-lived', refreshToken: 'server-only', expiresAt: Date.now() + 60_000 };
    const sasl = Buffer.from('user=' + username + '\x01auth=Bearer short-lived\x01\x01').toString('base64');
    connect.mockResolvedValue({});
    await imapSmtpTransport.imap(config, { username, oauth }, false);
    const imap = connect.mock.calls[0][0].imap;
    expect(imap.xoauth2).toBe(sasl); expect(imap.password).toBeUndefined();
    expect(JSON.stringify(imap)).not.toContain(oauth.refreshToken);
    const proto = SMTPConnection.prototype;
    vi.spyOn(proto, 'connect').mockImplementation(callback => { callback!(); });
    vi.spyOn(proto, 'quit').mockImplementation(() => undefined);
    const login = vi.spyOn(proto, 'login').mockImplementation((_auth, callback) => { callback(null as any); });
    try {
      await imapSmtpTransport.smtpVerify({ ...config, smtpHost: 'smtp.example.test', smtpPort: 587, smtpSecure: false }, { username, oauth }, false);
      const auth = login.mock.calls[0][0] as any;
      expect(auth.method).toBe('XOAUTH2'); expect(auth.oauth2.options.refreshToken).toBeUndefined();
      const token = (renew: boolean) => new Promise<string>((ok, fail) => auth.oauth2.getToken(renew, (err: Error | null, value: string) => err ? fail(err) : ok(value)));
      expect(auth.oauth2.buildXOAuth2Token(await token(false))).toBe(sasl);
      await expect(token(true)).rejects.toMatchObject({ code: 'MAIL_OAUTH_RECONNECT' });
    } finally { vi.restoreAllMocks(); }
  });
});
