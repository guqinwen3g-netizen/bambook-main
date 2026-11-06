/**
 * routeScopeGate.test.ts — 旧订单导入迁移所需权限在默认角色矩阵中的分配
 *
 * 旧 v1 订单路由已下线，路由级 scope 门与列表行级范围用例随之移除；
 * 此处只保留 rolePermissionMatrix + requirePermission 的权限分配校验。
 */
import { describe, it, expect, vi } from 'vitest';
import { requirePermission } from '../../auth/permissionGuard';
import {
  SYSTEM_ROLE_IDS,
  getDefaultScopeListForRole,
} from '../../_shared/rolePermissionMatrix';

function evaluatePermission(scopes: string[], scope: 'data:import' | 'users:admin') {
  let status = 200;
  let body: any = null;
  const req = { actor: { userId: 'permission-test', permissions: scopes }, authSource: 'user-session' } as any;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  } as any;
  const next = vi.fn();
  requirePermission(scope)(req, res, next);
  return { status, body, allowed: next.mock.calls.length === 1 };
}

describe('legacy order import migration privilege scopes', () => {
  it('SALES has data:import for ordinary migration features but does not have users:admin', () => {
    const scopes = getDefaultScopeListForRole(SYSTEM_ROLE_IDS.SALES);
    expect(evaluatePermission(scopes, 'data:import').allowed).toBe(true);
    expect(evaluatePermission(scopes, 'users:admin')).toMatchObject({ status: 403, allowed: false });
  });

  it('ADMIN has both scopes required by the compatibility migration endpoint', () => {
    const scopes = getDefaultScopeListForRole(SYSTEM_ROLE_IDS.ADMIN);
    expect(evaluatePermission(scopes, 'data:import').allowed).toBe(true);
    expect(evaluatePermission(scopes, 'users:admin').allowed).toBe(true);
  });
});
