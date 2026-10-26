import { describe, expect, it } from 'vitest';
import { permissionLabel } from './permissionLabels';
describe('permission labels', () => {
  it('leaves implementation references out of labels', () => {
    expect(permissionLabel('sample:color:write', '打色管理（REQ2-01 色差管理）')).not.toContain('REQ2-01');
    expect(permissionLabel('unknown', '样品管理（DR-015）')).toBe('样品管理');
    expect(permissionLabel('unknown', '查看成本（S:cost）')).toBe('查看成本');
  });
  it('does not present obsolete approval routing as a permission requirement', () => {
    expect(permissionLabel('orders:approve:change_price')).toBe('审批价格变更');
    expect(permissionLabel('orders:approve:change_qty')).toBe('审批数量变更');
  });
  it('keeps a custom permission description and meaningful thresholds', () => {
    expect(permissionLabel('custom:approval', '审批 ≤ 5 万元付款')).toBe('审批 ≤ 5 万元付款');
    expect(permissionLabel('custom:approval')).toBe('custom:approval');
  });
});
