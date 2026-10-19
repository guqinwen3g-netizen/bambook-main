import { accountEmailHtml } from './accountEmail';
import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '../lib/logger';

export type EmailMessage = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export type EmailService = {
  send: (msg: EmailMessage) => Promise<void>;
  isReal: boolean;
  describe: () => string;
};

type SmtpOptions = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

type ResendOptions = {
  apiKey: string;
  from: string;
};

function readResendFromEnv(): ResendOptions | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || process.env.SMTP_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

function readSmtpFromEnv(): SmtpOptions | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const from = process.env.SMTP_FROM?.trim() || user;
  if (!host || !user || !pass || !from) return null;
  const port = portRaw ? parseInt(portRaw, 10) : 465;
  const secure = process.env.SMTP_SECURE
    ? /^(1|true|yes)$/i.test(process.env.SMTP_SECURE.trim())
    : port === 465;
  return { host, port, secure, user, pass, from };
}

function createResendService(opts: ResendOptions): EmailService {
  let clientPromise: Promise<any> | null = null;
  async function getClient(): Promise<any> {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const mod: any = await import('resend');
          const Ctor = mod.Resend || mod.default?.Resend;
          if (!Ctor) throw new Error('resend module loaded but Resend export not found');
          return new Ctor(opts.apiKey);
        } catch (err: any) {
          clientPromise = null;
          throw new Error(`Resend SDK not available: ${err?.message || err}. Run "npm install resend" on the server.`);
        }
      })();
    }
    return clientPromise;
  }

  return {
    isReal: true,
    describe: () => `resend (from=${opts.from})`,
    async send(msg) {
      const client = await getClient();
      const payload: any = {
        from: opts.from,
        to: [msg.to],
        subject: msg.subject,
      };
      if (msg.html) payload.html = msg.html;
      if (msg.text) payload.text = msg.text;
      if (!msg.html && !msg.text) payload.text = '';
      const result = await client.emails.send(payload);
      if ((result as any)?.error) {
        const err: any = new Error((result as any).error.message || 'Resend send failed');
        err.detail = (result as any).error;
        throw err;
      }
    },
  };
}

function createSmtpService(cfg: SmtpOptions): EmailService {
  let transporter: Transporter | null = null;
  function getTransporter(): Transporter {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        auth: { user: cfg.user, pass: cfg.pass },
      });
    }
    return transporter;
  }
  return {
    isReal: true,
    describe: () => `smtp://${cfg.user}@${cfg.host}:${cfg.port}${cfg.secure ? ' (TLS)' : ''}`,
    async send(msg) {
      await getTransporter().sendMail({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    },
  };
}

function createConsoleService(): EmailService {
  return {
    isReal: false,
    describe: () => 'console (no RESEND_API_KEY / SMTP_* env vars)',
    async send(msg) {
      logger.info('[email:console]', { to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}

/**
 * 是否允许「无真实邮件通道时降级放行」。
 * 仅用于本地开发/联调（console 通道下把验证码回显到响应，才能跑通注册流程）。
 * 生产严禁开启——开启后验证码不会真正送达，却会返回成功。
 */
export function isDevEmailFallbackAllowed(): boolean {
  return /^(1|true|yes)$/i.test((process.env.AUTH_ALLOW_DEV_EMAIL_FALLBACK || '').trim());
}

let consoleFallbackWarned = false;

export function createEmailService(): EmailService {
  const resend = readResendFromEnv();
  if (resend) return createResendService(resend);
  const smtp = readSmtpFromEnv();
  if (smtp) return createSmtpService(smtp);
  if (!consoleFallbackWarned) {
    consoleFallbackWarned = true;
    logger.warn(
      '[email] 未配置 RESEND_API_KEY / SMTP_*，邮件只写日志不会真正发出；凭证类邮件（注册验证码/重置密码）将被拒绝。' +
        '本地开发如需放行请设 AUTH_ALLOW_DEV_EMAIL_FALLBACK=1，生产请配置真实通道。',
    );
  }
  return createConsoleService();
}

export function buildApprovalApprovedEmail(params: {
  displayName?: string | null;
  roles?: string[];
  department?: string | null;
}): EmailMessage {
  const name = (params.displayName || '').trim() || '同事';
  const roles = (params.roles || []).filter(Boolean).join('、') || '基础访问';
  const department = params.department?.trim() || '未分配';
  const paragraphs = [`你好，${name}。`, '你的注册申请已通过审核，现在可以使用同一邮箱登录 Bambook。'];
  const note = '如需调整角色或部门，请联系公司管理员。';
  return {
    to: '', subject: 'Bambook 注册审核已通过',
    text: [...paragraphs, `分配角色：${roles}`, `所属部门：${department}`, note].join('\n\n'),
    html: accountEmailHtml({ title: '注册审核已通过', preheader: '你的 Bambook 账号已获批准。', paragraphs, details: [['分配角色', roles], ['所属部门', department]], note }),
  };
}

export function buildVerificationEmail(code: string, purpose: 'register' | 'reset_password' = 'register'): EmailMessage {
  const label = purpose === 'register' ? '验证注册邮箱' : '重置登录密码';
  const paragraphs = [`你正在进行 Bambook ${purpose === 'register' ? '注册' : '密码重置'}，请在页面中输入以下验证码。`];
  const note = '验证码 10 分钟内有效。请勿向他人提供验证码；如果不是你本人操作，请忽略此邮件。';
  return { to: '', subject: `Bambook ${label}`, text: [...paragraphs, `验证码：${code}`, note].join('\n\n'), html: accountEmailHtml({ title: label, preheader: '你的验证码 10 分钟内有效，请勿转发。', paragraphs, code, note }) };
}

export function buildAccountAccessEmail(params: { to: string; label: string; kind: 'invite' | 'recovery'; setup: boolean; url: string }): EmailMessage {
  const { label, kind, setup, url } = params;
  const recovery = kind === 'recovery';
  const title = recovery ? '重设平台账号密码' : `加入${label}`;
  const action = recovery ? '重设登录密码' : setup ? '设置密码并加入' : '登录 Bambook';
  const paragraphs = recovery ? ['我们收到了你的平台账号密码重设申请。请点击下方按钮，设置新的登录密码。'] : [`你已受邀加入${label}。`, setup ? '请先设置你的登录密码，再使用受邀邮箱登录。' : '请使用现有账号登录。你的密码和已有公司权限保持不变。'];
  const note = setup ? `链接${recovery ? '30 分钟' : '48 小时'}内有效，仅可使用一次。${recovery ? '修改密码后，原有设备会话将失效。' : ''}请勿转发邮件。如果不是你本人申请或预期收到的邀请，请忽略此邮件。` : '如果这不是你预期收到的邀请，请联系公司管理员。';
  return { to: params.to, subject: recovery ? 'Bambook 平台账号找回' : `${label}账号邀请`, text: [...paragraphs, `${action}：`, url, note].join('\n\n'), html: accountEmailHtml({ title, preheader: setup ? `${label} · ${recovery ? '30 分钟' : '48 小时'}内完成密码设置。` : `${label}邀请你使用现有账号加入。`, paragraphs, action: { label: action, url }, note }) };
}
