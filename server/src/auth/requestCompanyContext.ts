import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求级公司上下文。
 *
 * 权限重载点有几十处（各处重新加载账号角色后判 scope），逐个传 companyId 容易漏。
 * 这里在认证中间件按请求写入会话所属公司，权限加载默认读取它；
 * 显式传参仍然优先。没有上下文的调用（后台任务、测试、未迁移会话）保持原行为。
 */
/** 平台代管会话（2026-10-26）：平台人员在限定时间内以该公司超级管理员权限办理后台事务。 */
export type SupportSession = { companyId: string; companyName: string; reason: string; startedAt: string; expiresAt: string };

type CompanyStore = { companyId: string | null; support?: SupportSession };

const storage = new AsyncLocalStorage<CompanyStore>();

export function runWithCompanyContext<T>(companyId: string | null, fn: () => T, support?: SupportSession): T {
  return storage.run({ companyId, ...(support ? { support } : {}) }, fn);
}

export function currentSupportSession(): SupportSession | undefined {
  return storage.getStore()?.support;
}

/** undefined 表示当前没有请求上下文（区别于"明确不属于任何公司"的 null）。 */
export function currentCompanyId(): string | null | undefined {
  return storage.getStore()?.companyId;
}
