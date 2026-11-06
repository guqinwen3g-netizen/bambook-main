import { currentCompanyId, currentPlatformCompanyContext } from '../auth/requestCompanyContext';

/**
 * 审计日志的公司归属（AuditLog.companyId）。
 *
 * 写审计的地方有上百处，逐个传 companyId 容易漏；这里在 Prisma 层统一补齐：
 *   1. 调用方显式给了 companyId（含 null）→ 原样保留；
 *   2. 否则取请求级公司上下文（认证守卫写入，含平台进入公司的会话）；
 *   3. 没有上下文时（平台后台、后台任务、登录前）再看 detail.companyId（公司账号生命周期等写入已带）。
 * 都没有则保持 NULL（平台级或历史单租户记录）。只接受 UUID，避免把非法值写进 uuid 列导致审计失败。
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auditCompanyIdFor(data: any): string | null | undefined {
  if (!data || typeof data !== 'object') return undefined;
  if (data.companyId !== undefined || data.company !== undefined) return undefined;
  const context = currentCompanyId() ?? currentPlatformCompanyContext()?.companyId;
  if (typeof context === 'string' && UUID.test(context)) return context;
  const detail = data.detail;
  const fromDetail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail.companyId : undefined;
  if (typeof fromDetail === 'string' && UUID.test(fromDetail)) return fromDetail;
  return undefined;
}

function stamp(data: any) {
  if (data?.actor || data?.company) return data; // relation-style create: leave untouched
  const companyId = auditCompanyIdFor(data);
  return companyId === undefined ? data : { ...data, companyId };
}

type MiddlewareClient = { $use?: (fn: (params: any, next: (params: any) => Promise<any>) => Promise<any>) => void };

/** 在 PrismaClient 创建后立即调用；交互式事务内的写入同样经过 $use。 */
export function installAuditCompanyStamp(prisma: MiddlewareClient): void {
  if (typeof prisma?.$use !== 'function') return;
  prisma.$use(async (params, next) => {
    if (params?.model !== 'AuditLog' || !params.args) return next(params);
    if (params.action === 'create') params.args = { ...params.args, data: stamp(params.args.data) };
    else if (params.action === 'createMany' && Array.isArray(params.args.data)) params.args = { ...params.args, data: params.args.data.map(stamp) };
    else if (params.action === 'upsert') params.args = { ...params.args, create: stamp(params.args.create) };
    return next(params);
  });
}
