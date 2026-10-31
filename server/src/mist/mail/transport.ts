import imaps from 'imap-simple';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { EmailTransport } from '../../shared/mistEmail';
import type { MistMailSecret } from './credentials';

/** 远端文件夹与 IMAP 会话；接口刻意很小，测试可注入假实现，生产走 imap-simple / nodemailer。 */
export type MailFolderInfo = { path: string; attribs: string[] };
export type MailFetched = { uid: number; seen: boolean; starred?: boolean; raw: Buffer };
export type MailMetadata = { uid: number; seen: boolean; starred: boolean };
export interface MailImapSession {
  folders(): Promise<MailFolderInfo[]>;
  open(path: string, writable?: boolean): Promise<{ uidValidity: number; uidNext: number }>;
  /** 当前打开文件夹中 UID 大于 afterUid 的邮件编号（升序）。 */
  uidsAfter(afterUid: number): Promise<number[]>;
  fetch(uids: number[]): Promise<MailFetched[]>;
  hasMessageId(messageId: string): Promise<boolean>;
  append(path: string, raw: Buffer): Promise<void>;
  close(force?:boolean): Promise<void>;
  metadata?(uids: number[]): Promise<MailMetadata[]>;
  updateFlag?(uid: number, flag: 'read' | 'starred', value: boolean): Promise<void>;
  canMove?(): boolean;
  move?(uid: number, path: string): Promise<number | undefined>;
  searchMessageId?(messageId: string): Promise<number[]>;
}
/** rejected 为服务器明确拒收的收件人及其回复原文（部分拒收时正文仍会提交给已接收的收件人）。 */
export type MailSendResult = { response: string; accepted: string[]; rejected: string[]; rejectedReplies?: Array<{ address: string; reply: string }> };
const cleanReply = (value: unknown) => String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);
/** 从 SMTP 结果或信封错误中取出逐个收件人的拒收原文。 */
export function smtpRejectedReplies(source: any): Array<{ address: string; reply: string }> {
  const errors: any[] = Array.isArray(source?.rejectedErrors) ? source.rejectedErrors : [];
  return (Array.isArray(source?.rejected) ? source.rejected : []).map((address: unknown) => {
    const match = errors.find(item => String(item?.recipient || '').toLowerCase() === String(address).toLowerCase());
    return { address: String(address).toLowerCase(), reply: cleanReply(match?.response || match?.message || '') };
  });
}
export interface MailTransport {
  imap(config: EmailTransport, secret: MistMailSecret, insecureTls: boolean): Promise<MailImapSession>;
  smtpVerify(config: EmailTransport, secret: MistMailSecret, insecureTls: boolean): Promise<void>;
  smtpSend(config: EmailTransport, secret: MistMailSecret, insecureTls: boolean, envelope: { from: string; to: string[] }, raw: Buffer): Promise<MailSendResult>;
}

export type MailComposeInput = {
  from: { name: string; address: string }; to: string[]; cc: string[]; subject: string; text: string; messageId: string; date: Date;
  inReplyTo?: string; references?: string[]; attachments: Array<{ filename: string; contentType: string; content: Buffer }>;
};
/** 一次性生成原始 MIME：SMTP 投递与写入"已发送"使用同一份字节与 Message-ID。密送只进投递信封，不写入信头。 */
export async function composeMail(input: MailComposeInput): Promise<Buffer> {
  const composer = new MailComposer({
    from: input.from, to: input.to, cc: input.cc.length ? input.cc : undefined, subject: input.subject, text: input.text, messageId: input.messageId, date: input.date,
    inReplyTo: input.inReplyTo, references: input.references?.length ? input.references : undefined, attachments: input.attachments,
  });
  return new Promise((resolve, reject) => composer.compile().build((error, message) => error ? reject(error) : resolve(message)));
}

function flatten(boxes: Record<string, any>, prefix = '', out: MailFolderInfo[] = []) {
  for (const [name, box] of Object.entries(boxes || {})) {
    const path = prefix ? `${prefix}${box?.delimiter || '/'}${name}` : name;
    out.push({ path, attribs: Array.isArray(box?.attribs) ? box.attribs.map(String) : [] });
    if (box?.children) flatten(box.children, path, out);
  }
  return out;
}
export const MAIL_FETCH_MAX_BYTES=64*1024*1024;
const SEEN = '\\Seen';

class ImapSimpleSession implements MailImapSession {
  constructor(private readonly connection: any) {}
  private operation<T>(start: (finish: (error?: unknown, value?: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const closed = () => finish(Object.assign(new Error('IMAP connection closed before acknowledgement'), {code:'ECONNRESET'}));
      const finish = (error?: unknown, value?: T) => {
        if (settled) return; settled = true;
        this.connection.imap.removeListener('end', closed); this.connection.imap.removeListener('close', closed); this.connection.imap.removeListener('error', finish);
        if (error) reject(error); else resolve(value as T);
      };
      this.connection.imap.once('end', closed); this.connection.imap.once('close', closed); this.connection.imap.once('error', finish);
      try { start(finish); } catch (error) { finish(error); }
    });
  }
  async folders() { return flatten(await this.connection.getBoxes()); }
  async open(path: string, writable = false) { const box = await this.connection.openBox(path, !writable); return { uidValidity: Number(box?.uidvalidity) || 0, uidNext: Number(box?.uidnext) || 0 }; }
  metadata(uids: number[]): Promise<MailMetadata[]> {
    if (!uids.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const rows: MailMetadata[] = [], fetch = this.connection.imap.fetch(uids, { markSeen: false }); let messages = 0;
      fetch.on('message', (message: any) => { messages++; message.once('attributes', (attrs: any) => {
        if (Number.isSafeInteger(attrs.uid) && Array.isArray(attrs.flags)) rows.push({ uid: attrs.uid, seen: attrs.flags.includes(SEEN), starred: attrs.flags.includes('\\Flagged') });
      }); });
      fetch.once('error', reject); fetch.once('end', () => messages === rows.length ? resolve(rows) : reject(Object.assign(new Error('原邮箱未返回完整状态，请稍后核对'), {code:'MAIL_STATE_METADATA_INVALID'})));
    });
  }
  updateFlag(uid: number, flag: 'read' | 'starred', value: boolean): Promise<void> {
    return this.operation<void>(finish => this.connection.imap[value ? 'addFlags' : 'delFlags'](uid, flag === 'read' ? SEEN : '\\Flagged', finish));
  }
  canMove() { return this.connection.imap.serverSupports('MOVE'); }
  move(uid: number, path: string): Promise<number | undefined> {
    // Never enter node-imap's COPY/STORE/EXPUNGE fallback: it may affect another client's deleted mail.
    if (!this.canMove()) return Promise.reject(Object.assign(new Error('Safe IMAP MOVE unavailable'), { code: 'MAIL_MOVE_UNSUPPORTED' }));
    return this.operation<number | undefined>(finish => this.connection.imap.move(uid, path, (error: unknown, ids: unknown) => {
      if (error) return finish(error);
      const id = Number(Array.isArray(ids) && ids.length === 1 ? ids[0] : ids);
      finish(undefined, Number.isSafeInteger(id) && id > 0 ? id : undefined);
    }));
  }
  searchMessageId(messageId: string): Promise<number[]> {
    if (!messageId || messageId.length > 300 || /[\r\n\0]/.test(messageId)) return Promise.reject(Object.assign(new Error('邮件标识无效，请在原邮箱核对'), {code:'MAIL_STATE_AMBIGUOUS'}));
    return new Promise((resolve, reject) => this.connection.imap.search([['HEADER', 'MESSAGE-ID', messageId]], (error: unknown, ids: number[]) => error ? reject(error) : resolve((ids || []).map(Number))));
  }
  uidsAfter(afterUid: number): Promise<number[]> {
    return new Promise((resolve, reject) => this.connection.imap.search([['UID', `${afterUid + 1}:*`]], (error: Error | null, uids: number[]) => error ? reject(error) : resolve((uids || []).map(Number).filter(uid => uid > afterUid).sort((a, b) => a - b))));
  }
  /** Query sizes first, then fetch only a UID prefix within the per-request raw-byte budget. */
  async fetch(uids:number[]):Promise<MailFetched[]> {
    if(!uids.length)return[];
    const sizes=await new Promise<Map<number,number>>((resolve,reject)=>{
      const result=new Map<number,number>(),fetch=this.connection.imap.fetch(uids,{size:true,markSeen:false});let messages=0;
      fetch.on('message',(message:any)=>{messages++;message.once('attributes',(attrs:any)=>{if(Number.isSafeInteger(attrs?.uid))result.set(attrs.uid,attrs.size);});});
      fetch.once('error',reject);fetch.once('end',()=>{if(messages!==result.size)reject(Object.assign(new Error('Incomplete IMAP size metadata'),{code:'MAIL_MESSAGE_SIZE_UNKNOWN'}));else resolve(result);});
    });
    const chosen:number[]=[];let planned=0;
    for(const uid of uids){
      if(!sizes.has(uid))continue; // A concurrently deleted UID has no body to import.
      const size=sizes.get(uid)!;
      if(!Number.isSafeInteger(size)||size<0)throw Object.assign(new Error('Missing RFC822.SIZE'),{code:'MAIL_MESSAGE_SIZE_UNKNOWN'});
      if(!chosen.length&&size>MAIL_FETCH_MAX_BYTES)throw Object.assign(new Error('Raw message exceeds64MiB'),{code:'MAIL_MESSAGE_TOO_LARGE'});
      if(planned+size>MAIL_FETCH_MAX_BYTES)break;
      chosen.push(uid);planned+=size;
    }
    if(!chosen.length)return[];
    return new Promise((resolve,reject)=>{
      const rows:MailFetched[]=[],pending:Promise<void>[]=[],buffers:Buffer[][]=[];let received=0,failed=false;
      const stop=(error:unknown)=>{if(failed)return;failed=true;for(const chunks of buffers)chunks.length=0;rows.length=0;this.connection.imap.destroy();reject(error);};
      const fetch=this.connection.imap.fetch(chosen,{bodies:'',markSeen:false});
      fetch.on('message',(message:any)=>{
        const chunks:Buffer[]=[];buffers.push(chunks);let uid=0,flags:string[]=[];
        pending.push(new Promise<void>(done=>{
          message.on('body',(stream:any)=>stream.on('data',(chunk:Buffer)=>{
            if(failed)return;received+=chunk.length;
            if(received>MAIL_FETCH_MAX_BYTES){stop(Object.assign(new Error('Raw fetch budget exceeded'),{code:'MAIL_MESSAGE_TOO_LARGE'}));return;}
            chunks.push(Buffer.from(chunk));
          }));
          message.once('attributes',(attrs:any)=>{uid=Number(attrs?.uid);flags=Array.isArray(attrs?.flags)?attrs.flags:[];});
          message.once('end',()=>{if(!failed&&Number.isSafeInteger(uid)&&uid>0&&chunks.length)rows.push({uid,seen:flags.includes(SEEN),starred:flags.includes('\\Flagged'),raw:Buffer.concat(chunks)});done();});
        }));
      });
      fetch.once('error',stop);fetch.once('end',()=>{void Promise.all(pending).then(()=>{if(!failed)resolve(rows.sort((a,b)=>a.uid-b.uid));});});
    });
  }
  hasMessageId(messageId: string): Promise<boolean> {
    return new Promise((resolve, reject) => this.connection.imap.search([['HEADER', 'MESSAGE-ID', messageId]], (error: Error | null, uids: number[]) => error ? reject(error) : resolve((uids || []).length > 0)));
  }
  async append(path: string, raw: Buffer) { await this.connection.append(raw, { mailbox: path, flags: [SEEN] }); }
  async close(force=false) { try { if(force)this.connection.imap.destroy();else this.connection.end(); } catch { /* already closed */ } }
}

const tls = (host: string, insecureTls: boolean) => ({ servername: /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host, rejectUnauthorized: !insecureTls, minVersion: 'TLSv1.2' as const });

/**
 * SMTP 分阶段执行：连接/STARTTLS/登录阶段的任何失败都证明正文没有提交；
 * 投递阶段只有服务器明确回复拒绝（信封或正文被拒）才算失败，断线、超时等一律"结果不确定"。
 * 底层套接字错误不论阶段都标为 CONN，不能凭错误码判断，所以这里自行记录阶段。
 */
type Stage = 'connect' | 'login' | 'send';
function smtpSession(config: EmailTransport, secret: MistMailSecret, insecureTls: boolean, deliver?: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<MailSendResult> {
  const connection = new SMTPConnection({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, requireTLS: !config.smtpSecure, tls: tls(config.smtpHost, insecureTls), connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000, logger: false, debug: false } as any);
  let stage: Stage = 'connect', settled = false;
  return new Promise((resolve, reject) => {
    const finish = (error: any, info?: MailSendResult, replied = false) => {
      if (settled) return; settled = true;
      if (error) { const failure = error instanceof Error ? error : new Error(String(error)); Object.assign(failure, { mailStage: stage, mailReplied: replied }); try { connection.close(); } catch { /* closed */ } reject(failure); return; }
      try { connection.quit(); } catch { /* closed */ } resolve(info!);
    };
    connection.on('error', (error: any) => finish(error));
    connection.once('end', () => finish(Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION' })));
    connection.connect(() => {
      stage = 'login';
      connection.login({ user: secret.username, pass: secret.password } as any, (error: any) => {
        if (error) return finish(error);
        if (!deliver) return finish(null, { response: '', accepted: [], rejected: [] });
        stage = 'send';
        connection.send(deliver.envelope as any, deliver.raw, (failure: any, info: any) => {
          if (failure) return finish(failure, undefined, !!failure.responseCode || failure.code === 'EENVELOPE');
          finish(null, { response: String(info?.response || ''), accepted: (info?.accepted || []).map(String), rejected: (info?.rejected || []).map(String), rejectedReplies: smtpRejectedReplies(info) });
        });
      });
    });
  });
}

export const imapSmtpTransport: MailTransport = {
  async imap(config, secret, insecureTls) {
    const connection = await imaps.connect({ imap: {
      user: secret.username, password: secret.password, host: config.imapHost, port: config.imapPort, tls: config.imapSecure, autotls: config.imapSecure ? 'never' : 'required',
      authTimeout: 15000, connTimeout: 15000, socketTimeout:60000,tlsOptions: tls(config.imapHost, insecureTls),
    } } as any);
    // 断线等异步错误不能让进程退出；当前操作会因连接失效而得到明确错误。
    (connection as any).on?.('error', () => undefined);
    return new ImapSimpleSession(connection);
  },
  async smtpVerify(config, secret, insecureTls) { await smtpSession(config, secret, insecureTls); },
  smtpSend(config, secret, insecureTls, envelope, raw) { return smtpSession(config, secret, insecureTls, { envelope, raw }); },
};

/** 明确未送出 (failed) 与结果不确定 (unknown)：只有连接/登录阶段失败，或投递阶段服务器明确回复拒绝，才算 failed。 */
export function classifySmtpError(error: any): 'failed' | 'unknown' {
  if (error?.mailStage === 'connect' || error?.mailStage === 'login') return 'failed';
  if (error?.mailStage === 'send' && error?.mailReplied === true) return 'failed';
  return 'unknown';
}

/** 把底层协议错误转为可展示的中文原因；不包含凭据。 */
export function describeMailError(error: any, stage: 'imap' | 'smtp'): { code: string; message: string } {
  const code = String(error?.code || ''), text = String(error?.textCode || error?.source || ''), detail = String(error?.message || ''), label = stage === 'imap' ? '收信服务器' : '发信服务器';
  if(code==='MAIL_MESSAGE_TOO_LARGE')return{code,message:'邮件原件超过64MB上限，请在原邮箱处理后再同步'};
  if(code==='MAIL_MESSAGE_SIZE_UNKNOWN')return{code,message:'收信服务器未提供邮件大小，请联系维护人员'};
  if (code === 'EAUTH' || /AUTHENTICATIONFAILED|authentication/i.test(text) || /auth/i.test(detail) && /fail|invalid/i.test(detail)) return { code: 'MAIL_AUTH_FAILED', message: `${label}拒绝登录：用户名或密码不正确` };
  if (/SELF_SIGNED|CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(code + ' ' + detail)) return { code: 'MAIL_TLS_UNTRUSTED', message: `${label}证书不受信任，连接已中止` };
  if (code === 'ETIMEDOUT' || /timeout/i.test(text + ' ' + detail)) return { code: 'MAIL_TIMEOUT', message: `${label}连接超时` };
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNECTION', 'EHOSTUNREACH', 'ECONNRESET'].includes(code)) return { code: 'MAIL_CONNECT_FAILED', message: `无法连接${label}` };
  const reply = Number(error?.responseCode), said = String(error?.response || detail).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 160);
  if (stage === 'smtp' && reply >= 500 && reply < 600) return { code: 'SMTP_REJECTED', message: `发信服务器拒绝（${reply}${said ? `：${said}` : ''}）` };
  if (stage === 'smtp' && reply >= 400 && reply < 500) return { code: 'SMTP_TEMPORARY_FAILURE', message: `发信服务器暂时拒绝（${reply}${said ? `：${said}` : ''}），可稍后重发` };
  return { code: 'MAIL_PROTOCOL_ERROR', message: `${label}操作失败` };
}
