import { describe, expect, it } from 'vitest';
import {
  SYSTEM_ROLE_IDS,
  systemRoleCode,
  hasPermission,
  getDataScopeRule,
} from '../../_shared/rolePermissionMatrix';
import { buildAuthTokenPayload } from '../tokenHelpers';

describe('多租户 · 公司角色码', () => {
  it('剥离公司后缀；自定义角色没有后缀时原样返回', () => {
    expect(systemRoleCode(`${SYSTEM_ROLE_IDS.SALES}@company-a`)).toBe(SYSTEM_ROLE_IDS.SALES);
    expect(systemRoleCode(`${SYSTEM_ROLE_IDS.SUPER_ADMIN}@company-b`)).toBe(SYSTEM_ROLE_IDS.SUPER_ADMIN);
    expect(systemRoleCode('role-custom-abc123')).toBe('role-custom-abc123');
    expect(systemRoleCode(null)).toBe('');
  });

  it('按角色码查权限矩阵，公司后缀不影响判定', () => {
    expect(hasPermission(`${SYSTEM_ROLE_IDS.SUPER_ADMIN}@c1`, 'orders:write')).toBe(true);
    expect(hasPermission(`${SYSTEM_ROLE_IDS.SALES}@c1`, 'orders:read')).toBe(true);
    expect(hasPermission(`${SYSTEM_ROLE_IDS.SALES}@c1`, 'users:admin')).toBe(false);
  });

  it('按角色码解析数据范围', () => {
    expect(getDataScopeRule(`${SYSTEM_ROLE_IDS.SUPER_ADMIN}@c1`)).toEqual({ kind: 'all' });
    expect(getDataScopeRule(`${SYSTEM_ROLE_IDS.SALES}@c1`).kind).not.toBe('all');
  });
});

describe('多租户 · 令牌只带本公司角色', () => {
  const user = {
    id: 'u1',
    displayName: '甲',
    status: 'active',
    deletedAt: null,
    roles: [
      {
        roleId: 'role-sales@c1',
        departmentId: 'd1',
        role: {
          id: 'role-sales@c1', companyId: 'c1', code: 'role-sales',
          permissions: [{ permission: { scope: 'orders:read' } }],
        },
      },
      {
        roleId: 'role-super-admin@c2',
        departmentId: 'd2',
        role: {
          id: 'role-super-admin@c2', companyId: 'c2', code: 'role-super-admin',
          permissions: [{ permission: { scope: 'orders:delete' } }],
        },
      },
    ],
  };

  it('会话属于 c1 时，只带 c1 的角色与权限，拿不到 c2 的老板权限', () => {
    const payload = buildAuthTokenPayload(user, 'c1');
    expect(payload.companyId).toBe('c1');
    expect(payload.roleIds).toEqual(['role-sales@c1']);
    expect(payload.permissions).toEqual(['orders:read']);
    expect(payload.roles).toContain('sales');
    expect(payload.roles).not.toContain('owner');
  });

  it('会话属于 c2 时反过来只带 c2 的老板权限', () => {
    const payload = buildAuthTokenPayload(user, 'c2');
    expect(payload.roleIds).toEqual(['role-super-admin@c2']);
    expect(payload.roles).toContain('owner');
  });

  it('没有公司上下文时保持历史行为（不按公司过滤）', () => {
    const payload = buildAuthTokenPayload(user);
    expect(payload.companyId).toBeUndefined();
    expect(payload.roleIds).toHaveLength(2);
  });

  it('公司维度下没有角色时不回落成全量权限', () => {
    const payload = buildAuthTokenPayload(user, 'c3');
    expect(payload.roleIds).toEqual([]);
    expect(payload.permissions).toEqual([]);
    expect(payload.roles).toEqual([]);
  });
});
