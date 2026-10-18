/**
 * 定价参数版本与生效日（2026-10-18 按外贸成本加成定价的通行做法确定首版）。
 * - 管理层（pricing:admin）按板块（成衣 / 面料）设置标准成本加成率与标准佣金率，每次新增一个版本，带生效日与调整原因，不改写旧版本。
 * - 生效日不早于今天：参数不追溯已保存的定价记录。某日适用的版本 = 生效日 ≤ 当日中最晚生效者，同日取版本号最大者。
 * - 定价试算保存时按订单类型与保存当天冻结适用版本；加成率低于标准须填写偏离理由并留在记录中；佣金率按客户 / 代理约定可不同，只标注差异。
 * 汇率、退税率、采购成本属于单笔事实（随汇率登记、税则与工厂报价变化），不放进标准参数版本。
 */
export type PricingParamFamily = 'garment' | 'fabric';
export const PRICING_PARAM_FAMILY_LABEL: Record<PricingParamFamily, string> = { garment: '成衣', fabric: '面料' };
export type PricingParamVersion = { id: string; family: PricingParamFamily; version: number; profitMargin: number; commissionRate: number; effectiveFrom: string; reason: string; createdAt: string; createdBy: string; createdById: string };
export type FrozenPricingParams = Pick<PricingParamVersion, 'id' | 'family' | 'version' | 'profitMargin' | 'commissionRate' | 'effectiveFrom'>;
export const PRICING_PARAM_MAX = { profitMargin: 200, commissionRate: 30 } as const;

/** 百分比：非负、最多两位小数、不超过上限；返回数值或 null。 */
export function normalizePricingPercent(value: unknown, max: number): number | null {
  const t = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}
export function applicablePricingParams(rows: readonly PricingParamVersion[] | undefined, family: PricingParamFamily, day: string): PricingParamVersion | undefined {
  let best: PricingParamVersion | undefined;
  for (const r of rows || []) if (r.family === family && r.effectiveFrom <= day && (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.version > best.version))) best = r;
  return best;
}
/** 尚未生效的最早一个版本（用于提示“待生效”）。 */
export function upcomingPricingParams(rows: readonly PricingParamVersion[] | undefined, family: PricingParamFamily, day: string): PricingParamVersion | undefined {
  return (rows || []).filter(r => r.family === family && r.effectiveFrom > day).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.version - b.version)[0];
}
export function freezePricingParams(r: PricingParamVersion): FrozenPricingParams { return { id: r.id, family: r.family, version: r.version, profitMargin: r.profitMargin, commissionRate: r.commissionRate, effectiveFrom: r.effectiveFrom }; }
export function pricingParamsText(r: FrozenPricingParams) { return `${PRICING_PARAM_FAMILY_LABEL[r.family]}标准参数 V${r.version}：成本加成 ${r.profitMargin}%、佣金 ${r.commissionRate}%（${r.effectiveFrom} 起生效）`; }
/** 万分之一精度比较，避免浮点误差。 */
const bp = (n: number) => Math.round(n * 10000);
export function markupBelowStandard(profitMargin: number, params: FrozenPricingParams | undefined) { return !!params && bp(profitMargin) < bp(params.profitMargin); }
export function commissionDiffers(commissionRate: number, params: FrozenPricingParams | undefined) { return !!params && bp(commissionRate) !== bp(params.commissionRate); }
