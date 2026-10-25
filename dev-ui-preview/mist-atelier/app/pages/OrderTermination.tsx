import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
/** BB-ORD-7：草稿 / 已退回订单作废，已批准订单申请取消；终止后只读。 */
import React from 'react';
import { Ban, XCircle } from 'lucide-react';
import { Banner, Button, Dialog, Field, KeyValue, TextArea } from '../../../../components/mist';
import type { MistCommand, MistOrder, MistState } from '../../../../server/src/shared/mistWorkspace';
import { ORDER_CANCEL_ALTERNATIVE, orderCancelBlockers, type OrderGovernanceFields } from '../../../../server/src/shared/mistOrderGovernance';
import { isLineClosed } from '../../../../server/src/shared/mistOrderClosure';
import { OrderChangeImpactList } from './OrderChangeImpactList';

type Go = (view: string, id?: string, target?: Record<string, string | undefined>) => void;
type Governed = MistOrder & { governance?: OrderGovernanceFields };

/** 订单是否已终止（作废 / 取消）或取消审批中：页面所有编辑入口据此锁定。 */
export function orderLocked(order: Governed) {
  const g = order.governance;
  return g?.status === 'void' || g?.status === 'cancelled' || g?.cancellation?.status === 'pending';
}

export function OrderTerminationBanner({ order }: { order: Governed }) {
  const g = order.governance, t = g?.termination, c = g?.cancellation;
  const when = (at?: string) => at ? new Date(at).toLocaleString(interfaceLocale()) : '';
  if (g?.status === 'void') return <Banner tone="neutral" title={uiText("订单已作废，只读")}>{ui`${t?.byName || ''} 于 ${when(t?.at)} 作废：${t?.reason || ''}。记录保留，不能再编辑、提交或进入采购与履约。`}</Banner>;
  if (g?.status === 'cancelled') return <Banner tone="bad" title={uiText("订单已取消，只读")}>{ui`取消原因：${t?.reason || c?.reason || ''}；${c?.decidedName || t?.byName || ''} 于 ${when(t?.at)} 批准。不能再采购、生产或出运；受影响的采购、生产、出运已生成待办，请到对应模块处理。`}</Banner>;
  if (c?.status === 'pending') return <Banner tone="warn" title={uiText("取消订单审批中，订单已锁定")}>{ui`${c.requesterName} 申请取消：${c.reason}。审批期间不能编辑，也不能新建采购、生产或出运；请在审批中心等待订单审批人决定。`}</Banner>;
  if (c?.status === 'rejected') return <Banner tone="neutral" title={uiText("取消订单申请已退回")}>{ui`${c.decidedName || ''}：${c.note || ''}。订单继续履约。`}</Banner>;
  return null;
}

/** 所有条目已出足（离港 ≥ 订单数量）或已结案：订单已履约完成，取消无意义，不再提供入口。 */
export function orderFulfilled(state: MistState, order: Pick<MistOrder, 'id'>) {
  const lines = state.orderLines.filter(line => line.orderId === order.id);
  const departed = (state.fulfillment?.shipments || []).filter(s => s.state === 'departed');
  return lines.length > 0 && lines.every(line => isLineClosed(line) || departed.reduce((sum, s) => sum + s.lines.filter(item => item.lineId === line.id).reduce((n, item) => n + Math.round(item.quantity * 10000), 0), 0) >= Math.round(line.qty * 10000));
}

export function OrderTerminationButton({ state, order, busy, run, go }: { state: MistState; order: Governed; busy: boolean; run: (command: MistCommand) => Promise<unknown>; go: Go }) {
  const g = order.governance, [open, setOpen] = React.useState(false), [reason, setReason] = React.useState(''), [failure, setFailure] = React.useState(''), [working, setWorking] = React.useState(false);
  if (order.replacementSource || !g || g.status === 'void' || g.status === 'cancelled' || g.cancellation?.status === 'pending') return null;
  const mode: 'void' | 'cancel' | null = g.status === 'draft' || g.status === 'rejected' ? 'void' : g.status === 'approved' ? 'cancel' : null;
  if (!mode || (mode === 'cancel' && orderFulfilled(state, order))) return null;
  const blockers = mode === 'cancel' ? orderCancelBlockers(state, order) : [], changePending = g.changeDraft?.status === 'pending';
  const submit = async () => {
    if (working) return; setFailure('');
    if (!reason.trim()) { setFailure(mode === 'void' ? '请填写作废原因' : '请填写取消原因'); return; }
    setWorking(true);
    try { await run(mode === 'void' ? { type: 'order.governance.void', payload: { orderId: order.id, reason: reason.trim() } } as MistCommand : { type: 'order.governance.requestCancel', payload: { orderId: order.id, reason: reason.trim() } } as MistCommand); setOpen(false); setReason(''); }
    catch (problem) { setFailure(problem instanceof Error ? problem.message : '提交失败，请重试'); }
    finally { setWorking(false); }
  };
  const title = mode === 'void' ? '作废订单' : '申请取消订单';
  return <>
    <Button icon={mode === 'void' ? Ban : XCircle} variant="danger" disabled={busy} onClick={() => { setOpen(true); setFailure(''); }}>{uiText(title)}</Button>
    <Dialog open={open} onClose={() => { if (!working) setOpen(false); }} title={uiText(`${title} · ${order.code}`)} width={720}
      footer={<><Button disabled={working} onClick={() => setOpen(false)}>{uiText("返回")}</Button><Button variant="danger" loading={working} disabled={busy || working || blockers.length > 0 || changePending} onClick={() => void submit()}>{uiText(mode === 'void' ? '确认作废' : '提交取消审批')}</Button></>}>
      {failure && <Banner tone="bad" title={uiText("未能提交")}>{failure}</Banner>}
      {mode === 'void'
        ? <Banner tone="warn" title={uiText("作废后订单只读")}>{uiText("记录保留，停止采购与履约。")}</Banner>
        : blockers.length
          ? <Banner tone="bad" title={uiText(ORDER_CANCEL_ALTERNATIVE)}>{ui`${blockers.join('；')}。已出运或已开票的订单不能整单取消，请在条目详情中按实际数量结案。`}</Banner>
          : <Banner tone="warn" title={uiText("取消须经订单审批人批准")}>{uiText("审批期间暂停新的采购、生产与出运。")}</Banner>}
      {changePending && <Banner tone="warn" title={uiText("有待审批的变更")}>{uiText("请先处理变更审批，再申请取消。")}</Banner>}
      {mode === 'cancel' && <KeyValue items={[{ label: '订单', value: `${order.code} · ${order.customer}` }, { label: '交期', value: order.due }]} />}
      {mode === 'cancel' && !blockers.length && <OrderChangeImpactList state={state} order={order} lines={[]} go={go} note={uiText("批准取消后，下列采购、生产、出运各生成一条“订单已取消，请处理”待办；不会自动改动这些记录。")} />}
      <Field label={uiText(mode === 'void' ? '作废原因' : '取消原因')} required full><TextArea aria-label={uiText(mode === 'void' ? '作废原因' : '取消原因')} value={reason} onChange={e => setReason(e.target.value)} /></Field>
    </Dialog>
  </>;
}
