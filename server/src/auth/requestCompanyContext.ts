import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求级公司上下文。
 *
 * 权限重载点有几十处（各处重新加载账号角色后判 scope），逐个传 companyId 容易漏。
 * 这里在认证中间件按请求写入会话所属公司，权限加载默认读取它；
 * 显式传参仍然优先。没有上下文的调用（后台任务、测试、未迁移会话）保持原行为。
 */
/** 平台管理员选择的公司范围；身份仍是平台人员，不创建公司成员关系。 */
export type PlatformCompanyContext = { companyId: string; companyName: string; startedAt: string };

type CompanyStore = { companyId: string | null; platformCompany?: PlatformCompanyContext };

const storage = new AsyncLocalStorage<CompanyStore>();

export function runWithCompanyContext<T>(companyId: string | null, fn: () => T, platformCompany?: PlatformCompanyContext): T {
  return storage.run({ companyId, ...(platformCompany ? { platformCompany } : {}) }, fn);
}

export function currentPlatformCompanyContext(): PlatformCompanyContext | undefined {
  return storage.getStore()?.platformCompany;
}

/** undefined 表示当前没有请求上下文（区别于"明确不属于任何公司"的 null）。 */
export function currentCompanyId(): string | null | undefined {
  return storage.getStore()?.companyId;
}
