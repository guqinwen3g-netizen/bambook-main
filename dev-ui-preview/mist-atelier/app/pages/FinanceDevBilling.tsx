import React from 'react';
import { uiText } from '../../../../services/interfaceLanguage';
import { Button, Card, CardHeader, Mono, TextLink } from '../../../../components/mist';
import { isPendingFinanceMistInvoice, type MistCommand, type MistState } from '../../../../server/src/shared/mistWorkspace';
import { useNav } from '../nav';
type Props = { state: MistState; canInvoice: boolean; busy: boolean; execute: (command: MistCommand, success: (result: Record<string, unknown>) => void) => Promise<void> | void };
export const pendingDevelopmentBilling = (state: MistState) => state.invoices.filter(invoice => invoice.devId && isPendingFinanceMistInvoice(invoice));
export function FinanceDevBilling({ state, canInvoice, busy, execute }: Props) {
  const { go } = useNav(), rows = pendingDevelopmentBilling(state);
  if (!rows.length) return null;
  return <div className="mist-section"><Card><CardHeader title={uiText('开发发票待确认')} />
    {rows.map(invoice => <div className="mist-row" key={invoice.id}><TextLink onClick={() => go('invoices', invoice.id)}><Mono>{invoice.code}</Mono></TextLink><span>{invoice.customer}</span><b>{invoice.amount.toFixed(2)} {invoice.currency}</b><span className="mist-spacer" /><Button disabled={busy || !canInvoice} onClick={() => void execute({type:'finance.receivable.confirm',payload:{invoiceId:invoice.id}},()=>{})}>{uiText('确认应收')}</Button></div>)}
  </Card></div>;
}
