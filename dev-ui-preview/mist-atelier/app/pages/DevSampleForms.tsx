import {SAMPLE_SEND_PURPOSES,type SampleSendPurpose} from '../../../../server/src/shared/mistSampleSending';
import { uiText, ui } from '../../../../services/interfaceLanguage';
/** BB-DEV-6 / BB-DEV-8：本版实物形态（同一样品仓库档案多行余额）与从本版准确实物寄样。 */
import React from 'react';
import { PackagePlus, Send } from 'lucide-react';
import { Banner, Button, Card, CardFooter, CardHeader, DataTable, Dialog, EmptyState, Field, FormGrid, Mono, Select, TextInput, TextLink, useToast } from '../../../../components/mist';
import { validFabricSample, developmentDomain } from '../../../../server/src/shared/mistDevelopmentDomain';
import { developmentVersionSamples, sampleDispatchBlocker, sampleFormBlocker, type MistSampleDispatch } from '../../../../server/src/shared/mistDevelopmentSamples';
import { fulfillmentPositions } from '../../../../server/src/shared/mistFulfillment';
import type { MistCommand, MistDev, MistState, MistVersion } from '../../../../server/src/shared/mistWorkspace';

type Props = { state: MistState; dev: MistDev; version: MistVersion; disabled?: boolean; run: (command: MistCommand) => Promise<unknown> };
const FORMS = ['色样', '手织样', '米样', '剪样', '布样'];
const emptyForm = () => ({ form: '米样', quantity: '', unit: '米', location: '', color: '' });
const emptyDispatch = () => ({ purpose:'confirmation' as SampleSendPurpose,sampleId: '', sourceLocation: '__choose__', quantity: '', recipient: '', trackingNo: '', feeAmount: '', feeCurrency: 'CNY', note: '' });
/** 寄样表单的前端校验（服务端仍按可用余额复核）；通过时返回 null。 */
export function dispatchFormError(sample: { unit: string; available: number } | undefined, value: { quantity: string; recipient: string; feeAmount: string; feeCurrency: string }): string | null {
  if (!sample) return '请选择本版的准确实物';
  const quantity = Number(value.quantity);
  if (!value.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) return '请填写寄出数量';
  if (sample.unit !== '米' && !Number.isInteger(quantity)) return '按份/件的实物须整数寄出';
  if (quantity > sample.available) return `寄出数量超过可用余额 ${sample.available} ${sample.unit}`;
  if (!value.recipient.trim()) return '请填写收件方';
  if (value.feeAmount.trim() && (!/^\d{1,12}(\.\d{1,2})?$/.test(value.feeAmount.trim()) || !/^[A-Za-z]{3}$/.test(value.feeCurrency.trim()))) return '寄样费须为最多两位小数的金额和三位币种代码';
  return null;
}

export function DevSampleFormsCard({ state, dev, version, disabled, run }: Props) {
  const toast = useToast();
  const fabric = developmentDomain(dev.values) === 'fabric';
  const samples = developmentVersionSamples(state, version);
  const dispatches = version.dispatches || [];
  const formBlocker = fabric ? sampleFormBlocker(state, dev, version) : null;
  const dispatchBlocker = sampleDispatchBlocker(state, dev, version,'other');
  const [dialog, setDialog] = React.useState<'form' | 'dispatch' | 'fee' | null>(null), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  const [form, setForm] = React.useState(emptyForm), [dispatch, setDispatch] = React.useState(emptyDispatch), [fee, setFee] = React.useState<{ row: MistSampleDispatch | null; amount: string; currency: string }>({ row: null, amount: '', currency: 'CNY' });
  React.useEffect(() => { setDialog(null); setFailure(''); }, [version.id]);
  const picked = samples.find(sample => sample.id === dispatch.sampleId);
  const positions = picked ? fulfillmentPositions(picked) : [];
  const position = positions.find(item => item.location === dispatch.sourceLocation);
  const qualityBlocker=sampleDispatchBlocker(state,dev,version,dispatch.purpose,dispatch.sampleId);
  const dispatchError = dispatchFormError(picked, dispatch) || (positions.length > 1
    ? !position ? '请选择本次实际出库位置' : Number(dispatch.quantity) > position.available ? `所选位置可用数量不足：${position.available} ${picked!.unit}` : null
    : null)||qualityBlocker||(dispatch.purpose!=='confirmation'&&!dispatch.note.trim()?'请填写本次寄送用途说明':null);
  const formError = !validFabricSample(Number(form.quantity), form.form, form.unit) ? '请填写形态、数量和单位：米样按米，其他形态按整数份' : null;
  const submit = async (kind: 'form' | 'dispatch' | 'fee') => {
    if (busy) return; setBusy(true); setFailure('');
    try {
      if (kind === 'form') {
        if (formError) throw Error(formError);
        await run({ type: 'development.version.addSampleForm', payload: { devId: dev.id, versionId: version.id, form: form.form.trim(), quantity: Number(form.quantity), unit: form.unit.trim(), location: form.location, color: form.color } });
        toast(`已追加 ${form.form} ${form.quantity} ${form.unit}，样品仓库同一档案新增一行`);
      } else if (kind === 'dispatch') {
        if (dispatchError) throw Error(dispatchError);
        await run({ type: 'development.sample.dispatch', payload: { devId: dev.id, versionId: version.id, purpose:dispatch.purpose,sampleId: dispatch.sampleId, quantity: Number(dispatch.quantity), recipient: dispatch.recipient, trackingNo: dispatch.trackingNo, note: dispatch.note, fee: dispatch.feeAmount.trim() ? { amount: Number(dispatch.feeAmount), currency: dispatch.feeCurrency.trim().toUpperCase() } : null, ...(positions.length > 1 ? { sourceLocation: dispatch.sourceLocation } : {}) } });
        toast(`已寄出 ${dispatch.quantity} ${picked!.unit}，样品仓库已出库并扣减余额`);
      } else {
        if (!fee.row || !/^\d{1,12}(\.\d{1,2})?$/.test(fee.amount.trim()) || !/^[A-Za-z]{3}$/.test(fee.currency.trim())) throw Error('请填写最多两位小数的金额和三位币种代码');
        await run({ type: 'development.sample.dispatchFee', payload: { devId: dev.id, versionId: version.id, dispatchId: fee.row.id, fee: { amount: Number(fee.amount), currency: fee.currency.trim().toUpperCase() } } });
        toast('已补登寄样费');
      }
      setDialog(null);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : '操作失败，原内容已保留'); } finally { setBusy(false); }
  };
  const off = disabled || busy;
  return <Card id="mist-dev-physical">
    <CardHeader title={uiText("本版实物与寄样")} />
    {samples.length ? <DataTable ariaLabel={uiText("本版实物")} rows={samples} rowKey={sample => sample.id} density="compact" columns={[
      { key: 'form', header: '形态', render: sample => sample.form },
      { key: 'code', header: '样品编号', render: sample => <Mono>{sample.code}</Mono> },
      { key: 'balance', header: '可用 / 入库', align: 'right', render: sample => `${sample.available} / ${sample.quantity} ${sample.unit}` },
      { key: 'location', header: '位置', render: sample => sample.location || '—' },
    ]} /> : <EmptyState compact title={uiText("本版尚无入库实物")} />}
    {!!dispatches.length && <div className="mist-section"><CardHeader title={uiText("寄样记录")} />
      <DataTable ariaLabel={uiText("寄样记录")} rows={dispatches.slice().reverse()} rowKey={row => row.id} density="compact" columns={[
        { key: 'sample', header: '实物', render: row => <>{row.form} <Mono>{row.sampleCode}</Mono></> },
        { key: 'quantity', header: '数量', align: 'right', render: row => `${row.quantity} ${row.unit}` },
        {key:'purpose',header:'用途',render:row=>row.purpose?uiText(SAMPLE_SEND_PURPOSES[row.purpose]):uiText('未注明')},
        { key: 'recipient', header: '收件方', render: row => row.recipient },
        { key: 'tracking', header: '运单号', render: row => row.trackingNo || '—' },
        { key: 'fee', header: '寄样费', render: row => row.fee ? `${row.fee.amount} ${row.fee.currency}` : <TextLink disabled={off} onClick={() => { setFailure(''); setFee({ row, amount: '', currency: 'CNY' }); setDialog('fee'); }}>{uiText("补登费用")}</TextLink> },
      ]} /></div>}
    <CardFooter>
      {(dispatchBlocker || formBlocker) && <span className="mist-note">{dispatchBlocker || formBlocker}</span>}<span className="mist-spacer" />
      {fabric && <Button size="sm" icon={PackagePlus} disabled={off || !!formBlocker} title={uiText(formBlocker || undefined)} onClick={() => { setForm(emptyForm()); setFailure(''); setDialog('form'); }}>{uiText("追加形态")}</Button>}
      <Button size="sm" icon={Send} disabled={off || !!dispatchBlocker} title={uiText(dispatchBlocker || undefined)} onClick={() => { setDispatch({ ...emptyDispatch(), sampleId: samples.find(sample => sample.available > 0)?.id || '' }); setFailure(''); setDialog('dispatch'); }}>{uiText("寄样")}</Button>
    </CardFooter>
    <Dialog open={dialog === 'form'} onClose={() => !busy && setDialog(null)} title={ui`为 ${version.label} 追加实物形态`} footer={<><Button variant="quiet" disabled={busy} onClick={() => setDialog(null)}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={!!formError} onClick={() => void submit('form')}>{uiText("保存形态")}</Button></>}>
      {failure && dialog === 'form' && <Banner tone="bad" title={uiText("形态尚未保存")}>{uiText(failure)}</Banner>}
      <FormGrid>
        <Field label={uiText("实物形态")} required><Select value={FORMS.includes(form.form) ? form.form : ''} options={FORMS} onChange={event => { const value = event.target.value; setForm(previous => ({ ...previous, form: value, unit: value === '米样' ? '米' : '份' })); }} /></Field>
        <Field label={ui`数量（${form.unit}）`} required hint={uiText(form.unit === '米' ? '米样按米，可含小数' : '按整数份')}><TextInput type="number" min={form.unit === '米' ? '0.01' : '1'} step={form.unit === '米' ? 'any' : '1'} value={form.quantity} onChange={event => setForm(previous => ({ ...previous, quantity: event.target.value }))} /></Field>
        <Field label={uiText("存放位置")}><TextInput value={form.location} onChange={event => setForm(previous => ({ ...previous, location: event.target.value }))} /></Field>
        <Field label={uiText("颜色")}><TextInput value={form.color} placeholder={uiText(version.sampleColor || dev.values.color || '')} onChange={event => setForm(previous => ({ ...previous, color: event.target.value }))} /></Field>
      </FormGrid>
    </Dialog>
    <Dialog open={dialog === 'dispatch'} onClose={() => !busy && setDialog(null)} title={ui`从 ${version.label} 寄样`} description={uiText("确认后扣减库存")} footer={<><Button variant="quiet" disabled={busy} onClick={() => setDialog(null)}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={!!dispatchError} onClick={() => void submit('dispatch')}>{uiText("确认寄出")}</Button></>}>
      {qualityBlocker&&dialog==='dispatch'&&<Banner tone="warn" title={uiText(qualityBlocker)}/>}
      {failure && dialog === 'dispatch' && <Banner tone="bad" title={uiText("尚未寄出")}>{uiText(failure)}</Banner>}
      <FormGrid>
        <Field label={uiText('寄送用途')} required><Select aria-label={uiText('寄送用途')} value={dispatch.purpose} options={Object.entries(SAMPLE_SEND_PURPOSES).map(([value,label])=>({value,label}))} onChange={event=>setDispatch(previous=>({...previous,purpose:event.target.value as SampleSendPurpose}))}/></Field>
        <Field label={uiText("寄出实物")} required full><Select value={dispatch.sampleId} placeholder={uiText("选择本版实物")} options={samples.map(sample => ({ value: sample.id, label: `${sample.form} · ${sample.code} · 可用 ${sample.available} ${sample.unit}` }))} onChange={event => { const value = event.target.value; setDispatch(previous => ({ ...previous, sampleId: value, sourceLocation: '__choose__' })); }} /></Field>
        {positions.length > 1 && <Field label={uiText("本次出库位置")} required><Select value={dispatch.sourceLocation} options={[{ value: '__choose__', label: '请选择位置' }, ...positions.map(item => ({ value: item.location, label: `${item.location || '位置未记录'} · 可用 ${item.available} ${picked!.unit}` }))]} onChange={event => { const value = event.target.value; setDispatch(previous => ({ ...previous, sourceLocation: value })); }} /></Field>}
        <Field label={ui`寄出数量${picked ? `（${picked.unit}）` : ''}`} required error={dispatch.quantity && dispatchError?.includes('数量') ? dispatchError : undefined}><TextInput type="number" min="0" step={picked?.unit === '米' ? 'any' : '1'} value={dispatch.quantity} onChange={event => setDispatch(previous => ({ ...previous, quantity: event.target.value }))} /></Field>
        <Field label={uiText("收件方")} required><TextInput value={dispatch.recipient} onChange={event => setDispatch(previous => ({ ...previous, recipient: event.target.value }))} placeholder={uiText("客户 / 联系人")} /></Field>
        <Field label={uiText("运单号")}><TextInput value={dispatch.trackingNo} onChange={event => setDispatch(previous => ({ ...previous, trackingNo: event.target.value }))} /></Field>
        <Field label={uiText("寄样费")} hint={uiText("可留空，之后补登")}><TextInput inputMode="decimal" value={dispatch.feeAmount} onChange={event => setDispatch(previous => ({ ...previous, feeAmount: event.target.value }))} /></Field>
        <Field label={uiText("币种")}><TextInput value={dispatch.feeCurrency} onChange={event => setDispatch(previous => ({ ...previous, feeCurrency: event.target.value }))} /></Field>
        <Field label={uiText("用途说明")} required={dispatch.purpose!=='confirmation'} full><TextInput value={dispatch.note} onChange={event => setDispatch(previous => ({ ...previous, note: event.target.value }))} /></Field>
      </FormGrid>
    </Dialog>
    <Dialog open={dialog === 'fee'} onClose={() => !busy && setDialog(null)} title={uiText("补登寄样费")} description={uiText(fee.row ? `${fee.row.form} ${fee.row.sampleCode} · ${fee.row.quantity} ${fee.row.unit} → ${fee.row.recipient}；只补费用，不改寄出数量。` : undefined)} footer={<><Button variant="quiet" disabled={busy} onClick={() => setDialog(null)}>{uiText("取消")}</Button><Button variant="primary" loading={busy} onClick={() => void submit('fee')}>{uiText("保存费用")}</Button></>}>
      {failure && dialog === 'fee' && <Banner tone="bad" title={uiText("费用尚未保存")}>{uiText(failure)}</Banner>}
      <FormGrid>
        <Field label={uiText("寄样费")} required><TextInput inputMode="decimal" value={fee.amount} onChange={event => setFee(previous => ({ ...previous, amount: event.target.value }))} /></Field>
        <Field label={uiText("币种")} required><TextInput value={fee.currency} onChange={event => setFee(previous => ({ ...previous, currency: event.target.value }))} /></Field>
      </FormGrid>
    </Dialog>
  </Card>;
}
