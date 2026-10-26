import { PERMISSION_SCOPES } from '../../../../lib/rolePermissionMatrix';

// Presentation only: these labels do not define authorization or approval rules.
const LABELS: Record<string, string> = {
  'orders:write': '创建、编辑订单',
  'bom:write': '创建、编辑成本表',
  'bom:admin': '管理成本版本与计算模型',
  'audit:export': '导出审计记录',
  'risk:admin': '调整信用额度与合规豁免',
  'hr:write': '管理员工与组织',
  'vouchers:approve:pay_lt5': '审批5万元及以下付款',
  'vouchers:approve:pay_gt5': '审批5万元以上付款',
  'vouchers:approve:pay_new_supplier': '审批首次付款',
  'business:delete': '删除业务记录',
  'agent:approvals:approve': '审批 AI 操作',
  'orders:approve:change_delivery': '审批交期变更',
  'orders:approve:change_qty': '审批数量变更',
  'orders:approve:change_price': '审批价格变更',
  'orders:approve:cancel': '审批订单取消',
  'users:admin': '管理账号与权限',
  'users:write': '创建、编辑账号与分配角色',
  'settings:read': '查看公司设置',
  'settings:write': '修改公司设置',
};

export function permissionLabel(scope: string, description?: string | null): string {
  const label = LABELS[scope] ?? (PERMISSION_SCOPES as Record<string, string>)[scope] ?? description ?? scope;
  return label.replace(/\s*[（(](?:REQ[\w-]*|DR[\w-]*|S:[\w_]+)[^（）()]*[）)]/g, '').trim();
}
