import type { FulfillmentPurchase } from '../../../../../server/src/shared/mistFulfillment';

const KIND_LABEL = { material: '材料', finished: '成品', processing: '加工服务' };
const MATERIAL_LABEL = { fabric: '面料', trims: '辅料', packaging: '包装', other: '其他材料' };

export function purchaseContent(p: Pick<FulfillmentPurchase, 'kind' | 'materialKind'>) {
  return p.kind === 'material' && p.materialKind ? MATERIAL_LABEL[p.materialKind] : KIND_LABEL[p.kind];
}

export const purchaseChoices = (domain: FulfillmentPurchase['domain']) => [
  ...Object.entries(MATERIAL_LABEL).filter(([key]) => domain === 'fabric' || key === 'trims' || key === 'packaging').map(([key, label]) => ({ value: `material:${key}`, label })),
  ...(domain === 'fabric' ? [{ value: 'finished', label: '成品' }] : []),
  { value: 'processing', label: '加工服务' },
];

export function parsePurchaseContent(choice: string, domain: FulfillmentPurchase['domain']) {
  if (!purchaseChoices(domain).some(option => option.value === choice)) throw new Error('请选择采购内容');
  const [kind, materialKind] = choice.split(':') as [FulfillmentPurchase['kind'], FulfillmentPurchase['materialKind']];
  return { kind, ...(kind === 'material' ? { materialKind } : {}) };
}
