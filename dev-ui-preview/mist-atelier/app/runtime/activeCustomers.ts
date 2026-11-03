import type { MistState } from '../../../../server/src/shared/mistWorkspace';
/**
 * mar18：客户停用即其关系档案归档。新建订单、开发、报价的客户下拉只列使用中的客户；
 * keep 为当前记录已选的客户，归档后仍保留显示，不改写历史。
 */
export function activeCustomers(state: MistState | null | undefined, keep?: string) {
  const archived = new Set((state?.market?.relations || []).filter(r => r.status === 'archived' && r.customerId).map(r => r.customerId));
  return (state?.customers || []).filter(c => !archived.has(c.id) || c.id === keep);
}
