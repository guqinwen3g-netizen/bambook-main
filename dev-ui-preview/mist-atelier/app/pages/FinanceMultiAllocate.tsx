/**
 * One receipt over several invoices (fin11), including invoices in another currency (fin12). Amounts are entered in each
 * invoice's currency; for another currency the agreed rate (invoice currency per 1 receipt currency) and its evidence are
 * required, and the receipt is reduced by amount ÷ rate. The server re-checks every line and refuses the whole batch on error.
 */
import React from 'react';
import { Banner, Button, DataTable, Dialog, Field, TextInput, type Column } from '../../../../components/mist';
import type { MistCommand, MistInvoice, MistReceipt } from '../../../../server/src/shared/mistWorkspace';
import { isRecognizedMistInvoice } from '../../../../server/src/shared/mistWorkspace';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import { fmt } from '../data';

type Line = { invoiceId: string; amount: string; rate: string };
const cents = (v: string) => /^\d{1,12}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : NaN;

export function FinanceMultiAllocate({ receipt, invoices, busy, onClose, onSubmit }: { receipt: MistReceipt; invoices: MistInvoice[]; busy: boolean; onClose: () => void; onSubmit: (command: MistCommand) => void }) {
  const open = invoices.filter(i => isRecognizedMistInvoice(i) && i.open > 0).sort((a, b) => (a.currency === receipt.currency ? 0 : 1) - (b.currency === receipt.currency ? 0 : 1) || (a.due || '').localeCompare(b.due || ''));
  const [lines, setLines] = React.useState<Record<string, Line>>({}), [rateBasis, setRateBasis] = React.useState(''), [error, setError] = React.useState('');
  const set = (id: string, patch: Partial<Line>) => setLines(all => ({ ...all, [id]: { invoiceId: id, amount: all[id]?.amount ?? '', rate: all[id]?.rate ?? '', ...patch } }));
  const chosen = Object.values(lines).filter(l => l.amount.trim());
  const receiptUse = chosen.reduce((n, l) => { const inv = open.find(i => i.id === l.invoiceId)!, c = cents(l.amount); return n + (inv.currency === receipt.currency ? c : Math.round(c / Number(l.rate || NaN))); }, 0);
  const cross = chosen.some(l => open.find(i => i.id === l.invoiceId)?.currency !== receipt.currency);
  const left = Math.round(receipt.remaining * 100) - receiptUse;
  const submit = () => {
    setError('');
    for (const l of chosen) { const inv = open.find(i => i.id === l.invoiceId)!; if (!(cents(l.amount) > 0) || cents(l.amount) > Math.round(inv.open * 100)) return setError(`${inv.code} 金额无效或超过未收`); if (inv.currency !== receipt.currency && !(Number(l.rate) > 0)) return setError(`${inv.code} 请填写汇率`); }
    if (!chosen.length) return setError('请至少填写一张发票的核销金额');
    if (!(left >= 0)) return setError('合计超过到账未分配余额');
    if (cross && !rateBasis.trim()) return setError('请填写汇率依据');
    onSubmit({ type: 'finance.reconcile', payload: { receiptId: receipt.id, lines: chosen.map(l => ({ invoiceId: l.invoiceId, amount: cents(l.amount) / 100, ...(open.find(i => i.id === l.invoiceId)!.currency !== receipt.currency ? { rate: l.rate.trim() } : {}) })), ...(cross ? { rateBasis: rateBasis.trim() } : {}) } });
  };
  const columns: Column<MistInvoice>[] = [
    { key: 'code', header: '发票', render: i => <div className="mist-col" style={{ gap: 2 }}><b>{i.code}</b><small className="mist-muted">{i.customer} · {i.due}</small></div> },
    { key: 'open', header: '未收', align: 'right', render: i => `${fmt(i.open, 2)} ${i.currency}` },
    { key: 'amount', header: '本次核销', align: 'right', render: i => <TextInput aria-label={ui`${i.code} 核销金额`} type="number" min="0" step="0.01" value={lines[i.id]?.amount ?? ''} disabled={busy} onChange={e => set(i.id, { amount: e.target.value })} /> },
    { key: 'rate', header: `汇率（1 ${receipt.currency} =）`, align: 'right', render: i => i.currency === receipt.currency ? <span className="mist-muted">—</span> : <TextInput aria-label={ui`${i.code} 核销汇率`} type="number" min="0" step="0.000001" value={lines[i.id]?.rate ?? ''} disabled={busy} onChange={e => set(i.id, { rate: e.target.value })} /> },
  ];
  return <Dialog open title={ui`核销到多张发票 · ${receipt.code}`} width={880} onClose={() => { if (!busy) onClose(); }}
    footer={<><span className="mist-note">{ui`到账未分配 ${fmt(receipt.remaining, 2)} → ${fmt(Math.max(0, left) / 100, 2)} ${receipt.currency}`}</span><span className="mist-spacer" /><Button disabled={busy} onClick={onClose}>{uiText('取消')}</Button><Button variant="primary" loading={busy} disabled={busy || !chosen.length} onClick={submit}>{uiText(`核销 ${chosen.length} 张`)}</Button></>}>
    {error && <Banner tone="bad" title={uiText('未能核销')}>{uiText(error)}</Banner>}
    <DataTable ariaLabel={uiText('待核销发票')} rows={open} rowKey={i => i.id} columns={columns} density="comfy" />
    {cross && <Field label={uiText('汇率依据')} required full><TextInput aria-label={uiText('汇率依据')} value={rateBasis} disabled={busy} onChange={e => setRateBasis(e.target.value)} placeholder={uiText('银行水单或客户确认的折算')} /></Field>}
  </Dialog>;
}
