import React from 'react';
import { uiText } from '../../../../services/interfaceLanguage';
import { Banner, Button, Card, CardHeader, Checkbox, Dialog, Field, FormGrid, Mono, Pill, Select, TextArea, TextInput, TextLink } from '../../../../components/mist';
import { developmentCharged, developmentInitiator } from '../../../../server/src/shared/mistDevelopmentDomain';
import { developmentBillingInvoices, developmentBillingStage, developmentFeeSummary, developmentSamplesOf, makingFeeBlocker, unbilledDevelopmentCharges } from '../../../../server/src/shared/mistDevelopmentBilling';
import { isActiveMistInvoice, type MistCommand, type MistDev, type MistState } from '../../../../server/src/shared/mistWorkspace';
import { useNav } from '../nav';
import { useOptionalMistSession } from '../runtime/auth';
import { DraftFiles, today } from './modules/fulfillmentKit';
import { RecordDisclosure } from './modules/pageKit';
import { OptionInput } from './OptionInput';
import { CURRENCIES } from '../runtime/tradeOptions';

type Props = { state: MistState; dev: MistDev; disabled?: boolean; run: (command: MistCommand) => Promise<unknown> };
type Action = 'making' | 'expense' | 'charge' | 'invoice' | 'withdraw' | 'void';
const money = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;
export function DevBillingCard({ state, dev, disabled, run }: Props) {
  const { go } = useNav(), session = useOptionalMistSession();
  const [action, setAction] = React.useState<Action | null>(null), [selected, setSelected] = React.useState<string[]>([]);
  const [form, setForm] = React.useState({ sampleId: '', version: '*', amount: '', currency: 'USD', description: '', evidence: '', date: today(), number: '' });
  const [voidId, setVoidId] = React.useState('');
  const [fileIds, setFileIds] = React.useState<string[]>([]), [uploading, setUploading] = React.useState(false), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  const lock = React.useRef(false), live = React.useRef(true);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  React.useEffect(() => { setAction(null); setSelected([]); setFailure(''); }, [dev.id]);
  const canWrite = !!session?.hasPermission('products:write'), blocked = !!disabled || busy || uploading;
  const charged = developmentCharged(dev.values) && developmentInitiator(dev.values) !== 'internal';
  const summary = developmentFeeSummary(state, dev), invoices = developmentBillingInvoices(state, dev), stage = developmentBillingStage(state, dev);
  const available = unbilledDevelopmentCharges(state, dev), chosen = available.filter(row => selected.includes(row.id));
  const samples = developmentSamplesOf(state, dev), unrecorded = samples.filter(row => !makingFeeBlocker(state, dev, row.id));
  const update = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const open = (kind: Action, sampleId = unrecorded[0]?.id || '') => {
    const year = today().slice(0, 4), prefix = `DI-${year}-`;
    const next = state.invoices.filter(row => row.code.startsWith(prefix)).reduce((n, row) => Math.max(n, Number(row.code.slice(prefix.length)) || 0), 0) + 1;
    setForm({ sampleId, version: '*', amount: '', currency: kind === 'charge' ? 'USD' : 'CNY', description: '', evidence: '', date: today(), number: prefix + String(next).padStart(4, '0') });
    setFileIds([]); setFailure(''); setAction(kind);
  };
  const amountValid = /^\d{1,12}(\.\d{1,2})?$/.test(form.amount) && Number(form.amount) > 0 && /^[A-Za-z]{3}$/.test(form.currency);
  const mixed = new Set(chosen.map(row => row.currency)).size > 1;
  const valid = action === 'invoice' ? chosen.length > 0 && !mixed && !!form.date && !!form.number.trim() && fileIds.length > 0
    : action === 'withdraw' || action === 'void' ? !!form.evidence.trim()
    : amountValid && (action === 'making' ? !!form.sampleId : !!form.description.trim() && (action !== 'charge' || !!form.evidence.trim()));
  const submit = async () => {
    if (blocked || !canWrite || !valid || lock.current) return;
    let command: MistCommand;
    if (action === 'making') command = { type: 'development.fee.recordMaking', payload: { devId: dev.id, sampleId: form.sampleId, amount: Number(form.amount), currency: form.currency.toUpperCase() } };
    else if (action === 'expense') command = { type: 'development.expense.add', payload: { devId: dev.id, amount: Number(form.amount), currency: form.currency.toUpperCase(), description: form.description, date: form.date, ...(form.version !== '*' ? { versionId: form.version } : {}) } };
    else if (action === 'charge') command = { type: 'development.charge.add', payload: { devId: dev.id, versionIds: form.version === '*' ? [...dev.versionIds] : [form.version], description: form.description, amount: Number(form.amount), currency: form.currency.toUpperCase(), evidence: form.evidence } };
    else if (action === 'invoice') command = { type: 'development.billing.issue', payload: { devId: dev.id, chargeIds: chosen.map(row => row.id), number: form.number.trim(), due: form.date, fileIds } };
    else if (action === 'void') command = { type: 'development.charge.void', payload: { devId: dev.id, chargeId: voidId, reason: form.evidence } };
    else command = { type: 'development.billing.withdraw', payload: { devId: dev.id, reason: form.evidence } };
    lock.current = true; setBusy(true); setFailure('');
    try { await run(command); if (live.current) { setAction(null); if (action === 'invoice') setSelected([]); } }
    catch (error) { if (live.current) setFailure(error instanceof Error ? error.message : '未能保存'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const title = action === 'making' ? '登记制作费' : action === 'expense' ? '添加额外费用' : action === 'charge' ? '添加客户收费' : action === 'invoice' ? '开具开发发票' : action === 'void' ? '作废收费项' : '撤回原费用申请';
  const versionOptions = [{ value: '*', label: '整案' }, ...dev.versionIds.flatMap(id => { const v = state.versions.find(row => row.id === id); return v ? [{ value: id, label: v.label }] : []; })];
  return <Card><CardHeader title={uiText('开发费用')} tools={stage ? <Pill tone={stage.tone}>{uiText(stage.label)}</Pill> : <Pill>{uiText('不向客户收费')}</Pill>} />
    <div className="mist-card-body mist-col">
      {failure && !action && <Banner tone="bad" title={uiText('未能保存')}>{failure}</Banner>}
      {dev.billing?.request?.state === 'pending' && <Banner tone="warn" title={uiText('原申请需重新核对收费')} actions={canWrite ? <Button disabled={blocked} onClick={() => open('withdraw')}>{uiText('撤回原申请')}</Button> : undefined} />}
      {charged && <><div className="mist-row"><b>{uiText('客户收费')}</b><span className="mist-spacer" />{canWrite && <Button disabled={blocked} onClick={() => open('charge')}>{uiText('添加收费项')}</Button>}</div>
        {(dev.billing?.charges || []).filter(row => !row.voided).map(row => { const unbilled = available.some(item => item.id === row.id); return <div className="mist-row" key={row.id}>
          {canWrite && unbilled ? <Checkbox label={row.description} checked={selected.includes(row.id)} disabled={blocked} onChange={checked => setSelected(ids => checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} /> : <span>{row.description}</span>}
          <span className="mist-spacer" /><span>{money(row.amount, row.currency)}</span><Pill>{uiText(unbilled ? '未开票' : '已开票')}</Pill>{canWrite && unbilled && <Button size="sm" variant="quiet" disabled={blocked} onClick={() => { setVoidId(row.id); open('void'); }}>{uiText('作废')}</Button>}
        </div>; })}
        {!(dev.billing?.charges || []).length && <span className="mist-note">{uiText('暂无收费项')}</span>}
        {canWrite && <Button variant="primary" disabled={blocked || !chosen.length || dev.billing?.request?.state === 'pending'} onClick={() => open('invoice')}>{uiText('开具发票')}</Button>}
      </>}
      {invoices.map(invoice => <div className="mist-row" key={invoice.id}><TextLink onClick={() => go('invoices', invoice.id)}><Mono>{invoice.code}</Mono></TextLink><span>{money(invoice.amount, invoice.currency)}</span><Pill tone={invoice.voidedAt ? 'bad' : invoice.financeStatus === 'pending' ? 'warn' : invoice.open > 0 ? 'accent' : 'ok'}>{uiText(!isActiveMistInvoice(invoice) ? '已作废' : invoice.financeStatus === 'pending' ? '待财务确认' : invoice.open > 0 ? '待收款' : '已结清')}</Pill></div>)}
      <RecordDisclosure title="本案支出">
        {summary.totals.map(row => <p key={row.currency}>{money(row.amount, row.currency)}</p>)}
        {samples.map(sample => { const fee = dev.billing?.makingFees.find(row => row.sampleId === sample.id); return <div className="mist-row" key={sample.id}><span>{sample.form} <Mono>{sample.code}</Mono></span><span className="mist-spacer" />{fee ? money(fee.amount, fee.currency) : canWrite && <Button size="sm" disabled={blocked} onClick={() => open('making', sample.id)}>{uiText('登记制作费')}</Button>}</div>; })}
        {summary.lines.filter(row => row.kind !== 'making').map(row => <p key={row.refId}>{row.versionLabel} · {row.label} · {money(row.amount, row.currency)}</p>)}
        {canWrite && <Button disabled={blocked} onClick={() => open('expense')}>{uiText('添加额外费用')}</Button>}
      </RecordDisclosure>
    </div>
    <Dialog open={!!action} title={uiText(title)} onClose={() => { if (!blocked) setAction(null); }} footer={<><Button disabled={blocked} onClick={() => setAction(null)}>{uiText('取消')}</Button><Button variant="primary" disabled={blocked || !valid || !canWrite} loading={busy} onClick={() => void submit()}>{uiText(action === 'invoice' ? '确认开票' : action === 'withdraw' ? '确认撤回' : action === 'void' ? '确认作废' : '保存')}</Button></>}>
      {failure && <Banner tone="bad" title={uiText('未能保存')}>{failure}</Banner>}
      <FormGrid>
        {action === 'making' && <Field label={uiText('实物')} required><Select aria-label={uiText('实物')} value={form.sampleId} options={unrecorded.map(row => ({ value: row.id, label: `${row.form} ${row.code}` }))} onChange={e => update('sampleId', e.target.value)} /></Field>}
        {(action === 'charge' || action === 'expense') && <><Field label={uiText('范围')}><Select aria-label={uiText('范围')} value={form.version} options={versionOptions} onChange={e => update('version', e.target.value)} /></Field><Field label={uiText(action === 'charge' ? '收费内容' : '费用说明')} required><TextInput aria-label={uiText(action === 'charge' ? '收费内容' : '费用说明')} value={form.description} onChange={e => update('description', e.target.value)} /></Field></>}
        {(action === 'making' || action === 'expense' || action === 'charge') && <><Field label={uiText('金额')} required><TextInput aria-label={uiText('金额')} inputMode="decimal" value={form.amount} onChange={e => update('amount', e.target.value)} /></Field><Field label={uiText('币种')} required><OptionInput ariaLabel="币种" strict options={CURRENCIES} value={form.currency} onChange={value => update('currency', value)} /></Field></>}
        {(action === 'charge' || action === 'withdraw' || action === 'void') && <Field label={uiText(action === 'charge' ? '收费约定依据' : action === 'void' ? '作废原因' : '撤回原因')} required full><TextArea aria-label={uiText(action === 'charge' ? '收费约定依据' : action === 'void' ? '作废原因' : '撤回原因')} value={form.evidence} onChange={e => update('evidence', e.target.value)} /></Field>}
        {action === 'invoice' && <><Field label={uiText('发票编号')} required><TextInput aria-label={uiText('发票编号')} value={form.number} onChange={e => update('number', e.target.value)} /></Field><Field label={uiText('到期日')} required><TextInput aria-label={uiText('到期日')} type="date" value={form.date} onChange={e => update('date', e.target.value)} /></Field>{mixed && <Banner tone="warn" title={uiText('不同币种须分别开票')} />}<Field label={uiText('发票原件')} required full><DraftFiles ids={fileIds} onChange={setFileIds} onBusyChange={setUploading} disabled={busy || !!disabled} hint="上传开发发票" /></Field></>}
        {action === 'expense' && <Field label={uiText('费用日期')} required><TextInput aria-label={uiText('费用日期')} type="date" value={form.date} onChange={e => update('date', e.target.value)} /></Field>}
      </FormGrid>
    </Dialog>
  </Card>;
}
