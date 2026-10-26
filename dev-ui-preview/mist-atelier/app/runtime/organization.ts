/** Company accounts and organization live in the main API (UserAccount / Department / Team), not in a Mist workspace. */
import { apiService } from '../../../../services/apiService';

export const BUSINESS_ATTRIBUTES = [
  { value: 'fabric_business', label: '面料业务' }, { value: 'garment_business', label: '成衣业务' },
  { value: 'fabric_qc', label: '面料 QC' }, { value: 'garment_qc', label: '成衣 QC' },
  { value: 'finance', label: '财务' }, { value: 'logistics', label: '后勤单证' }, { value: 'marketing', label: '营销' },
  { value: 'support', label: '综合支持' }, { value: 'management', label: '管理' },
] as const;
export type BusinessAttribute = typeof BUSINESS_ATTRIBUTES[number]['value'];
export const attributeLabel = (value: string) => BUSINESS_ATTRIBUTES.find(a => a.value === value)?.label ?? value;

export const ACCOUNT_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'bad' }> = {
  active: { label: '已启用', tone: 'ok' }, pending: { label: '待审批', tone: 'warn' }, disabled: { label: '已停用', tone: 'neutral' }, rejected: { label: '已拒绝', tone: 'bad' },
};
export const EMPLOYMENT_STATUS: Record<string, string> = { Probation: '试用期', Regular: '正式', Suspended: '停职', Resigned: '已离职', Terminated: '已解除' };
export const CONTRACT_TYPES = [{ value: 'FixedTerm', label: '固定期限' }, { value: 'OpenEnded', label: '无固定期限' }, { value: 'PartTime', label: '非全日制' }, { value: 'Intern', label: '实习' }];

export interface OrgDepartment { id: string; name: string; parentId: string | null; status?: string; businessAttributes?: BusinessAttribute[] }
export interface AdminAccount { id: string; displayName: string; email: string; status: string; roles: string[]; roleIds: string[]; departmentId: string | null; department: string | null; lastLoginAt: string | null; createdAt: string; metadata?: Record<string, unknown> | null; identityEditable?: boolean }
export interface AdminRole { id: string; name: string; description: string | null; isSystem: boolean; permissions: string[] }
export interface AuditLogRow { id: string; actorId: string; action: string; targetType: string; targetId: string | null; createdAt: string; ip?: string | null }
export interface OrgPerson { id: string; displayName: string; email: string; status: string; roles: string[]; departmentId: string | null; department: string | null; lastLoginAt: string | null }
export interface OrgTeam { id: string; name: string; description: string | null; leaderId: string | null; departmentId: string; department: string | null; businessAttributes: BusinessAttribute[]; status: string; memberCount: number; members: Array<{ id: string; userId: string; role: string; leftAt: string | null }> }
export interface EmployeeProfile { userId: string; employeeNo: string; displayName: string | null; departmentId?: string | null; department?: string | null; positionId: string | null; position: string | null; hireDate: string | null; regularDate: string | null; contractType: string | null; contractEnd: string | null; employmentStatus: string; phone: string | null; emergencyContact: string | null; workLocation: string | null; notes: string | null }
export interface OrgPosition { id: string; title: string; departmentId: string | null; department: string | null; headcount?: number; status?: string; description?: string | null }
export interface EmploymentEvent { id: string; userId: string; type: string; effectiveDate: string; fromStatus?: string | null; toStatus?: string | null; fromDeptId: string | null; toDeptId: string | null; fromPositionId: string | null; toPositionId: string | null; reason: string | null; operatorId: string | null; createdAt: string }

/** 在职变动（与服务端 hrService EVENT_ALLOWED_FROM 同口径；服务端仍是最终校验）。 */
export const EMPLOYMENT_EVENTS: Array<{ value: string; label: string; from: string[]; terminal?: boolean; position?: boolean }> = [
  { value: 'Regularize', label: '转正', from: ['Probation'] },
  { value: 'Transfer', label: '调岗', from: ['Probation', 'Regular'], position: true },
  { value: 'Promote', label: '晋升', from: ['Probation', 'Regular'], position: true },
  { value: 'Suspend', label: '停职', from: ['Probation', 'Regular'] },
  { value: 'Resume', label: '复职', from: ['Suspended'] },
  { value: 'Resign', label: '离职', from: ['Probation', 'Regular', 'Suspended'], terminal: true },
  { value: 'Terminate', label: '解除劳动关系', from: ['Probation', 'Regular', 'Suspended'], terminal: true },
  { value: 'Onboard', label: '返聘', from: ['Resigned', 'Terminated'] },
];
export const eventLabel = (type: string, fromStatus?: string | null) => type === 'Onboard' ? fromStatus === undefined ? '入职 / 返聘' : fromStatus === null ? '入职' : '返聘' : EMPLOYMENT_EVENTS.find(e => e.value === type)?.label ?? type;
export const ACTIVE_EMPLOYMENT = ['Probation', 'Regular', 'Suspended'];

export type ApprovalBusinessLine = 'fabric' | 'garment';
export type SupplierAuthorityKind = 'purchase' | 'processing';
export type ApprovalCandidate = { id: string; displayName: string; email: string; status?: string; isOwner?: boolean };
export type OrderApprovalAssignment = { businessLine: ApprovalBusinessLine; userId: string; user?: { id: string; displayName: string; email: string } };

export class OrganizationRequestError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    method: init.method ?? 'GET', credentials: 'include', cache: 'no-store',
    headers: { ...apiService.getAuthHeaders(), ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    // 供应商合同接口以 { error: 中文说明, code } 返回；其余接口以 { error: 代码, message } 返回。
    const supplierShape = typeof data?.error === 'string' && typeof data?.code === 'string';
    const code = supplierShape ? data.code : typeof data?.error === 'string' ? data.error : data?.error?.code;
    const message = data?.message || data?.error?.message || (supplierShape ? data.error : '') || (response.status === 403 ? '当前账号没有这项操作的权限' : response.status === 401 ? '登录已失效，请重新登录' : '请求未完成，请重试');
    throw new OrganizationRequestError(message, response.status, code);
  }
  return data as T;
}
const id = (value: string) => encodeURIComponent(value);

export const organizationApi = {
  // 管理后台（owner / admin）
  listAccounts: () => call<{ users: AdminAccount[]; departments: OrgDepartment[] }>('/admin/users'),
  listRoles: () => call<{ roles: AdminRole[] }>('/admin/roles'),
  listPermissions: () => call<{ permissions: Array<{ id: string; scope: string; description: string | null }> }>('/admin/permissions'),
  createRole: (body: { name: string; description: string; permissions: string[] }) => call<{ role: AdminRole }>('/admin/roles', { method: 'POST', body }),
  updateRole: (roleId: string, body: { name: string; description: string }) => call<{ ok: true }>('/admin/roles/' + id(roleId), { method: 'PATCH', body }),
  deleteRole: (roleId: string) => call<{ ok: true }>('/admin/roles/' + id(roleId), { method: 'DELETE' }),
  updateRolePermissions: (roleId: string, body: { addPermissions: string[]; removePermissions: string[] }) => call<{ ok: true }>('/admin/roles/' + id(roleId) + '/permissions', { method: 'PATCH', body }),
  createAccount: (body: { displayName: string; email: string; password: string; roles: string[]; departmentId: string }) => call<{ userId: string; reactivated: boolean }>('/admin/users', { method: 'POST', body }),
  updateAccount: (userId: string, body: { displayName?: string; email?: string; departmentId?: string; status?: string }) => call<{ ok: true }>('/admin/users/' + id(userId), { method: 'PATCH', body }),
  setRoles: (userId: string, roles: string[], departmentId: string | null) => call<{ ok: true }>('/admin/users/' + id(userId) + '/roles', { method: 'PATCH', body: { roles, departmentId } }),
  saveAccountAssignment: (userId: string, body: { roles: string[]; departmentId: string | null; displayName?: string; email?: string }) => call<{ ok: true }>('/admin/users/' + id(userId) + '/roles', { method: 'PATCH', body }),
  approve: (userId: string, roles: string[], departmentId: string) => call<{ emailStatus?: string }>('/admin/users/' + id(userId) + '/approve', { method: 'POST', body: { roles, departmentId } }),
  reject: (userId: string, reason: string) => call<{ ok: true }>('/admin/users/' + id(userId) + '/reject', { method: 'POST', body: { reason } }),
  disable: (userId: string) => call<{ ok: true }>('/admin/users/' + id(userId) + '/disable-account', { method: 'POST', body: {} }),
  resetPassword: (userId: string) => call<{ temporaryPassword?: string }>('/admin/users/' + id(userId) + '/reset-password', { method: 'POST', body: {} }),
  // 审批资格：订单主审批负责人（users:admin）与供应商承诺审批人（老板/管理员 + dictionary:write）。
  orderApprovalAuthorities: () => call<{ assignments: OrderApprovalAssignment[]; users: ApprovalCandidate[] }>('/admin/order-approval-authorities'),
  setOrderApprovalAuthorities: (businessLine: ApprovalBusinessLine, userIds: string[]) => call<{ assignments: OrderApprovalAssignment[] }>('/admin/order-approval-authorities/' + id(businessLine), { method: 'PUT', body: { userIds } }),
  supplierApprovalAuthority: (kind: SupplierAuthorityKind, family: ApprovalBusinessLine) => call<{ item: { key: string; version: number; userIds: string[] } }>('/v1/procurement/contracts/approval-authority/' + id(kind) + '/' + id(family)),
  setSupplierApprovalAuthority: (kind: SupplierAuthorityKind, family: ApprovalBusinessLine, body: { requestKey: string; userIds: string[]; expectedConfigVersion: number; reason: string }) => call<unknown>('/v1/procurement/contracts/approval-authority/' + id(kind) + '/' + id(family), { method: 'PUT', body }),
  auditLogs: (query: { limit?: number; offset?: number; action?: string; targetType?: string }) => {
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return call<{ logs: AuditLogRow[]; total: number }>('/admin/audit-logs' + (q.size ? '?' + q : ''));
  },
  // 人事（hr:read / hr:write）
  personnel: () => call<{ personnel: OrgPerson[]; departments: OrgDepartment[]; positions: OrgPosition[] }>('/hr/personnel'),
  teams: () => call<{ teams: OrgTeam[] }>('/hr/teams'),
  createDepartment: (body: { name: string; parentId: string; businessAttributes: BusinessAttribute[] }) => call<{ department: OrgDepartment }>('/hr/departments', { method: 'POST', body }),
  updateDepartment: (departmentId: string, body: { name: string; businessAttributes: BusinessAttribute[] }) => call<unknown>('/hr/departments/' + id(departmentId), { method: 'PATCH', body }),
  retireDepartment: (departmentId: string, targetDepartmentId?: string) => call<unknown>('/hr/departments/' + id(departmentId) + '/retire', { method: 'POST', body: targetDepartmentId ? { targetDepartmentId } : {} }),
  createTeam: (body: { name: string; departmentId: string; description?: string }) => call<{ team: OrgTeam }>('/hr/teams', { method: 'POST', body }),
  updateTeam: (teamId: string, body: { name?: string; departmentId?: string; description?: string }) => call<unknown>('/hr/teams/' + id(teamId), { method: 'PATCH', body }),
  dissolveTeam: (teamId: string) => call<unknown>('/hr/teams/' + id(teamId) + '/dissolve', { method: 'POST', body: {} }),
  memberCandidates: (teamId: string) => call<{ users: Array<{ id: string; displayName: string; email: string }> }>('/hr/teams/' + id(teamId) + '/member-candidates'),
  addMember: (teamId: string, userId: string) => call<unknown>('/hr/teams/' + id(teamId) + '/members', { method: 'POST', body: { userId } }),
  removeMember: (teamId: string, userId: string) => call<unknown>('/hr/teams/' + id(teamId) + '/members/' + id(userId), { method: 'DELETE' }),
  profile: async (userId: string): Promise<EmployeeProfile | null> => {
    try { return (await call<{ profile: EmployeeProfile }>('/hr/employees/' + id(userId))).profile; }
    catch (error) { if (error instanceof OrganizationRequestError && error.status === 404) return null; throw error; }
  },
  employees: () => call<{ employees: EmployeeProfile[] }>('/hr/employees'),
  createPosition: (body: { title: string; departmentId: string; headcount: number; description?: string }) => call<unknown>('/hr/positions', { method: 'POST', body }),
  updatePosition: (positionId: string, body: { title?: string; departmentId?: string; headcount?: number; description?: string | null; status?: string }) => call<unknown>('/hr/positions/' + id(positionId), { method: 'PATCH', body }),
  deletePosition: (positionId: string) => call<unknown>('/hr/positions/' + id(positionId), { method: 'DELETE' }),
  employmentEvents: (userId: string) => call<{ events: EmploymentEvent[] }>('/hr/employment-events?userId=' + id(userId) + '&limit=50'),
  recordEvent: (body: { userId: string; type: string; effectiveDate: string; fromDeptId?: string | null; toDeptId?: string | null; fromPositionId?: string | null; toPositionId?: string | null; reason?: string | null }) => call<{ event: EmploymentEvent; accountDisabled?: boolean; leftTeams?: number }>('/hr/employment-events', { method: 'POST', body }),
  saveProfile: (userId: string, body: Partial<Pick<EmployeeProfile, 'positionId' | 'hireDate' | 'regularDate' | 'contractType' | 'contractEnd' | 'phone' | 'emergencyContact' | 'workLocation' | 'notes'>>) => call<{ profile: EmployeeProfile }>('/hr/employees/' + id(userId), { method: 'PUT', body }),
};

/** Keep every active descendant selectable; the path distinguishes nested departments. */
export function departmentOptions(departments: OrgDepartment[], { includeRoot = false } = {}) {
  const active = departments.filter(d => !d.status || d.status === 'active');
  const roots = active.filter(d => !d.parentId), visited = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];
  const walk = (parentId: string, path: string[]) => {
    for (const department of active.filter(d => d.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      if (visited.has(department.id)) continue;
      visited.add(department.id);
      const names = [...path, department.name];
      options.push({ value: department.id, label: names.join(' / ') });
      walk(department.id, names);
    }
  };
  for (const root of roots) {
    visited.add(root.id);
    if (includeRoot) options.push({ value: root.id, label: root.name });
    walk(root.id, roots.length > 1 || includeRoot ? [root.name] : []);
  }
  return options;
}
