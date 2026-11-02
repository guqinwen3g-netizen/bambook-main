import { expect, it } from 'vitest';
import { PERMISSION_SCOPES } from '../../../../lib/rolePermissionMatrix';
import { departmentAuthorization } from '../../../../server/src/auth/departmentAuthorization';
import { DEPARTMENT_GATES, JOB_MODULES, JOB_TEMPLATES, moduleLevel, setModuleLevel } from './jobPermissions';

const grouped = JOB_MODULES.flatMap(module => [...module.read, ...module.write, ...module.approve, ...module.extra]);

it('places every permission code in exactly one module', () => {
  expect([...grouped].sort()).toEqual(Object.keys(PERMISSION_SCOPES).sort());
  expect(new Set(grouped).size).toBe(grouped.length);
});

it('builds templates only from real permission codes', () => {
  for (const template of JOB_TEMPLATES) {
    expect(template.permissions.length).toBeGreaterThan(0);
    expect(template.permissions.filter(scope => !(scope in PERMISSION_SCOPES))).toEqual([]);
  }
});

it('reads and sets a module level without touching its specific permissions', () => {
  const orders = JOB_MODULES.find(module => module.key === 'orders')!;
  const granted = setModuleLevel(orders, ['orders:read', 'order:change_request:create', 'crm:read'], 'write');
  expect(moduleLevel(orders, granted)).toBe('write');
  expect(granted).toEqual(expect.arrayContaining(['order:change_request:create', 'crm:read', 'orders:delete']));
  expect(moduleLevel(orders, ['orders:read', 'orders:approve:cancel'])).toBe('partial');
  expect(setModuleLevel(orders, granted, 'none')).toEqual(['order:change_request:create', 'crm:read']);
});

it('describes the same department requirements the server enforces', () => {
  const user = (attributes: string[]) => ({ primaryDepartment: { status: 'active', parentId: 'root', metadata: { businessAttributes: attributes } } });
  for (const gate of DEPARTMENT_GATES) {
    for (const scope of gate.scopes) {
      expect(departmentAuthorization(user([]), ['role-x'], [scope]).permissions).toEqual([]);
      for (const attribute of gate.attributes) expect(departmentAuthorization(user([attribute]), ['role-x'], [scope]).permissions).toEqual([scope]);
    }
  }
});

import fs from 'node:fs';
import path from 'node:path';
import { APPROVAL_LABEL_ONLY_SCOPES, labelOnlyApprovals } from './jobPermissions';
it('marks approval codes that do not choose reviewers, matching the server registry of ui-label-only codes', () => {
  const registry = fs.readFileSync(path.resolve(__dirname, '../../../../server/src/auth/__tests__/danglingScopeConsumption.test.ts'), 'utf8');
  const serverLabels = [...registry.matchAll(/\{ scope: '([^']+)', reason: 'ui-label-only'/g)].map(m => m[1]).sort();
  expect([...APPROVAL_LABEL_ONLY_SCOPES].sort()).toEqual(serverLabels);
  expect(labelOnlyApprovals(JOB_MODULES.find(m => m.key === 'orders')!)).toEqual(['orders:approve:change_delivery', 'orders:approve:change_qty', 'orders:approve:change_price', 'orders:approve:cancel']);
  // 付款分档码已由服务端判定，不再标为“不控制审批人”。
  expect(labelOnlyApprovals(JOB_MODULES.find(m => m.key === 'finance')!)).toEqual(['invoices:approve:writeoff']);
});

it('lets business and finance templates confirm AI writes at their risk level', () => {
  const t = (id: string) => JOB_TEMPLATES.find(x => x.id === id)!.permissions;
  const ai = JOB_MODULES.find(m => m.key === 'ai')!;
  for (const id of ['merchandiser', 'documents', 'cashier', 'accountant']) {
    expect(t(id)).toEqual(expect.arrayContaining(['ai:chat', 'ai:write:low', 'ai:write:medium']));
    expect(moduleLevel(ai, t(id))).toBe('write');
  }
  for (const id of ['merchandiser', 'documents']) expect(t(id)).not.toContain('ai:write:high');
  // 高风险写入作专项附加，不连带 Agent 审批权
  for (const id of ['cashier', 'accountant']) { expect(t(id)).toContain('ai:write:high'); expect(t(id)).not.toContain('agent:approvals:approve'); }
  for (const id of ['hr-admin', 'viewer']) expect(t(id).filter(scope => scope.startsWith('ai:write'))).toEqual([]);
  // 出纳、会计持 vouchers:write，须同时持计税依据，否则有退税到账时看不到银行账户；其他模板不附加。
  for (const id of ['cashier', 'accountant']) expect(t(id)).toEqual(expect.arrayContaining(['vouchers:write', 'sensitive:tax_base']));
  for (const id of ['merchandiser', 'documents', 'hr-admin', 'viewer']) expect(t(id)).not.toContain('sensitive:tax_base');
  expect(ai.extra).toEqual(['ai:write:high']);
});
