import { uiText, ui } from '../../../../services/interfaceLanguage';
/** Fabric staged outsourcing: choose parallel comparison or a process chain, and edit the chain in order. */
import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Workflow } from 'lucide-react';
import { Button, ChoiceCards, Field, FormGrid, Pill, Select, TextArea, TextInput } from '../../../../components/mist';
import type { MistState, MistVersion } from '../../../../server/src/shared/mistWorkspace';
import { DEV_STAGE_PROCESSES, defaultStageProcess, devStageChainText, devStageHandoverBlocker, devStagePendingHandovers, devStagePlanError, type DevStagePlan } from '../../../../server/src/shared/mistDevelopmentStages';
import { FailureNotice } from '../runtime/FailureNotice';

export type DevSampleMode = 'parallel' | 'staged';
type FactoryOption = { id: string; name: string; unavailable: boolean };

export function DevSampleModeChoice({ value, onChange, disabled }: { value: DevSampleMode; onChange: (value: DevSampleMode) => void; disabled?: boolean }) {
  return <ChoiceCards ariaLabel={uiText('打样方式')} cols={2} value={value} disabled={disabled} onChange={onChange} options={[
    { value: 'parallel', title: '成品比样', description: '多家工厂各出一版，比样择优' },
    { value: 'staged', title: '分段委外', description: '织厂织坯交染厂，末道出样' },
  ]} />;
}

/** Ordered chain editor. The last stage returns the sample; at least two stages are needed. */
export function DevStageChainEditor({ state, value, options, onChange, disabled }: { state: MistState | null; value: DevStagePlan[]; options: FactoryOption[]; onChange: (value: DevStagePlan[]) => void; disabled?: boolean }) {
  const typeOf = (id: string) => state?.market.suppliers.find(s => s.id === id)?.type;
  const update = (index: number, patch: Partial<DevStagePlan>) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row));
  const move = (index: number, delta: number) => { const next = [...value], target = index + delta; [next[index], next[target]] = [next[target], next[index]]; onChange(next); };
  const choices = (index: number) => options.filter(option => option.id === value[index]?.factoryId || !option.unavailable && !value.some(row => row.factoryId === option.id)).map(option => ({ value: option.id, label: option.unavailable ? ui`${option.name} · 当前不可用` : option.name }));
  const problem = value.every(row => row.factoryId) ? devStagePlanError(value) : null;
  return <div className="mist-col" role="group" aria-label={uiText('工序链')} style={{ gap: 10 }}>
    {value.map((row, index) => <div key={index} className="mist-row" data-stage={index + 1} style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Pill tone={index === value.length - 1 ? 'accent' : 'neutral'}>{uiText(index === value.length - 1 ? `第 ${index + 1} 道 · 出样` : `第 ${index + 1} 道`)}</Pill>
      <Field label={uiText('工厂')}><Select aria-label={ui`第 ${index + 1} 道工厂`} placeholder={uiText('请选择')} disabled={disabled} value={row.factoryId} options={choices(index)} onChange={event => update(index, { factoryId: event.target.value, process: defaultStageProcess(typeOf(event.target.value)) })} /></Field>
      <Field label={uiText('工序')}><Select aria-label={ui`第 ${index + 1} 道工序`} disabled={disabled} value={row.process} options={DEV_STAGE_PROCESSES.map(item => ({ value: item, label: item }))} onChange={event => update(index, { process: event.target.value as DevStagePlan['process'] })} /></Field>
      <Button size="sm" variant="quiet" icon={ArrowUp} aria-label={ui`第 ${index + 1} 道上移`} disabled={disabled || index === 0} onClick={() => move(index, -1)} />
      <Button size="sm" variant="quiet" icon={ArrowDown} aria-label={ui`第 ${index + 1} 道下移`} disabled={disabled || index === value.length - 1} onClick={() => move(index, 1)} />
      <Button size="sm" variant="quiet" icon={Trash2} aria-label={ui`删除第 ${index + 1} 道`} disabled={disabled || value.length <= 2} onClick={() => onChange(value.filter((_, i) => i !== index))} />
    </div>)}
    <div className="mist-row"><Button size="sm" icon={Plus} disabled={disabled || value.length >= 6} onClick={() => onChange([...value, { factoryId: '', process: '后整理' }])}>{uiText('添加工序')}</Button></div>
    {problem && <p className="mist-field-hint" role="alert">{uiText(problem)}</p>}
  </div>;
}
export const emptyStagePlan = (): DevStagePlan[] => [{ factoryId: '', process: '织造' }, { factoryId: '', process: '染整' }];

/** Version detail: the chain, each upstream handover, and the action to record the next one. */
export function DevStageChainCard({ version, today, canWrite, busy, onHandover }: { version: MistVersion; today: string; canWrite: boolean; busy: boolean; onHandover: (input: { stageIndex: number; quantity: number; unit: string; date: string; note: string }) => Promise<void> }) {
  const stages = version.stages || [], pending = devStagePendingHandovers(version), next = pending[0];
  const [form, setForm] = React.useState<{ quantity: string; unit: string; date: string; note: string } | null>(null), [error, setError] = React.useState('');
  React.useEffect(() => { setForm(null); setError(''); }, [version.id]);
  if (!stages.length) return null;
  const blocker = next === undefined ? null : devStageHandoverBlocker(version, next);
  const save = async () => { if (!form || next === undefined) return; const quantity = Number(form.quantity); if (!(quantity > 0) || !form.unit.trim() || !form.date || !form.note.trim()) { setError('请填写交接数量、单位、日期和依据'); return; } setError(''); try { await onHandover({ stageIndex: next, quantity, unit: form.unit.trim(), date: form.date, note: form.note.trim() }); setForm(null); } catch (cause) { setError(cause instanceof Error ? cause.message : '交接尚未保存'); } };
  return <section className="mist-section" data-stage-chain style={{ padding: '10px 22px' }}>
    <div className="mist-row" style={{ gap: 8, flexWrap: 'wrap' }}><Workflow size={16} aria-hidden="true" /><b style={{ fontWeight: 500 }}>{uiText('工序链')}</b><span className="mist-muted" style={{ fontSize: 12.5 }}>{devStageChainText(stages)}</span></div>
    <ol className="mist-list" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{stages.slice(0, -1).map((stage, index) => { const row = version.stageHandovers?.find(item => item.stageIndex === index); return <li key={index} data-handover={index}>
      {stage.factory} → {stages[index + 1].factory}：{row ? <>{row.quantity} {uiText(row.unit)} · {row.date} · {row.note} <span className="mist-muted">（{row.actor}）</span></> : <Pill tone="warn">{uiText('待交接')}</Pill>}
    </li>; })}</ol>
    {canWrite && next !== undefined && !form && <div className="mist-row" style={{ marginTop: 6 }}><Button size="sm" disabled={busy || !!blocker} title={uiText(blocker || undefined)} onClick={() => setForm({ quantity: '', unit: version.task?.sampleUnit || '米', date: today, note: '' })}>{ui`登记 ${stages[next].factory} 交接`}</Button></div>}
    {form && next !== undefined && <div className="mist-col" style={{ marginTop: 8 }}>
      {error && <FailureNotice title={'交接尚未保存'} detail={error} />}
      <FormGrid>
        <Field label={uiText('交接数量')} required><TextInput aria-label={uiText('交接数量')} type="number" min={0} step="0.01" value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} /></Field>
        <Field label={uiText('单位')} required><TextInput aria-label={uiText('交接单位')} value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })} /></Field>
        <Field label={uiText('交接日期')} required><TextInput aria-label={uiText('交接日期')} type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></Field>
        <Field label={uiText('交接依据')} required full><TextArea aria-label={uiText('交接依据')} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></Field>
      </FormGrid>
      <div className="mist-row"><span className="mist-spacer" /><Button variant="quiet" disabled={busy} onClick={() => { setForm(null); setError(''); }}>{uiText('取消')}</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{uiText('保存交接')}</Button></div>
    </div>}
  </section>;
}
