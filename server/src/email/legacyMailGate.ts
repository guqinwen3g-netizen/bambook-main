import type { Request, Response, NextFunction } from 'express';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { isInternalAddress, mailPolicy } from '../mist/mail/service';

/**
 * 旧邮件接口（/api/v1/email*）的连接门禁。
 * 公司会话已由 tenantSurfaceGuard 拒绝；这里只拦截仍可调用旧接口的历史账号，阻止把用户填写的主机指向内部网络。
 * 与 Mist 智能邮箱同一判断：运维白名单 MIST_MAIL_ALLOWED_HOSTS 内的主机放行，其余主机解析出的地址全部须为公网地址。
 * 旧接口按主机名连接，不钉住地址；正式使用只走 Mist 智能邮箱（MistMailService 钉住已校验地址）。
 */
export async function assertLegacyMailHost(host: unknown, resolve: (name: string) => Promise<string[]> = async name => (await lookup(name, { all: true, verbatim: true })).map(row => row.address)) {
  if (host === undefined || host === null || host === '') return;
  const name = typeof host === 'string' ? host.trim().toLowerCase() : '';
  if (!name || name.length > 253) throw Object.assign(new Error('MAIL_HOST_INVALID'), { status: 422 });
  if (mailPolicy().allowedHosts.includes(name)) return;
  const addresses = isIP(name) ? [name] : await resolve(name).catch(() => []);
  if (!addresses.length || addresses.some(address => !isIP(address) || isInternalAddress(address))) throw Object.assign(new Error('MAIL_HOST_NOT_ALLOWED'), { status: 422 });
}

/** 请求体里的 host 字段在进入旧路由处理之前统一检查。 */
export function legacyMailHostGate(resolve?: (name: string) => Promise<string[]>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const host = req.body && typeof req.body === 'object' ? (req.body as { host?: unknown }).host : undefined;
    void assertLegacyMailHost(host, resolve).then(() => next(), () => res.status(422).json({ ok: false, error: { code: 'MAIL_HOST_NOT_ALLOWED', message: '邮件服务器不在允许范围内，请使用公司业务页面的智能邮箱。' } }));
  };
}
