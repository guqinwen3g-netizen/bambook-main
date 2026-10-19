import type { PrismaClient } from '@prisma/client';
import { currentCompanyId } from '../auth/requestCompanyContext';
import { CompanyAccessError } from '../auth/companyAccess';

/** Enforce company ownership for the organizational models used by HR. */
export function companyHrClient(client: PrismaClient): PrismaClient {
  const wrap = (db: any): any => new Proxy(db, { get(target, key) {
    if (key === '$transaction') return (work: any, options: any) => typeof work === 'function' ? target.$transaction((tx: any) => work(wrap(tx)), options) : target.$transaction(work, options);
    const delegate = target[key];
    if (!delegate || typeof delegate !== 'object') return typeof delegate === 'function' ? delegate.bind(target) : delegate;
    return new Proxy(delegate, { get(model, operation) {
      const fn = model[operation];
      if (typeof fn !== 'function') return fn;
      return async (args: any = {}) => {
        const companyId = currentCompanyId(); if (!companyId) return fn.call(model, args);
        const member = { companyMembers: { some: { companyId, status: 'active' } } };
        const scopes: Record<string, any> = {
          department: { companyId }, role: { companyId }, userAccount: member,
          userRole: { role: { companyId } }, team: { department: { companyId } },
          teamMember: { team: { department: { companyId } } }, jobPosition: { department: { companyId } },
          employeeProfile: { AND: [{ user: member }, { OR: [{ position: { department: { companyId } } }, { positionId: null, user: { companyMembers: { none: { companyId: { not: companyId }, status: 'active' } } } }] }] },
        };
        const scope = scopes[String(key)];
        if (!scope) {
          if (key === 'auditLog' && operation === 'create') return fn.call(model, args);
          throw new CompanyAccessError('TENANT_ROUTE_UNAVAILABLE', '此人事接口尚未支持公司隔离。');
        }
        const next = { ...args };
        if (['create', 'createMany', 'upsert', 'update', 'updateMany'].includes(String(operation))) {
          const data = operation === 'upsert' ? args.create : args.data;
          for (const row of Array.isArray(data) ? data : [data]) {
            if (!row) continue;
            if (key === 'employeeProfile' && row.userId && !row.positionId && await db.companyMember.count({ where: { userId: row.userId, companyId: { not: companyId }, status: 'active' } })) throw new CompanyAccessError('COMPANY_POSITION_REQUIRED', '跨公司账号的员工档案必须指定本公司岗位。');
            if (key === 'department' && ['create', 'createMany', 'upsert'].includes(String(operation))) row.companyId = companyId;
            if (row.companyId && row.companyId !== companyId) throw new CompanyAccessError('NOT_FOUND', '记录不存在。', 404);
            for (const [field, modelName, where] of [
              ['departmentId', 'department', { companyId }], ['parentId', 'department', { companyId }],
              ['teamId', 'team', { department: { companyId } }], ['userId', 'userAccount', member],
              ['leaderId', 'userAccount', member], ['positionId', 'jobPosition', { department: { companyId } }],
            ] as const) if (row[field] && !await db[modelName].findFirst({ where: { id: row[field], ...where } })) throw new CompanyAccessError('NOT_FOUND', '关联记录不属于当前公司。', 404);
          }
        }
        if (!['create', 'createMany'].includes(String(operation))) next.where = { ...args.where, AND: [args.where?.AND ?? {}, scope] };
        if (key === 'userAccount' && next.include?.roles) next.include = { ...next.include, roles: { ...next.include.roles, where: { role: { companyId } }, include: { ...next.include.roles.include, department: true } } };
        const result = await fn.call(model, next);
        if (key !== 'userAccount' || !result) return result;
        const project = (row: any) => { const department = row.roles?.find((r: any) => r.department?.companyId === companyId)?.department ?? (row.primaryDepartment?.companyId === companyId ? row.primaryDepartment : null); return { ...row, primaryDeptId: department?.id ?? null, ...(row.primaryDepartment !== undefined ? { primaryDepartment: department } : {}) }; };
        return Array.isArray(result) ? result.map(project) : typeof result === 'object' ? project(result) : result;
      };
    } });
  } });
  return wrap(client);
}
