import { interfaceLocale } from '../../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 业务工具 · 本地换算：装箱体积、面料克重、纱线细度与汇率（按财务登记的月末汇率）。只做计算，不写入任何业务记录。 */
import React from 'react';
import { Card, CardHeader, Field, FormGrid, Select, SummaryBar, TextInput } from '../../../../../components/mist';

const fmt = (n: number, digits: number) => new Intl.NumberFormat(interfaceLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const num = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
/** 1 oz = 28.349523125 g；1 yd² = 0.83612736 m²。 */
export const GSM_PER_OZ_YD2 = 28.349523125 / 0.83612736;
export function cartonVolume(l: number, w: number, h: number, cartons: number, grossKg: number | null) {
  const cbm = l * w * h / 1_000_000;
  return { cartonCbm: cbm, totalCbm: cbm * cartons, totalGross: grossKg === null ? null : grossKg * cartons, airChargeableKg: l * w * h / 6000 * cartons };
}

/**
 * fin65：纱线细度互换。以 tex（g/1000 m）为中间单位：
 * 英支 Ne（棉）= 590.5 / tex；公支 Nm = 1000 / tex；旦尼尔 D = 9 × tex。
 */
export const YARN_UNITS = { Ne: { label: '英支 Ne', toTex: (v: number) => 590.5 / v, fromTex: (t: number) => 590.5 / t }, Nm: { label: '公支 Nm', toTex: (v: number) => 1000 / v, fromTex: (t: number) => 1000 / t }, D: { label: '旦尼尔 D', toTex: (v: number) => v / 9, fromTex: (t: number) => t * 9 }, tex: { label: 'tex', toTex: (v: number) => v, fromTex: (t: number) => t } } as const;
type YarnUnit = keyof typeof YARN_UNITS;
type Rate = { currency: string; month: string; rate: string };
export function BusinessCalculators({ rates = [] }: { rates?: Rate[] }) {
  const [yarn, setYarn] = React.useState(''), [yarnUnit, setYarnUnit] = React.useState<YarnUnit>('Ne');
  const [fxAmount, setFxAmount] = React.useState(''), [fxCurrency, setFxCurrency] = React.useState('');
  const latest = [...new Map([...rates].sort((a, b) => a.month.localeCompare(b.month)).map(r => [r.currency, r])).values()];
  const y = num(yarn), tex = y && y > 0 ? YARN_UNITS[yarnUnit].toTex(y) : null;
  const pick = latest.find(r => r.currency === (fxCurrency || latest[0]?.currency)), fa = num(fxAmount);
  const [box, setBox] = React.useState({ l: '', w: '', h: '', cartons: '1', gross: '' });
  const [gsm, setGsm] = React.useState(''), [oz, setOz] = React.useState('');
  const l = num(box.l), w = num(box.w), h = num(box.h), cartons = num(box.cartons), gross = box.gross.trim() ? num(box.gross) : null;
  const ready = l !== null && w !== null && h !== null && cartons !== null && Number.isInteger(cartons) && (box.gross.trim() === '' || gross !== null);
  const v = ready ? cartonVolume(l!, w!, h!, cartons!, gross) : null;
  const g = num(gsm), o = num(oz);
  const set = (key: keyof typeof box) => (e: React.ChangeEvent<HTMLInputElement>) => setBox({ ...box, [key]: e.target.value });
  return <>
    <Card className="mist-col-6"><CardHeader title={uiText("装箱体积")} sub={uiText("外箱尺寸按厘米；结果仅供订舱和报价参考。")} /><div className="mist-card-body">
      <FormGrid cols={3}>
        <Field label={uiText("外箱长 cm")}><TextInput type="number" min={0} value={box.l} onChange={set('l')} /></Field>
        <Field label={uiText("外箱宽 cm")}><TextInput type="number" min={0} value={box.w} onChange={set('w')} /></Field>
        <Field label={uiText("外箱高 cm")}><TextInput type="number" min={0} value={box.h} onChange={set('h')} /></Field>
        <Field label={uiText("箱数")}><TextInput type="number" min={0} step={1} value={box.cartons} onChange={set('cartons')} /></Field>
        <Field label={uiText("单箱毛重 kg")} hint={uiText("可不填")}><TextInput type="number" min={0} value={box.gross} onChange={set('gross')} /></Field>
      </FormGrid>
      <SummaryBar items={v ? [{ label: '单箱体积', value: fmt(v.cartonCbm, 4) + ' m³' }, { label: '总体积', value: fmt(v.totalCbm, 3) + ' m³' }, { label: '总毛重', value: v.totalGross === null ? '—' : fmt(v.totalGross, 2) + ' kg' }, { label: '空运体积重（÷6000）', value: fmt(v.airChargeableKg, 2) + ' kg' }] : [{ label: '结果', value: '填写长宽高与整数箱数' }]} />
    </div></Card>
    <Card className="mist-col-6"><CardHeader title={uiText("面料克重换算")} sub={uiText("g/m² 与 oz/yd² 互换（1 oz/yd² ≈ 33.906 g/m²）。")} /><div className="mist-card-body">
      <FormGrid>
        <Field label={uiText("克重 g/m²")}><TextInput type="number" min={0} value={gsm} onChange={e => { setGsm(e.target.value); const n = num(e.target.value); setOz(n === null ? '' : String(Math.round(n / GSM_PER_OZ_YD2 * 100) / 100)); }} /></Field>
        <Field label={uiText("克重 oz/yd²")}><TextInput type="number" min={0} value={oz} onChange={e => { setOz(e.target.value); const n = num(e.target.value); setGsm(n === null ? '' : String(Math.round(n * GSM_PER_OZ_YD2 * 10) / 10)); }} /></Field>
      </FormGrid>
      <SummaryBar items={[{ label: '换算结果', value: g !== null && o !== null ? `${fmt(g, 1)} g/m² ≈ ${fmt(o, 2)} oz/yd²` : '输入任一克重' }]} />
    </div></Card>
    <Card className="mist-col-6"><CardHeader title={uiText("纱线细度换算")} /><div className="mist-card-body">
      <FormGrid>
        <Field label={uiText("细度")}><TextInput aria-label={uiText("纱线细度")} type="number" min={0} value={yarn} onChange={e => setYarn(e.target.value)} /></Field>
        <Field label={uiText("单位")}><Select aria-label={uiText("纱线细度单位")} value={yarnUnit} options={(Object.keys(YARN_UNITS) as YarnUnit[]).map(k => ({ value: k, label: YARN_UNITS[k].label }))} onChange={e => setYarnUnit(e.target.value as YarnUnit)} /></Field>
      </FormGrid>
      <SummaryBar items={tex ? (Object.keys(YARN_UNITS) as YarnUnit[]).filter(k => k !== yarnUnit).map(k => ({ label: YARN_UNITS[k].label, value: fmt(YARN_UNITS[k].fromTex(tex), k === 'D' ? 0 : 1) })) : [{ label: '结果', value: '输入大于零的细度' }]} />
    </div></Card>
    {latest.length > 0 && <Card className="mist-col-6"><CardHeader title={uiText("汇率换算")} /><div className="mist-card-body">
      <FormGrid>
        <Field label={uiText("金额")}><TextInput aria-label={uiText("外币金额")} type="number" min={0} value={fxAmount} onChange={e => setFxAmount(e.target.value)} /></Field>
        <Field label={uiText("币种")}><Select aria-label={uiText("外币币种")} value={pick?.currency || ''} options={latest.map(r => ({ value: r.currency, label: r.currency }))} onChange={e => setFxCurrency(e.target.value)} /></Field>
      </FormGrid>
      <SummaryBar items={pick && fa !== null ? [{ label: '折人民币', value: fmt(fa * Number(pick.rate), 2) + ' CNY' }, { label: '汇率', value: `${pick.rate}（${pick.month} 月末）` }] : [{ label: '结果', value: '输入金额' }]} />
    </div></Card>}
  </>;
}
