import {PayableDialog as Dialog} from './PayableDialog';
import { uiText, ui } from '../../../../services/interfaceLanguage';
/** 供应商结算：业务员按实际收货提交 → 财务复核确认并决定预付抵扣 → 发票到后关联结算登记票据。
 *  拒收不计结算；争议 / 未确认扣款单列，不自动抵减。抵扣建议按结算数量比例，最后一次结算扫尾；调整须写原因。 */
import React from 'react';
import { Banner, Button, Checkbox, Facts, Field, FormGrid, Mono, ObjectCell, Pill, Select, TextArea, TextInput, type Column, type Tone } from '../../../../components/mist';
import { type MistState } from '../../../../server/src/shared/mistWorkspace';
import { platformBusinessDate } from '../../../../server/src/shared/mistPlatform';
import { receiptReturnedQuantity } from '../../../../server/src/shared/mistFulfillment';
import { prepaymentMoves, purchaseContractMinor, purchaseInvoicedMinor, purchasePrepaymentReadback, settlementReceipts, settlementSuggestedPrepaymentMinor, type PayablesCommand, type SettlementView, settlementHasLiveAdvance } from '../../../../server/src/shared/mistPayables';
import { ActionBar, DetailBlock, DetailBody } from './modules/pageKit';

const money = (amount: number, currency: string) => `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const cents = (value: string) => { const n = Number(value); return value.trim() && Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const fmtDay = (at?: string) => at ? platformBusinessDate(at) : '';
export const SETTLEMENT_STATE: Record<SettlementView['state'], { tone: Tone; label: string }> = { pending: { tone: 'warn', label: '待财务复核' }, confirmed: { tone: 'ok', label: '已确认' }, returned: { tone: 'bad', label: '已退回' }, cancelled: { tone: 'neutral', label: '已撤回' }, reversed: { tone: 'neutral', label: '已冲回' } };

export function settlementColumns(): Column<SettlementView>[] {
  return [
    { key: 'code', header: '结算 / 合同', width: 'minmax(170px,1.4fr)', render: r => <ObjectCell name={<Mono>{r.code}</Mono>} meta={r.purchaseCode + ' · ' + r.supplier + (r.final ? ' · 最终结算' : '')} /> },
    { key: 'qty', header: '实收结算', width: '120px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num">{r.quantity} {uiText(r.unit)}</span> },
    { key: 'amount', header: '结算金额', width: '140px', align: 'right', render: r => <span className="mist-num">{money(r.amount, r.currency)}</span> },
    { key: 'pre', header: '预付抵扣', width: '140px', align: 'right', hideOnMobile: true, render: r => r.state === 'confirmed' ? <span className="mist-num">{money(r.confirmation?.prepaymentApplied || 0, r.currency)}</span> : r.state === 'pending' && r.suggested > 0 ? <span className="mist-note">{uiText("建议 ")}{money(r.suggested, r.currency)}</span> : '—' },
    { key: 'state', header: '状态', width: '104px', render: r => <Pill tone={SETTLEMENT_STATE[r.state].tone}>{uiText(SETTLEMENT_STATE[r.state].label)}</Pill> },
  ];
}

export function SettlementDetail({ settlement: st, state, me, busy, canSettle, canConfirm, canBill, onConfirm, onReason, onBill, onLinkBill, onPurchase, children }: {
  settlement: SettlementView; state: MistState; me: string; busy: boolean; canSettle: boolean; canConfirm: boolean; canBill: boolean;
  onConfirm: () => void; onReason: (kind: 'return-settlement' | 'cancel-settlement' | 'reverse-settlement') => void; onBill: () => void; onLinkBill: (id:string) => void; onPurchase: () => void; children?: React.ReactNode;
}) {
  const moved = st.final && st.state === 'confirmed' && prepaymentMoves(state).some(m => !m.reversed && m.purchaseId === st.purchaseId);
  const receipts = state.fulfillment.receipts.filter(r => st.receiptIds.includes(r.id));
  const own = st.submitterId === me;
  const purchase=state.fulfillment.purchases.find(row=>row.id===st.purchaseId);
  const unregisteredMinor=purchase?Math.max(0,purchaseContractMinor(purchase)-purchaseInvoicedMinor(state,purchase.id)):0;
  const heldBills=(state.payables?.bills||[]).filter(bill=>bill.state==='open'&&bill.supplierId===st.supplierId&&bill.currency===st.currency&&bill.lines.some(line=>line.purchaseId===st.purchaseId&&line.awaitingSettlement&&!line.settlementId));
  return <DetailBody data-settlement={st.id} heading={<h2 className="mist-h2">{st.code}</h2>}>
    <div className="mist-row" style={{ flexWrap: 'wrap' }}><Pill tone={SETTLEMENT_STATE[st.state].tone}>{uiText(SETTLEMENT_STATE[st.state].label)}</Pill>{st.final && <Pill tone="accent">{uiText("最终结算")}</Pill>}<span className="mist-note">{st.submittedBy}{uiText(" · 提交于 ")}{fmtDay(st.submittedAt)}</span></div>
    <Facts items={[
      { label: '来源合同', value: <Mono>{st.purchaseCode}</Mono> }, { label: '供应商', value: st.supplier },
      { label: '实收结算数量', value: `${st.quantity} ${st.unit} × ${st.price} ${st.currency}` }, { label: '结算金额', value: money(st.amount, st.currency) },
      ...(st.rejected ? [{ label: '拒收（不计结算）', value: `${st.rejected} ${st.unit}` }] : []),
      ...(st.state === 'confirmed' ? [{ label: '预付抵扣', value: money(st.confirmation?.prepaymentApplied || 0, st.currency) + (st.confirmation && st.confirmation.prepaymentApplied !== st.confirmation.suggestedPrepayment ? `（建议 ${money(st.confirmation.suggestedPrepayment, st.currency)}）` : '') }, { label: '抵扣后应付', value: money(st.net, st.currency) }, {label:'已关联票额',value:money(st.invoiced,st.currency)},{label:'待关联票额',value:money(st.uninvoiced,st.currency)}] : []),
      ...(st.state === 'pending' ? [{ label: '建议预付抵扣', value: money(st.suggested, st.currency) + ` · 合同剩余可抵扣 ${money(st.available, st.currency)}` }] : []),
      ...(st.note ? [{ label: '结算说明', value: st.note }] : []),
    ]} />
    {st.confirmation && <Banner tone="ok" title={uiText("财务已确认")}>{st.confirmation.actor} · {fmtDay(st.confirmation.at)}{uiText(st.confirmation.adjustReason ? `。抵扣调整原因：${st.confirmation.adjustReason}` : '')}{uiText(st.confirmation.note ? `。${st.confirmation.note}` : '')}</Banner>}
    {st.returned && <Banner tone="bad" title={uiText("财务已退回")}>{st.returned.reason}（{st.returned.actor} · {fmtDay(st.returned.at)}{uiText("）。收货记录已释放，可修正后重新提交。")}</Banner>}
    {st.cancelled && <Banner title={uiText("已撤回")}>{st.cancelled.reason}（{st.cancelled.actor} · {fmtDay(st.cancelled.at)}）</Banner>}
    {st.reversed && <Banner title={uiText("已冲回")}>{st.reversed.reason}（{st.reversed.actor} · {fmtDay(st.reversed.at)}{uiText("）。原记录保留；收货记录和预付抵扣已释放。")}</Banner>}
    <ActionBar busy={busy} actions={[
      { label: '确认结算', onClick: onConfirm, reason: !canConfirm ? '需要核销权限（财务）' : own ? '不能复核本人提交的结算' : undefined, hidden: !canConfirm || st.state !== 'pending' },
      { label: '退回结算', onClick: () => onReason('return-settlement'), reason: !canConfirm ? '需要核销权限（财务）' : own ? '不能复核本人提交的结算' : undefined, hidden: !canConfirm || st.state !== 'pending' },
      { label: '撤回结算', onClick: () => onReason('cancel-settlement'), reason: !canSettle ? '需要采购经办权限' : !own ? '只有提交人可以撤回' : undefined, hidden: !canSettle || !own || st.state !== 'pending' },
      { label: '按结算登记票据', onClick: onBill, reason: !canBill ? '需要票据登记权限' : st.uninvoiced <= 0 ? '本结算已全部开票' : undefined, hidden: !canBill || st.state !== 'confirmed' || unregisteredMinor<=0 },
      { label: '冲回结算', onClick: () => onReason('reverse-settlement'), reason: !canConfirm ? '需要核销权限（财务）' : st.invoiced > 0 ? '已关联票据，请先作废关联票据' : settlementHasLiveAdvance(state, st.id) ? '有不等票付款申请或付款，请先撤回申请、冲回付款' : moved ? '剩余预付已退款或转抵，请先冲回这些记录' : undefined, hidden: !canConfirm || st.state !== 'confirmed' },
      { label: '查看合同', onClick: onPurchase },
    ]} />
    {st.state==='confirmed'&&heldBills.length>0&&<DetailBlock title={uiText('待关联票据')}>
      {heldBills.map(bill=><div className="mist-row mist-module-actions" key={bill.id} data-settlement-held-bill={bill.id}>
        <Mono>{bill.code}</Mono><span>{bill.invoiceNo}</span><span className="mist-spacer"/>
        <span className="mist-num">{money(bill.lines.filter(line=>line.purchaseId===st.purchaseId&&line.awaitingSettlement&&!line.settlementId).reduce((sum,line)=>sum+line.amount,0),bill.currency)}</span>
        {canBill&&<Button size="sm" disabled={busy} aria-label={`${bill.code} · ${uiText('关联结算')}`} onClick={()=>onLinkBill(bill.id)}>{uiText('关联结算')}</Button>}
      </div>)}
    </DetailBlock>}
    <DetailBlock title={uiText("对应收货记录")}>{receipts.map(r => <div className="mist-row mist-module-actions" key={r.id}><span>{r.date}</span><span className="mist-note">{r.location} · {r.evidence}</span><span className="mist-spacer" /><span className="mist-num">{uiText("实收 ")}{r.quantity}{uiText(r.rejected ? ` · 拒收 ${r.rejected}` : '')} {uiText(st.unit)}</span></div>)}
      {!receipts.length && <span className="mist-note">{uiText("收货记录未找到。")}</span>}</DetailBlock>
    <DetailBlock title={uiText("争议 / 未确认扣款")}>{st.disputes.map((d, i) => <div className="mist-row mist-module-actions" key={i}><span>{d.description}</span><span className="mist-spacer" /><span className="mist-num">{money(d.amount, st.currency)}</span></div>)}
      {!st.disputes.length && <span className="mist-note">{uiText("没有登记争议或扣款。")}</span>}</DetailBlock>
    {uiText(children)}
  </DetailBody>;
}

type SubmitDraft = { purchaseId: string; receipts: Record<string, boolean>; final: boolean; disputes: Array<{ description: string; amount: string }>; note: string };
/** 多个控件的分组：不能用 <label>（会把整组文字当成第一个控件的名称，点说明文字也会误触按钮）。 */
export function FieldGroup({ label, required, hint, children }: { label: string; required?: boolean; hint?: React.ReactNode; children: React.ReactNode }) {
  return <div className="mist-field" role="group" aria-label={uiText(label)}><span className="mist-field-label">{uiText(label)}{required && <em>*</em>}</span>{uiText(children)}{hint && <span className="mist-field-hint">{uiText(hint)}</span>}</div>;
}

export function SettlementSubmitDialog({ open, state, initialPurchaseId, busy, canSettle, failure, onClose, execute, onDone }: {
  open: boolean; state: MistState | null; initialPurchaseId?: string; busy: boolean; canSettle: boolean; failure: string; onClose: () => void;
  execute: (command: PayablesCommand, done: (result: Record<string, unknown>) => void, local?: string) => void; onDone: (id: string) => void;
}) {
  const [draft, setDraft] = React.useState<SubmitDraft>({ purchaseId: '', receipts: {}, final: false, disputes: [], note: '' }), [local, setLocal] = React.useState('');
  React.useEffect(() => { if (open) { setDraft({ purchaseId: initialPurchaseId || '', receipts: {}, final: false, disputes: [], note: '' }); setLocal(''); } }, [open, initialPurchaseId]);
  const purchases = (state?.fulfillment.purchases || []).filter(p => p.state === 'approved' && (!initialPurchaseId || p.id === initialPurchaseId));
  const unavailable = !!initialPurchaseId && !purchases.some(purchase => purchase.id === initialPurchaseId);
  const po = purchases.find(p => p.id === draft.purchaseId);
  const rows = state && po ? settlementReceipts(state, po.id) : [];
  const chosen = rows.filter(r => draft.receipts[r.receipt.id] && !r.settled && !r.pendingReceiver);
  const qty = chosen.reduce((n, r) => n + r.receipt.quantity, 0), amount = po ? Math.round(qty * po.price * 100) : 0;
  const prepay = state && po ? purchasePrepaymentReadback(state, po.id) : null;
  const priorSettlements=(state?.payables?.settlements||[]).filter(row=>row.purchaseId===po?.id);
  const settledQty=priorSettlements.filter(row=>row.state==='confirmed').reduce((sum,row)=>sum+row.quantity,0);
  const automaticFinal=!!po&&qty>0&&settledQty+qty>=po.quantity,final=draft.final||automaticFinal;
  const blocked=po?(priorSettlements.some(row=>row.state==='confirmed'&&row.final)?'合同已完成最终结算':priorSettlements.some(row=>row.state==='pending')?'已有待财务复核结算':!rows.some(row=>!row.settled&&!row.pendingReceiver&&row.receipt.quantity>0)?'暂无可结算实收':''):'';
  const suggested = state && po && qty > 0 ? settlementSuggestedPrepaymentMinor(state, { id: '', purchaseId: po.id, quantity: qty, amount: amount / 100, final }) : 0;
  const submit = () => {
    if (!po) return setLocal('请选择合同。');
    if(blocked)return setLocal(blocked);
    if (!chosen.length) return setLocal('请至少勾选一条实际收货记录。');
    if (qty <= 0) return setLocal('所选收货记录没有实收合格数量；拒收数量不计入结算。');
    const disputes = draft.disputes.filter(d => d.description.trim() || d.amount.trim());
    if (disputes.some(d => !d.description.trim() || !(cents(d.amount) > 0))) return setLocal('每条争议 / 扣款都要写明说明和大于零的金额。');
    setLocal('');
    execute({ type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: chosen.map(r => r.receipt.id), final, disputes: disputes.map(d => ({ description: d.description, amount: cents(d.amount) / 100 })), note: draft.note } }, r => onDone(String(r.id)));
  };
  const message = local || failure;
  return <Dialog open={open} onClose={() => { if (!busy) onClose(); }} width={760} title={uiText("提交结算")}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={busy || !canSettle || unavailable || !!blocked} onClick={submit}>{uiText("提交复核")}</Button></>}>
    <div className="mist-col">
      {message && <Banner tone="bad" title={uiText("还不能提交")}>{message}</Banner>}
      {unavailable && <Banner tone="bad" title={uiText('来源合同已不可用')} />}
      {blocked && <Banner tone="neutral" title={uiText(blocked)}/>}

      <Field label={uiText("来源合同")} required><Select aria-label={uiText("结算合同")} disabled={!!initialPurchaseId} value={draft.purchaseId} options={[{ value: '', label: '请选择已批准合同' }, ...purchases.map(p => ({ value: p.id, label: `${p.code} · ${p.supplier}` }))]} onChange={e => setDraft({ ...draft, purchaseId: e.target.value, receipts: {} })} /></Field>
      {po && <Facts items={[{label:'合同数量',value:`${po.quantity} ${po.unit}`},{label:'合同单价',value:money(po.price,po.currency)},{label:'合同金额',value:money(purchaseContractMinor(po)/100,po.currency)}]}/>}
      {po && <FieldGroup label={uiText("实际收货记录")} required>
        <div className="mist-col">{rows.map(({ receipt: r, settled, pendingReceiver }) => <div className="mist-row mist-module-actions" key={r.id} data-settle-receipt={r.id}>
          <Checkbox checked={!!draft.receipts[r.id] && !settled && !pendingReceiver} disabled={settled || pendingReceiver || r.quantity <= 0} onChange={v => setDraft({ ...draft, receipts: { ...draft.receipts, [r.id]: v } })} label={<span>{r.date} · {r.location}{uiText(" · 实收 ")}{r.quantity}{uiText(r.rejected ? ` · 拒收 ${r.rejected}` : '')} {uiText(po.unit)}{uiText(settled ? ' · 已在结算中' : pendingReceiver ? ' · 待接收人点收' : r.quantity <= 0 ? ' · 无实收' : '')}</span>} /></div>)}
          {!rows.length && <span className="mist-note">{uiText("这张合同还没有实际收货记录；先在采购详情登记收货。")}</span>}</div>
      </FieldGroup>}
      {po && (() => { const all = state ? state.fulfillment.receipts.filter(r => r.purchaseId === po.id) : [], noReplace = all.reduce((n, r) => n + receiptReturnedQuantity(r, 'noReplace'), 0), open = all.reduce((n, r) => n + r.rejected - receiptReturnedQuantity(r), 0); return noReplace > 0 || open > 0 ? <Banner tone={open > 0 ? 'warn' : undefined} title={uiText("拒收与退换")}>{uiText(noReplace > 0 ? `供应商已确认不再补发 ${Math.round(noReplace * 10000) / 10000} ${po.unit}；如本合同不再交货，可勾选最终结算。` : '')}{uiText(open > 0 ? `还有 ${Math.round(open * 10000) / 10000} ${po.unit} 拒收未登记退换，请先在采购详情登记供应商补发或不再补发。` : '')}</Banner> : null; })()}
      {po && <Facts items={[{label:'本次实收',value:`${qty} ${po.unit}`},{label:'结算金额',value:money(amount/100,po.currency)}]}/>}
      {po && <Checkbox checked={final} disabled={busy||!canSettle||automaticFinal||!!blocked} onChange={v => setDraft({ ...draft, final: v })} label={uiText("最终结算")} />}
      {po && prepay && (prepay.paid > 0 || prepay.transferredIn > 0) && <Facts items={[{label:'已付预付',value:money(prepay.paid,po.currency)},...(prepay.transferredIn>0?[{label:'转入预付',value:money(prepay.transferredIn,po.currency)}]:[]),{label:'已抵扣',value:money(prepay.applied,po.currency)},{label:'剩余可抵扣',value:money(prepay.available,po.currency)},{label:'建议抵扣',value:money(suggested/100,po.currency)}]}/>}
      <FieldGroup label={uiText("争议 / 未确认扣款")}>
        <div className="mist-col">{draft.disputes.map((d, i) => <FormGrid key={i}>
          <TextInput aria-label={ui`争议说明 ${i + 1}`} value={d.description} onChange={e => setDraft({ ...draft, disputes: draft.disputes.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} />
          <TextInput aria-label={ui`争议金额 ${i + 1}`} type="number" min="0.01" step="0.01" value={d.amount} onChange={e => setDraft({ ...draft, disputes: draft.disputes.map((x, j) => j === i ? { ...x, amount: e.target.value } : x) })} />
        </FormGrid>)}
          <div className="mist-row"><Button size="sm" disabled={draft.disputes.length >= 20} onClick={() => setDraft({ ...draft, disputes: [...draft.disputes, { description: '', amount: '' }] })}>{uiText("添加争议 / 扣款")}</Button></div></div>
      </FieldGroup>
      <Field label={uiText("结算说明")}><TextArea aria-label={uiText("结算说明")} rows={2} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>
    </div>
  </Dialog>;
}

export function SettlementConfirmDialog({ settlement: st, busy, canConfirm, failure, onClose, execute, onDone }: {
  settlement: SettlementView | undefined; busy: boolean; canConfirm: boolean; failure: string; onClose: () => void;
  execute: (command: PayablesCommand, done: (result: Record<string, unknown>) => void) => void; onDone: () => void;
}) {
  const [applied, setApplied] = React.useState(''), [adjust, setAdjust] = React.useState(''), [note, setNote] = React.useState(''), [local, setLocal] = React.useState('');
  React.useEffect(() => { if (st) { setApplied(String(st.suggested)); setAdjust(''); setNote(''); setLocal(''); } }, [st?.id]);
  if (!st) return null;
  const value = cents(applied || '0'), changed = value !== Math.round(st.suggested * 100);
  const submit = () => {
    if (Number.isNaN(value) || value < 0) return setLocal('预付抵扣格式无效。');
    if (value > Math.round(st.available * 100)) return setLocal('预付抵扣超过合同剩余可抵扣预付。');
    if (value > Math.round(st.amount * 100)) return setLocal('预付抵扣不能超过结算金额。');
    if (changed && !adjust.trim()) return setLocal('抵扣额与建议不同，请写明调整原因。');
    setLocal(''); execute({ type: 'payable.settlement.confirm', payload: { id: st.id, prepaymentApplied: value / 100, adjustReason: changed ? adjust : undefined, note } }, onDone);
  };
  const message = local || failure;
  return <Dialog open onClose={() => { if (!busy) onClose(); }} width={640} title={uiText("确认结算")} description={ui`${st.code} · ${st.purchaseCode}`}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={busy || !canConfirm} onClick={submit}>{uiText("确认结算")}</Button></>}>
    <div className="mist-col">
      {message && <Banner tone="bad" title={uiText("还不能确认")}>{message}</Banner>}
      <Facts items={[{ label: '实收结算数量', value: `${st.quantity} ${uiText(st.unit)} × ${money(st.price, st.currency)}` }, { label: '结算金额', value: money(st.amount, st.currency) }, { label: '建议预付抵扣', value: money(st.suggested, st.currency) + (st.final ? '（最终结算：抵扣剩余全部预付）' : '（按结算数量比例）') }, { label: '合同剩余可抵扣', value: money(st.available, st.currency) }, ...(st.disputes.length ? [{ label: '争议 / 扣款（不抵减）', value: st.disputes.map(d => `${d.description} ${money(d.amount, st.currency)}`).join('；') }] : [])]} />
      <Field label={uiText("本次预付抵扣")} required><TextInput aria-label={uiText("本次预付抵扣")} type="number" min="0" step="0.01" value={applied} onChange={e => setApplied(e.target.value)} /></Field>
      {changed && <Field label={uiText("调整原因")} required><TextInput aria-label={uiText("调整原因")} value={adjust} onChange={e => setAdjust(e.target.value)} /></Field>}
      <Field label={uiText("复核意见")}><TextArea aria-label={uiText("复核意见")} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
    </div>
  </Dialog>;
}
