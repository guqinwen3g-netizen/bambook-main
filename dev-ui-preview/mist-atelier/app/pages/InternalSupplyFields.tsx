import React from 'react';
import { Checkbox, Field, Select, TextInput } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import type { OrderGovernanceInput } from '../../../../server/src/shared/mistOrderGovernance';
import { memberSelectOptions, type MistMemberOption } from '../runtime/members';

export function InternalSupplyFields({ type, value, members, onChange, disabled = false }: { type: 'garment' | 'fabric'; value: OrderGovernanceInput; members: MistMemberOption[]; onChange: (value: OrderGovernanceInput) => void; disabled?: boolean }) {
  if (value.kind !== 'internal') return null;
  return <>
    <Field label={uiText('内部用途')}><TextInput value={value.internalPurpose} disabled={disabled} onChange={event => onChange({ ...value, internalPurpose: event.target.value })} /></Field>
    {type === 'fabric' && <div className="mist-field"><span className="mist-field-label">{uiText('供料用途')}</span><Checkbox label={uiText('供给成衣订单')} checked={!!value.internalSupply} disabled={disabled} onChange={checked => { const { internalSupply: _old, ...rest } = value; onChange(checked ? { ...rest, internalSupply: { group: 'garment', receiverId: '' } } : rest); }} /></div>}
    {type === 'fabric' && value.internalSupply ? <Field label={uiText('成衣接收负责人')} required><Select aria-label={uiText('成衣接收负责人')} value={value.internalSupply.receiverId} placeholder={uiText('选择负责人')} disabled={disabled} options={memberSelectOptions(members, { group: 'garment', current: value.internalSupply.receiverId ? { id: value.internalSupply.receiverId } : undefined })} onChange={event => onChange({ ...value, internalSupply: { group: 'garment', receiverId: event.target.value } })} /></Field> : <Field label={uiText('接收团队 / 负责人')}><TextInput value={value.receiver} disabled={disabled} onChange={event => onChange({ ...value, receiver: event.target.value })} /></Field>}
  </>;
}
