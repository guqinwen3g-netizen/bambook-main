import React from 'react';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import { Select, TextArea, TextInput } from '../../../../components/mist';
import { DISCHARGE_PORTS, INCOTERMS, LOADING_PORTS, joinIncoterm, splitIncoterm, withCurrent, type TradeOption } from '../runtime/tradeOptions';

const CUSTOM = '__custom__';
type Props = { value: string; onChange: (value: string) => void; options: TradeOption[]; ariaLabel: string; strict?: boolean; disabled?: boolean; readOnly?: boolean; placeholder?: string; multiline?: boolean };

/** 常用选项下拉；非 strict 时末项「其他（手动填写）」展开输入框。列表外的已有值保留显示，不会被清空。 */
export function OptionInput({ value, onChange, options, ariaLabel, strict = false, disabled, readOnly, placeholder = '请选择', multiline }: Props) {
  const current = value ?? '', known = options.some(option => option.value === current);
  const [typing, setTyping] = React.useState(!strict && !!current && !known);
  React.useEffect(() => { if (known) setTyping(false); else if (!strict && current) setTyping(true); }, [known, current, strict]);
  const locked = disabled || readOnly;
  const list = strict ? withCurrent(options, current) : [...options, { value: CUSTOM, label: '其他（手动填写）' }];
  return <span className="mist-col" style={{ gap: 6 }}>
    <Select aria-label={uiText(ariaLabel)} placeholder={uiText(placeholder)} disabled={locked} options={list}
      value={typing ? CUSTOM : known || strict ? current : ''}
      onChange={event => {
        if (event.target.value === CUSTOM) { setTyping(true); onChange(known ? '' : current); return; }
        setTyping(false); onChange(event.target.value);
      }} />
    {typing && (multiline
      ? <TextArea aria-label={ui`${ariaLabel}（手动填写）`} value={current} disabled={disabled} readOnly={readOnly} onChange={event => onChange(event.target.value)} />
      : <TextInput aria-label={ui`${ariaLabel}（手动填写）`} value={current} disabled={disabled} readOnly={readOnly} onChange={event => onChange(event.target.value)} />)}
  </span>;
}

const DESTINATION_TERMS = new Set(['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
/** 指定地点的常用值随术语变化：C/D 组列目的港，F 组列起运港，EXW 由用户填写。 */
export const incotermPlaces = (code: string): TradeOption[] => code === 'EXW' || !code ? [] : DESTINATION_TERMS.has(code) ? DISCHARGE_PORTS : LOADING_PORTS;

/** 「贸易术语 + 指定地点」写成一段文本（如 FOB 上海）的字段。 */
export function IncotermPlaceInput({ value, onChange, ariaLabel = '贸易术语', disabled }: { value: string; onChange: (value: string) => void; ariaLabel?: string; disabled?: boolean }) {
  const { code, place } = splitIncoterm(value ?? ''), places = incotermPlaces(code);
  return <span className="mist-col" style={{ gap: 6 }}>
    <Select aria-label={uiText(ariaLabel)} placeholder={uiText('请选择')} disabled={disabled} options={INCOTERMS} value={code}
      onChange={event => onChange(joinIncoterm(event.target.value, place))} />
    {places.length
      ? <OptionInput ariaLabel={ui`${ariaLabel}指定地点`} placeholder="指定地点" options={places} value={place} disabled={disabled} onChange={next => onChange(joinIncoterm(code, next))} />
      : <TextInput aria-label={ui`${ariaLabel}指定地点`} placeholder={uiText('指定地点')} value={place} disabled={disabled} onChange={event => onChange(joinIncoterm(code, event.target.value))} />}
  </span>;
}
