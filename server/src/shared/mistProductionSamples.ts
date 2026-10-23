import {garmentMaterialFingerprint} from './mistInternalFabric';
import {MistCommandError} from './mistWorkspace';
/** Exact physical sample evidence for a production branch. */
import type { MistProduction, MistState } from './mistWorkspace';
import type { FulfillmentSampleRole } from './mistFulfillment';
import { parseColors, type OrderLineBreakdown } from './mistOrderBreakdown';

export type ProductionSampleEvidence = {
  sampleId: string; sampleCode: string; color: string; form: string;
  reportId: string; reportNumber: string; result: 'pass' | 'conditional'; opinion: string;
  size?: string; quantity?: number; unit?: string; sizeQuantities?:Array<{size:string;quantity:number}>;
};
export type ProductionSampleRequirement = {
  key: string; label: string; ok: boolean; sampleId?: string; sampleCode?: string; taskId?: string;
  reason: string;
  evidence?: ProductionSampleEvidence;
};
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

export function productionSampleRequirements(state: MistState, branch: MistProduction, role: FulfillmentSampleRole, shipmentId?: string): ProductionSampleRequirement[] {
  const f = state.fulfillment;
  let materialPlan='';
  if(role==='pp'){try{materialPlan=garmentMaterialFingerprint(state,branch.orderId,branch.lineId);}catch(error){if(!(error instanceof MistCommandError))throw error;materialPlan='missing-material-plan';}}
  let samples = f.samples.filter(sample => sample.role === role && sample.source.kind === 'orderLine'
    && sample.source.orderId === branch.orderId && sample.source.lineId === branch.lineId && sample.source.productionId === branch.id
    && (role !== 'shipping' || sample.shipmentId === shipmentId)
    && (!materialPlan || sample.materialPlan === materialPlan));
  if(role==='shipping'){const sets=samples.filter(sample=>sample.sizeQuantities?.length);if(sets.length)samples=[sets.at(-1)!];}
  const review = (sample: typeof samples[number], key: string, label: string): ProductionSampleRequirement => {
    const task = f.qcTasks.find(task => task.sampleId === sample.id && task.kind === 'sample'
      && task.source.kind === 'orderLine' && task.source.productionId === branch.id);
    const report = f.qcReports.find(report => report.id === task?.reportIds.at(-1) && report.taskId === task?.id);
    const current = !!task && task.state === 'reported' && !!report && report.result !== 'reject'
      && report.scopeRevision === (sample.qualityRevision || 1);
    const ok = current && task.businessConfirmation?.result === 'approved' && task.businessContinued?.reportId === report.id;
    const evidence = current ? { sampleId: sample.id, sampleCode: sample.code, color: sample.color, form: sample.form, size: sample.size, quantity: sample.quantity, unit: sample.unit,...(sample.sizeQuantities?{sizeQuantities:structuredClone(sample.sizeQuantities)}:{}),
      reportId: report.id, reportNumber: report.report, result: report.result as 'pass' | 'conditional', opinion: report.opinion } : undefined;
    const external = state.orders.find(order => order.id === branch.orderId)?.governance?.contract.kind === 'external';
    const reason = !report ? '待QC' : report.scopeRevision !== (sample.qualityRevision || 1) ? '待复验' : report.result === 'reject' ? 'QC未通过' : !current ? '待QC'
      : task.businessConfirmation?.result === 'rejected' ? '未采用' : task.businessConfirmation?.result !== 'approved' ? external ? '待客户确认' : '待需求方确认'
      : task.businessContinued?.reportId !== report.id ? '待业务确认' : '已确认';
    return { key, label, ok, reason, sampleId: sample.id, sampleCode: sample.code, taskId: task?.id, evidence };
  };
  if (role !== 'pioneer') {
    // Review only the standards actually registered, never invent one sample per production size.
    // A new physical specimen of the same size/colour/form is the current submission;
    // its pending or rejected review cannot be bypassed by an older approved specimen.
    const latest = new Map<string, typeof samples[number]>();
    for (const sample of samples) latest.set(JSON.stringify([normalized(sample.size), normalized(sample.color), normalized(sample.form)]), sample);
    const colors = new Set([...latest.values()].map(sample => normalized(sample.color))), forms = new Set([...latest.values()].map(sample => normalized(sample.form)));
    const rows = [...latest].map(([key, sample]) => review(sample, 'sample:' + key, [sample.size, colors.size > 1 ? sample.color : '', forms.size > 1 ? sample.form : ''].filter(Boolean).join(' · ')));
    return rows.length ? rows : [{ key: 'sample', label: '', ok: false, reason: '未登记' }];
  }

  const line = state.orderLines.find(line => line.id === branch.lineId) as (MistState['orderLines'][number] & { breakdown?: OrderLineBreakdown }) | undefined;
  const ordered = line?.breakdown?.kind === 'fabric' ? line.breakdown.rows.filter(row => row.quantity > 0).map(row => row.color) : [];
  const colors = ordered.length ? ordered : [...new Set(samples.flatMap(sample => parseColors(sample.color)))];
  const required = colors.length ? colors : [''];
  const rows: ProductionSampleRequirement[] = [];
  for (const color of required) {
    // Registration is append-only. A later physical sample replaces the older
    // sample of the same colour/form for this check; prior QC stays in history.
    const latest = new Map<string, typeof samples[number]>();
    for (const sample of samples) {
      const sampleColors = parseColors(sample.color);
      if (color ? !sampleColors.some(item => normalized(item) === normalized(color)) : sampleColors.length) continue;
      latest.set(normalized(sample.form), sample);
    }
    if (!latest.size) rows.push({ key: `sample:${normalized(color)}`, label: color, ok: false, reason: '未登记' });
    for (const [form, sample] of latest) rows.push(review(sample, `sample:${normalized(color)}:${form}`, [color, sample.form].filter(Boolean).join(' · ')));
  }
  return rows;
}
