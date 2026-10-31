import type { TokenPayload } from '../../auth/service';
import type { MistRepository } from '../repository';
import type { MistMailService } from './service';
import type { ReceiveAuthority, ReceivingJob } from './receiverRegistry';

export type MailReceiverOptions = {
  tickMs?: number; concurrency?: number; now?: () => number;
  localActor?: (ownerId: string) => Promise<TokenPayload>;
  onError?: (code: string) => void;
};

/** Only the canonical Mist application starts this loop. Registrations remain opt-in and durable. */
export class MistMailReceiver {
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
  private scanning = false;
  private scanDone:Promise<void>=Promise.resolve();
  private enabled = false;
  private runs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly now: () => number;
  constructor(private readonly repository: MistRepository, private readonly mail: MistMailService, private readonly options: MailReceiverOptions = {}) {
    this.now = options.now ?? Date.now;
  }
  get running() { return this.enabled; }
  start(initialDelayMs=1000) {
    if (this.enabled) return;
    this.enabled = true;
    this.timer = setInterval(() => { void this.tick(); }, this.options.tickMs ?? 15_000);
    this.first = setTimeout(() => { void this.tick(); }, initialDelayMs);
    this.timer.unref?.(); this.first.unref?.();
  }
  async stop() {
    this.enabled = false; clearInterval(this.timer); clearTimeout(this.first);
    for (const run of this.runs.values()) run.controller.abort();
    await this.scanDone;
    await Promise.allSettled([...this.runs.values()].map(run => run.done));
  }
  private async actor(grant: ReceiveAuthority): Promise<TokenPayload> {
    const base = this.options.localActor ? await this.options.localActor(grant.ownerId) : {
      userId: grant.ownerId, roles: [], permissions: [], departmentIds: [], authorizationLoaded: true as const,
    };
    const actor:TokenPayload&{iat:number;mailReceivingWorker:true}={ ...base, ...(grant.companyId ? { companyId: grant.companyId } : {}),
      iat: Math.floor(grant.issuedAt / 1000), credentialVersion: grant.credentialVersion,
      mailReceivingWorker:true, permissionCeiling: [...grant.ceiling] };
    return actor;
  }
  private async perform(job: ReceivingJob, signal: AbortSignal) {
    try {
      const actor = await this.actor(job.authority);
      if (signal.aborted) return;
      await this.mail.sync(actor, job.workspaceId, job.accountId, { background: true, job, signal });
    } catch (error: any) {
      if (signal.aborted || error?.code === 'MAIL_BUSY' || error?.code === 'MAIL_SYNC_STOPPED') return;
      if ([401, 403, 404].includes(error?.status) || ['MAIL_RECEIVING_CHANGED', 'MAIL_CREDENTIAL_MISSING'].includes(error?.code)) {
        const config = error?.code === 'MAIL_RECEIVING_CHANGED';
        await this.repository.blockMailReceiving(job, {
          code: config ? 'MAIL_SOURCE_CHANGED' : 'MAIL_AUTH_CHANGED',
          message: config ? '邮箱设置已变更，请重新开启自动收件' : '接入人或邮箱授权已失效，请本人重新开启自动收件',
        }, this.now()).catch(() => this.options.onError?.('MAIL_RECEIVING_BLOCK_FAILED'));
      } else this.options.onError?.('MAIL_RECEIVING_RUN_FAILED');
    }
  }
  async tick() {
    if (!this.enabled || this.scanning) return;
    const capacity = (this.options.concurrency ?? 2) - this.runs.size;
    if (capacity <= 0) return;
    this.scanning = true;
    let scanned!:()=>void;this.scanDone=new Promise(resolve=>{scanned=resolve;});
    const started: Promise<void>[] = [];
    try {
      const jobs = await this.repository.dueMailReceiving(this.now(), capacity);
      for (const job of jobs) {
        if (!this.enabled) break;
        const key = job.workspaceId + ':' + job.accountId;
        if (this.runs.has(key)) continue;
        const controller = new AbortController();
        const done = this.perform(job, controller.signal).finally(() => this.runs.delete(key));
        this.runs.set(key, { controller, done }); started.push(done);
      }
    } catch { this.options.onError?.('MAIL_RECEIVING_SCAN_FAILED'); }
    finally { this.scanning = false;scanned(); }
    await Promise.allSettled(started);
  }
}
