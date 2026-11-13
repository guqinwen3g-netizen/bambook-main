/**
 * P1-4 inspection standards (backlog sup35 / sup36).
 * - Garment production: AQL single sampling, normal inspection, general level II (ISO 2859-1 / GB/T 2828.1).
 *   Defects are classified critical / major / minor; critical is zero-tolerance, major and minor use their own AQL.
 * - Fabric: four-point system (ASTM D5430), points per 100 square yards = points × 3600 ÷ (inspected yards × width inches);
 *   plus the lab results that decide acceptance (shade, shrinkage, colourfastness).
 * The reported conclusion must agree with the sampling outcome; a reject outcome cannot be filed as a pass.
 */
import { MistCommandError } from './mistWorkspace';

const fail = (message: string): never => { throw new MistCommandError('VALIDATION', message, 422); };
/** Development fabric facts retain measured values and original units, without a garment tolerance model. */
export function normalizeFabricQcMeasurements(input: unknown): Array<{property:string;actual:number;unit:string}> {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 200) return fail('面料实测最多支持200行');
  return input.map(row => {
    if (!row || typeof row.actual !== 'number' || !Number.isFinite(row.actual) || row.actual < 0) return fail('面料实测须为有限非负数');
    if (typeof row.property !== 'string' || !row.property.trim() || row.property.length > 120) return fail('实测项目未填写或格式无效');
    if (typeof row.unit !== 'string' || !row.unit.trim() || row.unit.length > 120) return fail('实测单位未填写或格式无效');
    return { property: row.property.trim(), actual: row.actual, unit: row.unit.trim() };
  });
}
// Lot size → sample size code letter, general inspection level II.
const LOT_LETTERS: Array<[number, string]> = [[8, 'A'], [15, 'B'], [25, 'C'], [50, 'D'], [90, 'E'], [150, 'F'], [280, 'G'], [500, 'H'], [1200, 'J'], [3200, 'K'], [10000, 'L'], [35000, 'M'], [150000, 'N'], [500000, 'P'], [Infinity, 'Q']];
const SAMPLE_SIZE: Record<string, number> = { A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50, J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000 };
const LETTERS = Object.keys(SAMPLE_SIZE);
export const AQL_LEVELS = ['0.65', '1.0', '1.5', '2.5', '4.0', '6.5'] as const;
export type AqlLevel = typeof AQL_LEVELS[number];
/**
 * Master table II-A, single normal sampling. In each AQL column the diagonal reads 0/1, ↑, 1/2, 2/3, 3/4, 5/6, 7/8, 10/11, 14/15, 21/22,
 * then ↑ for larger rows; rows before the 0/1 cell carry ↓. FIRST_LETTER is the row holding 0/1 for each AQL.
 */
const AC_BY_OFFSET: Record<number, number> = { 0: 0, 2: 1, 3: 2, 4: 3, 5: 5, 6: 7, 7: 10, 8: 14, 9: 21 };
const FIRST_LETTER: Record<AqlLevel, string> = { '0.65': 'G', '1.0': 'F', '1.5': 'E', '2.5': 'D', '4.0': 'C', '6.5': 'B' };

export type AqlPlan = { lotSize: number; letter: string; sampleSize: number; aql: AqlLevel; accept: number; reject: number };
/** Single normal sampling plan for one AQL; arrow cells resolve to the plan they point at, and small lots are inspected 100%. */
export function aqlPlan(lotSize: number, aql: AqlLevel): AqlPlan {
  if (!Number.isSafeInteger(lotSize) || lotSize < 2) fail('批量须为 2 以上的整数');
  if (!(AQL_LEVELS as readonly string[]).includes(aql)) fail('AQL 等级无效');
  const first = LETTERS.indexOf(FIRST_LETTER[aql]), lotIndex = LETTERS.indexOf(LOT_LETTERS.find(([max]) => lotSize <= max)![1]);
  let offset = lotIndex - first;
  if (offset < 0 || offset === 1) offset = 0; // ↓ before the first plan, ↑ right after it
  if (offset > 9) offset = 9;                  // ↑ beyond Ac 21
  const letter = LETTERS[first + offset], accept = AC_BY_OFFSET[offset];
  const sampleSize = Math.min(SAMPLE_SIZE[letter], lotSize);
  return { lotSize, letter, sampleSize, aql, accept, reject: accept + 1 };
}

export type AqlInspection = { lotSize: number; majorAql: AqlLevel; minorAql: AqlLevel; inspected: number; critical: number; major: number; minor: number; defects: string };
export type AqlOutcome = { major: AqlPlan; minor: AqlPlan; sampleSize: number; result: 'pass' | 'reject'; reasons: string[] };
export function aqlOutcome(input: AqlInspection): AqlOutcome {
  const major = aqlPlan(input.lotSize, input.majorAql), minor = aqlPlan(input.lotSize, input.minorAql);
  const sampleSize = Math.max(major.sampleSize, minor.sampleSize), reasons: string[] = [];
  if (input.critical > 0) reasons.push(`致命缺陷 ${input.critical} 件（零容忍）`);
  if (input.major >= major.reject) reasons.push(`严重缺陷 ${input.major} 件 ≥ 拒收数 ${major.reject}`);
  if (input.minor >= minor.reject) reasons.push(`轻微缺陷 ${input.minor} 件 ≥ 拒收数 ${minor.reject}`);
  return { major, minor, sampleSize, result: reasons.length ? 'reject' : 'pass', reasons };
}
const count = (value: unknown, label: string) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(`${label}须为非负整数`);
export function normalizeAql(input: unknown): AqlInspection {
  if (!input || typeof input !== 'object') return fail('AQL 抽样记录格式无效');
  const v = input as Record<string, unknown>;
  const row: AqlInspection = { lotSize: count(v.lotSize, '批量'), majorAql: v.majorAql as AqlLevel, minorAql: v.minorAql as AqlLevel, inspected: count(v.inspected, '实际抽检件数'), critical: count(v.critical, '致命缺陷'), major: count(v.major, '严重缺陷'), minor: count(v.minor, '轻微缺陷'), defects: typeof v.defects === 'string' ? v.defects.trim().slice(0, 2000) : '' };
  const outcome = aqlOutcome(row);
  if (row.inspected < outcome.sampleSize) fail(`按批量 ${row.lotSize} 须至少抽检 ${outcome.sampleSize} 件（实际 ${row.inspected} 件）`);
  if (row.inspected > row.lotSize) fail('抽检件数不能超过批量');
  if (row.critical + row.major + row.minor > 0 && !row.defects) fail('请写明缺陷内容与部位');
  return row;
}

/** Four-point system: each roll's inspected length and the points given (1–4 per defect, max 4 per linear yard). */
export type FabricRoll = { roll: string; yards: number; points: number };
export type FabricLab = { shade?: string; shrinkageWarp?: number; shrinkageWeft?: number; colourfastness?: string };
export type FabricInspection = { widthInches: number; limit: number; rolls: FabricRoll[]; lab: FabricLab };
export type FabricOutcome = { totalYards: number; totalPoints: number; pointsPer100: number; rejectedRolls: string[]; result: 'pass' | 'reject'; reasons: string[] };
const round2 = (n: number) => Math.round(n * 100) / 100;
export const pointsPer100 = (points: number, yards: number, widthInches: number) => yards > 0 && widthInches > 0 ? round2(points * 3600 / (yards * widthInches)) : 0;
export function fabricOutcome(input: FabricInspection): FabricOutcome {
  const totalYards = round2(input.rolls.reduce((n, r) => n + r.yards, 0)), totalPoints = input.rolls.reduce((n, r) => n + r.points, 0);
  const rejectedRolls = input.rolls.filter(r => pointsPer100(r.points, r.yards, input.widthInches) > input.limit).map(r => r.roll);
  const per100 = pointsPer100(totalPoints, totalYards, input.widthInches), reasons: string[] = [];
  if (per100 > input.limit) reasons.push(`整批 ${per100} 分/100 平方码 > 允收 ${input.limit}`);
  if (rejectedRolls.length) reasons.push(`超分卷：${rejectedRolls.join('、')}`);
  return { totalYards, totalPoints, pointsPer100: per100, rejectedRolls, result: reasons.length ? 'reject' : 'pass', reasons };
}
const positive = (value: unknown, label: string, max = 1e6) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : fail(`${label}须为大于零的数`);
export function normalizeFabricInspection(input: unknown): FabricInspection {
  if (!input || typeof input !== 'object') return fail('验布记录格式无效');
  const v = input as Record<string, unknown>;
  if (!Array.isArray(v.rolls) || !v.rolls.length || v.rolls.length > 500) fail('请逐卷登记验布结果，最多 500 卷');
  const rolls = (v.rolls as unknown[]).map((raw, i) => {
    const r = (raw || {}) as Record<string, unknown>, yards = positive(r.yards, `第 ${i + 1} 卷验布码数`, 10000), points = count(r.points, `第 ${i + 1} 卷扣分`);
    if (points > Math.ceil(yards) * 4) fail(`第 ${i + 1} 卷扣分超过每码最多 4 分`);
    const roll = typeof r.roll === 'string' && r.roll.trim() ? r.roll.trim().slice(0, 60) : fail(`第 ${i + 1} 卷请填写卷号`);
    return { roll, yards, points };
  });
  if (new Set(rolls.map(r => r.roll)).size !== rolls.length) fail('卷号不能重复');
  const lab = (v.lab || {}) as Record<string, unknown>, shrink = (value: unknown, label: string) => value === undefined || value === null || value === '' ? undefined : typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 30 ? value : fail(`${label}须在 ±30% 以内`);
  const textOf = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
  return { widthInches: positive(v.widthInches, '有效门幅（英寸）', 200), limit: positive(v.limit, '允收分数', 100), rolls,
    lab: Object.fromEntries(Object.entries({ shade: textOf(lab.shade), shrinkageWarp: shrink(lab.shrinkageWarp, '经向缩率'), shrinkageWeft: shrink(lab.shrinkageWeft, '纬向缩率'), colourfastness: textOf(lab.colourfastness) }).filter(([, x]) => x !== undefined)) as FabricLab };
}
/** A filed conclusion cannot be better than what the recorded sampling shows. */
export function assertConclusionMatches(result: 'pass' | 'conditional' | 'reject', outcome: { result: 'pass' | 'reject'; reasons: string[] }): void {
  if (outcome.result === 'reject' && result !== 'reject') fail(`抽检结果不合格（${outcome.reasons.join('；')}），结论须为不通过；客户接受请走让步接收`);
}
