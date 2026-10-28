// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Nav } from '../../nav';
import { SettingsPage as CompanyAdminPage } from '../SettingsPage';
import { HrOrganizationPage } from './HrOrganization';

const bridge = vi.hoisted(() => ({ companyId: null as string | null, roles: ['owner'] as string[], perms: ['*'] as string[], localMode: false, changeMember: vi.fn(), members: [] as any[], calls: [] as Array<{ method: string; url: string; body: any }>, routes: {} as Record<string, (body: any) => any> }));
vi.mock('../../runtime/auth', () => { const useMistSession = () => ({ user: { id: 'owner-1', companyId: bridge.companyId, displayName: '老板', roles: bridge.roles, roleLabels: [] }, sessionKey: 'k', localMode: bridge.localMode, hasRole: (...r: string[]) => r.some(x => bridge.roles.includes(x)), hasPermission: (p: string) => bridge.perms.includes('*') || bridge.perms.includes(p), canAccessView: () => true }); return { useMistSession, useOptionalMistSession: useMistSession }; });
vi.mock('../../runtime/workspace', () => ({ useMistWorkspace: () => ({ state: { members: bridge.members }, workspace: { id: 'w', name: '空间', ownerId: 'owner-1', access: { canManageMembers: bridge.roles.includes('owner') } }, changeMember: bridge.changeMember }) }));
vi.mock('../../../../../services/apiService', () => ({ apiService: { getAuthHeaders: () => ({ Authorization: 'Bearer t' }), getCompanyExporterProfile: vi.fn(async () => ({ value: { nameEn: 'X' }, version: 1 })), updateCompanyExporterProfile: vi.fn() } }));

const departments = [{ id: 'root', name: '公司', parentId: null }, { id: 'd1', name: '面料业务部', parentId: 'root', businessAttributes: ['fabric_business'] }];
const roles: Array<{ id: string; name: string; description: string | null; isSystem: boolean; permissions: string[] }> = [{ id: 'role-super-admin', name: '老板', description: null, isSystem: true, permissions: ['*'] }, { id: 'role-sales', name: '业务员', description: null, isSystem: true, permissions: ['orders:read'] }];
let root: Root | undefined, host: HTMLDivElement; const go = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  bridge.companyId = null; bridge.roles = ['owner']; bridge.perms = ['*']; bridge.localMode = false; bridge.members = []; bridge.calls = []; bridge.changeMember.mockReset(); bridge.changeMember.mockResolvedValue(undefined); go.mockReset();
  bridge.routes = {
    'GET /api/admin/users': () => ({ ok: true, departments, users: [{ id: 'u1', displayName: '张三', email: 'z@x.test', status: 'pending', roles: [], roleIds: [], departmentId: null, department: null, lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z' }] }),
    'GET /api/admin/roles': () => ({ ok: true, roles }),
    'POST /api/admin/users': () => ({ ok: true, userId: 'u2', reactivated: false }),
    'POST /api/admin/users/u1/approve': () => ({ ok: true }),
    'GET /api/hr/personnel': () => ({ ok: true, departments, positions: [], personnel: [{ id: 'u3', displayName: '李四', email: 'l@x.test', status: 'active', roles: ['业务员'], departmentId: 'd1', department: '面料业务部', lastLoginAt: null }] }),
    'GET /api/hr/teams': () => ({ ok: true, teams: [{ id: 't1', name: '面料一组', description: null, leaderId: null, departmentId: 'd1', department: '面料业务部', businessAttributes: ['fabric_business'], status: 'active', memberCount: 1, members: [{ id: 'm1', userId: 'u3', role: 'member', leftAt: null }] }] }),
    'POST /api/hr/departments': () => ({ ok: true, department: { id: 'd2' } }),
    'GET /api/hr/employees/u3': () => null,
    'GET /api/hr/employees': () => ({ ok: true, employees: [] }),
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(init.body) : undefined;
    bridge.calls.push({ method, url, body });
    const handler = bridge.routes[`${method} ${url}`];
    const data = handler ? handler(body) : undefined;
    if (data === null || !handler) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'NOT_FOUND' }) };
    return { ok: true, status: 200, json: async () => data };
  }));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.unstubAllGlobals(); });
async function render(Page: React.FC, view: string, section?: string) {
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); }
  await act(async () => root!.render(<Nav.Provider value={{ route: { view, section }, go, theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn(), openAI: vi.fn() } as any}><Page /></Nav.Provider>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
async function click(text: string) { const b = button(text); expect(b, text).toBeTruthy(); await act(async () => b!.click()); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
async function type(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
const seg = (module: string, option: string) => [...(document.querySelector(`[role="group"][aria-label="${module}权限"]`)?.querySelectorAll('button') ?? [])].find(b => b.textContent?.trim() === option) as HTMLButtonElement;
const labelled = (label: string) => [...document.querySelectorAll('label.mist-field')].find(l => l.querySelector('.mist-field-label')?.textContent?.replace('*', '').trim() === label)?.querySelector('input,select') as HTMLInputElement | HTMLSelectElement;

describe('管理后台 · 账号', () => {
  it('lists accounts, flags pending registrations and approves with department, roles and workspace access', async () => {
    await render(CompanyAdminPage, 'admin-panel');
    expect(document.body.textContent).toContain('1 个注册申请待审批');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await click('审批通过');
    await type(labelled('任职部门'), 'd1');
    await type(labelled('岗位'), 'role-sales');
    await click('通过审批');
    expect(bridge.calls.find(c => c.url === '/api/admin/users/u1/approve')?.body).toEqual({ roles: ['role-sales'], departmentId: 'd1' });
    expect(bridge.changeMember).toHaveBeenCalledWith('add', 'u1');
  });
  it('shows audit operators and account targets by name with Chinese action and object labels', async () => {
    bridge.routes['GET /api/admin/audit-logs?limit=50&offset=0'] = () => ({ ok: true, total: 2, logs: [{ id: 'a1', actorId: 'u1', action: 'login', targetType: 'UserAccount', targetId: 'u1', createdAt: '2026-10-18T02:00:00Z' }, { id: 'a2', actorId: 'ghost', action: 'create_role', targetType: 'Role', targetId: 'role-x', createdAt: '2026-10-18T03:00:00Z' }] });
    await render(CompanyAdminPage, 'admin-panel', 'audit');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const table = document.querySelector('[aria-label="审计日志"]')!.textContent!;
    expect(table).toContain('张三');
    expect(table).toContain('登录');
    expect(table).toContain('账号');
    expect(table).not.toContain('UserAccount');
    expect(table).toContain('ghost');
    expect(table).toContain('新建岗位');
  });
  it('keeps an account action failure visible inside its confirmation dialog', async () => {
    bridge.routes['GET /api/admin/users'] = () => ({ ok: true, departments, users: [{ id: 'u1', displayName: '张三', email: 'z@x.test', status: 'disabled', roles: ['业务员'], roleIds: ['role-sales'], departmentId: 'd1', department: '面料业务部', lastLoginAt: null, createdAt: '' }] });
    bridge.routes['PATCH /api/admin/users/u1'] = () => { throw new Error('请在人事管理中办理复职或返聘。'); };
    await render(CompanyAdminPage, 'admin-panel');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await click('重新启用'); await click('确认');
    expect(document.querySelector('.mist-dialog')?.textContent).toContain('请在人事管理中办理复职或返聘。');
  });
  it('locks the 老板 role for administrators who are not the owner and offers no workspace grant', async () => {
    bridge.roles = ['admin'];
    await render(CompanyAdminPage, 'admin-panel');
    await click('新建账号');
    expect([...labelled('岗位').querySelectorAll('option')].map(o => o.textContent)).not.toContain('老板');
    expect(document.body.textContent).toContain('你不是「空间」的所有者');
    expect(button('AI 模型订阅')).toBeUndefined();
  });
  it('automatically joins new company accounts without the retired workspace-owner authorization', async () => {
    bridge.companyId = 'company-1'; bridge.roles = ['sales'];
    await render(CompanyAdminPage, 'company-settings'); await click('新建账号');
    expect(document.body.textContent).not.toContain('所有者');
    await type(labelled('姓名'), '王宁'); await type(labelled('登录邮箱'), 'wang@example.invalid');
    await type(labelled('初始密码'), 'SyntheticAccount7!'); await type(labelled('任职部门'), 'd1'); await type(labelled('岗位'), 'role-sales');
    await click('创建账号');
    expect(bridge.calls.some(c => c.method === 'POST' && c.url === '/api/admin/users')).toBe(true);
    expect(bridge.changeMember).not.toHaveBeenCalled();
  });
  it('confirms first-manager appointment only when the server offers it for a new account', async () => {
    bridge.companyId = 'company-1'; bridge.roles = ['sales'];
    const accounts = bridge.routes['GET /api/admin/users'];
    bridge.routes['GET /api/admin/users'] = () => ({ ...accounts(undefined), capabilities: { canAppointInitialGeneralManager: true } });
    await render(CompanyAdminPage, 'company-settings'); await click('新建账号');
    expect([...labelled('岗位').querySelectorAll('option')].map(o => o.value)).toContain('role-super-admin');
    await type(labelled('姓名'), '王宁'); await type(labelled('登录邮箱'), 'wang@example.invalid');
    await type(labelled('初始密码'), 'SyntheticAccount7!'); await type(labelled('任职部门'), 'd1'); await type(labelled('岗位'), 'role-super-admin');
    await click('创建账号');
    expect(bridge.calls.some(c => c.method === 'POST')).toBe(false);
    expect(document.querySelector('.mist-dialog')?.textContent).toContain('全公司业务与审批权限');
    await click('确认指定');
    expect(bridge.calls.find(c => c.method === 'POST')?.body).toMatchObject({ appointInitialGeneralManager: true, roles: ['role-super-admin'] });
    expect(bridge.changeMember).not.toHaveBeenCalled();
  });
  it('lets the owner set module levels for a 岗位 after reviewing the diff, and keeps 老板 fixed', async () => {
    bridge.routes['GET /api/admin/permissions'] = () => ({ ok: true, permissions: ['orders:read', 'orders:write', 'orders:delete', 'reports:read', 'shipments:read', 'shipments:write'].map((scope, i) => ({ id: 'p' + i, scope, description: null })) });
    bridge.routes['PATCH /api/admin/roles/role-sales/permissions'] = () => ({ ok: true });
    await render(CompanyAdminPage, 'admin-panel', 'roles');
    expect(document.body.textContent).toContain('不可调整');
    expect(document.body.textContent).toContain('查看 1');
    await click('调整权限');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(seg('订单', '查看').getAttribute('aria-pressed')).toBe('true');
    await act(async () => seg('订单', '办理').click());
    await act(async () => seg('报表与毛利', '查看').click());
    expect(document.body.textContent).toContain('办理需任职部门含「面料业务或成衣业务」');
    await click('保存（新增 3 · 移除 0）');
    expect(bridge.calls.some(c => c.method === 'PATCH')).toBe(false);
    await click('确认调整');
    expect(bridge.calls.find(c => c.method === 'PATCH')?.body).toEqual({ addPermissions: ['orders:write', 'orders:delete', 'reports:read'], removePermissions: [] });
  });
  it('lets the owner create a 岗位 from an existing 岗位 or a common template, then rename and delete it', async () => {
    bridge.routes['GET /api/admin/permissions'] = () => ({ ok: true, permissions: ['orders:read', 'reports:read', 'shipments:read', 'shipments:write', 'customs:read', '*'].map((scope, i) => ({ id: 'p' + i, scope, description: null })) });
    bridge.routes['POST /api/admin/roles'] = body => { roles.push({ id: 'role-custom-1', name: body.name, description: body.description, isSystem: false, permissions: body.permissions }); return { ok: true, role: roles.at(-1) }; };
    bridge.routes['PATCH /api/admin/roles/role-custom-1'] = body => { Object.assign(roles.find(r => r.id === 'role-custom-1')!, body); return { ok: true }; };
    bridge.routes['DELETE /api/admin/roles/role-custom-1'] = () => { roles.splice(roles.findIndex(r => r.id === 'role-custom-1'), 1); return { ok: true }; };
    try {
      await render(CompanyAdminPage, 'admin-panel', 'roles');
      await click('新建岗位');
      await click('创建岗位（0 项权限）');
      expect(document.body.textContent).toContain('请填写岗位名称');
      expect(bridge.calls.some(c => c.method === 'POST')).toBe(false);
      await type(document.querySelector('input[aria-label="岗位名称"]') as HTMLInputElement, '跟单员');
      const reference = document.querySelector('select[aria-label="参照岗位"]') as HTMLSelectElement;
      const options = [...reference.querySelectorAll('option')].map(o => o.textContent);
      expect(options).not.toContain('老板');
      expect(options).toContain('常见岗位 · 单证报关');
      await type(reference, 'template:documents');
      expect(document.body.textContent).toContain('创建岗位（4 项权限）');
      expect(document.body.textContent).toContain('办理需任职部门含「后勤单证」');
      await type(reference, 'role-sales');
      await act(async () => seg('报表与毛利', '查看').click());
      await click('创建岗位（2 项权限）');
      expect(bridge.calls.find(c => c.method === 'POST')?.body).toEqual({ name: '跟单员', description: '', permissions: ['orders:read', 'reports:read'] });
      expect(document.body.textContent).toContain('自定义');

      await click('编辑');
      await type(document.querySelector('input[aria-label="岗位名称"]') as HTMLInputElement, '资深跟单');
      await click('保存');
      expect(bridge.calls.find(c => c.method === 'PATCH')?.body).toEqual({ name: '资深跟单', description: '' });
      expect(document.body.textContent).toContain('资深跟单');

      await click('删除');
      expect(document.body.textContent).toContain('删除岗位「资深跟单」？');
      await click('删除岗位');
      expect(bridge.calls.some(c => c.method === 'DELETE' && c.url === '/api/admin/roles/role-custom-1')).toBe(true);
      expect(document.body.textContent).not.toContain('资深跟单');
    } finally { const i = roles.findIndex(r => r.id === 'role-custom-1'); if (i >= 0) roles.splice(i, 1); }
  });
  it('blocks deleting a custom role that accounts still hold and offers no rename or delete for system roles', async () => {
    roles.push({ id: 'role-custom-2', name: '单证员', description: null, isSystem: false, permissions: ['order:read'] });
    bridge.routes['GET /api/admin/users'] = () => ({ ok: true, departments, users: [{ id: 'u9', displayName: '陈晓', email: 'c@x.test', status: 'active', roles: ['单证员'], roleIds: ['role-custom-2'], departmentId: null, department: null, lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z' }] });
    try {
      await render(CompanyAdminPage, 'admin-panel', 'roles');
      expect([...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === '删除')).toHaveLength(1);
      await click('删除');
      expect(document.body.textContent).toContain('还有 1 人在此岗位');
      expect(document.body.textContent).toContain('陈晓（已启用）');
      expect(button('删除岗位')!.disabled).toBe(true);
    } finally { roles.splice(roles.findIndex(r => r.id === 'role-custom-2'), 1); }
  });
  it('keeps role permissions read-only for administrators who are not the owner', async () => {
    bridge.roles = ['admin'];
    await render(CompanyAdminPage, 'admin-panel', 'roles');
    expect(document.body.textContent).toContain('只读');
    expect(button('调整权限')).toBeUndefined();
    bridge.routes['GET /api/admin/permissions'] = () => ({ ok: true, permissions: [{ scope: 'reports:read', description: null }] });
    const controls = [...document.querySelectorAll('button')].filter(b => b.textContent === '查看权限');
    await act(async () => controls[1].click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.querySelector('[role="group"][aria-label="订单权限"]')).toBeNull();
    expect(document.body.textContent).toContain('不可用');
    expect([...document.querySelectorAll('button')].some(b => b.textContent?.startsWith('保存（'))).toBe(false);
  });
  it('shows no people or 岗位 sections to accounts without account or HR rights', async () => {
    bridge.roles = []; bridge.perms = [];
    await render(CompanyAdminPage, 'admin-panel', 'accounts');
    const steps = [...document.querySelectorAll('.mist-vsteps button')].map(b => b.textContent);
    expect(steps).not.toContain('人员'); expect(steps).not.toContain('岗位与权限');
    expect(bridge.calls.some(c => c.url.startsWith('/api/admin/users'))).toBe(false);
  });
});

describe('人事管理', () => {
  // 只有人事权限时，“人员”分区显示人事名册；有账号管理权限时显示账号列表（见“管理后台 · 账号”）。
  beforeEach(() => { bridge.roles = []; bridge.perms = ['hr:read', 'hr:write']; });
  it('shows departments with business attributes and creates a department under the company root', async () => {
    await render(HrOrganizationPage, 'hr');
    expect(document.body.textContent).toContain('面料业务部');
    expect(document.body.textContent).toContain('面料业务');
    await click('新建部门');
    await type(labelled('部门名称'), '成衣业务部');
    const garment = [...document.querySelectorAll('label.mist-check')].find(l => l.textContent?.trim() === '成衣业务')!.querySelector('input')!;
    await act(async () => garment.click());
    await click('保存');
    expect(bridge.calls.find(c => c.method === 'POST' && c.url === '/api/hr/departments')?.body).toEqual({ name: '成衣业务部', parentId: 'root', businessAttributes: ['garment_business'] });
  });
  it('lists people with their team and offers to create a missing employee profile', async () => {
    await render(HrOrganizationPage, 'hr', 'people');
    expect(document.body.textContent).toContain('李四');
    expect(document.body.textContent).toContain('面料一组');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.body.textContent).toContain('尚未建立员工档案');
    await click('建立员工档案');
    await click('保存');
    expect(document.body.textContent).toContain('建档须填写入职日期');
  });
  it('saves a company employee profile in one request with its onboarding information', async () => {
    bridge.companyId = 'company-a';
    bridge.routes['PUT /api/hr/employees/u3'] = () => ({ ok: true, profile: { userId: 'u3', employeeNo: 'E1', employmentStatus: 'Probation' } });
    await render(HrOrganizationPage, 'hr', 'people');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await click('建立员工档案');
    await type(labelled('入职日期'), '2026-10-26');
    await click('保存');
    expect(bridge.calls.filter(c => c.method === 'PUT' && c.url === '/api/hr/employees/u3')).toHaveLength(1);
    expect(bridge.calls.some(c => c.method === 'POST' && c.url === '/api/hr/employment-events')).toBe(false);
  });
  it('saves company identity and role assignment in one request', async () => {
    bridge.companyId = 'company-a'; bridge.roles = ['owner']; bridge.perms = ['*'];
    bridge.routes['GET /api/admin/users'] = () => ({ ok: true, departments, users: [{ id: 'u1', displayName: '张三', email: 'z@x.test', status: 'active', roleIds: ['role-sales'], roles: ['业务员'], departmentId: 'd1', department: '面料业务部', createdAt: '', lastLoginAt: null }] });
    bridge.routes['PATCH /api/admin/users/u1/roles'] = () => ({ ok: true });
    await render(CompanyAdminPage, 'admin-panel');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await click('修改资料与岗位');
    await type(labelled('姓名'), '新姓名');
    await click('保存');
    const writes = bridge.calls.filter(c => c.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ url: '/api/admin/users/u1/roles', body: { displayName: '新姓名', email: 'z@x.test', departmentId: 'd1', roles: ['role-sales'] } });
  });
  it('shows each person\'s 岗位 in the people list without a separate 岗位 tab', async () => {
    await render(HrOrganizationPage, 'hr', 'positions');
    expect(document.querySelector('[aria-label="全部人员"], [role="table"]')).toBeTruthy();
    expect(document.body.textContent).toContain('业务员');
    expect([...document.querySelectorAll('[role="tab"]')].map(t => t.textContent)).not.toContainEqual(expect.stringMatching(/^岗位/));
    expect(bridge.calls.some(c => c.url.includes('/positions'))).toBe(false);
  });
  it('records a resignation only after the account-disable acknowledgement', async () => {
    const profile = { userId: 'u3', employeeNo: 'E001', displayName: '李四', positionId: null, position: null, hireDate: '2025-01-01', regularDate: '2025-04-01', contractType: null, contractEnd: null, employmentStatus: 'Regular', phone: null, emergencyContact: null, workLocation: null, notes: null };
    bridge.routes['GET /api/hr/employees/u3'] = () => ({ ok: true, profile });
    bridge.routes['GET /api/hr/employees'] = () => ({ ok: true, employees: [profile] });
    bridge.routes['GET /api/hr/employment-events?userId=u3&limit=50'] = () => ({ ok: true, events: [{ id: 'e1', userId: 'u3', type: 'Regularize', effectiveDate: '2025-04-01', fromDeptId: null, toDeptId: null, fromPositionId: null, toPositionId: null, reason: null, operatorId: 'u3', createdAt: '' }] });
    bridge.routes['POST /api/hr/employment-events'] = () => ({ ok: true, event: { id: 'e2' }, accountDisabled: true });
    await render(HrOrganizationPage, 'hr', 'people');
    expect(document.body.textContent).toContain('正式');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.body.textContent).toContain('在职变动记录');
    expect(document.body.textContent).toContain('转正');
    await click('办理在职变动');
    const types = [...(labelled('变动类型') as HTMLSelectElement).options].map(o => o.textContent);
    expect(types).toEqual(['调岗', '晋升', '停职', '离职', '解除劳动关系']);
    await type(labelled('变动类型'), 'Resign');
    await click('确认离职');
    expect(document.body.textContent).toContain('请先勾选确认');
    expect(bridge.calls.some(c => c.method === 'POST' && c.url === '/api/hr/employment-events')).toBe(false);
    const ack = [...document.querySelectorAll('label.mist-check')].find(l => l.textContent?.includes('立即停用'))!.querySelector('input')!;
    await act(async () => ack.click());
    await click('确认离职');
    expect(bridge.calls.find(c => c.method === 'POST' && c.url === '/api/hr/employment-events')?.body).toMatchObject({ userId: 'u3', type: 'Resign', fromDeptId: 'd1', fromPositionId: null });
  });
  it('transfers a person to a new 岗位 and department in one change, and needs account rights to change the 岗位', async () => {
    const profile = { userId: 'u3', employeeNo: 'E001', displayName: '李四', positionId: 'role-sales', position: '业务员', hireDate: '2025-01-01', regularDate: '2025-04-01', contractType: null, contractEnd: null, employmentStatus: 'Regular', phone: null, emergencyContact: null, workLocation: null, notes: null };
    const depts = [...departments, { id: 'd2', name: '成衣业务部', parentId: 'root', businessAttributes: [] }];
    bridge.perms = ['hr:read', 'hr:write', 'users:admin'];
    bridge.routes['GET /api/hr/personnel'] = () => ({ ok: true, departments: depts, jobs: [{ id: 'role-sales', name: '业务员' }, { id: 'role-docs', name: '单证报关' }], positionNames: {}, personnel: [{ id: 'u3', displayName: '李四', email: 'l@x.test', status: 'active', roles: ['业务员'], roleIds: ['role-sales'], departmentId: 'd1', department: '面料业务部', lastLoginAt: null }] });
    bridge.routes['GET /api/hr/employees/u3'] = () => ({ ok: true, profile });
    bridge.routes['GET /api/hr/employees'] = () => ({ ok: true, employees: [profile] });
    bridge.routes['GET /api/hr/employment-events?userId=u3&limit=50'] = () => ({ ok: true, events: [] });
    bridge.routes['POST /api/hr/employment-events'] = () => ({ ok: true, event: { id: 'e2' }, leftTeams: 1, jobChanged: true });
    await render(HrOrganizationPage, 'hr', 'people');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.body.textContent).toContain('员工档案');
    await click('办理在职变动');
    expect((labelled('岗位') as HTMLSelectElement).disabled).toBe(false);
    expect((labelled('岗位') as HTMLSelectElement).value).toBe('role-sales');
    await type(labelled('岗位'), 'role-docs');
    expect(document.body.textContent).not.toContain('部门将从');
    await type(labelled('任职部门'), 'd2');
    expect(document.body.textContent).toContain('部门将从 面料业务部 调为 成衣业务部');
    const submit = [...document.querySelectorAll('.mist-dialog button, [role="dialog"] button')].find(b => /^确认/.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
    await act(async () => submit.click());
    expect(bridge.calls.find(c => c.method === 'POST' && c.url === '/api/hr/employment-events')?.body).toMatchObject({ userId: 'u3', type: 'Transfer', fromDeptId: 'd1', fromPositionId: 'role-sales', toRoleId: 'role-docs', toDeptId: 'd2' });

    bridge.roles = []; bridge.perms = ['hr:read', 'hr:write'];
    await render(HrOrganizationPage, 'hr', 'people');
    await act(async () => (document.querySelector('[role="row"][tabindex]') as HTMLElement).click());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await click('办理在职变动');
    expect((labelled('岗位') as HTMLSelectElement).disabled).toBe(true);
  });
  it('explains that local workspaces have no company organization and calls nothing', async () => {
    bridge.localMode = true;
    await render(HrOrganizationPage, 'hr');
    expect(document.body.textContent).toContain('本机演示模式没有组织架构');
    expect(bridge.calls).toHaveLength(0);
  });
  it('is read-only without hr:write', async () => {
    bridge.perms = ['hr:read'];
    await render(HrOrganizationPage, 'hr');
    expect(button('新建部门')).toBeUndefined();
  });
});

describe('管理后台 · 审批资格', () => {
  const users = [{ id: 'mgr', displayName: '销售主管', email: 'm@x.test' }, { id: 'gm', displayName: '成衣主管', email: 'g@x.test' }];
  const supplierRoutes = (version: number, userIds: string[]) => { for (const kind of ['purchase', 'processing']) for (const family of ['fabric', 'garment']) bridge.routes[`GET /api/v1/procurement/contracts/approval-authority/${kind}/${family}`] = () => ({ ok: true, item: { key: `k.${kind}.${family}`, version, userIds } }); };
  const pick = async (group: string, name: string) => { const box = [...document.querySelector(`[aria-label="${group}"]`)!.querySelectorAll('label.mist-check')].find(l => l.textContent?.includes(name))!.querySelector('input')!; await act(async () => box.click()); };
  const edit = async (label: string) => { const b = document.querySelector(`button[aria-label="调整${label}审批人"]`) as HTMLButtonElement; expect(b, label).toBeTruthy(); await act(async () => b.click()); };
  it('flags every missing authority and saves the chosen fabric order approvers', async () => {
    bridge.routes['GET /api/admin/order-approval-authorities'] = () => ({ ok: true, assignments: [], users });
    bridge.routes['PUT /api/admin/order-approval-authorities/fabric'] = () => ({ ok: true, assignments: [] });
    supplierRoutes(0, []);
    await render(CompanyAdminPage, 'admin-panel', 'approvals');
    expect(document.body.textContent).toContain('尚有 6 项审批资格未配置');
    await edit('面料订单');
    await pick('面料订单审批人', '销售主管');
    await click('保存');
    expect(bridge.calls.find(c => c.method === 'PUT' && c.url === '/api/admin/order-approval-authorities/fabric')?.body).toEqual({ userIds: ['mgr'] });
  });
  it('requires a reason and sends the read config version for supplier commitment approvers', async () => {
    bridge.routes['GET /api/admin/order-approval-authorities'] = () => ({ ok: true, assignments: [{ businessLine: 'fabric', userId: 'mgr' }, { businessLine: 'garment', userId: 'gm' }], users });
    bridge.routes['PUT /api/v1/procurement/contracts/approval-authority/purchase/fabric'] = () => ({ ok: true });
    supplierRoutes(3, []);
    await render(CompanyAdminPage, 'admin-panel', 'approvals');
    expect(document.body.textContent).toContain('尚有 4 项审批资格未配置');
    expect(document.body.textContent).toContain('销售主管');
    await edit('面料采购合同');
    await pick('面料采购合同审批人', '销售主管');
    await click('保存');
    expect(document.body.textContent).toContain('请填写配置理由');
    expect(bridge.calls.some(c => c.method === 'PUT')).toBe(false);
    const reason = document.querySelector('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '上线首日指定面料采购审批人'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('保存');
    const body = bridge.calls.find(c => c.method === 'PUT')?.body;
    expect(body).toMatchObject({ userIds: ['mgr'], expectedConfigVersion: 3, reason: '上线首日指定面料采购审批人' });
    expect(body.requestKey).toMatch(/^supplier-authority:/);
  });
  it('keeps supplier approvers read-only for an account manager without owner/admin dictionary rights', async () => {
    bridge.roles = ['manager']; bridge.perms = ['users:admin'];
    bridge.routes['GET /api/admin/order-approval-authorities'] = () => ({ ok: true, assignments: [], users });
    supplierRoutes(1, ['mgr']);
    await render(CompanyAdminPage, 'admin-panel', 'approvals');
    expect(document.body.textContent).toContain('供应商承诺审批人仅老板或管理员可修改');
    expect((document.querySelector('button[aria-label="调整面料采购合同审批人"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('button[aria-label="调整面料订单审批人"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
