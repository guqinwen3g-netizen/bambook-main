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
