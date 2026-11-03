/**
 * Fabric staged outsourcing (P1-1): greige bought from a weaving mill is processed by a dyeing mill.
 * - A greige contract bought by weight records its kilograms per metre, so the dyer's input can be compared in length.
 * - A fabric processing contract may record the agreed processing loss (染整损耗). Dyers are paid on output metres.
 * Input = greige the order owner counted as accepted at the dyer; output = processed fabric returned on the contract.
 * Actual loss = (input − output) ÷ input. These are read facts only: no stock, cost or payable is created here.
 */
import { MistCommandError, type MistState } from './mistWorkspace';
import type { FulfillmentPurchase } from './mistFulfillment';
import { deliveryContractId, isFabricStageMaterial, isFabricStageSource, materialDeliveryRows } from './mistInternalFabric';

/** intermediate: this processing step (e.g. weaving or dyeing before finishing) hands its output to the next processing contract. */
/** deliverTo: the processing supplier (dyer, finisher) that receives this greige or intermediate output (sup1). */
export type FabricStageTerms = { kgPerMetre?: number; lossPercent?: number; intermediate?: boolean; deliverToSupplierId?: string; deliverToSupplier?: string };
type StagePurchase = Pick<FulfillmentPurchase, 'domain' | 'kind' | 'materialKind' | 'unit'>;

const fail = (message: string): never => { throw new MistCommandError('VALIDATION', message, 422); };
const METRE = /^(米|m|metre|metres|meter|meters)$/i, YARD = /^(码|yd|yds|yard|yards)$/i, KILO = /^(公斤|千克|kg|kgs)$/i;
const unitKind = (unit: string): 'metre' | 'yard' | 'kilo' | null => { const u = unit.trim(); return METRE.test(u) ? 'metre' : YARD.test(u) ? 'yard' : KILO.test(u) ? 'kilo' : null; };
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;
const decimal = (value: unknown, label: string, min: number, max: number, places: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) > 1e-6) fail(`${label}须在 ${min}–${max} 之间，最多 ${places} 位小数`);
  return value as number;
};
export const isFabricProcessing = (p: Pick<FulfillmentPurchase, 'domain' | 'kind'> | undefined) => p?.domain === 'fabric' && p.kind === 'processing';
export const fabricStageWeighed = (p: StagePurchase) => isFabricStageMaterial(p) && unitKind(p.unit) === 'kilo';

/** Only the terms that belong to this kind of contract are kept; anything else is a client error, not silently dropped. */
export function normalizeFabricStageTerms(p: StagePurchase, input: unknown, suppliers?: Array<{ id: string; name: string }>): FabricStageTerms | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['kgPerMetre', 'lossPercent', 'intermediate', 'deliverToSupplierId'].includes(key))) fail('工序约定格式无效');
  const value = input as Record<string, unknown>, terms: FabricStageTerms = {};
  if (value.kgPerMetre !== undefined) {
    if (!fabricStageWeighed(p)) fail('仅按公斤采购的坯布填写每米重量');
    terms.kgPerMetre = decimal(value.kgPerMetre, '每米坯布重量', 0.01, 10, 4);
  }
  if (value.lossPercent !== undefined) {
    if (!isFabricProcessing(p)) fail('仅面料加工单填写约定加工损耗');
    terms.lossPercent = decimal(value.lossPercent, '约定加工损耗', 0, 50, 2);
  }
  if (value.intermediate !== undefined) {
    if (typeof value.intermediate !== 'boolean') fail('前道加工标记格式无效');
    if (value.intermediate) { if (!isFabricProcessing(p)) fail('仅面料加工单可作为前道加工'); terms.intermediate = true; }
  }
  if (value.deliverToSupplierId !== undefined && value.deliverToSupplierId !== '') {
    if (!isFabricStageMaterial(p) && !terms.intermediate) fail('仅坯布采购或前道加工单指定收货加工厂');
    if (typeof value.deliverToSupplierId !== 'string') fail('收货加工厂无效');
    const supplier = suppliers?.find(s => s.id === value.deliverToSupplierId);
    if (!supplier) fail('收货加工厂不在供应商档案');
    terms.deliverToSupplierId = supplier!.id; terms.deliverToSupplier = supplier!.name;
  }
  return Object.keys(terms).length ? terms : undefined;
}
/** One line for reviews and contract documents, e.g. "每米重量 0.72 公斤" or "约定加工损耗 5%". */
export function fabricStageTermsText(p: { stageTerms?: FabricStageTerms }): string {
  const t = p.stageTerms; if (!t) return '';
  return [t.intermediate && '前道加工，成品交下一道加工厂', t.kgPerMetre !== undefined && `每米重量 ${t.kgPerMetre} 公斤`, t.lossPercent !== undefined && `约定加工损耗 ${t.lossPercent}%（按出缸米数计费）`, t.deliverToSupplier && `交 ${t.deliverToSupplier} 收货加工`].filter(Boolean).join('；');
}
/** Submission gate: a weighed greige contract cannot be compared with dyed metres without its weight per metre. */
export function fabricStageSubmitProblem(p: FulfillmentPurchase): string {
  return fabricStageWeighed(p) && !p.stageTerms?.kgPerMetre ? '按公斤采购的坯布须填写每米重量（公斤/米）' : '';
}

/** Converts a quantity into the target length unit; weight needs the source contract's kilograms per metre. */
export function fabricLength(quantity: number, from: StagePurchase & { stageTerms?: FabricStageTerms }, toUnit: string): number | null {
  const source = unitKind(from.unit), target = unitKind(toUnit);
  if (!source || (target !== 'metre' && target !== 'yard')) return null;
  const metres = source === 'metre' ? quantity : source === 'yard' ? quantity * 0.9144 : from.stageTerms?.kgPerMetre ? quantity / from.stageTerms.kgPerMetre : null;
  if (metres === null) return null;
  return round(target === 'metre' ? metres : metres / 0.9144);
}

export type FabricStageInput = { purchaseId: string; code: string; supplier: string; accepted: number; unit: string; converted: number | null };
export type FabricStageBalance = {
  unit: string; inputs: FabricStageInput[]; input: number | null; output: number;
  lossPercent: number | null; agreedLossPercent?: number; overAllowance: boolean; outputExceedsInput: boolean;
  /** Greige needed for the contract quantity at the agreed loss, in the contract unit. */
  plannedInput: number | null;
  /**
   * P1-1 损耗成本：实际损耗的来料货值（投入 − 产出，按来料单价），以及超出约定损耗部分的扣款建议金额。
   * 只在来料都折算得出、币种与加工单一致时计算；否则为 null（跨币种不折算）。
   */
  lossCost: { currency: string; amount: number; overAmount: number; overQuantity: number } | null;
};
/** Null when the purchase is not a fabric processing contract. */
export function fabricStageBalance(root: MistState, processingId: string): FabricStageBalance | null {
  const contract = root.fulfillment?.purchases.find(p => p.id === processingId);
  if (!contract || !isFabricProcessing(contract)) return null;
  const totals = new Map<string, number>();
  for (const row of materialDeliveryRows(root)) {
    if (deliveryContractId(root, row.delivery) !== contract.id) continue;
    const source = root.fulfillment.purchases.find(p => p.id === row.purchaseId);
    if (!isFabricStageSource(source)) continue;
    totals.set(source!.id, round((totals.get(source!.id) || 0) + Number(row.accepted)));
  }
  const inputs: FabricStageInput[] = [...totals].map(([id, accepted]) => {
    const source = root.fulfillment.purchases.find(p => p.id === id)!;
    return { purchaseId: id, code: source.code, supplier: source.supplier, accepted, unit: source.unit, converted: fabricLength(accepted, source, contract.unit) };
  });
  const input = inputs.some(row => row.converted === null) ? null : round(inputs.reduce((sum, row) => sum + row.converted!, 0));
  const output = round(contract.received), agreed = contract.stageTerms?.lossPercent;
  // Output above input is a counting or recording error, never a negative loss.
  const lossPercent = input && input > 0 && output > 0 && output <= input ? round((input - output) / input * 100, 2) : null;
  const plannedInput = agreed !== undefined && agreed < 100 && unitKind(contract.unit) ? round(contract.quantity / (1 - agreed / 100), 2) : null;
  // 来料按投入占比的加权单价（每加工单位）；来料币种须与加工单一致才计算金额。
  let lossCost: FabricStageBalance['lossCost'] = null;
  const sources = inputs.map(row => ({ row, po: root.fulfillment.purchases.find(p => p.id === row.purchaseId)! }));
  if (input && input > 0 && lossPercent !== null && sources.length && sources.every(x => x.row.converted && x.po.currency === contract.currency)) {
    const value = sources.reduce((n, x) => n + x.row.accepted * x.po.price, 0), perUnit = value / input;
    const lostQty = round(input - output), overQty = agreed !== undefined && lossPercent > agreed ? round(input * (lossPercent - agreed) / 100, 2) : 0;
    lossCost = { currency: contract.currency, amount: Math.round(lostQty * perUnit * 100) / 100, overAmount: Math.round(overQty * perUnit * 100) / 100, overQuantity: overQty };
  }
  return { unit: contract.unit, inputs, input, output, lossPercent, ...(agreed !== undefined ? { agreedLossPercent: agreed } : {}),
    overAllowance: lossPercent !== null && agreed !== undefined && lossPercent > agreed, outputExceedsInput: input !== null && output > input, plannedInput, lossCost };
}

/**
 * Both directions of the greige → processing link (sup2): for a greige or intermediate contract, the processing contracts it
 * feeds (named receiver, or actually delivered to); for a processing contract, the greige / intermediate contracts feeding it.
 */
export function fabricStageLinks(root: MistState, purchaseId: string): { feeds: FulfillmentPurchase[]; fedBy: FulfillmentPurchase[] } {
  const all = root.fulfillment?.purchases || [], p = all.find(x => x.id === purchaseId);
  if (!p) return { feeds: [], fedBy: [] };
  const delivered = (from: string, to: string) => materialDeliveryRows(root).some(r => r.purchaseId === from && deliveryContractId(root, r.delivery) === to);
  const sameLine = (x: FulfillmentPurchase) => x.orderId === p.orderId && x.lineId === p.lineId && x.state !== 'cancelled' && x.id !== p.id;
  const feeds = isFabricStageSource(p) ? all.filter(x => sameLine(x) && isFabricProcessing(x) && (delivered(p.id, x.id) || !!p.stageTerms?.deliverToSupplierId && x.supplierId === p.stageTerms.deliverToSupplierId)) : [];
  const fedBy = isFabricProcessing(p) ? all.filter(x => sameLine(x) && isFabricStageSource(x) && (delivered(x.id, p.id) || x.stageTerms?.deliverToSupplierId === p.supplierId)) : [];
  return { feeds, fedBy };
}
