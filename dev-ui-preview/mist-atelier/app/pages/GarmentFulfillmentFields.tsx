import React from 'react';
import { Checkbox, Field, Select } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { CMT_INCLUDED_ITEM_LABELS, GARMENT_FULFILLMENT_LABELS, type CmtIncludedItem, type GarmentFulfillmentFields as FulfillmentFields, type GarmentFulfillmentMode } from '../../../../server/src/shared/mistInternalFabric';

export function garmentFulfillmentLabel(value: FulfillmentFields): string {
  return value.fulfillmentMode ? GARMENT_FULFILLMENT_LABELS[value.fulfillmentMode] : '待选择';
}
export function cmtIncludedLabel(value: FulfillmentFields): string {
  return value.cmtIncludedItems === undefined ? '待确认' : value.cmtIncludedItems.length ? value.cmtIncludedItems.map(item => CMT_INCLUDED_ITEM_LABELS[item]).join('、') : '无';
}
export function GarmentFulfillmentFields({ value, onChange, disabled = false }: { value: FulfillmentFields; onChange: (value: FulfillmentFields) => void; disabled?: boolean }) {
  return <>
    <Field label={uiText('履约模式')} required><Select aria-label={uiText('履约模式')} value={value.fulfillmentMode || ''} placeholder={uiText('选择履约模式')} disabled={disabled} onChange={event => onChange({ fulfillmentMode: event.target.value as GarmentFulfillmentMode, cmtIncludedItems: value.cmtIncludedItems || [] })} options={Object.entries(GARMENT_FULFILLMENT_LABELS).map(([value, label]) => ({ value, label: uiText(label) }))} /></Field>
    {value.fulfillmentMode && <div className="mist-field" role="group" aria-label={uiText('CMT 包含')}><span className="mist-field-label">{uiText('CMT 包含')}</span><div className="mist-row" style={{ gap: 16, flexWrap: 'wrap' }}>{(Object.keys(CMT_INCLUDED_ITEM_LABELS) as CmtIncludedItem[]).map(item => <Checkbox key={item} label={uiText(CMT_INCLUDED_ITEM_LABELS[item])} checked={value.cmtIncludedItems?.includes(item) || false} disabled={disabled} onChange={checked => onChange({ ...value, cmtIncludedItems: checked ? [...(value.cmtIncludedItems || []), item] : (value.cmtIncludedItems || []).filter(current => current !== item) })} />)}</div></div>}
  </>;
}
