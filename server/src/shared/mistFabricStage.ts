/**
 * Fabric staged outsourcing (P1-1): greige bought from a weaving mill is processed by a dyeing mill.
 * - A greige contract bought by weight records its kilograms per metre, so the dyer's input can be compared in length.
 * - A fabric processing contract may record the agreed processing loss (染整损耗). Dyers are paid on output metres.
 * Input = greige the order owner counted as accepted at the dyer; output = processed fabric returned on the contract.
 * Actual loss = (input − output) ÷ input. These are read facts only: no stock, cost or payable is created here.
 */
import { MistCommandError, type MistState } from './mistWorkspace';
import type { FulfillmentPurchase } from './mistFulfillment';
import { isFabricStageMaterial, materialDeliveryRows } from './mistInternalFabric';

export type FabricStageTerms = { kgPerMetre?: number; lossPercent?: number };
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
export function normalizeFabricStageTerms(p: StagePurchase, input: unknown): FabricStageTerms | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'kgPerMetre' && key !== 'lossPercent')) fail('工序约定格式无效');
  const value = input as Record<string, unknown>, terms: FabricStageTerms = {};
  if (value.kgPerMetre !== undefined) {
    if (!fabricStageWeighed(p)) fail('仅按公斤采购的坯布填写每米重量');
    terms.kgPerMetre = decimal(value.kgPerMetre, '每米坯布重量', 0.01, 10, 4);
  }
  if (value.lossPercent !== undefined) {
    if (!isFabricProcessing(p)) fail('仅面料加工单填写约定加工损耗');
    terms.lossPercent = decimal(value.lossPercent, '约定加工损耗', 0, 50, 2);
  }
  return Object.keys(terms).length ? terms : undefined;
}
/** One line for reviews and contract documents, e.g. "每米重量 0.72 公斤" or "约定加工损耗 5%". */
export function fabricStageTermsText(p: { stageTerms?: FabricStageTerms }): string {
  const t = p.stageTerms; if (!t) return '';
  return [t.kgPerMetre !== undefined && `每米重量 ${t.kgPerMetre} 公斤`, t.lossPercent !== undefined && `约定加工损耗 ${t.lossPercent}%（按出缸米数计费）`].filter(Boolean).join('；');
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
};
/** Null when the purchase is not a fabric processing contract. */
export function fabricStageBalance(root: MistState, processingId: string): FabricStageBalance | null {
  const contract = root.fulfillment?.purchases.find(p => p.id === processingId);
  if (!contract || !isFabricProcessing(contract)) return null;
  const branch = root.productions.find(job => job.sourcePurchaseId === contract.id);
  const totals = new Map<string, number>();
  if (branch) for (const row of materialDeliveryRows(root)) {
    if (row.delivery.productionId !== branch.id) continue;
    const source = root.fulfillment.purchases.find(p => p.id === row.purchaseId);
    if (!isFabricStageMaterial(source)) continue;
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
  return { unit: contract.unit, inputs, input, output, lossPercent, ...(agreed !== undefined ? { agreedLossPercent: agreed } : {}),
    overAllowance: lossPercent !== null && agreed !== undefined && lossPercent > agreed, outputExceedsInput: input !== null && output > input, plannedInput };
}
