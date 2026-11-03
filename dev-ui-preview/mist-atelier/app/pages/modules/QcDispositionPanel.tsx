import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** Production NOK handling chosen by the order owner: rework, customer-approved concession or factory chargeback. */
import React from 'react';
import { Banner, Button, ChoiceCards, Dialog, Field, FormGrid, Pill, TextArea, TextInput, UploadZone, useToast, type Tone } from '../../../../../components/mist';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import type { FulfillmentQcTask } from '../../../../../server/src/shared/mistFulfillment';
import { QC_DISPOSITION_LABEL, currentQcDisposition, qcDispositions, type QcDisposition, type QcDispositionKind } from '../../../../../server/src/shared/mistQcDisposition';
import { useMistWorkspace } from '../../runtime/workspace';
import { RecordFiles, today } from './fulfillmentKit';
import { DetailBlock, shortWhen } from './pageKit';

const STATUS: Record<QcDisposition['status'], { label: string; tone: Tone }> = { open: { label: '已登记', tone: 'neutral' }, pending: { label: '待审批', tone: 'warn' }, approved: { label: '已批准', tone: 'ok' }, rejected: { label: '已退回', tone: 'bad' } };
const detail = (d: QcDisposition) => d.kind === 'rework' ? `${d.factory} · ${d.due} 前完成` : d.kind === 'concession' ? `${d.scope} · ${d.customerEvidence}` : `${d.purchaseCode} · ${d.amount} ${d.currency}`;

export function QcDispositionPanel({ task, state, canDispose, locked }: { task: FulfillmentQcTask; state: MistState; canDispose: boolean; locked: boolean }) {
  const { run, uploadFile } = useMistWorkspace(), toast = useToast();
  const rows = qcDispositions(task), current = currentQcDisposition(task);
  const latest = state.fulfillment.qcReports.find(report => report.id === task.reportIds.at(-1));
  const production = task.source.kind === 'orderLine' ? state.productions.find(job => job.id === (task.source as { productionId?: string }).productionId) : undefined;
  const contract = state.fulfillment.purchases.find(p => p.id === production?.sourcePurchaseId);
  const open = task.kind === 'production' && task.state === 'blocked' && latest?.result === 'reject';
  const chosen = current && current.status !== 'rejected' && current.kind !== 'chargeback';
  const [form, setForm] = React.useState<null | { kind: QcDispositionKind; note: string; factory: string; due: string; scope: string; customerEvidence: string; amount: string; fileIds: string[] }>(null);
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setForm(null); setError(''); }, [task.id]);
  if (!rows.length && !(open && canDispose)) return null;
  const start = () => { setError(''); setForm({ kind: chosen ? 'chargeback' : 'rework', note: '', factory: task.factory, due: today(), scope: '', customerEvidence: '', amount: '', fileIds: [] }); };
  const save = async () => {
    if (!form) return;
    if (!form.note.trim()) return setError('请填写处置说明');
    if (form.kind === 'concession' && (!form.scope.trim() || !form.customerEvidence.trim() || !form.fileIds.length)) return setError('让步接收须写明范围、客户书面同意依据并附文件');
    if (form.kind === 'chargeback' && !(Number(form.amount) > 0)) return setError('请填写大于零的扣款金额');
    setBusy(true); setError('');
    try {
      await run({ type: 'fulfillment.qc.dispose', payload: { id: task.id, kind: form.kind, note: form.note.trim(), fileIds: form.fileIds,
        ...(form.kind === 'rework' ? { factory: form.factory.trim(), due: form.due } : form.kind === 'concession' ? { scope: form.scope.trim(), customerEvidence: form.customerEvidence.trim() } : { amount: Number(form.amount) }) } });
      toast(form.kind === 'concession' ? '让步接收已提交审批' : `已登记${QC_DISPOSITION_LABEL[form.kind]}`); setForm(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '处置尚未保存'); } finally { setBusy(false); }
  };
  const upload = async (files: File[]) => { if (!form) return; setBusy(true); try { const ids: string[] = []; for (const file of files) ids.push((await uploadFile(file)).id); setForm(previous => previous && { ...previous, fileIds: [...previous.fileIds, ...ids] }); } catch (cause) { setError(cause instanceof Error ? cause.message : '附件上传失败'); } finally { setBusy(false); } };
  const kinds = (chosen ? ['chargeback'] : ['rework', 'concession', 'chargeback']) as QcDispositionKind[];
  return <DetailBlock title={uiText('不合格处置')}>
    {rows.slice().reverse().map(d => <div key={d.id} className="mist-col" data-qc-disposition={d.kind} style={{ gap: 4 }}>
      <div className="mist-row" style={{ gap: 6, flexWrap: 'wrap' }}><b style={{ fontWeight: 500 }}>{uiText(QC_DISPOSITION_LABEL[d.kind])}</b><Pill tone={STATUS[d.status].tone}>{uiText(STATUS[d.status].label)}</Pill><span className="mist-note">{d.requester} · {shortWhen(d.at)}</span></div>
      <span className="mist-note">{detail(d)}</span><p className="mist-sub">{d.note}</p>
      {d.decision && <span className="mist-note">{d.decision.actor} · {d.decision.note}</span>}
      {d.fileIds.length > 0 && <RecordFiles ids={d.fileIds} />}
    </div>)}
    {open && canDispose && <div className="mist-row"><Button disabled={locked || busy} onClick={start}>{uiText(chosen ? '登记工厂扣款' : '选择处置方式')}</Button></div>}
    <Dialog open={!!form} onClose={() => !busy && setForm(null)} title={uiText('不合格处置')} width={640} footer={<><Button variant="quiet" disabled={busy} onClick={() => setForm(null)}>{uiText('取消')}</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{uiText(form?.kind === 'concession' ? '提交审批' : '保存')}</Button></>}>
      {form && <div className="mist-col">
        {error && <Banner tone="bad" title={uiText('处置尚未保存')}>{error}</Banner>}
        <ChoiceCards ariaLabel={uiText('处置方式')} cols={kinds.length} value={form.kind} onChange={kind => setForm({ ...form, kind })} options={kinds.map(kind => ({ value: kind, title: QC_DISPOSITION_LABEL[kind], description: kind === 'rework' ? '工厂返修后复验' : kind === 'concession' ? '客户书面同意，经审批放行' : contract ? `${contract.code} 结算时扣除` : '工厂合同结算时扣除' }))} />
        <FormGrid>
          {form.kind === 'rework' && <><Field label={uiText('返工工厂')} required><TextInput aria-label={uiText('返工工厂')} value={form.factory} onChange={e => setForm({ ...form, factory: e.target.value })} /></Field>
            <Field label={uiText('返工完成日')} required><TextInput aria-label={uiText('返工完成日')} type="date" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} /></Field></>}
          {form.kind === 'concession' && <><Field label={uiText('让步范围')} required full><TextInput aria-label={uiText('让步范围')} value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} /></Field>
            <Field label={uiText('客户书面同意依据')} required full><TextInput aria-label={uiText('客户书面同意依据')} value={form.customerEvidence} onChange={e => setForm({ ...form, customerEvidence: e.target.value })} /></Field></>}
          {form.kind === 'chargeback' && <Field label={ui`扣款金额（${contract?.currency || ''}）`} required><TextInput aria-label={uiText('扣款金额')} type="number" min={0.01} step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>}
          <Field label={uiText('处置说明')} required full><TextArea aria-label={uiText('处置说明')} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
        </FormGrid>
        <UploadZone title={uiText(form.kind === 'concession' ? '客户同意邮件或文件' : '附件')} onFiles={files => void upload(files)} />
        {form.fileIds.length > 0 && <RecordFiles ids={form.fileIds} />}
      </div>}
    </Dialog>
  </DetailBlock>;
}
