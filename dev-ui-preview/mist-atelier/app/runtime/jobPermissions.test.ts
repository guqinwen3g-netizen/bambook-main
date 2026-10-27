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
