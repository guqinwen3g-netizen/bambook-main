import React from 'react';
import { Banner, Button, Checkbox, Dialog, Field, FormGrid, Select, TextArea, TextInput } from '../../../../../components/mist';
import type { FulfillmentStock } from '../../../../../server/src/shared/mistFulfillment';
import { uiText, ui } from '../../../../../services/interfaceLanguage';

export type PackingRow = { lineId: string; productionId?: string; carton: string; quantity: number; netWeight: number; grossWeight: number; volume: number; note: string };
type Source = { value: string; label: string; lineId: string; productionId?: string };
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Carton range "1–50, 24 pcs each" for garments. Leading zeros and a prefix are kept (C001–C050). */
export function expandCartonRange(input: { from: string; to: string; quantity: number; netWeight: number; grossWeight: number; volume: number }, source: Pick<Source, 'lineId' | 'productionId'>): PackingRow[] {
  const a = /^(.*?)(\d+)$/.exec(input.from.trim()), b = /^(.*?)(\d+)$/.exec(input.to.trim());
  if (!a || !b || a[1] !== b[1]) throw new Error('起止箱号须为同一前缀的数字');
  const start = Number(a[2]), end = Number(b[2]), width = a[2].length;
  if (end < start) throw new Error('结束箱号不能小于开始箱号');
  if (end - start + 1 > 2000) throw new Error('一次最多 2000 箱');
  if (!(input.quantity > 0)) throw new Error('每箱数量须大于零');
  if (!(input.netWeight > 0)) throw new Error('每箱净重须大于零');
  if (input.grossWeight < input.netWeight) throw new Error('毛重不能小于净重');
  return Array.from({ length: end - start + 1 }, (_, i) => ({ ...source, carton: a[1] + String(start + i).padStart(width, '0'), quantity: input.quantity, netWeight: input.netWeight, grossWeight: input.grossWeight, volume: input.volume, note: '' }));
}
/** Fabric packing list: one roll per line, "roll quantity netKg grossKg [m³]". */
export function parseRollPacking(raw: string, source: Pick<Source, 'lineId' | 'productionId'>): PackingRow[] {
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请填写码单');
  const seen = new Set<string>();
  return lines.map((line, i) => {
    const [roll, q, net, gross, vol, ...rest] = line.split(/[\s,，\t]+/);
    const quantity = Number(q), netWeight = Number(net), grossWeight = gross === undefined ? netWeight : Number(gross), volume = vol === undefined ? 0 : Number(vol);
    if (roll && quantity > 0 && net === undefined) throw new Error(`码单第 ${i + 1} 行缺少净重`);
    if (!roll || rest.length || !(quantity > 0) || ![netWeight, grossWeight, volume].every(n => Number.isFinite(n) && n >= 0)) throw new Error(`码单第 ${i + 1} 行格式无效`);
    if (!(netWeight > 0)) throw new Error(`码单第 ${i + 1} 行缺少净重`);
    if (grossWeight < netWeight) throw new Error(`码单第 ${i + 1} 行毛重小于净重`);
    if (seen.has(roll)) throw new Error(`卷号 ${roll} 重复`);
    seen.add(roll);
    return { ...source, carton: roll, quantity, netWeight, grossWeight, volume, note: '' };
  });
}
export const rollsText = (stock: FulfillmentStock) => (stock.rolls || []).map(r => [r.roll, r.quantity, ...(r.weightKg ? [r.weightKg, r.weightKg] : [])].join(' ')).join('\n');

export function PackingRangeDialog({ fabric, sources, lots, unit, onClose, onApply }: { fabric: boolean; sources: Source[]; lots: Array<{ stock: FulfillmentStock; lineId: string; label: string }>; unit: (lineId: string) => string; onClose: () => void; onApply: (rows: PackingRow[], replace: boolean) => void }) {
  const [source, setSource] = React.useState(sources[0]?.value || ''), [replace, setReplace] = React.useState(true), [error, setError] = React.useState('');
  const [range, setRange] = React.useState({ from: '1', to: '', quantity: '', netWeight: '', grossWeight: '', volume: '' }), [rolls, setRolls] = React.useState('');
  const picked = sources.find(s => s.value === source), lotOptions = lots.filter(l => l.lineId === picked?.lineId && l.stock.rolls?.length);
  const apply = () => {
    try {
      if (!picked) throw new Error('请选择条目');
      const target = { lineId: picked.lineId, ...(picked.productionId ? { productionId: picked.productionId } : {}) };
      const rows = fabric ? parseRollPacking(rolls, target) : expandCartonRange({ from: range.from, to: range.to, quantity: Number(range.quantity), netWeight: Number(range.netWeight || 0), grossWeight: Number(range.grossWeight || 0), volume: Number(range.volume || 0) }, target);
      onApply(rows, replace);
    } catch (e) { setError(e instanceof Error ? e.message : '请核对录入'); }
  };
  const count = !fabric && /\d+$/.test(range.to) && /\d+$/.test(range.from) ? Number(/\d+$/.exec(range.to)![0]) - Number(/\d+$/.exec(range.from)![0]) + 1 : 0;
  const set = (key: keyof typeof range) => (e: React.ChangeEvent<HTMLInputElement>) => setRange(v => ({ ...v, [key]: e.target.value }));
  return <Dialog open title={uiText(fabric ? '按码单装箱' : '按箱号段装箱')} width={680} onClose={onClose}
    footer={<>{!fabric && count > 0 && Number(range.quantity) > 0 && <span className="mist-note">{ui`${count} 箱 · 合计 ${r4(count * Number(range.quantity))} ${picked ? unit(picked.lineId) : ''}`}</span>}<span className="mist-spacer" /><Button onClick={onClose}>{uiText('取消')}</Button><Button variant="primary" onClick={apply}>{uiText('生成装箱行')}</Button></>}>
    {error && <Banner tone="bad" title={uiText('未能生成')}>{uiText(error)}</Banner>}
    <FormGrid>
      <Field label={uiText('条目')} required full><Select aria-label={uiText('条目')} value={source} options={sources} onChange={e => setSource(e.target.value)} /></Field>
      {fabric ? <>
        {lotOptions.length > 0 && <Field label={uiText('从库存码单带入')} full><Select aria-label={uiText('从库存码单带入')} value="" options={[{ value: '', label: '请选择' }, ...lotOptions.map(l => ({ value: l.stock.id, label: l.label }))]} onChange={e => { const lot = lotOptions.find(l => l.stock.id === e.target.value); if (lot) setRolls(rollsText(lot.stock)); }} /></Field>}
        <Field label={uiText('码单（卷号 数量 净重 毛重 体积）')} required full><TextArea aria-label={uiText('码单')} rows={8} value={rolls} onChange={e => setRolls(e.target.value)} /></Field>
      </> : <>
        <Field label={uiText('开始箱号')} required><TextInput aria-label={uiText('开始箱号')} value={range.from} onChange={set('from')} /></Field>
        <Field label={uiText('结束箱号')} required><TextInput aria-label={uiText('结束箱号')} value={range.to} onChange={set('to')} /></Field>
        <Field label={uiText(`每箱数量${picked ? `（${unit(picked.lineId)}）` : ''}`)} required><TextInput aria-label={uiText('每箱数量')} type="number" min={0} value={range.quantity} onChange={set('quantity')} /></Field>
        <Field label={uiText('每箱净重 kg')}><TextInput aria-label={uiText('每箱净重')} type="number" min={0} step="0.01" value={range.netWeight} onChange={set('netWeight')} /></Field>
        <Field label={uiText('每箱毛重 kg')}><TextInput aria-label={uiText('每箱毛重')} type="number" min={0} step="0.01" value={range.grossWeight} onChange={set('grossWeight')} /></Field>
        <Field label={uiText('每箱体积 m³')}><TextInput aria-label={uiText('每箱体积')} type="number" min={0} step="0.0001" value={range.volume} onChange={set('volume')} /></Field>
      </>}
    </FormGrid>
    <div style={{ marginTop: 12 }}><Checkbox label={uiText('替换当前装箱行')} checked={replace} onChange={setReplace} /></div>
  </Dialog>;
}
