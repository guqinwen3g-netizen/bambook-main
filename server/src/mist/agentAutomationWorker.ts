/** 自动模式的调度：定时扫描已启用的规则，按规则所有者的当前权限判断并触发。没有人登录也能运行。 */
import type { TokenPayload } from '../auth/service';
import type { MakeServiceCredential } from './agentIdentities';
import type { AutomationAuthority } from './agentAutomations';
import type { MistRepository } from './repository';

export class MistAutomationWorker {
  private timer?: ReturnType<typeof setInterval>; private scanning = false;
  constructor(private repository: MistRepository, private options: { make: MakeServiceCredential; localActor?: (id: string) => Promise<TokenPayload> | TokenPayload; tickMs?: number; onError?: (code: string) => void; now?: () => number }) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  async actor(grant: AutomationAuthority): Promise<TokenPayload> {
    const base = this.options.localActor ? await this.options.localActor(grant.ownerId) : { userId: grant.ownerId, roles: [], permissions: [], departmentIds: [], authorizationLoaded: true as const };
    return { ...base, ...(grant.companyId ? { companyId: grant.companyId } : {}), iat: Math.floor(grant.issuedAt / 1000), credentialVersion: grant.credentialVersion } as TokenPayload;
  }
  start(tickMs = this.options.tickMs ?? 30_000) { if (this.timer) return; this.timer = setInterval(() => void this.tick(), tickMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = undefined; }
  async tick() {
    if (this.scanning) return; this.scanning = true;
    try {
      for (const job of await this.repository.dueAutomations(50)) {
        try { await this.repository.runAutomation(await this.actor(job.authority), job.workspaceId, job.id, this.options.make, this.now()); }
        catch (error) { this.options.onError?.('AUTOMATION_RUN_FAILED ' + (error as Error)?.message); }
      }
    } catch (error) { this.options.onError?.('AUTOMATION_SCAN_FAILED ' + (error as Error)?.message); } finally { this.scanning = false; }
  }
}
