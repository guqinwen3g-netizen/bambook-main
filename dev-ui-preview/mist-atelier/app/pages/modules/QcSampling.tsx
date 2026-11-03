import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** AQL sampling (garment) and four-point fabric inspection inputs for the QC report editor; the outcome is computed, not typed. */
import React from 'react';
import { Banner, Button, Card, CardBody, CardHeader, Facts, Field, FormGrid, Pill, Select, TextArea, TextInput } from '../../../../../components/mist';
import { AQL_LEVELS, aqlOutcome, fabricOutcome, type AqlInspection, type AqlLevel, type FabricInspection } from '../../../../../server/src/shared/mistQcInspection';

export type AqlDraft = { lotSize: string; majorAql: AqlLevel; minorAql: AqlLevel; inspected: string; critical: string; major: string; minor: string; defects: string };
export const emptyAql = (lot = 0): AqlDraft => ({ lotSize: lot ? String(lot) : '', majorAql: '2.5', minorAql: '4.0', inspected: '', critical: '0', major: '0', minor: '0', defects: '' });
export function aqlFromDraft(d: AqlDraft): AqlInspection | null {
  const n = (v: string) => Number(v);
  if (!d.lotSize || !d.inspected) return null;
  return { lotSize: n(d.lotSize), majorAql: d.majorAql, minorAql: d.minorAql, inspected: n(d.inspected), critical: n(d.critical), major: n(d.major), minor: n(d.minor), defects: d.defects.trim() };
}
const outcomeOf = (value: AqlInspection | null) => { try { return value && Number.isSafeInteger(value.lotSize) && value.lotSize >= 2 ? aqlOutcome(value) : null; } catch { return null; } };
const levelOptions = AQL_LEVELS.map(level => ({ value: level, label: `AQL ${level}` }));

export function AqlCard({ value, onChange }: { value: AqlDraft; onChange: (value: AqlDraft) => void }) {
  const outcome = outcomeOf(aqlFromDraft({ ...value, inspected: value.inspected || '0' }));
  const set = (patch: Partial<AqlDraft>) => onChange({ ...value, ...patch });
  const num = (key: keyof AqlDraft, label: string) => <Field label={uiText(label)}><TextInput aria-label={uiText(label)} type="number" min={0} step="1" value={value[key] as string} onChange={e => set({ [key]: e.target.value } as Partial<AqlDraft>)} /></Field>;
  return <Card><CardHeader title={uiText('AQL 抽样（一般检验水平 II，正常一次抽样）')} />
    <CardBody><FormGrid>
      {num('lotSize', '批量（件）')}
      <Field label={uiText('严重缺陷 AQL')}><Select aria-label={uiText('严重缺陷 AQL')} value={value.majorAql} options={levelOptions} onChange={e => set({ majorAql: e.target.value as AqlLevel })} /></Field>
      <Field label={uiText('轻微缺陷 AQL')}><Select aria-label={uiText('轻微缺陷 AQL')} value={value.minorAql} options={levelOptions} onChange={e => set({ minorAql: e.target.value as AqlLevel })} /></Field>
      {num('inspected', '实际抽检件数')}{num('critical', '致命缺陷')}{num('major', '严重缺陷')}{num('minor', '轻微缺陷')}
      <Field label={uiText('缺陷内容与部位')} full><TextArea aria-label={uiText('缺陷内容与部位')} value={value.defects} onChange={e => set({ defects: e.target.value })} /></Field>
    </FormGrid>
    {outcome && <Facts cols={2} items={[
      { label: '应抽样本', value: `${outcome.sampleSize} 件（字码 ${outcome.major.letter}）` },
      { label: '严重 Ac / Re', value: `${outcome.major.accept} / ${outcome.major.reject}` },
      { label: '轻微 Ac / Re', value: `${outcome.minor.accept} / ${outcome.minor.reject}` },
      { label: '抽样判定', value: <Pill tone={outcome.result === 'pass' ? 'ok' : 'bad'}>{uiText(outcome.result === 'pass' ? '允收' : '拒收')}</Pill> },
    ]} />}
    {outcome?.reasons.length ? <Banner tone="bad" title={uiText('抽样拒收')}>{outcome.reasons.join('；')}</Banner> : null}
    </CardBody></Card>;
}

export type FabricDraft = { widthInches: string; limit: string; rolls: Array<{ roll: string; yards: string; points: string }>; shade: string; shrinkageWarp: string; shrinkageWeft: string; colourfastness: string };
export const emptyFabric = (): FabricDraft => ({ widthInches: '', limit: '40', rolls: [{ roll: '', yards: '', points: '' }], shade: '', shrinkageWarp: '', shrinkageWeft: '', colourfastness: '' });
export function fabricFromDraft(d: FabricDraft): FabricInspection | null {
  const rolls = d.rolls.filter(r => r.roll.trim() || r.yards || r.points);
  if (!d.widthInches || !rolls.length) return null;
  const opt = (v: string) => v.trim() === '' ? undefined : Number(v);
  return { widthInches: Number(d.widthInches), limit: Number(d.limit), rolls: rolls.map(r => ({ roll: r.roll.trim(), yards: Number(r.yards), points: Number(r.points || 0) })),
    lab: { ...(d.shade.trim() ? { shade: d.shade.trim() } : {}), ...(opt(d.shrinkageWarp) !== undefined ? { shrinkageWarp: opt(d.shrinkageWarp) } : {}), ...(opt(d.shrinkageWeft) !== undefined ? { shrinkageWeft: opt(d.shrinkageWeft) } : {}), ...(d.colourfastness.trim() ? { colourfastness: d.colourfastness.trim() } : {}) } };
}
export function FabricInspectionCard({ value, onChange }: { value: FabricDraft; onChange: (value: FabricDraft) => void }) {
  const parsed = fabricFromDraft(value), outcome = parsed && parsed.rolls.every(r => r.yards > 0) && parsed.limit > 0 ? fabricOutcome(parsed) : null;
  const set = (patch: Partial<FabricDraft>) => onChange({ ...value, ...patch });
  const setRoll = (i: number, patch: Partial<FabricDraft['rolls'][number]>) => set({ rolls: value.rolls.map((r, n) => n === i ? { ...r, ...patch } : r) });
  return <Card><CardHeader title={uiText('四分制验布')} />
    <CardBody><FormGrid>
      <Field label={uiText('有效门幅（英寸）')}><TextInput aria-label={uiText('有效门幅（英寸）')} type="number" min={0} step="0.1" value={value.widthInches} onChange={e => set({ widthInches: e.target.value })} /></Field>
      <Field label={uiText('允收分数（分/100 平方码）')}><TextInput aria-label={uiText('允收分数')} type="number" min={0} step="1" value={value.limit} onChange={e => set({ limit: e.target.value })} /></Field>
    </FormGrid>
    <div className="mist-col">{value.rolls.map((r, i) => <FormGrid key={i}>
      <Field label={uiText('卷号')}><TextInput aria-label={ui`卷号 ${i + 1}`} value={r.roll} onChange={e => setRoll(i, { roll: e.target.value })} /></Field>
      <Field label={uiText('验布码数')}><TextInput aria-label={ui`验布码数 ${i + 1}`} type="number" min={0} step="0.1" value={r.yards} onChange={e => setRoll(i, { yards: e.target.value })} /></Field>
      <Field label={uiText('扣分')}><TextInput aria-label={ui`扣分 ${i + 1}`} type="number" min={0} step="1" value={r.points} onChange={e => setRoll(i, { points: e.target.value })} /></Field>
    </FormGrid>)}
      <div className="mist-row"><Button size="sm" disabled={value.rolls.length >= 500} onClick={() => set({ rolls: [...value.rolls, { roll: '', yards: '', points: '' }] })}>{uiText('添加一卷')}</Button></div></div>
    <FormGrid>
      <Field label={uiText('色差 / 色光')}><TextInput aria-label={uiText('色差 / 色光')} value={value.shade} onChange={e => set({ shade: e.target.value })} /></Field>
      <Field label={uiText('经向缩率（%）')}><TextInput aria-label={uiText('经向缩率')} type="number" step="0.1" value={value.shrinkageWarp} onChange={e => set({ shrinkageWarp: e.target.value })} /></Field>
      <Field label={uiText('纬向缩率（%）')}><TextInput aria-label={uiText('纬向缩率')} type="number" step="0.1" value={value.shrinkageWeft} onChange={e => set({ shrinkageWeft: e.target.value })} /></Field>
      <Field label={uiText('色牢度')}><TextInput aria-label={uiText('色牢度')} value={value.colourfastness} onChange={e => set({ colourfastness: e.target.value })} /></Field>
    </FormGrid>
    {outcome && <Facts cols={2} items={[
      { label: '验布总码数', value: `${outcome.totalYards}` }, { label: '总扣分', value: `${outcome.totalPoints}` },
      { label: '分/100 平方码', value: `${outcome.pointsPer100}` },
      { label: '验布判定', value: <Pill tone={outcome.result === 'pass' ? 'ok' : 'bad'}>{uiText(outcome.result === 'pass' ? '允收' : '拒收')}</Pill> },
    ]} />}
    {outcome?.reasons.length ? <Banner tone="bad" title={uiText('验布拒收')}>{outcome.reasons.join('；')}</Banner> : null}
    </CardBody></Card>;
}
