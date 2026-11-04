/**
 * Fabric development by staged outsourcing (P1-1, user decision 2026-11-02): the weaving mill makes the greige sample,
 * hands it to the dyeing/finishing mill, and only the last mill returns the sample for QC and confirmation.
 * A staged round therefore creates one version for the whole chain instead of one parallel candidate per factory.
 * Rounds without `stages` keep the existing parallel comparison behaviour.
 */
import { MistCommandError, type MistState, type MistVersion } from './mistWorkspace';

export const DEV_STAGE_PROCESSES = ['织造', '染整', '印花', '后整理', '涂层'] as const;
export type DevStageProcess = typeof DEV_STAGE_PROCESSES[number];
export type DevStagePlan = { factoryId: string; process: DevStageProcess };
export type DevStage = DevStagePlan & { factory: string };
/** Upstream stage `stageIndex` delivered its greige/semi-finished sample to the next stage. */
export type DevStageHandover = { id: string; stageIndex: number; quantity: number; unit: string; date: string; note: string; at: string; actor: string };

const fail = (message: string): never => { throw new MistCommandError('VALIDATION', message, 422); };
/** Default process from the supplier's registered type; the user may change it. */
export function defaultStageProcess(supplierType: string | undefined): DevStageProcess {
  const type = supplierType || '';
  return (DEV_STAGE_PROCESSES as readonly string[]).includes(type) ? type as DevStageProcess : /织/.test(type) ? '织造' : /染/.test(type) ? '染整' : /印/.test(type) ? '印花' : '后整理';
}
/** Shape and chain rules shared by the create page, new-round dialog and server. Returns the first problem or null. */
export function devStagePlanError(plan: unknown): string | null {
  if (!Array.isArray(plan)) return '工序链格式无效';
  if (plan.length < 2) return '分段委外至少需要两道工序';
  if (plan.length > 6) return '工序链最多六道工序';
  const ids = new Set<string>();
  for (const row of plan) {
    if (!row || typeof row !== 'object' || typeof row.factoryId !== 'string' || !row.factoryId.trim()) return '请为每道工序选择工厂';
    if (!(DEV_STAGE_PROCESSES as readonly string[]).includes(row.process)) return '请为每道工序选择工序类型';
    if (ids.has(row.factoryId)) return '同一工厂在工序链中只能出现一次';
    ids.add(row.factoryId);
  }
  if (plan[plan.length - 1].process === '织造') return '最后一道工序出样，不能是织造';
  return null;
}
export function normalizeDevStagePlan(plan: unknown): DevStagePlan[] {
  const problem = devStagePlanError(plan); if (problem) fail(problem);
  return (plan as DevStagePlan[]).map(row => ({ factoryId: row.factoryId.trim(), process: row.process }));
}
export const devStageFactoryName = (state: Pick<MistState, 'market'>, id: string) => state.market?.suppliers.find(s => s.id === id)?.name || id;
export const devStagesOf = (state: Pick<MistState, 'market'>, plan: DevStagePlan[]): DevStage[] => plan.map(row => ({ ...row, factory: devStageFactoryName(state, row.factoryId) }));
/** e.g. "吴江织造（织造）→ 盛泽染整（染整 · 出样）". */
export function devStageChainText(stages: Array<Pick<DevStage, 'factory' | 'process'>>): string {
  return stages.map((stage, index) => `${stage.factory}（${stage.process}${index === stages.length - 1 ? ' · 出样' : ''}）`).join(' → ');
}
/** Upstream stages still waiting for a recorded handover to the next mill. */
export function devStagePendingHandovers(version: Pick<MistVersion, 'stages' | 'stageHandovers'>): number[] {
  if (!version.stages?.length) return [];
  return version.stages.slice(0, -1).map((_, index) => index).filter(index => !(version.stageHandovers || []).some(row => row.stageIndex === index));
}
/** Blocker for recording a handover on this exact version; null when allowed. */
export function devStageHandoverBlocker(version: MistVersion, stageIndex: number): string | null {
  if (!version.stages?.length) return '本版不是分段委外版本';
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= version.stages.length - 1) return '请选择前道工序';
  if (version.returnedAt) return '本版已登记返样，不再登记前道交接';
  if (version.qcDecision) return '本版已处理，不能再登记交接';
  if (devStagePendingHandovers(version).some(index => index < stageIndex)) return '请先登记前道交接，再登记后道交接';
  return null;
}
