/** Exact physical sample evidence for a production branch. */
import type { MistProduction, MistState } from './mistWorkspace';
import type { FulfillmentSampleRole } from './mistFulfillment';
import { parseColors, type OrderLineBreakdown } from './mistOrderBreakdown';

export type ProductionSampleEvidence = {
  sampleId: string; sampleCode: string; color: string; form: string;
  reportId: string; reportNumber: string; result: 'pass' | 'conditional'; opinion: string;
};
export type ProductionSampleRequirement = {
  key: string; label: string; ok: boolean; sampleId?: string; sampleCode?: string; taskId?: string;
  evidence?: ProductionSampleEvidence;
};
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

export function productionSampleRequirements(state: MistState, branch: MistProduction, role: FulfillmentSampleRole, shipmentId?: string): ProductionSampleRequirement[] {
  const f = state.fulfillment;
  const samples = f.samples.filter(sample => sample.role === role && sample.source.kind === 'orderLine'
    && sample.source.orderId === branch.orderId && sample.source.lineId === branch.lineId && sample.source.productionId === branch.id
    && (role !== 'shipping' || sample.shipmentId === shipmentId));
  const review = (sample: typeof samples[number], key: string, label: string): ProductionSampleRequirement => {
    const task = f.qcTasks.find(task => task.sampleId === sample.id && task.kind === 'sample'
      && task.source.kind === 'orderLine' && task.source.productionId === branch.id);
    const report = f.qcReports.find(report => report.id === task?.reportIds.at(-1) && report.taskId === task?.id);
    const current = !!task && task.state === 'reported' && !!report && report.result !== 'reject'
      && report.scopeRevision === (sample.qualityRevision || 1);
    const ok = current && task.businessConfirmation?.result === 'approved' && task.businessContinued?.reportId === report.id;
    const evidence = current ? { sampleId: sample.id, sampleCode: sample.code, color: sample.color, form: sample.form,
      reportId: report.id, reportNumber: report.report, result: report.result as 'pass' | 'conditional', opinion: report.opinion } : undefined;
    return { key, label, ok, sampleId: sample.id, sampleCode: sample.code, taskId: task?.id, evidence };
  };
  if (role !== 'pioneer') {
    const rows = samples.map(sample => review(sample, 'sample', ''));
    return [rows.find(row => row.ok) ?? rows[0] ?? { key: 'sample', label: '', ok: false }];
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
    if (!latest.size) rows.push({ key: `sample:${normalized(color)}`, label: color, ok: false });
    for (const [form, sample] of latest) rows.push(review(sample, `sample:${normalized(color)}:${form}`, [color, sample.form].filter(Boolean).join(' · ')));
  }
  return rows;
}
