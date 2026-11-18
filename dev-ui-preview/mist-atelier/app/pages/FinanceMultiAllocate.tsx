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
  const available = new Map(open.map(invoice => [invoice.id, invoice]));
  const selected = chosen.flatMap(line => {
    const invoice = available.get(line.invoiceId);
    return invoice ? [{ line, invoice }] : [];
  });
  const hasUnavailable = selected.length !== chosen.length;
  const receiptUse = selected.reduce((sum, { line, invoice }) => {
    const amount = cents(line.amount);
    return sum + (invoice.currency === receipt.currency ? amount : Math.round(amount / Number(line.rate || NaN)));
  }, 0);
  const cross = selected.some(({ invoice }) => invoice.currency !== receipt.currency);
  const left = Math.round(receipt.remaining * 100) - receiptUse;
  const submit = () => {
    if (busy || hasUnavailable) return;
    setError('');
    for (const { line, invoice } of selected) {
      const amount = cents(line.amount);
      if (!(amount > 0) || amount > Math.round(invoice.open * 100)) return setError(`${invoice.code} 金额无效或超过未收`);
      if (invoice.currency !== receipt.currency && !(Number(line.rate) > 0)) return setError(`${invoice.code} 请填写汇率`);
    }
    if (!selected.length) return setError('请至少填写一张发票的核销金额');
    if (!(left >= 0)) return setError('合计超过到账未分配余额');
    if (cross && !rateBasis.trim()) return setError('请填写汇率依据');
    const amounts = selected.map(({ line, invoice }) => ({
      invoiceId: invoice.id, amount: cents(line.amount) / 100,
      ...(invoice.currency === receipt.currency ? {} : { rate: line.rate.trim() }),
    }));
    onSubmit({ type: 'finance.reconcile', payload: { receiptId: receipt.id, lines: amounts, ...(cross ? { rateBasis: rateBasis.trim() } : {}) } });
  };
  const columns: Column<MistInvoice>[] = [
    { key: 'code', header: '发票', render: i => <div className="mist-col" style={{ gap: 2 }}><b>{i.code}</b><small className="mist-muted">{i.customer} · {i.due}</small></div> },
    { key: 'open', header: '未收', align: 'right', render: i => `${fmt(i.open, 2)} ${i.currency}` },
    { key: 'amount', header: '本次核销', align: 'right', render: i => <TextInput aria-label={ui`${i.code} 核销金额`} type="number" min="0" step="0.01" value={lines[i.id]?.amount ?? ''} disabled={busy} onChange={e => set(i.id, { amount: e.target.value })} /> },
    { key: 'rate', header: `汇率（1 ${receipt.currency} =）`, align: 'right', render: i => i.currency === receipt.currency ? <span className="mist-muted">—</span> : <TextInput aria-label={ui`${i.code} 核销汇率`} type="number" min="0" step="0.000001" value={lines[i.id]?.rate ?? ''} disabled={busy} onChange={e => set(i.id, { rate: e.target.value })} /> },
  ];
  return <Dialog open title={ui`核销到多张发票 · ${receipt.code}`} width={880} onClose={() => { if (!busy) onClose(); }}
    footer={<><span className="mist-note">{hasUnavailable || !Number.isFinite(left) ? <>{uiText('到账未分配')} {fmt(receipt.remaining, 2)} {receipt.currency}</> : ui`到账未分配 ${fmt(receipt.remaining, 2)} → ${fmt(Math.max(0, left) / 100, 2)} ${receipt.currency}`}</span><span className="mist-spacer" /><Button disabled={busy} onClick={onClose}>{uiText('取消')}</Button><Button variant="primary" loading={busy} disabled={busy || hasUnavailable || !chosen.length} onClick={submit}>{uiText(`核销 ${chosen.length} 张`)}</Button></>}>
    {hasUnavailable && <Banner tone="warn" title={uiText('所选发票已无法核销')} actions={<Button disabled={busy} onClick={() => {
      setLines(current => Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))));
      setError('');
    }}>{uiText('移除失效选择')}</Button>} />}
    {error && <Banner tone="bad" title={uiText('未能核销')}>{uiText(error)}</Banner>}
    <DataTable ariaLabel={uiText('待核销发票')} rows={open} rowKey={i => i.id} columns={columns} density="comfy" />
    {cross && <Field label={uiText('汇率依据')} required full><TextInput aria-label={uiText('汇率依据')} value={rateBasis} disabled={busy} onChange={e => setRateBasis(e.target.value)} placeholder={uiText('银行水单或客户确认的折算')} /></Field>}
  </Dialog>;
}
